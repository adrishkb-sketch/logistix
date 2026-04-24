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
    now = datetime.utcnow()
    expected_delivery = (now + timedelta(hours=eta_hours)).isoformat()
    pickup_deadline = (now + timedelta(hours=1)).isoformat() # Deadline to pick up is 1 hour from now
    
    # Generate random 4-digit OTP for delivery security
    otp = str(random.randint(1000, 9999))
    
    from backend.models import ShipmentEvent
    initial_log = ShipmentEvent(
        status="pending",
        message="Shipment created and awaiting assignment.",
        location=shipment_data.pickup
    )
    
    new_shipment = Shipment(
        **shipment_data.model_dump(),
        route_type="direct",
        expected_delivery=expected_delivery,
        pickup_deadline=pickup_deadline,
        delivery_otp=otp,
        logs=[initial_log]
    )
    
    shipments_db.insert(new_shipment.model_dump())
            
    return new_shipment

@router.get("/")
def get_shipments():
    return shipments_db.get_all()

@router.get("/{shipment_id}")
def get_shipment(shipment_id: str):
    all_ships = shipments_db.get_all()
    shipment = next((s for s in all_ships if s["id"] == shipment_id), None)
    
    if not shipment:
        # Try prefix matching for short IDs
        shipment = next((s for s in all_ships if s["id"].startswith(shipment_id)), None)
        
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    # Inherit OTP from parent if it's a split leg
    if shipment.get("is_leg") and not shipment.get("delivery_otp"):
        parent = shipments_db.get_by_id(shipment.get("parent_id"))
        if parent and parent.get("delivery_otp"):
            shipment["delivery_otp"] = parent.get("delivery_otp")
            shipments_db.update(shipment["id"], {"delivery_otp": shipment["delivery_otp"]})
            
    # If it's a legacy shipment and STILL doesn't have an OTP, generate one
    if not shipment.get("delivery_otp"):
        import random
        new_otp = str(random.randint(1000, 9999))
        shipment["delivery_otp"] = new_otp
        shipments_db.update(shipment["id"], {"delivery_otp": new_otp})
            
    return shipment

@router.put("/{shipment_id}")
def update_shipment(shipment_id: str, data: dict):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    # Check if status or stage changed
    from backend.models import ShipmentEvent
    
    status_changed = data.get("status") and data["status"] != shipment.get("status")
    stage_changed = data.get("stage") and data["stage"] != shipment.get("stage")
    
    if status_changed or stage_changed:
        msg = data.get("stage", shipment.get("stage", "Updated"))
        if data.get("status") == "delivered":
            msg = "Shipment delivered successfully."
            
            # TRIGGER GAMIFIED SMART CONTRACT & JOURNEY REVIEW
            driver_id = shipment.get("assigned_driver_id")
            if driver_id:
                from backend.database import JSONDatabase
                from backend.models import SmartContractTx, JourneyReview
                from backend.services.route_engine import haversine
                import random
                
                drivers_db = JSONDatabase("drivers")
                ledger_db = JSONDatabase("ledger")
                reviews_db = JSONDatabase("journey_reviews")
                
                driver = drivers_db.get_by_id(driver_id)
                if driver:
                    # Gamification: Points Calculation
                    # Haversine distance between pickup and drop
                    dist = haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], shipment["drop"]["lat"], shipment["drop"]["lng"])
                    weight = shipment.get("weight", 0)
                    
                    # Base points: 10 per km, 2 per kg
                    points = round((dist * 10.0) + (weight * 2.0))
                    
                    # Bonus for early delivery (mocked random bonus 0-20%)
                    bonus_multiplier = 1.0 + (random.randint(0, 20) / 100.0)
                    total_points = round(points * bonus_multiplier)
                    
                    tx = SmartContractTx(
                        to_address=driver_id,
                        points_awarded=total_points,
                        shipment_id=shipment_id,
                        leg_id=shipment_id if shipment.get("is_leg") else None
                    )
                    ledger_db.insert(tx.model_dump())
                    
                    # Update driver reward points
                    new_balance = driver.get("reward_points", 0.0) + total_points
                    drivers_db.update(driver_id, {"reward_points": new_balance})
                    
                    msg += f" Smart Contract executed. Awarded: {total_points} Points 🏆."
                    
                    # Journey Review Generation
                    punctuality = driver.get("punctuality_rate", 100.0)
                    safety = driver.get("safety_index", 100.0)
                    challans = driver.get("challan_count", 0)
                    
                    # Simple AI Scorecard mock logic
                    p_score = punctuality - random.randint(0, 5) # slight deduction if any
                    s_score = safety - (challans * 5)
                    overall = (p_score + s_score) / 2
                    
                    feedback = "Excellent journey."
                    if challans > 0: feedback = f"Journey completed but {challans} challans recorded. Drive safely."
                    if overall < 80: feedback = "Delivery completed. Needs improvement in punctuality and safety."
                    
                    review = JourneyReview(
                        shipment_id=shipment_id,
                        driver_id=driver_id,
                        punctuality_score=round(p_score, 1),
                        safety_score=round(s_score, 1),
                        challan_penalty=challans * 5.0,
                        total_score=round(overall, 1),
                        feedback_message=feedback
                    )
                    reviews_db.insert(review.model_dump())
            
        log_event = ShipmentEvent(
            status=data.get("status", shipment.get("status")),
            message=msg,
            reason=data.get("reason", None)
        )
        data["logs"] = shipment.get("logs", []) + [log_event.model_dump()]
        
    shipments_db.update(shipment_id, data)
    return {"message": "Shipment updated successfully"}

