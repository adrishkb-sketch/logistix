from fastapi import APIRouter, HTTPException
from backend.models import ShipmentCreate, Shipment, Location
from backend.database import JSONDatabase
from backend.services.assignment import auto_assign_shipment
from backend.services.route_engine import calculate_route_type, haversine
from datetime import datetime, timedelta
from typing import List
from pydantic import BaseModel
import uuid
import random

router = APIRouter()
shipments_db = JSONDatabase("shipments")
warehouses_db = JSONDatabase("warehouses")

@router.post("/")
def create_shipment(shipment_data: ShipmentCreate):
    dist = haversine(shipment_data.pickup.lat, shipment_data.pickup.lng, shipment_data.drop.lat, shipment_data.drop.lng)
    
    # Calculate ETA based on avg speed 40km/h
    eta_hours = dist / 40.0
    expected_delivery = (datetime.utcnow() + timedelta(hours=eta_hours)).isoformat()
    
    # Generate random 4-digit OTP for delivery security
    otp = str(random.randint(1000, 9999))
    
    new_shipment = Shipment(
        **shipment_data.model_dump(),
        route_type="direct",
        expected_delivery=expected_delivery,
        delivery_otp=otp
    )
    
    shipments_db.insert(new_shipment.model_dump())
            
    return new_shipment

@router.get("/")
def get_shipments():
    return shipments_db.get_all()

@router.get("/{shipment_id}")
def get_shipment(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return shipment

@router.put("/{shipment_id}")
def update_shipment(shipment_id: str, data: dict):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    shipments_db.update(shipment_id, data)
    return {"message": "Shipment updated successfully"}

@router.post("/{shipment_id}/auto-assign")
def auto_assign(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    if shipment.get("assigned_driver_id"):
        return {"message": "Already assigned", "shipment": shipment}

    assigned_data = auto_assign_shipment(shipment)
    if assigned_data:
        updated = shipments_db.update(shipment_id, assigned_data)
        return {"message": "Auto-assigned successfully", "shipment": updated}
    
    raise HTTPException(status_code=400, detail="No suitable driver/vehicle available")

@router.post("/{shipment_id}/assign")
def manual_assign(shipment_id: str, driver_id: str, vehicle_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    updated = shipments_db.update(shipment_id, {
        "assigned_driver_id": driver_id,
        "assigned_vehicle_id": vehicle_id,
        "status": "assigned",
        "stage": "Assigned to Driver"
    })
    return {"message": "Assigned manually", "shipment": updated}

@router.post("/bulk-assign")
def bulk_assign():
    all_shipments = shipments_db.get_all()
    pending = [s for s in all_shipments if s.get("status") == "pending"]
    assigned_count = 0
    failed_count = 0
    
    for s in pending:
        assigned_data = auto_assign_shipment(s)
        if assigned_data:
            shipments_db.update(s["id"], assigned_data)
            assigned_count += 1
        else:
            failed_count += 1
            
    return {"message": f"Bulk assignment complete. Assigned {assigned_count}, Failed {failed_count}"}

class ManualSplitRequest(BaseModel):
    warehouse_ids: List[str]

@router.post("/{shipment_id}/split/manual")
def manual_split(shipment_id: str, req: ManualSplitRequest):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment or shipment.get("is_leg"):
        raise HTTPException(status_code=400, detail="Invalid shipment for splitting")
        
    warehouses = warehouses_db.get_all()
    selected_whs = [w for w_id in req.warehouse_ids for w in warehouses if w["id"] == w_id]
    
    if len(selected_whs) != len(req.warehouse_ids):
        raise HTTPException(status_code=404, detail="One or more warehouses not found")
        
    legs = []
    current_loc = shipment["pickup"]
    
    # Create segments between warehouses
    for w in selected_whs:
        legs.append({"pickup": current_loc, "drop": {"lat": w["lat"], "lng": w["lng"], "address": w["name"]}})
        current_loc = {"lat": w["lat"], "lng": w["lng"], "address": w["name"]}
        
    # Final leg to dropoff
    legs.append({"pickup": current_loc, "drop": shipment["drop"]})
    
    _generate_legs(shipment, legs)
    return {"message": f"Manually split into {len(legs)} legs"}

@router.post("/{shipment_id}/split/auto")
def auto_split(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment or shipment.get("is_leg"):
        raise HTTPException(status_code=400, detail="Invalid shipment for splitting")
        
    warehouses = warehouses_db.get_all()
    if not warehouses:
        raise HTTPException(status_code=400, detail="No warehouses available for splitting")
        
    w_pickup = min(warehouses, key=lambda w: haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], w["lat"], w["lng"]))
    w_drop = min(warehouses, key=lambda w: haversine(shipment["drop"]["lat"], shipment["drop"]["lng"], w["lat"], w["lng"]))
    
    legs = []
    if w_pickup["id"] == w_drop["id"]:
        legs.append({"pickup": shipment["pickup"], "drop": {"lat": w_pickup["lat"], "lng": w_pickup["lng"], "address": w_pickup["name"]}})
        legs.append({"pickup": {"lat": w_drop["lat"], "lng": w_drop["lng"], "address": w_drop["name"]}, "drop": shipment["drop"]})
    else:
        legs.append({"pickup": shipment["pickup"], "drop": {"lat": w_pickup["lat"], "lng": w_pickup["lng"], "address": w_pickup["name"]}})
        legs.append({"pickup": {"lat": w_pickup["lat"], "lng": w_pickup["lng"], "address": w_pickup["name"]}, "drop": {"lat": w_drop["lat"], "lng": w_drop["lng"], "address": w_drop["name"]}})
        legs.append({"pickup": {"lat": w_drop["lat"], "lng": w_drop["lng"], "address": w_drop["name"]}, "drop": shipment["drop"]})
        
    _generate_legs(shipment, legs)
    return {"message": f"Auto split into {len(legs)} legs"}

def _generate_legs(parent_shipment, leg_data):
    # Update parent shipment
    parent_shipment["route_type"] = "multi-leg"
    parent_shipment["status"] = "split"
    shipments_db.update(parent_shipment["id"], parent_shipment)
    
    # We enforce strict time schedules based on previous leg drop time + 1 hour buffer
    current_time = datetime.utcnow()
    
    for i, leg in enumerate(leg_data):
        dist = haversine(leg["pickup"]["lat"], leg["pickup"]["lng"], leg["drop"]["lat"], leg["drop"]["lng"])
        eta_hours = dist / 40.0
        expected_time = current_time + timedelta(hours=eta_hours)
        
        leg_shipment = Shipment(
            pickup=Location(**leg["pickup"]),
            drop=Location(**leg["drop"]),
            weight=parent_shipment["weight"],
            description=f"{parent_shipment['description']} (Leg {i+1})",
            parent_id=parent_shipment["id"],
            is_leg=True,
            leg_order=i+1,
            route_type="direct",
            expected_delivery=expected_time.isoformat()
        )
        shipments_db.insert(leg_shipment.model_dump())
        
        # Next leg starts after a 1 hour buffer (for warehouse processing)
        current_time = expected_time + timedelta(hours=1)
