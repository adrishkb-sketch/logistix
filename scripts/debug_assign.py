import json
import os

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
company_id = "1cd1e383-5cba-45ee-b38d-c14b4a080a44"

with open(os.path.join(base_dir, 'data', 'drivers.json')) as f:
    drivers = json.load(f)
with open(os.path.join(base_dir, 'data', 'vehicles.json')) as f:
    vehicles = json.load(f)

unassigned_drivers = [d for d in drivers if d.get('company_id') == company_id and not d.get('assigned_vehicle_id')]
unassigned_vehicles = [v for v in vehicles if v.get('company_id') == company_id and v.get('status') == 'available' and not v.get('assigned_driver_id')]

print(f"Unassigned Drivers: {len(unassigned_drivers)}")
for d in unassigned_drivers[:10]:
    print(f" - Driver {d['name']} | Hub: {d.get('base_warehouse_id')} | License: {d.get('license_type')}")

print(f"\nUnassigned Vehicles: {len(unassigned_vehicles)}")
for v in unassigned_vehicles[:10]:
    print(f" - Vehicle {v['number_plate']} | Hub: {v.get('base_warehouse_id')} | Type: {v.get('type')}")
