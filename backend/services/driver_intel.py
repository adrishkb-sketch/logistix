from datetime import datetime, timedelta
from typing import Dict, Any

def calculate_fatigue(driver: Dict[str, Any]) -> float:
    """
    Dynamic Fatigue Model:
    - Fatigue resets to 0 after 12h of rest.
    - Fatigue decreases by 8% per hour of rest.
    """
    current_fatigue = driver.get("fatigue_score", 0.0)
    last_rest = driver.get("last_rest_start")
    
    if not last_rest:
        return current_fatigue
        
    last_rest_dt = datetime.fromisoformat(last_rest)
    now = datetime.utcnow()
    rest_duration = now - last_rest_dt
    
    # 12-hour full reset rule
    if rest_duration >= timedelta(hours=12):
        return 0.0
        
    # Hourly recovery rule (8% reduction per hour)
    hours_rested = rest_duration.total_seconds() / 3600
    recovered = hours_rested * 8.0
    
    new_fatigue = max(0.0, current_fatigue - recovered)
    return round(new_fatigue, 2)

def calculate_driver_performance_score(driver: Dict[str, Any]) -> float:
    """
    Weighted Average General Leaderboard Score:
    - Safety Index: 40%
    - Punctuality: 30%
    - Average Rating: 20%
    - Total Trips (Volume): 10%
    """
    # ML Feature: Dynamic Safety Index calculation
    base_safety = driver.get("safety_index", 100.0)
    accidents = driver.get("past_accidents", 0)
    violations = driver.get("traffic_violations", 0)
    
    # Severe penalty for accidents, moderate for violations
    dynamic_safety = max(0.0, base_safety - (accidents * 20.0) - (violations * 5.0))
    safety = dynamic_safety
    
    punctuality = driver.get("punctuality_rate", 100.0)
    
    ratings = driver.get("customer_ratings", [])
    avg_rating = (sum(ratings) / len(ratings)) * 20 if ratings else 100.0 # Normalize 5 stars to 100
    
    trips = min(100, driver.get("total_trips", 0)) # Cap trip volume contribution at 100
    
    # ML Feature: Heavy penalty for traffic violations / challans
    challans = driver.get("challan_count", 0)
    challan_penalty = challans * 5.0 # -5% per challan
    
    score = (safety * 0.4) + (punctuality * 0.3) + (avg_rating * 0.2) + (trips * 0.1)
    
    final_score = max(0.0, score - challan_penalty)
    return round(final_score, 2)
