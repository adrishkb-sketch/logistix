from fastapi import APIRouter, HTTPException, UploadFile, File
from backend.models import ShipmentCreate, Shipment, Location, ShipmentEvent
from backend.database import JSONDatabase
from backend.services.assignment import auto_assign_shipment
from backend.services.route_engine import calculate_route_type, haversine
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel
import uuid
import random
import pandas as pd
import io
import requests
import re

from backend.services.time_utils import snap_eta_to_business_hours

import random
import pandas as pd
import io
import requests
import re

router = APIRouter()
shipments_db = JSONDatabase("shipments")
warehouses_db = JSONDatabase("warehouses")

class ShipmentRating(BaseModel):
    rating: float # 1-5

class BulkParseRequest(BaseModel):
    url: str
    company_id: str

@router.post("/bulk-parse")
async def bulk_parse(company_id: str, file: Optional[UploadFile] = File(None), url_req: Optional[str] = None):
    df = None
    if file:
        content = await file.read()
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))
    elif url_req:
        # Extract Google Sheets ID
        match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", url_req)
        if not match:
            raise HTTPException(status_code=400, detail="Invalid Google Sheets URL")
        sheet_id = match.group(1)
        csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
        resp = requests.get(csv_url)
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch Google Sheet. Ensure it is public.")
        df = pd.read_csv(io.StringIO(resp.text))
    
    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="No data found in file or spreadsheet")

    # Standardizing to 12 columns:
    # Pickup Lat | Pickup Lng | Drop Lat | Drop Lng | Weight | Description | Name | Phone | Email | Perishable | E-Way No | E-Way Expiry
    
    shipments = []
    for _, row in df.iterrows():
        try:
            # Handle possible header or no-header by checking numeric values
            vals = row.values.tolist()
            if len(vals) < 9: continue
            
            phone = str(vals[7]).strip()
            if len(phone) == 10 and phone.isdigit():
                phone = "+91" + phone
            
            s = {
                "pickup": {"lat": float(vals[0]), "lng": float(vals[1])},
                "drop": {"lat": float(vals[2]), "lng": float(vals[3])},
                "weight": float(vals[4]),
                "description": str(vals[5]),
                "receiver_name": str(vals[6]),
                "receiver_phone": phone,
                "receiver_email": str(vals[8]).strip().lower() if len(vals) > 8 else None,
                "is_perishable": str(vals[9]).lower() in ['yes', 'y', 'true', '1'] if len(vals) > 9 else False,
                "eway_bill_no": str(vals[10]) if len(vals) > 10 else None,
                "eway_bill_expiry": str(vals[11]) if len(vals) > 11 else None,
                "company_id": company_id
            }
            shipments.append(s)
        except Exception as e:
            continue
            
    return {"shipments": shipments, "count": len(shipments)}

@router.post("/bulk-confirm")
async def bulk_confirm(shipments: List[ShipmentCreate]):
    results = {"success": [], "errors": []}
    for s_data in shipments:
        try:
            res = create_shipment(s_data)
            results["success"].append(res.id)
        except HTTPException as e:
            results["errors"].append({"description": s_data.description, "error": e.detail})
        except Exception as e:
            results["errors"].append({"description": s_data.description, "error": str(e)})
            
    return results

class ShipmentRating(BaseModel):
    rating: float # 1-5

