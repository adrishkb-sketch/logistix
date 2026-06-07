from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

# Test query to weather-at endpoint
response = client.get("/api/tracking/weather-at?lat=19.076&lng=72.8777&company_id=557f9b08-30da-4b99-b233-a16c9df5191d")
print("STATUS CODE:", response.status_code)
print("RESPONSE CONTENT:", response.content)
