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
    
    # 5. Food Allowance (Food Prices)
    # Dedicated allowance for driver food, ₹50 base + ₹1.0 per km
    food_allowance = 50.0 + (dist * 1.0) if "drone" not in v_type else 0.0
    
    # 6. Breakdown Reserve (Breakdown Fees)
    # Dedicated maintenance reserve to fund breakdowns based on vehicle/distance
    if "truck" in v_type:
        breakdown_reserve = 150.0 + dist * 1.0
    elif "van" in v_type or "ev" in v_type:
        breakdown_reserve = 80.0 + dist * 0.5
    elif "bike" in v_type or "scooty" in v_type:
        breakdown_reserve = 30.0 + dist * 0.3
    elif "drone" in v_type:
        breakdown_reserve = 20.0 + dist * 0.2
    else:
        breakdown_reserve = 50.0 + dist * 0.4
    
    # 7. Total Operational Cost
    total_cost = fuel_budget + toll_budget + driver_wage + food_allowance + breakdown_reserve
    
    # 8. Customer Pricing (Margin-based)
    # Target 30% margin on top of costs
    margin_pct = 0.30
    if shipment.get("is_perishable"): margin_pct += 0.10
    
    suggested_price = total_cost * (1 + margin_pct)
    
    # 9. Projected Profit
    projected_profit = suggested_price - total_cost

    return {
        "suggested_price": round(suggested_price, 2),
        "total_cost": round(total_cost, 2),
        "fuel_budget": round(fuel_budget, 2),
        "toll_budget": round(toll_budget, 2),
        "driver_wage": round(driver_wage, 2),
        "food_allowance": round(food_allowance, 2),
        "breakdown_reserve": round(breakdown_reserve, 2),
        "projected_profit": round(projected_profit, 2),
        "margin_pct": round(margin_pct * 100, 1),
        "vehicle_type": vehicle_type,
        "distance_km": round(dist, 2),
        "fuel_price_used": current_fuel_price
    }

def recalculate_shipment_finance(shipment: dict, legs: list, vehicles_db) -> dict:
    """
    Recalculates finance for a shipment and its legs based on distance and vehicle type.
    Computes leg charges and sets parent finance as their exact sum.
    """
    updated_legs = []
    
    suggested_price_sum = 0.0
    total_cost_sum = 0.0
    fuel_budget_sum = 0.0
    toll_budget_sum = 0.0
    driver_wage_sum = 0.0
    food_allowance_sum = 0.0
    breakdown_reserve_sum = 0.0
    projected_profit_sum = 0.0
    distance_km_sum = 0.0
    
    for leg in legs:
        v_type = "van"
        v_id = leg.get("assigned_vehicle_id")
        if v_id:
            v = vehicles_db.get_by_id(v_id)
            if v:
                v_type = v.get("type", "van")
        else:
            # Leg default vehicle fallback
            l_type = leg.get("leg_type")
            if l_type == "middle_mile":
                v_type = "truck"
            elif l_type == "first_mile":
                v_type = "scooty"
            elif l_type == "last_mile":
                v_type = "van"
                
        leg_finance = estimate_delivery_cost(leg, v_type)
        leg_finance["expected_profit"] = leg_finance.get("projected_profit", 0)
        leg["finance"] = leg_finance
        updated_legs.append(leg)
        
        suggested_price_sum += leg_finance.get("suggested_price", 0.0)
        total_cost_sum += leg_finance.get("total_cost", 0.0)
        fuel_budget_sum += leg_finance.get("fuel_budget", 0.0)
        toll_budget_sum += leg_finance.get("toll_budget", 0.0)
        driver_wage_sum += leg_finance.get("driver_wage", 0.0)
        food_allowance_sum += leg_finance.get("food_allowance", 0.0)
        breakdown_reserve_sum += leg_finance.get("breakdown_reserve", 0.0)
        projected_profit_sum += leg_finance.get("projected_profit", 0.0)
        distance_km_sum += leg_finance.get("distance_km", 0.0)
        
    shipment["finance"] = {
        "suggested_price": round(suggested_price_sum, 2),
        "total_cost": round(total_cost_sum, 2),
        "fuel_budget": round(fuel_budget_sum, 2),
        "toll_budget": round(toll_budget_sum, 2),
        "driver_wage": round(driver_wage_sum, 2),
        "food_allowance": round(food_allowance_sum, 2),
        "breakdown_reserve": round(breakdown_reserve_sum, 2),
        "projected_profit": round(projected_profit_sum, 2),
        "margin": round(projected_profit_sum, 2),
        "distance_km": round(distance_km_sum, 2)
    }
    
    return {"shipment": shipment, "legs": updated_legs}

