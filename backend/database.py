import os
import json
import re
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

# Load environment variables
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(base_dir, ".env"))

# Global placeholder for backwards compatibility in driver.py and main.py
supabase = None

class JSONDatabase:
    """
    Pure Local JSON File Database.
    Acts as a Data Access Object (DAO) mapped to local JSON files.
    """
    _tmp_seeded = False  # class-level flag so we only copy once per cold start

    def __init__(self, table_name: str):
        self.table_name = table_name
        primary_data_dir = os.path.join(base_dir, "data")
        try:
            os.makedirs(primary_data_dir, exist_ok=True)
            # Verify write access by writing a temporary hidden file
            test_file = os.path.join(primary_data_dir, ".write_test")
            with open(test_file, "w") as f:
                f.write("test")
            os.remove(test_file)
            self.data_dir = primary_data_dir
        except (OSError, IOError):
            # Read-only filesystem (e.g. Vercel) — use /tmp/data
            tmp_data_dir = "/tmp/data"
            if not JSONDatabase._tmp_seeded:
                # Copy bundled JSON seed files from project data/ to /tmp/data
                os.makedirs(tmp_data_dir, exist_ok=True)
                if os.path.isdir(primary_data_dir):
                    import shutil
                    for fname in os.listdir(primary_data_dir):
                        if fname.endswith(".json"):
                            src = os.path.join(primary_data_dir, fname)
                            dst = os.path.join(tmp_data_dir, fname)
                            if not os.path.exists(dst):
                                shutil.copy2(src, dst)
                                print(f"[DB] Copied bundled {fname} -> /tmp/data/")
                JSONDatabase._tmp_seeded = True
            os.makedirs(tmp_data_dir, exist_ok=True)
            self.data_dir = tmp_data_dir

        self.file_path = os.path.join(self.data_dir, f"{table_name}.json")
        self._ensure_local_seeded()

    def _ensure_local_seeded(self):
        # 1. If file does not exist or is empty, try seeding from SQL
        if not os.path.exists(self.file_path) or os.path.getsize(self.file_path) == 0:
            sql_file_path = os.path.join(base_dir, "seed_data.sql")
            self._seed_table_from_sql(sql_file_path)
            
        # 2. Specifically for companies table, if it is empty, add default company
        if self.table_name == "companies":
            companies = self._load_local_data(check_seed=False)
            if not companies:
                default_company = {
                    "id": "557f9b08-30da-4b99-b233-a16c9df5191d",
                    "name": "Logistix India Corp",
                    "email": "manager@logistix.com",
                    "password": "password123"
                }
                companies.append(default_company)
                self._save_local_data(companies)
                print("Seeded default company record in local database.")

    def _seed_table_from_sql(self, sql_file_path: str):
        if not os.path.exists(sql_file_path):
            return
        
        try:
            with open(sql_file_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            # Find matching INSERT INTO self.table_name (id, data) VALUES ('...', '...');
            pattern = re.compile(
                r"INSERT\s+INTO\s+" + re.escape(self.table_name) +
                r"\s*\([^)]*\)\s*VALUES\s*\(\s*'[^']+'\s*,\s*'({.+?})'\s*\)\s*;",
                re.DOTALL | re.IGNORECASE
            )
            matches = pattern.findall(content)
            
            items = []
            for json_str in matches:
                try:
                    item = json.loads(json_str)
                    # For Mumbai hub, inject credentials for WH manager login
                    if self.table_name == "warehouses" and item.get("id") == "c7b6daa2-a17b-4ae8-bcfb-f9fb3df277f7":
                        item["manager_name"] = "Mumbai Manager"
                        item["manager_email"] = "mumbai@logistix.com"
                        item["manager_password"] = "password123"
                    items.append(item)
                except Exception as e:
                    print(f"Error parsing seed record for local {self.table_name}: {e}")
            
            if items:
                self._save_local_data(items)
                print(f"Seeded local database table '{self.table_name}' with {len(items)} records from seed_data.sql")
        except Exception as e:
            print(f"Failed to seed table {self.table_name} from SQL: {e}")

    def _load_local_data(self, check_seed: bool = True) -> List[Dict[str, Any]]:
        if check_seed:
            self._ensure_local_seeded()
        if not os.path.exists(self.file_path):
            return []
        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
                return []
        except Exception as e:
            print(f"Error loading local database file {self.file_path}: {e}")
            return []

    def _save_local_data(self, data: List[Dict[str, Any]]) -> bool:
        try:
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            return True
        except Exception as e:
            print(f"Error saving local database file {self.file_path}: {e}")
            return False

    def _ensure_client(self):
        pass

    def get_all(self) -> List[Dict[str, Any]]:
        return self._load_local_data()

    def get_by_id(self, item_id: str) -> Optional[Dict[str, Any]]:
        items = self._load_local_data()
        for item in items:
            if str(item.get("id")) == str(item_id):
                return item
        return None

    def get_filtered(self, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        items = self._load_local_data()
        filtered = []
        for item in items:
            match = True
            for key, val in filters.items():
                if str(item.get(key)) != str(val):
                    match = False
                    break
            if match:
                filtered.append(item)
        return filtered

    def insert(self, item: Dict[str, Any]) -> Dict[str, Any]:
        items = self._load_local_data()
        items = [i for i in items if str(i.get("id")) != str(item.get("id"))]
        items.append(item)
        self._save_local_data(items)
        return item

    def update(self, item_id: str, updated_item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        items = self._load_local_data()
        for i, item in enumerate(items):
            if str(item.get("id")) == str(item_id):
                items[i].update(updated_item)
                self._save_local_data(items)
                return items[i]
        return None

    def delete(self, item_id: str) -> bool:
        items = self._load_local_data()
        orig_len = len(items)
        items = [i for i in items if str(i.get("id")) != str(item_id)]
        self._save_local_data(items)
        return len(items) < orig_len

    def write(self, data: List[Dict[str, Any]]):
        self._save_local_data(data)

    def delete_many(self, filter_column: str, filter_value: Any) -> int:
        items = self._load_local_data()
        key_to_check = filter_column
        is_jsonb = False
        if filter_column.startswith("data->>"):
            key_to_check = filter_column.replace("data->>", "")
            is_jsonb = True
        
        remaining = []
        deleted_count = 0
        for item in items:
            val = item.get(key_to_check)
            if not is_jsonb and key_to_check == "id":
                val = item.get("id")
            
            if str(val) == str(filter_value):
                deleted_count += 1
            else:
                remaining.append(item)
        
        if deleted_count > 0:
            self._save_local_data(remaining)
        return deleted_count

    def clear_all(self):
        self.write([])

    @staticmethod
    def snapshot():
        pass

    @staticmethod
    def restore():
        return True
