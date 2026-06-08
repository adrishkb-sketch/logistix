import urllib.request
import urllib.error

urls = [
    "https://api.dicebear.com/7.x/avataaars/svg?seed=Ashok%20Kumar",
    "https://api.dicebear.com/7.x/avataaars/svg?seed=Suresh%20Pillai"
]

for url in urls:
    print(f"Fetching: {url}")
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            print(f"  Status: {response.status}")
            print(f"  Content length: {len(response.read())}")
    except Exception as e:
        print(f"  Error: {e}")