def migrate_all_shipment_finances():
    """
    Startup Migration: Recalculates and overwrites finance for ALL shipments in history.
    Enforces that parent multi-leg shipments are the exact sum of their legs' charges.
    Writes the updated details back to the active database.
    """
    from backend.database import JSONDatabase
    shipments_db = JSONDatabase("shipments")
    vehicles_db = JSONDatabase("vehicles")
    
    all_shipments = shipments_db.get_all()
    if not all_shipments:
        print("[Migration] No shipments found to migrate.")
        return
        
    print(f"[Migration] Starting finance recalculation for {len(all_shipments)} shipments...")
    
    # Map for quick leg reference
    legs_map = {}
    legs = [s for s in all_shipments if s and s.get("is_leg")]
    for leg in legs:
        leg_id = leg["id"]
        v_id = leg.get("assigned_vehicle_id")
        v_type = "van"
        if v_id:
            v = vehicles_db.get_by_id(v_id)
            if v:
                v_type = v.get("type", "van")
        else:
            # Leg default vehicle fallback
            l_type = leg.get("leg_type")
            if l_type == "middle_mile":
                v_type = "truck"
            elif l_type == "first_mile":
                v_type = "scooty"
            elif l_type == "last_mile":
                v_type = "van"
                
        leg_finance = estimate_delivery_cost(leg, v_type)
        leg_finance["expected_profit"] = leg_finance.get("projected_profit", 0)
        leg["finance"] = leg_finance
        shipments_db.update(leg_id, leg)
        legs_map[leg_id] = leg

    # Recalculate parent shipments and direct shipments
    parents_and_directs = [s for s in all_shipments if s and not s.get("is_leg")]
    for s in parents_and_directs:
        s_id = s["id"]
        s_legs = [l for l in all_shipments if l and l.get("parent_id") == s_id]
        if s_legs:
            # Sum up leg details
            updated_s_legs = [legs_map.get(l["id"], l) for l in s_legs]
            
            suggested_price_sum = sum(l.get("finance", {}).get("suggested_price", 0.0) for l in updated_s_legs)
            total_cost_sum = sum(l.get("finance", {}).get("total_cost", 0.0) for l in updated_s_legs)
            fuel_budget_sum = sum(l.get("finance", {}).get("fuel_budget", 0.0) for l in updated_s_legs)
            toll_budget_sum = sum(l.get("finance", {}).get("toll_budget", 0.0) for l in updated_s_legs)
            driver_wage_sum = sum(l.get("finance", {}).get("driver_wage", 0.0) for l in updated_s_legs)
            food_allowance_sum = sum(l.get("finance", {}).get("food_allowance", 0.0) for l in updated_s_legs)
            breakdown_reserve_sum = sum(l.get("finance", {}).get("breakdown_reserve", 0.0) for l in updated_s_legs)
            projected_profit_sum = sum(l.get("finance", {}).get("projected_profit", 0.0) for l in updated_s_legs)
            distance_km_sum = sum(l.get("finance", {}).get("distance_km", 0.0) for l in updated_s_legs)
            
            s["finance"] = {
                "suggested_price": round(suggested_price_sum, 2),
                "total_cost": round(total_cost_sum, 2),
                "fuel_budget": round(fuel_budget_sum, 2),
                "toll_budget": round(toll_budget_sum, 2),
                "driver_wage": round(driver_wage_sum, 2),
                "food_allowance": round(food_allowance_sum, 2),
                "breakdown_reserve": round(breakdown_reserve_sum, 2),
                "projected_profit": round(projected_profit_sum, 2),
                "margin": round(projected_profit_sum, 2),
                "distance_km": round(distance_km_sum, 2)
            }
            s["route_type"] = "multi-leg"
            shipments_db.update(s_id, s)
        else:
            # Standalone direct shipment
            v_id = s.get("assigned_vehicle_id")
            v_type = "van"
            if v_id:
                v = vehicles_db.get_by_id(v_id)
                if v:
                    v_type = v.get("type", "van")
                    
            finance = estimate_delivery_cost(s, v_type)
            finance["expected_profit"] = finance.get("projected_profit", 0)
            s["finance"] = finance
            s["route_type"] = "direct"
            shipments_db.update(s_id, s)
            
    print(f"[Migration] Successfully migrated {len(all_shipments)} shipments.")
