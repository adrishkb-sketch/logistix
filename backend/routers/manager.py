from fastapi import APIRouter, HTTPException, UploadFile, File
from backend.models import Driver, Vehicle, Warehouse
from backend.database import JSONDatabase
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
import uuid
import random
import requests
import math
import pandas as pd
import io
import re
from fastapi import Header
from backend.services.auth_utils import verify_context

router = APIRouter()
companies_db = JSONDatabase("companies")
drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")
warehouses_db = JSONDatabase("warehouses")
ledger_db = JSONDatabase("ledger")
reviews_db = JSONDatabase("journey_reviews")
shipments_db = JSONDatabase("shipments")

@router.post("/drivers/bulk-parse")
async def bulk_parse_drivers(company_id: str, file: Optional[UploadFile] = File(None), url_req: Optional[str] = None):
    df = None
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
    
    if df is None or df.empty: raise HTTPException(status_code=400, detail="No data found")
    
    # Fetch warehouses for name-to-id mapping
    whs = warehouses_db.get_all()
    wh_map = {w.get("name").lower(): w.get("id") for w in whs if w.get("company_id") == company_id}
    wh_ids = {w.get("id"): w.get("id") for w in whs if w.get("company_id") == company_id}
    # Add support for 8-char short IDs (as shown in the infrastructure table)
    wh_short_ids = {w.get("id")[:8]: w.get("id") for w in whs if w.get("company_id") == company_id}

    drivers = []
    for _, row in df.iterrows():
        try:
            vals = row.values.tolist()
            if len(vals) < 9: continue
            phone = str(vals[8]).strip()
            if len(phone) == 10 and phone.isdigit():
                phone = "+91" + phone
                
            hub_val = str(vals[4]).strip()
            # Try to match by Full ID first, then Short ID (8 chars), then by Name
            hub_id = wh_ids.get(hub_val) or wh_short_ids.get(hub_val) or wh_map.get(hub_val.lower()) or hub_val
            
            challans = int(vals[7])

            d = {
                "name": str(vals[0]),
                "login_id": str(vals[1]),
                "password": str(vals[2]),
                "license_type": str(vals[3]),
                "base_warehouse_id": hub_id,
                "years_experience": float(vals[5]),
                "past_accidents": int(vals[6]),
                "traffic_violations": challans,
                "challan_count": challans,
                "contact_number": phone,
                "company_id": company_id
            }
            drivers.append(d)
        except: continue
    return {"drivers": drivers, "count": len(drivers)}

@router.post("/drivers/bulk-confirm")
async def bulk_confirm_drivers(drivers: List[Driver]):
    for d in drivers:
        from backend.services.driver_intel import calculate_driver_performance_score
        d_dict = d.model_dump()
        d_dict["driving_score"] = calculate_driver_performance_score(d_dict)
        drivers_db.insert(d_dict)
    return {"message": f"Successfully created {len(drivers)} drivers."}

@router.post("/vehicles/bulk-parse")
async def bulk_parse_vehicles(company_id: str, file: Optional[UploadFile] = File(None), url_req: Optional[str] = None):
    df = None
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
    
    if df is None or df.empty: raise HTTPException(status_code=400, detail="No data found")
    
    # Fetch warehouses for name-to-id mapping
    whs = warehouses_db.get_all()
    wh_map = {w.get("name").lower(): w.get("id") for w in whs if w.get("company_id") == company_id}
    wh_ids = {w.get("id"): w.get("id") for w in whs if w.get("company_id") == company_id}
    wh_short_ids = {w.get("id")[:8]: w.get("id") for w in whs if w.get("company_id") == company_id}

    vehicles = []
    for _, row in df.iterrows():
        try:
            vals = row.values.tolist()
            if len(vals) < 5: continue
            
            hub_val = str(vals[1]).strip()
            # Try to match by Full ID first, then Short ID (8 chars), then by Name
            hub_id = wh_ids.get(hub_val) or wh_short_ids.get(hub_val) or wh_map.get(hub_val.lower()) or hub_val

            v = {
                "type": str(vals[0]),
                "base_warehouse_id": hub_id,
                "number_plate": str(vals[2]).upper(),
                "capacity": float(vals[3]),
                "fuel_efficiency": float(vals[4]),
                "company_id": company_id,
                "status": "available",
                "speed": 40.0 # Default speed for legacy code
            }
            vehicles.append(v)
        except: continue
    return {"vehicles": vehicles, "count": len(vehicles)}

