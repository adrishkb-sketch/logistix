import os
import sys
import json
from dotenv import load_dotenv

# Ensure we can import from project root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from backend.database import JSONDatabase
from backend.services.turso_db import _execute, _ensure_generic_table, _ensure_companies_table, _is_configured

def main():
    if not _is_configured():
        print("Error: Turso environment variables are not set.")
        return
        
    print("Starting database sync to Turso...")
    
    tables = [
        "companies",
        "warehouses",
        "drivers",
        "vehicles",
        "drones",
        "shipments",
        "receivers",
        "journey_reviews",
        "ledger",
        "weather_cells",
        "alerts",
        "warehouse_leave_requests",
        "fund_requests",
        "smart_contracts",
        "messages",
        "street_intel"
    ]
    
    for table_name in tables:
        print(f"\nProcessing table '{table_name}'...")
        try:
            # Force load local data (using force_local=True to bypass Turso routing inside JSONDatabase itself)
            db = JSONDatabase(table_name, force_local=True)
            items = db.get_all()
            print(f"Loaded {len(items)} items from local database.")
            
            if not items:
                print(f"No items to sync for '{table_name}'. Skipping.")
                continue
            
            if table_name == "companies":
                _ensure_companies_table()
                for item in items:
                    print(f"Upserting company: {item.get('name')}")
                    _execute([{
                        "sql": "INSERT OR REPLACE INTO companies (id, name, email, password) VALUES (:id, :name, :email, :password)",
                        "args": {
                            "id": item.get("id"),
                            "name": item.get("name"),
                            "email": item.get("email"),
                            "password": item.get("password")
                        }
                    }])
            else:
                _ensure_generic_table(table_name)
                for item in items:
                    print(f"Upserting {table_name} item: {item.get('id')}")
                    _execute([{
                        "sql": f"INSERT OR REPLACE INTO {table_name} (id, data) VALUES (:id, :data)",
                        "args": {
                            "id": str(item.get("id", "")),
                            "data": json.dumps(item, ensure_ascii=False)
                        }
                    }])
            print(f"Table '{table_name}' successfully synced.")
        except Exception as e:
            print(f"Failed to sync table '{table_name}': {e}")

if __name__ == "__main__":
    main()