@router.post("/{shipment_id}/pay")
def pay_shipment(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    if shipment.get("payment_status") == "paid":
        return {"message": "Already paid"}
        
    price = shipment.get("finance", {}).get("suggested_price", 0)
    
    # 1. Update Shipment
    from backend.models import ShipmentEvent
    from datetime import datetime
    new_log = {
        "status": shipment.get("status"),
        "message": f"💰 PAYMENT RECEIVED: ₹{price.toLocaleString() if hasattr(price, 'toLocaleString') else price} paid by customer via Digital Gateway.",
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
    
    shipments_db.update(shipment_id, {
        "payment_status": "paid",
        "logs": shipment.get("logs", []) + [new_log]
    })
    
    # 2. Record in Ledger
    ledger_db = JSONDatabase("ledger")
    ledger_db.insert({
        "id": str(uuid.uuid4()),
        "company_id": shipment.get("company_id"),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "REVENUE",
        "amount": price,
        "description": f"Customer Payment for Shipment #{shipment_id[:8]}",
        "category": "shipping_fee"
    })
    
    return {"message": "Payment successful", "amount": price}
    
@router.post("/{shipment_id}/rate")
def rate_shipment(shipment_id: str, rating_data: ShipmentRating):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    if shipment.get("status") != "delivered":
        raise HTTPException(status_code=400, detail="Only delivered shipments can be rated")
        
    if shipment.get("customer_rating"):
        raise HTTPException(status_code=400, detail="Shipment already rated")
        
    driver_id = shipment.get("assigned_driver_id")
    if not driver_id:
        raise HTTPException(status_code=400, detail="No driver assigned to this shipment")
        
    drivers_db = JSONDatabase("drivers")
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    # Update driver rating
    old_rating = driver.get("rating", 5.0)
    # Use total_deliveries from model
    count = driver.get("total_deliveries", 0)
    new_rating = ((old_rating * count) + rating_data.rating) / (count + 1)
    
    # Update reward points based on rating
    # Bonus: (Rating - 3) * 20. 5=40, 4=20, 3=0, 2=-20, 1=-40
    rating_bonus = (rating_data.rating - 3) * 20
    new_points = driver.get("reward_points", 0.0) + rating_bonus
    
    drivers_db.update(driver_id, {
        "rating": round(new_rating, 2),
        "total_deliveries": count + 1,
        "reward_points": new_points
    })
    
    # Store rating in shipment and update breakdown
    breakdown = shipment.get("points_breakdown", {})
    breakdown["customer_rating_bonus"] = rating_bonus
    breakdown["total"] = breakdown.get("total", 0) + rating_bonus
    
    shipments_db.update(shipment_id, {
        "customer_rating": rating_data.rating,
        "points_breakdown": breakdown
    })
    
    # Log the event
    log = ShipmentEvent(
        status="delivered",
        message=f"Receiver rated the delivery: {rating_data.rating}⭐. Driver earned {rating_bonus} bonus points.",
        location=shipment.get("drop")
    )
    history = shipment.get("logs", [])
    history.append(log.model_dump())
    shipments_db.update(shipment_id, {"logs": history})
    
    return {"message": "Rating submitted", "bonus_points": rating_bonus}

@router.post("/")
def create_shipment(shipment_data: ShipmentCreate):
    dist = haversine(shipment_data.pickup.lat, shipment_data.pickup.lng, shipment_data.drop.lat, shipment_data.drop.lng)
    
    # Cold Chain Feasibility Validation
    if shipment_data.is_perishable:
        # Distance check (legacy)
        if dist > 100:
            raise HTTPException(
                status_code=400, 
                detail=f"Cold Chain distance limit exceeded ({round(dist, 1)}km). Max allowed is 100km for perishable goods."
            )
            
        # Advanced Fleet Availability Check
        drivers_db = JSONDatabase("drivers")
        vehicles_db = JSONDatabase("vehicles")
        warehouses_db = JSONDatabase("warehouses")
        
        available_drivers = [d for d in drivers_db.get_all() if d.get("company_id") == shipment_data.company_id and d.get("status") == "available" and d.get("assigned_vehicle_id")]
        
        if not available_drivers:
            raise HTTPException(
                status_code=400,
                detail="No available fleet found to handle this perishable shipment. Please ensure drivers are on standby."
            )
            
        from backend.services.route_engine import predict_weather_impact
        weather = predict_weather_impact(shipment_data.pickup.lat, shipment_data.pickup.lng)
        w_mult = weather.get("multiplier", 1.0)
        
        min_total_mins = float('inf')
        
        for d in available_drivers:
            # Estimate time from base warehouse to pickup
            base_wh = warehouses_db.get_by_id(d.get("base_warehouse_id"))
            if not base_wh: continue
            
            v = vehicles_db.get_by_id(d["assigned_vehicle_id"])
            if not v: continue
            
            speed = v.get("speed", 40)
            
            dist_to_pickup = haversine(base_wh["lat"], base_wh["lng"], shipment_data.pickup.lat, shipment_data.pickup.lng)
            dist_to_drop = dist # Pickup to Drop
            
            total_dist = dist_to_pickup + dist_to_drop
            # Time in minutes = (dist / speed) * 60 * weather_multiplier
            est_mins = (total_dist / speed) * 60 * w_mult
            
            if est_mins < min_total_mins:
                min_total_mins = est_mins
        
        if min_total_mins > 60:
            raise HTTPException(
                status_code=400,
                detail=f"Perishable Violation: It is impossible to deliver this within the 1-hour window. Best estimated time with current fleet: {round(min_total_mins)} minutes (including traffic/weather)."
            )

    # Calculate ETA based on avg speed 40km/h, clamped to 8am-10pm IST
    eta_hours = dist / 40.0
    now = datetime.utcnow()
    raw_eta = now + timedelta(hours=eta_hours)
    snapped_eta = snap_eta_to_business_hours(raw_eta)
    expected_delivery = snapped_eta.isoformat() + "Z"
    pickup_deadline = (now + timedelta(hours=1)).isoformat() + "Z"  # Deadline to pick up is 1 hour from now
    
    # Generate random 4-digit OTP for delivery security
    otp = str(random.randint(1000, 9999))
    
    pickup_addr = shipment_data.pickup.address or f"{shipment_data.pickup.lat}, {shipment_data.pickup.lng}"
    drop_addr = shipment_data.drop.address or f"{shipment_data.drop.lat}, {shipment_data.drop.lng}"
    initial_log = ShipmentEvent(
        status="pending",
        message=f"📦 Shipment created — {pickup_addr} → {drop_addr}. Awaiting fleet assignment.",
        location=shipment_data.pickup
    )
    
    from backend.services.finance_engine import estimate_delivery_cost
    finance = estimate_delivery_cost(shipment_data.model_dump())

    new_shipment = Shipment(
        **shipment_data.model_dump(),
        route_type="direct",
        expected_delivery=expected_delivery,
        pickup_deadline=pickup_deadline,
        delivery_otp=otp,
        logs=[initial_log],
        vitality=100.0,
        qr_code_data=str(uuid.uuid4()),
        finance=finance,
        payment_status="unpaid"
    )
    
    shipments_db.insert(new_shipment.model_dump())
            
    return new_shipment

@router.get("/")
def get_shipments(company_id: str):
    from backend.services.cold_chain import calculate_shipment_vitality
    all_ships = shipments_db.get_all()
    company_ships = [s for s in all_ships if s.get("company_id") == company_id]
    
    # Recalculate vitality and check compliance/street intel
    from backend.services.alert_engine import check_compliance_alerts, check_street_intel_alerts, check_heatwave_safety
    vehicles_db = JSONDatabase("vehicles")
    for s in company_ships:
        if s.get("is_perishable"):
            new_v = calculate_shipment_vitality(s)
            if new_v != s.get("vitality"):
                s["vitality"] = new_v
                shipments_db.update(s["id"], {"vitality": new_v})
        
        # Run Indian-specific "Killer Feature" checks
        check_compliance_alerts(s)
        check_street_intel_alerts(s)
        
        # Heatwave safety: stop bike/scooty drivers in heat zones
        v_id = s.get("assigned_vehicle_id")
        if v_id and s.get("status") == "in_transit":
            vehicle = vehicles_db.get_by_id(v_id)
            if vehicle:
                check_heatwave_safety(s, vehicle)
                
    return company_ships

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
                    # Gamification: Advanced Points Calculation
                    dist = haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], shipment["drop"]["lat"], shipment["drop"]["lng"])
                    weight = shipment.get("weight", 0)
                    
                    # 1. Base Distance Points (5 per km)
                    base_pts = round(dist * 5.0)
                    
                    # 2. Punctuality Bonus (Max 50)
                    is_timely = datetime.utcnow().isoformat() <= shipment.get("expected_delivery", "9999")
                    punct_pts = 50 if is_timely else 0
                    
                    # 3. Safety Multiplier (No active challans in record)
                    safety_bonus = 30 if driver.get("challan_count", 0) == 0 else 0
                    
                    # 4. Wellness Bonus (Proper Rest / Low Fatigue)
                    fatigue = driver.get("fatigue_score", 0)
                    wellness_pts = 20 if fatigue < 30 else 5
                    
                    total_points = base_pts + punct_pts + safety_bonus + wellness_pts
                    
                    breakdown = {
                        "base_distance": base_pts,
                        "punctuality_bonus": punct_pts,
                        "safety_incentive": safety_bonus,
                        "wellness_bonus": wellness_pts,
                        "total": total_points
                    }
                    
                    tx = SmartContractTx(
                        to_address=driver_id,
                        points_awarded=total_points,
                        breakdown=breakdown,
                        shipment_id=shipment_id,
                        leg_id=shipment_id if shipment.get("is_leg") else None
                    )
                    ledger_db.insert(tx.model_dump())
                    
                    # Update driver reward points
                    new_balance = driver.get("reward_points", 0.0) + total_points
                    driver["reward_points"] = new_balance
                    
                    # Save breakdown to shipment for driver view
                    data["points_breakdown"] = breakdown
                    
                    msg += f" Smart Contract executed. Awarded: {total_points} Points 🏆."
                    
                    # Update Performance Metrics
                    driver["total_trips"] = driver.get("total_trips", 0) + 1
                    
                    # Check punctuality
                    is_timely = datetime.utcnow().isoformat() <= shipment.get("expected_delivery", "9999")
                    old_punct = driver.get("punctuality_rate", 100.0)
                    # Weighted average for punctuality (80% historical, 20% recent)
                    new_punct = (old_punct * 0.8) + (100.0 if is_timely else 70.0) * 0.2
                    driver["punctuality_rate"] = round(new_punct, 2)
                    
                    # Recalculate scores
                    from backend.services.driver_intel import calculate_driver_performance_score, calculate_safety_rating, calculate_vehicle_efficiency_score
                    driver["safety_rating"] = calculate_safety_rating(driver)
                    driver["driving_score"] = calculate_driver_performance_score(driver)
                    
                    drivers_db.update(driver_id, driver)
                    
                    # Update Vehicle Health (Wear & Tear)
                    vehicle_id = shipment.get("assigned_vehicle_id")
                    if vehicle_id:
                        vehicles_db = JSONDatabase("vehicles")
                        vehicle = vehicles_db.get_by_id(vehicle_id)
                        if vehicle:
                            # Wear and tear: ~0.05% health reduction per km
                            wear = dist * 0.05 
                            new_health = max(0.0, vehicle.get("vehicle_health_score", 100.0) - wear)
                            vehicle["vehicle_health_score"] = round(new_health, 2)
                            vehicle["efficiency_score"] = calculate_vehicle_efficiency_score(vehicle)
                            vehicles_db.update(vehicle_id, vehicle)

                    msg += f" Smart Contract executed. Awarded: {total_points} Points 🏆."
                    
                    # Journey Review Generation
                    punctuality = driver.get("punctuality_rate", 100.0)
                    safety = driver.get("safety_rating", 5.0) * 20.0 # Convert 5.0 scale to 100
                    challans = driver.get("challan_count", 0)
                    
                    # Simple AI Scorecard mock logic
                    p_score = punctuality - random.randint(0, 5) 
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
            
    # Check for explicit log entry from driver app
    if data.get("log_entry"):
        from backend.models import ShipmentEvent
        le = data["log_entry"]
        log_event = ShipmentEvent(
            status=le.get("status", shipment.get("status")),
            message=le.get("message", "System Update"),
            reason=le.get("reason"),
            photo_url=le.get("photo_url")
        )
        shipment["logs"] = shipment.get("logs", []) + [log_event.model_dump()]
        # Remove from data to avoid duplicate log creation below
        del data["log_entry"]
    elif status_changed or stage_changed:
        from backend.models import ShipmentEvent
        log_event = ShipmentEvent(
            status=data.get("status", shipment.get("status")),
            message=msg,
            reason=data.get("reason", None)
        )
        shipment["logs"] = shipment.get("logs", []) + [log_event.model_dump()]
    
    # Credit driver's wallet on delivery (MOVED TO driver.py/complete_delivery)
    if data.get("status") == "delivered" and shipment.get("status") != "delivered":
        pass
        
        # RECORD FINANCIAL LEDGER ENTRY
        finance = shipment.get("finance", {})
        if finance:
            ledger_db = JSONDatabase("ledger")
            # 1. Record Revenue (What customer paid)
            ledger_db.insert({
                "type": "REVENUE",
                "desc": f"Shipment Delivered: {shipment['id'][:8]}",
                "amount": finance.get("suggested_price", 0),
                "timestamp": datetime.utcnow().isoformat(),
                "company_id": shipment.get("company_id")
            })
            # 2. Record Total Operational Cost (Expense)
            ledger_db.insert({
                "type": "EXPENSE",
                "desc": f"Ops Cost (Fuel/Maint/Pay): {shipment['id'][:8]}",
                "amount": finance.get("total_cost", 0),
                "timestamp": datetime.utcnow().isoformat(),
                "company_id": shipment.get("company_id")
            })

    # Merge other updates
    shipment.update(data)
    shipments_db.update(shipment_id, shipment)
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
        log = ShipmentEvent(status="assigned", message="🚑 Rescue vehicle dispatched and assigned automatically.", reason="Previous vehicle breakdown. AI rerouted nearest available recovery unit.")
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
    import traceback
    try:
        shipment = shipments_db.get_by_id(shipment_id)
        if not shipment:
            raise HTTPException(status_code=404, detail="Shipment not found")
        
        if shipment.get("assigned_driver_id"):
            return {"message": "Already assigned", "shipment": shipment}

        from backend.services.route_engine import haversine
        p = shipment["pickup"]
        d = shipment["drop"]
        total_dist = haversine(p["lat"], p["lng"], d["lat"], d["lng"])
        
        # AUTOMATIC ROUTE SPLITTING:
        # If distance > 50km (or user requirement for robustness) and it's a fresh shipment, force a split first
        if (total_dist > 50 or shipment.get("is_perishable")) and not shipment.get("is_leg") and shipment.get("status") == "pending":
            from backend.services.route_engine import decompose_shipment
            legs_data = decompose_shipment(shipment)
            if len(legs_data) > 1:
                new_leg_ids = _generate_legs(shipment, legs_data)
                
                # AUTO-ASSIGN ALL LEGS IMMEDIATELY
                assigned_count = 0
                from backend.services.assignment import auto_assign_shipment
                for leg_id in new_leg_ids:
                    try:
                        leg = shipments_db.get_by_id(leg_id)
                        assigned_data = auto_assign_shipment(leg)
                        if assigned_data:
                            # Add logs to leg
                            from backend.models import ShipmentEvent
                            d_db = JSONDatabase("drivers")
                            v_db = JSONDatabase("vehicles")
                            d_id = assigned_data.get("assigned_driver_id")
                            v_id = assigned_data.get("assigned_vehicle_id")
                            
                            if d_id == "DRONE-SYSTEM":
                                log_event = ShipmentEvent(status="in_transit", message=f"🛰️ AI deployed autonomous drone {v_id} for the last-mile segment.")
                            else:
                                d = d_db.get_by_id(d_id)
                                v = v_db.get_by_id(v_id)
                                driver_name = d.get("name", "Unknown") if d else "Unknown"
                                plate = v.get("number_plate", "Unknown") if v else "Unknown"
                                log_event = ShipmentEvent(status="assigned", message=f"🤖 AI successfully assigned driver {driver_name} and vehicle {plate}.")
                            
                            assigned_data["logs"] = (leg.get("logs") or []) + [log_event.model_dump()]
                            shipments_db.update(leg["id"], assigned_data)
                            
                            # SIDE EFFECTS: Link driver and vehicle, set status
                            if d_id != "DRONE-SYSTEM":
                                d_db.update(d_id, {"status": "assigned", "assigned_vehicle_id": v_id})
                                v_db.update(v_id, {"status": "assigned", "assigned_driver_id": d_id})
                            
                            assigned_count += 1
                    except Exception as le:
                        print(f"Leg Assignment Error: {str(le)}")
                
                return {
                    "message": f"Shipment automatically segmented into {len(all_new_legs)} legs and assigned to base warehouse drivers.",
                    "action": "split",
                    "legs_count": len(all_new_legs),
                    "assigned_count": assigned_count
                }

        assigned_data = auto_assign_shipment(shipment)
        
        if assigned_data:
            from backend.models import ShipmentEvent
            d_db = JSONDatabase("drivers")
            v_db = JSONDatabase("vehicles")
            
            d_id = assigned_data.get("assigned_driver_id")
            v_id = assigned_data.get("assigned_vehicle_id")
            
            if d_id == "DRONE-SYSTEM":
                log_event = ShipmentEvent(
                    status="in_transit", 
                    message=f"🛰️ AI deployed autonomous drone {v_id} for the last-mile segment."
                )
            else:
                d = d_db.get_by_id(d_id)
                v = v_db.get_by_id(v_id)
                driver_name = d.get("name", "Unknown") if d else "Unknown"
                plate = v.get("number_plate", "Unknown") if v else "Unknown"
                
                log_event = ShipmentEvent(
                    status="assigned", 
                    message=f"🤖 AI successfully assigned driver {driver_name} and vehicle {plate}."
                )
            
            assigned_data["logs"] = (shipment.get("logs") or []) + [log_event.model_dump()]
            
            # SIDE EFFECTS: Link driver and vehicle, set status
            if d_id != "DRONE-SYSTEM":
                d_db.update(d_id, {"status": "assigned", "assigned_vehicle_id": v_id})
                v_db.update(v_id, {"status": "assigned", "assigned_driver_id": d_id})
                
            updated = shipments_db.update(shipment_id, assigned_data)
            try:
                if d_id != "DRONE-SYSTEM":
                    from backend.services.assignment import reoptimize_driver_route
                    reoptimize_driver_route(d_id)
            except: pass
            return {"message": "Auto-assigned successfully", "shipment": updated}
        
        raise HTTPException(status_code=400, detail="No suitable driver/vehicle available")
        
    except Exception as e:
        err_msg = traceback.format_exc()
        print(f"AUTO_ASSIGN_ERROR: {err_msg}")
        raise HTTPException(status_code=500, detail=f"Critical Assignment Error:\n{err_msg}")

