from backend.database import JSONDatabase
import random
from backend.models import Alert

alerts_db = JSONDatabase("alerts")
shipments_db = JSONDatabase("shipments")

alerts_db = JSONDatabase("alerts")
shipments_db = JSONDatabase("shipments")

def check_weather_alerts(shipment: dict, lat: float, lng: float):
    """
    Checks if a vehicle's current location intersects with simulated weather cells.
    """
    from backend.services.route_engine import haversine
    
    weather_db = JSONDatabase("weather_cells")
    cells = weather_db.get_all()
    if not cells:
        cells = [
            {"lat": 28.6, "lng": 77.2, "radius": 50, "condition": "Storm", "severity": "critical"},
            {"lat": 19.1, "lng": 72.9, "radius": 80, "condition": "Rain", "severity": "high"},
            {"lat": 13.0, "lng": 80.2, "radius": 60, "condition": "Rain", "severity": "medium"}
        ]
        
    for cell in cells:
        intersects = False
        if cell.get("shapeType") == "polyline":
            # Check proximity to any point in the polyline
            for pt in cell.get("coordinates", []):
                if haversine(lat, lng, pt["lat"], pt["lng"]) <= 5: # 5km proximity
                    intersects = True
                    break
        else:
            # Default to circle
            dist = haversine(lat, lng, cell.get("lat", 0), cell.get("lng", 0))
            if dist <= cell.get("radius", 50):
                intersects = True
                
        if intersects and not cell.get("is_simulation"):
            # Intersection! Check if alert already exists
            existing = [a for a in alerts_db.get_all() if a.get("shipment_id") == shipment["id"] and a.get("type") == "weather" and a.get("status") == "active"]
            if not existing:
                cond = cell.get('condition') or cell.get('type') or 'Weather Anomaly'
                new_alert = Alert(
                    type="weather",
                    description=f"Vehicle entered {cond} zone at {lat}, {lng}",
                    severity=cell.get("severity", "medium"),
                    suggestion=f"Heavy {cond} detected. Suggest slowing down or holding position for 30m.",
                    shipment_id=shipment["id"],
                    driver_id=shipment.get("assigned_driver_id")
                )
                alerts_db.insert(new_alert.model_dump())
