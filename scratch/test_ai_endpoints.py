import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from backend.main import app
from backend.database import JSONDatabase

client = TestClient(app)

def test_ai_endpoints():
    company_id = "557f9b08-30da-4b99-b233-a16c9df5191d"
    
    # 1. Safety Audit Endpoint
    print("Testing /api/manager/ai/safety-audit...")
    res = client.post("/api/manager/ai/safety-audit", json={"company_id": company_id})
    print(f"Status Code: {res.status_code}")
    assert res.status_code == 200, res.text
    data = res.json()
    assert "report" in data
    print("Safety Audit report generated successfully:")
    print(data["report"][:150] + "...")
    
    # 2. Warehouse Hub Readiness Endpoint
    print("\nTesting /api/manager/ai/wh-readiness...")
    # Get a valid warehouse ID
    wh_db = JSONDatabase("warehouses")
    whs = wh_db.get_filtered({"company_id": company_id})
    if not whs:
        whs = wh_db.get_all()
    assert whs, "No warehouses found in database to test"
    warehouse_id = whs[0]["id"]
    
    res = client.post("/api/manager/ai/wh-readiness", json={"company_id": company_id, "warehouse_id": warehouse_id})
    print(f"Status Code: {res.status_code}")
    assert res.status_code == 200, res.text
    data = res.json()
    assert "report" in data
    print("Warehouse Hub Readiness report generated successfully:")
    print(data["report"][:150] + "...")

if __name__ == "__main__":
    test_ai_endpoints()
