from fastapi import APIRouter, HTTPException
from backend.database import JSONDatabase

router = APIRouter()
shipments_db = JSONDatabase("shipments")
alerts_db = JSONDatabase("alerts")

@router.get("/{shipment_id}")
def track_shipment(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        # Avoid full scan if possible, but keep the prefix search if needed.
        # However, for a single shipment, we should really just use get_by_id.
        # If we MUST do a prefix search, let's at least not do it on every track call.
        return shipment
        
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    from backend.services.route_engine import predict_weather_impact, calculate_dynamic_eta, haversine
    from backend.database import JSONDatabase
    
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    # Defaults
    weather = predict_weather_impact(shipment["pickup"]["lat"], shipment["pickup"]["lng"])
    fatigue = 0
    health = 100
    v_type = "van"
    
    # Get live data if assigned
    if shipment.get("assigned_driver_id"):
        driver = drivers_db.get_by_id(shipment["assigned_driver_id"])
        if driver:
            fatigue = driver.get("fatigue_score", 0)
            if driver.get("assigned_vehicle_id"):
                vehicle = vehicles_db.get_by_id(driver["assigned_vehicle_id"])
                if vehicle:
                    health = vehicle.get("vehicle_health_score", 100)
                    v_type = vehicle["type"]
    
    dist = haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], shipment["drop"]["lat"], shipment["drop"]["lng"])
    dynamic_eta = calculate_dynamic_eta(dist, v_type, weather, fatigue, health)
    
    from datetime import datetime, timedelta
    from backend.services.time_utils import snap_eta_to_business_hours
    if shipment.get("expected_delivery"):
        try:
            eta_str = shipment["expected_delivery"].replace('Z', '+00:00')
            original_eta = datetime.fromisoformat(eta_str)
            adjusted_eta = original_eta + timedelta(minutes=dynamic_eta["delay_mins"])
            snapped_eta = snap_eta_to_business_hours(adjusted_eta)
            dynamic_eta["estimated_arrival"] = snapped_eta.isoformat()
        except Exception:
            pass
    
    # Fetch alerts
    all_alerts = alerts_db.get_all()
    active_alerts = [a for a in all_alerts if a and a.get("shipment_id") == shipment_id and a.get("status") == "active"]
    
    # Fetch legs if it's a split shipment
    legs = []
    if shipment.get("status") == "split" or shipment.get("route_type") == "multi-leg":
        all_ships = shipments_db.get_all()
        legs = [s for s in all_ships if s and s.get("parent_id") == shipment_id]
        legs.sort(key=lambda x: x.get("leg_order", 0))
    
    return {
        "shipment": shipment,
        "alerts": active_alerts,
        "dynamic_eta": dynamic_eta,
        "legs": legs
    }

