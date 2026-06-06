from fastapi import APIRouter, HTTPException, UploadFile, File, Header
from backend.models import Driver, Vehicle, Drone, Warehouse, Shipment, ShipmentEvent, Location
from backend.database import JSONDatabase
from backend.services.turso_db import TursoCompaniesDB
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel
import uuid
import random
import re
import math
import json
from backend.services.auth_utils import verify_context

router = APIRouter()
companies_db = TursoCompaniesDB()          # ← Turso (persistent on Vercel)
drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")
warehouses_db = JSONDatabase("warehouses")
ledger_db = JSONDatabase("ledger")
reviews_db = JSONDatabase("journey_reviews")
shipments_db = JSONDatabase("shipments")
drones_db = JSONDatabase("drones")
receivers_db = JSONDatabase("receivers")

from backend.models import Receiver, WarehouseLeaveRequest

leave_requests_db = JSONDatabase("warehouse_leave_requests")

@router.get("/receivers")
async def get_receivers(company_id: str):
    all_rec = receivers_db.get_all()
    return [r for r in all_rec if r.get("company_id") == company_id]

@router.post("/receivers/upsert")
async def upsert_receiver(rec: Receiver):
    existing = receivers_db.get_all()
    # Check if this company already has a receiver with this email
    match = next((r for r in existing if r.get("company_id") == rec.company_id and r.get("email") == rec.email), None)
    
    if match:
        # Update existing
        receivers_db.update(match["id"], rec.model_dump())
        return {"message": "Receiver updated", "id": match["id"]}
    else:
        # Create new
        receivers_db.insert(rec.model_dump())
        return {"message": "Receiver created", "id": rec.id}

@router.delete("/receivers/{id}")
async def delete_receiver(id: str, company_id: str):
    rec = receivers_db.get_by_id(id)
    if not rec or rec.get("company_id") != company_id:
        raise HTTPException(status_code=404, detail="Receiver not found")
    receivers_db.delete(id)
    return {"message": "Receiver deleted"}


@router.post("/drivers/bulk-parse")
async def bulk_parse_drivers(company_id: str, file: Optional[UploadFile] = File(None), url_req: Optional[str] = None):
    import pandas as pd
    import io
    import requests
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
    
    # Fetch warehouses for name-to-id mapping
    whs = warehouses_db.get_all()
    wh_map = {w.get("name").lower(): w.get("id") for w in whs if w.get("company_id") == company_id}
    wh_ids = {w.get("id"): w.get("id") for w in whs if w.get("company_id") == company_id}
    wh_short_ids = {w.get("id")[:8]: w.get("id") for w in whs if w.get("company_id") == company_id}

    drivers = []
    errors = []
    
    col_map = {
        "name": ["name", "driver_name", "full_name"],
        "login_id": ["login_id", "username", "id"],
        "password": ["password", "pass", "pwd"],
        "license_type": ["license_type", "type", "license", "vehicle_type"],
        "hub": ["hub", "warehouse", "base_warehouse_id", "base_hub", "hub_id"],
        "exp": ["exp", "experience", "years_experience", "years"],
        "accidents": ["accidents", "past_accidents", "accidents_count"],
        "violations": ["violations", "traffic_violations", "challans", "challan_count"],
        "phone": ["phone", "contact", "contact_number", "mobile"]
    }

    def get_col(row, keys):
        for k in keys:
            if k in row: return row[k]
        return None

    for idx, row in df.iterrows():
        try:
            vals = row.values.tolist()
            
            name = get_col(row, col_map["name"]) or (vals[0] if len(vals) > 0 else None)
            login_id = get_col(row, col_map["login_id"]) or (vals[1] if len(vals) > 1 else None)
            password = get_col(row, col_map["password"]) or (vals[2] if len(vals) > 2 else None)
            license_type = get_col(row, col_map["license_type"]) or (vals[3] if len(vals) > 3 else "van")
            hub_val = str(get_col(row, col_map["hub"]) or (vals[4] if len(vals) > 4 else "")).strip()
            exp = get_col(row, col_map["exp"]) or (vals[5] if len(vals) > 5 else 0)
            accidents = get_col(row, col_map["accidents"]) or (vals[6] if len(vals) > 6 else 0)
            violations = get_col(row, col_map["violations"]) or (vals[7] if len(vals) > 7 else 0)
            phone = str(get_col(row, col_map["phone"]) or (vals[8] if len(vals) > 8 else "")).strip()

            if not name or not login_id or not password:
                errors.append(f"Row {idx+1}: Missing required fields (Name, Login ID, or Password)")
                continue

            if len(phone) == 10 and phone.isdigit():
                phone = "+91" + phone
                
            hub_id = wh_ids.get(hub_val) or wh_short_ids.get(hub_val) or wh_map.get(hub_val.lower()) or hub_val
            
            d = {
                "name": str(name),
                "login_id": str(login_id),
                "password": str(password),
                "license_type": str(license_type).lower(),
                "base_warehouse_id": hub_id,
                "years_experience": float(exp) if exp is not None and not pd.isna(exp) else 0.0,
                "past_accidents": int(accidents) if accidents is not None and not pd.isna(accidents) else 0,
                "traffic_violations": int(violations) if violations is not None and not pd.isna(violations) else 0,
                "challan_count": int(violations) if violations is not None and not pd.isna(violations) else 0,
                "contact_number": phone,
                "company_id": company_id
            }
            drivers.append(d)
        except Exception as e:
            errors.append(f"Row {idx+1}: {str(e)}")
            continue
            
    return {"drivers": drivers, "count": len(drivers), "errors": errors}

@router.post("/drivers/bulk-confirm")
async def bulk_confirm_drivers(drivers: List[Driver]):
    all_existing = drivers_db.get_all()
    existing_logins = {d.get("login_id") for d in all_existing}
    existing_phones = {d.get("contact_number") for d in all_existing}
    
    success_count = 0
    errors = []
    
    from backend.services.driver_intel import calculate_driver_performance_score
    
    for d in drivers:
        if d.login_id in existing_logins:
            errors.append(f"Driver '{d.name}' skipped: Login ID '{d.login_id}' already exists.")
            continue
            
        d_dict = d.model_dump()
        d_dict["driving_score"] = calculate_driver_performance_score(d_dict)
        drivers_db.insert(d_dict)
        
        # Update local sets
        existing_logins.add(d.login_id)
        existing_phones.add(d.contact_number)
        success_count += 1
        
    return {"message": f"Successfully created {success_count} drivers.", "errors": errors}
    
@router.post("/finance/recalculate-all")
def recalculate_all_shipments(company_id: str):
    from backend.services.finance_engine import recalculate_shipment_finance, estimate_delivery_cost
    all_shipments = shipments_db.get_all()
    company_shipments = [s for s in all_shipments if s and s.get("company_id") == company_id]
    
    updated_count = 0
    # Process parents first
    parents = [s for s in company_shipments if s.get("route_type") == "multi-leg" and not s.get("parent_id")]
    
    for p in parents:
        legs = [s for s in company_shipments if s.get("parent_id") == p["id"]]
        if legs:
            res = recalculate_shipment_finance(p, legs, vehicles_db)
            shipments_db.update(p["id"], res["shipment"])
            for leg in res["legs"]:
                shipments_db.update(leg["id"], leg)
            updated_count += 1
            
    # Process single shipments
    singles = [s for s in company_shipments if s.get("route_type") != "multi-leg" and not s.get("parent_id")]
    for s in singles:
        v_type = "van"
        if s.get("assigned_vehicle_id"):
            v = vehicles_db.get_by_id(s["assigned_vehicle_id"])
            if v: v_type = v.get("type", "van")
            
        new_finance = estimate_delivery_cost(s, v_type)
        s["finance"] = new_finance
        shipments_db.update(s["id"], s)
        updated_count += 1
        
    return {"message": f"Successfully recalculated finance for {updated_count} shipments."}



