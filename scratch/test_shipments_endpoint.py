import sys
import os
import time

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
    
    endpoints = [
        f"/api/shipments/?company_id={company_id}",
        f"/api/manager/drivers?company_id={company_id}",
        f"/api/manager/vehicles?company_id={company_id}",
        f"/api/tracking/alerts/active?company_id={company_id}"
    ]
    
    for url in endpoints:
        print(f"Testing {url}...")
        start_time = time.time()
        res = client.get(url, headers=headers)
        end_time = time.time()
        print(f"Status Code: {res.status_code}")
        print(f"Time Taken: {end_time - start_time:.4f} seconds")
        if res.status_code != 200:
            print(f"ERROR on {url}: {res.text}")

if __name__ == "__main__":
    test_endpoints()
