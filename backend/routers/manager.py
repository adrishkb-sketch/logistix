from fastapi import APIRouter, HTTPException, UploadFile, File, Header
from backend.models import Driver, Vehicle, Drone, Warehouse, Shipment, ShipmentEvent, Location
from backend.database import JSONDatabase
from backend.services.turso_db import TursoCompaniesDB, TursoGenericDB
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel
import uuid
import random
import re
import math
import json
from backend.services.auth_utils import verify_context
from backend.services.water_check import is_location_in_water

router = APIRouter()
companies_db = TursoCompaniesDB()          # ← Turso (persistent on Vercel)
drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")
warehouses_db = TursoGenericDB("warehouses")  # ← Turso: persists across Vercel invocations
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
    return {"message": "Finances are locked once calculated and cannot be recalculated."}



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

    from backend.services.driver_intel import calculate_driver_performance_score, calculate_safety_rating
    driver_data = driver.model_dump()
    
    # Calculate safety score based on accidents & experience
    safety_rating = calculate_safety_rating(driver_data)
    driver_data["safety_rating"] = safety_rating
    driver_data["safety_index"] = round((safety_rating / 5.0) * 100.0, 1)
    
    driver_data["rating"] = 5.0
    driver_data["total_rating_sum"] = 0.0
    driver_data["rating_count"] = 0
    
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
    # Block warehouses in water bodies (oceans, lakes, rivers, etc.)
    if is_location_in_water(warehouse.lat, warehouse.lng):
        raise HTTPException(
            status_code=400,
            detail="Warehouse cannot be created in a water body. Please choose a valid land location."
        )
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


@router.get("/warehouses/congestion")
def get_warehouses_congestion(company_id: Optional[str] = None, x_logistix_context: Optional[str] = Header(None)):
    target_company = company_id or x_logistix_context
    if not target_company:
        raise HTTPException(status_code=400, detail="Missing company context")
        
    verify_context(target_company, x_logistix_context)
    
    # Fetch warehouses and active shipments/legs
    warehouses = warehouses_db.get_filtered({"company_id": target_company})
    all_shipments = shipments_db.get_all()
    my_shipments = [s for s in all_shipments if s and s.get("company_id") == target_company]
    
    active_shipments = [
        s for s in my_shipments
        if s.get("status") in ["pending", "assigned", "in_transit"]
    ]
    
    results = []
    current_time = datetime.utcnow()
    
    for w in warehouses:
        w_id = w.get("id")
        drone_count = w.get("drone_count") or 0
        capacity = int(w.get("capacity", 5)) + drone_count
        
        # Inbound shipments: heading to this warehouse (drop_warehouse_id matches)
        incoming_ships = [
            s for s in active_shipments
            if s.get("drop_warehouse_id") == w_id
        ]
        
        incoming_count = len(incoming_ships)
        congestion_percentage = min(100.0, (incoming_count / capacity) * 100.0) if capacity > 0 else 0.0
        
        # Diurnal load forecast for next 24 hours
        forecast = []
        for hour_offset in range(24):
            future_time = current_time + timedelta(hours=hour_offset)
            hour_of_day = future_time.hour
            
            # Sine wave diurnal baseline: peaks around 18:00 (6 PM)
            sine_val = math.sin((hour_of_day - 12) * math.pi / 12)
            base_load = capacity * (0.4 + 0.3 * sine_val)
            
            # Add active shipments expected to arrive in this specific hour slot
            eta_contribution = 0
            for s in incoming_ships:
                expected_del_str = s.get("expected_delivery") or s.get("created_at")
                if expected_del_str:
                    try:
                        cleaned_dt = expected_del_str.replace("Z", "")
                        if "+" in cleaned_dt:
                            cleaned_dt = cleaned_dt.split("+")[0]
                        eta_dt = datetime.fromisoformat(cleaned_dt)
                        time_diff = eta_dt - current_time
                        diff_hours = time_diff.total_seconds() / 3600.0
                        if hour_offset <= diff_hours < hour_offset + 1:
                            eta_contribution += 1.2
                    except Exception:
                        pass
            
            predicted_load = max(0.0, base_load + eta_contribution)
            predicted_load = min(predicted_load, capacity * 1.5)
            predicted_congestion = min(100.0, (predicted_load / capacity) * 100.0) if capacity > 0 else 0.0
            
            forecast.append({
                "hour": future_time.strftime("%I %p"),
                "predicted_load": round(predicted_load, 1),
                "predicted_congestion": round(predicted_congestion, 1)
            })
            
        needs_mitigation = congestion_percentage > 90.0
        mitigation_advice = ""
        if needs_mitigation:
            other_whs = [other for other in warehouses if other.get("id") != w_id]
            if other_whs:
                def get_dist(lat1, lon1, lat2, lon2):
                    return math.sqrt((lat1 - lat2)**2 + (lon1 - lon2)**2)
                
                other_whs_sorted = sorted(
                    other_whs,
                    key=lambda x: get_dist(w.get("lat", 0), w.get("lng", 0), x.get("lat", 0), x.get("lng", 0))
                )
                nearest_wh = other_whs_sorted[0]
                mitigation_advice = f"WARNING: High Congestion. Re-route middle-mile segments to {nearest_wh.get('name')}."
            else:
                mitigation_advice = "WARNING: High Congestion. Hold dispatches or request fleet expansion."
                
        results.append({
            **w,
            "warehouse_id": w_id,
            "warehouse_name": w.get("name"),
            "capacity": capacity,
            "incoming_count": incoming_count,
            "congestion_percentage": round(congestion_percentage, 1),
            "forecast": forecast,
            "needs_mitigation": needs_mitigation,
            "mitigation_advice": mitigation_advice
        })
        
    return results




@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str):
    alerts_db.update(alert_id, {"status": "resolved"})
    return {"message": "Alert resolved"}

