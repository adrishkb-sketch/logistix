import uuid
import random
from backend.database import JSONDatabase
from backend.services.turso_db import TursoGenericDB

def seed_fleet():
    company_id = "1cd1e383-5cba-45ee-b38d-c14b4a080a44"
    wh_db = TursoGenericDB("warehouses")
    warehouses = wh_db.get_filtered({"company_id": company_id})
    
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    drones_db = JSONDatabase("drones")
    
    # Load existing to avoid clean wipe of other companies (but we'll keep them)
    all_drivers = drivers_db.get_all()
    all_vehicles = vehicles_db.get_all()
    all_drones = drones_db.get_all()
    
    # Let's count how many we add
    drivers_added = 0
    vehicles_added = 0
    drones_added = 0
    
    # License to vehicle type mapping
    types = [
        {"license": "Truck (Heavy)", "type": "Truck (Heavy)", "cap": 12000, "eff": 4},
        {"license": "Truck (Heavy)", "type": "Truck (Heavy)", "cap": 10000, "eff": 5},
        {"license": "Truck (Small)", "type": "Truck (Small)", "cap": 4000, "eff": 8},
        {"license": "Truck (Small)", "type": "Truck (Small)", "cap": 3000, "eff": 9},
        {"license": "Delivery Van", "type": "Delivery Van", "cap": 1500, "eff": 12},
        {"license": "Delivery Van", "type": "Delivery Van", "cap": 1200, "eff": 13},
        {"license": "Delivery Van", "type": "Delivery Van", "cap": 1000, "eff": 14},
        {"license": "Bike/Scooty", "type": "Bike/Scooty", "cap": 100, "eff": 45},
        {"license": "Bike/Scooty", "type": "Bike/Scooty", "cap": 80, "eff": 50},
        {"license": "EV-Cargo", "type": "EV-Cargo", "cap": 800, "eff": 35}
    ]
    
    first_names = ["Arjun", "Kabir", "Aarav", "Rahul", "Amit", "Vijay", "Rajesh", "Sanjay", "Suresh", "Vikram", "Anil", "Sunil", "Ramesh", "Deepak", "Sunita", "Preeti"]
    last_names = ["Sharma", "Verma", "Gupta", "Mehta", "Singh", "Kumar", "Patel", "Joshi", "Das", "Roy", "Sen", "Nair"]
    
    for wh in warehouses:
        wh_id = wh["id"]
        wh_name = wh["name"]
        print(f"Seeding fleet for Warehouse: {wh_name} ({wh_id})")
        
        # 1. Seed 10 Driver-Vehicle Pairs
        for i, config in enumerate(types):
            driver_id = str(uuid.uuid4())
            vehicle_id = str(uuid.uuid4())
            
            d_name = f"{random.choice(first_names)} {random.choice(last_names)}"
            login_id = f"drv_{wh_name.lower()}_{i}_{random.randint(100,999)}"
            plate = f"MH-12-{chr(random.randint(65,90))}{chr(random.randint(65,90))}-{random.randint(1000,9999)}"
            
            driver = {
                "id": driver_id,
                "system_id": f"DRV-{random.randint(1000,9999)}",
                "company_id": company_id,
                "name": d_name,
                "login_id": login_id,
                "password": "password123",
                "rating": round(random.uniform(4.2, 5.0), 1),
                "safety_rating": round(random.uniform(4.5, 5.0), 1),
                "fatigue_score": 0.0,
                "on_time_rate": round(random.uniform(92.0, 100.0), 1),
                "total_deliveries": random.randint(10, 150),
                "status": "available",
                "license_type": config["license"],
                "challan_count": random.choice([0, 0, 0, 1]),
                "driving_score": round(random.uniform(85.0, 100.0), 1),
                "assigned_vehicle_id": vehicle_id,
                "base_warehouse_id": wh_id,
                "verification_status": "verified",
                "join_date": "2026-01-01T00:00:00Z",
                "is_fit": True,
                "is_on_duty": True,
                "reward_points": float(random.randint(50, 500)),
                "years_experience": float(random.randint(1, 15)),
                "past_accidents": random.choice([0, 0, 0, 0, 1]),
                "traffic_violations": random.choice([0, 0, 0, 1])
            }
            
            vehicle = {
                "id": vehicle_id,
                "system_id": f"VEH-{random.randint(1000,9999)}",
                "company_id": company_id,
                "type": config["type"],
                "number_plate": plate,
                "speed": 60.0 if "Truck" in config["type"] else (50.0 if "Van" in config["type"] else 40.0),
                "capacity": float(config["cap"]),
                "fuel_efficiency": float(config["eff"]),
                "status": "available",
                "base_warehouse_id": wh_id,
                "last_known_location": {"lat": wh["lat"], "lng": wh["lng"]},
                "vehicle_health_score": round(random.uniform(85.0, 100.0), 1),
                "assigned_driver_id": driver_id,
                "is_operational": True,
                "current_warehouse_id": wh_id,
                "present_warehouse_id": wh_id
            }
            
            all_drivers.append(driver)
            all_vehicles.append(vehicle)
            drivers_added += 1
            vehicles_added += 1
            
        # 2. Seed 5 Drones
        for j in range(5):
            drone = {
                "id": str(uuid.uuid4()),
                "system_id": f"DRN-{random.randint(1000,9999)}",
                "company_id": company_id,
                "license_number": f"DRN-{wh_name.upper()}-{j}-{random.randint(100,999)}",
                "base_warehouse_id": wh_id,
                "capacity": float(random.choice([10.0, 12.0, 15.0])),
                "radius": float(random.choice([10.0, 15.0, 20.0])),
                "status": "available",
                "join_date": "2026-01-01T00:00:00Z"
            }
            all_drones.append(drone)
            drones_added += 1
            
    drivers_db.write(all_drivers)
    vehicles_db.write(all_vehicles)
    drones_db.write(all_drones)
    
    print(f"\nSuccessfully seeded: {drivers_added} drivers, {vehicles_added} vehicles, {drones_added} drones!")

if __name__ == "__main__":
    seed_fleet()
