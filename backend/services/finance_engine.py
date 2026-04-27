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
    
    # Real-world Efficiency (km/l)
    efficiency = 18.0 
    v_type_lower = (vehicle_type or "van").lower()
    if "truck" in v_type_lower: efficiency = 5.0
    elif "bike" in v_type_lower or "scooty" in v_type_lower: efficiency = 45.0
    elif "van" in v_type_lower: efficiency = 12.0
    elif "drone" in v_type_lower: efficiency = 0 # Electric
    
    fuel_cost = (dist / efficiency) * fuel_price if efficiency > 0 else 0
    if "drone" in v_type_lower:
        fuel_cost = 2.0 # Battery charge cost for short flight
    
    # 3. Driver Cost (Base + Distance-based)
    base_driver_pay = 0
    food_allowance = 0
    
    if "drone" not in v_type_lower:
        base_driver_pay = 50 # Base per pickup
        dist_pay = dist * 2.5 # 2.5 INR per KM for driver effort
        base_driver_pay += dist_pay
        
        # Food for long hauls
        if dist > 150: food_allowance = 200
        if dist > 400: food_allowance = 450
    
    # 4. Maintenance & Asset Deprecation
    maint_cost = dist * 0.8 # 0.8 INR per km for general fleet
    if "drone" in v_type_lower:
        maint_cost = dist * 5.0 # Drone sensor wear
        drone_fixed_fee = 50 # Fixed calibration fee
    else:
        drone_fixed_fee = 0
    
    total_cost = fuel_cost + base_driver_pay + food_allowance + maint_cost + drone_fixed_fee
    
    # 5. Dynamic Pricing (Margin)
    # 15% - 25% margin based on load and priority
    margin_pct = 0.20 
    if shipment.get("is_perishable"): margin_pct += 0.05
    if "drone" in v_type_lower: margin_pct += 0.10 
    
    suggested_price = total_cost * (1 + margin_pct)
    
    return {
        "total_cost": round(total_cost, 2),
        "fuel_cost": round(fuel_cost, 2),
        "driver_payout": round(base_driver_pay, 2),
        "food_allowance": round(food_allowance, 2),
        "maintenance_cost": round(maint_cost + drone_fixed_fee, 2),
        "suggested_price": round(suggested_price, 2),
        "margin": round(suggested_price - total_cost, 2),
        "vehicle_used": vehicle_type
    }
