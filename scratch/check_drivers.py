import os
import sys
import json

sys.path.insert(0, '/Users/adrish/Desktop/Projects/logistix')
from backend.database import JSONDatabase

drivers_db = JSONDatabase('drivers')
all_drivers = drivers_db.get_all()

print(f"Total drivers in DB: {len(all_drivers)}")

# Let's group by company_id
companies = {}
for d in all_drivers:
    cid = d.get('company_id')
    companies.setdefault(cid, []).append(d)

for cid, ds in companies.items():
    print(f"\nCompany: {cid} has {len(ds)} drivers")
    # print first 3 and last 3
    print("First 3 drivers:")
    for d in ds[:3]:
        print(f"  ID: {d.get('id')}, Name: {d.get('name')}, ProfilePic: {d.get('profile_pic')}")
    print("Last 3 drivers:")
    for d in ds[-3:]:
        print(f"  ID: {d.get('id')}, Name: {d.get('name')}, ProfilePic: {d.get('profile_pic')}")
