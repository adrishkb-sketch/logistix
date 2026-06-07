"""
Export current Turso remote database state back to local data/*.json files.

Run this before git push to ensure your local seed files reflect the
live database state (including verification images, updated statuses, etc.).

Usage:
    python3 scratch/export_turso_data.py              # export all tables
    python3 scratch/export_turso_data.py drivers       # export only drivers
    python3 scratch/export_turso_data.py drivers vehicles  # export specific tables
"""
import os
import sys
import json
from dotenv import load_dotenv

# Ensure we can import from project root
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(project_root)

load_dotenv()

from backend.services.turso_db import _execute, _is_configured, _result_to_dicts

ALL_TABLES = [
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

def export_table(table_name: str, data_dir: str) -> int:
    """Export a single table from Turso to local JSON. Returns record count."""
    try:
        results = _execute([{"sql": f"SELECT data FROM {table_name}"}])
        rows = _result_to_dicts(results[0]) if results else []
        items = []
        for row in rows:
            try:
                items.append(json.loads(row.get("data", "{}")))
            except Exception:
                pass
        
        file_path = os.path.join(data_dir, f"{table_name}.json")
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=4, ensure_ascii=False)
        
        return len(items)
    except Exception as e:
        print(f"  ✗ Error exporting '{table_name}': {e}")
        return -1

def export_companies(data_dir: str) -> int:
    """Export companies table (structured, not JSON blob)."""
    try:
        results = _execute([{"sql": "SELECT id, name, email, password FROM companies"}])
        items = _result_to_dicts(results[0]) if results else []
        
        file_path = os.path.join(data_dir, "companies.json")
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=4, ensure_ascii=False)
        
        return len(items)
    except Exception as e:
        print(f"  ✗ Error exporting 'companies': {e}")
        return -1

def main():
    if not _is_configured():
        print("Error: Turso environment variables are not set.")
        print("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your .env file.")
        return
    
    data_dir = os.path.join(project_root, "data")
    os.makedirs(data_dir, exist_ok=True)
    
    # Determine which tables to export
    requested = sys.argv[1:] if len(sys.argv) > 1 else None
    
    if requested:
        tables = [t for t in requested if t in ALL_TABLES or t == "companies"]
        if not tables:
            print(f"Error: No valid tables specified. Available: companies, {', '.join(ALL_TABLES)}")
            return
    else:
        tables = ["companies"] + ALL_TABLES
    
    print(f"Exporting {len(tables)} table(s) from Turso → data/\n")
    
    total_records = 0
    for table_name in tables:
        if table_name == "companies":
            count = export_companies(data_dir)
        else:
            count = export_table(table_name, data_dir)
        
        if count >= 0:
            print(f"  ✓ {table_name}: {count} records → data/{table_name}.json")
            total_records += count
        else:
            print(f"  ✗ {table_name}: export failed")
    
    print(f"\nDone. Exported {total_records} total records.")
    print("You can now commit data/*.json and push to keep seed files in sync with Turso.")

if __name__ == "__main__":
    main()
