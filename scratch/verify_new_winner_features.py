import sys
import os

# Set up PYTHONPATH
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_congestion_endpoint():
    company_id = "557f9b08-30da-4b99-b233-a16c9df5191d"
    headers = {"X-Logistix-Context": company_id}
    
    print("--------------------------------------------------")
    print("Testing GET /api/manager/warehouses/congestion...")
    res = client.get(f"/api/manager/warehouses/congestion?company_id={company_id}", headers=headers)
    print(f"Status Code: {res.status_code}")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    
    data = res.json()
    print(f"Success! Returned {len(data)} warehouse congestion records.")
    for idx, wh in enumerate(data):
        print(f"\nWarehouse {idx+1}: {wh.get('warehouse_name')} (ID: {wh.get('warehouse_id')})")
        print(f"  Capacity: {wh.get('capacity')}")
        print(f"  Incoming count: {wh.get('incoming_count')}")
        print(f"  Congestion: {wh.get('congestion_percentage')}%")
        print(f"  Forecast length: {len(wh.get('forecast'))} hours")
        print(f"  Mitigation advice: {wh.get('mitigation_advice')}")
        assert "capacity" in wh
        assert "incoming_count" in wh
        assert "congestion_percentage" in wh
        assert "forecast" in wh
        assert "mitigation_advice" in wh

def test_esg_endpoint():
    company_id = "557f9b08-30da-4b99-b233-a16c9df5191d"
    headers = {"X-Logistix-Context": company_id}
    
    print("\n--------------------------------------------------")
    print("Testing GET /api/manager/analytics/esg...")
    res = client.get(f"/api/manager/analytics/esg?company_id={company_id}", headers=headers)
    print(f"Status Code: {res.status_code}")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    
    data = res.json()
    print(f"Success! ESG Data: {data}")
    assert "base_co2_kg" in data
    assert "eco_co2_kg" in data
    assert "offsets_accumulated_kg" in data
    assert "fuel_saved_liters" in data
    assert "green_fleet_pct" in data
    assert "cryptographic_hash" in data
    assert "standard_route" in data
    assert "eco_route" in data

if __name__ == "__main__":
    try:
        test_congestion_endpoint()
        test_esg_endpoint()
        print("\n--------------------------------------------------")
        print("🎉 ALL ENDPOINT VERIFICATION TESTS PASSED SUCCESSFULLY!")
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
