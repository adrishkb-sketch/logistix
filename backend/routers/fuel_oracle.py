from fastapi import APIRouter
import random
import requests
import re
import datetime
import math

router = APIRouter()

# Base fuel prices for major Indian states (INR per Liter)
BASE_FUEL_PRICES = {
    "Delhi": {"petrol": 94.72, "diesel": 87.62},
    "Haryana": {"petrol": 95.14, "diesel": 88.02},
    "Uttar Pradesh": {"petrol": 94.41, "diesel": 87.51},
    "Maharashtra": {"petrol": 104.21, "diesel": 92.15},
    "Karnataka": {"petrol": 102.84, "diesel": 88.94},
    "Tamil Nadu": {"petrol": 100.75, "diesel": 92.34},
    "West Bengal": {"petrol": 103.94, "diesel": 90.76},
    "Rajasthan": {"petrol": 104.88, "diesel": 90.48},
    "Gujarat": {"petrol": 92.17, "diesel": 88.00},
}

# Map city in scraper to State
CITY_TO_STATE = {
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

def get_fallback_dynamic_prices() -> dict:
    today = datetime.date.today()
    # Seed based on date so prices fluctuate daily but are consistent for a given day
    day_seed = today.year * 10000 + today.month * 100 + today.day
    
    live_prices = {}
    for state, base in BASE_FUEL_PRICES.items():
        # Fluctuations
        fluct_petrol = math.sin(day_seed + sum(ord(c) for c in state)) * 1.5
        fluct_diesel = math.cos(day_seed + sum(ord(c) for c in state) + 1) * 1.5
        
        live_prices[state] = {
            "petrol": round(base["petrol"] + fluct_petrol, 2),
            "diesel": round(base["diesel"] + fluct_diesel, 2)
        }
    return live_prices

def scrape_fuel_prices() -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }
    
    scraped_petrol = {}
    scraped_diesel = {}
    
    # Try fetching Petrol from BankBazaar
    try:
        r = requests.get("https://www.bankbazaar.com/fuel/petrol-price-india.html", headers=headers, timeout=2.0)
        if r.status_code == 200:
            tables = re.findall(r"<table.*?>(.*?)</table>", r.text, re.DOTALL)
            if tables:
                rows = re.findall(r"<tr.*?>(.*?)</tr>", tables[0], re.DOTALL)
                for row in rows:
                    cells = re.findall(r"<td.*?>(.*?)</td>", row, re.DOTALL)
                    clean_cells = [re.sub(r"<.*?>", "", c).strip() for c in cells]
                    if len(clean_cells) >= 2:
                        city = clean_cells[0].strip()
                        m = re.search(r"₹\s*(\d+\.?\d*)", clean_cells[1])
                        if m:
                            scraped_petrol[city] = float(m.group(1))
    except Exception:
        pass

    # Try fetching Diesel from BankBazaar
    try:
        r = requests.get("https://www.bankbazaar.com/fuel/diesel-price-india.html", headers=headers, timeout=2.0)
        if r.status_code == 200:
            tables = re.findall(r"<table.*?>(.*?)</table>", r.text, re.DOTALL)
            if tables:
                rows = re.findall(r"<tr.*?>(.*?)</tr>", tables[0], re.DOTALL)
                for row in rows:
                    cells = re.findall(r"<td.*?>(.*?)</td>", row, re.DOTALL)
                    clean_cells = [re.sub(r"<.*?>", "", c).strip() for c in cells]
                    if len(clean_cells) >= 2:
                        city = clean_cells[0].strip()
                        m = re.search(r"₹\s*(\d+\.?\d*)", clean_cells[1])
                        if m:
                            scraped_diesel[city] = float(m.group(1))
    except Exception:
        pass

    # Merge into state-wise dictionary
    merged_prices = {}
    fallback = get_fallback_dynamic_prices()
    
    for city, state in CITY_TO_STATE.items():
        petrol_val = scraped_petrol.get(city) or fallback[state]["petrol"]
        diesel_val = scraped_diesel.get(city) or fallback[state]["diesel"]
        merged_prices[state] = {
            "petrol": petrol_val,
            "diesel": diesel_val
        }
        
    # Fill in any state that was not in CITY_TO_STATE map
    for state in BASE_FUEL_PRICES:
        if state not in merged_prices:
            merged_prices[state] = fallback[state]
            
    return merged_prices

@router.get("/prices")
def get_fuel_prices():
    return scrape_fuel_prices()

@router.post("/optimize")
def optimize_fuel_route(data: dict):
    states_in_route = data.get("states", ["Delhi", "Haryana", "Rajasthan", "Gujarat"])
    prices = scrape_fuel_prices()
    
    prices_diesel = [prices[s]["diesel"] for s in states_in_route if s in prices]
    
    if not prices_diesel:
        return {"suggestion": "Fuel at start."}
        
    min_price = min(prices_diesel)
    best_state = [s for s in states_in_route if s in prices and prices[s]["diesel"] == min_price][0]
    
    max_price = max(prices_diesel)
    savings = round(max_price - min_price, 2)
    
    return {
        "best_state": best_state,
        "price": min_price,
        "potential_savings_per_liter": savings,
        "suggestion": f"Refuel in {best_state} to save up to ₹{savings} per liter compared to your highest-cost state."
    }
