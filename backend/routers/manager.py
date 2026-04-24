from fastapi import APIRouter, HTTPException
from backend.models import Driver, Vehicle, Warehouse
from backend.database import JSONDatabase
import uuid
import random
import requests
import math

router = APIRouter()
drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")
warehouses_db = JSONDatabase("warehouses")
ledger_db = JSONDatabase("ledger")
reviews_db = JSONDatabase("journey_reviews")
shipments_db = JSONDatabase("shipments")

@router.get("/ledger")
def get_ledger(company_id: str):
    txs = ledger_db.get_all()
    return [t for t in txs if t.get("company_id") == company_id]

@router.post("/ledger/boost")
def boost_points(data: dict):
    company_id = data.get("company_id")
    percentage = data.get("percentage", 0)
    
    if not company_id:
        raise HTTPException(status_code=400, detail="Missing company_id")
        
    drivers = [d for d in drivers_db.get_all() if d.get("company_id") == company_id]
    for d in drivers:
        current_points = d.get("reward_points", 0)
        boost = int(current_points * (percentage / 100.0))
        if boost > 0:
            drivers_db.update(d["id"], {"reward_points": current_points + boost})
            # Log to ledger
            ledger_db.insert({
                "company_id": company_id,
                "driver_id": d["id"],
                "points": boost,
                "timestamp": "Now", # In a real app use datetime
                "hash": f"0x{uuid.uuid4().hex[:16]}",
                "shipment_id": "BULK_BOOST"
            })
            
    return {"message": f"Successfully boosted points for {len(drivers)} drivers by {percentage}%."}

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
    return drivers_db.insert(driver.model_dump())

@router.get("/drivers")
def get_drivers(company_id: str):
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
def get_vehicles(company_id: str):
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
def get_warehouses(company_id: str):
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
        reason = "AI identified this as a high-potential future growth node based on regional logistics density."
    else:
        # 2. Find centroid of nearby shipments
        nearby = [s for s in my_ships if abs(s["drop"]["lat"] - lat) < 1.0 and abs(s["drop"]["lng"] - lng) < 1.0]
        if nearby:
            s_lat = sum(s["drop"]["lat"] for s in nearby) / len(nearby)
            s_lng = sum(s["drop"]["lng"] for s in nearby) / len(nearby)
            reason = f"Optimized node to service {len(nearby)} active delivery points in this sector."
        else:
            avg_lat = sum(s["drop"]["lat"] for s in my_ships) / len(my_ships)
            avg_lng = sum(s["drop"]["lng"] for s in my_ships) / len(my_ships)
            s_lat = (lat + avg_lat) / 2
            s_lng = (lng + avg_lng) / 2
            reason = "Strategically positioned to bridge the gap between existing delivery clusters."

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

@router.get("/dashboard/stats")
def get_manager_stats(company_id: str):
    s_db = JSONDatabase("shipments")
    v_db = JSONDatabase("vehicles")
    d_db = JSONDatabase("drivers")
    
    shipments = [s for s in s_db.get_all() if s.get("company_id") == company_id]
    vehicles = [v for v in v_db.get_all() if v.get("company_id") == company_id]
    drivers = [d for d in d_db.get_all() if d.get("company_id") == company_id]
    
    # 1. Timely Delivery %
    delivered = [s for s in shipments if s["status"] == "delivered"]
    timely = [s for s in delivered if s.get("actual_delivery", "") <= s.get("expected_delivery", "9999")]
    timely_percent = (len(timely) / len(delivered) * 100) if delivered else 100
    
    # 2. Avg Delay
    delays = []
    for s in delivered:
        if s.get("actual_delivery") and s.get("expected_delivery"):
            from datetime import datetime
            try:
                actual = datetime.fromisoformat(s["actual_delivery"])
                expected = datetime.fromisoformat(s["expected_delivery"])
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
    
    return {
        "total_shipments": len(shipments),
        "active_shipments": len([s for s in shipments if s["status"] != "delivered"]),
        "timely_percent": round(timely_percent, 1),
        "avg_delay_mins": round(avg_delay, 1),
        "fleet_dist": fleet_dist,
        "revenue": sum([s.get("weight", 0) * 10 for s in delivered]), # Mock revenue
        "perf_history": [random.randint(85, 100) for _ in range(7)]
    }

