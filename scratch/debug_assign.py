import sys
from os.path import dirname, abspath
# Add backend to path
sys.path.append(dirname(dirname(abspath(__file__))))

from backend.database import JSONDatabase
from backend.services.assignment import auto_assign_shipment

# Get the shipment
ships_db = JSONDatabase("shipments")
# Find a leg of shipment a748a019
all_ships = ships_db.get_all()
legs = [s for s in all_ships if s.get("parent_id") == "a748a019-2e15-4662-9c75-4ef851704f96" or s.get("id").startswith("a748a019")]
if not legs:
    # Look for any parent shipment leg
    legs = [s for s in all_ships if s.get("is_leg")]

print(f"Found {len(legs)} legs to test.")
for leg in legs:
    print(f"\n--- Testing Leg {leg.get('id')} ({leg.get('leg_type')}) ---")
    res = auto_assign_shipment(leg)
    print("Result:", res)
