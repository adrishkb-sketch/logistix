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

def check_street_intel_alerts(shipment: dict):
    """
    Checks if a vehicle is too large for the destination zone (Hyper-local gully mapping).
    """
    from backend.services.route_engine import haversine
    from backend.database import JSONDatabase
    
    street_db = JSONDatabase("street_intel")
    vehicles_db = JSONDatabase("vehicles")
    
    zones = street_db.get_all()
    drop = shipment.get("drop", {})
    if not drop: return

    v_id = shipment.get("assigned_vehicle_id")
    if not v_id: return
    
    vehicle = vehicles_db.get_by_id(v_id)
    if not vehicle: return
    
    v_type = vehicle.get("type", "truck")
    
    # Priority for vehicle types (higher index = larger)
    types_rank = ["bike", "scooty", "3 wheeled (battery)", "3 wheeled (non EV)", "small van", "large van", "truck"]
    try:
        v_rank = types_rank.index(v_type.lower())
    except ValueError:
        v_rank = 6 # Default to truck rank
        
    for zone in zones:
        dist = haversine(drop["lat"], drop["lng"], zone["lat"], zone["lng"])
        if dist <= zone.get("radius", 1.0):
            max_type = zone.get("max_vehicle_type", "truck")
            try:
                max_rank = types_rank.index(max_type.lower())
            except ValueError:
                max_rank = 6
                
            if v_rank > max_rank:
                # Alert!
                existing = [a for a in alerts_db.get_all() if a.get("shipment_id") == shipment["id"] and a.get("type") == "street_intel" and a.get("status") == "active"]
                if not existing:
                    new_alert = Alert(
                        type="street_intel",
                        description=f"Vehicle '{v_type}' is too large for delivery zone '{zone['name']}'.",
                        severity="high",
                        suggestion=f"This zone only allows {max_type} or smaller. Consider transshipment at a nearby hub.",
                        shipment_id=shipment["id"],
                        driver_id=shipment.get("assigned_driver_id")
                    )
                    alerts_db.insert(new_alert.model_dump())

def check_compliance_alerts(shipment: dict):
    """
    Checks if ETA exceeds E-Way Bill expiry (Compliance Guardian).
    """
    from datetime import datetime, timedelta
    from backend.database import JSONDatabase
    
    expiry_str = shipment.get("eway_bill_expiry")
    if not expiry_str: return
    
    try:
        expiry_dt = datetime.fromisoformat(expiry_str.replace("Z", ""))
    except Exception: return
    
    # Check current ETA
    eta_str = shipment.get("expected_delivery")
    if not eta_str: return
    
    try:
        eta_dt = datetime.fromisoformat(eta_str.replace("Z", ""))
    except Exception: return
    
    # If ETA is within 2 hours of expiry, or already exceeded
    if eta_dt > expiry_dt - timedelta(hours=2):
        existing = [a for a in alerts_db.get_all() if a.get("shipment_id") == shipment["id"] and a.get("type") == "compliance" and a.get("status") == "active"]
        if not existing:
            new_alert = Alert(
                type="compliance",
                description=f"E-Way Bill {shipment.get('eway_bill_no')} is at risk of expiry before delivery.",
                severity="critical" if eta_dt > expiry_dt else "high",
                suggestion="Initiate E-Way Bill extension immediately to avoid penalties at highway checkpoints.",
                shipment_id=shipment["id"],
                driver_id=shipment.get("assigned_driver_id")
            )
            alerts_db.insert(new_alert.model_dump())
