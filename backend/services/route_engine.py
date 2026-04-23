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
