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
    all_shipments = shipments_db.get_all()
    for s in all_shipments:
        if s.get("assigned_driver_id") == driver_id and s.get("status") in ["in_transit", "assigned"]:
            shipments_db.update(s["id"], {"current_location": location, "status": "in_transit"})
            # Real-time weather alerting
            check_weather_alerts(s, location["lat"], location["lng"])
            return {"message": "Location updated for shipment", "shipment_id": s["id"]}
    return {"message": "Location updated", "driver_id": driver_id}

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
    
    # Update driver stats
    if incident_type == "challan":
        driver["challan_count"] = driver.get("challan_count", 0) + 1
        drivers_db.update(driver_id, driver)
        
    # Find active shipment
    all_shipments = shipments_db.get_all()
    active = next((s for s in all_shipments if s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit"]), None)
    
    from backend.models import ShipmentEvent, Alert
    from backend.database import JSONDatabase
    alerts_db = JSONDatabase("alerts")
    vehicles_db = JSONDatabase("vehicles")
    
    if active:
        # Append log to shipment
        log = ShipmentEvent(status="delayed", message=f"Driver reported: {incident_type.upper()}.", reason=desc)
        active["logs"] = active.get("logs", []) + [log.model_dump()]
        
        if incident_type == "breakdown":
            active["status"] = "delayed"
            active["stage"] = "Vehicle Breakdown"
            
            # Update vehicle status
            v_id = driver.get("assigned_vehicle_id")
            if v_id:
                vehicles_db.update(v_id, {"status": "maintenance"})
                
            # Create Critical Alert for Manager
            new_alert = Alert(
                type="breakdown",
                description=f"CRITICAL: Vehicle breakdown reported by {driver['name']}.",
                severity="critical",
                suggestion="Assign Rescue Vehicle immediately to recover shipment.",
                shipment_id=active["id"],
                driver_id=driver_id
            )
            alerts_db.insert(new_alert.model_dump())
            
        shipments_db.update(active["id"], active)
        
    return {"message": "Incident logged successfully"}
