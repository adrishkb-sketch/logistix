from fastapi import APIRouter, HTTPException, UploadFile, File
from backend.models import ShipmentCreate, Shipment, Location, ShipmentEvent, ManualAssignRequest
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
from backend.services.finance_engine import estimate_delivery_cost

import random
import pandas as pd
import io
import requests
import re

router = APIRouter()
shipments_db = JSONDatabase("shipments")
warehouses_db = JSONDatabase("warehouses")

def increment_operational_days(driver_id: str, vehicle_id: str):
    from datetime import datetime
    today = datetime.utcnow().strftime("%Y-%m-%d")
    
    if driver_id and driver_id != "DRONE-SYSTEM":
        d_db = JSONDatabase("drivers")
        driver = d_db.get_by_id(driver_id)
        if driver:
            dates = driver.get("operational_dates", [])
            if today not in dates:
                dates.append(today)
                d_db.update(driver_id, {
                    "operational_dates": dates,
                    "operational_days": len(dates)
                })
                
    if vehicle_id:
        v_db = JSONDatabase("vehicles")
        vehicle = v_db.get_by_id(vehicle_id)
        if vehicle:
            dates = vehicle.get("operational_dates", [])
            if today not in dates:
                dates.append(today)
                v_db.update(vehicle_id, {
                    "operational_dates": dates,
                    "operational_days": len(dates)
                })

class ShipmentRating(BaseModel):
    rating: float # 1-5

class BulkParseRequest(BaseModel):
    url: str
    company_id: str

@router.post("/bulk-parse")
async def bulk_parse(company_id: str, file: Optional[UploadFile] = File(None), url_req: Optional[str] = None):
    df = None
    try:
        if file:
            content = await file.read()
            if file.filename.endswith('.csv'):
                df = pd.read_csv(io.BytesIO(content))
            else:
                df = pd.read_excel(io.BytesIO(content))
        elif url_req:
            match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", url_req)
            if not match: raise HTTPException(status_code=400, detail="Invalid Google Sheets URL")
            sheet_id = match.group(1)
            csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
            resp = requests.get(csv_url)
            if resp.status_code != 200: raise HTTPException(status_code=400, detail="Failed to fetch Google Sheet")
            df = pd.read_csv(io.StringIO(resp.text))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"File parsing error: {str(e)}")
    
    if df is None or df.empty: raise HTTPException(status_code=400, detail="No data found")

    # Normalize column names
    df.columns = [str(c).strip().lower().replace(' ', '_') for c in df.columns]
    
    shipments = []
    errors = []
    
    col_map = {
        "p_lat": ["p_lat", "pickup_lat", "origin_lat", "from_lat"],
        "p_lng": ["p_lng", "pickup_lng", "origin_lng", "from_lng"],
        "d_lat": ["d_lat", "drop_lat", "dest_lat", "to_lat"],
        "d_lng": ["d_lng", "drop_lng", "dest_lng", "to_lng"],
        "weight": ["weight", "kg", "mass"],
        "desc": ["desc", "description", "item"],
        "name": ["name", "receiver_name", "to_name", "recipient"],
        "phone": ["phone", "receiver_phone", "mobile", "contact"],
        "email": ["email", "receiver_email"],
        "perishable": ["perishable", "is_perishable", "cold_chain"],
        "eway": ["eway", "eway_bill", "eway_bill_no"],
        "expiry": ["expiry", "eway_expiry", "expiry_date"]
    }

    def get_col(row, keys):
        for k in keys:
            if k in row: return row[k]
        return None

    for idx, row in df.iterrows():
        try:
            vals = row.values.tolist()
            
            p_lat = get_col(row, col_map["p_lat"]) or (vals[0] if len(vals) > 0 else None)
            p_lng = get_col(row, col_map["p_lng"]) or (vals[1] if len(vals) > 1 else None)
            d_lat = get_col(row, col_map["d_lat"]) or (vals[2] if len(vals) > 2 else None)
            d_lng = get_col(row, col_map["d_lng"]) or (vals[3] if len(vals) > 3 else None)
            weight = get_col(row, col_map["weight"]) or (vals[4] if len(vals) > 4 else 0)
            desc = get_col(row, col_map["desc"]) or (vals[5] if len(vals) > 5 else "Shipment")
            name = get_col(row, col_map["name"]) or (vals[6] if len(vals) > 6 else "Recipient")
            phone = str(get_col(row, col_map["phone"]) or (vals[7] if len(vals) > 7 else "")).strip()
            email = get_col(row, col_map["email"]) or (vals[8] if len(vals) > 8 else None)
            perish = get_col(row, col_map["perishable"]) or (vals[9] if len(vals) > 9 else False)
            eway = get_col(row, col_map["eway"]) or (vals[10] if len(vals) > 10 else None)
            expiry = get_col(row, col_map["expiry"]) or (vals[11] if len(vals) > 11 else None)

            if p_lat is None or p_lng is None or d_lat is None or d_lng is None:
                errors.append(f"Row {idx+1}: Missing Coordinates")
                continue

            # Strict Phone Check
            phone_clean = str(phone).replace(" ", "").replace("-", "")
            if not re.match(r"^\d{10}$", phone_clean):
                errors.append(f"Row {idx+1}: Invalid Phone Number '{phone}'. Must be 10 digits.")
                continue
            phone = "+91" + phone_clean

            # Strict Email Check
            email_str = str(email).strip().lower() if email and not pd.isna(email) else ""
            if email_str and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email_str):
                errors.append(f"Row {idx+1}: Invalid Email Format '{email_str}'")
                continue

            # Strict Weight Check
            try:
                weight_val = float(weight)
                if weight_val <= 0: raise ValueError()
            except:
                errors.append(f"Row {idx+1}: Invalid Weight '{weight}'. Must be a positive number.")
                continue
            
            s = {
                "pickup": {"lat": float(p_lat), "lng": float(p_lng)},
                "drop": {"lat": float(d_lat), "lng": float(d_lng)},
                "weight": weight_val,
                "description": str(desc),
                "receiver_name": str(name),
                "receiver_phone": phone,
                "receiver_email": email_str if email_str else None,
                "is_perishable": str(perish).lower() in ['yes', 'y', 'true', '1'] if perish is not None else False,
                "eway_bill_no": str(eway) if eway and not pd.isna(eway) else None,
                "eway_bill_expiry": str(expiry) if expiry and not pd.isna(expiry) else None,
                "company_id": company_id
            }
            shipments.append(s)
        except Exception as e:
            errors.append(f"Row {idx+1}: {str(e)}")
            continue
            
    return {"shipments": shipments, "count": len(shipments), "errors": errors}

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

@router.post("/{shipment_id}/rate")
def rate_shipment(shipment_id: str, rating_data: ShipmentRating):
    rating = rating_data.rating
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        # Fallback to prefix matching
        all_ships = shipments_db.get_all()
        shipment = next((s for s in all_ships if s["id"].startswith(shipment_id)), None)
        
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    if shipment.get("status") != "delivered":
        raise HTTPException(status_code=400, detail="Only delivered shipments can be rated")
        
    if shipment.get("customer_rating"):
        raise HTTPException(status_code=400, detail="Shipment already rated")
        
    # Gather all drivers involved in this shipment chain
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
            
    # Check if it's a leg and find parent's drivers
    if shipment.get("is_leg") and shipment.get("parent_id"):
        parent = shipments_db.get_by_id(shipment["parent_id"])
        if parent:
            if parent.get("assigned_driver_id"):
                driver_ids.add(parent["assigned_driver_id"])
            parent_legs = [s for s in all_ships if s.get("parent_id") == parent["id"]]
            for pl in parent_legs:
                if pl.get("assigned_driver_id"):
                    driver_ids.add(pl["assigned_driver_id"])
                    
    # Exclude drone-system or invalid driver IDs
    driver_ids = {d for d in driver_ids if d and d != "DRONE-SYSTEM"}
    
    # Calculate points bonus
    rating_bonus = (rating - 3) * 20
    
    for d_id in driver_ids:
        driver = drivers_db.get_by_id(d_id)
        if driver:
            r_sum = driver.get("total_rating_sum", 0.0) + rating
            r_count = driver.get("rating_count", 0) + 1
            avg_rating = round(r_sum / r_count, 2)
            new_points = driver.get("reward_points", 0.0) + rating_bonus
            
            drivers_db.update(d_id, {
                "total_rating_sum": r_sum,
                "rating_count": r_count,
                "rating": avg_rating,
                "reward_points": new_points
            })
            
    # Update parent shipment
    breakdown = shipment.get("points_breakdown", {}) or {}
    breakdown["customer_rating_bonus"] = rating_bonus
    breakdown["total"] = breakdown.get("total", 0.0) + rating_bonus
    
    shipments_db.update(shipment["id"], {
        "customer_rating": rating,
        "points_breakdown": breakdown
    })
    
    # Append log to parent shipment
    log = ShipmentEvent(
        status="delivered",
        message=f"Receiver rated the delivery: {rating}⭐. Propagated to {len(driver_ids)} drivers.",
        location=shipment.get("drop")
    )
    history = shipment.get("logs", []) or []
    history.append(log.model_dump())
    shipments_db.update(shipment["id"], {"logs": history})
    
    # Update all leg shipments with rating & logs too
    for leg in legs:
        leg_breakdown = leg.get("points_breakdown", {}) or {}
        leg_breakdown["customer_rating_bonus"] = rating_bonus
        leg_breakdown["total"] = leg_breakdown.get("total", 0.0) + rating_bonus
        
        leg_history = leg.get("logs", []) or []
        leg_history.append(log.model_dump())
        
        shipments_db.update(leg["id"], {
            "customer_rating": rating,
            "points_breakdown": leg_breakdown,
            "logs": leg_history
        })
        
    return {"message": f"Rating of {rating} applied to {len(driver_ids)} participants.", "bonus_points": rating_bonus}

receivers_db = JSONDatabase("receivers")

