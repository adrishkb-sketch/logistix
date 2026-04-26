from fastapi import APIRouter
import random

router = APIRouter()

# Mock fuel prices for major Indian states (INR per Liter)
FUEL_PRICES = {
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

@router.get("/prices")
def get_fuel_prices():
    # Return prices with some random fluctuation for "live" feel
    live_prices = {}
    for state, prices in FUEL_PRICES.items():
        live_prices[state] = {
            "petrol": round(prices["petrol"] + random.uniform(-0.1, 0.1), 2),
            "diesel": round(prices["diesel"] + random.uniform(-0.1, 0.1), 2)
        }
    return live_prices

@router.post("/optimize")
def optimize_fuel_route(data: dict):
    # Basic logic: Compare fuel prices across the states in the route
    # In a real app, this would use the route path and state boundaries
    states_in_route = data.get("states", ["Delhi", "Haryana", "Rajasthan", "Gujarat"])
    prices = [FUEL_PRICES[s]["diesel"] for s in states_in_route if s in FUEL_PRICES]
    
    if not prices:
        return {"suggestion": "Fuel at start."}
        
    min_price = min(prices)
    best_state = [s for s in states_in_route if s in FUEL_PRICES and FUEL_PRICES[s]["diesel"] == min_price][0]
    
    savings = round(max(prices) - min_price, 2)
    
    return {
        "best_state": best_state,
        "price": min_price,
        "potential_savings_per_liter": savings,
        "suggestion": f"Refuel in {best_state} to save up to ₹{savings} per liter compared to your highest-cost state."
    }
