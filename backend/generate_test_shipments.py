import sys
import os
import random
import uuid
from datetime import datetime, timedelta

# Add root dir to path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)
sys.path.append(current_dir)

from database import JSONDatabase
from models import Shipment

shipments_db = JSONDatabase("shipments")

COMPANY_ID = "1cd1e383-5cba-45ee-b38d-c14b4a080a44"
EMAILS = ["nidhipasi178@gmail.com", "adrishkumarbanerjee@gmail.com"]
LABELS_POOL = ["fragile", "urgent", "heavy", "electronics", "medical", "documents", "clothing", "food", "hazardous", "liquid"]

def generate_random_shipment():
    pickup_lat = random.uniform(18.0, 20.0)
    pickup_lng = random.uniform(72.0, 74.0)
    drop_lat = random.uniform(18.0, 20.0)
    drop_lng = random.uniform(72.0, 74.0)
    
    is_perishable = random.choice([True, False])
    labels = random.sample(LABELS_POOL, random.randint(0, 3))
    
    # Eway bill expiry: tomorrow to 1-2 weeks later
    # Tomorrow: 2026-06-10
    now = datetime.now()
    days_to_add = random.randint(1, 14) # 1 day to 2 weeks
    eway_bill_expiry = (now + timedelta(days=days_to_add)).isoformat() + "Z"
    
    status_choices = ["pending", "assigned", "in_transit", "delivered"]
    status = random.choice(status_choices)
    
    stage = "Awaiting Assignment"
    if status == "assigned":
        stage = "Assigned"
    elif status == "in_transit":
        stage = "In Transit"
    elif status == "delivered":
        stage = "Delivered"

    shipment_data = {
        "id": str(uuid.uuid4()),
        "company_id": COMPANY_ID,
        "pickup": {"lat": pickup_lat, "lng": pickup_lng, "address": f"Random Pickup {random.randint(1, 1000)}"},
        "drop": {"lat": drop_lat, "lng": drop_lng, "address": f"Random Drop {random.randint(1, 1000)}"},
        "weight": round(random.uniform(1.0, 500.0), 2),
        "description": f"Test Shipment {random.randint(1, 10000)}",
        "labels": labels,
        "is_perishable": is_perishable,
        "receiver_name": "Test Receiver",
        "receiver_phone": f"+9198{random.randint(10000000, 99999999)}",
        "receiver_email": random.choice(EMAILS),
        "eway_bill_no": f"EWB{random.randint(10000000, 99999999)}",
        "eway_bill_expiry": eway_bill_expiry,
        "status": status,
        "stage": stage,
        "created_at": now.isoformat() + "Z",
        "payment_status": random.choice(["unpaid", "paid"]),
    }
    
    # Validate via pydantic model and then convert to dict to save
    shipment_obj = Shipment(**shipment_data)
    # to handle any model default values (like vitality)
    return shipment_obj.dict()

def main():
    print("Generating and inserting 1000 random shipments...")
    for i in range(1000):
        shipment = generate_random_shipment()
        shipments_db.insert(shipment)
        if (i+1) % 100 == 0:
            print(f"Inserted {i+1} shipments...")
            
    print("Done inserting 1000 shipments.")

if __name__ == "__main__":
    main()
