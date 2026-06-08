import os
import sys
import random

# Add base_dir to path so we can import backend
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(base_dir)

from backend.database import JSONDatabase
from backend.services.water_check import is_location_in_water

COMPANY_ID = "1cd1e383-5cba-45ee-b38d-c14b4a080a44"
warehouses_db = JSONDatabase("warehouses")

def random_lat_lng():
    # Random location in India roughly
    lat = random.uniform(10.0, 28.0)
    lng = random.uniform(70.0, 85.0)
    return lat, lng

def main():
    warehouses = warehouses_db.get_filtered({"company_id": COMPANY_ID})
    print(f"Checking {len(warehouses)} warehouses for company {COMPANY_ID}...")
    
    fixed_count = 0
    for w in warehouses:
        # Check if the warehouse is in a water body
        if is_location_in_water(w['lat'], w['lng']):
            print(f"Warehouse '{w['name']}' (ID: {w['id']}) is in water ({w['lat']:.4f}, {w['lng']:.4f}). Relocating...")
            
            # Find a valid land location
            while True:
                new_lat, new_lng = random_lat_lng()
                if not is_location_in_water(new_lat, new_lng):
                    break
                    
            print(f"  Moved to ({new_lat:.4f}, {new_lng:.4f}).")
            # Update database
            warehouses_db.update(w['id'], {"lat": new_lat, "lng": new_lng})
            fixed_count += 1
            
    print(f"Finished checking. {fixed_count} warehouses relocated.")

if __name__ == '__main__':
    main()
