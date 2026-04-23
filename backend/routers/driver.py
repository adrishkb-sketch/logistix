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
    all_shipments = shipments_db.get_all()
    for s in all_shipments:
        if s.get("assigned_driver_id") == driver_id and s.get("status") in ["in_transit", "assigned"]:
            shipments_db.update(s["id"], {"current_location": location, "status": "in_transit"})
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
