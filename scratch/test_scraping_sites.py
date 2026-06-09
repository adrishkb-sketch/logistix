import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
}

# Try NDTV
print("Trying NDTV...")
try:
    r = requests.get("https://www.ndtv.com/fuel-prices", headers=headers, timeout=5)
    print("NDTV status:", r.status_code)
except Exception as e:
    print("NDTV error:", e)

# Try GoodReturns
print("Trying GoodReturns...")
try:
    r = requests.get("https://www.goodreturns.in/petrol-price.html", headers=headers, timeout=5)
    print("GoodReturns status:", r.status_code)
    # Check if we can find petrol price in goodreturns
except Exception as e:
    print("GoodReturns error:", e)

# Try an open data catalog or simple site
print("Trying dynamic mock...")
import datetime
# We can also scrape a site like:
# https://www.bankbazaar.com/fuel/petrol-price-india.html
try:
    r = requests.get("https://www.bankbazaar.com/fuel/petrol-price-india.html", headers=headers, timeout=5)
    print("BankBazaar status:", r.status_code)
    if r.status_code == 200:
        print("BankBazaar length:", len(r.text))
        # Let's print a small part
        idx = r.text.find("Delhi")
        if idx != -1:
            print("BankBazaar Delhi snippet:", r.text[idx:idx+200])
except Exception as e:
    print("BankBazaar error:", e)
