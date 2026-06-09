import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
}

def get_prices(url):
    r = requests.get(url, headers=headers, timeout=5)
    html = r.text
    tables = re.findall(r"<table.*?>(.*?)</table>", html, re.DOTALL)
    prices = {}
    if tables:
        rows = re.findall(r"<tr.*?>(.*?)</tr>", tables[0], re.DOTALL)
        for row in rows:
            cells = re.findall(r"<td.*?>(.*?)</td>", row, re.DOTALL)
            clean_cells = [re.sub(r"<.*?>", "", c).strip() for c in cells]
            if len(clean_cells) >= 2:
                city = clean_cells[0].strip()
                price_str = clean_cells[1]
                # extract float number
                m = re.search(r"₹\s*(\d+\.?\d*)", price_str)
                if m:
                    prices[city] = float(m.group(1))
    return prices

petrol_prices = get_prices("https://www.bankbazaar.com/fuel/petrol-price-india.html")
diesel_prices = get_prices("https://www.bankbazaar.com/fuel/diesel-price-india.html")

target_cities = {
    "Delhi": "Delhi",
    "Mumbai": "Maharashtra",
    "Bangalore": "Karnataka",
    "Chennai": "Tamil Nadu",
    "Kolkata": "West Bengal",
    "Ahmedabad": "Gujarat",
    "Lucknow": "Uttar Pradesh",
    "Jaipur": "Rajasthan",
    "Gurgaon": "Haryana"
}

print("Petrol prices in target cities:")
for city, state in target_cities.items():
    print(f"{state} ({city}): {petrol_prices.get(city)}")

print("\nDiesel prices in target cities:")
for city, state in target_cities.items():
    print(f"{state} ({city}): {diesel_prices.get(city)}")
