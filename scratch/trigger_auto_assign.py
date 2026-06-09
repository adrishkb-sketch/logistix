import sys
import os
from os.path import dirname, abspath

# Add backend to path
sys.path.append(dirname(dirname(abspath(__file__))))

from backend.database import JSONDatabase
from backend.services.assignment import auto_assign_shipment

def trigger():
    print("=== ASSIGNING xyz SHIPMENT LEGS IN TURSO ===")
    shipments_db = JSONDatabase("shipments")
    all_ships = shipments_db.get_all()
    
    parent_id = "0b998889-130a-481c-ace6-ecfa5cf32ff8"
    legs = [s for s in all_ships if s.get("parent_id") == parent_id]
    
    if not legs:
        print(f"No legs found for parent {parent_id}")
        return
        
    print(f"Found {len(legs)} legs. Assigning now...")
    for leg in legs:
        leg_id = leg["id"]
        print(f"Leg {leg_id} ({leg.get('leg_type')}): current status = {leg.get('status')}")
        assigned = auto_assign_shipment(leg)
        if assigned and "error" not in assigned:
            print(f"  Successfully assigned driver: {assigned['assigned_driver_id']}, vehicle: {assigned['assigned_vehicle_id']}")
            # Update leg in DB
            leg["assigned_driver_id"] = assigned["assigned_driver_id"]
            leg["assigned_vehicle_id"] = assigned["assigned_vehicle_id"]
            leg["status"] = "assigned"
            leg["stage"] = assigned["stage"]
            leg["finance"] = assigned["finance"]
            shipments_db.update(leg_id, leg)
            print(f"  Leg {leg_id} updated in Turso.")
        else:
            print(f"  Failed to assign leg {leg_id}: {assigned.get('error') if assigned else 'None'}")

if __name__ == "__main__":
    trigger()
