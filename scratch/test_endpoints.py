import sys
import os

# Set up PYTHONPATH
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_endpoints():
    company_id = "557f9b08-30da-4b99-b233-a16c9df5191d"
    headers = {"X-Logistix-Context": company_id}
    
    print("Fetching /api/manager/drivers...")
    res = client.get(f"/api/manager/drivers?company_id={company_id}", headers=headers)
    print(f"Status Code: {res.status_code}")
    if res.status_code != 200:
        print(f"Error: {res.text}")
    else:
        drivers = res.json()
        print(f"Loaded {len(drivers)} drivers successfully.")
        
    print("\nFetching /api/tracking/messages...")
    res_msg = client.get(f"/api/tracking/messages/{company_id}?company_id={company_id}", headers=headers)
    print(f"Status Code: {res_msg.status_code}")
    if res_msg.status_code != 200:
        print(f"Error: {res_msg.text}")
    else:
        msgs = res_msg.json()
        print(f"Loaded {len(msgs)} messages successfully.")

if __name__ == "__main__":
    test_endpoints()