from backend.models import ManualAssignRequest

@router.post("/{shipment_id}/assign")
def manual_assign(shipment_id: str, data: ManualAssignRequest):
    driver_id = data.driver_id
    vehicle_id = data.vehicle_id
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    from backend.database import JSONDatabase
    d = JSONDatabase("drivers").get_by_id(driver_id)
    v = JSONDatabase("vehicles").get_by_id(vehicle_id)
    driver_name = d.get("name", "Unknown") if d else "Unknown"
    plate = v.get("number_plate", "Unknown") if v else "Unknown"
    
    from backend.models import ShipmentEvent
    if not driver_id:
        # Autonomous/Drone logic
        log_event = ShipmentEvent(
            status="in_transit", 
            message=f"🛰️ Autonomous Dispatch: Assigned to Drone {plate}.",
            reason="Manager manually triggered drone air delivery for this segment."
        )
        stage = "Drone Air Delivery"
        status = "in_transit"
        # Decrement drone count if it's a drone
        if v and "drone" in v.get("type", "").lower():
            wh_id = shipment.get("pickup_warehouse_id")
            if wh_id:
                wh = JSONDatabase("warehouses").get_by_id(wh_id)
                if wh and wh.get("drone_count", 0) > 0:
                    JSONDatabase("warehouses").update(wh_id, {"drone_count": wh["drone_count"] - 1})
    else:
        log_event = ShipmentEvent(
            status="assigned", 
            message=f"👤 Manually assigned to driver {driver_name}. Vehicle: {plate}."
        )
        stage = "Assigned to Driver"
        status = "assigned"

    logs = shipment.get("logs", []) + [log_event.model_dump()]
    
    updated = shipments_db.update(shipment_id, {
        "assigned_driver_id": driver_id,
        "assigned_vehicle_id": vehicle_id,
        "status": status,
        "stage": stage,
        "logs": logs
    })
    try:
        from backend.services.assignment import reoptimize_driver_route
        reoptimize_driver_route(driver_id)
    except: pass
    return {"message": "Assigned manually", "shipment": updated}

