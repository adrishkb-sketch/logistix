import math
from backend.services.route_engine import haversine
from backend.routers.fuel_oracle import get_live_fuel_prices

def estimate_delivery_cost(shipment: dict, vehicle_type: str = "van") -> dict:
    # 1. Distance & Route Complexity
    dist = haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], shipment["drop"]["lat"], shipment["drop"]["lng"])
    
    # 2. Fuel Cost (State-aware)
    # Get fuel price for pickup state (approximation)
    prices = get_live_fuel_prices()
    # Default to 95 if no state match
    fuel_price = 95.0
    # Simple state detection (mock)
    if shipment["pickup"]["lat"] > 25: fuel_price = prices.get("Delhi", 96)
    elif shipment["pickup"]["lat"] < 15: fuel_price = prices.get("Tamil Nadu", 102)
    elif shipment["pickup"]["lng"] > 85: fuel_price = prices.get("West Bengal", 106)
    
    efficiency = 15.0 # km/l default
    if vehicle_type == "truck": efficiency = 6.0
    if vehicle_type in ["bike", "scooty"]: efficiency = 45.0
    
    fuel_cost = (dist / efficiency) * fuel_price
    
    # 3. Driver Cost (Base + Food)
    base_driver_pay = 200 # Minimum base per trip
    if dist > 50: base_driver_pay = 400
    if dist > 200: base_driver_pay = 1200
    
    food_allowance = 150 if dist > 100 else 0
    if dist > 500: food_allowance = 450
    
    # 4. Drone Cost (if applicable)
    drone_cost = 0
    if shipment.get("route_type") == "multi-leg":
        # Assume one leg is drone
        drone_cost = 75 # Electricity + Maintenance
        
    # 5. Asset Depreciation & Maintenance
    maint_cost = dist * 1.5 # 1.5 INR per km
    
    total_cost = fuel_cost + base_driver_pay + food_allowance + drone_cost + maint_cost
    
    # Pricing: Cost + 20% Margin
    price_to_customer = total_cost * 1.25
    
    return {
        "total_cost": round(total_cost, 2),
        "fuel_cost": round(fuel_cost, 2),
        "driver_payout": round(base_driver_pay, 2),
        "food_allowance": round(food_allowance, 2),
        "drone_cost": round(drone_cost, 2),
        "maintenance_cost": round(maint_cost, 2),
        "suggested_price": round(price_to_customer, 2),
        "margin": round(price_to_customer - total_cost, 2)
    }
