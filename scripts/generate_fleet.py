import os
import sys
import random

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(base_dir)

from backend.database import JSONDatabase
from backend.models import Driver, Vehicle

COMPANY_ID = "1cd1e383-5cba-45ee-b38d-c14b4a080a44"

warehouses_db = JSONDatabase("warehouses")
drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")

first_names = ["Rahul", "Amit", "Priya", "Neha", "Vikas", "Suresh", "Ramesh", "Anjali", "Pooja", "Vikram", "Sanjay", "Karan", "Sunil", "Ravi", "Manoj"]
last_names = ["Sharma", "Patel", "Singh", "Kumar", "Gupta", "Desai", "Jain", "Reddy", "Mehta", "Bose", "Chauhan", "Verma"]
vehicle_types = ["Bike/Scooty", "Delivery Van", "Truck (Small)", "Truck (Heavy)", "ev_cargo"]
license_types = ["bike", "delivery van", "Truck (Small)", "Truck (Heavy)", "ev-cargo"]

def generate_number_plate():
    state = random.choice(["MH", "DL", "KA", "TN", "TS", "GJ", "UP", "HR"])
    num1 = random.randint(10, 99)
    char1 = random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    char2 = random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    num2 = random.randint(1000, 9999)
    return f"{state}-{num1}-{char1}{char2}-{num2}"

def main():
    warehouses = warehouses_db.get_filtered({"company_id": COMPANY_ID})
    print(f"Found {len(warehouses)} warehouses for company {COMPANY_ID}.")
    
    if not warehouses:
        print("No warehouses found. Exiting.")
        return

    new_vehicles = []
    new_drivers = []
    
    for w in warehouses:
        num_pairs = random.randint(5, 12)
        
        for i in range(num_pairs):
            # Select compatible types
            idx = random.randint(0, len(vehicle_types) - 1)
            v_type = vehicle_types[idx]
            d_type = license_types[idx]
            
            # Generate Vehicle
            veh = Vehicle(
                company_id=COMPANY_ID,
                type=v_type,
                number_plate=generate_number_plate(),
                base_warehouse_id=w.get("id"),
                current_warehouse_id=w.get("id"),
                present_warehouse_id=w.get("id"),
                status="available",
                assigned_driver_id=None
            )
            new_vehicles.append(veh.model_dump())
            
            # Generate Matching Driver
            d_first = random.choice(first_names)
            d_last = random.choice(last_names)
            drv = Driver(
                company_id=COMPANY_ID,
                name=f"{d_first} {d_last}",
                login_id=f"drv_{w.get('id')[:4]}_{random.randint(1000,9999)}",
                password="password123",
                base_warehouse_id=w.get("id"),
                current_warehouse_id=w.get("id"),
                license_type=d_type,
                contact_number=f"+91{random.randint(7000000000, 9999999999)}",
                assigned_vehicle_id=None,
                status="available",
                verification_status="unverified"
            )
            new_drivers.append(drv.model_dump())

    print(f"Generated {len(new_vehicles)} new vehicles and {len(new_drivers)} new drivers.")
    
    all_vehicles = vehicles_db.get_all()
    all_vehicles.extend(new_vehicles)
    vehicles_db.write(all_vehicles)
    print("Vehicles saved successfully.")
    
    all_drivers = drivers_db.get_all()
    all_drivers.extend(new_drivers)
    drivers_db.write(all_drivers)
    print("Drivers saved successfully.")

if __name__ == "__main__":
    main()