@router.post("/warehouses/suggest")
def suggest_warehouse_location(data: dict):
    lat = data.get("lat")
    lng = data.get("lng")
    company_id = data.get("company_id")
    
    from backend.services.water_check import is_location_in_water
    if is_location_in_water(lat, lng):
        raise HTTPException(
            status_code=400,
            detail="Cannot suggest a location in a water body. Please select a land area."
        )
    
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

    # 6. 7-day volume_data (real shipment counts per day)
    from datetime import datetime, timedelta, timezone
    today = datetime.now(timezone.utc).date()
    volume_data = []
    co2_trend = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        day_ships = [
            s for s in shipments
            if s.get("created_at") and s["created_at"][:10] == str(day)
        ]
        volume_data.append(len(day_ships))
        # CO2 estimate for that day's shipments
        day_co2 = 0.0
        for ds in day_ships:
            dist = 200.0  # default estimate km
            weight = float(ds.get("weight") or 10.0)
            vtype = (ds.get("vehicle_type") or "truck").lower()
            factor = {"truck": 0.27, "van": 0.18, "bike": 0.06, "drone": 0.02}.get(vtype, 0.20)
            day_co2 += weight * dist * factor / 1000.0  # kg CO2
        co2_trend.append(round(day_co2, 2))

    total_dist = 0.0
    total_co2 = 0.0
    for s in shipments:
        dist = 200.0  # default estimate km
        weight = float(s.get("weight") or 10.0)
        vtype = (s.get("vehicle_type") or "truck").lower()
        factor = {"truck": 0.27, "van": 0.18, "bike": 0.06, "drone": 0.02}.get(vtype, 0.20)
        day_co2 = weight * dist * factor / 1000.0
        total_dist += dist
        total_co2 += day_co2
    avg_co2_per_km = (total_co2 / total_dist) if total_dist > 0 else 0.0

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
        "perf_history": [random.randint(85, 100) for _ in range(7)],
        "volume_data": volume_data,
        "co2_trend": co2_trend,
        "avg_co2_per_km": round(avg_co2_per_km, 3),
    }

@router.get("/analytics/esg")
def get_analytics_esg(company_id: Optional[str] = None, x_logistix_context: Optional[str] = Header(None)):
    target_company = company_id or x_logistix_context
    if not target_company:
        raise HTTPException(status_code=400, detail="Missing company context")
    verify_context(target_company, x_logistix_context)

    all_shipments = shipments_db.get_all()
    my_shipments = [s for s in all_shipments if s and s.get("company_id") == target_company]
    delivered_ships = [s for s in my_shipments if s.get("status") == "delivered"]
    
    total_delivered = len(delivered_ships)
    base_co2 = 0.0
    eco_co2 = 0.0
    fuel_saved = 0.0
    
    for s in delivered_ships:
        w = s.get("weight") or 10.0
        dist = 15.0 + (w * 0.5)
        s_co2 = w * dist * 0.15
        e_co2 = w * dist * 0.11
        
        base_co2 += s_co2
        eco_co2 += e_co2
        fuel_saved += (s_co2 - e_co2) / 2.6

    if total_delivered == 0:
        base_co2 = 1450.0
        eco_co2 = 1015.0
        fuel_saved = 167.3
        total_delivered = 14
        
    offsets_accumulated = base_co2 - eco_co2
    green_fleet_pct = 35.0 + (total_delivered % 15)
    
    import hashlib
    data_str = f"{target_company}-{offsets_accumulated}-{fuel_saved}"
    esg_hash = hashlib.sha256(data_str.encode()).hexdigest()
    
    standard_coords = [
        [22.57264, 88.36389],
        [22.5835, 88.3842],
        [22.5950, 88.4120],
        [22.6105, 88.4325]
    ]
    eco_coords = [
        [22.57264, 88.36389],
        [22.5610, 88.3812],
        [22.5822, 88.4045],
        [22.6001, 88.4210],
        [22.6105, 88.4325]
    ]
    
    return {
        "base_co2_kg": round(base_co2, 1),
        "eco_co2_kg": round(eco_co2, 1),
        "offsets_accumulated_kg": round(offsets_accumulated, 1),
        "fuel_saved_liters": round(fuel_saved, 1),
        "green_fleet_pct": round(green_fleet_pct, 1),
        "cryptographic_hash": esg_hash,
        "standard_route": standard_coords,
        "eco_route": eco_coords
    }

