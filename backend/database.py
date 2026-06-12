import os
import json
import re
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Load environment variables
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(base_dir, ".env"))

# Global placeholder for backwards compatibility
supabase = None

# Configure SQLite WAL DB
primary_data_dir = os.path.join(base_dir, "data")
os.makedirs(primary_data_dir, exist_ok=True)
sqlite_db_path = os.path.join(primary_data_dir, "logistix_local.db")
db_url = f"sqlite:///{sqlite_db_path}"

# Thread-safe engine with WAL enabled
engine = create_engine(
    db_url,
    connect_args={"check_same_thread": False, "timeout": 30}
)

# Enable WAL mode for high concurrency
with engine.connect() as conn:
    conn.execute(text("PRAGMA journal_mode=WAL;"))
    conn.execute(text("PRAGMA synchronous=NORMAL;"))

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class JSONDatabase:
    """
    Production-grade SQLite + WAL Local Database masquerading as JSONDatabase.
    Acts as a drop-in replacement, avoiding codebase-wide refactoring.
    """
    _tmp_seeded = False

    def __init__(self, table_name: str, force_local: bool = False):
        self.table_name = table_name
        self.use_turso = False
        
        if not force_local:
            raw_url = os.environ.get("TURSO_DATABASE_URL", "")
            token = os.environ.get("TURSO_AUTH_TOKEN", "")
            if raw_url and token:
                self.use_turso = True
                if table_name == "companies":
                    from backend.services.turso_db import TursoCompaniesDB
                    self.turso_db = TursoCompaniesDB()
                else:
                    from backend.services.turso_db import TursoGenericDB
                    self.turso_db = TursoGenericDB(table_name)
                return

        # Ensure directory exists
        self.data_dir = primary_data_dir
        self.file_path = os.path.join(self.data_dir, f"{table_name}.json")
        
        # Ensure SQLite table is set up
        self._ensure_table()
        # Perform auto-migration and seeding
        self._migrate_and_seed()

    def _ensure_table(self):
        with engine.begin() as conn:
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                )
            """))

    def _migrate_and_seed(self):
        # 1. Check if SQLite table is empty
        db = SessionLocal()
        try:
            res = db.execute(text(f"SELECT COUNT(*) FROM {self.table_name}")).scalar()
            if res > 0:
                return  # Table is already seeded/has data
            
            # 2. Attempt to migrate from existing JSON file
            migrated_items = []
            if os.path.exists(self.file_path) and os.path.getsize(self.file_path) > 0:
                try:
                    with open(self.file_path, "r", encoding="utf-8") as f:
                        content = f.read().strip()
                        if content:
                            data = json.loads(content)
                            if isinstance(data, list):
                                migrated_items = data
                except Exception as e:
                    print(f"[SQLite DB] Error reading legacy JSON file {self.file_path}: {e}")
            
            # 3. If no legacy JSON data, try seeding from seed_data.sql
            if not migrated_items:
                sql_file_path = os.path.join(base_dir, "seed_data.sql")
                migrated_items = self._parse_seed_from_sql(sql_file_path)
            
            # 4. Inject default company record if companies table is still empty
            if self.table_name == "companies" and not migrated_items:
                default_company = {
                    "id": "557f9b08-30da-4b99-b233-a16c9df5191d",
                    "name": "Logistix India Corp",
                    "email": "manager@logistix.com",
                    "password": os.environ.get("DEMO_PASSWORD", "password123")
                }
                migrated_items.append(default_company)
            
            # 5. Save items into SQLite
            if migrated_items:
                self._save_to_sqlite(db, migrated_items)
                print(f"[SQLite DB] Migrated/Seeded {len(migrated_items)} records into '{self.table_name}' table.")
        finally:
            db.close()

    def _parse_seed_from_sql(self, sql_file_path: str) -> List[Dict[str, Any]]:
        if not os.path.exists(sql_file_path):
            return []
        
        items = []
        try:
            with open(sql_file_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            pattern = re.compile(
                r"INSERT\s+INTO\s+" + re.escape(self.table_name) +
                r"\s*\([^)]*\)\s*VALUES\s*\(\s*'[^']+'\s*,\s*'({.+?})'\s*\)\s*;",
                re.DOTALL | re.IGNORECASE
            )
            matches = pattern.findall(content)
            
            for json_str in matches:
                try:
                    item = json.loads(json_str)
                    if self.table_name == "warehouses" and item.get("id") == "c7b6daa2-a17b-4ae8-bcfb-f9fb3df277f7":
                        item["manager_name"] = "Mumbai Manager"
                        item["manager_email"] = "mumbai@logistix.com"
                        item["manager_password"] = os.environ.get("DEMO_PASSWORD", "password123")
                    items.append(item)
                except Exception as e:
                    print(f"Error parsing seed record: {e}")
        except Exception as e:
            print(f"Failed to seed table {self.table_name} from SQL: {e}")
        return items

    def _save_to_sqlite(self, db, items: List[Dict[str, Any]]):
        with db.begin():
            # Delete first to replace
            db.execute(text(f"DELETE FROM {self.table_name}"))
            for item in items:
                db.execute(
                    text(f"INSERT INTO {self.table_name} (id, data) VALUES (:id, :data)"),
                    {"id": str(item.get("id", "")), "data": json.dumps(item, ensure_ascii=False)}
                )

    def get_all(self) -> List[Dict[str, Any]]:
        if self.use_turso:
            return self.turso_db.get_all()
        
        db = SessionLocal()
        try:
            rows = db.execute(text(f"SELECT data FROM {self.table_name}")).all()
            items = []
            for row in rows:
                try:
                    items.append(json.loads(row[0]))
                except Exception:
                    pass
            return items
        finally:
            db.close()

    def get_by_id(self, item_id: str) -> Optional[Dict[str, Any]]:
        if self.use_turso:
            return self.turso_db.get_by_id(item_id)
        
        db = SessionLocal()
        try:
            row = db.execute(
                text(f"SELECT data FROM {self.table_name} WHERE id = :id"),
                {"id": str(item_id)}
            ).first()
            if row:
                try:
                    return json.loads(row[0])
                except Exception:
                    pass
            return None
        finally:
            db.close()

    def get_filtered(self, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        if self.use_turso:
            return self.turso_db.get_filtered(filters)
        
        if not filters:
            return self.get_all()
            
        db = SessionLocal()
        try:
            where_clauses = []
            params = {}
            for i, (k, v) in enumerate(filters.items()):
                where_clauses.append(f"json_extract(data, '$.{k}') = :val_{i}")
                if isinstance(v, bool):
                    params[f"val_{i}"] = 1 if v else 0
                elif isinstance(v, (int, float)):
                    params[f"val_{i}"] = v
                else:
                    params[f"val_{i}"] = str(v)
            
            where_sql = " AND ".join(where_clauses)
            query = f"SELECT data FROM {self.table_name} WHERE {where_sql}"
            
            rows = db.execute(text(query), params).all()
            items = []
            for row in rows:
                try:
                    items.append(json.loads(row[0]))
                except Exception:
                    pass
            return items
        finally:
            db.close()

    def insert(self, item: Dict[str, Any]) -> Dict[str, Any]:
        if self.use_turso:
            return self.turso_db.insert(item)
        
        db = SessionLocal()
        try:
            with db.begin():
                db.execute(
                    text(f"INSERT OR REPLACE INTO {self.table_name} (id, data) VALUES (:id, :data)"),
                    {"id": str(item.get("id", "")), "data": json.dumps(item, ensure_ascii=False)}
                )
            return item
        finally:
            db.close()

    def update(self, item_id: str, updated_item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if self.use_turso:
            return self.turso_db.update(item_id, updated_item)
        
        db = SessionLocal()
        try:
            with db.begin():
                row = db.execute(
                    text(f"SELECT data FROM {self.table_name} WHERE id = :id"),
                    {"id": str(item_id)}
                ).first()
                if not row:
                    return None
                
                current = json.loads(row[0])
                current.update(updated_item)
                
                db.execute(
                    text(f"UPDATE {self.table_name} SET data = :data WHERE id = :id"),
                    {"id": str(item_id), "data": json.dumps(current, ensure_ascii=False)}
                )
                return current
        finally:
            db.close()

    def delete(self, item_id: str) -> bool:
        if self.use_turso:
            return self.turso_db.delete(item_id)
        
        db = SessionLocal()
        try:
            with db.begin():
                res = db.execute(
                    text(f"DELETE FROM {self.table_name} WHERE id = :id"),
                    {"id": str(item_id)}
                )
                return res.rowcount > 0
        finally:
            db.close()

    def write(self, data: List[Dict[str, Any]]):
        if self.use_turso:
            return self.turso_db.write(data)
        
        db = SessionLocal()
        try:
            self._save_to_sqlite(db, data)
        finally:
            db.close()

    def update_many(self, items_to_update: List[tuple]) -> int:
        if self.use_turso:
            return self.turso_db.update_many(items_to_update)
        
        db = SessionLocal()
        updated_count = 0
        try:
            with db.begin():
                for item_id, fields in items_to_update:
                    row = db.execute(
                        text(f"SELECT data FROM {self.table_name} WHERE id = :id"),
                        {"id": str(item_id)}
                    ).first()
                    if row:
                        current = json.loads(row[0])
                        current.update(fields)
                        db.execute(
                            text(f"UPDATE {self.table_name} SET data = :data WHERE id = :id"),
                            {"id": str(item_id), "data": json.dumps(current, ensure_ascii=False)}
                        )
                        updated_count += 1
            return updated_count
        finally:
            db.close()

    def delete_many(self, filter_column: str, filter_value: Any) -> int:
        if self.use_turso:
            return self.turso_db.delete_many(filter_column, filter_value)
        
        db = SessionLocal()
        try:
            key_to_check = filter_column.replace("data->>", "") if filter_column.startswith("data->>") else filter_column
            
            with db.begin():
                if isinstance(filter_value, bool):
                    val = 1 if filter_value else 0
                elif isinstance(filter_value, (int, float)):
                    val = filter_value
                else:
                    val = str(filter_value)
                    
                query = text(f"DELETE FROM {self.table_name} WHERE json_extract(data, '$.{key_to_check}') = :val")
                res = db.execute(query, {"val": val})
                return res.rowcount
        finally:
            db.close()

    def clear_all(self):
        if self.use_turso:
            return self.turso_db.clear_all()
        db = SessionLocal()
        try:
            with db.begin():
                db.execute(text(f"DELETE FROM {self.table_name}"))
        finally:
            db.close()

    @staticmethod
    def snapshot():
        pass

    @staticmethod
    def restore():
        return True
