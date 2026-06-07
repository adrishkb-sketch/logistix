import sys
import os

# Set up PYTHONPATH
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from fastapi.testclient import TestClient
from backend.main import app
from backend.database import JSONDatabase

client = TestClient(app)

def run_tests():
    print("=== STARTING DRIVER-VEHICLE LINKING CONSTRAINTS VERIFICATION ===")
    
    # Initialize databases
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    # 1. Create mock base hub, drivers, and vehicles for testing
    company_id = "test_company_linking"
    hub_a = "hub_A"
    hub_b = "hub_B"
    
    # Remove existing test records
    drivers_db.delete_many("data->>company_id", company_id)
    vehicles_db.delete_many("data->>company_id", company_id)
    
    d1 = {
        "id": "drv_1_bike_hub_a",
        "company_id": company_id,
        "name": "Driver 1 Bike Hub A",
        "license_type": "bike",
        "base_warehouse_id": hub_a,
        "status": "available",
        "verification_status": "unverified"
    }
    d2 = {
        "id": "drv_2_bike_hub_b",
        "company_id": company_id,
        "name": "Driver 2 Bike Hub B",
        "license_type": "bike",
        "base_warehouse_id": hub_b,
        "status": "available",
        "verification_status": "unverified"
    }
    d3 = {
        "id": "drv_3_truck_hub_a",
        "company_id": company_id,
        "name": "Driver 3 Truck Hub A",
        "license_type": "truck",
        "base_warehouse_id": hub_a,
        "status": "available",
        "verification_status": "unverified"
    }
    
    v1 = {
        "id": "veh_1_bike_hub_a",
        "company_id": company_id,
        "type": "bike",
        "number_plate": "BIKE-A",
        "base_warehouse_id": hub_a,
        "status": "available"
    }
    v2 = {
        "id": "veh_2_bike_hub_b",
        "company_id": company_id,
        "type": "bike",
        "number_plate": "BIKE-B",
        "base_warehouse_id": hub_b,
        "status": "available"
    }
    v3 = {
        "id": "veh_3_truck_hub_a",
        "company_id": company_id,
        "type": "truck",
        "number_plate": "TRUCK-A",
        "base_warehouse_id": hub_a,
        "status": "available"
    }
    
    drivers_db.insert(d1)
    drivers_db.insert(d2)
    drivers_db.insert(d3)
    
    vehicles_db.insert(v1)
    vehicles_db.insert(v2)
    vehicles_db.insert(v3)
    
    print("Mock data populated.")

    headers = {"X-Logistix-Context": company_id}

    # Test Case 1: Manual linking via /link-vehicle with hub mismatch (query params)
    print("Test 1: Manual link with Hub Mismatch...")
    res = client.post(f"/api/manager/link-vehicle?driver_id={d1['id']}&vehicle_id={v2['id']}", headers=headers)
    assert res.status_code == 400
    assert "Warehouse mismatch" in res.json()["detail"]
    print("✅ Test 1 Passed: Hub mismatch rejected successfully.")

    # Test Case 2: Manual linking via /link-vehicle with license mismatch (query params)
    print("Test 2: Manual link with License Type Mismatch...")
    res = client.post(f"/api/manager/link-vehicle?driver_id={d1['id']}&vehicle_id={v3['id']}", headers=headers)
    assert res.status_code == 400
    assert "License mismatch" in res.json()["detail"]
    print("✅ Test 2 Passed: License mismatch rejected successfully.")

    # Test Case 3: Manual linking via /link-vehicle successfully (JSON body)
    print("Test 3: Manual link compatible driver and vehicle (JSON body)...")
    res = client.post("/api/manager/link-vehicle", json={"driver_id": d1["id"], "vehicle_id": v1["id"]}, headers=headers)
    assert res.status_code == 200
    # Verify linking in database
    drv = drivers_db.get_by_id(d1["id"])
    veh = vehicles_db.get_by_id(v1["id"])
    assert drv.get("assigned_vehicle_id") == v1["id"]
    assert veh.get("assigned_driver_id") == d1["id"]
    print("✅ Test 3 Passed: Compatible JSON body linking succeeded.")

    # Test Case 4: Manual linking via /link-vehicle successfully (Query params)
    print("Test 4: Manual link compatible driver and vehicle (Query parameters)...")
    # Reset first
    drivers_db.update(d1["id"], {"assigned_vehicle_id": None})
    vehicles_db.update(v1["id"], {"assigned_driver_id": None})
    res = client.post(f"/api/manager/link-vehicle?driver_id={d1['id']}&vehicle_id={v1['id']}", headers=headers)
    assert res.status_code == 200
    drv = drivers_db.get_by_id(d1["id"])
    veh = vehicles_db.get_by_id(v1["id"])
    assert drv.get("assigned_vehicle_id") == v1["id"]
    assert veh.get("assigned_driver_id") == d1["id"]
    print("✅ Test 4 Passed: Compatible query parameter linking succeeded.")

    # Test Case 5: Manual verification linking compat check
    print("Test 5: Manual verification link with Hub Mismatch...")
    res = client.post(f"/api/manager/verify-driver/{d1['id']}?status=verified&vehicle_id={v2['id']}", headers=headers)
    assert res.status_code == 400
    assert "Warehouse mismatch" in res.json()["detail"]
    print("✅ Test 5 Passed: Manual verification hub mismatch rejected.")

    print("Test 6: Manual verification link with License Type Mismatch...")
    res = client.post(f"/api/manager/verify-driver/{d1['id']}?status=verified&vehicle_id={v3['id']}", headers=headers)
    assert res.status_code == 400
    assert "License mismatch" in res.json()["detail"]
    print("✅ Test 6 Passed: Manual verification license mismatch rejected.")

    print("Test 7: Manual verification link compatibility check (Success)...")
    drivers_db.update(d1["id"], {"assigned_vehicle_id": None})
    vehicles_db.update(v1["id"], {"assigned_driver_id": None})
    res = client.post(f"/api/manager/verify-driver/{d1['id']}?status=verified&vehicle_id={v1['id']}", headers=headers)
    assert res.status_code == 200
    drv = drivers_db.get_by_id(d1["id"])
    veh = vehicles_db.get_by_id(v1["id"])
    assert drv.get("assigned_vehicle_id") == v1["id"]
    assert veh.get("assigned_driver_id") == d1["id"]
    assert drv.get("verification_status") == "verified"
    print("✅ Test 7 Passed: Compatible verification link succeeded.")

    # Clean up test records
    drivers_db.delete_many("data->>company_id", company_id)
    vehicles_db.delete_many("data->>company_id", company_id)
    print("=== ALL TESTS PASSED SUCCESSFULLY ===")

if __name__ == "__main__":
    run_tests()
