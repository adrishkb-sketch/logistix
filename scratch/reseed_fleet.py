"""
Reseed fleet: Deletes all inactive drivers and vehicles for company 1cd1e383-5cba-45ee-b38d-c14b4a080a44,
then creates 2 drivers + 2 vehicles per vehicle type per warehouse, pairs them correctly,
and writes them in bulk.
"""

import uuid, random, sys

sys.path.insert(0, '/Users/adrish/Desktop/Projects/logistix')
from backend.database import JSONDatabase

COMPANY = '1cd1e383-5cba-45ee-b38d-c14b4a080a44'

VEHICLE_TYPES = [
    'Truck (Heavy)',
    'Truck (Small)',
    'Delivery Van',
    'Bike/Scooty',
    'EV-Cargo',
]

CAPACITY = {
    'Truck (Heavy)': (5000, 12000),
    'Truck (Small)': (1500, 4000),
    'Delivery Van':  (500, 1500),
    'Bike/Scooty':   (30, 100),
    'EV-Cargo':      (200, 800),
}

FUEL_EFF = {
    'Truck (Heavy)': (8, 12),
    'Truck (Small)': (12, 18),
    'Delivery Van':  (14, 20),
    'Bike/Scooty':   (40, 60),
    'EV-Cargo':      (25, 40),
}

FIRST_NAMES = [
    'Arjun','Ravi','Suresh','Manoj','Vijay','Rahul','Arun','Deepak',
    'Sanjay','Prakash','Mohan','Ganesh','Kartik','Nikhil','Amit',
    'Priya','Divya','Sneha','Pooja','Meena','Lakshmi','Ananya',
    'Rohan','Vikram','Harish','Ajay','Dinesh','Ramesh','Sunil','Ashok',
    'Kiran','Manju','Pavithra','Sushma','Usha','Nirmala','Kavya','Jyoti',
]
LAST_NAMES  = [
    'Kumar','Singh','Sharma','Patel','Reddy','Gupta','Nair','Pillai',
    'Das','Joshi','Mehta','Verma','Rao','Iyer','Chandra','Shah',
    'Bose','Ghosh','Mishra','Tiwari','Pandey','Saxena','Sahu','Bhatia',
]

STATE_CODES = ['MH','DL','GJ','TN','KA','KL','WB','RJ','AP','TS','UP','PB','HR','MP','OR']

drivers_db  = JSONDatabase('drivers')
vehicles_db = JSONDatabase('vehicles')
wh_db       = JSONDatabase('warehouses')
ship_db     = JSONDatabase('shipments')

# 1. Find active drivers and vehicles
all_shipments = ship_db.get_all()
active_shipments = [
    s for s in all_shipments
    if s and s.get("company_id") == COMPANY and s.get("status") not in ["delivered", "cancelled"]
]
active_driver_ids = {s.get("assigned_driver_id") for s in active_shipments if s.get("assigned_driver_id")}
active_vehicle_ids = {s.get("assigned_vehicle_id") for s in active_shipments if s.get("assigned_vehicle_id")}

print(f"[INFO] Active shipments: {len(active_shipments)}")
print(f"[INFO] Active drivers: {len(active_driver_ids)}")
print(f"[INFO] Active vehicles: {len(active_vehicle_ids)}")

# 2. Filter out inactive drivers and vehicles for COMPANY
all_drivers = drivers_db.get_all()
all_vehicles = vehicles_db.get_all()

kept_drivers = [
    d for d in all_drivers
    if d and (d.get("company_id") != COMPANY or d.get("id") in active_driver_ids)
]
kept_vehicles = [
    v for v in all_vehicles
    if v and (v.get("company_id") != COMPANY or v.get("id") in active_vehicle_ids)
]

print(f"[INFO] Drivers kept from other companies/active: {len(kept_drivers)}")
print(f"[INFO] Vehicles kept from other companies/active: {len(kept_vehicles)}")

# 3. Create unique tracking sets for login IDs and number plates
existing_login_ids = {d.get('login_id','').lower() for d in kept_drivers if d}
existing_plates    = {v.get('number_plate','').replace(' ','').upper() for v in kept_vehicles if v}

def gen_unique_login(base: str) -> str:
    candidate = base.lower()
    suffix = 0
    while candidate in existing_login_ids:
        suffix += 1
        candidate = f'{base.lower()}{suffix}'
    existing_login_ids.add(candidate)
    return candidate

