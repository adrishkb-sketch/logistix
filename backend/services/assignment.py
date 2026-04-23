from backend.database import JSONDatabase
from typing import Dict, Any, Optional

drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")

def auto_assign_shipment(shipment: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Advanced AI Logic:
    # 1. Find all available drivers who are assigned to a vehicle
    # 2. Check current load of vehicle (for multi-shipment)
    # 3. Apply constraints: short legs (<30km) -> prefer bike/van. Long legs (>50km) -> prefer truck.
    
    from backend.services.route_engine import haversine
    dist = haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], shipment["drop"]["lat"], shipment["drop"]["lng"])
    
    drivers = drivers_db.get_all()
    vehicles = vehicles_db.get_all()
    
    # We need to calculate current load for multi-shipment logic
    from backend.database import JSONDatabase
    shipments_db = JSONDatabase("shipments")
    all_shipments = shipments_db.get_all()
    
    available_pairs = []
    
    for d in drivers:
        # STRICT BLOCK: Driver fatigue too high
        if d.get("fatigue_score", 0) > 80:
            continue
            
        if d.get("assigned_vehicle_id") and d.get("verification_status") == "verified":
            vehicle = next((v for v in vehicles if v["id"] == d["assigned_vehicle_id"]), None)
            if vehicle and vehicle.get("status") in ["available", "assigned"]:
                # Check Vehicle Health vs Distance
                health = vehicle.get("vehicle_health_score", 100)
                if dist > 50 and health < 60:
                    continue # Do not send unhealthy vehicles on long trips
                
                # Calculate current load
                active_for_vehicle = [s for s in all_shipments if s.get("assigned_vehicle_id") == vehicle["id"] and s.get("status") in ["assigned", "in_transit"]]
                current_weight = sum(s.get("weight", 0) for s in active_for_vehicle)
                
                if current_weight + shipment.get("weight", 0) <= vehicle.get("capacity", 0):
                    # Check distance constraints
                    if dist > 50 and vehicle["type"] == "bike":
                        continue # Skip bikes for long distance
                        
                    score_modifier = 0
                    if dist < 30 and vehicle["type"] == "bike": score_modifier += 10
                    if dist > 50 and vehicle["type"] == "truck": score_modifier += 10
                    
                    # Boost score if shipment is fragile and driver is safe
                    labels = shipment.get("labels", [])
                    if "fragile" in labels or "priority" in labels:
                        score_modifier += d.get("safety_rating", 5) * 2
                        score_modifier += (d.get("on_time_rate", 100) / 10.0)
                    
                    available_pairs.append({"driver": d, "vehicle": vehicle, "score_modifier": score_modifier})
                
    if not available_pairs:
        return None
        
    # Sort pairs by driver performance and score modifier
    best_pair = sorted(available_pairs, key=lambda p: (
        -(p["driver"].get("driving_score", 0) + p["score_modifier"] + p["driver"].get("safety_rating", 5) * 5), 
        p["driver"].get("challan_count", 0),
        p["driver"].get("fatigue_score", 0)
    ))[0]
    
    return {
        "assigned_driver_id": best_pair["driver"]["id"],
        "assigned_vehicle_id": best_pair["vehicle"]["id"],
        "status": "assigned",
        "stage": "Assigned to Driver"
    }
