import math
from backend.services.route_engine import haversine
from backend.routers.fuel_oracle import get_fuel_prices

def estimate_delivery_cost(shipment: dict, vehicle_type: str = "van") -> dict:
    # 1. Distance Calculation
    p_lat = shipment.get("pickup", {}).get("lat", 0)
    p_lng = shipment.get("pickup", {}).get("lng", 0)
    d_lat = shipment.get("drop", {}).get("lat", 0)
    d_lng = shipment.get("drop", {}).get("lng", 0)
    dist = haversine(p_lat, p_lng, d_lat, d_lng)
    
    # 2. Fuel Budget (State-aware from Oracle)
    prices = get_fuel_prices()
    fuel_price = 95.0 # Global average fallback
    
    # Simple state detection based on lat/lng
    state = "Delhi"
    if p_lat < 25: state = "Maharashtra"
    if p_lat < 20: state = "Karnataka"
    if p_lng > 85: state = "West Bengal"
    
    state_prices = prices.get(state, prices.get("Delhi", {}))
    
    # Vehicle Efficiency Mapping
    v_type = (vehicle_type or "van").lower()
    efficiency = 15.0 # km/L
    fuel_type = "diesel"
    
    if "truck" in v_type:
        efficiency = 6.0
        fuel_type = "diesel"
    elif "van" in v_type:
        efficiency = 12.0
        fuel_type = "diesel"
    elif "bike" in v_type or "scooty" in v_type:
        efficiency = 45.0
        fuel_type = "petrol"
    elif "drone" in v_type:
        efficiency = 0 # Electric
    
    current_fuel_price = state_prices.get(fuel_type, 95.0)
    fuel_budget = (dist / (efficiency or 1)) * current_fuel_price if efficiency > 0 else 5.0 # 5 INR for drone battery
    
    # 3. Toll Budget (Estimation: ~₹2 per km for heavy, ₹0.5 for light)
    toll_rate = 2.0 if "truck" in v_type else 0.5
    toll_budget = dist * toll_rate if "bike" not in v_type and "drone" not in v_type else 0
    
    # 4. Driver Wage (Direct Income)
    # Calculated at ₹3.5 per km + ₹100 base per assignment
    driver_wage = 100 + (dist * 3.5) if "drone" not in v_type else 0
    
    # 5. Total Operational Cost
    total_cost = fuel_budget + toll_budget + driver_wage
    
    # 6. Customer Pricing (Margin-based)
    # Target 30% margin on top of costs
    margin_pct = 0.30
    if shipment.get("is_perishable"): margin_pct += 0.10
    
    suggested_price = total_cost * (1 + margin_pct)
    
    # 7. Projected Profit
    projected_profit = suggested_price - total_cost

    return {
        "suggested_price": round(suggested_price, 2),
        "total_cost": round(total_cost, 2),
        "fuel_budget": round(fuel_budget, 2),
        "toll_budget": round(toll_budget, 2),
        "driver_wage": round(driver_wage, 2),
        "projected_profit": round(projected_profit, 2),
        "margin_pct": round(margin_pct * 100, 1),
        "vehicle_type": vehicle_type,
        "distance_km": round(dist, 2),
        "fuel_price_used": current_fuel_price
    }

def recalculate_shipment_finance(shipment: dict, legs: list, vehicles_db) -> dict:
    """
    Recalculates finance for a shipment and its legs based on distance.
    Distributes total revenue among legs and calculates individual costs.
    """
    # Calculate Total Distance and Total Operational Cost (Bottom-Up)
    total_dist = 0
    total_ops_cost = 0
    leg_data = []
    
    for leg in legs:
        p = leg.get("pickup", {})
        d = leg.get("drop", {})
        dist = haversine(p.get("lat",0), p.get("lng",0), d.get("lat",0), d.get("lng",0))
        total_dist += dist
        
        # Get vehicle efficiency for cost estimation pass
        v_type = "van"
        v_id = leg.get("assigned_vehicle_id")
        if v_id:
            v = vehicles_db.get_by_id(v_id)
            if v: v_type = v.get("type", "van")
        
        cost_info = estimate_delivery_cost(leg, v_type)
        total_ops_cost += cost_info.get("total_cost", 0)
        leg_data.append({"id": leg["id"], "dist": dist, "leg": leg, "v_type": v_type})
        
    if total_dist <= 0:
        total_dist = 1.0 # Avoid division by zero

    # Recalculate Parent Total Revenue (Revenue = Cost + Margin)
    margin_pct = 0.30
    if shipment.get("is_perishable"): margin_pct += 0.10
    total_amount = total_ops_cost * (1 + margin_pct)
        
    parent_total_cost = 0
    
    # Process Each Leg
    updated_legs = []
    for item in leg_data:
        leg = item["leg"]
        dist = item["dist"]
        v_type = item["v_type"]
        
        # Proportional Revenue
        leg_revenue = (dist / total_dist) * total_amount
            
        cost_info = estimate_delivery_cost(leg, v_type)
        # Override distance in cost_info to match our leg distance
        cost_info["distance_km"] = round(dist, 2)
        # Recalculate costs based on this distance
        efficiency = 12.0 if "van" in v_type.lower() else (6.0 if "truck" in v_type.lower() else 45.0)
        fuel_price = cost_info.get("fuel_price_used", 95.0)
        
        leg_fuel = (dist / (efficiency or 1)) * fuel_price
        leg_tolls = dist * (2.0 if "truck" in v_type.lower() else 0.5)
        if "bike" in v_type.lower() or "drone" in v_type.lower(): leg_tolls = 0
        
        leg_driver_wage = 100 + (dist * 3.5)
        leg_total_cost = leg_fuel + leg_tolls + leg_driver_wage
        leg_profit = leg_revenue - leg_total_cost
        
        leg_finance = {
            "suggested_price": round(leg_revenue, 2),
            "total_cost": round(leg_total_cost, 2),
            "fuel_budget": round(leg_fuel, 2),
            "toll_budget": round(leg_tolls, 2),
            "driver_wage": round(leg_driver_wage, 2),
            "projected_profit": round(leg_profit, 2),
            "margin_pct": round((leg_profit / (leg_revenue or 1)) * 100, 1),
            "distance_km": round(dist, 2)
        }
        
        leg["finance"] = leg_finance
        updated_legs.append(leg)
        parent_total_cost += leg_total_cost

    # Update Parent
    shipment["finance"] = {
        "suggested_price": round(total_amount, 2),
        "total_cost": round(parent_total_cost, 2),
        "projected_profit": round(total_amount - parent_total_cost, 2),
        "margin": round(total_amount - parent_total_cost, 2),
        "distance_km": round(total_dist, 2)
    }
    
    return {"shipment": shipment, "legs": updated_legs}