@router.post("/bulk-assign")
def bulk_assign(company_id: str):
    # Only consider shipments that aren't yet picked up or delivered
    pending = [s for s in shipments_db.get_all() if s.get("status") == "pending" and s.get("company_id") == company_id]
    assigned_count = 0
    failed_count = 0
    
    from backend.database import JSONDatabase
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    from backend.services.assignment import auto_assign_shipment
    
    for s in pending:
        assigned_data = auto_assign_shipment(s)
        if assigned_data:
            from backend.models import ShipmentEvent
            d = drivers_db.get_by_id(assigned_data["assigned_driver_id"])
            v = vehicles_db.get_by_id(assigned_data["assigned_vehicle_id"])
            driver_name = d["name"] if d else "Unknown"
            plate = v["number_plate"] if v else "Unknown"
            
            log_event = ShipmentEvent(
                status="assigned", 
                message=f"🤖 AI successfully bulk-assigned driver {driver_name} and vehicle {plate}."
            )
            assigned_data["logs"] = s.get("logs", []) + [log_event.model_dump()]
            shipments_db.update(s["id"], assigned_data)
            assigned_count += 1
        else:
            failed_count += 1
            
    return {"message": f"Bulk assignment complete. Assigned {assigned_count}, Failed {failed_count}"}

