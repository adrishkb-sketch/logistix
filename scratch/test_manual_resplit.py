import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from backend.main import app
from backend.database import JSONDatabase

client = TestClient(app)

def run_test():
    ships_db = JSONDatabase("shipments")
    companies_db = JSONDatabase("companies")
    warehouses_db = JSONDatabase("warehouses")
    
    comp = companies_db.get_all()[0]["id"]
    whs = warehouses_db.get_all()
    if not whs:
        print("No warehouses found")
        return
        
    chosen_wh = whs[0]["id"]
    
    # 1. Create a shipment
    payload = {
        "company_id": comp,
        "description": "Test Manual Resplit Shipment",
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
    
    # 2. Resplit it manually through the chosen warehouse
    res = client.post(f"/api/shipments/{s_id}/manual-resplit", json={"warehouse_id": chosen_wh})
    print("Manual Resplit result:", res.status_code, res.text)
    
    # Verify db
    new_legs = [l for l in ships_db.get_all() if l.get("parent_id") == s_id]
    print(f"Total legs now: {len(new_legs)}")
    for l in new_legs:
        print(f"  Leg {l['leg_order']}: {l['pickup']['address']} -> {l['drop']['address']}")
        
if __name__ == "__main__":
    run_test()