@router.post("/vehicles/bulk-confirm")
async def bulk_confirm_vehicles(vehicles: List[Vehicle]):
    for v in vehicles:
        vehicles_db.insert(v.model_dump())
    return {"message": f"Successfully created {len(vehicles)} vehicles."}

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
    # Check for duplicate phone or login ID
    all_drivers = drivers_db.get_all()
    if any(d.get("contact_number") == driver.contact_number for d in all_drivers):
        raise HTTPException(status_code=400, detail="A driver with this contact number is already registered.")
    if any(d.get("login_id") == driver.login_id for d in all_drivers):
        raise HTTPException(status_code=400, detail="This Login ID is already taken.")

    from backend.services.driver_intel import calculate_driver_performance_score
    driver_data = driver.model_dump()
    driver_data["driving_score"] = calculate_driver_performance_score(driver_data)
    return drivers_db.insert(driver_data)

@router.get("/drivers")
def get_drivers(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    drivers = drivers_db.get_all()
    return [d for d in drivers if d.get("company_id") == company_id]

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
    vehicles = vehicles_db.get_all()
    return [v for v in vehicles if v.get("company_id") == company_id]

@router.delete("/vehicles/{vehicle_id}")
def delete_vehicle(vehicle_id: str):
    if vehicles_db.delete(vehicle_id):
        return {"message": "Deleted"}
    raise HTTPException(status_code=404, detail="Vehicle not found")

# Warehouses CRUD
@router.post("/warehouses")
def create_warehouse(warehouse: Warehouse):
    return warehouses_db.insert(warehouse.model_dump())

@router.get("/warehouses")
def get_warehouses(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    warehouses = warehouses_db.get_all()
    return [w for w in warehouses if w.get("company_id") == company_id]

@router.delete("/warehouses/{warehouse_id}")
def delete_warehouse(warehouse_id: str):
    if warehouses_db.delete(warehouse_id):
        return {"message": "Warehouse deleted successfully"}
    raise HTTPException(status_code=404, detail="Warehouse not found")

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
    my_ships = [s for s in all_shipments if s.get("company_id") == company_id]
    
    if not my_ships:
        # Use a deterministic but variable offset based on coordinates to avoid 2.35km
        # We use math.sin/cos to create a pseudo-random but stable strategic point
        offset_lat = 0.01 + abs(math.sin(lat * 10)) * 0.02
        offset_lng = 0.01 + abs(math.cos(lng * 10)) * 0.02
        s_lat = lat + offset_lat
        s_lng = lng + offset_lng
        reason = "strategy_ai_reason"
    else:
        # 2. Find centroid of nearby shipments
        nearby = [s for s in my_ships if abs(s["drop"]["lat"] - lat) < 1.0 and abs(s["drop"]["lng"] - lng) < 1.0]
        if nearby:
            s_lat = sum(s["drop"]["lat"] for s in nearby) / len(nearby)
            s_lng = sum(s["drop"]["lng"] for s in nearby) / len(nearby)
            reason = "strategy_reason_sector"
        else:
            avg_lat = sum(s["drop"]["lat"] for s in my_ships) / len(my_ships)
            avg_lng = sum(s["drop"]["lng"] for s in my_ships) / len(my_ships)
            s_lat = (lat + avg_lat) / 2
            s_lng = (lng + avg_lng) / 2
            reason = "strategy_reason_bridge"

    # 3. GET ACTUAL ROAD DISTANCE FROM MAP ENGINE (OSRM)
    dist_km = 0
    try:
        # OSRM expects [lng,lat;lng,lat]
        osrm_url = f"http://router.project-osrm.org/route/v1/driving/{lng},{lat};{s_lng},{s_lat}?overview=false"
        resp = requests.get(osrm_url, timeout=3).json()
        if resp.get("code") == "Ok":
            dist_km = resp["routes"][0]["distance"] / 1000.0
    except:
        # Fallback to Haversine if API is down
        dist_km = math.sqrt((s_lat - lat)**2 + (s_lng - lng)**2) * 111

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
    existing = [v for v in vehicles_db.get_all() if v.get("number_plate") == plate]
    return {"exists": len(existing) > 0}

@router.get("/dashboard/stats")
def get_manager_stats(company_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(company_id, x_logistix_context)
    s_db = JSONDatabase("shipments")
    v_db = JSONDatabase("vehicles")
    d_db = JSONDatabase("drivers")
    
    shipments = [s for s in s_db.get_all() if s.get("company_id") == company_id]
    vehicles = [v for v in v_db.get_all() if v.get("company_id") == company_id]
    drivers = [d for d in d_db.get_all() if d.get("company_id") == company_id]
    
    # 1. Timely Delivery %
    delivered = [s for s in shipments if s.get("status") == "delivered"]
    timely = [s for s in delivered if s.get("actual_delivery", "") <= s.get("expected_delivery", "9999")]
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
        "available": len([v for v in vehicles if v.get("status") == "available"]),
        "maintenance": len([v for v in vehicles if v.get("status") == "maintenance"])
    }
    
    # 4. Warehouse Count
    warehouses = [w for w in warehouses_db.get_all() if w.get("company_id") == company_id]
    
    return {
        "total_shipments": len(shipments),
        "active_shipments": len([s for s in shipments if s.get("status") != "delivered"]),
        "total_drivers": len(drivers),
        "total_vehicles": len(vehicles),
        "total_warehouses": len(warehouses),
        "timely_percent": round(timely_percent, 1),
        "avg_delay_mins": round(avg_delay, 1),
        "fleet_dist": fleet_dist,
        "revenue": sum([(s.get("weight") or 0) * 10 for s in delivered]), # Mock revenue
        "perf_history": [random.randint(85, 100) for _ in range(7)]
    }

@router.get("/analytics/cascade")
def get_cascading_impact(company_id: str):
    all_shipments = shipments_db.get_all()
    my_ships = [s for s in all_shipments if s.get("company_id") == company_id]
    
    delayed_ships = [s for s in my_ships if (s.get("performance_stats") or {}).get("status") == "delayed" and s.get("status") == "in_transit"]
    
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
            subs = [ls for ls in my_ships if ls.get("parent_id") == s.get("parent_id") and ls.get("leg_order", 0) > s.get("leg_order", 0)]
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
    drivers = [d for d in drivers_db.get_all() if d.get("company_id") == company_id and not d.get("assigned_vehicle_id")]
    # Find all available and unassigned vehicles for this company
    vehicles = [v for v in vehicles_db.get_all() if v.get("company_id") == company_id and v.get("status") == "available" and not v.get("assigned_driver_id")]
    
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
        if any(d.get("assigned_vehicle_id") == vehicle_id and d.get("id") != driver_id for d in all_drivers):
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
    active = [s for s in all_shipments if s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit", "picked_up"]]
    
    if active:
        raise HTTPException(status_code=400, detail="Cannot unverify driver while they have an active shipment.")
        
    drivers_db.update(driver_id, {"verification_status": "unverified"})
    return {"message": "Driver unverified successfully"}

@router.get("/leaderboard")
def get_leaderboard(category: str = "driver", sort_by: str = "overall"):
    from backend.services.driver_intel import calculate_driver_performance_score, calculate_fatigue, calculate_vehicle_efficiency_score
    
    if category == "driver":
        drivers = drivers_db.get_all()
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
            "rating": "rating"
        }
        target_key = key_map.get(sort_by, "overall_score")
        return sorted(processed, key=lambda x: x.get(target_key, 0), reverse=True)
    else:
        vehicles = vehicles_db.get_all()
        processed = []
        for v in vehicles:
            v["efficiency_score"] = calculate_vehicle_efficiency_score(v)
            processed.append(v)
            
        key_map = {
            "overall": "efficiency_score",
            "vehicle_health_score": "vehicle_health_score",
            "fuel_efficiency": "fuel_efficiency"
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
    shipments = [s for s in shipments_db.get_all() if s.get("assigned_driver_id") == driver_id]
    
    return {
        "profile": driver,
        "recent_shipments": shipments[:10]
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
    shipments = [s for s in shipments_db.get_all() if s.get("assigned_vehicle_id") == vehicle_id]
    
    return {
        "profile": vehicle,
        "recent_shipments": shipments[:10]
    }

# System Reset Features (ADMIN ONLY)
@router.post("/system/reset-shipments")
def reset_shipments(data: dict, x_logistix_context: Optional[str] = Header(None)):
    if not x_logistix_context: raise HTTPException(status_code=401, detail="Context missing")
    company = companies_db.get_by_id(x_logistix_context)
    if not company: raise HTTPException(status_code=404, detail="Company not found")
    
    provided_pw = str(data.get("manager_password", "")).strip()
    if provided_pw != str(company.get("password", "")).strip():
        raise HTTPException(status_code=401, detail="Invalid manager password")

    s_db = JSONDatabase("shipments")
    # Only clear shipments for THIS company
    all_s = s_db.get_all()
    to_delete = [s["id"] for s in all_s if s.get("company_id") == x_logistix_context]
    for sid in to_delete:
        s_db.delete(sid)
    return {"message": f"All {len(to_delete)} shipment records for {company['name']} have been cleared."}

@router.post("/system/reset-drivers")
def reset_drivers(data: dict, x_logistix_context: Optional[str] = Header(None)):
    if not x_logistix_context: raise HTTPException(status_code=401, detail="Context missing")
    company = companies_db.get_by_id(x_logistix_context)
    if not company: raise HTTPException(status_code=404, detail="Company not found")
    
    provided_pw = str(data.get("manager_password", "")).strip()
    if provided_pw != str(company.get("password", "")).strip():
        raise HTTPException(status_code=401, detail="Invalid manager password")

    # Only clear drivers for THIS company
    all_d = drivers_db.get_all()
    to_delete = [d["id"] for d in all_d if d.get("company_id") == x_logistix_context]
    for did in to_delete:
        drivers_db.delete(did)
    return {"message": f"All {len(to_delete)} driver records for {company['name']} have been cleared."}

@router.post("/system/reset-vehicles")
def reset_vehicles(data: dict, x_logistix_context: Optional[str] = Header(None)):
    if not x_logistix_context: raise HTTPException(status_code=401, detail="Context missing")
    company = companies_db.get_by_id(x_logistix_context)
    if not company: raise HTTPException(status_code=404, detail="Company not found")
    
    provided_pw = str(data.get("manager_password", "")).strip()
    if provided_pw != str(company.get("password", "")).strip():
        raise HTTPException(status_code=401, detail="Invalid manager password")

    # Only clear vehicles for THIS company
    v_db = JSONDatabase("vehicles")
    all_v = v_db.get_all()
    to_delete = [v["id"] for v in all_v if v.get("company_id") == x_logistix_context]
    for vid in to_delete:
        v_db.delete(vid)
    return {"message": f"All {len(to_delete)} vehicle records for {company['name']} have been cleared."}

# Account Deletion with OTP
@router.post("/system/delete-account-request")
def request_account_deletion(company_id: str):
    c_db = JSONDatabase("companies")
    company = c_db.get_by_id(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    otp = str(random.randint(100000, 999999))
    deletion_otp_store[company_id] = otp
    
    from backend.services.email_service import EmailService
    success = EmailService.send_otp_email(company["email"], otp)
    
    if not success:
        print(f"\n--- [FALLBACK MOCK DELETION OTP] ---")
        print(f"To: {company['email']}")
        print(f"Code: {otp}")
        print(f"------------------------------------\n")
        return {"message": "Email delivery failed. Check server console for code."}
        
    return {"message": "OTP sent to your registered email."}

@router.post("/system/delete-account-confirm")
def confirm_account_deletion(company_id: str, otp: str):
    if deletion_otp_store.get(company_id) != otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
        
    c_db = JSONDatabase("companies")
    
    # 1. Wipe all associated data
    # Helper to wipe table by company_id
    def wipe_by_company(table_name):
        db = JSONDatabase(table_name)
        all_items = db.get_all()
        remaining = [item for item in all_items if item.get("company_id") != company_id]
        db.write(remaining)

    tables_to_wipe = ["drivers", "vehicles", "warehouses", "shipments", "alerts", "ledger", "messages", "strategy_plans"]
    for table in tables_to_wipe:
        wipe_by_company(table)

    if c_db.delete(company_id):
        if company_id in deletion_otp_store:
            del deletion_otp_store[company_id]
        return {"message": "Account and all associated data deleted successfully."}
    
    raise HTTPException(status_code=404, detail="Account not found")
@router.post("/rescue-shipment")
def rescue_shipment(shipment_id: str, driver_id: str, vehicle_id: str, x_logistix_context: Optional[str] = Header(None)):
    # Verify manager context for rescue operations
    shipment = shipments_db.get_by_id(shipment_id)
    if shipment:
        verify_context(shipment.get("company_id"), x_logistix_context)
    shipments_db = JSONDatabase("shipments")
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    old_driver_id = shipment.get("assigned_driver_id")
    old_vehicle_id = shipment.get("assigned_vehicle_id")
    
    # Update new driver and vehicle status
    drivers_db.update(driver_id, {"assigned_vehicle_id": vehicle_id})
    vehicles_db.update(vehicle_id, {"assigned_driver_id": driver_id, "status": "in_transit"})
    
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
    comp_txs = [t for t in all_txs if t.get("company_id") == company_id]
    
    # Calculate Daily Revenue (last 24 hours)
    now = datetime.utcnow()
    last_24h = now - timedelta(days=1)
    daily_revenue = sum(
        t["amount"] for t in comp_txs 
        if t["type"] == "REVENUE" and datetime.fromisoformat(t["timestamp"]) >= last_24h
    )
    
    # Get unpaid invoices / Digital Escrow in transit from Shipments
    all_ships = shipments_db.get_all()
    comp_ships = [s for s in all_ships if s.get("company_id") == company_id]
    
    unpaid_ships = [s for s in comp_ships if s.get("payment_status") == "unpaid"]
    unpaid_total = sum(s.get("finance", {}).get("suggested_price", 0) for s in unpaid_ships)
    
    unpaid_invoices = unpaid_total
    
    bonus_pool = daily_revenue * 0.05 
    
    # Drone Maintenance calculation
    drone_maintenance = sum(s.get("finance", {}).get("drone_maintenance", 0) for s in comp_ships)

    # Recent settlements (top 5)
    recent = sorted(comp_txs, key=lambda x: x["timestamp"], reverse=True)[:5]
    settlements_list = []
    for t in recent:
        settlements_list.append({
            "desc": t["desc"],
            "amount": t["amount"],
            "timestamp": t["timestamp"],
            "type": t["type"]
        })
        
    # Chart Data: Revenue per day for last 7 days
    labels = []
    values = []
    for i in range(6, -1, -1):
        day_date = now - timedelta(days=i)
        day_start = day_date.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        
        day_rev = sum(
            t["amount"] for t in comp_txs 
            if t["type"] == "REVENUE" and day_start <= datetime.fromisoformat(t["timestamp"]) < day_end
        )
        labels.append(day_date.strftime("%d %b"))
        values.append(round(day_rev, 2))
        
    return {
        "daily_revenue": round(daily_revenue, 2),
        "digital_escrow": round(unpaid_total, 2),
        "unpaid_invoices": round(unpaid_total, 2),
        "bonus_pool": round(bonus_pool, 2),
        "drone_maintenance": round(drone_maintenance, 2),
        "recent_settlements": settlements_list,
        "escrow_contracts": [
            {"id": "CON-AUTO", "counterparty": "Logistix Reserve", "value": round(unpaid_total * 1.2, 2), "status": "Guaranteed", "eta": "Auto"},
        ],
        "chart_data": {
            "labels": labels,
            "values": values
        }
    }

@router.post("/finance/confirm-payment/{shipment_id}")
def confirm_customer_payment(shipment_id: str, x_logistix_context: Optional[str] = Header(None)):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    verify_context(shipment.get("company_id"), x_logistix_context)
    
    shipments_db.update(shipment_id, {"payment_status": "paid"})
    
    # Log to ledger
    ledger_db.insert({
        "type": "REVENUE",
        "desc": f"Payment Recieved for Shipment {shipment_id[:8]}",
        "amount": shipment.get("finance", {}).get("suggested_price", 0),
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
    
    # Log to ledger
    ledger_db.insert({
        "type": "EXPENSE",
        "desc": f"Payout Settled: {driver['name']}",
        "amount": balance,
        "timestamp": datetime.utcnow().isoformat(),
        "company_id": driver.get("company_id")
    })
    return {"message": f"Successfully settled ₹{balance} for {driver['name']}"}

@router.get("/finance/p-and-l")
def get_p_and_l(company_id: str):
    all_txs = ledger_db.get_all()
    comp_txs = [t for t in all_txs if t.get("company_id") == company_id]
    
    revenue = sum(t["amount"] for t in comp_txs if t["type"] == "REVENUE")
    expenses = sum(t["amount"] for t in comp_txs if t["type"] == "EXPENSE")
    
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
        results.append({
            "alert_id": a.get("id"),
            "driver_id": a.get("driver_id"),
            "driver_name": driver_name_match.group(1) if driver_name_match else "Unknown",
            "amount": float(amount_match.group(1)) if amount_match else 0,
            "fund_type": type_match.group(1) if type_match else "MISC",
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
    
    # Credit driver's wallet
    new_balance = driver.get("wallet_balance", 0) + amount
    drivers_db.update(driver_id, {
        "wallet_balance": new_balance,
        "total_earnings": driver.get("total_earnings", 0) + amount # Credit earnings too since it's an advance
    })
    
    # Log as expense in ledger
    ledger_db.insert({
        "type": "EXPENSE",
        "desc": f"Emergency Fund Approved: {driver['name']} ({desc.split('for')[-1].strip()})",
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
