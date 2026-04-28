import os
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(base_dir, ".env"))
#hi
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

# Initialize global client
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

class JSONDatabase:
    """
    Supabase Implementation (retaining the JSONDatabase class name so that 
    the rest of the codebase doesn't need to be updated).
    This acts as a Data Access Object (DAO) mapped to Supabase JSONB tables.
    """
    def __init__(self, table_name: str):
        self.table_name = table_name

    def _ensure_client(self):
        if not supabase:
            raise Exception("Supabase is not configured. Please check your .env file.")

    def get_all(self) -> List[Dict[str, Any]]:
        self._ensure_client()
        try:
            response = supabase.table(self.table_name).select("data").execute()
            if response.data:
                return [row["data"] for row in response.data if row.get("data")]
            return []
        except Exception as e:
            print(f"Supabase GET_ALL Error on {self.table_name}: {e}")
            return []

    def get_by_id(self, item_id: str) -> Optional[Dict[str, Any]]:
        self._ensure_client()
        try:
            response = supabase.table(self.table_name).select("data").eq("id", item_id).execute()
            if response.data and len(response.data) > 0:
                data = response.data[0].get("data")
                return data if isinstance(data, dict) else None
            return None
        except Exception as e:
            print(f"Supabase GET_BY_ID Error on {self.table_name}: {e}")
            return None

    def insert(self, item: Dict[str, Any]) -> Dict[str, Any]:
        self._ensure_client()
        try:
            record = {"id": str(item["id"]), "data": item}
            supabase.table(self.table_name).insert(record).execute()
            return item
        except Exception as e:
            print(f"Supabase INSERT Error on {self.table_name}: {e}")
            return item

    def update(self, item_id: str, updated_item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        self._ensure_client()
        try:
            # 1. Fetch current item
            current = self.get_by_id(item_id)
            if not current:
                return None
            
            # 2. Merge updates
            current.update(updated_item)
            
            # 3. Push to Supabase
            record = {"id": str(item_id), "data": current}
            supabase.table(self.table_name).update(record).eq("id", item_id).execute()
            
            return current
        except Exception as e:
            print(f"Supabase UPDATE Error on {self.table_name}: {e}")
            return None

    def delete(self, item_id: str) -> bool:
        self._ensure_client()
        try:
            response = supabase.table(self.table_name).delete().eq("id", item_id).execute()
            # If data was returned, a row was deleted. In newer supabase-py versions it returns count.
            return True
        except Exception as e:
            print(f"Supabase DELETE Error on {self.table_name}: {e}")
            return False

    def write(self, data: List[Dict[str, Any]]):
        """Used internally for bulk overwrites (like clearing tables)"""
        self._ensure_client()
        try:
            # Clear all
            supabase.table(self.table_name).delete().neq("id", "0").execute()
            
            if data:
                records = [{"id": str(item["id"]), "data": item} for item in data]
                supabase.table(self.table_name).insert(records).execute()
        except Exception as e:
            print(f"Supabase WRITE Error on {self.table_name}: {e}")

    def delete_many(self, filter_column: str, filter_value: Any) -> int:
        """Deletes all records matching the filter and returns the count."""
        self._ensure_client()
        try:
            response = supabase.table(self.table_name).delete().eq(filter_column, filter_value).execute()
            # Newer supabase-py returns data in response.data (the deleted rows)
            return len(response.data) if response.data else 0
        except Exception as e:
            print(f"Supabase DELETE_MANY Error on {self.table_name}: {e}")
            return 0

    def clear_all(self):
        self.write([])

    # Deprecated local backup methods
    @staticmethod
    def snapshot():
        pass

    @staticmethod
    def restore():
        return True
