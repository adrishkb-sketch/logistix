import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
}

r = requests.get("https://www.bankbazaar.com/fuel/petrol-price-india.html", headers=headers, timeout=5)
print("BankBazaar status:", r.status_code)
html = r.text

# Let's search for "Maharashtra" or "Mumbai" or "Delhi" with numeric values near it.
# Let's find matches for "Delhi" and find numbers.
matches = re.findall(r"Delhi.*?(\d+\.\d+)", html, re.DOTALL)
print("Delhi matches:", matches[:10])

# Let's search for a table.
tables = re.findall(r"<table.*?>(.*?)</table>", html, re.DOTALL)
print("Number of tables:", len(tables))
for i, table in enumerate(tables):
    print(f"Table {i} has length {len(table)}")
    if "Delhi" in table or "Maharashtra" in table:
        print(f"Table {i} matches!")
        # print first 500 chars of table
        print(table[:500])
