import requests
import json

def test_api():
    base_url = "http://127.0.0.1:8000/api"
    company_id = "557f9b08-30da-4b99-b233-a16c9df5191d"
    headers = {
        "X-Logistix-Context": company_id
    }
    
    # 1. Test GET /manager/drivers
    r1 = requests.get(f"{base_url}/manager/drivers?company_id={company_id}", headers=headers)
    print(f"GET /manager/drivers status: {r1.status_code}")
    if r1.status_code == 200:
        drivers = r1.json()
        print(f"Found {len(drivers)} drivers")
        verified = [d for d in drivers if d.get("verification_status") == "verified"]
        print(f"Verified drivers count: {len(verified)}")
        for d in verified[:5]:
            print(f"  - {d.get('name')} (id: {d.get('id')})")
    else:
        print(r1.text)
        
    # 2. Test GET /tracking/messages/{user_id}
    r2 = requests.get(f"{base_url}/tracking/messages/{company_id}?company_id={company_id}", headers=headers)
    print(f"GET /tracking/messages/{company_id} status: {r2.status_code}")
    if r2.status_code == 200:
        msgs = r2.json()
        print(f"Found {len(msgs)} messages")
    else:
        print(r2.text)

if __name__ == "__main__":
    test_api()
