from backend.database import JSONDatabase
from backend.services.route_engine import decompose_shipment
from backend.routers.shipment import _generate_legs
from backend.services.assignment import auto_assign_shipment

def fix_existing():
    db = JSONDatabase("shipments")
    all_ships = db.get_all()

    # Find parent shipments that are pending and not legs
    pending_parents = [s for s in all_ships if not s.get("is_leg") and s.get("status") in ["pending"]]

    fixed_count = 0

    for s in pending_parents:
        try:
            legs_data = decompose_shipment(s)
            if legs_data:
                leg_ids = _generate_legs(s, legs_data)
                
                # Refresh parent shipment state
                updated_parent = db.get_by_id(s["id"])
                if updated_parent:
                    s.update(updated_parent)
                
                # Auto assign each leg
                for lid in leg_ids:
                    leg_s = db.get_by_id(lid)
                    if leg_s:
                        assigned = auto_assign_shipment(leg_s)
                        if assigned and "error" not in assigned:
                            leg_s["assigned_driver_id"] = assigned["assigned_driver_id"]
                            leg_s["assigned_vehicle_id"] = assigned["assigned_vehicle_id"]
                            leg_s["status"] = "assigned"
                            db.update(lid, leg_s)
                fixed_count += 1
                print(f"✅ Fixed (Split & Assigned): {s['id'][:8]}")
            else:
                # Direct Route Assignment
                assigned = auto_assign_shipment(s)
                if assigned and "error" not in assigned:
                    s["assigned_driver_id"] = assigned["assigned_driver_id"]
                    s["assigned_vehicle_id"] = assigned["assigned_vehicle_id"]
                    s["status"] = "assigned"
                    db.update(s["id"], s)
                    fixed_count += 1
                    print(f"✅ Fixed (Direct Assign): {s['id'][:8]}")
                else:
                    print(f"⚠️ Could not assign (No match): {s['id'][:8]}")
        except Exception as e:
            print(f"❌ Failed to fix {s['id'][:8]}: {e}")

    print(f"\nRetroactive fix completed. Fixed {fixed_count} existing shipments.")

if __name__ == "__main__":
    fix_existing()
