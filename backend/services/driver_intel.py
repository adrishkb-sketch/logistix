from datetime import datetime, timedelta
from typing import Dict, Any

def parse_iso_datetime(dt_str: str) -> datetime:
    from datetime import timezone
    if not dt_str:
        raise ValueError("Empty datetime string")
    # Clean up JS style Z
    if dt_str.endswith("Z"):
        dt_str = dt_str[:-1] + "+00:00"
    # Handle duplicate timezone offset strings like +00:00+00:00
    if dt_str.endswith("+00:00+00:00"):
        dt_str = dt_str[:-6]
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

def calculate_fatigue(driver: Dict[str, Any]) -> float:
    """
    Dynamic Fatigue Model:
    - 6 hours of continuous driving leads to 100% fatigue.
    - 8 hours of rest reduces fatigue from fatigue_before_rest to 0.
    - Inactive time (no active drive, no active rest) decays fatigue at 12.5% per hour.
    """
    from datetime import timezone
    now = datetime.now(timezone.utc)
    
    # 1. Check if currently driving
    cond_start = driver.get("continuous_driving_start")
    if cond_start:
        try:
            start_dt = parse_iso_datetime(cond_start)
            hours_driving = (now - start_dt).total_seconds() / 3600.0
            
            base_fatigue = driver.get("fatigue_at_drive_start", 0.0)
            fatigue = base_fatigue + (hours_driving / 6.0) * 100.0
            return round(max(0.0, min(100.0, fatigue)), 2)
        except:
            pass

    # 2. Check if resting
    last_rest = driver.get("last_rest_start")
    if last_rest:
        try:
            rest_dt = parse_iso_datetime(last_rest)
            hours_rested = (now - rest_dt).total_seconds() / 3600.0
            
            base_fatigue = driver.get("fatigue_before_rest", 100.0)
            fatigue = base_fatigue - (hours_rested / 8.0) * 100.0
            return round(max(0.0, fatigue), 2)
        except:
            pass

    # 3. Check if inactive
    last_drive_end = driver.get("last_drive_end")
    if last_drive_end:
        try:
            end_dt = parse_iso_datetime(last_drive_end)
            hours_inactive = (now - end_dt).total_seconds() / 3600.0
            
            base_fatigue = driver.get("fatigue_at_drive_end", 0.0)
            fatigue = base_fatigue - (hours_inactive / 8.0) * 100.0
            return round(max(0.0, fatigue), 2)
        except:
            pass

    return round(max(0.0, min(100.0, driver.get("fatigue_score", 0.0))), 2)

def calculate_safety_rating(driver: Dict[str, Any]) -> float:
    """
    Safety rating based on:
    - Years of Experience: +0.1 per year (max 5.0)
    - Accidents: -1.0 per accident
    - Violations/Challans: -0.2 per violation
    """
    exp = float(driver.get("years_experience", 0.0))
    accidents = int(driver.get("past_accidents", 0))
    violations = int(driver.get("traffic_violations", 0))
    
    rating = 5.0
    rating -= (accidents * 1.0)
    rating -= (violations * 0.2)
    rating += (exp * 0.1)
    
    return round(max(1.0, min(5.0, rating)), 1)

def calculate_driver_performance_score(driver: Dict[str, Any]) -> float:
    """
    Performance Score (driving_score):
    - Starts at 100.
    - Safety Rating: 35%
    - Punctuality: 25%
    - Customer Rating: 15%
    - Volume (Trips): 10%
    - Consistency (Operational Days): 15%
    """
    safety_rating = calculate_safety_rating(driver)
    safety_component = (safety_rating / 5.0) * 100
    
    punctuality = driver.get("punctuality_rate", 100.0)
    
    ratings = driver.get("customer_ratings", [])
    avg_rating = (sum(ratings) / len(ratings)) * 20 if ratings else 100.0
    
    trips = min(100, driver.get("total_trips", 0))
    
    # Consistency component (normalized to 100 based on a 30-day target)
    op_days = driver.get("operational_days", 0)
    consistency_component = min(100, (op_days / 30.0) * 100)
    
    # Base weighted score
    score = (safety_component * 0.35) + (punctuality * 0.25) + (avg_rating * 0.15) + (trips * 0.10) + (consistency_component * 0.15)
    
    # Additional penalty for active challans
    challans = driver.get("challan_count", 0)
    score -= (challans * 2.0)
    
    return round(max(0.0, min(100.0, score)), 2)

def calculate_vehicle_efficiency_score(vehicle: Dict[str, Any]) -> float:
    """
    Vehicle Efficiency Score:
    - Health Score (Maintenance): 40%
    - Fuel Efficiency: 40%
    - Consistency (Operational Days): 20%
    """
    health = float(vehicle.get("vehicle_health_score", 100.0))
    fuel_eff = float(vehicle.get("fuel_efficiency", 15.0))
    
    # Max expected fuel efficiency by type
    max_eff_map = {
        "bike": 50, "scooty": 45, 
        "3 wheeled (battery)": 80, "3 wheeled (non EV)": 25,
        "small van": 18, "large van": 14, "truck": 10
    }
    v_type = vehicle.get("type", "small van")
    max_eff = max_eff_map.get(v_type, 15)
    
    fuel_component = (fuel_eff / max_eff) * 100
    
    # Consistency component (normalized to 100 based on a 30-day target)
    op_days = vehicle.get("operational_days", 0)
    consistency_component = min(100, (op_days / 30.0) * 100)
    
    score = (health * 0.4) + (fuel_component * 0.4) + (consistency_component * 0.2)
    return round(max(0.0, min(100.0, score)), 2)
