from fastapi import APIRouter, HTTPException
from backend.database import JSONDatabase

router = APIRouter()
shipments_db = JSONDatabase("shipments")
alerts_db = JSONDatabase("alerts")

@router.get("/{shipment_id}")
def track_shipment(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        all_ships = shipments_db.get_all()
        shipment = next((s for s in all_ships if s["id"].startswith(shipment_id)), None)
        
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
    if shipment.get("expected_delivery"):
        try:
            original_eta = datetime.fromisoformat(shipment["expected_delivery"])
            dynamic_eta["estimated_arrival"] = (original_eta + timedelta(minutes=dynamic_eta["delay_mins"])).isoformat()
        except Exception:
            pass
    
    # Fetch alerts
    all_alerts = alerts_db.get_all()
    active_alerts = [a for a in all_alerts if a.get("shipment_id") == shipment_id and a.get("status") == "active"]
    
    return {
        "shipment": shipment,
        "alerts": active_alerts,
        "dynamic_eta": dynamic_eta
    }

@router.get("/fleet/weather")
def get_fleet_weather(company_id: str):
    """
    Returns simulated weather cells and active vehicle locations for the manager map.
    """
    from backend.database import JSONDatabase
    from backend.services.route_engine import predict_weather_impact
    drivers_db = JSONDatabase("drivers")
    shipments_db = JSONDatabase("shipments")
    
    drivers = [d for d in drivers_db.get_all() if d.get("company_id") == company_id]
    shipments = [s for s in shipments_db.get_all() if s.get("company_id") == company_id]
    
    fleet = []
    for d in drivers:
        if d.get("assigned_vehicle_id"):
            # Find current shipment for this driver
            current = next((s for s in shipments if s.get("assigned_driver_id") == d["id"] and s["status"] == "in_transit"), None)
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
    
    weather_db = JSONDatabase("weather_cells")
    cells = weather_db.get_all()
    # For local dev, filter weather cells by company_id if we want multi-tenancy for simulations too
    cells = [c for c in cells if c.get("company_id") == company_id or c.get("company_id") is None]

    if not cells:
        cells = [
            {"lat": 28.6, "lng": 77.2, "radius": 50, "condition": "Storm", "color": "#e53e3e"},
            {"lat": 19.1, "lng": 72.9, "radius": 80, "condition": "Rain", "color": "#3182ce"},
            {"lat": 13.0, "lng": 80.2, "radius": 60, "condition": "Rain", "color": "#3182ce"}
        ]
    else:
        for c in cells:
            c["color"] = "#e53e3e" if c.get("severity") == "critical" else "#3182ce"
            # Add dynamic weather icon based on condition
            cond = c.get("condition", "").lower()
            if "storm" in cond: c["icon"] = "⛈️"
            elif "rain" in cond: c["icon"] = "🌧️"
            elif "cloud" in cond: c["icon"] = "☁️"
            else: c["icon"] = "🌦️"
            
    return {"fleet": fleet, "cells": cells}

@router.get("/messages/{user_id}")
def get_messages(user_id: str, company_id: str):
    messages_db = JSONDatabase("messages")
    all_msgs = messages_db.get_all()
    # Filter by company_id AND then sender/receiver
    user_msgs = [m for m in all_msgs if m.get("company_id") == company_id and (m.get("sender_id") == user_id or m.get("receiver_id") == user_id)]
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
    return [a for a in alerts_db.get_all() if a.get("company_id") == company_id and a.get("status") == "active"]