@router.get("/analytics/cascade")
def get_cascading_impact(company_id: str, x_logistix_context: Optional[str] = Header(None), x_gemini_api_key: Optional[str] = Header(None)):
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
        
    # Preemptive AI Disruption Risk and Resilient Mitigation Strategy
    from backend.services.gemini_service import call_gemini
    from backend.services.route_engine import predict_weather_impact, simulate_traffic
    
    at_risk_list = []
    for s in my_ships:
        if s.get("status") not in ["assigned", "in_transit", "delayed"]:
            continue
            
        driver_id = s.get("assigned_driver_id")
        driver = drivers_db.get_by_id(driver_id) if driver_id else None
        fatigue = driver.get("fatigue_score", 0.0) if driver else 0.0
        
        vehicle_id = s.get("assigned_vehicle_id")
        vehicle = vehicles_db.get_by_id(vehicle_id) if vehicle_id else None
        v_health = vehicle.get("vehicle_health_score", 100.0) if vehicle else 100.0
        
        curr_loc = s.get("current_location") or s.get("pickup") or {}
        lat = curr_loc.get("lat", 0.0)
        lng = curr_loc.get("lng", 0.0)
        weather = predict_weather_impact(lat, lng) if lat else {"condition": "Clear"}
        traffic = simulate_traffic(lat, lng) if lat else {"level": "Light"}
        
        delay_mins = (s.get("performance_stats") or {}).get("diff_mins", 0)
        
        is_risky = (
            delay_mins > 30 or 
            fatigue > 50 or 
            v_health < 80 or 
            weather.get("condition") in ["Rain", "Storm"]
        )
        
        if is_risky:
            at_risk_list.append({
                "id": s.get("id", ""),
                "description": s.get("description", "Unnamed Shipment"),
                "pickup": (s.get("pickup") or {}).get("address", "Start"),
                "drop": (s.get("drop") or {}).get("address", "End"),
                "delay_mins": delay_mins,
                "fatigue": fatigue,
                "vehicle_health": v_health,
                "weather": weather.get("condition", "Clear"),
                "traffic": traffic.get("level", "Light")
            })
            
    if at_risk_list:
        system_instruction = (
            "You are Logistix AI, a state-of-the-art logistics and supply chain resilience engine. "
            "Your goal is to preemptively identify risk cascades and provide precise, actionable, and highly optimized "
            "mitigation recommendations for a logistics manager in India. "
            "Provide clear, structured, and professional action items. Format using markdown. "
            "Keep it concise (maximum 3 bullet points, under 150 words total) to fit the UI widget."
        )
        prompt = "Analyze the following active shipments at risk of disruption and provide a resilience mitigation plan:\n"
        for item in at_risk_list[:5]:  # Limit to 5 for prompt size and efficiency
            prompt += (
                f"- Shipment {item['id'][:8]} ({item['description']}): "
                f"Route {item['pickup']} -> {item['drop']}. "
                f"Delay: {item['delay_mins']}m. "
                f"Driver fatigue: {item['fatigue']}. "
                f"Vehicle health: {item['vehicle_health']}. "
                f"Weather: {item['weather']}. "
                f"Traffic: {item['traffic']}.\n"
            )
        api_keys = None
        if company_id:
            from backend.database import JSONDatabase
            cfg = JSONDatabase("config").get_by_id(company_id)
            if cfg:
                api_keys = cfg.get("gemini_keys")
        try:
            recommendation = call_gemini(prompt, system_instruction, api_key=api_keys)
        except ValueError as e:
            recommendation = f"Mitigation advice unavailable: {str(e)}"
    else:
        recommendation = "System stable. No immediate mitigation required."
        
    return {
        "active_risk_count": len(risks),
        "total_impact_hours": round(total_impact_hours, 1),
        "risks": risks,
        "recommendation": recommendation
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

class LinkVehicleRequest(BaseModel):
    driver_id: str
    vehicle_id: str

@router.post("/link-vehicle")
def link_driver_to_vehicle(
    req: Optional[LinkVehicleRequest] = None,
    driver_id: Optional[str] = None,
    vehicle_id: Optional[str] = None
):
    d_id = driver_id
    v_id = vehicle_id
    if req:
        d_id = d_id or req.driver_id
        v_id = v_id or req.vehicle_id
        
    if not d_id or not v_id:
        raise HTTPException(status_code=400, detail="driver_id and vehicle_id are required")
        
    driver = drivers_db.get_by_id(d_id)
    vehicle = vehicles_db.get_by_id(v_id)
    
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
    drivers_db.update(d_id, {"assigned_vehicle_id": v_id, "verification_status": "unverified"})
    vehicles_db.update(v_id, {"assigned_driver_id": d_id})
    
    return {"message": "Linked successfully"}

def is_valid_matching_value(val) -> bool:
    if not val:
        return False
    s = str(val).strip()
    return s.lower() not in ["", "unknown", "none", "n/a", "null", "undefined"]

@router.post("/auto-assign-fleet")
def auto_assign_fleet(company_id: str):
    """
    Auto-pair unlinked drivers and vehicles.
    Matching rules (both must be true):
      1. Same base_warehouse_id
      2. Vehicle type == Driver license_type  (strict exact string match)
    If no vehicle matches a driver exactly, the driver is left unlinked.
    """
    all_drivers  = drivers_db.get_all()
    all_vehicles = vehicles_db.get_all()

    # Only consider truly unlinked items for this company
    unlinked_drivers  = [d for d in all_drivers  if d and d.get("company_id") == company_id and not d.get("assigned_vehicle_id")]
    unlinked_vehicles = [v for v in all_vehicles if v and v.get("company_id") == company_id and not v.get("assigned_driver_id")]

    # Build a pool index: (hub_id, type) -> list of vehicles  for O(1) lookup
    pool: dict = {}
    for v in unlinked_vehicles:
        hub = v.get("base_warehouse_id")
        vtype = v.get("type")
        if not is_valid_matching_value(hub) or not is_valid_matching_value(vtype):
            continue
        key = (str(hub).strip(), str(vtype).strip())
        pool.setdefault(key, []).append(v)

    # Track which records were mutated so we can do targeted DB writes
    driver_updates:  list = []   # (driver_id, {fields})
    vehicle_updates: list = []   # (vehicle_id, {fields})
    assigned_count = 0

    for d in unlinked_drivers:
        hub = d.get("base_warehouse_id")
        dtype = d.get("license_type")
        if not is_valid_matching_value(hub) or not is_valid_matching_value(dtype):
            continue
        key = (str(hub).strip(), str(dtype).strip())

        candidates = pool.get(key, [])
        if not candidates:
            continue  # No exact match — leave driver unlinked

        match = candidates.pop(0)   # Take first available vehicle
        if not candidates:
            pool.pop(key, None)     # Clean up empty slot

        # Record updates (do NOT write to DB inside the loop)
        driver_updates.append((d["id"],       {"assigned_vehicle_id": match["id"], "verification_status": "unverified"}))
        vehicle_updates.append((match["id"],  {"assigned_driver_id":  d["id"]}))
        assigned_count += 1

    # Flush all changes to DB in batch (extremely fast and safe for Turso + large datasets)
    drivers_db.update_many(driver_updates)
    vehicles_db.update_many(vehicle_updates)

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

@router.post("/unlink-idle-fleet")
def unlink_idle_fleet(company_id: str):
    """
    Unlink drivers and vehicles that are NOT currently assigned to an active shipment.
    Targeted updates: we only mutate the specific drivers and vehicles that changed.
    """
    # ── Batch read ──────────────────────────────────────────────────────────
    all_shipments = shipments_db.get_all()
    all_drivers   = drivers_db.get_all()
    all_vehicles  = vehicles_db.get_all()

    active_shipments = [
        s for s in all_shipments
        if s and s.get("company_id") == company_id
        and s.get("status") not in ["delivered", "cancelled"]
    ]
    active_driver_ids  = {s.get("assigned_driver_id")  for s in active_shipments if s.get("assigned_driver_id")}
    active_vehicle_ids = {s.get("assigned_vehicle_id") for s in active_shipments if s.get("assigned_vehicle_id")}

    driver_updates = []
    vehicle_updates = []
    unlinked_drivers  = 0
    unlinked_vehicles = 0

    # ── Identify idle drivers ────────────────────────────────────────
    for d in all_drivers:
        if not d or d.get("company_id") != company_id:
            continue
        v_id = d.get("assigned_vehicle_id")
        if not v_id:
            continue  # already unlinked
        
        # If driver is not in active shipments and their vehicle is not active
        if d["id"] not in active_driver_ids and v_id not in active_vehicle_ids:
            driver_updates.append((d["id"], {"assigned_vehicle_id": None, "verification_status": "unverified"}))
            unlinked_drivers += 1

    # ── Identify idle vehicles ───────────────────────────────────────
    for v in all_vehicles:
        if not v or v.get("company_id") != company_id:
            continue
        d_id = v.get("assigned_driver_id")
        if not d_id:
            continue  # already unlinked
            
        # If vehicle is not in active shipments and its driver is not active
        if v["id"] not in active_vehicle_ids and d_id not in active_driver_ids:
            vehicle_updates.append((v["id"], {"assigned_driver_id": None}))
            unlinked_vehicles += 1

    # ── Targeted updates in batch (extremely fast, no bulk deletes/writes) ──
    drivers_db.update_many(driver_updates)
    vehicles_db.update_many(vehicle_updates)

    return {
        "message": f"Successfully unlinked {unlinked_drivers} drivers and {unlinked_vehicles} vehicles that were idle."
    }

@router.post("/verify-driver/{driver_id}")
def manual_verify_driver(driver_id: str, status: str, vehicle_id: Optional[str] = None):
    if status not in ["verified", "unverified"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    update_data = {"verification_status": status}
    if status == "verified" and vehicle_id:
        vehicle = vehicles_db.get_by_id(vehicle_id)
        if not vehicle:
            raise HTTPException(status_code=404, detail="Vehicle not found")
            
        # Compatibility Validation
        if driver.get("license_type") != vehicle.get("type"):
            raise HTTPException(status_code=400, detail=f"License mismatch: {driver['name']} has {driver['license_type']} license, cannot drive {vehicle['type']}.")
        
        if driver.get("base_warehouse_id") != vehicle.get("base_warehouse_id"):
            raise HTTPException(status_code=400, detail="Warehouse mismatch: Driver and Vehicle must belong to the same base hub.")
            
        # Check if vehicle is already assigned
        all_drivers = drivers_db.get_all()
        if any(d and d.get("assigned_vehicle_id") == vehicle_id and d.get("id") != driver_id for d in all_drivers):
            raise HTTPException(status_code=400, detail="This vehicle is already assigned to another driver.")
            
        # Unlink any existing
        if vehicle.get("assigned_driver_id"):
            drivers_db.update(vehicle["assigned_driver_id"], {"assigned_vehicle_id": None})
        if driver.get("assigned_vehicle_id"):
            vehicles_db.update(driver["assigned_vehicle_id"], {"assigned_driver_id": None})
            
        # Link in vehicles table
        vehicles_db.update(vehicle_id, {"assigned_driver_id": driver_id})
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
            v["kilometers_covered"] = v.get("total_distance_km", 0.0)
            v["total_deliveries"] = v.get("deliveries_completed", 0)
            processed.append(v)
            
        key_map = {
            "overall": "efficiency_score",
            "vehicle_health_score": "vehicle_health_score",
            "fuel_efficiency": "fuel_efficiency",
            "distance": "total_distance_km",
            "deliveries": "total_deliveries",
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
    
    # Recalculate finance based on assigned rescue vehicle
    try:
        from backend.routers.shipment import update_shipment_finance_post_assignment
        update_shipment_finance_post_assignment(shipment_id)
    except Exception as fe:
        print(f"Finance recalculation error in rescue_shipment: {fe}")
        
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

@router.post("/vehicles/{vehicle_id}/approve-checkup")
def approve_checkup(vehicle_id: str, x_logistix_context: Optional[str] = Header(None)):
    vehicle = vehicles_db.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
        
    if x_logistix_context:
        # If context matches warehouse ID, verify this vehicle belongs to it
        from backend.database import JSONDatabase
        wh = JSONDatabase("warehouses").get_by_id(x_logistix_context)
        if wh:
            if vehicle.get("base_warehouse_id") != x_logistix_context:
                raise HTTPException(status_code=403, detail="Permission Denied: This vehicle is not based at your warehouse.")
                
    curr_dist = vehicle.get("total_distance_km", 0.0)
    vehicles_db.update(vehicle_id, {
        "last_service_km": curr_dist,
        "vehicle_health_score": 100.0,
        "checkup_status": "none"
    })
    
    # Resolve pending maintenance alerts for this vehicle
    alerts_db = JSONDatabase("alerts")
    d_id = vehicle.get("assigned_driver_id")
    if d_id:
        driver_alerts = alerts_db.get_filtered({"driver_id": d_id, "type": "maintenance"})
        for a in driver_alerts:
            alerts_db.update(a["id"], {"status": "resolved"})
            
    return {"message": "Vehicle checkup approved. Health restored to 100%.", "vehicle_health_score": 100.0}

# Gemini API Key Database Settings Endpoints
@router.get("/system/get-gemini-keys")
def get_gemini_keys(x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context)
    if not company_id:
        raise HTTPException(status_code=401, detail="Unauthorized: Context missing")
    
    from backend.database import JSONDatabase
    config_db = JSONDatabase("config")
    cfg = config_db.get_by_id(company_id)
    if cfg and cfg.get("gemini_keys"):
        keys = [k.strip() for k in cfg.get("gemini_keys").split(",") if k.strip()]
        masked = [f"{k[:6]}...{k[-4:]}" if len(k) > 10 else "invalid" for k in keys]
        return {"key_count": len(keys), "masked_keys": masked}
    return {"key_count": 0, "masked_keys": []}

class SaveGeminiKeysRequest(BaseModel):
    keys: str   # single key or comma-separated
    mode: str = "append"  # 'append' | 'replace'

@router.post("/system/save-gemini-keys")
def save_gemini_keys(data: SaveGeminiKeysRequest, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context)
    if not company_id:
        raise HTTPException(status_code=401, detail="Unauthorized: Context missing")
    
    # Parse incoming keys
    new_keys = [k.strip() for k in data.keys.split(",") if k.strip()]
    if not new_keys:
        raise HTTPException(status_code=400, detail="No valid keys provided")
        
    from backend.database import JSONDatabase
    config_db = JSONDatabase("config")
    
    if data.mode == "append":
        cfg = config_db.get_by_id(company_id)
        existing = []
        if cfg and cfg.get("gemini_keys"):
            existing = [k.strip() for k in cfg.get("gemini_keys").split(",") if k.strip()]
        combined = existing + [k for k in new_keys if k not in existing]
        keys_str = ",".join(combined)
    else:
        keys_str = ",".join(new_keys)
    
    config_db.insert({"id": company_id, "gemini_keys": keys_str})
    count = len(keys_str.split(","))
    return {"message": f"✅ Key added! Pool now has {count} key(s)."}

class DeleteGeminiKeyRequest(BaseModel):
    index: int

@router.post("/system/delete-gemini-key")
def delete_gemini_key(data: DeleteGeminiKeyRequest, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context)
    if not company_id:
        raise HTTPException(status_code=401, detail="Unauthorized: Context missing")
    
    from backend.database import JSONDatabase
    config_db = JSONDatabase("config")
    cfg = config_db.get_by_id(company_id)
    if not cfg or not cfg.get("gemini_keys"):
        raise HTTPException(status_code=404, detail="No keys configured")
    
    keys = [k.strip() for k in cfg.get("gemini_keys").split(",") if k.strip()]
    if data.index < 0 or data.index >= len(keys):
        raise HTTPException(status_code=400, detail="Invalid key index")
    
    keys.pop(data.index)
    if keys:
        config_db.insert({"id": company_id, "gemini_keys": ",".join(keys)})
    else:
        # No keys left — clear the entry
        config_db.delete(company_id)
    return {"message": f"Key removed. {len(keys)} key(s) remaining."}

@router.post("/system/clear-gemini-keys")
def clear_gemini_keys(x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context)
    if not company_id:
        raise HTTPException(status_code=401, detail="Unauthorized: Context missing")
        
    from backend.database import JSONDatabase
    config_db = JSONDatabase("config")
    config_db.delete(company_id)
    return {"message": "Gemini API Keys cleared successfully"}

@router.get("/ai/status")
def get_ai_status(x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context)
    if not company_id:
        return {"configured": False, "status": "No Context", "key_count": 0}
        
    from backend.database import JSONDatabase
    config_db = JSONDatabase("config")
    cfg = config_db.get_by_id(company_id)
    if cfg and cfg.get("gemini_keys"):
        keys = [k.strip() for k in cfg.get("gemini_keys").split(",") if k.strip()]
        if keys:
            masked = [f"{k[:6]}...{k[-4:]}" if len(k) > 10 else "invalid" for k in keys]
            return {
                "configured": True,
                "status": "Connected 🟢",
                "key_count": len(keys),
                "masked_keys": masked
            }
    return {"configured": False, "status": "Not Configured 🔴", "key_count": 0}

# Gemini AI Assistant Router
@router.post("/ai/chat")
def manager_ai_chat(data: dict, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context) or data.get("company_id")
    
    api_keys = None
    if company_id:
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")

    from backend.services.gemini_service import call_gemini
    prompt = data.get("prompt", "")
    role = data.get("role", "manager")
    
    system_instruction = (
        "You are Logistix AI, a senior logistics operations consultant and ESG coordinator. "
        "Provide professional, concise advice to the warehouse manager or driver regarding routes, "
        "safety protocols, carbon footprints, or general fleet operations. Be specific and helpful. "
        "Do not write overly long essays. Use bullet points."
    )
    
    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"response": response_text}

@router.post("/ai/esg-audit")
def manager_esg_audit(data: dict, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context) or data.get("company_id")
    
    api_keys = None
    if company_id:
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")

    from backend.services.gemini_service import call_gemini
    # Fetch current carbon stats, EV fleets, etc.
    from backend.database import JSONDatabase
    vehicles_db = JSONDatabase("vehicles")
    shipments_db = JSONDatabase("shipments")
    
    all_vehicles = vehicles_db.get_filtered({"company_id": company_id})
    all_ships = shipments_db.get_filtered({"company_id": company_id})
    
    total_vehicles = len(all_vehicles)
    ev_vehicles = len([v for v in all_vehicles if "ev" in v.get("type", "").lower() or "battery" in v.get("type", "").lower() or "drone" in v.get("type", "").lower()])
    total_ships = len(all_ships)
    perishables = len([s for s in all_ships if s.get("is_perishable")])
    
    prompt = (
        f"Perform an ESG (Environmental, Social, Governance) audit for a logistics company with the following metrics:\n"
        f"- Total Fleet Size: {total_vehicles} vehicles\n"
        f"- EV & Clean Energy Fleet: {ev_vehicles} vehicles\n"
        f"- Total Shipments Processed: {total_ships}\n"
        f"- Cold Chain (Perishable) Cargo: {perishables}\n\n"
        f"Provide a structured audit report with 'Environmental Impact Rating', 'Key Risks', 'Eco-Efficiency Suggestions', "
        f"and alignment with UN SDGs (Goal 7, 9, 11, 13)."
    )
    
    system_instruction = "You are a professional ESG Strategy Lead. Output a clean markdown audit report."
    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"audit": response_text}

@router.post("/ai/safety-audit")
def manager_safety_audit(data: dict, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context) or data.get("company_id")
    
    api_keys = None
    if company_id:
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")

    from backend.database import JSONDatabase
    drivers_db = JSONDatabase("drivers")
    shipments_db = JSONDatabase("shipments")
    
    all_drivers = drivers_db.get_filtered({"company_id": company_id})
    total_drivers = len(all_drivers)
    high_fatigue = len([d for d in all_drivers if d.get("fatigue_score", 0.0) > 65.0])
    zen_drivers = len([d for d in all_drivers if d.get("is_zen_mode")])
    avg_safety = sum([d.get("driving_score", 100.0) for d in all_drivers]) / total_drivers if total_drivers else 100.0
    
    all_ships = shipments_db.get_filtered({"company_id": company_id})
    incidents_count = 0
    for s in all_ships:
        for log in s.get("logs", []):
            if "ISSUE:" in log.get("message", "") or "BREAKDOWN" in log.get("message", "") or log.get("status") in ["delayed", "safety_halt"]:
                incidents_count += 1
                
    prompt = (
        f"Perform a Safety Audit for a logistics fleet in India with the following telemetry metrics:\n"
        f"- Total Drivers: {total_drivers}\n"
        f"- Average Fleet Safety Score: {avg_safety:.1f}%\n"
        f"- Drivers with Critical Fatigue (>65%): {high_fatigue}\n"
        f"- Active Zen Mode Sessions: {zen_drivers}\n"
        f"- Safety Incidents logged today: {incidents_count}\n\n"
        f"Provide a structured audit report with sections 'Driver Fatigue Analysis', 'Incident Risk Assessment', "
        f"and 'Operational Safety Playbook Recommendations'."
    )
    
    system_instruction = "You are a senior logistics safety auditor in India. Output a professional markdown safety audit report. Keep it under 200 words."
    from backend.services.gemini_service import call_gemini
    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"report": response_text}

