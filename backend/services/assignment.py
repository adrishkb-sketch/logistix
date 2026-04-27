from backend.database import JSONDatabase
from typing import Dict, Any, Optional

drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")

def auto_assign_shipment(shipment: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Advanced AI Logic:
    # 1. Find all available drivers who are assigned to a vehicle
    # 2. Check current load of vehicle (for multi-shipment)
    # 3. Apply constraints: short legs (<30km) -> prefer bike/van. Long legs (>50km) -> prefer truck.
    
    from backend.services.route_engine import haversine, predict_weather_impact
    # Ensure coordinates exist
    p_lat = shipment.get("pickup", {}).get("lat")
    p_lng = shipment.get("pickup", {}).get("lng")
    d_lat = shipment.get("drop", {}).get("lat")
    d_lng = shipment.get("drop", {}).get("lng")
    
    if p_lat is None or p_lng is None or d_lat is None or d_lng is None:
        return None
        
    dist = haversine(p_lat, p_lng, d_lat, d_lng)
    
    # Predict weather for the route (pickup point)
    weather = predict_weather_impact(p_lat, p_lng)
    
    company_id = shipment.get("company_id")
    drivers = [d for d in drivers_db.get_all() if d.get("company_id") == company_id]
    vehicles = [v for v in vehicles_db.get_all() if v.get("company_id") == company_id]
    warehouses_db = JSONDatabase("warehouses")
    warehouses = [w for w in warehouses_db.get_all() if w.get("company_id") == company_id]
    
    # We need to calculate current load for multi-shipment logic
    shipments_db = JSONDatabase("shipments")
    all_shipments = shipments_db.get_all()
    
    available_pairs = []
    
    from backend.services.driver_intel import calculate_driver_performance_score, calculate_fatigue
    from backend.services.finance_engine import estimate_delivery_cost
    
    # 1. Check for Heatwave in pickup zone
    weather_cells_db = JSONDatabase("weather_cells")
    cells = weather_cells_db.get_all()
    is_heatwave = False
    for cell in cells:
        cond = (cell.get("condition") or cell.get("type") or "").lower()
        if "heat" in cond or "heatwave" in cond:
            if haversine(p_lat, p_lng, cell.get("lat", 0), cell.get("lng", 0)) <= cell.get("radius", 50):
                is_heatwave = True
                break

    # 1. Identify Target Hub and Leg Type
    p_wh_id = shipment.get("pickup_warehouse_id")
    d_wh_id = shipment.get("drop_warehouse_id")
    is_first_mile = d_wh_id and not p_wh_id
    is_last_mile = p_wh_id and not d_wh_id
    is_middle_mile = p_wh_id and d_wh_id
    
    for d in drivers:
        # Recalculate vital stats for real-time accuracy
        d["fatigue_score"] = calculate_fatigue(d)
        d["driving_score"] = calculate_driver_performance_score(d)
        
        # STRICT BLOCK: Driver fatigue too high
        if d.get("fatigue_score", 0) > 80:
            continue
            
        if d.get("assigned_vehicle_id") and d.get("verification_status") == "verified":
            vehicle = next((v for v in vehicles if v.get("id") == d.get("assigned_vehicle_id")), None)
            if vehicle and vehicle.get("status") in ["available", "assigned"]:
                v_type = vehicle.get("type", "")
                v_base = vehicle.get("base_warehouse_id")
                
                # STRICT HUB FILTERING (User Requirement)
                if is_first_mile:
                    if v_base != d_wh_id:
                        continue # MUST be based at the collection hub
                elif is_last_mile:
                    if v_base != p_wh_id:
                        continue # MUST be based at the delivery hub
                elif is_middle_mile:
                    if v_base != p_wh_id and v_base != d_wh_id:
                        continue # MUST be based at one of the leg's hubs (Outbound or Backhaul)

                # MIDDLE MILE TRUCK ENFORCEMENT
                if is_middle_mile and "Truck" not in v_type:
                    continue
                
                # WEATHER/HEATWAVE BLOCK
                if (weather["condition"] in ["Storm", "Rain"] or is_heatwave) and v_type in ["Bike/Scooty", "Bike", "Scooty"]:
                    continue 
                
                # Check Vehicle Health vs Distance
                health = vehicle.get("vehicle_health_score", 100)
                if dist > 50 and health < 60:
                    continue 
                
                # Calculate current load
                v_id = vehicle.get("id")
                active_for_vehicle = [s for s in all_shipments if s.get("assigned_vehicle_id") == v_id and s.get("status") in ["assigned", "in_transit"]]
                current_weight = sum(s.get("weight", 0) for s in active_for_vehicle)
                
                new_total_weight = current_weight + shipment.get("weight", 0)
                if new_total_weight <= vehicle.get("capacity", 0):
                    
                    score_modifier = 0
                    
                    # BACKHAUL/OUTBOUND BOOSTS for Middle Mile
                    if is_middle_mile:
                        if v_base == d_wh_id:
                            score_modifier += 800 # BACKHAUL
                        elif v_base == p_wh_id:
                            score_modifier += 500 # OUTBOUND
                    
                    # Base Warehouse limits (Bikes etc)
                    if v_base:
                        wh = next((w for w in warehouses if w.get("id") == v_base), None)
                        if wh:
                            base_dist = haversine(wh["lat"], wh["lng"], shipment["pickup"]["lat"], shipment["pickup"]["lng"])
                            if v_type == "Bike/Scooty" and base_dist > 15: continue
                            if v_type == "EV-Cargo" and base_dist > 40: continue
                    
                    # TRUCK GROUPING & WAIT LOGIC
                    wait_time_mins = 0
                    if "Truck" in v_type:
                        if new_total_weight >= vehicle.get("capacity", 0) * 0.9:
                            wait_time_mins = 0
                        else:
                            wait_time_mins = 120

                    if weather["condition"] in ["Storm", "Rain"]:
                        if v_type in ["Truck (Heavy)", "Delivery Van"]: score_modifier += 20
                    
                    if dist < 30 and v_type in ["Bike/Scooty", "Bike", "Scooty"]:
                        score_modifier += 500 # Strong preference for small vehicles in urban legs
                        if is_first_mile or is_last_mile:
                            score_modifier += 500 # Extra boost for hub-based first/last mile
                    
                    if dist > 50 and "Truck" in v_type: score_modifier += 10
                    
                    # 5. Operational Cost Penalty (Profit Optimization)
                    finance_data = estimate_delivery_cost(shipment, v_type.lower())
                    total_op_cost = finance_data.get("total_cost", 0)
                    score_modifier -= (total_op_cost / 5) # Penalize high cost routes
                    
                    available_pairs.append({
                        "driver": d, 
                        "vehicle": vehicle, 
                        "score_modifier": score_modifier,
                        "wait_time_mins": wait_time_mins,
                        "finance_data": finance_data
                    })
                
    if not available_pairs:
        return None
        
    # Sort pairs by driver performance and score modifier
    best_pair = sorted(available_pairs, key=lambda p: (
        -(p["driver"].get("driving_score", 0) + p["score_modifier"] + p["driver"].get("safety_rating", 5) * 5), 
        p["driver"].get("challan_count", 0),
        p["driver"].get("fatigue_score", 0)
    ))[0]
    
    # Update expected delivery if there's a wait time
    from datetime import datetime, timedelta
    from backend.services.time_utils import snap_eta_to_business_hours
    
    res = {
        "assigned_driver_id": best_pair["driver"].get("id"),
        "assigned_vehicle_id": best_pair["vehicle"].get("id"),
        "status": "assigned",
        "stage": "Assigned to Driver",
        "finance": best_pair.get("finance_data")
    }

    if best_pair["wait_time_mins"] > 0:
        current_eta_str = shipment.get("expected_delivery")
        if current_eta_str:
            try:
                curr_eta = datetime.fromisoformat(current_eta_str.replace("Z", ""))
                new_eta = curr_eta + timedelta(minutes=best_pair["wait_time_mins"])
                res["expected_delivery"] = snap_eta_to_business_hours(new_eta).isoformat() + "Z"
            except: pass
    
    return res

def assign_rescue_vehicle(driver_id: str, vehicle_id: str, location: Dict[str, Any]):
    from backend.database import JSONDatabase
    from datetime import datetime
    shipments_db = JSONDatabase("shipments")
    vehicles_db = JSONDatabase("vehicles")
    drivers_db = JSONDatabase("drivers")
    
    all_shipments = shipments_db.get_all()
    broken_shipments = [s for s in all_shipments if s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit"]]
    
    if not broken_shipments: return None
    
    driver = drivers_db.get_by_id(driver_id)
    company_id = driver.get("company_id")
    total_weight = sum(s.get("weight", 0) for s in broken_shipments)
    
    potential_rescuers = [d for d in drivers_db.get_all() if d.get("company_id") == company_id and d.get("id") != driver_id]
    rescue_pair = None
    for d in potential_rescuers:
        if d.get("assigned_vehicle_id") and d.get("verification_status") == "verified":
            v = vehicles_db.get_by_id(d["assigned_vehicle_id"])
            if v and v.get("status") == "available" and v.get("capacity", 0) >= total_weight:
                rescue_pair = (d, v)
                break
                
    if rescue_pair:
        new_d, new_v = rescue_pair
        for s in broken_shipments:
            shipments_db.update(s["id"], {
                "assigned_driver_id": new_d["id"],
                "assigned_vehicle_id": new_v["id"],
                "status": "assigned"
            })
            history = s.get("history", [])
            history.append({
                "status": "assigned",
                "message": f"🚑 RESCUE: Shipments transferred to {new_d['name']} due to vehicle breakdown.",
                "reason": "Automatic rescue initiated.",
                "location": location,
                "timestamp": datetime.utcnow().isoformat()
            })
            shipments_db.update(s["id"], {"history": history})
        vehicles_db.update(new_v["id"], {"status": "assigned"})
        return {"driver_name": new_d["name"], "vehicle_id": new_v["id"]}
    return None

def reoptimize_driver_route(driver_id: str):
    from backend.database import JSONDatabase
    from backend.services.route_engine import optimize_multi_stop_route, haversine
    from datetime import datetime, timedelta

    shipments_db = JSONDatabase("shipments")
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")

    # Get all non-delivered tasks for this driver
    active_tasks = [s for s in shipments_db.get_all() if s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit"]]
    if len(active_tasks) < 1: return

    driver = drivers_db.get_by_id(driver_id)
    vehicle = vehicles_db.get_by_id(driver.get("assigned_vehicle_id")) if driver else None
    
    # Start from current vehicle location or first task pickup
    start_lat = vehicle.get("last_known_location", {}).get("lat") if vehicle else active_tasks[0]["pickup"]["lat"]
    start_lng = vehicle.get("last_known_location", {}).get("lng") if vehicle else active_tasks[0]["pickup"]["lng"]

    # Simple Optimization: Group by Shipment
    # 1. Sort shipments by the distance from current location to their PICKUP
    active_tasks.sort(key=lambda s: haversine(start_lat, start_lng, s["pickup"]["lat"], s["pickup"]["lng"]))
    
    # 2. Update deadlines sequentially
    curr_lat, curr_lng = start_lat, start_lng
    current_time = datetime.utcnow()
    
    for s in active_tasks:
        from backend.services.time_utils import snap_eta_to_business_hours
        # Travel to Pickup
        dist_to_p = haversine(curr_lat, curr_lng, s["pickup"]["lat"], s["pickup"]["lng"])
        time_to_p = (dist_to_p / 30.0) * 60.0 # Slow in city
        current_time += timedelta(minutes=time_to_p + 10) # 10m buffer
        shipments_db.update(s["id"], {"pickup_deadline": snap_eta_to_business_hours(current_time).isoformat() + "Z"})
        
        # Travel to Drop
        dist_to_d = haversine(s["pickup"]["lat"], s["pickup"]["lng"], s["drop"]["lat"], s["drop"]["lng"])
        time_to_d = (dist_to_d / 40.0) * 60.0 
        current_time += timedelta(minutes=time_to_d + 15) # 15m buffer
        shipments_db.update(s["id"], {"expected_delivery": snap_eta_to_business_hours(current_time).isoformat() + "Z"})
        
        curr_lat, curr_lng = s["drop"]["lat"], s["drop"]["lng"]

    return active_tasks