@router.post("/{shipment_id}/rescue")
def dispatch_rescue(shipment_id: str):
    s = shipments_db.get_by_id(shipment_id)
    if not s:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    old_driver = s.get("assigned_driver_id")
    
    # Reset shipment for assignment
    s["assigned_driver_id"] = None
    s["assigned_vehicle_id"] = None
    s["status"] = "pending"
    
    # Use auto_assign_shipment to find a new available driver/vehicle
    from backend.services.assignment import auto_assign_shipment
    try:
        assigned_data = auto_assign_shipment(s)
        s["assigned_driver_id"] = assigned_data["driver_id"]
        s["assigned_vehicle_id"] = assigned_data["vehicle_id"]
        s["status"] = "assigned"
        s["stage"] = "Rescue Dispatched"
        
        from backend.models import ShipmentEvent
        log = ShipmentEvent(status="assigned", message="Rescue vehicle dispatched and assigned automatically.", reason="Previous vehicle breakdown.")
        s["logs"] = s.get("logs", []) + [log.model_dump()]
        
        shipments_db.update(shipment_id, s)
        
        # Free up the old driver
        if old_driver:
            from backend.database import JSONDatabase
            drivers_db = JSONDatabase("drivers")
            drv = drivers_db.get_by_id(old_driver)
            if drv:
                drv["assigned_vehicle_id"] = None # Old driver loses the broken vehicle
                drivers_db.update(old_driver, drv)
                
        return {"message": "Rescue successful.", "new_driver": assigned_data["driver_id"]}
    except ValueError as e:
        # Revert status if no rescue available
        s["status"] = "delayed"
        shipments_db.update(shipment_id, s)
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{shipment_id}/auto-assign")
def auto_assign(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    if shipment.get("assigned_driver_id"):
        return {"message": "Already assigned", "shipment": shipment}

    assigned_data = auto_assign_shipment(shipment)
    if assigned_data:
        from backend.models import ShipmentEvent
        log_event = ShipmentEvent(status="assigned", message="AI successfully auto-assigned driver and vehicle.")
        assigned_data["logs"] = shipment.get("logs", []) + [log_event.model_dump()]
        
        updated = shipments_db.update(shipment_id, assigned_data)
        return {"message": "Auto-assigned successfully", "shipment": updated}
    
    raise HTTPException(status_code=400, detail="No suitable driver/vehicle available")

@router.post("/{shipment_id}/assign")
def manual_assign(shipment_id: str, driver_id: str, vehicle_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    from backend.models import ShipmentEvent
    log_event = ShipmentEvent(status="assigned", message=f"Manually assigned to driver {driver_id}")
    logs = shipment.get("logs", []) + [log_event.model_dump()]
    
    updated = shipments_db.update(shipment_id, {
        "assigned_driver_id": driver_id,
        "assigned_vehicle_id": vehicle_id,
        "status": "assigned",
        "stage": "Assigned to Driver",
        "logs": logs
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
            from backend.models import ShipmentEvent
            log_event = ShipmentEvent(status="assigned", message="AI successfully bulk-assigned driver and vehicle.")
            assigned_data["logs"] = s.get("logs", []) + [log_event.model_dump()]
            shipments_db.update(s["id"], assigned_data)
            assigned_count += 1
        else:
            failed_count += 1
            
    return {"message": f"Bulk assignment complete. Assigned {assigned_count}, Failed {failed_count}"}

@router.post("/consolidate")
def consolidate_shipments():
    all_shipments = shipments_db.get_all()
    pending = [s for s in all_shipments if s.get("status") == "pending"]
    consolidated_count = 0
    
    from backend.services.route_engine import haversine
    from backend.models import ShipmentEvent
    
    for i in range(len(pending)):
        s1 = pending[i]
        if s1.get("status") != "pending": continue # might have been merged
        
        for j in range(i+1, len(pending)):
            s2 = pending[j]
            if s2.get("status") != "pending": continue
            
            # Check if pickup and dropoff are within 50km
            p_dist = haversine(s1["pickup"]["lat"], s1["pickup"]["lng"], s2["pickup"]["lat"], s2["pickup"]["lng"])
            d_dist = haversine(s1["drop"]["lat"], s1["drop"]["lng"], s2["drop"]["lat"], s2["drop"]["lng"])
            
            if p_dist < 50 and d_dist < 50:
                # Merge them!
                # We will assign s2 to the same driver/vehicle as s1 if s1 gets assigned, 
                # but for simplicity, let's just make s2 a child of s1, or mark them as consolidated.
                
                # Try to assign s1
                assigned_data = auto_assign_shipment(s1)
                if assigned_data:
                    # s1 assigned successfully
                    log1 = ShipmentEvent(status="assigned", message=f"AI Consolidated with Shipment {s2['id'][:8]}.")
                    assigned_data["logs"] = s1.get("logs", []) + [log1.model_dump()]
                    shipments_db.update(s1["id"], assigned_data)
                    
                    # Force s2 to take the exact same assignment
                    s2_update = {
                        "assigned_driver_id": assigned_data["assigned_driver_id"],
                        "assigned_vehicle_id": assigned_data["assigned_vehicle_id"],
                        "status": "assigned",
                        "stage": "Assigned to Driver (Consolidated)"
                    }
                    log2 = ShipmentEvent(status="assigned", message=f"AI Consolidated with Shipment {s1['id'][:8]}.")
                    s2_update["logs"] = s2.get("logs", []) + [log2.model_dump()]
                    
                    shipments_db.update(s2["id"], s2_update)
                    
                    s1["status"] = "assigned" # mark as processed
                    s2["status"] = "assigned"
                    consolidated_count += 2
                    break # s1 is processed, move to next s1
                    
    return {"message": f"Consolidated {consolidated_count} shipments into shared vehicles."}

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
    from backend.models import ShipmentEvent
    
    # Update parent shipment
    parent_shipment["route_type"] = "multi-leg"
    parent_shipment["status"] = "split"
    
    log_event = ShipmentEvent(status="split", message=f"Route split into {len(leg_data)} legs.")
    parent_shipment["logs"] = parent_shipment.get("logs", []) + [log_event.model_dump()]
    
    shipments_db.update(parent_shipment["id"], parent_shipment)
    
    # We enforce strict time schedules based on previous leg drop time + 1 hour buffer
    current_time = datetime.utcnow()
    
    for i, leg in enumerate(leg_data):
        dist = haversine(leg["pickup"]["lat"], leg["pickup"]["lng"], leg["drop"]["lat"], leg["drop"]["lng"])
        eta_hours = dist / 40.0
        expected_time = current_time + timedelta(hours=eta_hours)
        
        leg_log = ShipmentEvent(
            status="pending",
            message=f"Created as Leg {i+1} of a split route.",
            location=leg["pickup"]
        )
        
        leg_shipment = Shipment(
            pickup=Location(**leg["pickup"]),
            drop=Location(**leg["drop"]),
            weight=parent_shipment["weight"],
            description=f"{parent_shipment['description']} (Leg {i+1})",
            parent_id=parent_shipment["id"],
            is_leg=True,
            leg_order=i+1,
            route_type="direct",
            expected_delivery=expected_time.isoformat(),
            delivery_otp=parent_shipment.get("delivery_otp"),
            logs=[leg_log]
        )
        shipments_db.insert(leg_shipment.model_dump())
        
        # Next leg starts after a 1 hour buffer (for warehouse processing)
        current_time = expected_time + timedelta(hours=1)
