import json
import os
from backend.database import JSONDatabase

# Placeholder for ML data extraction
def extract_training_data():
    shipments_db = JSONDatabase("shipments")
    alerts_db = JSONDatabase("alerts")
    
    shipments = shipments_db.get_all()
    completed = [s for s in shipments if s.get("status") == "delivered"]
    
    training_data = []
    for s in completed:
        # Example feature extraction
        data_point = {
            "weight": s.get("weight"),
            "distance": 0, # Calculate using haversine in a real scenario
            "route_type": s.get("route_type"),
            "delivery_time_mins": 120, # Calculate actual time difference
            "had_delay": any(a.get("type") == "delay" for a in alerts_db.get_all() if a.get("shipment_id") == s.get("id"))
        }
        training_data.append(data_point)
        
    # Save to a CSV or JSON for ML model training later
    os.makedirs("data/ml", exist_ok=True)
    with open("data/ml/training_data.json", "w") as f:
        json.dump(training_data, f, indent=4)
