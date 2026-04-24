from fastapi import APIRouter
from backend.database import JSONDatabase
from backend.models import Alert
import uuid

router = APIRouter()
weather_db = JSONDatabase("weather_cells")
alerts_db = JSONDatabase("alerts")
shipments_db = JSONDatabase("shipments")

@router.post("/disaster")
def simulate_disaster(data: dict):
    # type: "cyclone", "blockade", "flood"
    # lat, lng, radius, severity
    
    # 1. Inject into weather cells
    new_cell = {
        "id": str(uuid.uuid4()),
        "type": data.get("type", "cyclone"),
        "lat": data.get("lat", 19.1),
        "lng": data.get("lng", 72.9),
        "radius": data.get("radius", 200), # Huge radius
        "condition": data.get("condition", "Storm"),
        "severity": "critical",
        "is_simulation": True
    }
    
    # Actually, we can just replace all cells for maximum dramatic effect
    weather_db.write([new_cell])
    
    # 2. Trigger alerts for all active shipments that intersect
    from backend.services.route_engine import haversine
    from backend.models import ShipmentEvent
    
    active_shipments = [s for s in shipments_db.get_all() if s.get("status") in ["assigned", "in_transit"]]
    affected_count = 0
    
    for s in active_shipments:
        curr_loc = s.get("current_location") or s.get("pickup")
        dist = haversine(curr_loc["lat"], curr_loc["lng"], new_cell["lat"], new_cell["lng"])
        if dist <= new_cell["radius"]:
            # Log event (SIMULATION ONLY - NO ALERT)
            log_event = ShipmentEvent(status="simulated_delay", message=f"SIMULATION: Affected by {new_cell['type']}.", reason=f"Disaster Simulation Sandbox")
            s["logs"] = s.get("logs", []) + [log_event.model_dump()]
            shipments_db.update(s["id"], s)
            affected_count += 1
            
    return {"message": f"Simulated {new_cell['type']}. {affected_count} shipments affected instantly."}

@router.post("/disaster/custom")
def custom_disaster(data: dict):
    from backend.services.route_engine import haversine
    from backend.models import ShipmentEvent
    
    # data: {type, shapeType, lat, lng, radius} OR {type, shapeType, coordinates: [{lat,lng}]}
    new_cell = {
        "id": str(uuid.uuid4()),
        "type": data.get("type"),
        "shapeType": data.get("shapeType"),
        "severity": "critical",
        "is_simulation": True
    }
    
    if data.get("shapeType") == "circle":
        new_cell["lat"] = data["lat"]
        new_cell["lng"] = data["lng"]
        new_cell["radius"] = data["radius"]
    else:
        new_cell["coordinates"] = data["coordinates"]
        
    # Append to existing cells
    cells = weather_db.get_all()
    cells.append(new_cell)
    weather_db.write(cells)
    
    # Check intersections
    active_shipments = [s for s in shipments_db.get_all() if s.get("status") in ["assigned", "in_transit"]]
    affected_count = 0
    affected_list = []
    
    for s in active_shipments:
        curr_loc = s.get("current_location") or s.get("pickup")
        intersects = False
        
        if new_cell["shapeType"] == "circle":
            dist = haversine(curr_loc["lat"], curr_loc["lng"], new_cell["lat"], new_cell["lng"])
            if dist <= new_cell["radius"]: intersects = True
        else:
            # Polyline proximity (within 5km of any point on line)
            for pt in new_cell["coordinates"]:
                if haversine(curr_loc["lat"], curr_loc["lng"], pt["lat"], pt["lng"]) <= 5:
                    intersects = True
                    break
                    
        if intersects:
            affected_count += 1
            
            # Fetch driver and vehicle details for the detailed report
            drivers_db = JSONDatabase("drivers")
            vehicles_db = JSONDatabase("vehicles")
            driver = drivers_db.get_by_id(s.get("assigned_driver_id", ""))
            vehicle = vehicles_db.get_by_id(s.get("assigned_vehicle_id", ""))
            
            ai_action = "Reroute"
            if new_cell['type'] in ['cyclone', 'flood']:
                ai_action = "Emergency Halt & Seek High Ground"
            elif new_cell['type'] == 'blockade':
                ai_action = "Recalculate Route (OSRM Bypass)"
                
            affected_list.append({
                "id": s["id"],
                "description": s["description"],
                "driver_name": driver.get("name", "Unknown") if driver else "Unassigned",
                "vehicle_plate": vehicle.get("number_plate", "N/A") if vehicle else "N/A",
                "location": curr_loc,
                "ai_action": ai_action,
                "driver_instruction": f"PROPOSED: Move to nearest safe zone. Awaiting Manager Approval."
            })
            
            # We still log it in the shipment history as a 'simulated' event, but NO ALERT in alerts_db
            log_event = ShipmentEvent(status="simulated_delay", message=f"SIMULATION: Affected by {new_cell['type']}.", reason=f"Disaster Simulation Sandbox")
            s["logs"] = s.get("logs", []) + [log_event.model_dump()]
            shipments_db.update(s["id"], s)

    # Generate AI Recommendation
    recommendation = "No shipments affected."
    if affected_count > 0:
        recommendation = f"AI suggests halting {affected_count} vehicles immediately. "
        if new_cell['type'] in ['cyclone', 'flood']:
            recommendation += "Reroute 2-wheelers immediately; standard delivery trucks should seek elevated parking."
        elif new_cell['type'] in ['landslide', 'blockade']:
            recommendation += "Calculate alternative paths bypassing the affected segment. Minor delays expected."

    return {
        "message": f"Custom {new_cell['type']} simulated. {affected_count} shipments affected.",
        "affected_count": affected_count,
        "affected_list": affected_list,
        "recommendation": recommendation
    }

@router.post("/disaster/clear")
def clear_disasters():
    weather_db.write([])
    # Revert all shipments
    all_shipments = shipments_db.get_all()
    for s in all_shipments:
        original_len = len(s.get("logs", []))
        s["logs"] = [l for l in s.get("logs", []) if l.get("status") != "simulated_delay"]
        if len(s["logs"]) != original_len:
            shipments_db.update(s["id"], s)
    return {"message": "All active disaster simulations cleared."}

@router.delete("/disaster/{sim_id}")
def stop_simulation(sim_id: str):
    cells = weather_db.get_all()
    new_cells = [c for c in cells if c.get("id") != sim_id]
    weather_db.write(new_cells)
    
    # Revert shipments affected by this specific simulation
    # For simplicity, we remove ALL simulated_delay logs. 
    # In a real app we might tag logs with the sim_id.
    all_shipments = shipments_db.get_all()
    for s in all_shipments:
        original_len = len(s.get("logs", []))
        s["logs"] = [l for l in s.get("logs", []) if l.get("status") != "simulated_delay"]
        if len(s["logs"]) != original_len:
            shipments_db.update(s["id"], s)
            
    return {"message": f"Simulation {sim_id} stopped. System reverted to normal."}
