import requests

urls = [
    "https://raw.githubusercontent.com/gokulkrishh/fuel-price/master/db.json",
    "https://api.collectapi.com/gasPrice/statePointPrices", # Needs key, probably fails
    "https://fuelprice-api-india.vercel.app/prices",
]

for url in urls:
    try:
        r = requests.get(url, timeout=5)
        print(f"URL: {url} -> Status: {r.status_code}")
        if r.status_code == 200:
            print("Content (truncated):", r.text[:200])
    except Exception as e:
        print(f"URL: {url} failed: {e}")
