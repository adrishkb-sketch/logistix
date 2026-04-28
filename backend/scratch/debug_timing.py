
from datetime import datetime, timedelta, timezone
import uuid

def snap_eta_to_business_hours(eta: datetime) -> datetime:
    IST = timezone(timedelta(hours=5, minutes=30))
    if eta.tzinfo is None:
        eta = eta.replace(tzinfo=timezone.utc)
    eta_ist = eta.astimezone(IST)
    if eta_ist.hour < 8:
        eta_ist = eta_ist.replace(hour=8, minute=0, second=0, microsecond=0)
    elif eta_ist.hour >= 22:
        eta_ist = (eta_ist + timedelta(days=1)).replace(hour=8, minute=0, second=0, microsecond=0)
    return eta_ist.astimezone(timezone.utc).replace(tzinfo=None)

def haversine(lat1, lon1, lat2, lon2):
    import math
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def simulate_legs():
    leg_data = [
        {"pickup": {"lat": 23.0797, "lng": 79.5850}, "drop": {"lat": 23.1, "lng": 79.6}, "leg_type": "standard_leg"},
        {"pickup": {"lat": 23.1, "lng": 79.6}, "drop": {"lat": 22.5332, "lng": 88.1226}, "leg_type": "standard_leg"}
    ]
    
    current_time = datetime.utcnow()
    print(f"Initial UTC: {current_time.isoformat()}")
    
    for i, leg in enumerate(leg_data):
        if i == 0:
            p_deadline = snap_eta_to_business_hours(current_time)
        else:
            p_deadline = current_time + timedelta(minutes=5)
            p_deadline = snap_eta_to_business_hours(p_deadline)
        
        l_pickup = leg.get("pickup")
        l_drop = leg.get("drop")
        dist = haversine(l_pickup.get("lat"), l_pickup.get("lng"), l_drop.get("lat"), l_drop.get("lng"))
        
        speed = 30.0 
        travel_time_hours = dist / speed
        wait_time_hours = 0.5 
        
        raw_eta = p_deadline + timedelta(hours=travel_time_hours + wait_time_hours)
        expected_time = snap_eta_to_business_hours(raw_eta)
        
        print(f"Leg {i+1}:")
        print(f"  Dist: {dist:.2f}km")
        print(f"  Pickup: {p_deadline.isoformat()}")
        print(f"  Drop:   {expected_time.isoformat()}")
        
        current_time = expected_time

if __name__ == "__main__":
    simulate_legs()
