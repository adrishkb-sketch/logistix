import math
from backend.models import Location, Shipment, ShipmentEvent
from backend.database import JSONDatabase
import uuid
from datetime import datetime, timedelta

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    # Radius of earth in kilometers. Use 3956 for miles
    r = 6371

    # Convert decimal degrees to radians 
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    # a = sin²(Δφ/2) + cos φ1 ⋅ cos φ2 ⋅ sin²(Δλ/2)
    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2

    # c = 2 ⋅ atan2( √a, √(1−a) )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    # d = R ⋅ c
    distance = r * c
    return distance

def calculate_route_type(pickup: Location, drop: Location, company_id: str) -> str:
    distance = haversine(pickup.lat, pickup.lng, drop.lat, drop.lng)
    if distance < 50:
        return "direct"
        
    wh_p = find_nearest_warehouse(pickup.lat, pickup.lng, company_id)
    wh_d = find_nearest_warehouse(drop.lat, drop.lng, company_id)
    
    if not wh_p or not wh_d:
        return "direct"

    dist_to_wh_p = haversine(pickup.lat, pickup.lng, wh_p["lat"], wh_p["lng"])
    dist_to_wh_d = haversine(drop.lat, drop.lng, wh_d["lat"], wh_d["lng"])
    
    if distance < dist_to_wh_p or distance < dist_to_wh_d:
        return "direct"

    return "warehouse_hop"

def find_nearest_warehouse(lat: float, lng: float, company_id: str) -> dict:
    warehouses_db = JSONDatabase("warehouses")
    all_wh = warehouses_db.get_all()
    company_wh = [w for w in all_wh if w and w.get("company_id") == company_id]
    
    if not company_wh:
        return None
        
    nearest = min(company_wh, key=lambda w: haversine(lat, lng, w["lat"], w["lng"]))
    return nearest

def find_nearest_safe_warehouse(lat: float, lng: float, company_id: str, disaster_cells: list) -> dict:
    warehouses_db = JSONDatabase("warehouses")
    all_wh = warehouses_db.get_all()
    company_wh = [w for w in all_wh if w and w.get("company_id") == company_id]
    
    safe_whs = []
    for wh in company_wh:
        in_zone = False
        for cell in disaster_cells:
            if not cell:
                continue
            calamities = ["cyclone", "flood", "heatwave", "earthquake", "hail", "riot", "storm"]
            c_type = str(cell.get("type", "")).lower()
            if not any(c in c_type for c in calamities):
                continue
                
            if cell.get("shapeType") == "polyline":
                for pt in cell.get("coordinates", []):
                    if haversine(wh["lat"], wh["lng"], pt["lat"], pt["lng"]) <= 5.0:
                        in_zone = True
                        break
            else:
                r = cell.get("radius", 50.0)
                dist = haversine(wh["lat"], wh["lng"], cell.get("lat", 0.0), cell.get("lng", 0.0))
                if dist <= r:
                    in_zone = True
                    break
        if not in_zone:
            safe_whs.append(wh)
            
    if not safe_whs:
        return None
        
    nearest = min(safe_whs, key=lambda w: haversine(lat, lng, w["lat"], w["lng"]))
    return nearest

