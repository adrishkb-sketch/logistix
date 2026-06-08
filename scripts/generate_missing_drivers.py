import os
import sys
import random

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(base_dir)

from backend.database import JSONDatabase
from backend.models import Driver

COMPANY_ID = "1cd1e383-5cba-45ee-b38d-c14b4a080a44"

drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")

first_names = ["Rahul", "Amit", "Priya", "Neha", "Vikas", "Suresh", "Ramesh", "Anjali", "Pooja", "Vikram", "Sanjay", "Karan", "Sunil", "Ravi", "Manoj"]
last_names = ["Sharma", "Patel", "Singh", "Kumar", "Gupta", "Desai", "Jain", "Reddy", "Mehta", "Bose", "Chauhan", "Verma"]

def main():
    all_vehicles = vehicles_db.get_filtered({"company_id": COMPANY_ID})
    
    # Get all unassigned vehicles that are available
    unassigned_vehicles = [v for v in all_vehicles if not v.get("assigned_driver_id") and v.get("status") == "available"]
    
    print(f"Found {len(unassigned_vehicles)} unassigned and available vehicles.")
    if not unassigned_vehicles:
        print("Nothing to do.")
        return
        
    new_drivers = []
    for v in unassigned_vehicles:
        d_first = random.choice(first_names)
        d_last = random.choice(last_names)
        base_hub = v.get("base_warehouse_id")
        veh_type = v.get("type", "Truck (Heavy)")
        
        drv = Driver(
            company_id=COMPANY_ID,
            name=f"{d_first} {d_last}",
            login_id=f"drv_{base_hub[:4]}_{random.randint(1000,9999)}",
            password="password123",
            base_warehouse_id=base_hub,
            current_warehouse_id=base_hub,
            license_type=veh_type,
            contact_number=f"+91{random.randint(7000000000, 9999999999)}",
            assigned_vehicle_id=None,
            status="available"
        )
        new_drivers.append(drv.model_dump())
        
    print(f"Generating {len(new_drivers)} matching drivers...")
    
    # Use the optimized write logic to save all drivers including the new ones
    all_drivers = drivers_db.get_all()
    all_drivers.extend(new_drivers)
    drivers_db.write(all_drivers)
        
    print(f"Successfully added {len(new_drivers)} drivers to the database!")

if __name__ == "__main__":
    main()
