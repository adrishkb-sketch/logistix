import os
import sys
import random
import uuid

# Add base_dir to path so we can import backend
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(base_dir)

from backend.database import JSONDatabase
from backend.models import Warehouse, Driver, Vehicle, Drone

COMPANY_ID = "1cd1e383-5cba-45ee-b38d-c14b4a080a44"

# Databases
warehouses_db = JSONDatabase("warehouses")
drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")
drones_db = JSONDatabase("drones")

cities = ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Surat"]

first_names = ["Rahul", "Amit", "Priya", "Neha", "Vikas", "Suresh", "Ramesh", "Anjali", "Pooja", "Vikram", "Sanjay", "Karan", "Sunil", "Ravi", "Manoj"]
last_names = ["Sharma", "Patel", "Singh", "Kumar", "Gupta", "Desai", "Jain", "Reddy", "Mehta", "Bose", "Chauhan", "Verma"]

def random_lat_lng():
    # Random location in India roughly
    lat = random.uniform(10.0, 28.0)
    lng = random.uniform(70.0, 85.0)
    return lat, lng

def generate_number_plate():
    state = random.choice(["MH", "DL", "KA", "TN", "TS", "GJ", "UP", "HR"])
    num1 = random.randint(10, 99)
    char1 = random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    char2 = random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    num2 = random.randint(1000, 9999)
    return f"{state}-{num1}-{char1}{char2}-{num2}"

def main():
    print("Starting data generation...")
    num_warehouses = random.randint(40, 50)
    
    for i in range(num_warehouses):
        city = random.choice(cities)
        lat, lng = random_lat_lng()
        manager_first = random.choice(first_names)
        manager_last = random.choice(last_names)
        manager_name = f"{manager_first} {manager_last}"
        warehouse_name = f"{city} Hub {i+1}-{random.randint(100, 999)}"
        email = f"manager{i}_{random.randint(1000,9999)}@logistix.com"
        
        w = Warehouse(
            company_id=COMPANY_ID,
            name=warehouse_name,
            lat=lat,
            lng=lng,
            contact_number=f"+91{random.randint(7000000000, 9999999999)}",
            manager_name=manager_name,
            manager_email=email,
            manager_password="password123",
            drone_count=0
        )
        w_dict = w.model_dump()
        warehouses_db.insert(w_dict)
        print(f"Created warehouse: {warehouse_name} (ID: {w.id})")
        
        # Drivers (5 to 15 per warehouse)
        num_drivers = random.randint(5, 15)
        for d in range(num_drivers):
            d_first = random.choice(first_names)
            d_last = random.choice(last_names)
            drv = Driver(
                company_id=COMPANY_ID,
                name=f"{d_first} {d_last}",
                login_id=f"drv_{w.id[:4]}_{d}_{random.randint(100,999)}",
                password="password123",
                base_warehouse_id=w.id,
                current_warehouse_id=w.id,
                license_type=random.choice(["bike", "van", "truck"])
            )
            drivers_db.insert(drv.model_dump())
            
        # Vehicles (5 to 15 per warehouse)
        num_vehicles = random.randint(5, 15)
        for v in range(num_vehicles):
            veh = Vehicle(
                company_id=COMPANY_ID,
                type=random.choice(["bike", "van", "truck"]),
                number_plate=generate_number_plate(),
                base_warehouse_id=w.id,
                current_warehouse_id=w.id,
                present_warehouse_id=w.id
            )
            vehicles_db.insert(veh.model_dump())
            
        # Drones (2 to 5 per warehouse)
        num_drones = random.randint(2, 5)
        for dr in range(num_drones):
            drone = Drone(
                company_id=COMPANY_ID,
                license_number=f"DRN-{random.randint(10000,99999)}",
                base_warehouse_id=w.id,
                capacity=random.uniform(5.0, 20.0),
                radius=random.uniform(10.0, 50.0)
            )
            drones_db.insert(drone.model_dump())
            
    print(f"Successfully generated {num_warehouses} warehouses and their assets.")

if __name__ == '__main__':
    main()