def check_and_reroute_calamities(shipment: dict, disaster_cells: list = None) -> bool:
    if shipment.get("status") not in ["assigned", "in_transit"]:
        return False

    if disaster_cells is None:
        from backend.routers.tracking import get_all_active_weather_cells
        disaster_cells = get_all_active_weather_cells(shipment.get("company_id"))
        
    curr_loc = shipment.get("current_location") or shipment.get("pickup")
    if not curr_loc or not curr_loc.get("lat"):
        return False
        
    lat, lng = curr_loc["lat"], curr_loc["lng"]
    dest = shipment["drop"]
    
    intersecting_calamity = None
    for cell in disaster_cells:
        if not cell:
            continue
        calamities = ["cyclone", "flood", "heatwave", "earthquake", "hail", "riot", "storm"]
        c_type = str(cell.get("type", "")).lower()
        if not any(c in c_type for c in calamities):
            continue
            
        intersects = False
        if cell.get("shapeType") == "polyline":
            for pt in cell.get("coordinates", []):
                if haversine(lat, lng, pt["lat"], pt["lng"]) <= 5.0 or haversine(dest["lat"], dest["lng"], pt["lat"], pt["lng"]) <= 5.0:
                    intersects = True
                    break
        else:
            r = cell.get("radius", 50.0)
            dist_curr = haversine(lat, lng, cell.get("lat", 0.0), cell.get("lng", 0.0))
            dist_dest = haversine(dest["lat"], dest["lng"], cell.get("lat", 0.0), cell.get("lng", 0.0))
            if dist_curr <= r or dist_dest <= r:
                intersects = True
                
        if intersects:
            intersecting_calamity = cell
            break
            
    if not intersecting_calamity:
        return False
        
    company_id = shipment.get("company_id")
    calamity_type = intersecting_calamity["type"].upper()
    
    from backend.database import JSONDatabase
    from backend.models import Alert, ShipmentEvent
    alerts_db = JSONDatabase("alerts")
    shipments_db = JSONDatabase("shipments")
    
    existing_alert = next((a for a in alerts_db.get_all() if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "calamity_divert" and a.get("status") == "active"), None)
    if existing_alert:
        return False
        
    safe_wh = find_nearest_safe_warehouse(lat, lng, company_id, disaster_cells)
    if safe_wh:
        shipment["drop"] = {"lat": safe_wh["lat"], "lng": safe_wh["lng"], "address": safe_wh["name"]}
        shipment["drop_warehouse_id"] = safe_wh["id"]
        shipment["stage"] = f"Diverted: Safe Hub ({safe_wh['name']})"
        shipment["status"] = "assigned"
        
        log = ShipmentEvent(
            status="assigned",
            message=f"🚨 AI CALAMITY ROUTING: Automatically rerouted vehicle to safe hub '{safe_wh['name']}' outside the {calamity_type} affected region.",
            reason=f"Natural Calamity: {calamity_type}"
        )
        shipment["logs"] = shipment.get("logs", []) + [log.model_dump()]
        shipments_db.update(shipment["id"], shipment)
        
        alert = Alert(
            company_id=company_id,
            type="calamity_divert",
            severity="critical",
            description=f"AI DIVERSION: Shipment {shipment['id'][:8]} rerouted to safe hub {safe_wh['name']} due to active {calamity_type} calamity.",
            suggestion=f"Verify driver safety and cargo status at {safe_wh['name']}. Safe hub is outside the affected region.",
            shipment_id=shipment["id"],
            driver_id=shipment.get("assigned_driver_id")
        )
        alerts_db.insert(alert.model_dump())
        return True
    else:
        shipment["stage"] = "Halted: Disaster Zone"
        shipment["status"] = "delayed"
        
        log = ShipmentEvent(
            status="delayed",
            message=f"🚨 AI EMERGENCY HALT: Halted operations in open safe area. No safe hubs available outside {calamity_type} zone.",
            reason=f"Natural Calamity: {calamity_type}"
        )
        shipment["logs"] = shipment.get("logs", []) + [log.model_dump()]
        shipments_db.update(shipment["id"], shipment)
        
        alert = Alert(
            company_id=company_id,
            type="calamity_divert",
            severity="critical",
            description=f"AI HALT: Shipment {shipment['id'][:8]} forced to halt due to {calamity_type} calamity zone. No safe hubs available.",
            suggestion="Contact driver immediately to ensure safety. Maintain halt status until calamity zone clears.",
            shipment_id=shipment["id"],
            driver_id=shipment.get("assigned_driver_id")
        )
        alerts_db.insert(alert.model_dump())
        return True