@router.post("/")
def create_shipment(shipment_data: ShipmentCreate):
    # 1. Receiver Management Logic
    receiver_id = shipment_data.receiver_id
    email_norm = shipment_data.receiver_email.strip().lower() if shipment_data.receiver_email else None
    
    if email_norm:
        existing_receivers = receivers_db.get_all()
        rec = next((r for r in existing_receivers if r.get("company_id") == shipment_data.company_id and r.get("email", "").strip().lower() == email_norm), None)
        
        if rec:
            # Strict validation for existing receivers
            existing_name = rec.get("name", "").strip().lower()
            existing_phone = rec.get("phone", "").strip().replace("+91", "").strip()
            
            new_name = (shipment_data.receiver_name or "").strip().lower()
            new_phone = (shipment_data.receiver_phone or "").strip().replace("+91", "").strip()
            
            if existing_name != new_name or existing_phone != new_phone:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Receiver Details Mismatch: The email '{email_norm}' is already registered to '{rec.get('name')}' with phone '{rec.get('phone')}'. Please use the exact same name and phone number for this email or use a different email address."
                )
            
            receiver_id = rec["id"]
        else:
            # Create new receiver
            from backend.models import Receiver
            new_rec = Receiver(
                company_id=shipment_data.company_id,
                name=shipment_data.receiver_name,
                email=email_norm,
                phone=shipment_data.receiver_phone
            )
            receivers_db.insert(new_rec.model_dump())
            receiver_id = new_rec.id

    # 1. Weight Guard: World's Strongest Engine Rule
    if shipment_data.weight > 100:
        raise HTTPException(status_code=400, detail="Shipment rejected: Maximum allowed weight is 100kg per shipment.")

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
        
        available_drivers = [d for d in drivers_db.get_all() if d and d.get("company_id") == shipment_data.company_id and d.get("status") == "available" and d.get("assigned_vehicle_id")]
        
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
    
    # Generate random 6-digit pickup and delivery codes
    p_code = str(random.randint(100000, 999999))
    d_code = str(random.randint(100000, 999999))
    
    pickup_addr = shipment_data.pickup.address or f"{shipment_data.pickup.lat}, {shipment_data.pickup.lng}"
    drop_addr = shipment_data.drop.address or f"{shipment_data.drop.lat}, {shipment_data.drop.lng}"
    initial_log = ShipmentEvent(
        status="pending",
        message=f"📦 Shipment created — {pickup_addr} → {drop_addr}. Awaiting fleet assignment.",
        location=shipment_data.pickup
    )
    
    from backend.services.finance_engine import estimate_delivery_cost
    finance = estimate_delivery_cost(shipment_data.model_dump())

    from backend.services.route_engine import calculate_route_type
    route_type = calculate_route_type(shipment_data.pickup, shipment_data.drop, shipment_data.company_id)

    shipment_dict = shipment_data.model_dump()
    shipment_dict.update({
        "receiver_id": receiver_id,
        "route_type": route_type,
        "expected_delivery": expected_delivery,
        "pickup_deadline": pickup_deadline,
        "delivery_otp": otp,
        "pickup_code": p_code,
        "delivery_code": d_code,
        "logs": [initial_log],
        "vitality": 100.0,
        "qr_code_data": f"LX-{uuid.uuid4().hex[:8].upper()}",
        "finance": finance,
        "payment_status": "paid" if random.random() < 0.8 else "unpaid"
    })

    new_shipment = Shipment(**shipment_dict)
    shipment_dict = new_shipment.model_dump()
    
    shipments_db.insert(shipment_dict)
    
    # Auto-log revenue if prepaid
    if shipment_dict["payment_status"] == "paid":
        from backend.database import JSONDatabase
        ledger_db = JSONDatabase("ledger")
        ledger_db.insert({
            "type": "REVENUE",
            "desc": f"Digital Payment for Shipment #{shipment_dict['id'][:8]}",
            "amount": finance.get("suggested_price", 0),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "company_id": shipment_dict["company_id"]
        })
    
    # Auto-Split and Auto-Assign
    try:
        from backend.services.route_engine import decompose_shipment
        from backend.routers.shipment import _generate_legs # it's in the same file
        
        legs_data = decompose_shipment(shipment_dict)
        if legs_data:
            leg_ids = _generate_legs(shipment_dict, legs_data)
            # Refresh parent shipment state
            updated_parent = shipments_db.get_by_id(shipment_dict["id"])
            if updated_parent:
                shipment_dict.update(updated_parent)
                new_shipment = Shipment(**shipment_dict)
            
            # Auto assign each leg
            for lid in leg_ids:
                leg_s = shipments_db.get_by_id(lid)
                if leg_s:
                    assigned = auto_assign_shipment(leg_s)
                    if assigned and "error" not in assigned:
                        leg_s["assigned_driver_id"] = assigned["assigned_driver_id"]
                        leg_s["assigned_vehicle_id"] = assigned["assigned_vehicle_id"]
                        leg_s["status"] = "assigned"
                        shipments_db.update(lid, leg_s)
        else:
            # Direct Route Assignment
            assigned = auto_assign_shipment(shipment_dict)
            if assigned and "error" not in assigned:
                shipment_dict["assigned_driver_id"] = assigned["assigned_driver_id"]
                shipment_dict["assigned_vehicle_id"] = assigned["assigned_vehicle_id"]
                shipment_dict["status"] = "assigned"
                shipments_db.update(shipment_dict["id"], shipment_dict)
                new_shipment = Shipment(**shipment_dict)
    except Exception as e:
        import traceback
        print(f"Auto-split/assign failed during creation: {e}")
        traceback.print_exc()
            
    return new_shipment