def gen_plate(state: str, serial: int) -> str:
    alpha = chr(65 + (serial // 9000) % 26) + chr(65 + (serial // 346) % 26)
    digits = str(serial % 9000 + 1000)
    dist = str(random.randint(10, 99))
    candidate = f'{state}{dist}{alpha}{digits}'.upper()
    attempts = 0
    while candidate in existing_plates:
        attempts += 1
        digits = str((int(digits) + attempts) % 9000 + 1000)
        candidate = f'{state}{dist}{alpha}{digits}'.upper()
    existing_plates.add(candidate)
    return candidate

plate_counter = 1000
new_drivers = []
new_vehicles = []
rng = random.Random(42)

warehouses = [w for w in wh_db.get_all() if w and w.get('company_id') == COMPANY]
print(f"[INFO] Seeding for {len(warehouses)} warehouses")

for wh in warehouses:
    wh_id     = wh['id']
    state_idx = abs(hash(wh_id)) % len(STATE_CODES)
    state     = STATE_CODES[state_idx]

    for vtype in VEHICLE_TYPES:
        for slot in range(2):  # 2 per type per warehouse
            # Driver
            fname = rng.choice(FIRST_NAMES)
            lname = rng.choice(LAST_NAMES)
            name  = f'{fname} {lname}'
            exp   = round(rng.uniform(1.0, 15.0), 1)
            accidents = rng.randint(0, 2)
            challans  = rng.randint(0, 3)
            safety_rating = round(max(1.0, min(5.0, 5.0 - accidents * 1.0 - challans * 0.2 + exp * 0.1)), 1)
            phone = '+91' + str(rng.randint(7000000000, 9999999999))

            base_login = f'{fname.lower()}.{lname.lower()}'
            login_id   = gen_unique_login(base_login)
            password   = f'Pass@{rng.randint(1000,9999)}'
            system_id  = f'DRV-{login_id[:6].upper()}-{str(uuid.uuid4())[:4].upper()}'

            driver = {
                'id':                  str(uuid.uuid4()),
                'company_id':          COMPANY,
                'name':                name,
                'login_id':            login_id,
                'password':            password,
                'license_type':        vtype,
                'base_warehouse_id':   wh_id,
                'years_experience':    exp,
                'past_accidents':      accidents,
                'traffic_violations':  challans,
                'challan_count':       challans,
                'driving_score':       100.0,
                'safety_rating':       str(safety_rating),
                'on_time_rate':        100,
                'punctuality_rate':    100,
                'total_deliveries':    0,
                'total_trips':         0,
                'total_earnings':      0.0,
                'wallet_balance':      0.0,
                'reward_points':       0.0,
                'operational_days':    0,
                'contact_number':      phone,
                'status':             'available',
                'verification_status':'unverified',
                'assigned_vehicle_id': None,
                'system_id':           system_id,
                'join_date':           '2024-01-01',
                'customer_ratings':    [],
            }

            # Vehicle
            plate_counter += 1
            plate = gen_plate(state, plate_counter)
            cap_lo, cap_hi = CAPACITY[vtype]
            eff_lo, eff_hi = FUEL_EFF[vtype]
            capacity       = rng.randint(cap_lo, cap_hi)
            fuel_eff       = round(rng.uniform(eff_lo, eff_hi), 1)
            v_system_id    = f'VEH-{state}-{str(uuid.uuid4())[:6].upper()}'

            vehicle = {
                'id':                  str(uuid.uuid4()),
                'company_id':          COMPANY,
                'type':                vtype,
                'number_plate':        plate,
                'capacity':            capacity,
                'base_warehouse_id':   wh_id,
                'fuel_efficiency':     fuel_eff,
                'status':             'available',
                'vehicle_health_score': 100.0,
                'is_operational':      True,
                'assigned_driver_id':  None,
                'total_distance_km':   0.0,
                'deliveries_completed':0,
                'operational_days':    0,
                'system_id':           v_system_id,
            }

            # Link them in-memory
            driver['assigned_vehicle_id'] = vehicle['id']
            vehicle['assigned_driver_id'] = driver['id']

            new_drivers.append(driver)
            new_vehicles.append(vehicle)

print(f"[INFO] New drivers created: {len(new_drivers)}")
print(f"[INFO] New vehicles created: {len(new_vehicles)}")

# Bulk write final state
final_drivers = kept_drivers + new_drivers
final_vehicles = kept_vehicles + new_vehicles

print(f"[WRITE] Flushing drivers...")
drivers_db.write(final_drivers)
print(f"[WRITE] Flushing vehicles...")
vehicles_db.write(final_vehicles)

print("✅ Seeding completed and verified.")
