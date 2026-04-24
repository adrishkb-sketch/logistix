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
    - Safety Rating (Experience/Accidents/Challans): 40%
    - Punctuality: 30%
    - Customer Rating: 20%
    - Volume (Trips): 10%
    """
    safety_rating = calculate_safety_rating(driver)
    safety_component = (safety_rating / 5.0) * 100
    
    punctuality = driver.get("punctuality_rate", 100.0)
    
    ratings = driver.get("customer_ratings", [])
    avg_rating = (sum(ratings) / len(ratings)) * 20 if ratings else 100.0
    
    trips = min(100, driver.get("total_trips", 0))
    
    # Base weighted score
    score = (safety_component * 0.4) + (punctuality * 0.3) + (avg_rating * 0.2) + (trips * 0.1)
    
    # Additional penalty for active challans
    challans = driver.get("challan_count", 0)
    score -= (challans * 2.0)
    
    return round(max(0.0, min(100.0, score)), 2)