@router.post("/consolidate")
def consolidate_shipments(company_id: str):
    all_shipments = shipments_db.get_all()
    pending = [s for s in all_shipments if s.get("status") == "pending" and s.get("company_id") == company_id]
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
                    log1 = ShipmentEvent(status="assigned", message=f"📦 AI Consolidated with Shipment {s2['id'][:8]}. Efficiency optimized.")
                    assigned_data["logs"] = s1.get("logs", []) + [log1.model_dump()]
                    shipments_db.update(s1["id"], assigned_data)
                    
                    # Force s2 to take the exact same assignment
                    s2_update = {
                        "assigned_driver_id": assigned_data["assigned_driver_id"],
                        "assigned_vehicle_id": assigned_data["assigned_vehicle_id"],
                        "status": "assigned",
                        "stage": "Assigned to Driver (Consolidated)"
                    }
                    log2 = ShipmentEvent(status="assigned", message=f"📦 AI Consolidated with Shipment {s1['id'][:8]}. Efficiency optimized.")
                    s2_update["logs"] = s2.get("logs", []) + [log2.model_dump()]
                    
                    shipments_db.update(s2["id"], s2_update)
                    
                    s1["status"] = "assigned" # mark as processed
                    s2["status"] = "assigned"
                    consolidated_count += 2
                    break # s1 is processed, move to next s1
                    
    return {"message": f"Consolidated {consolidated_count} shipments into shared vehicles."}

