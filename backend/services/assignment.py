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
    dist = haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], shipment["drop"]["lat"], shipment["drop"]["lng"])
    
    # Predict weather for the route (pickup point)
    weather = predict_weather_impact(shipment["pickup"]["lat"], shipment["pickup"]["lng"])
    
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
    
    for d in drivers:
        # Recalculate vital stats for real-time accuracy
        d["fatigue_score"] = calculate_fatigue(d)
        d["driving_score"] = calculate_driver_performance_score(d)
        
        # STRICT BLOCK: Driver fatigue too high
        if d.get("fatigue_score", 0) > 80:
            continue
            
        if d.get("assigned_vehicle_id") and d.get("verification_status") == "verified":
            vehicle = next((v for v in vehicles if v["id"] == d["assigned_vehicle_id"]), None)
            if vehicle and vehicle.get("status") in ["available", "assigned"]:
                # Check Vehicle Health vs Distance
                health = vehicle.get("vehicle_health_score", 100)
                if dist > 50 and health < 60:
                    continue # Do not send unhealthy vehicles on long trips
                
                # Calculate current load
                active_for_vehicle = [s for s in all_shipments if s.get("assigned_vehicle_id") == vehicle["id"] and s.get("status") in ["assigned", "in_transit"]]
                current_weight = sum(s.get("weight", 0) for s in active_for_vehicle)
                
                if current_weight + shipment.get("weight", 0) <= vehicle.get("capacity", 0):
                    
                    # Base Warehouse limits
                    if vehicle.get("base_warehouse_id"):
                        wh = next((w for w in warehouses if w["id"] == vehicle["base_warehouse_id"]), None)
                        if wh:
                            base_dist = haversine(wh["lat"], wh["lng"], shipment["pickup"]["lat"], shipment["pickup"]["lng"])
                            v_type = vehicle.get("type", "")
                            
                            if v_type in ["bike", "scooty"] and base_dist > 15: continue
                            if v_type == "3 wheeled (battery)" and base_dist > 30: continue
                            if v_type == "3 wheeled (non EV)" and base_dist > 40: continue
                            if v_type == "small van" and base_dist > 60: continue
                            if v_type == "large van" and base_dist > 100: continue
                            
                    # Check route distance constraints
                    v_type_short = vehicle.get("type", "")
                    if dist > 50 and v_type_short in ["bike", "scooty", "3 wheeled (battery)", "3 wheeled (non EV)"]:
                        continue # Skip short range vehicles for long distance routes
                    
                    # WEATHER BLOCK: Safety constraint
                    if weather["condition"] in ["Storm", "Rain"] and v_type_short in ["bike", "scooty"]:
                        if d.get("safety_rating", 5) < 4: continue # Unsafe bikes in rain
                    
                    score_modifier = 0
                    if weather["condition"] in ["Storm", "Rain"]:
                        if v_type_short in ["truck", "large van"]: score_modifier += 20
                        if v_type_short in ["bike", "scooty"]: score_modifier -= 30
                    if dist < 30 and v_type_short in ["bike", "scooty"]: score_modifier += 10
                    if dist > 50 and v_type_short == "truck": score_modifier += 10
                    
                    # Boost score if shipment is fragile and driver is safe
                    labels = shipment.get("labels", [])
                    if "fragile" in labels or "priority" in labels:
                        score_modifier += d.get("safety_rating", 5) * 2
                        score_modifier += (d.get("on_time_rate", 100) / 10.0)
                    
                    available_pairs.append({"driver": d, "vehicle": vehicle, "score_modifier": score_modifier})
                
    if not available_pairs:
        return None
        
    # Sort pairs by driver performance and score modifier
    best_pair = sorted(available_pairs, key=lambda p: (
        -(p["driver"].get("driving_score", 0) + p["score_modifier"] + p["driver"].get("safety_rating", 5) * 5), 
        p["driver"].get("challan_count", 0),
        p["driver"].get("fatigue_score", 0)
    ))[0]
    
    return {
        "assigned_driver_id": best_pair["driver"]["id"],
        "assigned_vehicle_id": best_pair["vehicle"]["id"],
        "status": "assigned",
        "stage": "Assigned to Driver"
    }

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
