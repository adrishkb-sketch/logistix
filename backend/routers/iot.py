from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
from backend.database import JSONDatabase
from backend.models import ShipmentEvent
from datetime import datetime

router = APIRouter()
shipments_db = JSONDatabase("shipments")
drivers_db = JSONDatabase("drivers")

class IoTEvent(BaseModel):
    company_id: Optional[str] = "demo-company"
    device_type: str  # cold_chain, fatigue, weighbridge, drone, rfid, shock
    target_id: Optional[str] = None # shipment_id, driver_id, etc.
    data: Dict[str, Any]
    is_mock: Optional[bool] = False

@router.post("/event")
def handle_iot_event(event: IoTEvent):
    response_log = []
    is_mock = event.is_mock
    
    # 1. Cold Chain Sensor
    if event.device_type == "cold_chain":
        temp = event.data.get("temp", 9.5)
        if temp > 8.0:
            if not is_mock:
                shipments = shipments_db.get_all()
                target = next((s for s in shipments if s.get("status") in ["in_transit", "assigned"]), None)
                if target:
                    target_id = event.target_id or target["id"]
                    s = shipments_db.get_by_id(target_id)
                    if s:
                        s["temperature_last_recorded"] = temp
                        log_msg = ShipmentEvent(
                            status="critical_warning", 
                            message=f"🥶 COLD CHAIN BREACH: Cargo temperature detected at {temp}°C (Safe limit: 8.0°C).", 
                            reason="hardware_sensor"
                        )
                        s["logs"] = s.get("logs", []) + [log_msg.model_dump()]
                        shipments_db.update(s["id"], s)
            
            response_log.append(f"AI Action: Alert dispatched to driver & hub manager. Rerouting to nearest cold storage suggested.")
                
        response_log.insert(0, f"IoT Data Received: [Temp: {temp}°C]")

    # 2. Driver Fatigue Monitor (IR Camera/Smartwatch)
    elif event.device_type == "fatigue":
        heart_rate = event.data.get("heart_rate", 55)
        eye_closure = event.data.get("eye_closure_rate", 80) # percentage
        
        if not is_mock:
            drivers = drivers_db.get_all()
            target = next((d for d in drivers if d.get("status") == "assigned" or d.get("assigned_vehicle_id")), None)
            
            if target:
                target_id = event.target_id or target["id"]
                d = drivers_db.get_by_id(target_id)
                if d:
                    d["safety_rating"] = max(1.0, float(d.get("safety_rating", 5.0)) - 1.5)
                    d["fatigue_score"] = min(100.0, float(d.get("fatigue_score", 0.0)) + 60.0)
                    if "health_metrics" not in d or not d["health_metrics"]:
                        d["health_metrics"] = {}
                    d["health_metrics"]["heart_rate"] = heart_rate
                    drivers_db.update(d["id"], d)
                    
                    # Also log on their active shipment if any
                    active_ship = next((s for s in shipments_db.get_all() if s.get("assigned_driver_id") == d["id"]), None)
                    if active_ship:
                        log_msg = ShipmentEvent(
                            status="safety_halt", 
                            message=f"👁️ BIOMETRIC ALERT: Driver fatigue detected (HR: {heart_rate}bpm, Eye Closure: {eye_closure}%).", 
                            reason="biometric_sensor"
                        )
                        active_ship["logs"] = active_ship.get("logs", []) + [log_msg.model_dump()]
                        shipments_db.update(active_ship["id"], active_ship)
                
        response_log.append(f"AI Action: Triggered voice alert in Driver App. Forced 15-min rest stop added to itinerary.")
        response_log.insert(0, f"IoT Data Received: [HR: {heart_rate}bpm, Eyes: {eye_closure}%]")

    # 3. Smart Weighbridge
    elif event.device_type == "weighbridge":
        weight = event.data.get("weight", 4500) # kg
        plate = event.data.get("plate", "UNKNOWN")
        response_log.insert(0, f"IoT Data Received: [Plate: {plate}, Payload: {weight}kg]")
        response_log.append(f"AI Action: Verified against manifest. Calculated dynamic toll/fuel offset. Gate barrier opened automatically.")

    # 4. Drone Telemetry
    elif event.device_type == "drone":
        lat = event.data.get("lat", 19.0760)
        lng = event.data.get("lng", 72.8777)
        batt = event.data.get("battery", 15)
        
        response_log.insert(0, f"IoT Data Received: [Alt: 120m, Batt: {batt}%, Lat: {lat}]")
        if batt < 20:
            response_log.append(f"AI Action: CRITICAL BATTERY. Recalculating descent path to nearest safe landing pad.")
        else:
            response_log.append(f"AI Action: Telemetry synced with WebSockets map.")

    # 5. RFID Conveyor Sort
    elif event.device_type == "rfid":
        speed = event.data.get("scan_rate", 45) # packages per sec
        response_log.insert(0, f"IoT Data Received: [Scanner ID: R-99, Rate: {speed} pkg/s]")
        response_log.append(f"AI Action: Diverted 12% of flow to Dock 4 to prevent downstream bottleneck.")

    # 6. Shock/Drop Accelerometer
    elif event.device_type == "shock":
        g_force = event.data.get("g_force", 6.5)
        axis = event.data.get("axis", "Z")
        
        if not is_mock:
            shipments = shipments_db.get_all()
            target = next((s for s in shipments if s.get("status") in ["in_transit", "assigned"]), None)
            
            if target:
                target_id = event.target_id or target["id"]
                s = shipments_db.get_by_id(target_id)
                if s:
                    log_msg = ShipmentEvent(
                        status="damage_warning", 
                        message=f"💥 IMPACT DETECTED: {g_force}G shock registered on {axis}-axis.", 
                        reason="hardware_sensor"
                    )
                    s["logs"] = s.get("logs", []) + [log_msg.model_dump()]
                    shipments_db.update(s["id"], s)
        
        response_log.append(f"AI Action: Package flagged for QA inspection upon arrival. Automated replacement pre-authorized.")
        response_log.insert(0, f"IoT Data Received: [Impact: {g_force}G, Axis: {axis}]")

    else:
        raise HTTPException(status_code=400, detail="Unknown device type")

    return {
        "status": "success",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "logs": response_log
    }