class LegAssignment(BaseModel):
    driver_id: Optional[str] = None
    vehicle_id: str

class ManualSplitRequest(BaseModel):
    warehouse_ids: List[str]
    assignments: Optional[List[LegAssignment]] = None
    company_id: str

@router.post("/{shipment_id}/split/manual")
def manual_split(shipment_id: str, req: ManualSplitRequest):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment or shipment.get("is_leg") or shipment.get("status") in ["delivered", "in_transit"]:
        raise HTTPException(status_code=400, detail="Invalid shipment for splitting. Cannot split shipments already in transit or delivered.")
        
    warehouses = warehouses_db.get_all()
    selected_whs = [w for w_id in req.warehouse_ids for w in warehouses if w.get("id") == w_id]
    
    if len(selected_whs) != len(req.warehouse_ids):
        raise HTTPException(status_code=404, detail="One or more warehouses not found")
        
    legs = []
    current_loc = shipment["pickup"]
    
    # Create segments between warehouses
    for w in selected_whs:
        legs.append({
            "pickup": current_loc, 
            "drop": {"lat": w["lat"], "lng": w["lng"], "address": w["name"]},
            "pickup_warehouse_id": legs[-1]["drop_warehouse_id"] if legs else None,
            "drop_warehouse_id": w["id"]
        })
        current_loc = {"lat": w["lat"], "lng": w["lng"], "address": w["name"]}
        
    # Final leg to dropoff
    legs.append({
        "pickup": current_loc, 
        "drop": shipment["drop"],
        "pickup_warehouse_id": legs[-1]["drop_warehouse_id"] if legs else None,
        "drop_warehouse_id": None
    })
    
    new_leg_ids = _generate_legs(shipment, legs)
    
    # Apply Assignments if provided
    if req.assignments and len(req.assignments) == len(new_leg_ids):
        for i, leg_id in enumerate(new_leg_ids):
            assign_data = req.assignments[i]
            if assign_data:
                manual_assign(leg_id, LegAssignment(driver_id=assign_data.driver_id, vehicle_id=assign_data.vehicle_id))
            else:
                # Fallback to auto-assign for this leg if not manually specified
                try:
                    auto_assign(leg_id)
                except: pass
    
    return {"message": f"Manually split into {len(legs)} legs with planned assignments."}