@router.get("/fleet/weather")
def get_fleet_weather(company_id: str):
    """
    Returns simulated and real weather cells and active vehicle locations for the manager map.
    """
    from backend.database import JSONDatabase
    from backend.services.route_engine import predict_weather_impact, haversine
    drivers_db = JSONDatabase("drivers")
    shipments_db = JSONDatabase("shipments")
    vehicles_db = JSONDatabase("vehicles")
    
    drivers = drivers_db.get_filtered({"company_id": company_id})
    shipments = shipments_db.get_filtered({"company_id": company_id, "status": "in_transit"})
    
    fleet = []
    for d in drivers:
        if d.get("assigned_vehicle_id"):
            # Find current shipment for this driver
            current = next((s for s in shipments if s and s.get("assigned_driver_id") == d.get("id") and s.get("status") == "in_transit"), None)
            loc = current.get("current_location") if current else None
            if loc and loc.get("lat"):
                weather = predict_weather_impact(loc["lat"], loc["lng"])
                fleet.append({
                    "driver": d["name"],
                    "lat": loc["lat"],
                    "lng": loc["lng"],
                    "weather": weather,
                    "fatigue": d.get("fatigue_score", 0)
                })
    
    # Define real-time/default weather conditions (always present)
    real_cells = [
        {"id": "real-1", "lat": 28.6, "lng": 77.2, "radius": 150, "condition": "Storm", "type": "cyclone", "is_simulation": False, "severity": "critical", "icon": "⛈️", "color": "#e53e3e"},
        {"id": "real-2", "lat": 19.1, "lng": 72.9, "radius": 200, "condition": "Rain", "type": "flood", "is_simulation": False, "severity": "high", "icon": "🌧️", "color": "#3182ce"},
        {"id": "real-3", "lat": 13.0, "lng": 80.2, "radius": 180, "condition": "Rain", "type": "rain", "is_simulation": False, "severity": "medium", "icon": "🌧️", "color": "#3182ce"}
    ]
    
    weather_db = JSONDatabase("weather_cells")
    db_cells = weather_db.get_filtered({"company_id": company_id})
    db_cells = [c for c in db_cells if c and (c.get("company_id") == company_id or c.get("company_id") is None)]
    for c in db_cells:
        c["is_simulation"] = True
        
    cells = real_cells + db_cells
    for c in cells:
        c["shapeType"] = c.get("shapeType", "circle")
        if "color" not in c:
            c["color"] = "#e53e3e" if c.get("severity") == "critical" else "#3182ce"
        if "icon" not in c:
            cond = c.get("condition", "").lower()
            if "storm" in cond: c["icon"] = "⛈️"
            elif "rain" in cond: c["icon"] = "🌧️"
            elif "cloud" in cond: c["icon"] = "☁️"
            else: c["icon"] = "🌦️"
        if "type" not in c:
            c["type"] = c.get("condition", "Rain")
            
    # Calculate affected shipments
    affected_count = 0
    affected_list = []
    
    for s in shipments:
        curr_loc = s.get("current_location") or s.get("pickup")
        if not curr_loc or not curr_loc.get("lat"):
            continue
            
        for cell in cells:
            intersects = False
            if cell.get("shapeType") == "polyline":
                for pt in cell.get("coordinates", []):
                    if haversine(curr_loc["lat"], curr_loc["lng"], pt["lat"], pt["lng"]) <= 5:
                        intersects = True
                        break
            else:
                dist = haversine(curr_loc["lat"], curr_loc["lng"], cell.get("lat", 0), cell.get("lng", 0))
                if dist <= cell.get("radius", 50):
                    intersects = True
                    
            if intersects:
                affected_count += 1
                driver = drivers_db.get_by_id(s.get("assigned_driver_id", ""))
                vehicle = vehicles_db.get_by_id(s.get("assigned_vehicle_id", ""))
                
                cell_type = str(cell.get('type', '')).lower()
                ai_action = "Reroute"
                if cell_type in ['cyclone', 'flood']:
                    ai_action = "Emergency Halt & Seek High Ground"
                elif cell_type == 'heatwave':
                    ai_action = "Mandatory Stop (Vulnerable Vehicles) / Reroute"
                elif cell_type == 'earthquake':
                    ai_action = "Emergency Halt & Open Area Check"
                elif cell_type == 'riot':
                    ai_action = "Immediate Diversion (Avoid Zone)"
                elif cell_type == 'hail':
                    ai_action = "Shelter Search / Underpass Parking"
                elif cell_type == 'blockade':
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
                break
                
    recommendation = "No shipments affected."
    if affected_count > 0:
        recommendation = f"AI suggests monitoring/halting {affected_count} vehicles immediately. Ensure active safety rerouting protocols."
        
    return {
        "fleet": fleet,
        "cells": cells,
        "affected_count": affected_count,
        "affected_list": affected_list,
        "recommendation": recommendation
    }

@router.get("/messages/{user_id}")
def get_messages(user_id: str, company_id: str):
    messages_db = JSONDatabase("messages")
    company_msgs = messages_db.get_filtered({"company_id": company_id})
    user_msgs = [m for m in company_msgs if m and (m.get("sender_id") == user_id or m.get("receiver_id") == user_id)]
    return sorted(user_msgs, key=lambda x: x["created_at"])

@router.post("/messages")
def send_message(msg: dict):
    from backend.models import Message
    messages_db = JSONDatabase("messages")
    new_msg = Message(**msg)
    return messages_db.insert(new_msg.model_dump())

@router.get("/alerts/active")
def get_active_alerts(company_id: str):
    alerts_db = JSONDatabase("alerts")
    return alerts_db.get_filtered({"company_id": company_id, "status": "active"})

@router.post("/broadcast")
def broadcast_message(data: dict):
    from datetime import datetime
    company_id = data.get("company_id")
    sender_id = data.get("sender_id")
    content = data.get("content")
    
    if not all([company_id, sender_id, content]):
        raise HTTPException(status_code=400, detail="Missing required fields")
        
    from backend.database import JSONDatabase
    drivers_db = JSONDatabase("drivers")
    messages_db = JSONDatabase("messages")
    
    drivers = [d for d in drivers_db.get_all() if d and d.get("company_id") == company_id]
    
    for d in drivers:
        m = {
            "sender_id": sender_id,
            "receiver_id": d["id"],
            "content": f"📢 [BROADCAST]: {content}",
            "company_id": company_id,
            "created_at": datetime.utcnow().isoformat() + "Z"
        }
        messages_db.insert(m)
        
    return {"message": f"Broadcast sent to {len(drivers)} drivers"}