@router.get("/{shipment_id}/qr-data")
def get_shipment_qr_data(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    qr_data = shipment.get("qr_code_data")
    if not qr_data:
        qr_data = f"LX-{uuid.uuid4().hex[:8].upper()}"
        shipments_db.update(shipment_id, {"qr_code_data": qr_data})
        
    return {"qr_code_data": qr_data, "shipment_id": shipment_id}

@router.get("")
@router.get("/")
def get_shipments(company_id: str):
    from backend.services.cold_chain import calculate_shipment_vitality
    all_ships = shipments_db.get_all()
    company_ships = [s for s in all_ships if s and s.get("company_id") == company_id]
    
    # Pre-fetch database lists to eliminate N+1 query loading overhead
    alerts_db = JSONDatabase("alerts")
    vehicles_db = JSONDatabase("vehicles")
    street_db = JSONDatabase("street_intel")
    weather_db = JSONDatabase("weather_cells")
    
    alerts_list = alerts_db.get_all()
    vehicles_list = vehicles_db.get_all()
    zones_list = street_db.get_all()
    cells_list = weather_db.get_all()
    
    from backend.services.alert_engine import check_compliance_alerts, check_street_intel_alerts, check_heatwave_safety
    
    db_changed = False
    for s in company_ships:
        if s.get("is_perishable"):
            new_v = calculate_shipment_vitality(s, cells=cells_list)
            old_v = s.get("vitality", 100.0)
            if new_v != old_v:
                s["vitality"] = new_v
                # Only write to DB if the change is significant (>= 1.0%) to prevent excessive Turso REST network overhead
                if abs(new_v - old_v) >= 1.0:
                    # Update in the master list so it persists correctly when we save the entire db
                    for master_s in all_ships:
                        if master_s and master_s.get("id") == s["id"]:
                            master_s["vitality"] = new_v
                            break
                    db_changed = True
        
        # Run Indian-specific "Killer Feature" checks using pre-loaded parameters
        check_compliance_alerts(s, alerts=alerts_list)
        check_street_intel_alerts(s, zones=zones_list, vehicles=vehicles_list, alerts=alerts_list)
        
        # Heatwave safety: stop bike/scooty drivers in heat zones
        v_id = s.get("assigned_vehicle_id")
        if v_id and s.get("status") == "in_transit":
            vehicle = next((v for v in vehicles_list if v.get("id") == v_id), None)
            if vehicle:
                check_heatwave_safety(s, vehicle, cells=cells_list, alerts=alerts_list)
                
    if db_changed:
        shipments_db.write(all_ships)
        
    return company_ships

@router.get("/{shipment_id}/assignment-recommendations")
def get_assignment_recommendations(shipment_id: str):
    all_ships = shipments_db.get_all()
    shipment = next((s for s in all_ships if s and s.get("id") == shipment_id), None)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    if shipment.get("status") not in ["pending", "assigned"]:
        raise HTTPException(status_code=400, detail="Shipment has already started or been delivered, cannot change assignment.")
        
    from backend.services.assignment import get_assignment_recommendations_for_shipment
    try:
        recommendations = get_assignment_recommendations_for_shipment(shipment)
        return {"recommendations": recommendations}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{shipment_id}")
def get_shipment(shipment_id: str):
    all_ships = shipments_db.get_all()
    shipment = next((s for s in all_ships if s and s.get("id") == shipment_id), None)
    
    if not shipment:
        # Try prefix matching for short IDs
        shipment = next((s for s in all_ships if s and s.get("id", "").startswith(shipment_id)), None)
        
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
        if status_changed and data.get("status") == "delivered" and shipment.get("is_leg"):
            from backend.database import JSONDatabase
            drop_wh_id = shipment.get('drop_warehouse_id')
            driver_id = shipment.get("assigned_driver_id")
            
            # Update Driver and Vehicle current location
            if driver_id:
                drivers_db = JSONDatabase("drivers")
                vehicles_db = JSONDatabase("vehicles")
                driver = drivers_db.get_by_id(driver_id)
                v_id = shipment.get("assigned_vehicle_id")
                if driver and v_id:
                    vehicle = vehicles_db.get_by_id(v_id)
                    if vehicle:
                        v_type = (vehicle.get("type") or "").lower()
                        is_truck = "truck" in v_type
                        target_wh = drop_wh_id if is_truck else vehicle.get("base_warehouse_id")
                        
                        drivers_db.update(driver_id, {"current_warehouse_id": target_wh})
                        vehicles_db.update(v_id, {
                            "current_warehouse_id": target_wh,
                            "present_warehouse_id": target_wh
                        })

                # CREDIT DRIVER WALLET & POINTS
                if driver:
                    leg_cost = shipment.get("finance", {}).get("suggested_price", 0)
                    driver_share = round(leg_cost * 0.4, 2) # 40% share
                    drivers_db.update(driver_id, {
                        "wallet_balance": driver.get("wallet_balance", 0) + driver_share,
                        "reward_points": driver.get("reward_points", 0) + 10,
                        "total_earnings": driver.get("total_earnings", 0) + driver_share
                    })
                    
            # Check if there are more legs or if parent should move to next stage
            p_id = shipment.get("parent_id")
            if p_id:
                all_ships = shipments_db.get_filtered({"parent_id": p_id})
                parent = shipments_db.get_by_id(p_id)
                legs = sorted(all_ships, key=lambda x: x.get("leg_order", 0))
                
                curr_leg_idx = next((i for i, l in enumerate(legs) if l["id"] == shipment_id), -1)
                if curr_leg_idx < len(legs) - 1:
                    next_leg = legs[curr_leg_idx + 1]
                    shipments_db.update(next_leg["id"], {"status": "pending", "stage": "Awaiting Pickup from Hub"})
                    shipments_db.update(p_id, {"stage": f"Transferring: Leg {curr_leg_idx + 2} in progress"})
                else:
                    shipments_db.update(p_id, {"status": "in_transit", "stage": "Out for Final Delivery"})

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
                    
                    # Increment operational days on completion if not already done
                    increment_operational_days(driver_id, shipment.get("assigned_vehicle_id"))
                    
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
    old_vehicle = s.get("assigned_vehicle_id")
    
    # Reset shipment for assignment
    s["assigned_driver_id"] = None
    s["assigned_vehicle_id"] = None
    s["status"] = "pending"
    
    # Use auto_assign_shipment to find a new available driver/vehicle
    from backend.services.assignment import auto_assign_shipment
    try:
        assigned_data = auto_assign_shipment(s)
        if not assigned_data or "error" in assigned_data:
            raise ValueError(assigned_data.get("error", "No eligible rescue units available"))
            
        new_driver_id = assigned_data["assigned_driver_id"]
        new_vehicle_id = assigned_data["assigned_vehicle_id"]
        
        s["assigned_driver_id"] = new_driver_id
        s["assigned_vehicle_id"] = new_vehicle_id
        s["status"] = "assigned"
        s["stage"] = "Rescue Dispatched"
        s["current_location"] = None # Clear stale location to fix backdated map
        
        # Generate fresh verification codes for the new driver
        new_pickup_code = str(random.randint(100, 999))
        new_delivery_code = str(random.randint(1000, 9999))
        s["pickup_code"] = new_pickup_code
        s["delivery_code"] = new_delivery_code
        
        from backend.models import ShipmentEvent
        log = ShipmentEvent(status="assigned", message="🚑 Rescue vehicle dispatched and assigned automatically. Fresh verification codes generated.", reason="Previous vehicle breakdown. AI rerouted nearest available recovery unit.")
        s["logs"] = s.get("logs", []) + [log.model_dump()]
        
        shipments_db.update(shipment_id, s)
        
        from backend.database import JSONDatabase
        drivers_db = JSONDatabase("drivers")
        vehicles_db = JSONDatabase("vehicles")
        
        # Link new driver and vehicle
        drv = drivers_db.get_by_id(new_driver_id)
        if drv:
            drivers_db.update(new_driver_id, {"assigned_vehicle_id": new_vehicle_id})
        veh = vehicles_db.get_by_id(new_vehicle_id)
        if veh:
            vehicles_db.update(new_vehicle_id, {"assigned_driver_id": new_driver_id, "status": "assigned"})
        
        # Free up the old driver
        if old_driver:
            orig_drv = drivers_db.get_by_id(old_driver)
            if orig_drv:
                drivers_db.update(old_driver, {"assigned_vehicle_id": None})
                
        # Free up and flag maintenance for the broken vehicle
        if old_vehicle:
            orig_veh = vehicles_db.get_by_id(old_vehicle)
            if orig_veh:
                vehicles_db.update(old_vehicle, {"assigned_driver_id": None, "status": "maintenance"})
                
        return {"message": "Rescue successful.", "new_driver": new_driver_id}
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
        
        from backend.services.assignment import auto_assign_shipment
        
        # AUTOMATIC ROUTE SPLITTING AND MULTI-LEG ASSIGNMENT
        child_ids = shipment.get("child_leg_ids", [])
        if not child_ids:
            # Fallback: Query DB for children
            all_s = shipments_db.get_all()
            child_ids = [s["id"] for s in all_s if s.get("parent_id") == shipment["id"]]
        
        # Scenario 1: Fresh shipment needs splitting
        if not child_ids and (total_dist > 50 or shipment.get("is_perishable")) and not shipment.get("is_leg") and shipment.get("status") == "pending":
            from backend.services.route_engine import decompose_shipment
            legs_data = decompose_shipment(shipment)
            if len(legs_data) > 1:
                child_ids = _generate_legs(shipment, legs_data)
        
        # Scenario 2: Already split or newly split, now assign all legs
        if child_ids and not shipment.get("is_leg"):
            assigned_count = 0
            leg_errors = []
            for leg_id in child_ids:
                try:
                    leg = shipments_db.get_by_id(leg_id)
                    if leg.get("assigned_driver_id"): continue # Already assigned
                    
                    assigned_data_leg = auto_assign_shipment(leg)
                    if assigned_data_leg and "error" in assigned_data_leg:
                        leg_errors.append(f"Leg {leg.get('leg_order', '?')}: {assigned_data_leg['error']}")
                        continue

                    if assigned_data_leg:
                        from backend.models import ShipmentEvent
                        d_db = JSONDatabase("drivers")
                        v_db = JSONDatabase("vehicles")
                        d_id = assigned_data_leg.get("assigned_driver_id")
                        v_id = assigned_data_leg.get("assigned_vehicle_id")
                        
                        if d_id == "DRONE-SYSTEM":
                            log_event = ShipmentEvent(status="in_transit", message=f"🛰️ AI deployed autonomous drone {v_id} for the last-mile segment.")
                        else:
                            d = d_db.get_by_id(d_id)
                            v = v_db.get_by_id(v_id)
                            driver_name = d.get("name", "Unknown") if d else "Unknown"
                            plate = v.get("number_plate", "Unknown") if v else "Unknown"
                            log_event = ShipmentEvent(status="assigned", message=f"🤖 AI successfully assigned driver {driver_name} and vehicle {plate}.")
                        
                        assigned_data_leg["logs"] = (leg.get("logs") or []) + [log_event.model_dump()]
                        shipments_db.update(leg["id"], assigned_data_leg)
                        try:
                            update_shipment_finance_post_assignment(leg["id"])
                        except Exception as e:
                            print(f"Finance recalculation error in auto_assign leg: {e}")
                        
                        if d_id != "DRONE-SYSTEM":
                            d_db.update(d_id, {"status": "assigned", "assigned_vehicle_id": v_id})
                            v_db.update(v_id, {"status": "assigned", "assigned_driver_id": d_id})
                            increment_operational_days(d_id, v_id)
                        assigned_count += 1
                except Exception as le:
                    print(f"Leg Assignment Error: {str(le)}")
            
            if assigned_count == 0:
                err_detail = " | ".join(leg_errors) if leg_errors else "No suitable drivers found for any segments."
                raise HTTPException(status_code=400, detail=f"AI Assignment Failed: {err_detail}")
 
            return {
                "message": f"Processed {len(child_ids)} journey legs. Total {assigned_count} new assignments confirmed.",
                "action": "multi_assign",
                "legs_count": len(child_ids),
                "assigned_count": assigned_count
            }
        assigned_data = auto_assign_shipment(shipment)
        
        if assigned_data and "error" in assigned_data:
             raise HTTPException(status_code=400, detail=assigned_data["error"])
 
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
                increment_operational_days(d_id, v_id)
                
            updated = shipments_db.update(shipment_id, assigned_data)
            try:
                update_shipment_finance_post_assignment(shipment_id)
                updated = shipments_db.get_by_id(shipment_id)
            except Exception as e:
                print(f"Finance recalculation error in auto_assign parent: {e}")
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

def update_shipment_finance_post_assignment(shipment_id: str):
    """
    Recalculates shipment or leg finance based on its current vehicle assignment.
    If it is a leg of a parent shipment, triggers parent finance summation.
    """
    from backend.database import JSONDatabase
    from backend.services.finance_engine import estimate_delivery_cost
    
    shipments_db = JSONDatabase("shipments")
    vehicles_db = JSONDatabase("vehicles")
    
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        return
        
    v_id = shipment.get("assigned_vehicle_id")
    v_type = "van"
    if v_id:
        v = vehicles_db.get_by_id(v_id)
        if v:
            v_type = v.get("type", "van")
    else:
        if shipment.get("is_leg"):
            l_type = shipment.get("leg_type")
            if l_type == "middle_mile":
                v_type = "truck"
            elif l_type == "first_mile":
                v_type = "scooty"
            elif l_type == "last_mile":
                v_type = "van"
                
    finance = estimate_delivery_cost(shipment, v_type)
    finance["expected_profit"] = finance.get("projected_profit", 0)
    shipment["finance"] = finance
    shipments_db.update(shipment_id, shipment)
    
    parent_id = shipment.get("parent_id")
    if parent_id:
        parent = shipments_db.get_by_id(parent_id)
        if parent:
            all_ships = shipments_db.get_all()
            parent_legs = [l for l in all_ships if l and l.get("parent_id") == parent_id]
            
            suggested_price_sum = sum(l.get("finance", {}).get("suggested_price", 0.0) for l in parent_legs)
            total_cost_sum = sum(l.get("finance", {}).get("total_cost", 0.0) for l in parent_legs)
            fuel_budget_sum = sum(l.get("finance", {}).get("fuel_budget", 0.0) for l in parent_legs)
            toll_budget_sum = sum(l.get("finance", {}).get("toll_budget", 0.0) for l in parent_legs)
            driver_wage_sum = sum(l.get("finance", {}).get("driver_wage", 0.0) for l in parent_legs)
            food_allowance_sum = sum(l.get("finance", {}).get("food_allowance", 0.0) for l in parent_legs)
            breakdown_reserve_sum = sum(l.get("finance", {}).get("breakdown_reserve", 0.0) for l in parent_legs)
            projected_profit_sum = sum(l.get("finance", {}).get("projected_profit", 0.0) for l in parent_legs)
            distance_km_sum = sum(l.get("finance", {}).get("distance_km", 0.0) for l in parent_legs)
            
            parent["finance"] = {
                "suggested_price": round(suggested_price_sum, 2),
                "total_cost": round(total_cost_sum, 2),
                "fuel_budget": round(fuel_budget_sum, 2),
                "toll_budget": round(toll_budget_sum, 2),
                "driver_wage": round(driver_wage_sum, 2),
                "food_allowance": round(food_allowance_sum, 2),
                "breakdown_reserve": round(breakdown_reserve_sum, 2),
                "projected_profit": round(projected_profit_sum, 2),
                "margin": round(projected_profit_sum, 2),
                "distance_km": round(distance_km_sum, 2)
            }
            shipments_db.update(parent_id, parent)

def _perform_assignment(shipment_id: str, driver_id: Optional[str], vehicle_id: str):
    from backend.database import JSONDatabase
    from backend.models import ShipmentEvent
    
    shipments_db = JSONDatabase("shipments")
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        return None
        
    # Release previous driver/vehicle if they exist and are being changed
    old_driver_id = shipment.get("assigned_driver_id")
    old_vehicle_id = shipment.get("assigned_vehicle_id")
    if old_driver_id and old_driver_id != driver_id:
        JSONDatabase("drivers").update(old_driver_id, {"status": "available", "current_shipment_id": None})
        # Send system notification message to the unassigned driver
        try:
            from datetime import datetime
            msg_content = f"🚨 Shipment #{shipment_id[:8]} has been reassigned to an autonomous drone for priority delivery. You are now free for new tasks."
            JSONDatabase("messages").insert({
                "sender_id": "SYSTEM",
                "receiver_id": old_driver_id,
                "content": msg_content,
                "company_id": shipment.get("company_id"),
                "created_at": datetime.utcnow().isoformat() + "Z"
            })
        except Exception as e:
            print(f"[Driver Notification Alert] Failed to send chat notification: {e}")
            
    if old_vehicle_id and old_vehicle_id != vehicle_id:
        JSONDatabase("vehicles").update(old_vehicle_id, {"status": "available"})

    d = JSONDatabase("drivers").get_by_id(driver_id) if driver_id else None
    v = JSONDatabase("vehicles").get_by_id(vehicle_id)
    driver_name = d.get("name", "Unknown") if d else "Unknown"
    plate = v.get("number_plate", "Unknown") if v else "Unknown"
    
    if not driver_id:
        log_event = ShipmentEvent(
            status="in_transit", 
            message=f"🛰️ Autonomous Dispatch: Assigned to Drone {plate}.",
            reason="Manager manually triggered drone air delivery for this segment."
        )
        stage = "Drone Air Delivery"
        status = "in_transit"
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
        # Update Driver/Vehicle status
        JSONDatabase("drivers").update(driver_id, {"status": "on_duty"})
        JSONDatabase("vehicles").update(vehicle_id, {"status": "on_duty"})

    from backend.services.route_engine import haversine
    from datetime import datetime, timedelta
    
    # Calculate Dynamic Pickup ETA
    curr_loc = v.get("current_location")
    pickup_loc = shipment.get("pickup")
    p_deadline = datetime.utcnow() + timedelta(hours=1) # Default
    
    if curr_loc and pickup_loc:
        dist_to_pickup = haversine(curr_loc.get("lat", 0), curr_loc.get("lng", 0), pickup_loc.get("lat", 0), pickup_loc.get("lng", 0))
        # Avg speed 30km/h for pickup approach (city/traffic)
        eta_mins = (dist_to_pickup / 30.0) * 60 + 15 # +15 mins buffer for load/prep
        p_deadline = datetime.utcnow() + timedelta(minutes=round(eta_mins))
        
        log_event.message += f" Estimated arrival at pickup: {p_deadline.strftime('%I:%M %p')} ({round(dist_to_pickup, 1)}km away)."

    logs = (shipment.get("logs") or []) + [log_event.model_dump()]
    
    updated_fields = {
        "assigned_driver_id": driver_id,
        "assigned_vehicle_id": vehicle_id,
        "status": status,
        "stage": stage,
        "logs": logs,
        "pickup_deadline": p_deadline.isoformat() + "Z"
    }
    
    updated = shipments_db.update(shipment_id, updated_fields)
    try:
        update_shipment_finance_post_assignment(shipment_id)
        updated = shipments_db.get_by_id(shipment_id)
    except Exception as fe:
        print(f"Finance recalculation error in _perform_assignment: {fe}")
    
    try:
        from backend.services.assignment import reoptimize_driver_route
        reoptimize_driver_route(driver_id)
    except: pass
    
    return updated

class EmergencyReassignRequest(BaseModel):
    driver_id: str
    vehicle_id: str

@router.post("/{shipment_id}/emergency-reassign")
def emergency_reassign(shipment_id: str, data: EmergencyReassignRequest):
    from backend.database import JSONDatabase
    from backend.models import ShipmentEvent
    
    shipments_db = JSONDatabase("shipments")
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        # Try finding by prefix match
        all_ships = shipments_db.get_all()
        shipment = next((s for s in all_ships if s["id"].startswith(shipment_id)), None)
        
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    target_id = shipment["id"]
    
    # If parent shipment has legs, find the active leg (in_transit or assigned or pending)
    if not shipment.get("is_leg") and (shipment.get("status") == "split" or shipment.get("route_type") == "multi-leg"):
        all_legs = shipments_db.get_filtered({"parent_id": shipment["id"]})
        active_leg = next((l for l in all_legs if l.get("status") in ["assigned", "in_transit"]), None)
        if not active_leg:
            # Fallback to the first pending leg
            sorted_legs = sorted(all_legs, key=lambda x: x.get("leg_order", 0))
            active_leg = next((l for l in sorted_legs if l.get("status") == "pending"), None)
            
        if active_leg:
            target_id = active_leg["id"]
            shipment = active_leg
            
    old_driver_id = shipment.get("assigned_driver_id")
    old_vehicle_id = shipment.get("assigned_vehicle_id")
    
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    # Release old driver/vehicle
    if old_driver_id:
        drivers_db.update(old_driver_id, {"status": "available", "current_shipment_id": None})
    if old_vehicle_id:
        vehicles_db.update(old_vehicle_id, {"status": "available"})
        
    # Bind new driver/vehicle
    drivers_db.update(data.driver_id, {"status": "on_duty", "current_shipment_id": target_id})
    vehicles_db.update(data.vehicle_id, {"status": "on_duty"})
    
    new_driver = drivers_db.get_by_id(data.driver_id)
    new_vehicle = vehicles_db.get_by_id(data.vehicle_id)
    
    driver_name = new_driver.get("name", "Unknown") if new_driver else "Unknown"
    plate = new_vehicle.get("number_plate", "Unknown") if new_vehicle else "Unknown"
    
    log_event = ShipmentEvent(
        status=shipment.get("status", "assigned"),
        message=f"⚡ EMERGENCY REASSIGNMENT: Swapped driver to {driver_name} & vehicle to {plate} in real-time.",
        reason="Forced operational reassignment to meet E-Way bill deadline or resolve alert."
    )
    
    shipments_db.update(target_id, {
        "assigned_driver_id": data.driver_id,
        "assigned_vehicle_id": data.vehicle_id,
        "logs": shipment.get("logs", []) + [log_event.model_dump()],
        "stage": "Assigned to Driver (Emergency Reassign)"
    })
    
    if target_id != shipment_id:
        shipments_db.update(shipment_id, {
            "assigned_driver_id": data.driver_id,
            "assigned_vehicle_id": data.vehicle_id,
            "stage": "Assigned to Driver (Emergency Reassign)"
        })
    
    return {"message": "Emergency reassignment complete", "target_shipment_id": target_id}

@router.post("/{shipment_id}/assign")
def manual_assign(shipment_id: str, data: ManualAssignRequest):
    updated = _perform_assignment(shipment_id, data.driver_id, data.vehicle_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return {"message": "Assigned manually", "shipment": updated}

@router.post("/{shipment_id}/deassign")
def deassign_shipment(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    from datetime import datetime
    all_ships = shipments_db.get_all()
    legs = [s for s in all_ships if s.get("parent_id") == shipment_id]
    
    # Safety Check: Cannot deassign if work has started
    if shipment.get("status") in ["in_transit", "delivered"]:
        raise HTTPException(status_code=400, detail="Cannot deassign: Shipment already in transit or delivered.")
        
    for leg in legs:
        if leg.get("status") in ["in_transit", "delivered"]:
             raise HTTPException(status_code=400, detail="Cannot deassign: One or more legs have already started.")
             
    # Reset Parent Shipment
    shipments_db.update(shipment_id, {
        "status": "pending",
        "stage": "Awaiting AI/Manual Assignment",
        "assigned_driver_id": None,
        "assigned_vehicle_id": None,
        "logs": shipment.get("logs", []) + [{
            "status": "pending", 
            "message": "⚠️ Manager deassigned this shipment. All previous assignments and legs have been cleared.", 
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }]
    })
    
    # Clear associated legs
    for leg in legs:
        shipments_db.delete(leg["id"])
        
    return {"message": "Shipment deassigned and reset to pending successfully"}

@router.post("/bulk-assign")
def bulk_assign(company_id: str):
    """
    Optimised bulk assignment engine.
    Pre-loads ALL fleet and shipment data ONCE into memory, runs the full
    matching logic in-memory (tracking assigned state via sets), then
    flushes all changes to disk in a single batch at the end.
    This eliminates the O(N²) disk I/O that caused runtime errors on large datasets.
    """
    from backend.database import JSONDatabase
    from backend.models import ShipmentEvent
    from backend.services.route_engine import haversine, find_nearest_warehouse
    from backend.services.driver_intel import calculate_driver_performance_score
    from backend.services.finance_engine import estimate_delivery_cost
    from backend.services.assignment import check_calamity_zone, is_weather_disrupted
    from backend.services.route_engine import check_drone_viability

    # ── 1. SINGLE BATCH READ ─────────────────────────────────────────────────
    drivers_db    = JSONDatabase("drivers")
    vehicles_db   = JSONDatabase("vehicles")
    warehouses_db = JSONDatabase("warehouses")
    drones_db     = JSONDatabase("drones")

    all_drivers    = drivers_db.get_all()
    all_vehicles   = vehicles_db.get_all()
    all_warehouses = warehouses_db.get_all()
    all_shipments  = shipments_db.get_all()
    all_drones     = drones_db.get_all()

    pending = [s for s in all_shipments if s and s.get("status") == "pending" and s.get("company_id") == company_id]

    # ── 2. BUILD IN-MEMORY INDEXES ──────────────────────────────────────────
    # Only consider drivers/vehicles for this company
    company_drivers  = {d["id"]: d for d in all_drivers  if d and d.get("company_id") == company_id}
    company_vehicles = {v["id"]: v for v in all_vehicles if v and v.get("company_id") == company_id}
    wh_map           = {w["id"]: w for w in all_warehouses}

    # Track which drivers/vehicles have been assigned IN THIS RUN (in-memory)
    assigned_driver_ids  = set()
    assigned_vehicle_ids = set()

    # Track per-vehicle current load in-memory (from already-active shipments)
    vehicle_active_load: dict = {}
    for s in all_shipments:
        if s and s.get("assigned_vehicle_id") and s.get("status") in ["assigned", "in_transit"]:
            vid = s["assigned_vehicle_id"]
            vehicle_active_load[vid] = vehicle_active_load.get(vid, 0.0) + s.get("weight", 0.0)

    # ── 3. MUTATION BUFFERS ─────────────────────────────────────────────────
    # Collect all mutations; write them ONCE at the end
    shipment_mutations: dict = {}   # shipment_id -> dict of changes
    driver_mutations:   dict = {}   # driver_id   -> dict of changes
    vehicle_mutations:  dict = {}   # vehicle_id  -> dict of changes

    assigned_count = 0
    failed_count   = 0

    # ── 4. INNER ASSIGNMENT LOGIC (pure in-memory) ──────────────────────────
    def _get_v_cap(v, v_type):
        cap = v.get("capacity")
        try:
            return float(cap) if cap else None
        except (ValueError, TypeError):
            pass
        if   "heavy" in v_type or "large" in v_type: return 10000.0
        elif "small" in v_type or "truck" in v_type:  return 3000.0
        elif "van"   in v_type or "delivery" in v_type: return 1500.0
        elif "ev"    in v_type:  return 800.0
        elif "bike"  in v_type or "scooty" in v_type or "scooter" in v_type: return 80.0
        elif "drone" in v_type:  return 15.0
        return 1000.0

    def _try_assign(shipment) -> dict | None:
        s_weight  = shipment.get("weight", 0)
        p_lat, p_lng = shipment["pickup"]["lat"], shipment["pickup"]["lng"]
        d_lat, d_lng = shipment["drop"]["lat"],   shipment["drop"]["lng"]
        leg_type    = shipment.get("leg_type")
        is_leg      = shipment.get("is_leg", False)
        distance    = haversine(p_lat, p_lng, d_lat, d_lng)
        is_direct   = not is_leg and distance < 50
        is_first_mile  = leg_type == "first_mile"
        is_last_mile   = leg_type == "last_mile"
        is_middle_mile = leg_type == "middle_mile"

        # Calamity check (still uses DB, but cached via weather_cells; minor overhead)
        if check_calamity_zone(p_lat, p_lng, company_id) or check_calamity_zone(d_lat, d_lng, company_id):
            return None

        # Drone fast-path for last-mile
        if is_last_mile:
            weather_disrupted = is_weather_disrupted(p_lat, p_lng, company_id) or is_weather_disrupted(d_lat, d_lng, company_id)
            if not weather_disrupted:
                pickup_wh_id = shipment.get("pickup_warehouse_id")
                drone_vehicles = [
                    v for vid, v in company_vehicles.items()
                    if "drone" in v.get("type", "").lower()
                    and v.get("base_warehouse_id") == pickup_wh_id
                    and v.get("status") == "available"
                    and vid not in assigned_vehicle_ids
                ]
                for dv in drone_vehicles:
                    if s_weight <= dv.get("capacity", 20):
                        drone_intel = check_drone_viability(p_lat, p_lng, d_lat, d_lng, s_weight)
                        if drone_intel.get("viable"):
                            return {
                                "assigned_driver_id":  "DRONE-SYSTEM",
                                "assigned_vehicle_id": dv["id"],
                                "status":    "in_transit",
                                "stage":     "Drone Air Delivery",
                                "route_type": "drone-leg",
                                "finance":   estimate_delivery_cost(shipment, "drone")
                            }

        best_score = None
        best_pair  = None

        for d_id, d in company_drivers.items():
            # Skip drivers already assigned in this run or already busy in DB
            if d_id in assigned_driver_ids:
                continue
            if d.get("status") not in ["available", "on_duty"]:
                continue
            if d.get("is_fit") == False:
                continue

            v_id = d.get("assigned_vehicle_id")
            if not v_id or v_id in assigned_vehicle_ids:
                continue

            v = company_vehicles.get(v_id)
            if not v:
                continue
            if v.get("is_operational") == False:
                continue
            if float(v.get("vehicle_health_score", 100.0)) <= 0.0:
                continue
            if v.get("status") == "assigned":
                continue

            v_type   = str(v.get("type", "")).lower()
            v_base   = v.get("base_warehouse_id")
            v_present = v.get("present_warehouse_id") or v.get("current_warehouse_id") or v_base

            is_heavy_truck  = "heavy" in v_type or "large" in v_type
            is_small_truck  = "small" in v_type or ("truck" in v_type and not is_heavy_truck)
            is_van          = "van"   in v_type or "delivery" in v_type
            is_bike_scooty  = "bike"  in v_type or "scooty" in v_type or "scooter" in v_type
            is_ev           = "ev"    in v_type
            is_drone        = "drone" in v_type

            priority_score = 0
            is_suitable    = False

            if is_direct:
                nearest_wh = find_nearest_warehouse(p_lat, p_lng, company_id)
                if not nearest_wh:
                    continue
                if v_base != nearest_wh["id"] or v_present != nearest_wh["id"]:
                    continue
                if is_small_truck:
                    priority_score = 100000; is_suitable = True
                elif is_van:
                    priority_score = 50000;  is_suitable = True
                else:
                    continue

            elif is_first_mile:
                if is_bike_scooty or is_ev:
                    is_suitable = True
                    weather_ok = is_weather_disrupted(p_lat, p_lng, company_id)
                    priority_score = (100000 if is_ev else 50000) if weather_ok else (100000 if is_bike_scooty else 50000)
                else:
                    continue

            elif is_last_mile:
                weather_disrupted = is_weather_disrupted(p_lat, p_lng, company_id) or is_weather_disrupted(d_lat, d_lng, company_id)
                if weather_disrupted:
                    if is_van:
                        priority_score = 100000; is_suitable = True
                    else:
                        continue
                else:
                    if is_van:
                        priority_score = 100000; is_suitable = True
                    elif is_bike_scooty:
                        priority_score = 50000;  is_suitable = True
                    else:
                        continue

            elif is_middle_mile:
                if is_heavy_truck or is_small_truck:
                    is_suitable    = True
                    priority_score = 100000 if is_heavy_truck else 50000
                    pickup_wh_id   = shipment.get("pickup_warehouse_id")
                    drop_wh_id     = shipment.get("drop_warehouse_id")
                    if v_base == drop_wh_id and v_present == pickup_wh_id:
                        priority_score += 500000
                else:
                    continue

            if not is_suitable:
                continue

            # Capacity check using in-memory load tracker
            curr_load = vehicle_active_load.get(v_id, 0.0)
            v_cap     = _get_v_cap(v, v_type)
            if curr_load + s_weight > v_cap:
                continue

            # Score
            score = priority_score + calculate_driver_performance_score(d) + (d.get("safety_rating", 5) * 10)
            ref_wh = wh_map.get(v_present or v_base)
            if ref_wh:
                score -= haversine(ref_wh["lat"], ref_wh["lng"], p_lat, p_lng) * 100

            if best_score is None or score > best_score:
                best_score = score
                best_pair  = (d_id, v_id, v)

        if not best_pair:
            return None

        d_id, v_id, v = best_pair
        return {
            "assigned_driver_id":  d_id,
            "assigned_vehicle_id": v_id,
            "status":  "assigned",
            "stage":   "Assigned to Driver",
            "finance": estimate_delivery_cost(shipment, v.get("type", "").lower())
        }

    # ── 5. MAIN LOOP ─────────────────────────────────────────────────────────
    today = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%d")

    for s in pending:
        try:
            result = _try_assign(s)
            if result:
                d_id = result.get("assigned_driver_id")
                v_id = result.get("assigned_vehicle_id")

                # Build log event
                if d_id == "DRONE-SYSTEM":
                    v_obj = company_vehicles.get(v_id, {})
                    log_event = ShipmentEvent(
                        status="in_transit",
                        message=f"🛰️ AI deployed autonomous drone {v_id} for the last-mile segment."
                    )
                    result["stage"]  = "Drone Air Delivery"
                    result["status"] = "in_transit"
                else:
                    d_obj = company_drivers.get(d_id, {})
                    v_obj = company_vehicles.get(v_id, {})
                    log_event = ShipmentEvent(
                        status="assigned",
                        message=f"🤖 AI bulk-assigned {d_obj.get('name','Driver')} / {v_obj.get('number_plate','Vehicle')}."
                    )

                result["logs"] = s.get("logs", []) + [log_event.model_dump()]
                shipment_mutations[s["id"]] = result

                # Mark in-memory so next iterations skip these
                if d_id != "DRONE-SYSTEM":
                    assigned_driver_ids.add(d_id)
                    assigned_vehicle_ids.add(v_id)
                    vehicle_active_load[v_id] = vehicle_active_load.get(v_id, 0.0) + s.get("weight", 0.0)

                    # Update in-memory driver/vehicle state (so subsequent iterations see correct status)
                    if d_id in company_drivers:
                        company_drivers[d_id]["status"] = "assigned"
                    if v_id in company_vehicles:
                        company_vehicles[v_id]["status"] = "assigned"

                    driver_mutations[d_id]  = {"status": "assigned", "assigned_vehicle_id": v_id}
                    vehicle_mutations[v_id] = {"status": "assigned", "assigned_driver_id": d_id}

                    # Operational days (in-memory; will be persisted in batch)
                    d_pending = driver_mutations.get(d_id, {})
                    drv = {**company_drivers.get(d_id, {}), **d_pending}
                    dates = drv.get("operational_dates", [])
                    if today not in dates:
                        dates = list(dates) + [today]
                    driver_mutations[d_id] = {**d_pending, "operational_dates": dates, "operational_days": len(dates)}

                    v_pending = vehicle_mutations.get(v_id, {})
                    veh = {**company_vehicles.get(v_id, {}), **v_pending}
                    v_dates = veh.get("operational_dates", [])
                    if today not in v_dates:
                        v_dates = list(v_dates) + [today]
                    vehicle_mutations[v_id] = {**v_pending, "operational_dates": v_dates, "operational_days": len(v_dates)}

                assigned_count += 1
            else:
                failed_count += 1
        except Exception as e:
            print(f"[bulk_assign] Error assigning shipment {s.get('id')}: {e}")
            failed_count += 1

    # ── 6. SINGLE BATCH WRITE ────────────────────────────────────────────────
    # Flush shipment mutations
    for sid, changes in shipment_mutations.items():
        try:
            shipments_db.update(sid, changes)
        except Exception as e:
            print(f"[bulk_assign] Shipment write error {sid}: {e}")

    # Flush driver mutations
    if driver_mutations:
        try:
            raw_drivers = drivers_db.get_all()
            for drv in raw_drivers:
                if drv and drv.get("id") in driver_mutations:
                    drv.update(driver_mutations[drv["id"]])
            drivers_db.write(raw_drivers)
        except Exception as e:
            print(f"[bulk_assign] Driver batch write error: {e}")

    # Flush vehicle mutations
    if vehicle_mutations:
        try:
            raw_vehicles = vehicles_db.get_all()
            for veh in raw_vehicles:
                if veh and veh.get("id") in vehicle_mutations:
                    veh.update(vehicle_mutations[veh["id"]])
            vehicles_db.write(raw_vehicles)
        except Exception as e:
            print(f"[bulk_assign] Vehicle batch write error: {e}")

    return {
        "message": f"Bulk assignment complete. Assigned: {assigned_count}, Skipped: {failed_count}",
        "assigned": assigned_count,
        "failed": failed_count
    }

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
    assignments: Optional[List[Optional[LegAssignment]]] = None
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
                # Robust access for both model objects and dictionaries
                if isinstance(assign_data, dict):
                    d_id = assign_data.get('driver_id')
                    v_id = assign_data.get('vehicle_id')
                else:
                    d_id = getattr(assign_data, 'driver_id', None)
                    v_id = getattr(assign_data, 'vehicle_id', None)
                
                _perform_assignment(leg_id, d_id, v_id)
            else:
                # Fallback to auto-assign for this leg
                try:
                    from backend.services.assignment import auto_assign_shipment
                    leg = shipments_db.get_by_id(leg_id)
                    assigned_data = auto_assign_shipment(leg)
                    if assigned_data:
                        shipments_db.update(leg_id, assigned_data)
                except: pass
    
    return {"message": f"Manually split into {len(legs)} legs with planned assignments."}

@router.post("/auto-split/bulk")
async def bulk_auto_split(company_id: str):
    """
    Automated Route Splitter for all pending shipments.
    """
    all_ships = shipments_db.get_all()
    pending = [s for s in all_ships if s and s.get("company_id") == company_id and s.get("status") == "pending" and not s.get("is_leg")]
    
    success_count = 0
    error_count = 0
    
    from backend.services.route_engine import decompose_shipment
    for s in pending:
        try:
            legs_data = decompose_shipment(s)
            if legs_data:
                _generate_legs(s, legs_data)
                success_count += 1
            else:
                error_count += 1
        except Exception as e:
            print(f"Bulk Split Error for {s.get('id')}: {e}")
            error_count += 1
            
    return {
        "message": f"Bulk Route Optimization Complete. Optimized {success_count} journeys. {error_count} skipped (under 50km or no warehouses).",
        "success_count": success_count,
        "error_count": error_count
    }

@router.post("/{shipment_id}/auto-split")
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
        # Gracefully handle "optimized as direct" case
        shipments_db.update(shipment_id, {
            "route_type": "direct",
            "stage": "Route Optimized",
            "status": "pending" # Keep pending but optimized
        })
        return {"message": "Journey Optimized: Direct delivery is most efficient for this route."}
    
    new_leg_ids = _generate_legs(shipment, legs_data)
    
    # Optional: Auto-assign is usually a separate step, but we'll keep it if needed.
    # For now, following "Route Splitter" focus.
        
    return {"message": f"Successfully planned multi-leg route with {len(new_leg_ids)} legs."}

@router.post("/{shipment_id}/calamity-divert")
def manual_calamity_divert(shipment_id: str):
    """
    Manually forces a calamity-based route divert/splitting and re-assignment.
    This bypasses normal wait-it-out buffer logic, forcing the route engine to
    divert the shipment to the nearest safe warehouse.
    """
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    # Standardize to the parent shipment for splitting
    parent_id = shipment.get("parent_id") or shipment["id"]
    parent = shipments_db.get_by_id(parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent shipment not found")
        
    # To force a divert, we need:
    # 1. The current location (from current_location, or the active leg, or pickup)
    # 2. Find nearest safe warehouse outside calamity zone.
    # Let's get the active weather cells:
    from backend.routers.tracking import get_all_active_weather_cells
    disaster_cells = get_all_active_weather_cells(parent["company_id"])
    
    # Current location of transit
    curr_loc = shipment.get("current_location") or shipment.get("pickup")
    if not curr_loc or not curr_loc.get("lat"):
        raise HTTPException(status_code=400, detail="Cannot determine current location of shipment for divert.")
        
    from backend.services.route_engine import find_nearest_safe_warehouse, haversine
    safe_wh = find_nearest_safe_warehouse(curr_loc["lat"], curr_loc["lng"], parent["company_id"], disaster_cells)
    if not safe_wh:
        # Fallback: find ANY warehouse not in calamity if possible, or just the nearest warehouse
        warehouses_db = JSONDatabase("warehouses")
        all_whs = warehouses_db.get_all()
        company_whs = [w for w in all_whs if w and w.get("company_id") == parent["company_id"]]
        if company_whs:
            safe_wh = min(company_whs, key=lambda w: haversine(curr_loc["lat"], curr_loc["lng"], w["lat"], w["lng"]))
            
    if not safe_wh:
        raise HTTPException(status_code=400, detail="No suitable warehouse found for diversion.")
        
    # Now trigger the divert logic. Let's force check_and_reroute_calamities to run with can_delay=False!
    # To do that, we temporarily set the shipment status to "in_transit" and expected_delivery to a past date
    # so that within_range or emergency halt gets triggered, and run it.
    orig_status = shipment.get("status")
    orig_expected = shipment.get("expected_delivery")
    
    shipment["status"] = "in_transit"
    shipment["expected_delivery"] = (datetime.utcnow() - timedelta(days=1)).isoformat()
    
    # We must also write it temporarily to database so check_and_reroute_calamities (which fetches parent/child from database) sees it correctly.
    shipments_db.update(shipment["id"], shipment)
    
    from backend.services.route_engine import check_and_reroute_calamities
    try:
        # Run it
        rerouted = check_and_reroute_calamities(shipment, disaster_cells)
        if rerouted:
            return {"message": "Shipment successfully diverted due to calamity override."}
        else:
            # If check_and_reroute_calamities did not divert, let's restore original state
            shipment["status"] = orig_status
            shipment["expected_delivery"] = orig_expected
            shipments_db.update(shipment["id"], shipment)
            raise HTTPException(status_code=400, detail="Could not automatically route divert. Verify if calamity is active near shipment route.")
    except Exception as e:
        # Restore on failure
        shipment["status"] = orig_status
        shipment["expected_delivery"] = orig_expected
        shipments_db.update(shipment["id"], shipment)
        raise HTTPException(status_code=500, detail=f"Divert execution error: {str(e)}")

def _generate_legs(parent_shipment, leg_data):
    from backend.models import ShipmentEvent
    import random
    
    # Ensure parent_shipment is a dict for consistency
    if hasattr(parent_shipment, 'model_dump'):
        p_dict = parent_shipment.model_dump()
    else:
        p_dict = parent_shipment

    # Update parent shipment basic status
    p_dict["route_type"] = "multi-leg"
    p_dict["status"] = "split"
    p_dict["stage"] = "Route Optimized"
    
    log_event = ShipmentEvent(status="split", message=f"🔗 Multi-leg journey planned via {len(leg_data)} warehouse hubs.")
    p_dict["logs"] = (p_dict.get("logs") or []) + [log_event.model_dump()]
    
    # Generate/obtain verification codes for parent
    p_code = p_dict.get("pickup_code") or str(random.randint(100000, 999999))
    d_code = p_dict.get("delivery_code") or str(random.randint(100000, 999999))
    p_dict["pickup_code"] = p_code
    p_dict["delivery_code"] = d_code
    
    # Sequential Protocol Hardening: Next Pickup = Previous Drop + 5 Minutes Buffer
    next_pivot_time = snap_eta_to_business_hours(datetime.utcnow())
    new_ids = []
    
    suggested_price_sum = 0.0
    total_cost_sum = 0.0
    fuel_budget_sum = 0.0
    toll_budget_sum = 0.0
    driver_wage_sum = 0.0
    food_allowance_sum = 0.0
    breakdown_reserve_sum = 0.0
    projected_profit_sum = 0.0
    distance_km_sum = 0.0
    
    # We will generate the legs and calculate bottom-up sums
    legs_to_insert = []
    
    for i, leg in enumerate(leg_data):
        # 1. Pickup Deadline for THIS leg
        p_deadline = next_pivot_time
        
        l_pickup = leg.get("pickup") or {"lat": 0, "lng": 0, "address": "Unknown"}
        l_drop = leg.get("drop") or {"lat": 0, "lng": 0, "address": "Unknown"}
        dist = haversine(l_pickup.get("lat", 0), l_pickup.get("lng", 0), l_drop.get("lat", 0), l_drop.get("lng", 0))
        
        l_type = leg.get("leg_type") or "standard_leg"
        is_middle_mile = l_type == "middle_mile"
        
        # Mandatory 12-hour delay for middle mile (Trucks) for load consolidation/scheduling
        if is_middle_mile:
            p_deadline = snap_eta_to_business_hours(p_deadline + timedelta(hours=12))
        
        # 2. Travel & Processing Duration
        speed = 65.0 if is_middle_mile else 30.0 
        travel_time_hours = dist / (speed or 1)
        wait_time_hours = 1.5 if is_middle_mile else 0.5 
        
        # 3. Expected Drop Time for THIS leg
        raw_eta = p_deadline + timedelta(hours=travel_time_hours + wait_time_hours)
        expected_time = snap_eta_to_business_hours(raw_eta)
        
        # 4. Set Pivot for NEXT leg: Prev Drop + 30 mins buffer gap
        next_pivot_time = snap_eta_to_business_hours(expected_time + timedelta(minutes=30))
        
        leg_log = ShipmentEvent(
            status="pending",
            message=f"Created as {l_type.replace('_', ' ').capitalize()} (Leg {i+1}). Optimized for { 'Trunk (Truck)' if is_middle_mile else 'Hub Handoff' } delivery.",
            location=l_pickup
        )
        
        v_pref = "truck" if is_middle_mile else "scooty"
        finance = estimate_delivery_cost(leg, v_pref)
        finance["expected_profit"] = finance.get("projected_profit", 0) # Compatibility
        
        # Sum up leg finances
        suggested_price_sum += finance.get("suggested_price", 0.0)
        total_cost_sum += finance.get("total_cost", 0.0)
        fuel_budget_sum += finance.get("fuel_budget", 0.0)
        toll_budget_sum += finance.get("toll_budget", 0.0)
        driver_wage_sum += finance.get("driver_wage", 0.0)
        food_allowance_sum += finance.get("food_allowance", 0.0)
        breakdown_reserve_sum += finance.get("breakdown_reserve", 0.0)
        projected_profit_sum += finance.get("projected_profit", 0.0)
        distance_km_sum += finance.get("distance_km", 0.0)

        # Set codes specifically for Leg 1 and Final Leg
        leg_pickup_code = p_code if i == 0 else str(random.randint(100000, 999999))
        leg_delivery_code = d_code if i == len(leg_data) - 1 else str(random.randint(100000, 999999))

        l_id = str(uuid.uuid4())
        leg_shipment = Shipment(
            id=l_id,
            company_id=p_dict.get("company_id"),
            pickup=Location(**l_pickup),
            drop=Location(**l_drop),
            weight=p_dict.get("weight", 0),
            description=f"{p_dict.get('description', 'Shipment')} (Leg {i+1})",
            parent_id=p_dict.get("id"),
            is_leg=True,
            leg_order=i+1,
            leg_type=l_type,
            route_type="direct",
            expected_delivery=expected_time.isoformat() + "Z",
            pickup_deadline=p_deadline.isoformat() + "Z",
            delivery_otp=leg_delivery_code,
            pickup_code=leg_pickup_code,
            delivery_code=leg_delivery_code,
            logs=[leg_log],
            is_perishable=p_dict.get("is_perishable", False),
            vitality=p_dict.get("vitality", 100),
            pickup_warehouse_id=leg.get("pickup_warehouse_id"),
            drop_warehouse_id=leg.get("drop_warehouse_id"),
            qr_code_data=f"LX-{uuid.uuid4().hex[:8].upper()}",
            finance=finance,
            payment_status=p_dict.get("payment_status", "unpaid")
        )
        
        legs_to_insert.append(leg_shipment.model_dump())
        new_ids.append(l_id)
    
    # Save the consolidated finances on the parent shipment
    p_dict["finance"] = {
        "suggested_price": round(suggested_price_sum, 2),
        "total_cost": round(total_cost_sum, 2),
        "fuel_budget": round(fuel_budget_sum, 2),
        "toll_budget": round(toll_budget_sum, 2),
        "driver_wage": round(driver_wage_sum, 2),
        "food_allowance": round(food_allowance_sum, 2),
        "breakdown_reserve": round(breakdown_reserve_sum, 2),
        "projected_profit": round(projected_profit_sum, 2),
        "margin": round(projected_profit_sum, 2), # margin is profit for dashboard compatibility
        "distance_km": round(distance_km_sum, 2)
    }
    
    # Save parent and insert all legs
    shipments_db.update(p_dict["id"], p_dict)
    for leg_data_dict in legs_to_insert:
        shipments_db.insert(leg_data_dict)
        
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

@router.post("/{shipment_id}/eway-return-hub")
def eway_return_hub(shipment_id: str):
    """
    Manual trigger for returning a shipment to sender via the nearest safe hub
    due to E-Way bill expiry.
    """
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    parent_id = shipment.get("parent_id") or shipment["id"]
    parent = shipments_db.get_by_id(parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent shipment not found")

    company_id = parent.get("company_id")
    from backend.routers.tracking import get_all_active_weather_cells
    from backend.services.route_engine import find_nearest_safe_warehouse, haversine, decompose_shipment
    from backend.models import ShipmentEvent

    disaster_cells = get_all_active_weather_cells(company_id)
    curr_loc = shipment.get("current_location") or shipment.get("pickup")
    if not curr_loc or not curr_loc.get("lat"):
        curr_loc = parent.get("pickup")

    safe_wh = find_nearest_safe_warehouse(curr_loc["lat"], curr_loc["lng"], company_id, disaster_cells)
    if not safe_wh:
        warehouses_db = JSONDatabase("warehouses")
        company_whs = [w for w in warehouses_db.get_all() if w and w.get("company_id") == company_id]
        if company_whs:
            safe_wh = min(company_whs, key=lambda w: haversine(curr_loc["lat"], curr_loc["lng"], w["lat"], w["lng"]))
            
    if not safe_wh:
        raise HTTPException(status_code=400, detail="No suitable warehouse found for return.")

    # 1. Clean up existing child legs
    old_child_ids = parent.get("child_leg_ids", [])
    for cid in old_child_ids:
        cleg = shipments_db.get_by_id(cid)
        if cleg and cleg.get("status") in ["pending", "assigned", "in_transit"]:
            shipments_db.delete(cid)

    # 2. De-assign current driver if any
    orig_driver_id = shipment.get("assigned_driver_id")
    drivers_db = JSONDatabase("drivers")
    if orig_driver_id:
        orig_driver = drivers_db.get_by_id(orig_driver_id)
        if orig_driver:
            import uuid as _uuid
            from datetime import datetime
            notifs = orig_driver.get("notifications", [])
            notifs.append({
                "id": str(_uuid.uuid4()),
                "shipment_id": shipment["id"],
                "title": "📋 Delivery Cancelled — E-Way Bill Expired",
                "message": (
                    f"Order '{parent.get('description', parent['id'][:8])}' cannot be delivered. "
                    f"E-Way Bill expired. "
                    f"The shipment is being returned to the sender via nearest hub."
                ),
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "read": False
            })
            orig_driver["notifications"] = notifs
            drivers_db.update(orig_driver_id, orig_driver)

    # 3. Create the multi-leg return journey
    leg1 = {
        "pickup": curr_loc,
        "drop": {"lat": safe_wh["lat"], "lng": safe_wh["lng"], "address": safe_wh["name"]},
        "drop_warehouse_id": safe_wh["id"],
        "leg_type": "first_mile",
        "company_id": company_id
    }

    remaining_shipment = {
        "pickup": {"lat": safe_wh["lat"], "lng": safe_wh["lng"], "address": safe_wh["name"]},
        "drop": parent.get("pickup"),
        "company_id": company_id
    }

    remaining_legs = decompose_shipment(remaining_shipment)
    if not remaining_legs:
        remaining_legs = [{
            "pickup": remaining_shipment["pickup"],
            "drop": remaining_shipment["drop"],
            "pickup_warehouse_id": safe_wh["id"],
            "leg_type": "last_mile"
        }]

    all_return_legs_data = [leg1] + remaining_legs

    # Swap parent drop to original pickup
    parent["drop"] = parent.get("pickup")
    parent["pickup"] = curr_loc
    parent["route_type"] = "return"
    parent["status"] = "split"
    parent["stage"] = f"Returned via Hub ({safe_wh['name']})"
    parent["assigned_driver_id"] = None
    parent["assigned_vehicle_id"] = None

    log_msg = (
        f"📋 COMPLIANCE RETURN (MANUAL): E-Way Bill expired. "
        f"Delivery aborted and shipment routed back to sender via '{safe_wh['name']}'."
    )
    log = ShipmentEvent(status="split", message=log_msg, reason="E-Way Bill Expiry")
    parent["logs"] = parent.get("logs", []) + [log.model_dump()]

    shipments_db.update(parent_id, parent)

    new_leg_ids = _generate_legs(parent, all_return_legs_data)

    parent_after_legs = shipments_db.get_by_id(parent_id)
    parent_after_legs["child_leg_ids"] = new_leg_ids
    parent_after_legs["route_type"] = "return"
    shipments_db.update(parent_id, parent_after_legs)
    
    from backend.services.assignment import auto_assign_shipment
    first_leg = shipments_db.get_by_id(new_leg_ids[0])
    if first_leg:
        assign = auto_assign_shipment(first_leg)
        if assign and "error" not in assign:
            first_leg["assigned_driver_id"] = assign.get("assigned_driver_id")
            first_leg["assigned_vehicle_id"] = assign.get("assigned_vehicle_id")
            first_leg["status"] = "assigned"
            shipments_db.update(new_leg_ids[0], first_leg)

    return {"message": f"Successfully initiated return via {safe_wh['name']}. Split into {len(new_leg_ids)} return legs."}

@router.post("/{shipment_id}/pay")
def pay_shipment(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        all_ships = shipments_db.get_all()
        shipment = next((s for s in all_ships if s["id"].startswith(shipment_id)), None)
    
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    if shipment.get("payment_status") == "paid":
        return {"message": "Already paid"}

    amount = shipment.get("finance", {}).get("suggested_price", 0)
    
    # 1. Update Shipment Logs & status
    from backend.models import ShipmentEvent
    new_log = ShipmentEvent(
        status=shipment.get("status", "pending"),
        message=f"💰 PAYMENT RECEIVED: ₹{amount} paid by customer via Digital Gateway."
    ).model_dump()
    
    shipments_db.update(shipment["id"], {
        "payment_status": "paid",
        "logs": shipment.get("logs", []) + [new_log]
    })
    
    # 2. Update Company Profit (Receiver paid the amount)
    from backend.services.turso_db import TursoCompaniesDB
    comp_kv = TursoCompaniesDB()
    comp = comp_kv.get_by_id(shipment.get("company_id"))
    if comp:
        comp_kv.update(comp["id"], {"total_profit": comp.get("total_profit", 0) + amount})
        
        # Log to ledger
        from backend.database import JSONDatabase
        ledger_db = JSONDatabase("ledger")
        ledger_db.insert({
            "id": str(uuid.uuid4()),
            "company_id": comp["id"],
            "type": "REVENUE",
            "amount": amount,
            "shipment_id": shipment["id"],
            "desc": f"Customer Payment for Shipment #{shipment['id'][:8]}",
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })
    
    # Also update all legs
    all_ships = shipments_db.get_all()
    legs = [s for s in all_ships if s.get("parent_id") == shipment["id"]]
    for leg in legs:
        leg_log = ShipmentEvent(
            status=leg.get("status", "pending"),
            message=f"💰 PAYMENT RECEIVED (Parent Payment): Parent shipment paid by customer."
        ).model_dump()
        shipments_db.update(leg["id"], {
            "payment_status": "paid",
            "logs": leg.get("logs", []) + [leg_log]
        })
        
    return {"message": "Payment successful"}

@router.post("/{shipment_id}/rate-legacy")
def rate_shipment_legacy(shipment_id: str, data: dict):
    rating = data.get("rating")
    if not rating: raise HTTPException(status_code=400, detail="Rating required")
    return rate_shipment(shipment_id, ShipmentRating(rating=float(rating)))
@router.get("/assets/eligible/{shipment_id}")
def get_eligible_assets(shipment_id: str, company_id: str, from_wh: Optional[str] = None, to_wh: Optional[str] = None):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        shipment = next((s for s in shipments_db.get_all() if s["id"].startswith(shipment_id)), None)
    
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    drivers = [d for d in JSONDatabase("drivers").get_all() if d and d.get("company_id") == company_id and d.get("status") in ["available", "on_duty"]]
    vehicles = [v for v in JSONDatabase("vehicles").get_all() if v and v.get("company_id") == company_id and v.get("status") in ["available", "on_duty"]]
    warehouses = JSONDatabase("warehouses").get_all()
    
    p_wh_id = from_wh if from_wh and from_wh != "null" else shipment.get("pickup_warehouse_id")
    d_wh_id = to_wh if to_wh and to_wh != "null" else shipment.get("drop_warehouse_id")
    leg_type = shipment.get("leg_type")
    
    is_first_mile = leg_type == "first_mile" or (d_wh_id and not p_wh_id)
    is_last_mile = leg_type == "last_mile" or (p_wh_id and not d_wh_id)
    is_middle_mile = leg_type == "middle_mile" or (p_wh_id and d_wh_id)
    is_direct = not p_wh_id and not d_wh_id

    # Weather Check for bikes
    from backend.services.route_engine import predict_weather_impact
    weather = predict_weather_impact(shipment["pickup"]["lat"], shipment["pickup"]["lng"])
    bad_weather = weather.get("condition") in ["Storm", "Rain"]

    eligible = {
        "local": [],
        "returning": [],
        "drones": [],
        "others": []
    }
    
    from backend.services.route_engine import haversine
    all_shipments = shipments_db.get_all()
    
    # M_MILE_TYPES and L_MILE_TYPES are replaced by normalized is_x flags.

    for d in drivers:
        v_id = d.get("assigned_vehicle_id")
        if not v_id: continue
        v = next((veh for veh in vehicles if veh["id"] == v_id), None)
        if not v: continue
        
        v_type = v.get("type", "").lower()
        v_base = v.get("base_warehouse_id")

        # 1. Filter by Vehicle Type Rules (Normalized case-insensitive match)
        is_heavy_truck = "heavy" in v_type or "large" in v_type
        is_small_truck = "small" in v_type or ("truck" in v_type and not is_heavy_truck)
        is_van = "van" in v_type or "delivery" in v_type
        is_bike_scooty = "bike" in v_type or "scooty" in v_type or "scooter" in v_type or "motorcycle" in v_type
        is_ev = "ev" in v_type or "electric" in v_type
        is_drone = "drone" in v_type

        if is_first_mile or is_last_mile or is_direct:
            if not (is_ev or is_bike_scooty or is_van or is_drone):
                continue
        if is_middle_mile:
            if not (is_heavy_truck or is_small_truck):
                continue
        
        # 2. Weather Filter
        if bad_weather and is_bike_scooty:
            continue

        # 3. Capacity Check (Current load + this shipment)
        active_for_v = [s for s in all_shipments if s and s.get("assigned_vehicle_id") == v["id"] and s.get("status") in ["assigned", "in_transit"]]
        curr_load = sum(s.get("weight", 0) for s in active_for_v)
        
        # Robust capacity check with fallback defaults
        v_cap = v.get("capacity")
        if not v_cap:
            if is_heavy_truck: v_cap = 10000.0
            elif is_small_truck: v_cap = 3000.0
            elif is_van: v_cap = 1500.0
            elif is_ev: v_cap = 800.0
            elif is_bike_scooty: v_cap = 80.0
            elif is_drone: v_cap = 15.0
            else: v_cap = 1000.0
        else:
            try:
                v_cap = float(v_cap)
            except (ValueError, TypeError):
                v_cap = 1000.0
                
        if curr_load + shipment.get("weight", 0) > v_cap: continue

        # Determine location category
        p_wh = next((w for w in warehouses if w["id"] == p_wh_id), None) if p_wh_id else None
        loc_status = "Available"
        is_local = False
        is_returning = False
        
        target_wh_id = d_wh_id if is_first_mile else p_wh_id
        target_wh = next((w for w in warehouses if w["id"] == target_wh_id), None) if target_wh_id else None

        curr_loc = v.get("current_location")
        if curr_loc and target_wh:
            dist = haversine(curr_loc.get("lat", 0), curr_loc.get("lng", 0), target_wh.get("lat", 0), target_wh.get("lng", 0))
            if dist < 0.5:
                loc_status = f"At {target_wh.get('name', 'Warehouse')}"
                is_local = True
            elif v_base == d_wh_id and not is_first_mile:
                is_returning = True
                loc_status = "Back-haul Eligible"
        elif v_base == target_wh_id:
            loc_status = "Stationary at Base"
            is_local = True

        asset = {
            "driver_id": d["id"],
            "driver_name": d["name"],
            "driver_rating": d.get("driving_score", 0) + (d.get("safety_rating", 5) * 10),
            "vehicle_id": v["id"],
            "vehicle_plate": v["number_plate"],
            "vehicle_type": v["type"],
            "base_warehouse_id": v.get("base_warehouse_id"),
            "location_status": loc_status,
            "is_enroute": False
        }
        
        if is_local: eligible["local"].append(asset)
        elif is_returning: eligible["returning"].append(asset)
        else: eligible["others"].append(asset)
            
    # Check for Drones at pickup warehouse
    if (is_last_mile or is_direct) and p_wh_id:
        wh = next((w for w in warehouses if w["id"] == p_wh_id), None)
        if wh:
            # Drones can be registered in vehicles DB with type "Drone" OR in the dedicated "drones" DB
            drone_vehicles = [v for v in vehicles if "drone" in v["type"].lower() and v.get("base_warehouse_id") == p_wh_id]
            dedicated_drones = [d for d in JSONDatabase("drones").get_all() if d.get("base_warehouse_id") == p_wh_id and d.get("status") == "available"]
            
            # Distance/Capacity Check for Drones
            from backend.services.route_engine import check_drone_viability
            p_lat, p_lng = shipment["pickup"]["lat"], shipment["pickup"]["lng"]
            d_lat, d_lng = shipment["drop"]["lat"], shipment["drop"]["lng"]
            
            # Evaluate viability
            drone_intel = check_drone_viability(p_lat, p_lng, d_lat, d_lng, shipment.get("weight", 0))
            
            if drone_intel.get("viable"):
                status_text = f"At {wh.get('name', 'Warehouse')} (Ready)"
            else:
                status_text = f"⚠️ Warning: {drone_intel.get('reason')}"
                
            # Add drones from vehicles table
            for dv in drone_vehicles:
                if shipment.get("weight", 0) > dv.get("capacity", 20):
                    continue
                eligible["drones"].append({
                    "driver_id": "DRONE-SYSTEM",
                    "driver_name": "Autonomous Drone Core",
                    "vehicle_id": dv["id"],
                    "vehicle_plate": dv.get("number_plate", "DRONE-SYS"),
                    "vehicle_type": dv.get("type", "Drone"),
                    "location_status": status_text,
                    "is_enroute": False
                })
                
            # Add drones from dedicated drones table
            for dd in dedicated_drones:
                if shipment.get("weight", 0) > dd.get("capacity", 20):
                    continue
                eligible["drones"].append({
                    "driver_id": "DRONE-SYSTEM",
                    "driver_name": "Autonomous Drone Core",
                    "vehicle_id": dd["id"],
                    "vehicle_plate": dd.get("license_number", "DRONE-SYS"),
                    "vehicle_type": "Drone (Dedicated)",
                    "location_status": status_text,
                    "is_enroute": False
                })
                
    return eligible
