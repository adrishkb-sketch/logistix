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
    print("=== STARTING AUTH FLOW AUTOMATED VERIFICATION ===")
    
    # Reset databases to ensure clean state
    companies_db = JSONDatabase("companies")
    companies_db.clear_all()
    
    # 1. Verify that check-email works and company doesn't exist yet
    test_email = "  Test.Company@Logistix.com  "
    clean_email = "test.company@logistix.com"
    
    res = client.get(f"/api/auth/check-email?email={test_email}")
    assert res.status_code == 200
    assert res.json()["exists"] is False
    print("✅ check-email works: email does not exist")
    
    # 2. Request OTP and verify return values (dev OTP mode)
    res = client.post("/api/auth/company/request-otp", json={
        "email": test_email,
        "company_name": "Test Company Corp"
    })
    assert res.status_code == 200
    from backend.routers.auth import otp_store
    dev_otp = otp_store.get(clean_email)
    assert dev_otp is not None
    print(f"✅ request-otp works: generated dev OTP is {dev_otp}")

    # 3. Verify signup with OTP (with mixed casing/whitespace email)
    res = client.post("/api/auth/company/verify-signup", json={
        "email": test_email,
        "otp": dev_otp,
        "company_data": {
            "name": "  Test Company Corp  ",
            "email": test_email,
            "password": "mypassword"
        }
    })
    assert res.status_code == 200
    signup_data = res.json()
    new_company_id = signup_data["company_id"]
    print(f"✅ verify-signup works: created company ID is {new_company_id}")
    
    # 4. Verify that check-email now returns True
    res = client.get(f"/api/auth/check-email?email={test_email}")
    assert res.status_code == 200
    assert res.json()["exists"] is True
    print("✅ check-email works: registered email exists")
    
    # 5. Verify that new companies start with empty dashboard datasets (no cloned demo data)
    wh_db = JSONDatabase("warehouses")
    whs = wh_db.get_filtered({"company_id": new_company_id})
    assert len(whs) == 0
    print("✅ empty dashboard works: 0 cloned warehouses")
    
    drivers_db = JSONDatabase("drivers")
    drvs = drivers_db.get_filtered({"company_id": new_company_id})
    assert len(drvs) == 0
    print("✅ empty dashboard works: 0 cloned drivers")
    
    vehicles_db = JSONDatabase("vehicles")
    veh = vehicles_db.get_filtered({"company_id": new_company_id})
    assert len(veh) == 0
    print("✅ empty dashboard works: 0 cloned vehicles")
    
    shipments_db = JSONDatabase("shipments")
    ships = shipments_db.get_filtered({"company_id": new_company_id})
    assert len(ships) == 0
    print("✅ empty dashboard works: 0 cloned shipments")
    
    # 6. Verify case-insensitive, whitespace-padded manager login
    res = client.post("/api/auth/company/login", json={
        "email": "  TEST.COMPANY@LOGISTIX.COM  ",
        "password": "mypassword"
    })
    assert res.status_code == 200
    login_data = res.json()
    assert login_data["company_id"] == new_company_id
    print("✅ company manager login works: case-insensitive & trimmed login succeeded")
    
    # 7. Verify stateless OTP bypass with 000000
    # Create another test company to verify bypass
    bypass_email = "bypass@logistix.com"
    client.post("/api/auth/company/request-otp", json={
        "email": bypass_email,
        "company_name": "Bypass Corp"
    })
    res = client.post("/api/auth/company/verify-signup", json={
        "email": bypass_email,
        "otp": "000000",
        "company_data": {
            "name": "Bypass Corp",
            "email": bypass_email,
            "password": "bypasspassword"
        }
    })
    assert res.status_code == 200
    print("✅ verify-signup works: OTP bypass with 000000 succeeded")
    
    print("=== ALL TESTS PASSED SUCCESSFULLY ===")

if __name__ == "__main__":
    run_tests()