@router.post("/ai/wh-readiness")
def manager_wh_readiness(data: dict, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context) or data.get("company_id")
    
    api_keys = None
    if company_id:
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")

    warehouse_id = data.get("warehouse_id")
    
    from backend.database import JSONDatabase
    warehouses_db = JSONDatabase("warehouses")
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    shipments_db = JSONDatabase("shipments")
    
    wh = warehouses_db.get_by_id(warehouse_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
        
    wh_drivers = drivers_db.get_filtered({"base_warehouse_id": warehouse_id})
    wh_vehicles = vehicles_db.get_filtered({"base_warehouse_id": warehouse_id})
    
    total_drivers = len(wh_drivers)
    high_fatigue = len([d for d in wh_drivers if d.get("fatigue_score", 0.0) > 60.0])
    
    total_vehicles = len(wh_vehicles)
    unhealthy_vehicles = len([v for v in wh_vehicles if v.get("vehicle_health_score", 100.0) < 80.0])
    avg_vehicle_health = sum([v.get("vehicle_health_score", 100.0) for v in wh_vehicles]) / total_vehicles if total_vehicles else 100.0
    
    all_ships = shipments_db.get_filtered({"company_id": company_id})
    inbound_ships = [s for s in all_ships if s.get("drop_warehouse_id") == warehouse_id and s.get("status") in ["pending", "assigned", "in_transit"]]
    inbound_count = len(inbound_ships)
    
    drone_count = wh.get("drone_count", 0) or 0
    capacity = int(wh.get("capacity", 5)) + drone_count
    congestion_pct = min(100.0, (inbound_count / capacity) * 100.0) if capacity > 0 else 0.0
    
    prompt = (
        f"Perform an Operational Hub Readiness & Fleet Strategy Audit for depot '{wh.get('name', 'Unknown Hub')}' with the following parameters:\n"
        f"- Inbound Congestion: {congestion_pct:.1f}% ({inbound_count} shipments inbound, base capacity {capacity})\n"
        f"- Total Drone Fleet: {drone_count} active drone pads\n"
        f"- Total Registered Drivers: {total_drivers}\n"
        f"- High-Fatigue Drivers (>60%): {high_fatigue}\n"
        f"- Total Vehicles: {total_vehicles}\n"
        f"- Average Vehicle Health: {avg_vehicle_health:.1f}%\n"
        f"- Servicing Required (<80% health): {unhealthy_vehicles} vehicles\n\n"
        f"Provide a structured audit report with sections 'Depot Fitness Score', 'Operational Bottlenecks', "
        f"'Drone Fleet Readiness', and 'Safety & Fleet Strategy recommendations'."
    )
    
    system_instruction = "You are a senior logistics hub safety and resource efficiency optimizer. Output a professional markdown readiness audit. Keep it under 200 words."
    from backend.services.gemini_service import call_gemini
    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"report": response_text}

