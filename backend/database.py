import os
import json
import re
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(base_dir, ".env"))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

# Initialize global client safely
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY and not SUPABASE_URL.startswith("your-") and not SUPABASE_KEY.startswith("your-"):
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"Supabase client initialization failed: {e}. Fallback to local files will be used.")
        supabase = None

class JSONDatabase:
    """
    Supabase Implementation with transparent local file fallback.
    Acts as a Data Access Object (DAO) mapped to Supabase JSONB tables or local JSON files.
    """
    def __init__(self, table_name: str):
        self.table_name = table_name
        self.data_dir = os.path.join(base_dir, "data")
        os.makedirs(self.data_dir, exist_ok=True)
        self.file_path = os.path.join(self.data_dir, f"{table_name}.json")
        
        # If supabase is not configured, ensure data is seeded locally
        if not supabase:
            self._ensure_local_seeded()

    def _ensure_local_seeded(self):
        # 1. If file does not exist or is empty, try seeding from SQL
        if not os.path.exists(self.file_path) or os.path.getsize(self.file_path) == 0:
            sql_file_path = os.path.join(base_dir, "seed_data.sql")
            self._seed_table_from_sql(sql_file_path)
            
        # 2. Specifically for companies table, if it is empty, add default company
        if self.table_name == "companies":
            companies = self._load_local_data()
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

    def _load_local_data(self) -> List[Dict[str, Any]]:
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
            return True
        except Exception as e:
            print(f"Error saving local database file {self.file_path}: {e}")
            return False

    def _ensure_client(self):
        # We don't raise exception anymore since we fall back to local files when supabase is None
        pass

    def get_all(self) -> List[Dict[str, Any]]:
        if not supabase:
            return self._load_local_data()
            
        import time
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = supabase.table(self.table_name).select("data").execute()
                if response.data:
                    return [row["data"] for row in response.data if row.get("data")]
                return []
            except Exception as e:
                if "Errno 35" in str(e) and attempt < max_retries - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                print(f"Supabase GET_ALL Error on {self.table_name}: {e}")
                return []
        return []

    def get_by_id(self, item_id: str) -> Optional[Dict[str, Any]]:
        if not supabase:
            items = self._load_local_data()
            for item in items:
                if str(item.get("id")) == str(item_id):
                    return item
            return None

        import time
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = supabase.table(self.table_name).select("data").eq("id", item_id).execute()
                if response.data and len(response.data) > 0:
                    data = response.data[0].get("data")
                    return data if isinstance(data, dict) else None
                return None
            except Exception as e:
                if "Errno 35" in str(e) and attempt < max_retries - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue
        return None

    def get_filtered(self, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not supabase:
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

        import time
        max_retries = 2
        for attempt in range(max_retries):
            try:
                query = supabase.table(self.table_name).select("data")
                for key, val in filters.items():
                    query = query.eq(f"data->>{key}", str(val))
                
                response = query.execute()
                if response.data:
                    return [row["data"] for row in response.data if row.get("data")]
                return []
            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(0.3)
                    continue
                print(f"Supabase GET_FILTERED Error on {self.table_name}: {e}")
                return []
        return []

    def insert(self, item: Dict[str, Any]) -> Dict[str, Any]:
        if not supabase:
            items = self._load_local_data()
            items = [i for i in items if str(i.get("id")) != str(item.get("id"))]
            items.append(item)
            self._save_local_data(items)
            return item

        try:
            record = {"id": str(item["id"]), "data": item}
            supabase.table(self.table_name).insert(record).execute()
            return item
        except Exception as e:
            print(f"Supabase INSERT Error on {self.table_name}: {e}")
            return item

    def update(self, item_id: str, updated_item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not supabase:
            items = self._load_local_data()
            for i, item in enumerate(items):
                if str(item.get("id")) == str(item_id):
                    items[i].update(updated_item)
                    self._save_local_data(items)
                    return items[i]
            return None

        try:
            current = self.get_by_id(item_id)
            if not current:
                return None
            current.update(updated_item)
            record = {"id": str(item_id), "data": current}
            supabase.table(self.table_name).update(record).eq("id", item_id).execute()
            return current
        except Exception as e:
            print(f"Supabase UPDATE Error on {self.table_name}: {e}")
            return None

    def delete(self, item_id: str) -> bool:
        if not supabase:
            items = self._load_local_data()
            orig_len = len(items)
            items = [i for i in items if str(i.get("id")) != str(item_id)]
            self._save_local_data(items)
            return len(items) < orig_len

        try:
            response = supabase.table(self.table_name).delete().eq("id", item_id).execute()
            return True
        except Exception as e:
            print(f"Supabase DELETE Error on {self.table_name}: {e}")
            return False

    def write(self, data: List[Dict[str, Any]]):
        if not supabase:
            self._save_local_data(data)
            return

        try:
            supabase.table(self.table_name).delete().neq("id", "0").execute()
            if data:
                records = [{"id": str(item["id"]), "data": item} for item in data]
                supabase.table(self.table_name).insert(records).execute()
        except Exception as e:
            print(f"Supabase WRITE Error on {self.table_name}: {e}")

    def delete_many(self, filter_column: str, filter_value: Any) -> int:
        if not supabase:
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

        try:
            response = supabase.table(self.table_name).delete().eq(filter_column, filter_value).execute()
            return len(response.data) if response.data else 0
        except Exception as e:
            print(f"Supabase DELETE_MANY Error on {self.table_name}: {e}")
            return 0

    def clear_all(self):
        self.write([])

    @staticmethod
    def snapshot():
        pass

    @staticmethod
    def restore():
        return True
