from backend.database import JSONDatabase
from typing import Dict, Any, Optional
import uuid

drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")

def auto_assign_shipment(shipment: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    World's Strongest Vehicle Assignment Engine.
    Rules:
    1. Weight limit: No shipment above 100kg.
    2. Leg-based vehicle restrictions:
       - First/Last mile & Direct: EV-Cargo, Bike/Scooty, Delivery Van.
       - Last mile: Try Drone FIRST.
       - Middle mile: Large/Small Trucks only.
    3. Storage rules: Trucks can stay at other warehouses; others return to base.
    4. Back-haul Preference: Prefer trucks returning to their base warehouse.
    5. Weather safety: Avoid bikes/scootys in bad weather.
    6. Rating Priority: Highest driver performance first.
    7. Capacity Check: Respect vehicle carrying capacity.
    """
    from backend.services.route_engine import haversine, predict_weather_impact
    from backend.services.driver_intel import calculate_driver_performance_score, calculate_fatigue
    from backend.services.finance_engine import estimate_delivery_cost
    from backend.database import JSONDatabase
    import uuid

    # 1. Weight Guard
    if shipment.get("weight", 0) > 100:
        return None

    # Identify Legs
    p_wh_id = shipment.get("pickup_warehouse_id")
    d_wh_id = shipment.get("drop_warehouse_id")
    leg_type = shipment.get("leg_type") # first_mile, middle_mile, last_mile

    is_first_mile = leg_type == "first_mile" or (d_wh_id and not p_wh_id)
    is_last_mile = leg_type == "last_mile" or (p_wh_id and not d_wh_id)
    is_middle_mile = leg_type == "middle_mile" or (p_wh_id and d_wh_id)
    is_direct = not p_wh_id and not d_wh_id

    # 2. Last Leg Drone Check
    if is_last_mile or is_direct:
        from backend.services.route_engine import check_drone_viability
        p_lat, p_lng = shipment["pickup"]["lat"], shipment["pickup"]["lng"]
        d_lat, d_lng = shipment["drop"]["lat"], shipment["drop"]["lng"]
        
        # If it's a last mile from a warehouse, the warehouse must have drones
        source_wh_id = p_wh_id if is_last_mile else None
        warehouses_db = JSONDatabase("warehouses")
        
        if source_wh_id:
            wh = warehouses_db.get_by_id(source_wh_id)
            if wh and wh.get("drone_count", 0) > 0:
                drone_intel = check_drone_viability(p_lat, p_lng, d_lat, d_lng, shipment.get("weight", 0))
                if drone_intel.get("viable"):
                    # Consume drone and assign
                    warehouses_db.update(source_wh_id, {"drone_count": wh["drone_count"] - 1})
                    return {
                        "assigned_driver_id": "DRONE-SYSTEM",
                        "assigned_vehicle_id": f"DRONE-{source_wh_id[:4]}-{uuid.uuid4().hex[:4]}",
                        "status": "in_transit",
                        "stage": "Drone Air Delivery",
                        "route_type": "drone-leg",
                        "finance": estimate_delivery_cost(shipment, "drone")
                    }

    # Gather Data
    company_id = shipment.get("company_id")
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    shipments_db = JSONDatabase("shipments")
    
    drivers = [d for d in drivers_db.get_all() if d and d.get("company_id") == company_id]
    vehicles = [v for v in vehicles_db.get_all() if v and v.get("company_id") == company_id]
    all_shipments = shipments_db.get_all()
    
    # Weather Check for bikes
    weather = predict_weather_impact(shipment["pickup"]["lat"], shipment["pickup"]["lng"])
    bad_weather = weather.get("condition") in ["Storm", "Rain"]

    available_pairs = []

    for d in drivers:
        # Eligibility Checks
        if d.get("status") != "available" or d.get("is_fit") == False:
            continue
        
        v_id = d.get("assigned_vehicle_id")
        if not v_id: continue
        
        vehicle = next((v for v in vehicles if v.get("id") == v_id), None)
        if not vehicle or vehicle.get("is_operational") == False:
            continue
        
        v_type = vehicle.get("type", "")
        v_base = vehicle.get("base_warehouse_id")
        
        # Rule: First/Last/Direct Mile Vehicles
        L_MILE_TYPES = ["EV-Cargo", "Bike/Scooty", "Delivery Van", "Scooty", "Bike"]
        # Rule: Middle Mile Vehicles
        M_MILE_TYPES = ["Large Truck", "Small Truck", "Truck (Heavy)"]

        if is_first_mile or is_last_mile or is_direct:
            if not any(t in v_type for t in L_MILE_TYPES):
                continue
            # Rule: Must be at base warehouse (simplified: check v_base)
            if v_base and is_first_mile and v_base != d_wh_id: continue
            if v_base and is_last_mile and v_base != p_wh_id: continue
        
        if is_middle_mile:
            if not any(t in v_type for t in M_MILE_TYPES):
                continue
            # Middle mile can use trucks stationed at source warehouse even if base is different
        
        # Weather Check
        if bad_weather and any(t in v_type for t in ["Bike", "Scooty"]):
            continue

        # Capacity Check
        active_for_v = [s for s in all_shipments if s and s.get("assigned_vehicle_id") == vehicle["id"] and s.get("status") in ["assigned", "in_transit"]]
        curr_load = sum(s.get("weight", 0) for s in active_for_v)
        if curr_load + shipment.get("weight", 0) > vehicle.get("capacity", 0):
            continue

        # GEOGRAPHIC HARD-FENCING (Preventing Bhubaneswar-to-Kashmir errors)
        dist_to_pickup = 0
        if v_base:
            warehouses_db = JSONDatabase("warehouses")
            base_wh = warehouses_db.get_by_id(v_base)
            if base_wh:
                dist_to_pickup = haversine(base_wh["lat"], base_wh["lng"], p["lat"], p["lng"])
        else:
            v_loc = vehicle.get("current_location") or p
            dist_to_pickup = haversine(v_loc["lat"], v_loc["lng"], p["lat"], p["lng"])

        # Hard Limit: Small vehicles cannot travel across states for a single pickup
        if (is_direct or is_first_mile or is_last_mile) and any(t in v_type for t in L_MILE_TYPES):
            if dist_to_pickup > 50: # 50km Hard Fence
                continue

        # Scoring
        score = calculate_driver_performance_score(d) + (d.get("safety_rating", 5) * 10)
        
        # Proximity Penalty (Aggressive)
        score -= (dist_to_pickup * 100) # 100 points per KM penalty
        
        # Back-haul Preference (Middle Mile)
        if is_middle_mile and v_base == d_wh_id:
            score += 10000 # Massive boost for returning home

        available_pairs.append({
            "driver": d,
            "vehicle": vehicle,
            "score": score
        })

    if not available_pairs:
        # Return a marker so the router knows no vehicles available
        return {"error": "No suitable vehicles available for this leg configuration."}

    # Sort by Score
    available_pairs.sort(key=lambda x: x["score"], reverse=True)
    best = available_pairs[0]

    return {
        "assigned_driver_id": best["driver"]["id"],
        "assigned_vehicle_id": best["vehicle"]["id"],
        "status": "assigned",
        "stage": "Assigned to Driver",
        "finance": estimate_delivery_cost(shipment, best["vehicle"]["type"].lower()),
        "pickup_deadline": None # Removing ETA per request
    }

def assign_rescue_vehicle(driver_id: str, vehicle_id: str, location: Dict[str, Any]):
    from backend.database import JSONDatabase
    from datetime import datetime
    shipments_db = JSONDatabase("shipments")
    vehicles_db = JSONDatabase("vehicles")
    drivers_db = JSONDatabase("drivers")
    
    all_shipments = shipments_db.get_all()
    broken_shipments = [s for s in all_shipments if s and s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit"]]
    
    if not broken_shipments: return None
    
    driver = drivers_db.get_by_id(driver_id)
    company_id = driver.get("company_id")
    total_weight = sum(s.get("weight", 0) for s in broken_shipments)
    
    potential_rescuers = [d for d in drivers_db.get_all() if d and d.get("company_id") == company_id and d.get("id") != driver_id]
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
    active_tasks = [s for s in shipments_db.get_all() if s and s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit"]]
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