@router.post("/ai/demand-forecast")
def manager_demand_forecast(data: dict, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context) or data.get("company_id")
    
    api_keys = None
    if company_id:
        from backend.database import JSONDatabase
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")
            
    warehouse_id = data.get("warehouse_id")
    
    from backend.database import JSONDatabase
    warehouses_db = JSONDatabase("warehouses")
    shipments_db = JSONDatabase("shipments")
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    wh = warehouses_db.get_by_id(warehouse_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
        
    all_ships = shipments_db.get_filtered({"company_id": company_id})
    inbound_ships = [s for s in all_ships if s.get("drop_warehouse_id") == warehouse_id and s.get("status") in ["pending", "assigned", "in_transit"]]
    
    local_drivers = drivers_db.get_filtered({"base_warehouse_id": warehouse_id})
    local_vehicles = vehicles_db.get_filtered({"base_warehouse_id": warehouse_id})
    
    total_inbound = len(inbound_ships)
    high_value_inbound = len([s for s in inbound_ships if s.get("value", 0) > 100000])
    cold_chain_count = len([s for s in inbound_ships if s.get("is_cold_chain", False)])
    
    total_weight = sum([float(s.get("weight", 0.0) or 0.0) for s in inbound_ships])
    avg_weight = total_weight / total_inbound if total_inbound > 0 else 0.0
    
    prompt = (
        f"Perform an AI Shipment Demand Forecast for hub '{wh.get('name', 'Unknown Hub')}' with the following parameters:\n"
        f"- Active Inbound Shipments: {total_inbound}\n"
        f"- Total Inbound Payload Weight: {total_weight:.1f} kg (average {avg_weight:.1f} kg/shipment)\n"
        f"- Cold-Chain (Temperature-Controlled) Shipments: {cold_chain_count}\n"
        f"- High-Value Shipments (>₹1,00,000): {high_value_inbound}\n"
        f"- Available Hub Drivers: {len(local_drivers)}\n"
        f"- Available Hub Vehicles: {len(local_vehicles)}\n\n"
        f"Based on this, generate a predictive demand forecast. Provide sections: 'Predictive Volume Forecast', "
        f"'Predicted Peak Hours & Bottlenecks', 'Driver Resource Needs', and 'Actionable Operational Recommendations'. "
        f"Output in clean, structured Markdown, formatted beautifully for a manager."
    )
    
    system_instruction = "You are a senior logistics resource planner and demand forecasting expert. Output a clean markdown forecast report. Keep it concise, professional, and under 250 words."
    from backend.services.gemini_service import call_gemini
    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"report": response_text}