def auto_split(shipment_id: str):
    """
    Manual trigger for splitting a shipment.
    """
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment or shipment.get("is_leg"):
        raise HTTPException(status_code=400, detail="Invalid shipment for splitting")
        
    from backend.services.route_engine import decompose_shipment
    legs_data = decompose_shipment(shipment)
    
    if not legs_data:
        raise HTTPException(status_code=400, detail="No warehouses available for splitting or route too short.")
    
    new_leg_ids = _generate_legs(shipment, legs_data)
    
    # AUTO-ASSIGN ALL LEGS IMMEDIATELY
    for leg_id in new_leg_ids:
        try:
            auto_assign(leg_id)
        except: pass
        
    return {"message": f"Successfully planned optimized {len(legs_data)}-leg journey via Hub Network and auto-assigned fleet."}

def _generate_legs(parent_shipment, leg_data):
    from backend.models import ShipmentEvent
    
    # Update parent shipment
    parent_shipment["route_type"] = "multi-leg"
    parent_shipment["status"] = "split"
    parent_shipment["stage"] = "Route Optimized"
    
    log_event = ShipmentEvent(status="split", message=f"🔗 Multi-leg journey planned via {len(leg_data)} warehouse hubs.")
    parent_shipment["logs"] = parent_shipment.get("logs", []) + [log_event.model_dump()]
    
    shipments_db.update(parent_shipment["id"], parent_shipment)
    
    current_time = datetime.utcnow()
    new_ids = []
    
    for i, leg in enumerate(leg_data):
        dist = haversine(leg["pickup"]["lat"], leg["pickup"]["lng"], leg["drop"]["lat"], leg["drop"]["lng"])
        
        l_type = leg.get("leg_type")
        is_middle_mile = l_type == "middle_mile"
        
        # Priority-based speed estimation
        speed = 65.0 if is_middle_mile else 30.0 # Trucks faster on highways, small vehicles slower in city
        travel_time_hours = dist / speed
        
        # Hub processing time
        wait_time_hours = 1.5 if is_middle_mile else 0.5 
        
        raw_eta = current_time + timedelta(hours=travel_time_hours + wait_time_hours)
        expected_time = snap_eta_to_business_hours(raw_eta)
        
        leg_log = ShipmentEvent(
            status="pending",
            message=f"Created as {l_type.replace('_', ' ').capitalize()} (Leg {i+1}). Optimized for { 'Trunk (Truck)' if is_middle_mile else 'Hub Handoff' } delivery.",
            location=leg["pickup"]
        )
        
        # Update current_time for next leg sequentially
        current_time = expected_time
        
        v_pref = "truck" if is_middle_mile else "scooty"
        finance = estimate_delivery_cost(leg, v_pref)

        l_id = str(uuid.uuid4())
        leg_shipment = Shipment(
            id=l_id,
            company_id=parent_shipment.get("company_id"),
            pickup=Location(**leg["pickup"]),
            drop=Location(**leg["drop"]),
            weight=parent_shipment.get("weight", 0),
            description=f"{parent_shipment.get('description', 'Shipment')} (Leg {i+1})",
            parent_id=parent_shipment.get("id"),
            is_leg=True,
            leg_order=i+1,
            leg_type=l_type,
            route_type="direct",
            expected_delivery=expected_time.isoformat() + "Z",
            delivery_otp=parent_shipment.get("delivery_otp"),
            logs=[leg_log.model_dump()],
            is_perishable=parent_shipment.get("is_perishable", False),
            vitality=parent_shipment.get("vitality", 100),
            pickup_warehouse_id=leg.get("pickup_warehouse_id"),
            drop_warehouse_id=leg.get("drop_warehouse_id"),
            qr_code_data=str(uuid.uuid4()),
            finance=finance,
            payment_status=parent_shipment.get("payment_status", "unpaid")
        )
        
        shipments_db.insert(leg_shipment.model_dump())
        new_ids.append(l_id)
    
    return new_ids

@router.delete("/{shipment_id}")
def delete_shipment(shipment_id: str):
    if shipments_db.delete(shipment_id):
        return {"message": "Shipment deleted successfully"}
    # Try prefix match for short IDs
    all_ships = shipments_db.get_all()
    target = next((s for s in all_ships if s["id"].startswith(shipment_id)), None)
    if target and shipments_db.delete(target["id"]):
        return {"message": "Shipment deleted successfully"}
        
    raise HTTPException(status_code=404, detail="Shipment not found")

@router.post("/{shipment_id}/extend-eway")
def extend_eway_bill(shipment_id: str):
    from datetime import datetime, timedelta
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    current_expiry = shipment.get("eway_bill_expiry")
    if not current_expiry:
        raise HTTPException(status_code=400, detail="No E-Way Bill found for this shipment")
        
    try:
        dt = datetime.fromisoformat(current_expiry.replace("Z", ""))
        new_expiry = (dt + timedelta(hours=24)).isoformat() + "Z"
        shipments_db.update(shipment_id, {"eway_bill_expiry": new_expiry})
        return {"message": "Extended by 24 hours", "new_expiry": new_expiry}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{shipment_id}/pay")
