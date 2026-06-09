import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
}

r = requests.get("https://www.bankbazaar.com/fuel/petrol-price-india.html", headers=headers, timeout=5)
html = r.text

tables = re.findall(r"<table.*?>(.*?)</table>", html, re.DOTALL)
if tables:
    table = tables[0]
    # find all <tr>...</tr>
    rows = re.findall(r"<tr.*?>(.*?)</tr>", table, re.DOTALL)
    print("Found rows:", len(rows))
    for row in rows[:20]:
        # get text inside cells
        cells = re.findall(r"<td.*?>(.*?)</td>", row, re.DOTALL)
        # strip html tags from cells
        clean_cells = [re.sub(r"<.*?>", "", c).strip() for c in cells]
        if clean_cells:
            print("Row:", clean_cells)
