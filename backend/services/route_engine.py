import math
from backend.models import Location

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

def calculate_route_type(pickup: Location, drop: Location) -> str:
    distance = haversine(pickup.lat, pickup.lng, drop.lat, drop.lng)
    if distance > 100:
        return "warehouse_hop"
    return "direct"

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

def calculate_dynamic_eta(distance_km: float, v_type: str, weather: dict, fatigue: int, health: int) -> dict:
    """
    AI Model to calculate adjusted ETA.
    """
    # Base speed in km/h
    base_speed = 40 # Average city speed
    if v_type == "truck": base_speed = 60
    if v_type in ["bike", "scooty"]: base_speed = 35
    
    base_time_mins = (distance_km / base_speed) * 60
    
    # Weather Impact
    w_mult = weather["multiplier"]
    # Bikes/Scootys are hit harder by rain
    if weather["condition"] in ["Rain", "Storm"] and v_type in ["bike", "scooty"]:
        w_mult *= 1.8
        
    # Fatigue Impact (Driver slows down)
    f_mult = 1.0 + (fatigue / 200.0) # Max +50% delay
    
    # Health Impact (Vehicle issues)
    h_mult = 1.0 + ((100 - health) / 200.0) # Max +50% delay
    
    adjusted_time = base_time_mins * w_mult * f_mult * h_mult
    delay = adjusted_time - base_time_mins
    
    return {
        "base_mins": round(base_time_mins),
        "adjusted_mins": round(adjusted_time),
        "delay_mins": round(delay),
        "weather": weather["condition"],
        "weather_icon": weather["icon"],
        "factors": {
            "weather_impact": round((w_mult - 1) * 100),
            "fatigue_impact": round((f_mult - 1) * 100),
            "health_impact": round((h_mult - 1) * 100)
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
    
    eta_info = calculate_dynamic_eta(dist, v_type, weather, fatigue, health)
    
    predicted_arrival = now + timedelta(minutes=eta_info["adjusted_mins"])
    diff = (predicted_arrival - expected).total_seconds() / 60.0
    
    status = "on_time"
    if diff > 10: status = "delayed"
    elif diff < -10: status = "early"
    
    return {
        "status": status,
        "diff_mins": round(diff),
        "predicted_arrival": predicted_arrival.isoformat(),
        "weather": weather["condition"],
        "dist_remaining_km": round(dist, 1)
    }

def check_drone_viability(lat: float, lng: float, dest_lat: float, dest_lng: float) -> dict:
    """
    AI model to decide if the last-mile should be a drone leg.
    Criteria: Distance < 5km and High Traffic/Congestion area.
    """
    dist = haversine(lat, lng, dest_lat, dest_lng)
    
    # Mock Traffic Engine
    # In a real app, this would query Google Traffic or TomTom
    seed = int((dest_lat + dest_lng) * 100) % 100
    is_congested = seed > 60 # 40% of urban areas marked as congested
    
    viable = dist < 5.0 and is_congested
    
    return {
        "viable": viable,
        "distance": round(dist, 2),
        "is_congested": is_congested,
        "reason": "Traffic congestion detected in destination zone. Drone delivery recommended." if is_congested else "Direct truck delivery is optimal."
    }