@router.post("/ai/fatigue-report")
def manager_fatigue_report(data: dict, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context) or data.get("company_id")
    
    api_keys = None
    if company_id:
        from backend.database import JSONDatabase
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")
            
    warehouse_id = data.get("warehouse_id")
    
    from backend.database import JSONDatabase
    warehouses_db = JSONDatabase("warehouses")
    drivers_db = JSONDatabase("drivers")
    
    wh = warehouses_db.get_by_id(warehouse_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
        
    wh_drivers = drivers_db.get_filtered({"base_warehouse_id": warehouse_id})
    if not wh_drivers:
        return {"report": "No drivers registered at this hub to analyze."}
        
    drivers_data = []
    for d in wh_drivers:
        drivers_data.append({
            "name": d.get("name", "Unknown"),
            "fatigue_score": d.get("fatigue_score", 0.0),
            "hours_on_duty": d.get("hours_on_duty", 0.0),
            "is_fit": d.get("is_fit", True),
            "telemetry_warnings": d.get("telemetry_warnings", 0)
        })
        
    high_risk = [d for d in drivers_data if d["fatigue_score"] > 60.0]
    med_risk = [d for d in drivers_data if 30.0 <= d["fatigue_score"] <= 60.0]
    unfit = [d for d in drivers_data if not d["is_fit"]]
    
    drivers_list_str = "\n".join([
        f"- {d['name']}: Fatigue Score {d['fatigue_score']}%, Hours on Duty {d['hours_on_duty']}h, Fit: {d['is_fit']}, Telemetry Warnings: {d['telemetry_warnings']}"
        for d in drivers_data[:20]
    ])
    
    prompt = (
        f"Perform an AI Driver Fatigue & Safety Risk Report for hub '{wh.get('name', 'Unknown Hub')}' with the following parameters:\n"
        f"- Total Drivers Monitored: {len(drivers_data)}\n"
        f"- High Fatigue Risk (>60% Score): {len(high_risk)} drivers\n"
        f"- Medium Fatigue Risk (30-60% Score): {len(med_risk)} drivers\n"
        f"- Declared Temporarily Unfit (Mandatory Rest): {len(unfit)} drivers\n\n"
        f"Driver Telemetry Sample:\n{drivers_list_str}\n\n"
        f"Provide a structured safety audit and risk mitigation report. Sections required: 'Hub Risk Rating', "
        f"'Critical Fatigue Alerts' (naming drivers at risk if any), 'Mitigation & Rest Scheduling Recommendations', and 'Safety Best Practices'. "
        f"Output in clean, structured Markdown, formatted beautifully for a manager."
    )
    
    system_instruction = "You are a senior transportation safety supervisor. Output a clean markdown driver safety report. Keep it under 250 words and professional."
    from backend.services.gemini_service import call_gemini
    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"report": response_text}

