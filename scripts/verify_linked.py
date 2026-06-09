import json
import os

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
company_id = "1cd1e383-5cba-45ee-b38d-c14b4a080a44"

drivers_path = os.path.join(base_dir, 'data', 'drivers.json')
with open(drivers_path, 'r', encoding='utf-8') as f:
    drivers = json.load(f)

updated_count = 0
for d in drivers:
    if d.get('company_id') == company_id and d.get('assigned_vehicle_id'):
        d['verification_status'] = 'verified'
        if 'verification_message' in d:
            del d['verification_message']
        updated_count += 1

with open(drivers_path, 'w', encoding='utf-8') as f:
    json.dump(drivers, f, indent=4, ensure_ascii=False)

print(f"Verified {updated_count} linked drivers for company {company_id}.")
