import sys
from os.path import dirname, abspath
# Add backend to path
sys.path.append(dirname(dirname(abspath(__file__))))

from backend.database import JSONDatabase
from backend.services.assignment import auto_assign_shipment

# Get the shipment
ships_db = JSONDatabase("shipments")
# Find legs of shipment 0b998889
all_ships = ships_db.get_all()
legs = [s for s in all_ships if s.get("parent_id") == "0b998889-130a-481c-ace6-ecfa5cf32ff8"]

print(f"Found {len(legs)} legs to test.")
for leg in legs:
    print(f"\n--- Testing Leg {leg.get('id')} ({leg.get('leg_type')}) ---")
    res = auto_assign_shipment(leg)
    print("Result:", res)

