import os
import sys

sys.path.insert(0, '/Users/adrish/Desktop/Projects/logistix')
from backend.database import JSONDatabase

drivers_db = JSONDatabase('drivers')
all_drivers = drivers_db.get_all()

target_names = [
    "Ashok Kumar", "Harish Gupta", "Sneha Pandey", "Prakash Ghosh", 
    "Amit Rao", "Harish Mehta", "Dinesh Das", "Rohan Verma", 
    "Manju Nair", "Suresh Pillai"
]

for d in all_drivers:
    if d.get('name') in target_names:
        print(f"Name: {d.get('name')}, company_id: {d.get('company_id')}, profile_pic: {d.get('profile_pic')!r}")