@router.post("/ai/daily-briefing")
def manager_daily_briefing(data: dict, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context) or data.get("company_id")
    
    api_keys = None
    if company_id:
        from backend.database import JSONDatabase
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")
            
    warehouse_id = data.get("warehouse_id")
    
    from backend.database import JSONDatabase
    warehouses_db = JSONDatabase("warehouses")
    shipments_db = JSONDatabase("shipments")
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    weather_db = JSONDatabase("weather_cells")
    
    wh = warehouses_db.get_by_id(warehouse_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
        
    all_ships = shipments_db.get_filtered({"company_id": company_id})
    inbound_ships = [s for s in all_ships if s.get("drop_warehouse_id") == warehouse_id and s.get("status") in ["pending", "assigned", "in_transit"]]
    outbound_ships = [s for s in all_ships if s.get("pickup_warehouse_id") == warehouse_id and s.get("status") in ["pending", "assigned"]]
    
    local_drivers = drivers_db.get_filtered({"base_warehouse_id": warehouse_id})
    local_vehicles = vehicles_db.get_filtered({"base_warehouse_id": warehouse_id})
    
    weather_cells = weather_db.get_all()
    active_weather_conditions = [w.get("condition") or w.get("type") or "Storm" for w in weather_cells if w]
    weather_summary = ", ".join(list(set(active_weather_conditions))) if active_weather_conditions else "No major active weather disturbances"
    
    total_drivers = len(local_drivers)
    active_drivers = len([d for d in local_drivers if d.get("is_on_duty", False)])
    healthy_vehicles = len([v for v in local_vehicles if v.get("vehicle_health_score", 100.0) >= 80.0])
    
    prompt = (
        f"Perform a Morning Operational AI Daily Briefing for hub '{wh.get('name', 'Unknown Hub')}' with the following parameters:\n"
        f"- Inbound Backlog Shipments: {len(inbound_ships)}\n"
        f"- Outbound Backlog Shipments: {len(outbound_ships)}\n"
        f"- Regional Weather Summary: {weather_summary}\n"
        f"- Fleet Readiness: {active_drivers}/{total_drivers} drivers on-duty\n"
        f"- Operational Vehicles: {healthy_vehicles}/{len(local_vehicles)} (>=80% health score)\n\n"
        f"Generate a daily morning briefing report for the depot manager. Include sections: 'Operational Weather Alert', "
        f"'Backlog & Congestion Status', 'Fleet Readiness Indicator', and 'Top Priority Action Items for Today'. "
        f"Output in clean, structured Markdown, formatted beautifully for a manager."
    )
    
    system_instruction = "You are a senior logistics operations director. Output a professional operational morning briefing in clean markdown. Keep it under 250 words."
    from backend.services.gemini_service import call_gemini
    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"report": response_text}


