import requests
import time

def test():
    company_id = "557f9b08-30da-4b99-b233-a16c9df5191d"
    url = f"http://localhost:8000/api/shipments/?company_id={company_id}"
    print(f"Requesting {url}...")
    t0 = time.time()
    try:
        r = requests.get(url)
        t1 = time.time()
        print(f"Status: {r.status_code}")
        print(f"Time: {t1 - t0:.4f} seconds")
        if r.status_code == 200:
            data = r.json()
            print(f"Loaded {len(data)} shipments.")
        else:
            print(r.text)
    except Exception as e:
        print("Error connecting to server:", e)

if __name__ == "__main__":
    test()
