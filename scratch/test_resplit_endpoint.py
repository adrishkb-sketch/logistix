import sys, os, uuid
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from backend.main import app
from backend.database import JSONDatabase
import json

client = TestClient(app)

def run_test():
    ships_db = JSONDatabase("shipments")
    companies_db = JSONDatabase("companies")
    comp = companies_db.get_all()[0]["id"]
    
    # 1. Create a shipment
    payload = {
        "company_id": comp,
        "description": "Test Re-split Shipment",
        "weight": 10,
        "pickup": {"lat": 12.9716, "lng": 77.5946, "address": "Bengaluru"},
        "drop": {"lat": 28.7041, "lng": 77.1025, "address": "Delhi"},
        "payment_status": "paid",
        "receiver_phone": "1234567890",
        "receiver_name": "Test"
    }
    
    res = client.post("/api/shipments/", json=payload)
    if res.status_code != 200:
        print("Failed to create shipment:", res.text)
        return
        
    s_id = res.json()["id"]
    print(f"Created shipment {s_id}")
    
    # 2. Resplit it (without any active legs)
    res = client.post(f"/api/shipments/{s_id}/resplit")
    print("Resplit result:", res.status_code, res.text)
    
    # 3. Simulate making Leg 1 in_transit
    legs = [l for l in ships_db.get_all() if l.get("parent_id") == s_id]
    legs.sort(key=lambda x: x.get("leg_order", 0))
    if len(legs) > 1:
        leg1 = legs[0]
        ships_db.update(leg1["id"], {"status": "in_transit"})
        print(f"Set Leg 1 ({leg1['id']}) to in_transit")
        
        # 4. Resplit again (should only void subsequent legs and recalculate)
        res2 = client.post(f"/api/shipments/{s_id}/resplit")
        print("Second Resplit result:", res2.status_code, res2.text)
        
        # Verify db
        new_legs = [l for l in ships_db.get_all() if l.get("parent_id") == s_id]
        print(f"Total legs now: {len(new_legs)}")
        
if __name__ == "__main__":
    run_test()