@router.post("/ai/fleet-audit")
def manager_fleet_audit(data: dict, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context) or data.get("company_id")
    if not company_id:
        raise HTTPException(status_code=400, detail="Missing company_id context")
        
    from backend.database import JSONDatabase
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    all_drivers = drivers_db.get_filtered({"company_id": company_id})
    all_vehicles = vehicles_db.get_filtered({"company_id": company_id})
    
    high_fatigue = [d for d in all_drivers if d.get("fatigue_score", 0.0) > 60.0]
    low_health_vehicles = [v for v in all_vehicles if v.get("vehicle_health_score", 100.0) < 80.0]
    
    drivers_summary = "\n".join([f"- {d['name']} (ID: {d['id'][:8]}): Fatigue={d.get('fatigue_score')}, Driving Score={d.get('driving_score')}%" for d in all_drivers[:10]])
    vehicles_summary = "\n".join([f"- Vehicle {v['number_plate']}: Health={v.get('vehicle_health_score')}%, Status={v.get('status')}" for v in all_vehicles[:10]])
    
    prompt = (
        f"Perform a comprehensive Diagnostic Fleet Audit for the following resources:\n\n"
        f"### Personnel (Drivers)\n"
        f"{drivers_summary or 'No drivers registered.'}\n\n"
        f"### Assets (Vehicles)\n"
        f"{vehicles_summary or 'No vehicles registered.'}\n\n"
        f"Drivers with critical fatigue (>60): {len(high_fatigue)}\n"
        f"Vehicles needing immediate service (<80% health): {len(low_health_vehicles)}\n\n"
        f"Generate a diagnostic markdown report detailing personnel fatigue warnings, vehicle maintenance advice, and direct fleet optimization recommendations."
    )
    
    system_instruction = "You are a professional logistics fleet diagnostic auditor. Output a clean markdown audit report."
    
    api_keys = None
    if company_id:
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")
            
    from backend.services.gemini_service import call_gemini
    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    return {"report": response_text}

@router.post("/ai/strategy-optimizer")
def manager_strategy_optimizer(data: dict, x_logistix_context: Optional[str] = Header(None)):
    from backend.services.auth_utils import get_company_id_from_context
    company_id = get_company_id_from_context(x_logistix_context) or data.get("company_id")
    if not company_id:
        raise HTTPException(status_code=400, detail="Missing company_id context")
        
    from backend.database import JSONDatabase
    plans_db = JSONDatabase("strategy_plans")
    ledger_db = JSONDatabase("ledger")
    
    my_plans = plans_db.get_filtered({"company_id": company_id})
    my_transactions = ledger_db.get_filtered({"company_id": company_id})
    
    active_plans_summary = ""
    for idx, p in enumerate(my_plans):
        active_plans_summary += f"Plan #{idx+1} ({p.get('status', 'active')}): predicted_profit_delta={p.get('predicted_profit_delta')}, growth_targets={p.get('growth_targets')}\n"
        
    expenses = sum([t.get("amount", 0) for t in my_transactions if t.get("type") == "EXPENSE"])
    revenue = sum([t.get("amount", 0) for t in my_transactions if t.get("type") == "INCOME"])
    
    prompt = (
        f"Perform an Operational Strategy Audit for a logistics company in India. Current financial summary:\n"
        f"- Total Revenue generated: ₹{revenue}\n"
        f"- Total Operating Expenses: ₹{expenses}\n"
        f"- Active Strategy Plans:\n{active_plans_summary or 'No active strategy plan configured.'}\n\n"
        f"Suggest exact concrete steps the manager can take to improve profitability, reduce fuel/fleet overheads, and streamline driver payouts."
    )
    
    system_instruction = "You are a senior operational efficiency director in logistics. Output a structured markdown strategy audit report."
    
    api_keys = None
    if company_id:
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")
            
    from backend.services.gemini_service import call_gemini
    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    return {"report": response_text}


@router.get("/driver_audit_log")
def get_driver_audit_log(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    from backend.database import JSONDatabase
    audit_db = JSONDatabase("driver_audit_log")
    logs = audit_db.get_all()
    
    drivers_db = JSONDatabase("drivers")
    company_drivers = {d["id"]: d for d in drivers_db.get_filtered({"company_id": company_id})}
    
    shipments_db = JSONDatabase("shipments")
    
    filtered_logs = []
    for log in logs:
        if not log:
            continue
        drv_id = log.get("driver_id")
        if drv_id in company_drivers:
            # Enrich log
            drv = company_drivers[drv_id]
            log["driver_name"] = drv.get("name", "Unknown")
            ship_id = log.get("shipment_id")
            if ship_id:
                s = shipments_db.get_by_id(ship_id)
                if s:
                    log["shipment_description"] = s.get("description", "Unknown")
                else:
                    log["shipment_description"] = "Deleted Shipment"
            filtered_logs.append(log)
            
    return sorted(filtered_logs, key=lambda x: x.get("timestamp", ""), reverse=True)

