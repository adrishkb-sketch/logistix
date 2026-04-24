from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from backend.database import JSONDatabase
from typing import Dict, Any
from backend.services.ocr_service import process_number_plate_image
import os
import uuid

router = APIRouter()
shipments_db = JSONDatabase("shipments")
drivers_db = JSONDatabase("drivers")

@router.get("/{driver_id}/shipments")
def get_driver_shipments(driver_id: str):
    all_shipments = shipments_db.get_all()
    assigned = [s for s in all_shipments if s.get("assigned_driver_id") == driver_id]
    return assigned

@router.post("/{driver_id}/location")
def update_driver_location(driver_id: str, location: Dict[str, Any]):
    # In a real app we might update driver's current location.
    # Here we update the shipment's current location if they are carrying one.
    from backend.services.alert_engine import check_weather_alerts
    from backend.services.route_engine import check_shipment_performance
    
    all_shipments = shipments_db.get_all()
    for s in all_shipments:
        if s.get("assigned_driver_id") == driver_id and s.get("status") in ["in_transit", "assigned"]:
            # Recalculate Performance
            driver = drivers_db.get_by_id(driver_id)
            vehicles_db = JSONDatabase("vehicles")
            vehicle = vehicles_db.get_by_id(driver["assigned_vehicle_id"]) if driver.get("assigned_vehicle_id") else None
            
            perf = check_shipment_performance(s, driver, vehicle)
            
            # Check for status change to log it
            prev_perf = s.get("performance_stats", {})
            if perf["status"] != prev_perf.get("status"):
                from backend.models import ShipmentEvent
                status_emoji = "🔴" if perf["status"] == "delayed" else ("🟢" if perf["status"] == "early" else "🔵")
                log_msg = f"{status_emoji} Performance changed to {perf['status'].upper()}. Predicted Delay: {perf['diff_mins']}m."
                log = ShipmentEvent(
                    status=perf["status"],
                    message=log_msg,
                    reason=f"AI recalculated ETA based on GPS at {location['lat']}, {location['lng']}. Weather: {perf['weather']}",
                    location=location
                )
                s["logs"] = s.get("logs", []) + [log.model_dump()]

            shipments_db.update(s["id"], {
                "current_location": location, 
                "status": "in_transit",
                "performance_stats": perf,
                "logs": s["logs"]
            })
            
            # Real-time weather alerting
            check_weather_alerts(s, location["lat"], location["lng"])
            return {"message": "Location updated", "performance": perf}
    return {"message": "Location updated"}

@router.post("/{driver_id}/verify")
async def verify_vehicle(driver_id: str, file: UploadFile = File(...)):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    if not driver.get("assigned_vehicle_id"):
        raise HTTPException(status_code=400, detail="No vehicle assigned to driver")
        
    vehicles_db = JSONDatabase("vehicles")
    vehicle = vehicles_db.get_by_id(driver["assigned_vehicle_id"])
    expected_plate = vehicle.get("number_plate", "UNKNOWN")
    
    # Save image
    ext = file.filename.split('.')[-1]
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = f"data/images/{filename}"
    
    with open(filepath, "wb") as buffer:
        buffer.write(await file.read())
        
    # Process ML
    ml_result = process_number_plate_image(filepath, expected_plate)
    
    # Update status
    new_status = "verified" if ml_result["verified"] else "pending_manual"
    drivers_db.update(driver_id, {
        "verification_status": new_status,
        "verification_image": filename,
        "verification_message": ml_result["message"]
    })
    
    return {
        "status": new_status,
        "ml_result": ml_result,
        "image_url": f"/images/{filename}"
    }