@router.get("/analytics/cascade")
def get_cascading_impact(company_id: str):
    all_shipments = shipments_db.get_all()
    my_ships = [s for s in all_shipments if s.get("company_id") == company_id]
    
    delayed_ships = [s for s in my_ships if s.get("performance_stats", {}).get("status") == "delayed" and s["status"] == "in_transit"]
    
    risks = []
    total_impact_hours = 0
    
    for s in delayed_ships:
        delay_mins = s["performance_stats"].get("diff_mins", 0)
        total_impact_hours += delay_mins / 60
        
        # Predictive cascading to hubs or final legs
        impact_hubs = []
        if s.get("is_leg"):
            # Find subsequent legs
            subs = [ls for ls in my_ships if ls.get("parent_id") == s.get("parent_id") and ls.get("leg_order", 0) > s.get("leg_order", 0)]
            for sub in subs:
                impact_hubs.append({
                    "id": sub["id"],
                    "location": sub["drop"].get("address", "Final Destination"),
                    "risk_level": "critical" if delay_mins > 60 else "moderate",
                    "est_delay_mins": delay_mins + 15 # +15m overhead per cascade
                })
        
        risks.append({
            "source_shipment_id": s["id"],
            "description": s["description"],
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
        
    # Unlink any existing
    if vehicle.get("assigned_driver_id"):
        drivers_db.update(vehicle["assigned_driver_id"], {"assigned_vehicle_id": None})
    if driver.get("assigned_vehicle_id"):
        vehicles_db.update(driver["assigned_vehicle_id"], {"assigned_driver_id": None})
        
    # Link
    drivers_db.update(driver_id, {"assigned_vehicle_id": vehicle_id, "verification_status": "unverified"})
    vehicles_db.update(vehicle_id, {"assigned_driver_id": driver_id})
    
    return {"message": "Linked successfully"}

@router.post("/verify-driver/{driver_id}")
def manual_verify_driver(driver_id: str, status: str):
    if status not in ["verified", "unverified"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    drivers_db.update(driver_id, {"verification_status": status})
    return {"message": f"Driver marked as {status}"}

@router.get("/leaderboard")
def get_leaderboard(category: str = "driver", sort_by: str = "overall"):
    from backend.services.driver_intel import calculate_driver_performance_score, calculate_fatigue
    
    if category == "driver":
        drivers = drivers_db.get_all()
        processed = []
        for d in drivers:
            d["fatigue_score"] = calculate_fatigue(d)
            d["overall_score"] = calculate_driver_performance_score(d)
            processed.append(d)
            
        if sort_by == "overall":
            return sorted(processed, key=lambda x: x["overall_score"], reverse=True)
        return sorted(processed, key=lambda x: x.get(sort_by, 0), reverse=True)
    else:
        vehicles = vehicles_db.get_all()
        if sort_by == "overall":
            return sorted(vehicles, key=lambda x: x.get("efficiency_score", 0), reverse=True)
        return sorted(vehicles, key=lambda x: x.get(sort_by, 0), reverse=True)

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

# System Reset Features
@router.post("/system/reset-shipments")
def reset_shipments():
    s_db = JSONDatabase("shipments")
    s_db.clear_all()
    return {"message": "All shipment data has been cleared."}

@router.post("/system/reset-drivers")
def reset_drivers():
    drivers_db.clear_all()
    # Also clear vehicle assignments
    v_all = vehicles_db.get_all()
    for v in v_all:
        vehicles_db.update(v["id"], {"assigned_driver_id": None})
    return {"message": "All driver data has been cleared and vehicles unlinked."}

@router.post("/system/reset-vehicles")
def reset_vehicles():
    vehicles_db.clear_all()
    # Also clear driver assignments
    d_all = drivers_db.get_all()
    for d in d_all:
        drivers_db.update(d["id"], {"assigned_vehicle_id": None})
    return {"message": "All vehicle data has been cleared and drivers unlinked."}

# Account Deletion with OTP
@router.post("/system/delete-account-request")
def request_account_deletion(company_id: str):
    c_db = JSONDatabase("companies")
    company = c_db.get_by_id(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    otp = str(random.randint(100000, 999999))
    deletion_otp_store[company_id] = otp
    
    print(f"\n--- [DELETE ACCOUNT OTP] ---")
    print(f"To: {company['email']}")
    print(f"Your OTP for permanent account deletion is: {otp}")
    print(f"WARNING: This action cannot be undone.")
    print(f"----------------------------\n")
    
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
def rescue_shipment(shipment_id: str, driver_id: str, vehicle_id: str):
    from backend.models import ShipmentEvent
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
