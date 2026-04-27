import math
from backend.services.route_engine import haversine
from backend.routers.fuel_oracle import get_fuel_prices

def estimate_delivery_cost(shipment: dict, vehicle_type: str = "van") -> dict:
    # 1. Distance & Route Complexity
    dist = haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], shipment["drop"]["lat"], shipment["drop"]["lng"])
    
    # 2. Fuel Cost (State-aware)
    prices = get_fuel_prices()
    
    def get_state_price(state_name, fallback):
        state_data = prices.get(state_name)
        if state_data:
            return state_data.get("diesel", fallback)
        return fallback

    fuel_price = 95.0
    if shipment["pickup"]["lat"] > 25: 
        fuel_price = get_state_price("Delhi", 96)
    elif shipment["pickup"]["lat"] < 15: 
        fuel_price = get_state_price("Tamil Nadu", 102)
    elif shipment["pickup"]["lng"] > 85: 
        fuel_price = get_state_price("West Bengal", 106)
    
    efficiency = 15.0 # km/l default
    v_type_lower = vehicle_type.lower()
    if "truck" in v_type_lower: efficiency = 6.0
    elif "bike" in v_type_lower or "scooty" in v_type_lower: efficiency = 45.0
    elif "van" in v_type_lower: efficiency = 12.0
    elif "drone" in v_type_lower: efficiency = 0 # Electric
    
    fuel_cost = (dist / efficiency) * fuel_price if efficiency > 0 else 0
    if "drone" in v_type_lower:
        fuel_cost = 5.0 # Battery charge cost
    
    # 3. Driver Cost (Base + Food)
    base_driver_pay = 0
    food_allowance = 0
    
    if "drone" not in v_type_lower:
        base_driver_pay = 200 # Minimum base per trip
        if dist > 50: base_driver_pay = 400
        if dist > 200: base_driver_pay = 1200
        
        food_allowance = 150 if dist > 100 else 0
        if dist > 500: food_allowance = 450
    
    # 4. Drone Cost (if applicable)
    drone_maintenance = 0
    if "drone" in v_type_lower:
        drone_maintenance = 150 # Fixed per flight for sensors/calibration
    elif shipment.get("route_type") == "drone-leg":
        drone_maintenance = 150
        
    # 5. Asset Depreciation & Maintenance
    maint_cost = dist * 1.5 # 1.5 INR per km for standard vehicles
    if "drone" in v_type_lower:
        maint_cost = dist * 25.0 # High precision parts
    
    total_cost = fuel_cost + base_driver_pay + food_allowance + drone_maintenance + maint_cost
    
    # Pricing: Dynamic Margin based on complexity
    margin_mult = 1.25 # 25% margin
    if shipment.get("is_perishable"): margin_mult += 0.1
    if "drone" in v_type_lower: margin_mult += 0.2 # Tech premium
    
    price_to_customer = total_cost * margin_mult
    
    return {
        "total_cost": round(total_cost, 2),
        "fuel_cost": round(fuel_cost, 2),
        "driver_payout": round(base_driver_pay, 2),
        "food_allowance": round(food_allowance, 2),
        "drone_maintenance": round(drone_maintenance, 2),
        "maintenance_cost": round(maint_cost, 2),
        "suggested_price": round(price_to_customer, 2),
        "margin": round(price_to_customer - total_cost, 2),
        "vehicle_used": vehicle_type
    }