def decompose_shipment(shipment: dict) -> list:
    """
    World's Strongest Route Splitter logic (Refined):
    1. If distance < 50km, no split (direct).
    2. Find nearest warehouses Wp and Wd.
    3. If direct distance < dist(P, Wp) or direct distance < dist(D, Wd), stay direct.
    4. Omit first_mile if pickup is within 2km of Wp.
    5. Omit last_mile if drop is within 2km of Wd.
    """
    p_lat, p_lng = shipment["pickup"]["lat"], shipment["pickup"]["lng"]
    d_lat, d_lng = shipment["drop"]["lat"], shipment["drop"]["lng"]
    company_id = shipment["company_id"]
    
    dist_total = haversine(p_lat, p_lng, d_lat, d_lng)
    
    if dist_total < 50:
        return []

    wh_p = find_nearest_warehouse(p_lat, p_lng, company_id)
    wh_d = find_nearest_warehouse(d_lat, d_lng, company_id)
    
    if not wh_p or not wh_d:
        return []

    dist_to_wh_p = haversine(p_lat, p_lng, wh_p["lat"], wh_p["lng"])
    dist_to_wh_d = haversine(d_lat, d_lng, wh_d["lat"], wh_d["lng"])
    
    # REFINEMENT: If direct distance is shorter than going to the "nearest" hub, don't split
    if dist_total < dist_to_wh_p or dist_total < dist_to_wh_d:
        return []

    legs = []
    leg_order = 1
    
    # 1. First Mile Leg
    if dist_to_wh_p > 2.0:
        legs.append({
            "pickup": shipment["pickup"],
            "drop": {"lat": wh_p["lat"], "lng": wh_p["lng"], "address": wh_p["name"]},
            "drop_warehouse_id": wh_p["id"],
            "leg_type": "first_mile",
            "leg_order": leg_order
        })
        leg_order += 1
        
    # 2. Middle Mile Leg (Only if Wp != Wd)
    if wh_p["id"] != wh_d["id"]:
        legs.append({
            "pickup": {"lat": wh_p["lat"], "lng": wh_p["lng"], "address": wh_p["name"]},
            "drop": {"lat": wh_d["lat"], "lng": wh_d["lng"], "address": wh_d["name"]},
            "pickup_warehouse_id": wh_p["id"],
            "drop_warehouse_id": wh_d["id"],
            "leg_type": "middle_mile",
            "leg_order": leg_order
        })
        leg_order += 1
        
    # 3. Last Mile Leg
    if dist_to_wh_d > 2.0:
        legs.append({
            "pickup": {"lat": wh_d["lat"], "lng": wh_d["lng"], "address": wh_d["name"] if wh_p["id"] != wh_d["id"] else wh_p["name"]},
            "drop": shipment["drop"],
            "pickup_warehouse_id": wh_d["id"] if wh_p["id"] != wh_d["id"] else wh_p["id"],
            "leg_type": "last_mile",
            "leg_order": leg_order
        })
        
    return legs

def simulate_traffic(lat: float, lng: float) -> dict:
    """
    Simulates real-time traffic levels based on coordinates.
    """
    import random
    # Deterministic seed for demo stability
    seed = int((abs(lat) + abs(lng)) * 1000) % 100
    if seed < 20: return {"level": "Heavy", "color": "#ef4444", "delay_mult": 2.2, "reason": "Major Congestion"}
    if seed < 50: return {"level": "Moderate", "color": "#f59e0b", "delay_mult": 1.4, "reason": "Slow Moving"}
    return {"level": "Light", "color": "#10b981", "delay_mult": 1.0, "reason": "Free Flow"}

def optimize_multi_stop_route(start_lat: float, start_lng: float, stops: list) -> list:
    """
    Greedy TSP optimization for multi-stop routing.
    """
    optimized = []
    current_lat, current_lng = start_lat, start_lng
    remaining = list(stops)
    
    while remaining:
        next_stop = min(remaining, key=lambda s: haversine(current_lat, current_lng, s["lat"], s["lng"]))
        optimized.append(next_stop)
        current_lat, current_lng = next_stop["lat"], next_stop["lng"]
        remaining.remove(next_stop)
        
    return optimized

def predict_weather_impact(lat: float, lng: float) -> dict:
    """
    Mock ML Model to predict weather at a given coordinate.
    In production, this would call a weather API or a regional ML model.
    """
    import random
    # Deterministic-ish weather based on lat/lng for demo consistency
    seed = int((lat + lng) * 100) % 100
    if seed < 15: return {"condition": "Storm", "multiplier": 2.5, "icon": "⛈️"}
    if seed < 40: return {"condition": "Rain", "multiplier": 1.5, "icon": "🌧️"}
    if seed < 60: return {"condition": "Cloudy", "multiplier": 1.1, "icon": "☁️"}
    return {"condition": "Clear", "multiplier": 1.0, "icon": "☀️"}