@router.post("/{driver_id}/scan-cargo/{shipment_id}")
async def scan_cargo(driver_id: str, shipment_id: str, file: UploadFile = File(...)):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment or shipment.get("assigned_driver_id") != driver_id:
        raise HTTPException(status_code=403, detail="Unauthorized")
        
    contents = await file.read()
    
    # Mock ML Computer Vision Logic for Cargo Damage
    import random
    import hashlib
    # Deterministic pass/fail based on file contents
    file_hash = int(hashlib.md5(contents).hexdigest()[:8], 16)
    
    # 20% chance of detecting damage
    is_damaged = (file_hash % 100) < 20
    
    if is_damaged:
        from backend.models import ShipmentEvent
        log_event = ShipmentEvent(status="disputed", message="AI Cargo Scanner detected damage at pickup. Handover halted.", reason="Packaging tear detected by CV.")
        shipment["logs"] = shipment.get("logs", []) + [log_event.model_dump()]
        shipment["status"] = "disputed"
        shipment["stage"] = "Damage Dispute"
        shipments_db.update(shipment_id, shipment)
        return {"status": "fail", "message": "Damage detected. Shipment marked as disputed."}
    
    return {"status": "pass", "message": "Cargo quality verified. Safe for pickup."}

@router.post("/{driver_id}/incident")
def report_incident(driver_id: str, data: dict):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    incident_type = data.get("type", "unknown")
    desc = data.get("description", "")
    lat = data.get("lat")
    lng = data.get("lng")
    
    from backend.models import ShipmentEvent, Alert
    from backend.database import JSONDatabase
    from backend.services.route_engine import haversine
    alerts_db = JSONDatabase("alerts")
    vehicles_db = JSONDatabase("vehicles")
    
    # Update driver stats
    if incident_type == "challan":
        driver["challan_count"] = driver.get("challan_count", 0) + 1
        drivers_db.update(driver_id, driver)
    elif incident_type == "resting":
        # Resting reduces fatigue
        new_fatigue = max(0, driver.get("fatigue_score", 0) - 40)
        drivers_db.update(driver_id, {"fatigue_score": new_fatigue, "last_rest_start": datetime.utcnow().isoformat()})
        
    # Find active shipment
    all_shipments = shipments_db.get_all()
    active = next((s for s in all_shipments if s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit"]), None)
    
    if active:
        # Append log to shipment with location info
        loc_obj = {"lat": lat, "lng": lng} if lat and lng else None
        log = ShipmentEvent(
            status="delayed" if incident_type in ["breakdown", "challan"] else active["status"], 
            message=f"ISSUE: {incident_type.upper()} at {lat or 'unknown'}, {lng or 'unknown'}.", 
            reason=desc,
            location=loc_obj
        )
        active["logs"] = active.get("logs", []) + [log.model_dump()]
        
        if incident_type == "breakdown":
            active["status"] = "delayed"
            active["stage"] = "Vehicle Breakdown"
            
            # Find nearby available vehicles for recovery
            all_v = vehicles_db.get_all()
            nearby_v = []
            if lat and lng:
                # Mock location for vehicles if they don't have it (usually they are at warehouses)
                warehouses_db = JSONDatabase("warehouses")
                all_w = warehouses_db.get_all()
                for v in all_v:
                    if v.get("status") == "available":
                        w = next((wh for wh in all_w if wh["id"] == v.get("base_warehouse_id")), None)
                        if w:
                            d = haversine(lat, lng, w["lat"], w["lng"])
                            if d < 50: # within 50km
                                nearby_v.append(f"{v['type']} [{v['number_plate']}] - {round(d, 1)}km away")
            
            v_suggestion = f"Rescue needed. Nearby available: {', '.join(nearby_v[:3]) if nearby_v else 'None found'}"
            
            # Update vehicle status
            v_id = driver.get("assigned_vehicle_id")
            if v_id:
                vehicles_db.update(v_id, {"status": "maintenance"})
                
            # Create Critical Alert for Manager
            new_alert = Alert(
                type="breakdown",
                description=f"CRITICAL: Vehicle breakdown reported by {driver['name']} at {lat},{lng}.",
                severity="critical",
                suggestion=v_suggestion,
                shipment_id=active["id"],
                driver_id=driver_id
            )
            alerts_db.insert(new_alert.model_dump())
            
        shipments_db.update(active["id"], active)
        
    return {"message": "Incident logged successfully"}
