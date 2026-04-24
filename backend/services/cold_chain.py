from datetime import datetime
from backend.services.route_engine import haversine
from backend.database import JSONDatabase

def calculate_shipment_vitality(shipment: dict) -> float:
    if not shipment.get("is_perishable"):
        return 100.0
        
    vitality = shipment.get("vitality", 100.0)
    if shipment.get("status") == "delivered":
        return vitality

    # 1. Decay based on Time Delay
    now = datetime.utcnow()
    expected = datetime.fromisoformat(shipment.get("expected_delivery").replace('Z', ''))
    
    if now > expected:
        delay_hours = (now - expected).total_seconds() / 3600.0
        # For every hour of delay, lose 2% vitality
        vitality -= (delay_hours * 2.0)

    # 2. Decay based on Temperature (Weather Cells)
    weather_db = JSONDatabase("weather_cells")
    cells = weather_db.get_all()
    
    curr_loc = shipment.get("current_location") or shipment.get("pickup")
    
    for cell in cells:
        dist = haversine(curr_loc["lat"], curr_loc["lng"], cell["lat"], cell["lng"])
        if dist <= cell.get("radius", 0):
            # If in a high-temperature zone (Storm/Heat)
            severity_mult = 1.0
            if cell.get("severity") == "critical": severity_mult = 3.0
            elif cell.get("severity") == "high": severity_mult = 1.5
            
            # Additional 5% decay per fetch cycle if in danger zone
            vitality -= (5.0 * severity_mult)
            
    return max(0.0, round(vitality, 1))