@router.post("/vehicles/bulk-parse")
async def bulk_parse_vehicles(company_id: str, file: Optional[UploadFile] = File(None), url_req: Optional[str] = None):
    import pandas as pd
    import io
    import requests
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
    
    # Fetch warehouses for name-to-id mapping
    whs = warehouses_db.get_all()
    wh_map = {w.get("name").lower(): w.get("id") for w in whs if w.get("company_id") == company_id}
    wh_ids = {w.get("id"): w.get("id") for w in whs if w.get("company_id") == company_id}
    wh_short_ids = {w.get("id")[:8]: w.get("id") for w in whs if w.get("company_id") == company_id}

    vehicles = []
    errors = []
    
    col_map = {
        "type": ["type", "vehicle_type", "category"],
        "hub": ["hub", "warehouse", "base_warehouse_id", "base_hub", "hub_id"],
        "plate": ["plate", "number_plate", "vehicle_number", "registration"],
        "capacity": ["capacity", "payload", "weight_limit"],
        "efficiency": ["efficiency", "fuel_efficiency", "mileage"]
    }

    def get_col(row, keys):
        for k in keys:
            if k in row: return row[k]
        return None

    for idx, row in df.iterrows():
        try:
            vals = row.values.tolist()
            
            v_type = get_col(row, col_map["type"]) or (vals[0] if len(vals) > 0 else "van")
            hub_val = str(get_col(row, col_map["hub"]) or (vals[1] if len(vals) > 1 else "")).strip()
            plate = get_col(row, col_map["plate"]) or (vals[2] if len(vals) > 2 else None)
            capacity = get_col(row, col_map["capacity"]) or (vals[3] if len(vals) > 3 else 1000)
            efficiency = get_col(row, col_map["efficiency"]) or (vals[4] if len(vals) > 4 else 15)

            if not plate:
                errors.append(f"Row {idx+1}: Missing Number Plate")
                continue

            hub_id = wh_ids.get(hub_val) or wh_short_ids.get(hub_val) or wh_map.get(hub_val.lower()) or hub_val

            v = {
                "type": str(v_type).lower(),
                "base_warehouse_id": hub_id,
                "number_plate": str(plate).upper(),
                "capacity": float(capacity) if capacity is not None and not pd.isna(capacity) else 1000.0,
                "fuel_efficiency": float(efficiency) if efficiency is not None and not pd.isna(efficiency) else 15.0,
                "company_id": company_id,
                "status": "available",
                "speed": 40.0
            }
            vehicles.append(v)
        except Exception as e:
            errors.append(f"Row {idx+1}: {str(e)}")
            continue
            
    return {"vehicles": vehicles, "count": len(vehicles), "errors": errors}

@router.post("/vehicles/bulk-confirm")
async def bulk_confirm_vehicles(vehicles: List[Vehicle]):
    all_existing = vehicles_db.get_all()
    existing_plates = {v.get("number_plate") for v in all_existing}
    
    success_count = 0
    errors = []
    
    for v in vehicles:
        if v.number_plate in existing_plates:
            errors.append(f"Vehicle '{v.number_plate}' skipped: Number plate already exists.")
            continue
            
        vehicles_db.insert(v.model_dump())
        existing_plates.add(v.number_plate)
        success_count += 1
        
    return {"message": f"Successfully created {success_count} vehicles.", "errors": errors}

