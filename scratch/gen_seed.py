import uuid
import json
import random
from datetime import datetime, timedelta

COMPANY_ID = "557f9b08-30da-4b99-b233-a16c9df5191d"

warehouses = [
    {"name": "Mumbai Gateway Hub", "lat": 19.0760, "lng": 72.8777},
    {"name": "Delhi Northern Terminal", "lat": 28.6139, "lng": 77.2090},
    {"name": "Bangalore Silicon Warehouse", "lat": 12.9716, "lng": 77.5946},
    {"name": "Kolkata Eastern Port Hub", "lat": 22.5726, "lng": 88.3639},
    {"name": "Chennai Southern Express", "lat": 13.0827, "lng": 80.2707},
    {"name": "Hyderabad Central Hub", "lat": 17.3850, "lng": 78.4867},
    {"name": "Ahmedabad Western Depot", "lat": 23.0225, "lng": 72.5714},
    {"name": "Srinagar Alpine Station", "lat": 34.0837, "lng": 74.7973},
    {"name": "Bhubaneswar Kalinga Hub", "lat": 20.2961, "lng": 85.8245},
    {"name": "Guwahati North-East Gate", "lat": 26.1445, "lng": 91.7362},
    {"name": "Jaipur Desert Terminal", "lat": 26.9124, "lng": 75.7873},
    {"name": "Pune Tech Hub", "lat": 18.5204, "lng": 73.8567},
    {"name": "Lucknow Heritage Depot", "lat": 26.8467, "lng": 80.9462},
    {"name": "Indore Malwa Warehouse", "lat": 22.7196, "lng": 75.8577}
]

def generate_id():
    return str(uuid.uuid4())

sql_statements = []

# 1. Warehouses
wh_ids = []
for wh in warehouses:
    wh_id = generate_id()
    wh_ids.append(wh_id)
    wh_data = {
        "id": wh_id,
        "company_id": COMPANY_ID,
        "name": wh["name"],
        "lat": wh["lat"],
        "lng": wh["lng"],
        "contact_number": f"+91 {random.randint(70000, 99999)} {random.randint(10000, 99999)}",
        "drone_count": random.randint(2, 8)
    }
    dump = json.dumps(wh_data).replace("'", "''")
    sql_statements.append(f"INSERT INTO warehouses (id, data) VALUES ('{wh_id}', '{dump}');")

# 2. Drivers and Vehicles
v_types = [
    ("Large Truck", 15000, 70),
    ("Small Truck", 5000, 80),
    ("Delivery Van", 2000, 90),
    ("EV-Cargo", 500, 40),
    ("Bike/Scooty", 80, 50),
    ("Drone (Heavy)", 20, 100)
]

driver_names = [
    "Rahul Sharma", "Amit Singh", "Priya Patel", "Vikram Rathore", "Sanjay Gupta",
    "Anjali Verma", "Deepak Kumar", "Sunita Reddy", "Arjun Mehra", "Meera Nair",
    "Karthik S", "Pooja Hegde", "Rohan Joshi", "Sneha Rao", "Zaid Khan",
    "Gurpreet Singh", "Abhishek Das", "Manoj Tiwari", "Shiva K", "Lata M"
]

for i, name in enumerate(driver_names):
    d_id = generate_id()
    v_id = generate_id()
    v_type, cap, speed = random.choice(v_types)
    wh_id = random.choice(wh_ids)
    
    v_data = {
        "id": v_id,
        "company_id": COMPANY_ID,
        "type": v_type,
        "number_plate": f"IND-{random.randint(10, 99)}-{random.choice('ABCDEF')}{random.choice('GHIJKL')}-{random.randint(1000, 9999)}",
        "capacity": cap,
        "speed": speed,
        "status": "available",
        "base_warehouse_id": wh_id,
        "current_location": warehouses[wh_ids.index(wh_id)],
        "vehicle_health_score": random.randint(85, 100),
        "total_distance_km": random.randint(1000, 50000),
        "assigned_driver_id": d_id
    }
    
    d_data = {
        "id": d_id,
        "company_id": COMPANY_ID,
        "name": name,
        "login_id": f"driver_{i+100}",
        "password": "password123",
        "status": "available",
        "driving_score": random.randint(90, 100),
        "safety_rating": random.uniform(4.5, 5.0),
        "assigned_vehicle_id": v_id,
        "base_warehouse_id": wh_id,
        "verification_status": "verified"
    }
    
    v_dump = json.dumps(v_data).replace("'", "''")
    d_dump = json.dumps(d_data).replace("'", "''")
    sql_statements.append(f"INSERT INTO vehicles (id, data) VALUES ('{v_id}', '{v_dump}');")
    sql_statements.append(f"INSERT INTO drivers (id, data) VALUES ('{d_id}', '{d_dump}');")

# 3. Shipments
shipment_items = [
    ("Pharmaceutical Supplies", "Mumbai Gateway Hub", "Delhi Northern Terminal", 450, True),
    ("Fresh Seafood", "Chennai Southern Express", "Bangalore Silicon Warehouse", 120, True),
    ("Electronics Consignment", "Bangalore Silicon Warehouse", "Hyderabad Central Hub", 1200, False),
    ("Textile Bulk", "Ahmedabad Western Depot", "Kolkata Eastern Port Hub", 3500, False),
    ("Apples Batch", "Srinagar Alpine Station", "Mumbai Gateway Hub", 800, True),
    ("Industrial Steel", "Bhubaneswar Kalinga Hub", "Pune Tech Hub", 5000, False),
    ("Handicrafts", "Jaipur Desert Terminal", "Guwahati North-East Gate", 200, False)
]

for desc, p_name, d_name, weight, perish in shipment_items:
    s_id = generate_id()
    p_wh = next(w for w in warehouses if w["name"] == p_name)
    d_wh = next(w for w in warehouses if w["name"] == d_name)
    
    s_data = {
        "id": s_id,
        "company_id": COMPANY_ID,
        "description": desc,
        "weight": weight,
        "is_perishable": perish,
        "pickup": {"lat": p_wh["lat"], "lng": p_wh["lng"], "address": p_name},
        "drop": {"lat": d_wh["lat"], "lng": d_wh["lng"], "address": d_name},
        "status": "pending",
        "stage": "Awaiting Assignment",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "vitality": 100.0 if perish else 100,
        "labels": ["Urgent"] if perish else ["Standard"],
        "eway_bill_no": f"{random.randint(10000000, 99999999)}",
        "eway_bill_expiry": (datetime.utcnow() + timedelta(days=7)).isoformat() + "Z"
    }
    s_dump = json.dumps(s_data).replace("'", "''")
    sql_statements.append(f"INSERT INTO shipments (id, data) VALUES ('{s_id}', '{s_dump}');")

with open("seed_data.sql", "w") as f:
    f.write("\n".join(sql_statements))