def pay_shipment(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        all_ships = shipments_db.get_all()
        shipment = next((s for s in all_ships if s["id"].startswith(shipment_id)), None)
    
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    shipments_db.update(shipment["id"], {"payment_status": "paid"})
    
    # Also update all legs
    all_ships = shipments_db.get_all()
    legs = [s for s in all_ships if s.get("parent_id") == shipment["id"]]
    for leg in legs:
        shipments_db.update(leg["id"], {"payment_status": "paid"})
        
    return {"message": "Payment successful"}

@router.post("/{shipment_id}/rate")
def rate_shipment(shipment_id: str, data: dict):
    rating = data.get("rating")
    if not rating: raise HTTPException(status_code=400, detail="Rating required")
    
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        all_ships = shipments_db.get_all()
        shipment = next((s for s in all_ships if s["id"].startswith(shipment_id)), None)
        
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    shipments_db.update(shipment["id"], {"customer_rating": rating})
    
    # Propagate rating to all drivers involved
    drivers_db = JSONDatabase("drivers")
    driver_ids = set()
    if shipment.get("assigned_driver_id"):
        driver_ids.add(shipment["assigned_driver_id"])
        
    # Check legs if it's a parent
    all_ships = shipments_db.get_all()
    legs = [s for s in all_ships if s.get("parent_id") == shipment["id"]]
    for leg in legs:
        if leg.get("assigned_driver_id"):
            driver_ids.add(leg["assigned_driver_id"])
            
    # Also check if THIS IS a leg and find its parent's drivers
    if shipment.get("is_leg") and shipment.get("parent_id"):
        parent = shipments_db.get_by_id(shipment["parent_id"])
        if parent:
            if parent.get("assigned_driver_id"):
                driver_ids.add(parent["assigned_driver_id"])
            parent_legs = [s for s in all_ships if s.get("parent_id") == parent["id"]]
            for pl in parent_legs:
                if pl.get("assigned_driver_id"):
                    driver_ids.add(pl["assigned_driver_id"])

    for d_id in driver_ids:
        driver = drivers_db.get_by_id(d_id)
        if driver:
            r_sum = driver.get("total_rating_sum", 0) + rating
            r_count = driver.get("rating_count", 0) + 1
            avg = round(r_sum / r_count, 1)
            
            # Update safety/driving score too
            drivers_db.update(d_id, {
                "total_rating_sum": r_sum,
                "rating_count": r_count,
                "safety_rating": avg # Sync with rating
            })
            
    return {"message": f"Rating of {rating} applied to {len(driver_ids)} participants."}
@router.get("/assets/eligible/{shipment_id}")
def get_eligible_assets(shipment_id: str, company_id: str, from_wh: Optional[str] = None, to_wh: Optional[str] = None):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        # Try prefix matching
        shipment = next((s for s in shipments_db.get_all() if s["id"].startswith(shipment_id)), None)
    
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    drivers = [d for d in JSONDatabase("drivers").get_all() if d.get("company_id") == company_id and d.get("status") == "available"]
    vehicles = [v for v in JSONDatabase("vehicles").get_all() if v.get("company_id") == company_id and v.get("status") == "available"]
    warehouses = JSONDatabase("warehouses").get_all()
    
    # Use overrides if provided (for planning phase)
    p_wh_id = from_wh if from_wh and from_wh != "null" else shipment.get("pickup_warehouse_id")
    d_wh_id = to_wh if to_wh and to_wh != "null" else shipment.get("drop_warehouse_id")
    
    # If not a leg, try to find nearest warehouse to pickup
    if not p_wh_id:
        from backend.services.route_engine import haversine
        nearest = None
        min_dist = float('inf')
        for w in warehouses:
            dist = haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], w["lat"], w["lng"])
            if dist < min_dist:
                min_dist = dist
                nearest = w["id"]
        p_wh_id = nearest

    eligible = {
        "local": [],
        "returning": [],
        "drones": [],
        "others": []
    }
    
    for d in drivers:
        v_id = d.get("assigned_vehicle_id")
        if not v_id: continue
        v = next((veh for veh in vehicles if veh["id"] == v_id), None)
        if not v: continue
        
        asset = {
            "driver_id": d["id"],
            "driver_name": d["name"],
            "vehicle_id": v["id"],
            "vehicle_plate": v["number_plate"],
            "vehicle_type": v["type"],
            "base_warehouse_id": v.get("base_warehouse_id")
        }
        
        if v.get("base_warehouse_id") == p_wh_id:
            eligible["local"].append(asset)
        elif d_wh_id and v.get("base_warehouse_id") == d_wh_id:
            eligible["returning"].append(asset)
        else:
            eligible["others"].append(asset)
            
    # Check for Drones at pickup warehouse
    if p_wh_id:
        wh = next((w for w in warehouses if w["id"] == p_wh_id), None)
        if wh and wh.get("drone_count", 0) > 0:
            drone_vehicles = [v for v in vehicles if "drone" in v["type"].lower() and v.get("base_warehouse_id") == p_wh_id]
            for dv in drone_vehicles:
                eligible["drones"].append({
                    "driver_id": None,
                    "driver_name": "Autonomous System",
                    "vehicle_id": dv["id"],
                    "vehicle_plate": dv["number_plate"],
                    "vehicle_type": dv["type"]
                })
                
    return eligible