def calculate_dynamic_eta(distance_km: float, v_type: str, weather: dict, fatigue: int, health: int, lat: float = 0, lng: float = 0, wait_time_mins: int = 0) -> dict:
    """
    AI Model to calculate adjusted ETA.
    """
    # Base speed in km/h
    base_speed = 40 # Average city speed
    if "truck" in v_type.lower(): base_speed = 60
    if v_type.lower() in ["bike", "scooty"]: base_speed = 35
    
    base_time_mins = (distance_km / base_speed) * 60
    
    # Weather Impact
    w_mult = weather["multiplier"]
    # Bikes/Scootys are hit harder by rain
    if weather["condition"] in ["Rain", "Storm"] and v_type.lower() in ["bike", "scooty"]:
        w_mult *= 1.8
        
    # Fatigue Impact (Driver slows down)
    f_mult = 1.0 + (fatigue / 200.0) # Max +50% delay
    
    # Traffic Impact
    traffic = simulate_traffic(lat, lng) if lat != 0 else {"delay_mult": 1.0, "level": "Unknown"}
    t_mult = traffic["delay_mult"]

    # Health Impact (Vehicle issues)
    h_mult = 1.0 + ((100 - health) / 200.0) # Max +50% delay
    
    adjusted_time = (base_time_mins * w_mult * f_mult * h_mult * t_mult) + wait_time_mins
    delay = adjusted_time - base_time_mins
    
    return {
        "base_mins": round(base_time_mins),
        "adjusted_mins": round(adjusted_time),
        "delay_mins": round(delay),
        "wait_time_mins": wait_time_mins,
        "weather": weather["condition"],
        "weather_icon": weather["icon"],
        "factors": {
            "weather_impact": round((w_mult - 1) * 100),
            "fatigue_impact": round((f_mult - 1) * 100),
            "health_impact": round((h_mult - 1) * 100),
            "wait_impact_mins": wait_time_mins
        }
    }

def check_shipment_performance(shipment: dict, driver: dict = None, vehicle: dict = None) -> dict:
    from datetime import datetime, timezone, timedelta
    
    now = datetime.now(timezone.utc)
    try:
        expected = datetime.fromisoformat(shipment["expected_delivery"].replace('Z', '+00:00'))
        if expected.tzinfo is None:
            expected = expected.replace(tzinfo=timezone.utc)
    except Exception:
        return {"status": "on_time", "diff_mins": 0}
    
    curr_loc = shipment.get("current_location") or shipment.get("pickup")
    dest = shipment["drop"]
    
    dist = haversine(curr_loc["lat"], curr_loc["lng"], dest["lat"], dest["lng"])
    
    # Get impact factors
    weather = predict_weather_impact(curr_loc["lat"], curr_loc["lng"])
    v_type = vehicle["type"] if vehicle else "van"
    fatigue = driver.get("fatigue_score", 0) if driver else 0
    health = vehicle.get("vehicle_health_score", 100) if vehicle else 100
    
    eta_info = calculate_dynamic_eta(dist, v_type, weather, fatigue, health, curr_loc["lat"], curr_loc["lng"])
    
    predicted_arrival = now + timedelta(minutes=eta_info["adjusted_mins"])
    diff = (predicted_arrival - expected).total_seconds() / 60.0
    
    status = "on_time"
    if diff > 10: status = "delayed"
    elif diff < -10: status = "early"
    
    return {
        "status": status,
        "diff_mins": round(diff),
        "eta_mins": eta_info["adjusted_mins"],
        "weather": eta_info["weather"],
        "traffic": simulate_traffic(curr_loc["lat"], curr_loc["lng"]),
        "factors": eta_info["factors"],
        "predicted_arrival": predicted_arrival.isoformat(),
        "dist_remaining_km": round(dist, 1)
    }

def check_drone_viability(lat: float, lng: float, dest_lat: float, dest_lng: float, weight: float = 0.0) -> dict:
    """
    AI model to decide if the last-mile should be a drone leg.
    Criteria: Distance <= 10km, Weight <= 5kg, and High Traffic/Congestion area.
    """
    dist = haversine(lat, lng, dest_lat, dest_lng)
    
    # Mock Traffic Engine
    # In a real app, this would query Google Traffic or TomTom
    seed = int((dest_lat + dest_lng) * 100) % 100
    is_congested = seed > 40 # 60% of urban areas marked as congested
    
    viable = dist <= 10.0 and weight <= 5.0 and is_congested
    
    reason = "Traffic congestion detected. Drone delivery recommended."
    if weight > 5.0:
        reason = "Shipment too heavy for drone (max 5kg)."
    elif dist > 10.0:
        reason = "Destination out of drone range (max 10km)."
    elif not is_congested:
        reason = "Direct truck/van delivery is optimal (low traffic)."
        
    return {
        "viable": viable,
        "distance": round(dist, 2),
        "is_congested": is_congested,
        "reason": reason
    }
