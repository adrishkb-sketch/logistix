"""
Sync local JSON seed data to Turso remote database.

By default, uses INSERT OR IGNORE to only add NEW records without
overwriting existing data that may have been updated at runtime
(e.g. verification_status, verification_image, wallet_balance).

Use --force flag to perform a full overwrite (INSERT OR REPLACE)
when you genuinely need to reset the remote database to local state.
"""
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
    force = "--force" in sys.argv
    
    if not _is_configured():
        print("Error: Turso environment variables are not set.")
        return
    
    mode = "INSERT OR REPLACE (FORCE OVERWRITE)" if force else "INSERT OR IGNORE (safe — new records only)"
    print(f"Starting database sync to Turso...")
    print(f"Mode: {mode}\n")
    
    if force:
        print("⚠️  WARNING: --force will OVERWRITE all existing records in Turso")
        print("   Any runtime changes (verification, images, etc.) will be LOST.")
        print("   Press Ctrl+C within 3 seconds to cancel...")
        import time
        time.sleep(3)
        print()
    
    sql_verb = "INSERT OR REPLACE" if force else "INSERT OR IGNORE"
    
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
        print(f"Processing table '{table_name}'...")
        try:
            # Force load local data (using force_local=True to bypass Turso routing inside JSONDatabase itself)
            db = JSONDatabase(table_name, force_local=True)
            items = db.get_all()
            print(f"  Loaded {len(items)} items from local database.")
            
            if not items:
                print(f"  No items to sync for '{table_name}'. Skipping.")
                continue
            
            if table_name == "companies":
                _ensure_companies_table()
                for item in items:
                    _execute([{
                        "sql": f"{sql_verb} INTO companies (id, name, email, password) VALUES (:id, :name, :email, :password)",
                        "args": {
                            "id": item.get("id"),
                            "name": item.get("name"),
                            "email": item.get("email"),
                            "password": item.get("password")
                        }
                    }])
            else:
                _ensure_generic_table(table_name)
                # Batch all inserts into a single pipeline request for speed
                stmts = []
                for item in items:
                    stmts.append({
                        "sql": f"{sql_verb} INTO {table_name} (id, data) VALUES (:id, :data)",
                        "args": {
                            "id": str(item.get("id", "")),
                            "data": json.dumps(item, ensure_ascii=False)
                        }
                    })
                if stmts:
                    _execute(stmts)
            print(f"  ✓ Table '{table_name}' synced ({len(items)} records).")
        except Exception as e:
            print(f"  ✗ Failed to sync table '{table_name}': {e}")

if __name__ == "__main__":
    main()
