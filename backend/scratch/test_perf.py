import sys
import os
import time

sys.path.append("/Users/adrish/Desktop/Projects/logistix")

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

print("--- TESTING GET /api/shipments PERFORMANCE ---")

# First load (cold cache)
t0 = time.time()
response = client.get("/api/shipments?company_id=557f9b08-30da-4b99-b233-a16c9df5191d")
t1 = time.time()
print(f"1st Request (Cold Cache): Status={response.status_code}, Time={(t1-t0)*1000:.2f}ms")
if response.status_code == 200:
    shipments = response.json()
    print(f"Number of shipments returned: {len(shipments)}")

# Second load (hot cache, immediately after)
t0 = time.time()
response = client.get("/api/shipments?company_id=557f9b08-30da-4b99-b233-a16c9df5191d")
t1 = time.time()
print(f"2nd Request (Hot Cache): Status={response.status_code}, Time={(t1-t0)*1000:.2f}ms")

# Third load (hot cache)
t0 = time.time()
response = client.get("/api/shipments?company_id=557f9b08-30da-4b99-b233-a16c9df5191d")
t1 = time.time()
print(f"3rd Request (Hot Cache): Status={response.status_code}, Time={(t1-t0)*1000:.2f}ms")

# Wait 2.1 seconds to expire cache
print("Waiting 2.1 seconds for TTL expiration...")
time.sleep(2.1)

# Fourth load (expired cache, should hit DB again)
t0 = time.time()
response = client.get("/api/shipments?company_id=557f9b08-30da-4b99-b233-a16c9df5191d")
t1 = time.time()
print(f"4th Request (Expired Cache): Status={response.status_code}, Time={(t1-t0)*1000:.2f}ms")
