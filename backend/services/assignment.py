from backend.database import JSONDatabase
from typing import Dict, Any, Optional
import uuid

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

    # Identify Target Hub and Leg Type
    p_wh_id = shipment.get("pickup_warehouse_id")
    d_wh_id = shipment.get("drop_warehouse_id")
    leg_type = shipment.get("leg_type") # first_mile, middle_mile, last_mile
    
    is_first_mile = leg_type == "first_mile" or (d_wh_id and not p_wh_id)
    is_last_mile = leg_type == "last_mile" or (p_wh_id and not d_wh_id)
    is_middle_mile = leg_type == "middle_mile" or (p_wh_id and d_wh_id)

    # PRIORITY MAPPING
    FM_LM_PRIORITY = {
        "Bike/Scooty": 1000,
        "Bike": 1000,
        "Scooty": 1000,
        "EV-Cargo": 800,
        "Delivery Van": 600,
        "Small Truck": 400,
        "Truck (Heavy)": 200
    }

    MM_PRIORITY = {
        "Truck (Heavy)": 1000,
        "Small Truck": 800,
        "Delivery Van": 600,
        "EV-Cargo": 400,
        "Bike/Scooty": 200,
        "Bike": 200,
        "Scooty": 200
    }

    # DRONE PRIORITY: Last Mile (Highest Priority)
    if is_last_mile:
        p_wh = next((w for w in warehouses if w["id"] == p_wh_id), None)
        if p_wh and p_wh.get("drone_count", 0) > 0:
            from backend.services.route_engine import check_drone_viability
            drone_intel = check_drone_viability(p_wh["lat"], p_wh["lng"], shipment["drop"]["lat"], shipment["drop"]["lng"], shipment.get("weight", 0))
            if drone_intel["viable"]:
                # Check if drone is already in use (mock check: random 20% busy or database check)
                # In this system, we consume drone count, so it acts as availability
                
                # Automated Drone Assignment
                from backend.services.finance_engine import estimate_delivery_cost
                finance_data = estimate_delivery_cost(shipment, "drone")
                
                # Consume drone
                p_wh["drone_count"] -= 1
                warehouses_db.update(p_wh["id"], {"drone_count": p_wh["drone_count"]})
                
                return {
                    "assigned_driver_id": "DRONE-SYSTEM",
                    "assigned_vehicle_id": f"DRONE-{p_wh['id'][:4]}-{uuid.uuid4().hex[:4]}",
                    "status": "in_transit",
                    "stage": "Drone Air Delivery",
                    "route_type": "drone-leg",
                    "finance": finance_data
                }

    for d in drivers:
        # Recalculate vital stats for real-time accuracy
        d["fatigue_score"] = calculate_fatigue(d)
        d["driving_score"] = calculate_driver_performance_score(d)
        
        # SOFTEN VERIFICATION: Prefer verified, but accept unverified if no other choice
        # 1. Driver must be available
        if d.get("status") != "available":
            continue
            
        # 2. Check for Vehicle (Linked or Auto-Linkable)
        vehicle = None
        v_id = d.get("assigned_vehicle_id")
        
        if v_id:
            vehicle = next((v for v in vehicles if v.get("id") == v_id), None)
        
        # AUTO-LINK LOGIC: If driver has no vehicle, find one at their base hub
        if not vehicle and d.get("base_warehouse_id"):
            base_wh = d.get("base_warehouse_id")
            # Find an unassigned vehicle of the "right" type for this leg at this hub
            v_type_pref = "Truck" if is_middle_mile else ("Bike" if dist < 20 else "Van")
            
            compatible_v = [
                v for v in vehicles 
                if v.get("base_warehouse_id") == base_wh 
                and v.get("status") == "available" 
                and not v.get("assigned_driver_id")
            ]
            
            if compatible_v:
                # Prefer the type we want
                pref_v = next((v for v in compatible_v if v_type_pref in v.get("type", "")), compatible_v[0])
                vehicle = pref_v
                # We'll link them in the final assignment step
        
        if vehicle and vehicle.get("status") in ["available", "assigned"]:
            v_type = vehicle.get("type", "")
            v_base = vehicle.get("base_warehouse_id")
            
            # 3. VERIFICATION WEIGHTING
            v_status = d.get("verification_status", "unverified")
            verification_score = 1000 if v_status == "verified" else (500 if v_status == "pending_manual" else 0)
            
            # 4. STRICT HUB FILTERING (Relaxed slightly: only for legs, not for direct)
            if is_first_mile:
                if v_base and v_base != d_wh_id:
                    continue # MUST be based at the collection hub for hub-handoff
            elif is_last_mile:
                if v_base and v_base != p_wh_id:
                    continue # MUST be based at the delivery hub for dispatch
            elif is_middle_mile:
                if v_base and v_base != p_wh_id and v_base != d_wh_id:
                    continue # MUST be based at one of the leg's hubs
            
            # 5. MIDDLE MILE TRUCK PREFERENCE (Softened to score rather than block)
            mm_truck_score = 1000 if (is_middle_mile and "Truck" in v_type) else 0
            
            # 6. WEATHER/HEATWAVE BLOCK (Strict for safety)
            if (weather["condition"] in ["Storm", "Rain"] or is_heatwave) and any(x in v_type for x in ["Bike", "Scooty"]):
                continue 
            
            # 7. Check Vehicle Health vs Distance
            health = vehicle.get("vehicle_health_score", 100)
            if dist > 50 and health < 40: # Relaxed from 60
                continue 
            
            # 8. Capacity Check
            curr_v_id = vehicle.get("id")
            active_for_vehicle = [s for s in all_shipments if s.get("assigned_vehicle_id") == curr_v_id and s.get("status") in ["assigned", "in_transit"]]
            current_weight = sum(s.get("weight", 0) for s in active_for_vehicle)
            
            if current_weight + shipment.get("weight", 0) <= vehicle.get("capacity", 0):
                score_modifier = verification_score + mm_truck_score
                
                # BACKHAUL/OUTBOUND BOOSTS
                if is_middle_mile:
                    if v_base == d_wh_id: score_modifier += 800 # BACKHAUL
                    elif v_base == p_wh_id: score_modifier += 500 # OUTBOUND
                
                # SOFT BASE LIMITS
                if v_base:
                    wh = next((w for w in warehouses if w.get("id") == v_base), None)
                    if wh:
                        base_dist = haversine(wh["lat"], wh["lng"], shipment["pickup"]["lat"], shipment["pickup"]["lng"])
                        # Soft penalty instead of block
                        if any(x in v_type for x in ["Bike", "Scooty"]) and base_dist > 30: score_modifier -= 500
                        if "EV" in v_type and base_dist > 60: score_modifier -= 500
                
                # Distance Preference
                if dist < 30 and any(x in v_type for x in ["Bike", "Scooty"]):
                    score_modifier += 800
                if dist > 80 and "Truck" in v_type:
                    score_modifier += 500
                
                wait_time_mins = 0
                # 5. Operational Cost Penalty (Profit Optimization)
                finance_data = estimate_delivery_cost(shipment, v_type.lower())
                total_op_cost = finance_data.get("total_cost", 0)
                score_modifier -= (total_op_cost / 10) # Penalize high cost routes
                
                # 6. Segment-Based Priority Boost
                if is_first_mile or is_last_mile:
                    score_modifier += FM_LM_PRIORITY.get(v_type, 0)
                elif is_middle_mile:
                    score_modifier += MM_PRIORITY.get(v_type, 0)

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
            logs = s.get("logs", [])
            logs.append({
                "status": "assigned",
                "message": f"🚑 RESCUE: Shipments transferred to {new_d['name']} due to vehicle breakdown.",
                "reason": "Automatic rescue initiated.",
                "location": location,
                "timestamp": datetime.utcnow().isoformat() + "Z"
            })
            shipments_db.update(s["id"], {"logs": logs})
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
