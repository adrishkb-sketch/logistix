"""Diagnostic: check current driver data in Turso remote database."""
import sys, os, json
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from dotenv import load_dotenv
load_dotenv()

from backend.services.turso_db import _execute, _is_configured

if not _is_configured():
    print("ERROR: Turso not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.")
    sys.exit(1)

print("=== TURSO REMOTE DATABASE DIAGNOSTICS ===\n")

# 1. Check driver count
results = _execute([{"sql": "SELECT COUNT(*) as cnt FROM drivers"}])
rows = results[0].get("rows", [])
count = int(rows[0][0]["value"] if isinstance(rows[0][0], dict) else rows[0][0])
print(f"Total drivers in Turso: {count}")

# 2. Check verification statuses
results = _execute([{"sql": "SELECT data FROM drivers"}])
rows = results[0].get("rows", [])
drivers = []
for row in rows:
    cell = row[0]
    raw = cell["value"] if isinstance(cell, dict) else cell
    drivers.append(json.loads(raw))

verified = [d for d in drivers if d.get("verification_status") == "verified"]
unverified = [d for d in drivers if d.get("verification_status") == "unverified"]
pending = [d for d in drivers if d.get("verification_status") == "pending_manual"]
missing = [d for d in drivers if not d.get("verification_status")]

print(f"\nVerification Status Breakdown:")
print(f"  verified:       {len(verified)}")
print(f"  unverified:     {len(unverified)}")
print(f"  pending_manual: {len(pending)}")
print(f"  no status:      {len(missing)}")

print(f"\nDrivers with verification_image set: {sum(1 for d in drivers if d.get('verification_image'))}")
print(f"Drivers WITHOUT verification_image:  {sum(1 for d in drivers if not d.get('verification_image'))}")

# 3. Show first 5 drivers
print("\n--- Sample Drivers (first 5) ---")
for d in drivers[:5]:
    print(f"  {d.get('name', 'UNNAMED')}: "
          f"status={d.get('verification_status', 'MISSING')}, "
          f"vehicle={d.get('assigned_vehicle_id', 'None')[:8] if d.get('assigned_vehicle_id') else 'None'}, "
          f"has_image={'Yes' if d.get('verification_image') else 'No'}")

# 4. Compare with local JSON
print("\n--- Comparison with Local data/drivers.json ---")
local_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "drivers.json")
if os.path.exists(local_path):
    with open(local_path) as f:
        local_drivers = json.load(f)
    print(f"Local drivers count: {len(local_drivers)}")
    
    # Check for ID mismatches
    turso_ids = {d["id"] for d in drivers}
    local_ids = {d["id"] for d in local_drivers}
    only_turso = turso_ids - local_ids
    only_local = local_ids - turso_ids
    if only_turso:
        print(f"  IDs only in Turso (not local): {len(only_turso)}")
    if only_local:
        print(f"  IDs only in local (not Turso): {len(only_local)}")
    
    # Check for field differences
    for ld in local_drivers[:3]:
        td = next((d for d in drivers if d["id"] == ld["id"]), None)
        if td:
            diffs = {k: (ld.get(k), td.get(k)) for k in set(list(ld.keys()) + list(td.keys())) if ld.get(k) != td.get(k)}
            if diffs:
                print(f"\n  Diff for {ld.get('name', ld['id'][:8])}:")
                for k, (lv, tv) in diffs.items():
                    lv_str = str(lv)[:50] if lv else 'None'
                    tv_str = str(tv)[:50] if tv else 'None'
                    print(f"    {k}: local={lv_str} | turso={tv_str}")
else:
    print("Local drivers.json not found!")
