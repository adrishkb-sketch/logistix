from backend.database import JSONDatabase
import random
from backend.models import Alert

alerts_db = JSONDatabase("alerts")
shipments_db = JSONDatabase("shipments")

def generate_mock_alerts():
    active_shipments = [s for s in shipments_db.get_all() if s.get("status") == "in_transit"]
    if not active_shipments:
        return
        
    # 30% chance to generate an alert for a random active shipment
    if random.random() < 0.3:
        shipment = random.choice(active_shipments)
        
        alert_types = [
            {"type": "traffic", "desc": "Heavy traffic detected ahead", "sev": "medium", "sugg": "Dynamic Reroute generated. Switch to Alternate Path B"},
            {"type": "weather", "desc": "Severe weather warning (Heavy Rain/Flooding)", "sev": "high", "sugg": "Delay route by 30 mins to avoid storm cell"},
            {"type": "fatigue", "desc": "Driver continuous driving without breaks", "sev": "critical", "sugg": "Force mandatory 15m rest stop"},
            {"type": "breakdown", "desc": "Vehicle telemetry indicates engine stress", "sev": "high", "sugg": "Dispatch backup vehicle immediately"}
        ]
        
        chosen = random.choice(alert_types)
        new_alert = Alert(
            type=chosen["type"],
            description=chosen["desc"],
            severity=chosen["sev"],
            suggestion=chosen["sugg"],
            shipment_id=shipment["id"],
            driver_id=shipment.get("assigned_driver_id")
        )
        
        alerts_db.insert(new_alert.model_dump())
