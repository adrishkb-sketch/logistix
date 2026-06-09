import sys
import os
from os.path import dirname, abspath

# Add backend to path
sys.path.append(dirname(dirname(abspath(__file__))))

from backend.database import JSONDatabase

def inspect():
    print("--- CONNECTING TO DB ---")
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    shipments_db = JSONDatabase("shipments")
    warehouses_db = JSONDatabase("warehouses")
    companies_db = JSONDatabase("companies")

    # Get companies
    companies = companies_db.get_all()
    print(f"\nCompanies ({len(companies)}):")
    for c in companies:
        print(f"  - ID: {c.get('id')}, Name: {c.get('name')}, Email: {c.get('email')}")

    # For the default/first company or all
    if not companies:
        print("No companies found!")
        return
        
    company_id = companies[0]['id'] # Default company
    # Wait, let's inspect the most recent shipments
    shipments = shipments_db.get_all()
    print(f"\nRecent Shipments ({len(shipments)}):")
    # Sort by timestamp or just show last 5
    for s in shipments[-10:]:
        print(f"  - ID: {s.get('id')}, Desc: {s.get('description') or s.get('title')}, Company: {s.get('company_id')}, Status: {s.get('status')}, Assigned Driver: {s.get('assigned_driver_id')}, Assigned Vehicle: {s.get('assigned_vehicle_id')}, Is Leg: {s.get('is_leg')}, Parent: {s.get('parent_id')}")
        if s.get('is_leg'):
            print(f"    Leg type: {s.get('leg_type')}, Pickup WH: {s.get('pickup_warehouse_id')}, Drop WH: {s.get('drop_warehouse_id')}")

    drivers = drivers_db.get_all()
    print(f"\nDrivers ({len(drivers)}):")
    for d in drivers:
        print(f"  - ID: {d.get('id')}, Name: {d.get('name')}, Status: {d.get('status')}, Fit: {d.get('is_fit')}, Company: {d.get('company_id')}, Vehicle: {d.get('assigned_vehicle_id')}, Base WH: {d.get('base_warehouse_id')}, License: {d.get('license_type')}")

    vehicles = vehicles_db.get_all()
    print(f"\nVehicles ({len(vehicles)}):")
    for v in vehicles:
        print(f"  - ID: {v.get('id')}, Plate: {v.get('number_plate')}, Type: {v.get('type')}, Status: {v.get('status')}, Company: {v.get('company_id')}, Driver: {v.get('assigned_driver_id')}, Base WH: {v.get('base_warehouse_id')}, Present WH: {v.get('present_warehouse_id') or v.get('current_warehouse_id')}")

if __name__ == "__main__":
    inspect()