@router.get("/ledger")
def get_ledger(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    txs = ledger_db.get_all()
    # Match by company_id if present, OR if the transaction has a driver in this company
    driver_ids = {d["id"] for d in drivers_db.get_all() if d.get("company_id") == company_id}
    result = []
    for t in txs:
        if t.get("company_id") == company_id:
            result.append(t)
        elif t.get("to_address") in driver_ids:
            # SmartContractTx entries use to_address as driver_id
            result.append(t)
    return result

@router.post("/ledger/boost")
def boost_points(data: dict):
    company_id = data.get("company_id")
    percentage = data.get("percentage", 0)
    
    if not company_id:
        raise HTTPException(status_code=400, detail="Missing company_id")
    if percentage <= 0:
        raise HTTPException(status_code=400, detail="Percentage must be positive")
        
    drivers = [d for d in drivers_db.get_all() if d.get("company_id") == company_id]
    boosted_count = 0
    for d in drivers:
        current_points = float(d.get("reward_points", 0))
        boost = round(current_points * (percentage / 100.0), 2)
        new_total = round(current_points + boost, 2)
        drivers_db.update(d["id"], {"reward_points": new_total})
        # Log boost as a proper SmartContractTx-compatible ledger entry
        ledger_db.insert({
            "id": str(uuid.uuid4()),
            "tx_hash": f"0x{uuid.uuid4().hex}",
            "from_address": "Logistix_Escrow",
            "to_address": d["id"],
            "points_awarded": boost,
            "breakdown": {
                "base_distance": 0,
                "punctuality_bonus": 0,
                "safety_incentive": 0,
                "wellness_bonus": 0,
                "boost": boost,
                "total": boost
            },
            "timestamp": datetime.utcnow().isoformat(),
            "shipment_id": "GLOBAL_BOOST",
            "leg_id": None,
            "company_id": company_id
        })
        boosted_count += 1
            
    return {"message": f"Successfully boosted points for {boosted_count} drivers by {percentage}%."}

@router.get("/system/baseline-stats")
def get_baseline_stats(company_id: str):
    wh = [w for w in warehouses_db.get_all() if w.get("company_id") == company_id]
    vh = [v for v in vehicles_db.get_all() if v.get("company_id") == company_id]
    ev = [v for v in vh if v.get("type") in ["bike", "scooty", "3 wheeled (battery)"]]
    
    return {
        "warehouse_count": len(wh),
        "vehicle_count": len(vh),
        "ev_count": len(ev)
    }

@router.get("/reviews/{shipment_id}")
def get_journey_review(shipment_id: str):
    reviews = reviews_db.get_all()
    for r in reviews:
        if r.get("shipment_id") == shipment_id:
            return r
    raise HTTPException(status_code=404, detail="Journey review not found")

# Drivers CRUD
@router.post("/drivers")
def create_driver(driver: Driver):
    # Check for duplicate login ID
    all_drivers = drivers_db.get_all()
    if any(d.get("login_id") == driver.login_id for d in all_drivers):
        raise HTTPException(status_code=400, detail="This Login ID is already taken.")

    from backend.services.driver_intel import calculate_driver_performance_score
    driver_data = driver.model_dump()
    driver_data["driving_score"] = calculate_driver_performance_score(driver_data)
    return drivers_db.insert(driver_data)

@router.get("/drivers")
def get_drivers(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    drivers = drivers_db.get_filtered({"company_id": company_id})
    
    # 24-hour Audit Reset Logic
    from datetime import timezone
    now = datetime.now(timezone.utc)
    for d in drivers:
        last_audit = d.get("last_audit_date")
        if last_audit:
            try:
                dt = datetime.fromisoformat(last_audit.replace('Z', '+00:00'))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if (now - dt).total_seconds() > 21600:
                    d["is_fit"] = True
                    d["last_audit_date"] = None
                    drivers_db.update(d["id"], {"is_fit": True, "last_audit_date": None})
            except: pass
    return drivers

@router.delete("/drivers/{driver_id}")
def delete_driver(driver_id: str):
    if drivers_db.delete(driver_id):
        return {"message": "Deleted"}
    raise HTTPException(status_code=404, detail="Driver not found")

# Vehicles CRUD
@router.post("/vehicles")
def create_vehicle(vehicle: Vehicle):
    return vehicles_db.insert(vehicle.model_dump())

@router.get("/vehicles")
def get_vehicles(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    vehicles = vehicles_db.get_filtered({"company_id": company_id})
    
    # 24-hour Audit Reset Logic
    from datetime import timezone
    now = datetime.now(timezone.utc)
    for v in vehicles:
        last_audit = v.get("last_audit_date")
        if last_audit:
            try:
                dt = datetime.fromisoformat(last_audit.replace('Z', '+00:00'))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if (now - dt).total_seconds() > 21600:
                    v["is_operational"] = True
                    v["last_audit_date"] = None
                    vehicles_db.update(v["id"], {"is_operational": True, "last_audit_date": None})
            except: pass
    return vehicles

@router.delete("/vehicles/{vehicle_id}")
def delete_vehicle(vehicle_id: str):
    if vehicles_db.delete(vehicle_id):
        return {"message": "Deleted"}
    raise HTTPException(status_code=404, detail="Vehicle not found")

# Drones CRUD
@router.post("/drones")
def create_drone(drone: Drone):
    return drones_db.insert(drone.model_dump())

@router.get("/drones")
def get_drones(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    return drones_db.get_filtered({"company_id": company_id})

@router.put("/drones/{drone_id}")
def update_drone(drone_id: str, data: dict):
    if drones_db.update(drone_id, data):
        return {"message": "Drone updated successfully"}
    raise HTTPException(status_code=404, detail="Drone not found")

@router.delete("/drones/{drone_id}")
def delete_drone(drone_id: str):
    if drones_db.delete(drone_id):
        return {"message": "Deleted"}
    raise HTTPException(status_code=404, detail="Drone not found")

@router.post("/drones/bulk-parse")
async def bulk_parse_drones(company_id: str, file: Optional[UploadFile] = File(None), url_req: Optional[str] = None):
    import pandas as pd
    import io
    import requests
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
    
    df.columns = [str(c).strip().lower().replace(' ', '_') for c in df.columns]
    
    whs = warehouses_db.get_all()
    wh_map = {w.get("name").lower(): w.get("id") for w in whs if w.get("company_id") == company_id}
    wh_ids = {w.get("id"): w.get("id") for w in whs if w.get("company_id") == company_id}
    wh_short_ids = {w.get("id")[:8]: w.get("id") for w in whs if w.get("company_id") == company_id}

    drones = []
    errors = []
    
    col_map = {
        "license": ["license", "license_number", "id", "drone_id"],
        "hub": ["hub", "warehouse", "base_warehouse_id", "base_hub", "hub_id"],
        "capacity": ["capacity", "payload", "weight_limit"],
        "radius": ["radius", "distance", "range"]
    }

    def get_col(row, keys):
        for k in keys:
            if k in row: return row[k]
        return None

    for idx, row in df.iterrows():
        try:
            vals = row.values.tolist()
            
            license_no = get_col(row, col_map["license"]) or (vals[0] if len(vals) > 0 else None)
            hub_val = str(get_col(row, col_map["hub"]) or (vals[1] if len(vals) > 1 else "")).strip()
            capacity = get_col(row, col_map["capacity"]) or (vals[2] if len(vals) > 2 else 5.0)
            radius = get_col(row, col_map["radius"]) or (vals[3] if len(vals) > 3 else 20.0)

            if not license_no:
                errors.append(f"Row {idx+1}: Missing Drone License Number")
                continue

            hub_id = wh_ids.get(hub_val) or wh_short_ids.get(hub_val) or wh_map.get(hub_val.lower()) or hub_val

            d = {
                "license_number": str(license_no).upper(),
                "base_warehouse_id": hub_id,
                "capacity": float(capacity) if capacity is not None and not pd.isna(capacity) else 5.0,
                "radius": float(radius) if radius is not None and not pd.isna(radius) else 20.0,
                "company_id": company_id,
                "status": "available"
            }
            drones.append(d)
        except Exception as e:
            errors.append(f"Row {idx+1}: {str(e)}")
            continue
            
    return {"drones": drones, "count": len(drones), "errors": errors}

@router.post("/drones/bulk-confirm")
async def bulk_confirm_drones(drones: List[Drone]):
    all_existing = drones_db.get_all()
    existing_licenses = {d.get("license_number") for d in all_existing}
    
    success_count = 0
    errors = []
    
    for d in drones:
        if d.license_number in existing_licenses:
            errors.append(f"Drone '{d.license_number}' skipped: License number already exists.")
            continue
            
        drones_db.insert(d.model_dump())
        existing_licenses.add(d.license_number)
        success_count += 1
        
    return {"message": f"Successfully created {success_count} drones.", "errors": errors}

# Warehouses CRUD
@router.post("/warehouses")
def create_warehouse(warehouse: Warehouse):
    if warehouse.manager_email:
        existing = warehouses_db.get_filtered({"manager_email": warehouse.manager_email})
        if existing:
            raise HTTPException(status_code=400, detail="A warehouse manager with this email already exists.")
    return warehouses_db.insert(warehouse.model_dump())

@router.get("/warehouses")
def get_warehouses(company_id: Optional[str] = None, id: Optional[str] = None, x_logistix_context: Optional[str] = Header(None)):
    # Fallback to header context if query param is missing
    target_company = company_id or x_logistix_context
    if not target_company:
        raise HTTPException(status_code=400, detail="Missing company context")
        
    verify_context(target_company, x_logistix_context)
    
    if id:
        w = warehouses_db.get_by_id(id)
        if w and w.get("company_id") == target_company:
            return w
        # If not found or wrong company, return empty or 404
        return []
        
    return warehouses_db.get_filtered({"company_id": target_company})



@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str):
    alerts_db.update(alert_id, {"status": "resolved"})
    return {"message": "Alert resolved"}

@router.post("/warehouses/suggest")
def suggest_warehouse_location(data: dict):
    lat = data.get("lat")
    lng = data.get("lng")
    company_id = data.get("company_id")
    
    # 1. Get company shipments to find density
    all_shipments = shipments_db.get_all()
    my_ships = [s for s in all_shipments if s and s.get("company_id") == company_id]
    
    def get_haversine(l1, ln1, l2, ln2):
        R = 6371
        dl = math.radians(l2 - l1)
        dn = math.radians(ln2 - ln1)
        a = math.sin(dl/2)**2 + math.cos(math.radians(l1)) * math.cos(math.radians(l2)) * math.sin(dn/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    # 2. Localized Strategy Logic
    nearby = [s for s in my_ships if s and get_haversine(lat, lng, s["drop"]["lat"], s["drop"]["lng"]) < 30.0]
    
    if nearby:
        # Centroid of nearby demand
        s_lat = sum(s["drop"]["lat"] for s in nearby) / len(nearby)
        s_lng = sum(s["drop"]["lng"] for s in nearby) / len(nearby)
        reason = "strategy_reason_sector"
    else:
        # Route-Based Strategic Expansion
        # Find the company's operational "Center of Gravity"
        my_whs = [w for w in warehouses_db.get_all() if w.get("company_id") == company_id]
        if my_whs:
            center_lat = sum(w["lat"] for w in my_whs) / len(my_whs)
            center_lng = sum(w["lng"] for w in my_whs) / len(my_whs)
        elif my_ships:
            center_lat = sum(s["drop"]["lat"] for s in my_ships) / len(my_ships)
            center_lng = sum(s["drop"]["lng"] for s in my_ships) / len(my_ships)
        else:
            # Absolute new player: suggest a local optimization near an intersection
            center_lat, center_lng = lat + 0.1, lng + 0.1 # Arbitrary target for route probe
        
        dist_to_center = get_haversine(lat, lng, center_lat, center_lng)
        
        # We aim for a "Leg" hub: ~5-15% of the way to the center, or at least 3km
        pull_factor = min(0.15, 10.0 / dist_to_center) if dist_to_center > 0 else 0.05
        # Add some "jitter" based on coordinates to make it dynamic/unique per location
        pull_factor *= (0.8 + (abs(math.sin(lat * 100)) * 0.4)) 
        
        target_lat = lat + (center_lat - lat) * pull_factor
        target_lng = lng + (center_lng - lng) * pull_factor
        
        # Snap to nearest road
        s_lat, s_lng = target_lat, target_lng
        try:
            nearest_url = f"http://router.project-osrm.org/nearest/v1/driving/{target_lng},{target_lat}?number=1"
            n_resp = requests.get(nearest_url, timeout=2).json()
            if n_resp.get("code") == "Ok":
                s_lng, s_lat = n_resp["waypoints"][0]["location"]
        except: pass
        
        reason = "strategy_reason_bridge" if my_ships or my_whs else "strategy_ai_reason"

    # 4. FINAL DISTANCE CALCULATION
    dist_km = 0
    try:
        osrm_url = f"http://router.project-osrm.org/route/v1/driving/{lng},{lat};{s_lng},{s_lat}?overview=false"
        resp = requests.get(osrm_url, timeout=3).json()
        if resp.get("code") == "Ok":
            dist_km = resp["routes"][0]["distance"] / 1000.0
        else:
            dist_km = get_haversine(lat, lng, s_lat, s_lng)
    except:
        dist_km = get_haversine(lat, lng, s_lat, s_lng)

    return {
        "suggested_lat": s_lat,
        "suggested_lng": s_lng,
        "distance_km": round(dist_km, 2),
        "reason": reason,
        "strategic_improvement": True
    }

@router.get("/check-plate")
async def check_plate(plate: str):
    # Global check across all companies
    existing = [v for v in vehicles_db.get_all() if v and v.get("number_plate") == plate]
    return {"exists": len(existing) > 0}

@router.get("/dashboard/stats")
def get_manager_stats(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    s_db = JSONDatabase("shipments")
    v_db = JSONDatabase("vehicles")
    d_db = JSONDatabase("drivers")
    
    shipments = s_db.get_filtered({"company_id": company_id})
    vehicles = v_db.get_filtered({"company_id": company_id})
    drivers = d_db.get_filtered({"company_id": company_id})
    
    # 1. Timely Delivery %
    delivered = [s for s in shipments if s.get("status") == "delivered"]
    def is_timely(s):
        actual = s.get("actual_delivery")
        expected = s.get("expected_delivery")
        if not actual or not expected: return True # Assume timely if data missing
        return str(actual) <= str(expected)
        
    timely = [s for s in delivered if is_timely(s)]
    timely_percent = (len(timely) / len(delivered) * 100) if delivered else 100
    
    # 2. Avg Delay
    delays = []
    for s in delivered:
        if s.get("actual_delivery") and s.get("expected_delivery"):
            from datetime import datetime
            try:
                actual = datetime.fromisoformat(s.get("actual_delivery"))
                expected = datetime.fromisoformat(s.get("expected_delivery"))
                diff = (actual - expected).total_seconds() / 60
                if diff > 0: delays.append(diff)
            except: pass
    avg_delay = sum(delays) / len(delays) if delays else 0
    
    # 3. Fleet Distribution
    fleet_dist = {
        "in_transit": len([v for v in vehicles if v.get("status") == "in_transit"]),
        "available": len([v for v in vehicles if v.get("status") in ["available", "idle", "ready"]]),
        "maintenance": len([v for v in vehicles if v.get("status") == "maintenance"])
    }
    
    # 4. Warehouse Count
    warehouses = [w for w in warehouses_db.get_all() if w and w.get("company_id") == company_id]
    
    # 5. Financial Overview (Real data from Ledger)
    comp_txs = [t for t in ledger_db.get_all() if t and t.get("company_id") == company_id]
    revenue = sum(float(t.get("amount") or 0) for t in comp_txs if t.get("type") == "REVENUE")
    expenses = sum(float(t.get("amount") or 0) for t in comp_txs if t.get("type") == "EXPENSE")
    net_profit = revenue - expenses

    return {
        "total_shipments": len(shipments),
        "active_shipments": len([s for s in shipments if s.get("status") != "delivered"]),
        "total_drivers": len(drivers),
        "total_vehicles": len(vehicles),
        "total_warehouses": len(warehouses),
        "timely_percent": round(timely_percent, 1),
        "avg_delay_mins": round(avg_delay, 1),
        "fleet_dist": fleet_dist,
        "revenue": round(revenue, 2),
        "net_profit": round(net_profit, 2),
        "perf_history": [random.randint(85, 100) for _ in range(7)]
    }

@router.get("/analytics/cascade")
def get_cascading_impact(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    all_shipments = shipments_db.get_all()
    my_ships = [s for s in all_shipments if s and s.get("company_id") == company_id]
    
    delayed_ships = [s for s in my_ships if s and (s.get("performance_stats") or {}).get("status") == "delayed" and s.get("status") == "in_transit"]
    
    risks = []
    total_impact_hours = 0
    
    for s in delayed_ships:
        perf = s.get("performance_stats") or {}
        delay_mins = perf.get("diff_mins", 0)
        total_impact_hours += delay_mins / 60
        
        # Predictive cascading to hubs or final legs
        impact_hubs = []
        if s.get("is_leg"):
            # Find subsequent legs
            subs = [ls for ls in my_ships if ls and ls.get("parent_id") == s.get("parent_id") and (ls.get("leg_order") or 0) > (s.get("leg_order") or 0)]
            for sub in subs:
                sub_drop = sub.get("drop") or {}
                impact_hubs.append({
                    "id": sub.get("id", "unknown"),
                    "location": sub_drop.get("address", "Final Destination"),
                    "risk_level": "critical" if delay_mins > 60 else "moderate",
                    "est_delay_mins": delay_mins + 15 # +15m overhead per cascade
                })
        
        risks.append({
            "source_shipment_id": s.get("id"),
            "description": s.get("description", "Unnamed Shipment"),
            "current_delay": f"{delay_mins}m",
            "impact_hubs": impact_hubs or [{"id": "direct", "location": "Final Receiver", "risk_level": "moderate", "est_delay_mins": delay_mins}],
            "severity": "high" if delay_mins > 45 else "medium"
        })
        
    return {
        "active_risk_count": len(risks),
        "total_impact_hours": round(total_impact_hours, 1),
        "risks": risks,
        "recommendation": "Divert high-priority cargo to regional air-legs if delays exceed 90 mins."
    }

@router.put("/drivers/{driver_id}")
def update_driver(driver_id: str, data: dict):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    drivers_db.update(driver_id, data)
    return {"message": "Driver updated successfully"}

@router.put("/vehicles/{vehicle_id}")
def update_vehicle(vehicle_id: str, data: dict):
    vehicle = vehicles_db.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    vehicles_db.update(vehicle_id, data)
    return {"message": "Vehicle updated successfully"}

@router.put("/warehouses/{wh_id}")
def update_warehouse(wh_id: str, data: dict):
    wh = warehouses_db.get_by_id(wh_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    
    new_email = data.get("manager_email")
    if new_email and new_email != wh.get("manager_email"):
        existing = warehouses_db.get_filtered({"manager_email": new_email})
        if existing:
            raise HTTPException(status_code=400, detail="This email is already assigned to another warehouse manager.")
            
    warehouses_db.update(wh_id, data)
    return {"message": "Warehouse updated successfully"}

@router.delete("/warehouses/{wh_id}")
def delete_warehouse(wh_id: str):
    wh = warehouses_db.get_by_id(wh_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    warehouses_db.delete(wh_id)
    return {"message": "Warehouse decommissioned successfully"}

@router.post("/link-vehicle")
def link_driver_to_vehicle(driver_id: str, vehicle_id: str):
    driver = drivers_db.get_by_id(driver_id)
    vehicle = vehicles_db.get_by_id(vehicle_id)
    
    if not driver or not vehicle:
        raise HTTPException(status_code=404, detail="Driver or Vehicle not found")
        
    # Validation
    if driver["license_type"] != vehicle["type"]:
        raise HTTPException(status_code=400, detail=f"License mismatch: {driver['name']} has {driver['license_type']} license, cannot drive {vehicle['type']}.")
    
    if driver.get("base_warehouse_id") != vehicle.get("base_warehouse_id"):
        raise HTTPException(status_code=400, detail="Warehouse mismatch: Driver and Vehicle must belong to the same base hub.")
        
    # Unlink any existing
    if vehicle.get("assigned_driver_id"):
        drivers_db.update(vehicle["assigned_driver_id"], {"assigned_vehicle_id": None})
    if driver.get("assigned_vehicle_id"):
        vehicles_db.update(driver["assigned_vehicle_id"], {"assigned_driver_id": None})
        
    # Link
    drivers_db.update(driver_id, {"assigned_vehicle_id": vehicle_id, "verification_status": "unverified"})
    vehicles_db.update(vehicle_id, {"assigned_driver_id": driver_id})
    
    return {"message": "Linked successfully"}

@router.post("/auto-assign-fleet")
def auto_assign_fleet(company_id: str):
    # Find all unassigned drivers for this company
    drivers = [d for d in drivers_db.get_all() if d and d.get("company_id") == company_id and not d.get("assigned_vehicle_id")]
    # Find all available and unassigned vehicles for this company
    vehicles = [v for v in vehicles_db.get_all() if v and v.get("company_id") == company_id and v.get("status") == "available" and not v.get("assigned_driver_id")]
    
    assigned_count = 0
    for d in drivers:
        # Find matching vehicle: same hub AND same type
        match = next((v for v in vehicles if v.get("base_warehouse_id") == d.get("base_warehouse_id") and v.get("type") == d.get("license_type")), None)
        
        if match:
            # Link
            drivers_db.update(d["id"], {"assigned_vehicle_id": match["id"], "verification_status": "unverified"})
            vehicles_db.update(match["id"], {"assigned_driver_id": d["id"]})
            
            # Remove from pool to prevent double assignment
            vehicles.remove(match)
            assigned_count += 1
            
    return {"message": f"Successfully auto-assigned {assigned_count} driver-vehicle pairs.", "count": assigned_count}

@router.post("/unlink-vehicle")
def unlink_vehicle(driver_id: str):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    v_id = driver.get("assigned_vehicle_id")
    if v_id:
        vehicles_db.update(v_id, {"assigned_driver_id": None})
        drivers_db.update(driver_id, {"assigned_vehicle_id": None, "verification_status": "unverified"})
        
    return {"message": "Unlinked successfully"}

@router.post("/verify-driver/{driver_id}")
def manual_verify_driver(driver_id: str, status: str, vehicle_id: Optional[str] = None):
    if status not in ["verified", "unverified"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    update_data = {"verification_status": status}
    if status == "verified" and vehicle_id:
        # Check if vehicle is already assigned
        all_drivers = drivers_db.get_all()
        if any(d and d.get("assigned_vehicle_id") == vehicle_id and d.get("id") != driver_id for d in all_drivers):
            raise HTTPException(status_code=400, detail="This vehicle is already assigned to another driver.")
        update_data["assigned_vehicle_id"] = vehicle_id
        
    drivers_db.update(driver_id, update_data)
    return {"message": f"Driver marked as {status}" + (f" and linked to vehicle {vehicle_id}" if vehicle_id else "")}

@router.post("/unverify-driver/{driver_id}")
def unverify_driver(driver_id: str, company_id: str):
    driver = drivers_db.get_by_id(driver_id)
    if not driver or driver.get("company_id") != company_id:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    # Check for active shipments assigned to this driver
    shipments_db = JSONDatabase("shipments")
    all_shipments = shipments_db.get_all()
    active = [s for s in all_shipments if s and s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit", "picked_up"]]
    
    if active:
        raise HTTPException(status_code=400, detail="Cannot unverify driver while they have an active shipment.")
        
    drivers_db.update(driver_id, {"verification_status": "unverified"})
    return {"message": "Driver unverified successfully"}

@router.get("/leaderboard")
def get_leaderboard(company_id: str, category: str = "driver", sort_by: str = "overall", warehouse_id: Optional[str] = None):
    from backend.services.driver_intel import calculate_driver_performance_score, calculate_fatigue, calculate_vehicle_efficiency_score
    
    if category == "driver":
        drivers = [d for d in drivers_db.get_all() if d and d.get("company_id") == company_id]
        if warehouse_id:
            drivers = [d for d in drivers if d.get("base_warehouse_id") == warehouse_id]
            
        processed = []
        for d in drivers:
            d["fatigue_score"] = calculate_fatigue(d)
            d["overall_score"] = calculate_driver_performance_score(d)
            # Map frontend keys to backend data
            d["safety_index"] = d.get("safety_rating", 5.0)
            ratings = d.get("customer_ratings", [])
            d["rating"] = sum(ratings)/len(ratings) if ratings else 5.0
            processed.append(d)
            
        key_map = {
            "overall": "overall_score",
            "safety_index": "safety_index",
            "punctuality_rate": "punctuality_rate",
            "rating": "rating",
            "deliveries": "total_deliveries",
            "operational_days": "operational_days"
        }
        target_key = key_map.get(sort_by, "overall_score")
        return sorted(processed, key=lambda x: x.get(target_key, 0), reverse=True)
    else:
        vehicles = [v for v in vehicles_db.get_all() if v and v.get("company_id") == company_id]
        if warehouse_id:
            vehicles = [v for v in vehicles if v.get("base_warehouse_id") == warehouse_id]
            
        processed = []
        for v in vehicles:
            v["efficiency_score"] = calculate_vehicle_efficiency_score(v)
            processed.append(v)
            
        key_map = {
            "overall": "efficiency_score",
            "vehicle_health_score": "vehicle_health_score",
            "fuel_efficiency": "fuel_efficiency",
            "distance": "total_distance_km",
            "deliveries": "total_deliveries", # if we track deliveries for vehicles
            "operational_days": "operational_days"
        }
        target_key = key_map.get(sort_by, "efficiency_score")
        return sorted(processed, key=lambda x: x.get(target_key, 0), reverse=True)

@router.get("/drivers/{driver_id}/profile")
def get_driver_profile(driver_id: str):
    from backend.services.driver_intel import calculate_fatigue, calculate_driver_performance_score
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    driver["fatigue_score"] = calculate_fatigue(driver)
    driver["overall_score"] = calculate_driver_performance_score(driver)
    
    # Fetch recent shipments for this driver
    shipments_db = JSONDatabase("shipments")
    shipments = [s for s in shipments_db.get_all() if s and s.get("assigned_driver_id") == driver_id]
    
    return {
        "profile": driver,
        "recent_shipments": shipments[:10],
        "wallet_balance": driver.get("wallet_balance", 0),
        "deliveries_completed": driver.get("deliveries_completed", 0),
        "total_earnings": driver.get("total_earnings", 0)
    }

import random
from backend.database import JSONDatabase

# Temporary in-memory OTP store for deletion
deletion_otp_store = {}

@router.get("/vehicles/{vehicle_id}/profile")
def get_vehicle_profile(vehicle_id: str):
    vehicle = vehicles_db.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
        
    # Fetch maintenance history or recent trips
    shipments_db = JSONDatabase("shipments")
    shipments = [s for s in shipments_db.get_all() if s and s.get("assigned_vehicle_id") == vehicle_id]
    
    return {
        "profile": vehicle,
        "recent_shipments": shipments[:10]
    }

# System Reset Features (ADMIN ONLY)
@router.post("/system/reset-operations")
def reset_all_operations(data: dict, x_logistix_context: Optional[str] = Header(None)):
    if not x_logistix_context: raise HTTPException(status_code=401, detail="Context missing")
    
    try:
        ctx = json.loads(x_logistix_context)
        cid = ctx.get("company_id") or ctx.get("id")
    except:
        cid = x_logistix_context

    company = companies_db.get_by_id(cid)
    if not company: raise HTTPException(status_code=404, detail="Company not found")
    
    provided_pw = str(data.get("manager_password", "")).strip()
    if provided_pw != str(company.get("password", "")).strip():
        raise HTTPException(status_code=401, detail="Invalid manager password")

    # 1. Clear Operational Data (Shipments, Ledger, Reviews, Funds)
    JSONDatabase("shipments").delete_many("data->>company_id", cid)
    JSONDatabase("ledger").delete_many("data->>company_id", cid)
    JSONDatabase("journey_reviews").delete_many("data->>company_id", cid)
    JSONDatabase("fund_requests").delete_many("data->>company_id", cid)
    JSONDatabase("smart_contracts").delete_many("data->>company_id", cid) # If exists
    
    # 2. Reset Driver Financials & Stats
    d_db = JSONDatabase("drivers")
    all_drivers = d_db.get_all()
    for d in all_drivers:
        if d.get("company_id") == cid:
            d["wallet_balance"] = 0.0
            d["reward_points"] = 0.0
            d["total_trips"] = 0
            d["total_earnings"] = 0.0
            d["monthly_earnings"] = 0.0
            d["status"] = "available"
            d["assigned_vehicle_id"] = None
            d_db.update(d["id"], d)

    # 3. Reset Vehicle Stats
    v_db = JSONDatabase("vehicles")
    all_vehicles = v_db.get_all()
    for v in all_vehicles:
        if v.get("company_id") == cid:
            v["total_distance_km"] = 0.0
            v["status"] = "available"
            v["assigned_driver_id"] = None
            v_db.update(v["id"], v)

    return {"message": "Full Operational Reset Successful. All shipments, wallets, and profit history have been cleared. Personnel and Hubs remain intact."}

@router.post("/system/reset-shipments")
def reset_shipments(data: dict, x_logistix_context: Optional[str] = Header(None)):
    if not x_logistix_context: raise HTTPException(status_code=401, detail="Context missing")
    
    # Robustly extract company_id from potentially JSON context
    try:
        ctx = json.loads(x_logistix_context)
        cid = ctx.get("company_id") or ctx.get("id")
    except:
        cid = x_logistix_context

    company = companies_db.get_by_id(cid)
    if not company: raise HTTPException(status_code=404, detail="Company not found")
    
    provided_pw = str(data.get("manager_password", "")).strip()
    if provided_pw != str(company.get("password", "")).strip():
        raise HTTPException(status_code=401, detail="Invalid manager password")

    s_db = JSONDatabase("shipments")
    # Atomic bulk delete using indexed company_id
    deleted_count = s_db.delete_many("data->>company_id", cid)
    
    return {"message": f"All {deleted_count} shipment records for {company['name']} have been cleared."}

@router.post("/system/reset-drivers")
def reset_drivers(data: dict, x_logistix_context: Optional[str] = Header(None)):
    if not x_logistix_context: raise HTTPException(status_code=401, detail="Context missing")
    
    try:
        ctx = json.loads(x_logistix_context)
        cid = ctx.get("company_id") or ctx.get("id")
    except:
        cid = x_logistix_context

    company = companies_db.get_by_id(cid)
    if not company: raise HTTPException(status_code=404, detail="Company not found")
    
    provided_pw = str(data.get("manager_password", "")).strip()
    if provided_pw != str(company.get("password", "")).strip():
        raise HTTPException(status_code=401, detail="Invalid manager password")

    # Atomic bulk delete
    deleted_count = drivers_db.delete_many("data->>company_id", cid)
    
    # Also reset vehicle assignments for consistency
    all_v = vehicles_db.get_all()
    for v in all_v:
        if v and v.get("company_id") == cid:
            vehicles_db.update(v["id"], {"assigned_driver_id": None})

    return {"message": f"All {deleted_count} driver records for {company['name']} have been cleared."}

@router.post("/system/reset-vehicles")
def reset_vehicles(data: dict, x_logistix_context: Optional[str] = Header(None)):
    if not x_logistix_context: raise HTTPException(status_code=401, detail="Context missing")
    
    try:
        ctx = json.loads(x_logistix_context)
        cid = ctx.get("company_id") or ctx.get("id")
    except:
        cid = x_logistix_context

    company = companies_db.get_by_id(cid)
    if not company: raise HTTPException(status_code=404, detail="Company not found")
    
    provided_pw = str(data.get("manager_password", "")).strip()
    if provided_pw != str(company.get("password", "")).strip():
        raise HTTPException(status_code=401, detail="Invalid manager password")

    # Atomic bulk delete
    v_db = JSONDatabase("vehicles")
    deleted_count = v_db.delete_many("data->>company_id", cid)
    
    # Also reset driver assignments
    all_d = drivers_db.get_all()
    for d in all_d:
        if d and d.get("company_id") == cid:
            drivers_db.update(d["id"], {"assigned_vehicle_id": None})

    return {"message": f"All {deleted_count} vehicle records for {company['name']} have been cleared."}

# Account Deletion with OTP
@router.post("/system/delete-account-request")
def request_account_deletion(data: dict):
    company_id = data.get("company_id")
    password = data.get("manager_password")
    
    if not company_id or not password:
        raise HTTPException(status_code=400, detail="Missing company_id or password")

    c_db = JSONDatabase("companies")
    company = c_db.get_by_id(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
        
    if company.get("password") != password:
        raise HTTPException(status_code=401, detail="Incorrect manager password. Authorization failed.")
    
    otp = str(random.randint(100000, 999999))
    deletion_otp_store[company_id] = otp
    
    print("\n" + "="*80)
    print(f"  [OTP] Account Deletion Code for {company['email']}: {otp}")
    print("="*80 + "\n")
    
    from backend.services.email_service import EmailService
    success = EmailService.send_otp_email(company["email"], otp, purpose="deletion")
    
    if not success:
        return {"message": "Email delivery failed. Verification code logged in server console."}
        
    return {"message": "OTP sent to your registered email."}

@router.post("/system/delete-account-confirm")
def confirm_account_deletion(company_id: str, otp: str):
    if deletion_otp_store.get(company_id) != otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
        
    c_db = JSONDatabase("companies")
    company = c_db.get_by_id(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Account already deleted or not found")
        
    company_email = company.get("email")
    company_name = company.get("name")
    
    # 1. Wipe all associated data
    # Helper to wipe table by company_id
    def wipe_by_company(table_name):
        db = JSONDatabase(table_name)
        all_items = db.get_all()
        remaining = [item for item in all_items if item and item.get("company_id") != company_id]
        db.write(remaining)

    tables_to_wipe = ["drivers", "vehicles", "warehouses", "shipments", "alerts", "ledger", "messages", "strategy_plans"]
    for table in tables_to_wipe:
        wipe_by_company(table)

    if c_db.delete(company_id):
        if company_id in deletion_otp_store:
            del deletion_otp_store[company_id]
            
        # Send goodbye email
        from backend.services.email_service import EmailService
        EmailService.send_goodbye_email(company_email, company_name)
        
        return {"message": "Account and all associated data deleted successfully. We are sorry to see you go."}
    
    raise HTTPException(status_code=404, detail="Account not found")
@router.post("/rescue-shipment")
def rescue_shipment(shipment_id: str, driver_id: str, vehicle_id: str, x_logistix_context: Optional[str] = Header(None)):
    # Verify manager context for rescue operations
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    verify_context(shipment.get("company_id"), x_logistix_context)
    
    old_driver_id = shipment.get("assigned_driver_id")
    old_vehicle_id = shipment.get("assigned_vehicle_id")
    
    # Update new driver and vehicle status
    drivers_db.update(driver_id, {"assigned_vehicle_id": vehicle_id})
    vehicles_db.update(vehicle_id, {"assigned_driver_id": driver_id, "status": "in_transit"})
    
    from backend.routers.shipment import increment_operational_days
    increment_operational_days(driver_id, vehicle_id)
    
    # Update shipment
    log = ShipmentEvent(
        status="in_transit",
        message=f"RESCUE: Shipment assigned to new vehicle [{vehicle_id[:6]}] and driver.",
        reason="Recovery from vehicle breakdown."
    )
    
    shipments_db.update(shipment_id, {
        "assigned_driver_id": driver_id,
        "assigned_vehicle_id": vehicle_id,
        "status": "in_transit",
        "stage": "Recovered - In Transit",
        "logs": shipment.get("logs", []) + [log.model_dump()]
    })
    
    # If there was an old driver, free them (their vehicle is already in maintenance)
    if old_driver_id:
        drivers_db.update(old_driver_id, {"assigned_vehicle_id": None})
        
    return {"message": "Rescue mission initiated. Shipment is back on track."}

@router.get("/fintech-stats")
def get_fintech_stats(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    from datetime import datetime, timedelta
    
    # Get actual ledger transactions
    all_txs = ledger_db.get_all()
    comp_txs = [t for t in all_txs if t and t.get("company_id") == company_id]
    
    # Calculate Daily Revenue (last 24 hours)
    now = datetime.utcnow()
    last_24h = now - timedelta(days=1)
    daily_revenue = sum(
        t["amount"] for t in comp_txs 
        if t["type"] == "REVENUE" and datetime.fromisoformat(t["timestamp"]).replace(tzinfo=None) >= last_24h
    )
    
    # Get unpaid invoices / Digital Escrow in transit from Shipments
    all_ships = shipments_db.get_all()
    company_ships = [s for s in all_ships if s and s.get("company_id") == company_id]
    
    unpaid_ships = [s for s in company_ships if s and s.get("payment_status") == "unpaid" and not s.get("is_leg")]
    unpaid_total = sum(float((s.get("finance") or {}).get("suggested_price", 0)) for s in unpaid_ships)
    
    unpaid_invoices = unpaid_total
    
    bonus_pool = daily_revenue * 0.05 
    
    # Drone Maintenance calculation
    drone_maintenance = sum((s.get("finance") or {}).get("drone_maintenance", 0) for s in company_ships if s)

    # Recent settlements (top 5)
    recent = sorted(comp_txs, key=lambda x: x.get("timestamp", ""), reverse=True)[:5]
    settlements_list = []
    for t in recent:
        settlements_list.append({
            "desc": t.get("desc", "Ledger Entry"),
            "amount": t.get("amount", 0),
            "timestamp": t.get("timestamp", ""),
            "type": t.get("type", "MISC")
        })
        
    # Chart Data: Revenue per day for last 7 days
    labels = []
    values = []
    for i in range(6, -1, -1):
        day_date = now - timedelta(days=i)
        day_start = day_date.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        
        day_rev = sum(
            float(t.get("amount", 0)) for t in comp_txs 
            if t.get("type") == "REVENUE" and day_start <= datetime.fromisoformat(t.get("timestamp", "")).replace(tzinfo=None) < day_end
        )
        labels.append(day_date.strftime("%d %b"))
        values.append(round(day_rev, 2))
        
    # Real Smart Contracts (Escrow) based on active shipments
    escrow_contracts = []
    for s in company_ships:
        if s.get("status") in ["assigned", "in_transit", "at_warehouse"]:
            escrow_contracts.append({
                "id": f"ESC-{s.get('id')[:6].upper()}",
                "shipment_id": s.get("id"),
                "counterparty": s.get("receiver_name") or "Retail Partner",
                "value": s.get("finance", {}).get("suggested_price", 0),
                "status": "⛓️ LOCKED",
                "eta": "On Delivery"
            })
        elif s.get("status") == "delivered" and s.get("payment_status") == "unpaid":
             escrow_contracts.append({
                "id": f"ESC-{s.get('id')[:6].upper()}",
                "shipment_id": s.get("id"),
                "counterparty": s.get("receiver_name") or "Retail Partner",
                "value": s.get("finance", {}).get("suggested_price", 0),
                "status": "⏳ AWAITING PMT",
                "eta": "Immediate"
            })

    # Financial Overhaul: Calculate Net Profit based on Ledger
    total_revenue = sum(float(t.get("amount", 0)) for t in comp_txs if t.get("type") == "REVENUE")
    total_expenses = sum(float(t.get("amount", 0)) for t in comp_txs if t.get("type") == "EXPENSE")
    net_profit = total_revenue - total_expenses

    return {
        "daily_revenue": round(daily_revenue, 2),
        "total_revenue": round(total_revenue, 2),
        "total_expenses": round(total_expenses, 2),
        "net_profit": round(net_profit, 2),
        "digital_escrow": round(unpaid_total, 2),
        "unpaid_invoices": round(unpaid_total, 2),
        "bonus_pool": round(bonus_pool, 2),
        "drone_maintenance": round(drone_maintenance, 2),
        "recent_settlements": settlements_list,
        "escrow_contracts": escrow_contracts[:10],
        "chart_data": {
            "labels": labels,
            "values": values
        }
    }

@router.post("/finance/fully-complete/{shipment_id}")
def finalize_shipment_completion(shipment_id: str, x_logistix_context: Optional[str] = Header(None)):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    verify_context(shipment.get("company_id"), x_logistix_context)
    
    if shipment.get("payment_status") != "paid":
        raise HTTPException(status_code=400, detail="Cannot finalize: Payment must be confirmed first.")
    
    # Finalize the main shipment
    shipments_db.update(shipment_id, {
        "status": "finalized",
        "stage": "Finalized",
        "logs": shipment.get("logs", []) + [{
            "status": "finalized",
            "message": "📦 Lifecycle complete. Shipment archived and cleared for rating.",
            "timestamp": datetime.utcnow().isoformat()
        }]
    })
    
    # Blockchain record for Finalized Delivery
    import hashlib
    tx_hash_data = f"DELIVERY-{shipment_id}-{datetime.utcnow().isoformat()}"
    tx_hash = hashlib.sha256(tx_hash_data.encode()).hexdigest()
    
    ledger_db.insert({
        "id": f"TX-{uuid.uuid4().hex[:8]}",
        "company_id": shipment.get("company_id"),
        "type": "BLOCKCHAIN_PROOF",
        "desc": f"Immutable Proof of Delivery for {shipment_id[:8]}",
        "hash": tx_hash,
        "amount": 0,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    })

    # If it's multi-leg, finalize all legs too
    all_shipments = shipments_db.get_all()
    involved_drivers = set()
    if shipment.get("assigned_driver_id"):
        involved_drivers.add(shipment["assigned_driver_id"])

    if shipment.get("route_type") == "multi-leg":
        legs = [s for s in all_shipments if s and s.get("parent_id") == shipment_id]
        for leg in legs:
            shipments_db.update(leg["id"], {"status": "finalized", "stage": "Finalized"})
            if leg.get("assigned_driver_id"):
                involved_drivers.add(leg["assigned_driver_id"])

    # Update involved drivers stats
    for d_id in involved_drivers:
        drv = drivers_db.get_by_id(d_id)
        if drv:
            # Increment total trips and add reward points
            new_trips = drv.get("total_trips", 0) + 1
            new_points = drv.get("reward_points", 0) + 100
            drivers_db.update(d_id, {
                "total_trips": new_trips,
                "reward_points": new_points
            })

    return {"message": "Shipment fully finalized. All involved drivers updated with trip history and rewards."}

@router.post("/finance/confirm-payment/{shipment_id}")
def confirm_customer_payment(shipment_id: str, x_logistix_context: Optional[str] = Header(None)):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    verify_context(shipment.get("company_id"), x_logistix_context)
    
    shipments_db.update(shipment_id, {"payment_status": "paid"})
    
    # Cascade payment status to all related legs
    all_ships = shipments_db.get_all()
    for s in all_ships:
        if s and s.get("parent_id") == shipment_id:
            shipments_db.update(s["id"], {"payment_status": "paid"})
    
    # Log to ledger
    revenue_amt = shipment.get("finance", {}).get("suggested_price", 0)
    if revenue_amt <= 0:
        revenue_amt = 500.0 # Fallback for legacy/mock data
        
    ledger_db.insert({
        "type": "REVENUE",
        "desc": f"Payment Recieved for Shipment {shipment_id[:8]}",
        "amount": revenue_amt,
        "timestamp": datetime.utcnow().isoformat(),
        "company_id": shipment.get("company_id")
    })
    return {"message": "Payment confirmed. Driver is now cleared for OTP delivery."}

@router.post("/finance/approve-payout/{driver_id}")
def approve_driver_payout(driver_id: str, x_logistix_context: Optional[str] = Header(None)):
    driver = drivers_db.get_by_id(driver_id)
    if not driver: raise HTTPException(status_code=404, detail="Driver not found")
    
    verify_context(driver.get("company_id"), x_logistix_context)
    
    balance = driver.get("wallet_balance", 0)
    if balance <= 0: raise HTTPException(status_code=400, detail="Zero balance")
    
    # Reset driver balance
    drivers_db.update(driver_id, {"wallet_balance": 0})
    
    # Deduct from company profit
    cid = driver.get("company_id")
    company = companies_db.get_by_id(cid)
    if company:
        companies_db.update(cid, {"total_profit": company.get("total_profit", 0) - balance})

    # Log to ledger
    ledger_db.insert({
        "id": str(uuid.uuid4()),
        "company_id": cid,
        "type": "EXPENSE",
        "desc": f"Payout Settled: {driver['name']}",
        "amount": balance,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    })
    
    return {"message": "Payout approved and deducted from profit"}


@router.get("/finance/p-and-l")
def get_p_and_l(company_id: str):
    all_txs = ledger_db.get_all()
    comp_txs = [t for t in all_txs if t.get("company_id") == company_id]
    
    revenue = sum(float(t.get("amount", 0)) for t in comp_txs if t.get("type") == "REVENUE")
    expenses = sum(float(t.get("amount", 0)) for t in comp_txs if t.get("type") == "EXPENSE")
    
    return {
        "total_revenue": round(revenue, 2),
        "total_expenses": round(expenses, 2),
        "net_profit": round(revenue - expenses, 2),
        "margin_percentage": round((revenue - expenses) / revenue * 100, 1) if revenue > 0 else 0
    }

@router.get("/strategy/forecast")
def get_strategy_forecast(company_id: str):
    from backend.services.strategy_engine import predict_monthly_revenue
    # Calculate current month revenue from ledger
    all_txs = ledger_db.get_all()
    this_month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    current_rev = sum(t["amount"] for t in all_txs if t.get("company_id") == company_id and t["type"] == "REVENUE" and datetime.fromisoformat(t["timestamp"]) >= this_month_start)
    
    forecast = predict_monthly_revenue(current_rev)
    return forecast

@router.get("/finance/fund-requests")
def get_fund_requests(company_id: str):
    """Return all unresolved driver fund request alerts for a company."""
    alerts_db = JSONDatabase("alerts")
    all_alerts = alerts_db.get_all()
    fund_alerts = [
        a for a in all_alerts
        if a.get("company_id") == company_id
        and a.get("type") == "finance"
        and a.get("status") != "resolved"
        and "FUND REQUEST" in a.get("description", "")
    ]
    results = []
    for a in fund_alerts:
        # Parse amount and type from description: "FUND REQUEST: Driver X requested ₹500 for FUEL."
        import re
        desc = a.get("description", "")
        amount_match = re.search(r"₹([\d.]+)", desc)
        type_match = re.search(r"for ([A-Z]+)", desc)
        driver_name_match = re.search(r"Driver (.+?) requested", desc)
        dist_match = re.search(r"Leg Distance: ([\d.]+)", desc)
        results.append({
            "alert_id": a.get("id"),
            "driver_id": a.get("driver_id"),
            "driver_name": driver_name_match.group(1) if driver_name_match else "Unknown",
            "amount": float(amount_match.group(1)) if amount_match else 0,
            "fund_type": type_match.group(1) if type_match else "MISC",
            "distance": float(dist_match.group(1)) if dist_match else 0,
            "timestamp": a.get("timestamp"),
        })
    return results

@router.post("/finance/approve-fund-request/{alert_id}")
def approve_fund_request(alert_id: str):
    alerts_db = JSONDatabase("alerts")
    alert = alerts_db.get_by_id(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
        
    desc = alert.get("description", "")
    import re
    amount_match = re.search(r"₹(\d+\.?\d*)", desc)
    amount = float(amount_match.group(1)) if amount_match else 0
    
    driver_id = alert.get("driver_id")
    if not driver_id:
        raise HTTPException(status_code=400, detail="No driver linked to this request")
    
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    # Check fund type to decide if it goes to wallet or is direct operational expense
    is_operational = any(x in desc.upper() for x in ["FUEL", "TOLL"])
    
    if not is_operational:
        # Only non-operational funds (like advances or wages) go to wallet
        new_balance = driver.get("wallet_balance", 0) + amount
        drivers_db.update(driver_id, {
            "wallet_balance": new_balance,
            "total_earnings": driver.get("total_earnings", 0) + amount
        })
    
    # Log as expense in ledger (always deduct from company profit)
    ledger_db.insert({
        "type": "EXPENSE",
        "desc": f"Fund Disbursement: {driver['name']} for {desc.split('for')[-1].strip().upper()}",
        "amount": amount,
        "timestamp": datetime.utcnow().isoformat(),
        "company_id": alert.get("company_id")
    })
    
    # Mark alert as resolved
    alerts_db.update(alert_id, {"status": "resolved"})
    
    return {"message": f"₹{amount} transferred to {driver['name']}'s wallet successfully."}

@router.post("/finance/reject-fund-request/{alert_id}")
def reject_fund_request(alert_id: str):
    alerts_db = JSONDatabase("alerts")
    alert = alerts_db.get_by_id(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    # Just mark as resolved without doing anything else
    alerts_db.update(alert_id, {"status": "resolved", "rejection_note": "Denied by Manager"})
    
    return {"message": "Fund request rejected."}

@router.get("/merge-suggestions")
def get_merge_suggestions(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    from backend.services.route_engine import haversine
    from collections import defaultdict
    
    all_shipments = shipments_db.get_all()
    # Active = pending or assigned but not in_transit/delivered
    active = [s for s in all_shipments if s.get("company_id") == company_id and s.get("status") in ["pending", "assigned"]]
    
    suggestions = []
    processed_ids = set()

    # 1. CLUSTER BY HUB (Middle Mile Efficiency)
    # Group shipments going to the same warehouse hub
    hub_groups = defaultdict(list)
    for s in active:
        if s.get("drop_warehouse_id"):
            hub_groups[s["drop_warehouse_id"]].append(s)
            
    for wh_id, ships in hub_groups.items():
        if len(ships) > 1:
            total_weight = sum(s.get("weight", 0) for s in ships)
            wh = warehouses_db.get_by_id(wh_id)
            wh_name = wh.get("name", "Strategic Hub") if wh else "Strategic Hub"
            
            # Sub-divide into weight clusters (max 5000kg per truck)
            current_cluster = []
            current_weight = 0
            for s in ships:
                if current_weight + s.get("weight", 0) > 5000:
                    if len(current_cluster) > 1:
                        suggestions.append({
                            "type": "hub_transit",
                            "reason": f"Shared Middle-Mile Hub: {wh_name}",
                            "hub_id": wh_id,
                            "shipment_ids": [sc["id"] for sc in current_cluster],
                            "total_weight": current_weight,
                            "count": len(current_cluster)
                        })
                    current_cluster = [s]
                    current_weight = s.get("weight", 0)
                else:
                    current_cluster.append(s)
                    current_weight += s.get("weight", 0)
            
            if len(current_cluster) > 1:
                suggestions.append({
                    "type": "hub_transit",
                    "reason": f"Shared Middle-Mile Hub: {wh_name}",
                    "hub_id": wh_id,
                    "shipment_ids": [sc["id"] for sc in current_cluster],
                    "total_weight": current_weight,
                    "count": len(current_cluster)
                })

    # 2. CLUSTER BY PROXIMITY (Direct/First-Mile Efficiency)
    # Find shipments with nearby pickups AND nearby drops
    for i in range(len(active)):
        s1 = active[i]
        if s1["id"] in processed_ids: continue
        
        cluster = [s1]
        for j in range(i + 1, len(active)):
            s2 = active[j]
            if s2["id"] in processed_ids: continue
            
            p_dist = haversine(s1["pickup"]["lat"], s1["pickup"]["lng"], s2["pickup"]["lat"], s2["pickup"]["lng"])
            d_dist = haversine(s1["drop"]["lat"], s1["drop"]["lng"], s2["drop"]["lat"], s2["drop"]["lng"])
            
            if p_dist < 10 and d_dist < 15:
                cluster.append(s2)
        
        if len(cluster) > 1:
            total_weight = sum(sc.get("weight", 0) for sc in cluster)
            if total_weight <= 5000:
                suggestions.append({
                    "type": "proximity",
                    "reason": "Geospatial Alignment (Nearby Pickup & Drop)",
                    "shipment_ids": [sc["id"] for sc in cluster],
                    "total_weight": total_weight,
                    "count": len(cluster)
                })
                for sc in cluster: processed_ids.add(sc["id"])

    # Deduplicate and prioritize hub-based merges
    return {"suggestions": suggestions}

@router.post("/approve-merge")
def approve_merge(data: dict, x_logistix_context: Optional[str] = Header(None)):
    company_id = data.get("company_id")
    verify_context(company_id, x_logistix_context)
    shipment_ids = data.get("shipment_ids", [])
    
    if not shipment_ids:
        raise HTTPException(status_code=400, detail="Missing shipment_ids")
        
    # Calculate total weight for vehicle selection
    all_active_ships = [shipments_db.get_by_id(sid) for sid in shipment_ids]
    all_active_ships = [s for s in all_active_ships if s]
    total_weight = sum(s.get("weight", 0) for s in all_active_ships)

    # Find a truck that can handle the total weight
    # Large Truck > 1000kg, Small Truck for less
    v_type_pref = "Truck (Heavy)" if total_weight > 500 else "Truck (Small)"
    
    vehicles = [v for v in vehicles_db.get_all() if v.get("company_id") == company_id and v.get("status") in ["available", "assigned"]]
    
    # Prioritize the preferred type
    best_vehicle = next((v for v in vehicles if v.get("type") == v_type_pref and v.get("assigned_driver_id")), None)
    if not best_vehicle:
        # Fallback to any truck
        best_vehicle = next((v for v in vehicles if "Truck" in v.get("type", "") and v.get("assigned_driver_id")), None)
    
    if not best_vehicle:
        raise HTTPException(status_code=400, detail="No suitable trucks with assigned drivers found to handle the merged load.")
        
    driver_id = best_vehicle.get("assigned_driver_id")
    vehicles_db.update(best_vehicle["id"], {"status": "in_transit"})
    
    for sid in shipment_ids:
        s = next((ship for ship in all_active_ships if ship["id"] == sid), None)
        if s:
            logs = s.get("logs", [])
            logs.append({
                "status": "assigned",
                "message": f"MERGED: Consolidated onto {best_vehicle['type']} ({best_vehicle['number_plate']}) for efficiency.",
                "reason": "AI-suggested cluster merge approved by Manager.",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            })
            shipments_db.update(sid, {
                "assigned_driver_id": driver_id,
                "assigned_vehicle_id": best_vehicle["id"],
                "status": "assigned",
                "stage": "Consolidated Transit",
                "logs": logs
            })
            
    # Blockchain record for Merge
    import hashlib
    tx_hash_data = f"MERGE-{'-'.join(shipment_ids)}-{best_vehicle['id']}-{datetime.utcnow().isoformat()}"
    tx_hash = hashlib.sha256(tx_hash_data.encode()).hexdigest()
    
    ledger_db.insert({
        "id": f"TX-{uuid.uuid4().hex[:8]}",
        "company_id": company_id,
        "type": "BLOCKCHAIN_MERGE",
        "desc": f"Immutable Proof of Route Merge for {len(shipment_ids)} shipments onto {best_vehicle['number_plate']}",
        "hash": tx_hash,
        "amount": 0,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    })
            
    return {"message": f"Successfully merged {len(shipment_ids)} shipments onto {best_vehicle['number_plate']} ({best_vehicle['type']}). Blockchain record created.", "tx_hash": tx_hash}

# Warehouse Leave Requests
@router.post("/warehouses/leave-request")
def request_warehouse_leave(req: WarehouseLeaveRequest):
    return leave_requests_db.insert(req.model_dump())

@router.get("/warehouses/leave-requests")
def get_warehouse_leave_requests(company_id: str, warehouse_id: Optional[str] = None):
    all_reqs = leave_requests_db.get_filtered({"company_id": company_id})
    if warehouse_id:
        return [r for r in all_reqs if r.get("warehouse_id") == warehouse_id]
    return all_reqs

@router.put("/warehouses/leave-requests/{req_id}/status")
def update_leave_status(req_id: str, status: str):
    req = leave_requests_db.get_by_id(req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    req["status"] = status
    leave_requests_db.update(req_id, {"status": status})
    return {"message": f"Request {status}"}
