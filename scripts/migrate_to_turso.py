import os
import sys
import time

# Ensure backend module is in path
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, base_dir)

from backend.database import JSONDatabase

# Explicitly load .env
from dotenv import load_dotenv
load_dotenv(os.path.join(base_dir, ".env"))

def verify_turso_env():
    url = os.environ.get("TURSO_DATABASE_URL", "").strip()
    token = os.environ.get("TURSO_AUTH_TOKEN", "").strip()
    if not url or not token:
        print("❌ ERROR: TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is missing in .env file.")
        print("Please add them and run again.")
        sys.exit(1)
    print(f"✅ Found Turso Config: {url}")
    return url

def migrate_table(table_name: str):
    print(f"\n📦 Migrating table: '{table_name}'...")
    
    # 1. Read from local SQLite using standard sqlite3 to avoid ORM transaction issues
    import sqlite3
    import json
    db_path = os.path.join(base_dir, "data", "logistix_local.db")
    local_data = []
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            if table_name == "companies":
                cursor.execute(f"SELECT id, name, email, password FROM {table_name}")
                rows = cursor.fetchall()
                for row in rows:
                    local_data.append({
                        "id": row[0],
                        "name": row[1],
                        "email": row[2],
                        "password": row[3]
                    })
            else:
                cursor.execute(f"SELECT data FROM {table_name}")
                rows = cursor.fetchall()
                for row in rows:
                    try:
                        local_data.append(json.loads(row[0]))
                    except Exception:
                        pass
            conn.close()
        except Exception as e:
            print(f"   ⚠️ Could not read {table_name} locally: {e}")
    
    if not local_data:
        print(f"   ⚠️ No data found locally for '{table_name}'. Skipping.")
        return
        
    print(f"   📥 Extracted {len(local_data)} records from local database.")
    
    # 2. Connect to live Turso (uses env vars automatically)
    live_db = JSONDatabase(table_name)
    
    if not live_db.use_turso:
        print("   ❌ ERROR: Failed to instantiate Turso connection. Check your env vars.")
        sys.exit(1)
        
    # 3. Push to Turso
    print("   🚀 Pushing to Turso Edge Cloud...")
    try:
        live_db.write(local_data)
        print(f"   ✅ Successfully migrated {len(local_data)} records for '{table_name}'.")
    except Exception as e:
        print(f"   ❌ FAILED to write '{table_name}' to Turso: {e}")

def main():
    print("==================================================")
    print("🚀 ENTERPRISE DATA PUMP: SQLite -> Turso Edge")
    print("==================================================")
    
    verify_turso_env()
    
    tables_to_migrate = [
        "companies",
        "warehouses",
        "drivers",
        "vehicles",
        "shipments"
    ]
    
    for table in tables_to_migrate:
        migrate_table(table)
        time.sleep(1) # Small delay to prevent rate limits
        
    print("\n🎉 MIGRATION COMPLETE! Your data is now live in the cloud.")
    print("==================================================")

if __name__ == "__main__":
    main()
