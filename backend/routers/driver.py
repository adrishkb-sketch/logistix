from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, Query
from backend.services.auth_utils import verify_context
from backend.database import JSONDatabase
from typing import Dict, Any, Optional
from backend.services.ocr_service import process_number_plate_image
import os
import uuid
import random
import string
from datetime import datetime

def save_and_compress_image(file_bytes: bytes, filename: str) -> str:
    """Compress image and return a base64 data URL stored directly in Turso."""
    import io
    import base64
    from PIL import Image

    try:
        img = Image.open(io.BytesIO(file_bytes))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        max_size = 600
        if img.width > max_size or img.height > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=45, optimize=True)
        compressed_bytes = buf.getvalue()
    except Exception as e:
        print(f"[Image Compression] Failed: {e}. Using raw bytes.")
        compressed_bytes = file_bytes

    b64 = base64.b64encode(compressed_bytes).decode("ascii")
    data_url = f"data:image/jpeg;base64,{b64}"
    print(f"[Image Upload] Stored as base64 data URL ({len(compressed_bytes)} bytes)")
    return data_url

router = APIRouter()
shipments_db = JSONDatabase("shipments")
drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")
warehouses_db = JSONDatabase("warehouses")
alerts_db = JSONDatabase("alerts")

@router.get("/{driver_id}/shipments")
def get_driver_shipments(driver_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    driver = drivers_db.get_by_id(driver_id)
    if driver and driver.get("company_id"):
        check_and_run_dynamic_reassignment(driver["company_id"])
    from backend.services.cold_chain import calculate_shipment_vitality
    assigned = shipments_db.get_filtered({"assigned_driver_id": driver_id})
    
    fund_db = JSONDatabase("fund_requests")
    all_funds = fund_db.get_all()
    
    weather_db = JSONDatabase("weather_cells")
    cells_list = weather_db.get_all()
    all_ships = shipments_db.get_all()
    
    db_changed = False
    # Recalculate vitality for perishables and attach fund request status
    for s in assigned:
        if s.get("is_perishable"):
            new_v = calculate_shipment_vitality(s, cells=cells_list)
            if new_v != s.get("vitality"):
                s["vitality"] = new_v
                for master_s in all_ships:
                    if master_s and master_s.get("id") == s["id"]:
                        master_s["vitality"] = new_v
                        break
                db_changed = True
        
        # Attach fund request status
        shipment_funds = [f for f in all_funds if f and f.get("shipment_id") == s["id"]]
        s["has_refuel_req"] = any(f.get("type") == "refuel" for f in shipment_funds)
        s["has_toll_req"] = any(f.get("type") == "toll" for f in shipment_funds)
                
    if db_changed:
        shipments_db.write(all_ships)
        
    return assigned

@router.get("/safety/rest-stops")
def get_rest_stops(lat: float, lng: float):
    # Mocked Rest Stop database
    # In a real app this would query Google Places or a safety DB
    stops = [
        {"name": "Zen Haven Rest Stop", "lat": lat + 0.015, "lng": lng + 0.01, "rating": 4.8, "amenities": ["Parking", "Cafe", "Sleep Pods"]},
        {"name": "Highway Oasis", "lat": lat - 0.02, "lng": lng + 0.025, "rating": 4.5, "amenities": ["Fuel", "Shower", "24/7 Food"]},
        {"name": "Driver Relief Point", "lat": lat + 0.03, "lng": lng - 0.01, "rating": 4.2, "amenities": ["Mechanic", "Clean Restrooms"]}
    ]
    return stops

@router.get("/nearby-pois")
def get_nearby_pois(lat: float, lng: float, types: str):
    # types is comma-separated e.g. "fuel,food,mechanic,rest"
    type_list = [t.strip().lower() for t in types.split(",")]
    pois = []
    
    # Seeds for realistic offsets and names
    poi_data = {
        "fuel": [
            {"name": "Highway Fuel Station", "offset_lat": 0.008, "offset_lng": -0.012, "desc": "⛽ 24/7 CNG/Diesel, Air pump"},
            {"name": "IndianOil Plaza", "offset_lat": -0.015, "offset_lng": 0.007, "desc": "⛽ Refueling, Clean restrooms"},
            {"name": "HP Petrol Pump", "offset_lat": 0.022, "offset_lng": 0.018, "desc": "⛽ Card payments accepted"}
        ],
        "food": [
            {"name": "Sher-e-Punjab Dhaba", "offset_lat": -0.009, "offset_lng": 0.015, "desc": "🍔 Hot meals, Tea & Coffee"},
            {"name": "Highway Express Food Court", "offset_lat": 0.014, "offset_lng": -0.022, "desc": "🍔 Multi-cuisine dining"},
            {"name": "Chai & Snacks Corner", "offset_lat": -0.021, "offset_lng": -0.011, "desc": "☕ Quick bites, Snacks"}
        ],
        "mechanic": [
            {"name": "National Truck Repair & Spares", "offset_lat": 0.019, "offset_lng": -0.005, "desc": "🔧 Engine & tire repair"},
            {"name": "QuickFix Auto Clinic", "offset_lat": -0.011, "offset_lng": -0.019, "desc": "🔧 Hydraulic system specialists"},
            {"name": "24/7 Breakdown Assistance", "offset_lat": 0.028, "offset_lng": 0.009, "desc": "🔧 Towing, puncture repairs"}
        ],
        "rest": [
            {"name": "Highway Comfort Inn", "offset_lat": 0.012, "offset_lng": 0.012, "desc": "🛏️ Rooms, Showers, Parking"},
            {"name": "Sovereign Rest House", "offset_lat": -0.018, "offset_lng": 0.024, "desc": "🛏️ Quiet rooms, AC lounge"},
            {"name": "Zen Haven Rest Stop", "offset_lat": 0.015, "offset_lng": 0.01, "desc": "🛏️ Sleep pods, cafe, showers"}
        ]
    }
    
    for t in type_list:
        if t in poi_data:
            for item in poi_data[t]:
                pois.append({
                    "name": item["name"],
                    "lat": lat + item["offset_lat"],
                    "lng": lng + item["offset_lng"],
                    "type": t,
                    "desc": item["desc"],
                    "is_open": True
                })
                
    return pois

@router.post("/{driver_id}/zen")
def toggle_zen(driver_id: str, data: dict, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    is_active = data.get("is_active", False)
    dest = data.get("destination")
    
    drivers_db.update(driver_id, {
        "is_zen_mode": is_active,
        "zen_destination": dest
    })
    
    if is_active:
        # Create a safety alert for the manager
        from backend.models import Alert
        from backend.database import JSONDatabase
        alerts_db = JSONDatabase("alerts")
        new_alert = Alert(
            company_id=driver["company_id"],
            type="fatigue",
            description=f"SAFETY: Driver {driver['name']} has entered ZEN MODE due to erratic patterns/fatigue. Rerouted to {dest.get('address') if dest else 'Rest Stop'}.",
            severity="high",
            suggestion="Monitor driver status and verify arrival at rest stop.",
            driver_id=driver_id
        )
        alerts_db.insert(new_alert.model_dump())
        
    return {"message": "Zen Mode updated", "is_zen_mode": is_active}

@router.post("/{driver_id}/location")
def update_driver_location(driver_id: str, location: Dict[str, Any], x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    from backend.services.alert_engine import check_weather_alerts
    from backend.services.route_engine import check_shipment_performance
    
    active_shipments = shipments_db.get_filtered({"assigned_driver_id": driver_id})
    for s in active_shipments:
        if s.get("status") in ["in_transit", "assigned"]:
            # GPS Speed Guard
            prev_loc = s.get("current_location")
            last_update = s.get("last_location_time")
            from datetime import timezone
            now = datetime.now(timezone.utc)
            
            if prev_loc and last_update:
                from backend.services.route_engine import haversine
                dist_jump = haversine(prev_loc.get("lat", 0), prev_loc.get("lng", 0), location.get("lat", 0), location.get("lng", 0))
                try:
                    last_time = datetime.fromisoformat(last_update.replace('Z', '+00:00'))
                    if last_time.tzinfo is None:
                        last_time = last_time.replace(tzinfo=timezone.utc)
                    seconds = (now - last_time).total_seconds()
                    if seconds > 10:
                        kmh = (dist_jump / seconds) * 3600
                        from backend.services.simulation_engine import simulation_engine
                        if kmh > 120 and simulation_engine.is_running:
                            return {"message": "GPS Jump Detected: Location rejected."}
                except: pass

            shipments_db.update(s["id"], {
                "current_location": location,
                "last_location_time": now.isoformat() + "Z"
            })
            check_weather_alerts(s, location.get("lat"), location.get("lng"))
            
            # AI Weather Reroute Check
            from backend.services.route_engine import check_and_reroute_calamities
            if check_and_reroute_calamities(s):
                continue
            
            # Update Vehicle Distance & Health Score
            driver = drivers_db.get_by_id(driver_id)
            if driver:
                v_id = driver.get("assigned_vehicle_id")
                if v_id and prev_loc and last_update:
                    from backend.services.route_engine import haversine
                    dist_jump = haversine(prev_loc.get("lat", 0), prev_loc.get("lng", 0), location.get("lat", 0), location.get("lng", 0))
                    if dist_jump > 0.001:
                        v = vehicles_db.get_by_id(v_id)
                        if v:
                            new_dist = v.get("total_distance_km", 0.0) + dist_jump
                            last_serv = v.get("last_service_km", 0.0)
                            dist_since_service = new_dist - last_serv
                            health = max(0.0, 100.0 - (dist_since_service / 5000.0) * 100.0)
                            vehicles_db.update(v_id, {
                                "total_distance_km": round(new_dist, 2),
                                "kilometers_covered": round(new_dist, 2),
                                "vehicle_health_score": round(health, 2)
                            })
                
                # Update continuous driving time and fatigue score
                if s.get("status") == "in_transit":
                    now_str = now.isoformat() + "Z"
                    update_payload = {}
                    
                    if not driver.get("continuous_driving_start"):
                        update_payload["continuous_driving_start"] = now_str
                        update_payload["fatigue_at_drive_start"] = driver.get("fatigue_score", 0.0)
                    
                    if prev_loc and last_update:
                        try:
                            last_time = datetime.fromisoformat(last_update.replace('Z', '+00:00'))
                            if last_time.tzinfo is None:
                                last_time = last_time.replace(tzinfo=timezone.utc)
                            hours_elapsed = (now - last_time).total_seconds() / 3600.0
                            if hours_elapsed > 0:
                                update_payload["driving_hours"] = driver.get("driving_hours", 0.0) + hours_elapsed
                        except:
                            pass
                    
                    if update_payload:
                        drivers_db.update(driver_id, update_payload)
                        driver = drivers_db.get_by_id(driver_id)
                    
                    from backend.services.driver_intel import calculate_fatigue
                    new_fat = calculate_fatigue(driver)
                    drivers_db.update(driver_id, {"fatigue_score": new_fat})
            
            # Detailed Performance & Safety Check
            driver = drivers_db.get_by_id(driver_id)
            if not driver: continue
            vehicle = vehicles_db.get_by_id(driver["assigned_vehicle_id"]) if driver.get("assigned_vehicle_id") else None
            
            perf = check_shipment_performance(s, driver, vehicle)
            
            # Heatwave Safety Check
            from backend.services.alert_engine import check_heatwave_safety
            if vehicle: check_heatwave_safety(s, vehicle)
            
            # Check for status change to log it
            prev_perf = s.get("performance_stats") or {}
            if perf["status"] != prev_perf.get("status"):
                from backend.models import ShipmentEvent
                status_emoji = "📉" if perf["status"] == "delayed" else ("⚡" if perf["status"] == "early" else "✅")
                log_msg = f"{status_emoji} Performance update: {perf['status'].upper()}. Predicted variance: {perf['diff_mins']}m."
                log = ShipmentEvent(
                    status=perf["status"],
                    message=log_msg,
                    reason=f"AI recalculated ETA. Traffic: {perf['traffic']['level']}. Weather: {perf['weather']}",
                    location=location
                )
                s["logs"] = s.get("logs", []) + [log.model_dump()]
 
            # Automatic Warehouse Checkpoint Logging
            from backend.services.route_engine import haversine
            # We filter by company_id if we have it, otherwise get all warehouses (still fewer than shipments)
            warehouses = warehouses_db.get_filtered({"company_id": s.get("company_id")}) if s.get("company_id") else warehouses_db.get_all()
            in_warehouse = False
            for w in warehouses:
                if not w: continue
                dist = haversine(location.get("lat", 0), location.get("lng", 0), w.get("lat", 0), w.get("lng", 0))
                if dist < 0.5: # within 500m
                    in_warehouse = True
                    if s.get("at_warehouse_id") != w.get("id"):
                        from backend.models import ShipmentEvent
                        checkpoint_log = ShipmentEvent(
                            status="in_transit",
                            message=f"🏭 Arrived at Warehouse: {w['name']}. Undergoing processing.",
                            reason="Automatic Warehouse Proximity Checkpoint",
                            location=location
                        )
                        s["logs"] = s.get("logs", []) + [checkpoint_log.model_dump()]
                        s["at_warehouse_id"] = w["id"]
                        
                        # Update Vehicle Location
                        if driver and driver.get("assigned_vehicle_id"):
                            vehicles_db.update(driver["assigned_vehicle_id"], {
                                "current_warehouse_id": w["id"],
                                "present_warehouse_id": w["id"]
                            })
                        
                        # DRONE-LEG INTEGRATION
                        from backend.services.route_engine import check_drone_viability
                        drone_intel = check_drone_viability(w["lat"], w["lng"], s["drop"]["lat"], s["drop"]["lng"])
                        if drone_intel["viable"] and w.get("drone_count", 0) > 0:
                            from backend.models import ShipmentEvent
                            drone_log = ShipmentEvent(
                                status="in_transit",
                                message=f"🛰️ DRONE DISPATCHED (ID: D-{w['id'][:4]}): Last-mile air segment initiated.",
                                reason=drone_intel["reason"],
                                location={"lat": w["lat"], "lng": w["lng"]}
                            )
                            s["logs"] = s.get("logs", []) + [drone_log.model_dump()]
                            s["status"] = "in_transit"
                            s["stage"] = "Drone Air Delivery"
                            s["route_type"] = "drone-leg"
                            
                            # Decrement drone count in warehouse
                            w["drone_count"] -= 1
                            warehouses_db.update(w["id"], {"drone_count": w["drone_count"]})
                    break

            if not in_warehouse and s.get("at_warehouse_id"):
                wh_id = s.get("at_warehouse_id")
                wh_name = "Warehouse"
                w_obj = JSONDatabase("warehouses").get_by_id(wh_id)
                if w_obj: wh_name = w_obj["name"]
                
                from backend.models import ShipmentEvent
                exit_log = ShipmentEvent(
                    status="in_transit",
                    message=f"🚀 Released from Warehouse: {wh_name}. On route to next destination.",
                    reason="Warehouse processing complete. Transit resumed.",
                    location=location
                )
                s["logs"] = s.get("logs", []) + [exit_log.model_dump()]
                s["at_warehouse_id"] = None # left warehouse

            shipments_db.update(s["id"], {
                "current_location": location, 
                "status": s.get("status", "assigned"),
                "performance_stats": perf,
                "logs": s["logs"],
                "at_warehouse_id": s.get("at_warehouse_id")
            })

    driver = drivers_db.get_by_id(driver_id)
    if driver:
        # If no active transit, make sure continuous_driving_start is None
        active_transit = any(s.get("status") in ["in_transit", "assigned"] for s in active_shipments)
        if not active_transit and driver.get("continuous_driving_start"):
            drivers_db.update(driver_id, {
                "continuous_driving_start": None,
                "last_drive_end": datetime.utcnow().isoformat() + "Z",
                "fatigue_at_drive_end": driver.get("fatigue_score", 0.0)
            })
            driver = drivers_db.get_by_id(driver_id)
        
        from backend.services.driver_intel import calculate_fatigue
        new_fat = calculate_fatigue(driver)
        drivers_db.update(driver_id, {"fatigue_score": new_fat})

    return {"message": "Location updated"}

@router.post("/{driver_id}/fund-request/{shipment_id}")
def request_fund(driver_id: str, shipment_id: str, data: dict, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    req_type = data.get("type") # refuel or toll
    amount = data.get("amount", 0)
    
    # Calculate distance for this leg
    from backend.services.route_engine import haversine
    pickup = shipment.get("pickup", {})
    drop = shipment.get("drop", {})
    dist = haversine(pickup.get("lat", 0), pickup.get("lng", 0), drop.get("lat", 0), drop.get("lng", 0))
    
    # If refuel, we might suggest an amount based on dist and vehicle efficiency
    if req_type == "refuel" and amount == 0:
        vehicle = vehicles_db.get_by_id(shipment.get("assigned_vehicle_id"))
        efficiency = vehicle.get("fuel_efficiency", 15) if vehicle else 15
        fuel_needed = dist / efficiency
        amount = round(fuel_needed * 105, 2) # Mock fuel price 105/L
    
    from backend.models import FundRequest
    # Check for existing pending/approved requests for this shipment to prevent double-dip
    alerts_db = JSONDatabase("alerts")
    existing = alerts_db.get_filtered({"shipment_id": shipment_id, "type": "finance"})
    duplicate = next((a for a in existing if a.get("status") != "resolved" and req_type.upper() in a.get("description", "").upper()), None)
    if duplicate:
        raise HTTPException(status_code=400, detail=f"{req_type.capitalize()} request already pending for this journey.")

    from backend.models import Alert
    alert = Alert(
        company_id=shipment["company_id"],
        driver_id=driver_id,
        shipment_id=shipment_id,
        type="finance",
        severity="high",
        description=f"FUND REQUEST: Driver {driver_id[:5]} requested ₹{amount} for {req_type.upper()}. Leg Distance: {round(dist, 2)}km",
        suggestion=f"Verify leg distance ({round(dist, 2)}km) and release ₹{amount} from Payments Page."
    )
    alerts_db = JSONDatabase("alerts")
    alerts_db.insert(alert.model_dump())
    
    return {"message": f"{req_type.capitalize()} request of ₹{amount} submitted based on {round(dist, 2)}km leg distance.", "amount": amount}

@router.post("/{driver_id}/verify")
async def verify_vehicle(driver_id: str, file: UploadFile = File(...)):
    print(f"[Verification] Received request for driver {driver_id}")
    try:
        driver = drivers_db.get_by_id(driver_id)
        if not driver:
            print(f"[Verification] Error: Driver {driver_id} not found")
            raise HTTPException(status_code=404, detail="Driver not found")
            
        v_id = driver.get("assigned_vehicle_id")
        vehicles_db = JSONDatabase("vehicles")
        expected_plate = "UNKNOWN"
        
        if v_id:
            vehicle = vehicles_db.get_by_id(v_id)
            if vehicle:
                expected_plate = vehicle.get("number_plate", "UNKNOWN")
        
        # Save image to /tmp for OCR (Vercel allows writing only to /tmp)
        ext = file.filename.split('.')[-1]
        filename = f"{uuid.uuid4()}.{ext}"
        filepath = f"/tmp/{filename}"
        
        file_bytes = await file.read()
        with open(filepath, "wb") as buffer:
            buffer.write(file_bytes)
            
        print(f"[Verification] Image saved to {filepath}. Processing OCR...")
            
        # Compress and save image locally
        public_url = save_and_compress_image(file_bytes, filename)
            
        # Process ML
        try:
            ml_result = process_number_plate_image(filepath, expected_plate)
        except Exception as e:
            print(f"[Verification] OCR Process Error: {e}")
            ml_result = {"verified": False, "message": f"OCR Error: {str(e)}", "detected_norm": ""}
        
        print(f"[Verification] OCR Result: {ml_result}")

        # Auto-link logic if no vehicle was assigned
        if not v_id and ml_result.get("detected_norm"):
            try:
                from backend.services.ocr_service import normalize
                found_norm = ml_result["detected_norm"]
                # We can't easily filter by normalized plate in Supabase without a custom RPC or view, 
                # but we can filter by exact plate or just get all for this company if we had it.
                # Since this is a rare operation (verify vehicle), get_all is okay-ish, 
                # but let's try to find it by plate if possible.
                all_vehicles = vehicles_db.get_all()
                target_v = next((v for v in all_vehicles if v and normalize(v.get("number_plate", "")) == found_norm), None)
                if target_v:
                    # Validate compatibility: base hub and vehicle type matching driver's license type
                    d_hub = driver.get("base_warehouse_id")
                    v_hub = target_v.get("base_warehouse_id")
                    d_license = driver.get("license_type")
                    v_type = target_v.get("type")
                    
                    if d_hub == v_hub and d_license == v_type:
                        v_id = target_v["id"]
                        
                        # Unlink any existing links to maintain 1:1 mapping consistency
                        if target_v.get("assigned_driver_id"):
                            drivers_db.update(target_v["assigned_driver_id"], {"assigned_vehicle_id": None})
                        if driver.get("assigned_vehicle_id"):
                            vehicles_db.update(driver["assigned_vehicle_id"], {"assigned_driver_id": None})
                            
                        # Link
                        drivers_db.update(driver_id, {"assigned_vehicle_id": v_id})
                        vehicles_db.update(v_id, {"assigned_driver_id": driver_id})
                        
                        ml_result["verified"] = True
                        ml_result["message"] = f"Vehicle {target_v.get('number_plate')} identified and assigned to you."
                        print(f"[Verification] Auto-linked driver {driver_id} to vehicle {v_id}")
                    else:
                        mismatch_reasons = []
                        if d_hub != v_hub:
                            mismatch_reasons.append("Warehouse hub mismatch")
                        if d_license != v_type:
                            mismatch_reasons.append("License/vehicle type mismatch")
                        
                        ml_result["verified"] = False
                        ml_result["message"] = f"Vehicle {target_v.get('number_plate')} detected but incompatible: {', '.join(mismatch_reasons)}."
                        print(f"[Verification] Auto-link compatibility check failed for driver {driver_id} and vehicle {target_v['id']}")
            except Exception as e:
                print(f"[Verification] Auto-link Error: {e}")

        # Update status
        new_status = "verified" if ml_result.get("verified") else "pending_manual"
        drivers_db.update(driver_id, {
            "verification_status": new_status,
            "verification_image": public_url,
            "verification_message": ml_result["message"]
        })
        
        print(f"[Verification] Status updated to {new_status} for driver {driver_id}")
        
        return {
            "status": new_status,
            "ml_result": ml_result,
            "image_url": public_url
        }
    except Exception as e:
        import traceback
        print(f"[Verification] CRITICAL ERROR: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{driver_id}/scan-cargo/{shipment_id}")
async def scan_cargo(driver_id: str, shipment_id: str, file: UploadFile = File(...)):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment or shipment.get("assigned_driver_id") != driver_id:
        raise HTTPException(status_code=403, detail="Unauthorized")
        
    # Save image for manager visibility
    ext = file.filename.split('.')[-1]
    filename = f"cargo_scan_{uuid.uuid4()}.{ext}"
    file_bytes = await file.read()
    
    # Compress and save image locally
    public_url = save_and_compress_image(file_bytes, filename)

    from backend.models import ShipmentEvent
    status = "pass"
    msg = "Cargo quality verified. Safe for pickup."
    
    # Mock ML Computer Vision Logic for Cargo Damage
    import hashlib
    file_hash = int(hashlib.md5(file_bytes).hexdigest()[:8], 16)
    is_damaged = (file_hash % 100) < 15 # 15% chance
    
    if is_damaged:
        status = "fail"
        msg = "Damage detected by AI scanner. Packaging integrity compromised."
        log_event = ShipmentEvent(
            status="disputed", 
            message="🚫 AI Cargo Scanner detected damage. Handover halted.", 
            reason=msg,
            photo_url=public_url
        )
        shipment["status"] = "disputed"
        shipment["stage"] = "Damage Dispute"
    else:
        log_event = ShipmentEvent(
            status=shipment["status"], 
            message="✅ Cargo scan verified. Packaging is intact.", 
            reason="AI Visual Verification passed.",
            photo_url=public_url
        )
    
    shipment["logs"] = shipment.get("logs", []) + [log_event.model_dump()]
    shipments_db.update(shipment_id, shipment)
    
    return {"status": status, "message": msg, "image_url": public_url}

@router.post("/{driver_id}/optimize-loading")
async def optimize_loading(driver_id: str, file: UploadFile = File(...)):
    # Fetch active shipment to customize blueprint
    all_shipments = shipments_db.get_filtered({"assigned_driver_id": driver_id})
    active = next((s for s in all_shipments if s.get("status") in ["assigned", "in_transit"]), None)
    
    shipment_desc = active.get("description", "Cargo") if active else "General Cargo"
    weight = active.get("weight", 10) if active else 10
    
    import random
    # Dynamic Blueprint Generation
    blueprint = [
        {"layer": 1, "items": [f"Heavy {shipment_desc}", "Stabilizer Blocks"], "position": "Floor - Rear", "instruction": "Secure base layer with non-slip mats."},
        {"layer": 2, "items": [f"Mid-weight {shipment_desc}" if weight > 20 else "Small Parcels"], "position": "Mid - Center", "instruction": "Use side-wall hooks for stability."},
        {"layer": 3, "items": ["Lightweight Items", "Fragile Tagged Boxes"], "position": "Top - Front", "instruction": "Top-loading only. Do not stack items above this layer."}
    ]
    
    if active and active.get("is_perishable"):
        blueprint[1]["items"].append("❄️ Medicine Cooler / Perishables")
        blueprint[1]["instruction"] = "Place cold-chain items directly under AC vents or in center for insulation."

    utilization = random.uniform(85, 98)
    
    if active:
        shipments_db.update(active["id"], {"loading_blueprint": blueprint})

    return {
        "status": "success",
        "utilization_boost": f"{random.randint(15, 25)}%",
        "total_utilization": f"{utilization:.1f}%",
        "blueprint": blueprint,
        "message": f"AI Spatial Optimization for '{shipment_desc}' Complete."
    }

@router.post("/{driver_id}/upload-evidence")
async def upload_evidence(driver_id: str, file: UploadFile = File(...)):
    # 1. Find active shipment
    all_s = shipments_db.get_filtered({"assigned_driver_id": driver_id})
    active = next((s for s in all_s if s.get("status") in ["assigned", "in_transit"]), None)
    
    ext = file.filename.split('.')[-1]
    filename = f"evidence_{uuid.uuid4()}.{ext}"
    file_bytes = await file.read()
    
    # Compress and save image locally
    public_url = save_and_compress_image(file_bytes, filename)

    # 2. Update shipment history if active
    if active:
        from datetime import datetime
        history = active.get("logs", [])
        history.append({
            "status": active["status"],
            "message": "📸 Delivery/Pickup evidence uploaded by driver.",
            "photo_url": public_url,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })
        shipments_db.update(active["id"], {"logs": history})

    return {"url": public_url, "image_url": public_url}

@router.post("/{driver_id}/incident")
def report_incident(driver_id: str, data: dict):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    incident_type = data.get("type", "unknown")
    desc = data.get("description", "")
    lat = data.get("lat")
    lng = data.get("lng")
    
    from backend.models import ShipmentEvent, Alert
    from backend.database import JSONDatabase
    from backend.services.route_engine import haversine
    # Update driver stats
    if incident_type == "challan":
        driver["challan_count"] = driver.get("challan_count", 0) + 1
        from backend.services.driver_intel import calculate_driver_performance_score
        driver["driving_score"] = calculate_driver_performance_score(driver)
        drivers_db.update(driver_id, driver)
    elif incident_type == "resting":
        # Start mandatory 8h rest period:
        # Clear continuous driving start, save fatigue before rest, set rest start
        current_fatigue = driver.get("fatigue_score", 0.0)
        drivers_db.update(driver_id, {
            "fatigue_before_rest": current_fatigue,
            "last_rest_start": datetime.utcnow().isoformat() + "Z",
            "continuous_driving_start": None,
            "fatigue_at_drive_start": 0.0,
            "fatigue_score": current_fatigue
        })
    elif incident_type in ["toll", "refuel"]:
        # Minor stop log
        pass
        
    all_shipments = shipments_db.get_filtered({"assigned_driver_id": driver_id})
    active = next((s for s in all_shipments if s.get("status") in ["assigned", "in_transit"]), None)
    
    if active:
        # Re-fetch to ensure we have the latest version (including any logs added by background tasks)
        active = shipments_db.get_by_id(active["id"])
        
        # Append log to shipment with location info
        loc_obj = {"lat": lat, "lng": lng} if lat and lng else None
        emoji = "🛠️" if incident_type == "breakdown" else ("👮" if incident_type == "challan" else "📝")
        log = ShipmentEvent(
            status="delayed" if incident_type in ["breakdown", "challan"] else active["status"], 
            message=f"{emoji} Incident Reported: {incident_type.upper()}.", 
            reason=desc if desc else f"Driver reported {incident_type} at {lat}, {lng}.",
            location=loc_obj
        )
        logs = active.get("logs", [])
        logs.append(log.model_dump())
        active["logs"] = logs
        
        if incident_type == "breakdown":
            active["status"] = "delayed"
            active["stage"] = "Vehicle Breakdown"
            
            # Find nearby available vehicles for recovery
            all_v = vehicles_db.get_all()
            nearby_v = []
            if lat and lng:
                warehouses_db = JSONDatabase("warehouses")
                all_w = warehouses_db.get_all()
                for v in all_v:
                    if v.get("status") == "available":
                        w = next((wh for wh in all_w if wh["id"] == v.get("base_warehouse_id")), None)
                        if w:
                            d = haversine(lat, lng, w["lat"], w["lng"])
                            if d < 100: # expanded to 100km
                                nearby_v.append(f"{v['type']} [{v['number_plate']}] - {round(d, 1)}km")
            
            v_suggestion = f"Rescue needed. Nearby: {', '.join(nearby_v[:3]) if nearby_v else 'None'}"
            
            # Update vehicle status
            v_id = driver.get("assigned_vehicle_id")
            if v_id:
                vehicles_db.update(v_id, {"status": "maintenance"})
                
            new_alert = Alert(
                type="breakdown",
                description=f"CRITICAL: Vehicle breakdown reported by {driver['name']} at {lat},{lng}.",
                severity="critical",
                suggestion=v_suggestion,
                shipment_id=active["id"],
                driver_id=driver_id
            )
            alerts_db.insert(new_alert.model_dump())
            
        shipments_db.update(active["id"], active)
        
    return {"message": "Incident logged successfully"}

@router.get("/{driver_id}/dashboard/stats")
def get_driver_stats(driver_id: str):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    if driver.get("company_id"):
        check_and_run_dynamic_reassignment(driver["company_id"])
        # Reload driver after potential notifications update
        driver = drivers_db.get_by_id(driver_id)

    my_ships = shipments_db.get_filtered({"assigned_driver_id": driver_id})
    
    delivered = [s for s in my_ships if s.get("status") == "delivered"]
    timely = [s for s in delivered if s.get("actual_delivery", "") <= s.get("expected_delivery", "9999")]
    timely_percent = (len(timely) / len(delivered) * 100) if delivered else 100
    
    total_earned = sum([s.get("weight", 0) * 5 for s in delivered]) # Mock earnings
    
    # Calculate performance history from last 5 delivered shipments
    # Sort by actual delivery date (oldest to newest)
    sorted_delivered = sorted(delivered, key=lambda x: x.get("actual_delivery", ""), reverse=False)
    
    perf_history = []
    for s in sorted_delivered[-5:]:
        # Score based on punctuality: 100 if on-time, 70 if late
        score = 100 if s.get("actual_delivery", "") <= s.get("expected_delivery", "9999") else 70
        perf_history.append(score)
    
    # Pad with 0s at the beginning if fewer than 5 trips have been completed
    while len(perf_history) < 5:
        perf_history.insert(0, 0)
    
    # Most recent trip breakdown
    latest_trip = sorted_delivered[-1] if sorted_delivered else None
    latest_breakdown = latest_trip.get("points_breakdown") if latest_trip else None
    
    # Vehicle stats
    vehicle_health = 100.0
    fuel_efficiency = 0.0
    v_id = driver.get("assigned_vehicle_id")
    if v_id:
        v = vehicles_db.get_by_id(v_id)
        if v:
            vehicle_health = v.get("vehicle_health_score", 100.0)
            fuel_efficiency = v.get("fuel_efficiency", 0.0)

    return {
        "total_trips": len(my_ships),
        "delivered_count": len(delivered),
        "timely_percent": round(timely_percent, 1),
        "total_points": driver.get("reward_points", 0), # Corrected key
        "latest_breakdown": latest_breakdown,
        "reward_points": driver.get("reward_points", 0),
        "fatigue_score": driver.get("fatigue_score", 0),
        "perf_history": perf_history,
        "vehicle_health": vehicle_health,
        "fuel_efficiency": fuel_efficiency,
        "notifications": driver.get("notifications", [])
    }

@router.post("/{driver_id}/health")
def update_health_metrics(driver_id: str, metrics: Dict[str, Any]):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    hr = int(metrics.get("heart_rate", metrics.get("heart_rate", 70)))
    bp = metrics.get("blood_pressure", "120/80")
    o2 = int(metrics.get("oxygen", metrics.get("oxygen_level", 98)))
    
    driver["health_metrics"] = {
        "heart_rate": hr,
        "blood_pressure": bp,
        "oxygen": o2,
        "stress_index": 0,
        "last_updated": datetime.utcnow().isoformat() + "Z"
    }
    driver["last_health_check"] = datetime.utcnow().isoformat() + "Z"
    driver["last_vitals_update"] = datetime.utcnow().isoformat() + "Z"
    
    # Check if abnormal
    abnormal = False
    if hr < 55 or hr > 110 or o2 < 92:
        abnormal = True
    if bp and "/" in bp:
        try:
            parts = bp.split("/")
            syst = int(parts[0].strip())
            diast = int(parts[1].strip())
            if syst < 90 or syst > 140 or diast < 60 or diast > 95:
                abnormal = True
        except:
            pass
            
    if abnormal:
        driver["is_on_duty"] = False
        message = "Vitals updated successfully, but abnormal vitals detected. You have been placed OFF DUTY."
    else:
        message = "Health metrics updated successfully."
        
    drivers_db.update(driver_id, driver)
    return {"message": message, "is_on_duty": driver["is_on_duty"]}

@router.post("/{driver_id}/update-vitals")
def update_vitals_sim(driver_id: str, metrics: Dict[str, Any]):
    return update_health_metrics(driver_id, metrics)

@router.post("/{driver_id}/health-emergency")
def health_emergency(driver_id: str, location: dict, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    # Find nearest warehouse
    all_whs = warehouses_db.get_all()
    if not all_whs:
        raise HTTPException(status_code=400, detail="No warehouses found")
        
    def get_haversine(l1, ln1, l2, ln2):
        R = 6371
        dl = math.radians(l2 - l1)
        dn = math.radians(ln2 - ln1)
        a = math.sin(dl/2)**2 + math.cos(math.radians(l1)) * math.cos(math.radians(l2)) * math.sin(dn/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    lat, lng = location.get("lat"), location.get("lng")
    nearest = min(all_whs, key=lambda w: get_haversine(lat, lng, w["lat"], w["lng"]))
    
    # Dock driver and vehicle
    drivers_db.update(driver_id, {
        "status": "emergency_dock",
        "current_warehouse_id": nearest["id"],
        "is_on_duty": False
    })
    
    if driver.get("assigned_vehicle_id"):
        vehicles_db.update(driver["assigned_vehicle_id"], {
            "status": "maintenance",
            "current_warehouse_id": nearest["id"]
        })
        
    return {
        "message": "Emergency Docking Initiated",
        "warehouse_name": nearest["name"],
        "warehouse_location": {"lat": nearest["lat"], "lng": nearest["lng"]}
    }

@router.post("/{driver_id}/toggle-duty")
def toggle_duty(driver_id: str, data: dict, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    is_on_duty = data.get("is_on_duty", True)
    
    # Block off-duty if active shipment in transit
    active_shipments = [s for s in shipments_db.get_filtered({"assigned_driver_id": driver_id}) if s.get("status") in ["in_transit", "assigned"]]
    if active_shipments and not is_on_duty:
        raise HTTPException(status_code=400, detail="Cannot go off duty: You have an active assigned shipment.")
        
    if is_on_duty:
        # Check vitals updated within 24 hours
        h_check = driver.get("last_health_check")
        if not h_check:
            raise HTTPException(status_code=400, detail="Vitals Required: Please update your medical health vitals before going on duty.")
        try:
            from datetime import timezone
            check_dt = datetime.fromisoformat(h_check.replace("Z", "+00:00"))
            if check_dt.tzinfo is None:
                check_dt = check_dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            if (now - check_dt).total_seconds() > 24 * 3600:
                raise HTTPException(status_code=400, detail="Vitals Expired: Vitals must be updated every 24 hours. Please update/sync vitals before going on duty.")
        except Exception as e:
            if isinstance(e, HTTPException): raise e
            raise HTTPException(status_code=400, detail="Vitals Error: Please update your medical health vitals before going on duty.")
            
        # Check abnormal vitals
        metrics = driver.get("health_metrics") or {}
        hr = metrics.get("heart_rate", 72)
        bp = metrics.get("blood_pressure", "120/80")
        o2 = metrics.get("oxygen", 98)
        
        if hr < 55 or hr > 110 or o2 < 92:
            raise HTTPException(status_code=400, detail=f"Abnormal Vitals: Heart Rate ({hr} BPM) or SpO2 ({o2}%) is outside safe limits. Duty activation blocked.")
        if bp and "/" in bp:
            try:
                parts = bp.split("/")
                syst = int(parts[0].strip())
                diast = int(parts[1].strip())
                if syst < 90 or syst > 140 or diast < 60 or diast > 95:
                    raise HTTPException(status_code=400, detail=f"Abnormal Vitals: Blood Pressure ({bp}) is outside safe limits. Duty activation blocked.")
            except:
                pass
                
    drivers_db.update(driver_id, {"is_on_duty": is_on_duty})
    return {"message": f"Driver duty status updated to {'ON' if is_on_duty else 'OFF'}", "is_on_duty": is_on_duty}

@router.post("/{driver_id}/breakdown")
def report_breakdown(driver_id: str, location: Dict[str, Any]):
    driver = drivers_db.get_by_id(driver_id)
    if not driver or not driver.get("assigned_vehicle_id"):
        raise HTTPException(status_code=404, detail="Driver or vehicle not found")
    
    vehicle_id = driver["assigned_vehicle_id"]
    vehicles_db.update(vehicle_id, {"status": "maintenance"})
    
    alerts_db.insert({
        "id": str(uuid.uuid4()),
        "company_id": driver["company_id"],
        "type": "breakdown",
        "description": f"🚨 CRITICAL: Driver {driver['name']} reported a MAJOR BREAKDOWN with vehicle {vehicle_id}.",
        "severity": "critical",
        "suggestion": "Automatic rescue vehicle assignment initiated.",
        "driver_id": driver_id,
        "timestamp": datetime.utcnow().isoformat()
    })
    
    from backend.services.assignment import assign_rescue_vehicle
    res = assign_rescue_vehicle(driver_id, vehicle_id, location)
    
    if res:
        breakdowns_db = JSONDatabase("breakdowns")
        breakdowns_db.insert({
            "id": str(uuid.uuid4()),
            "driver_id": driver_id,
            "vehicle_id": vehicle_id,
            "original_wage_total": res["original_wage_total"],
            "split_wage": res["split_wage"],
            "ratio": res["ratio"],
            "coordinates": location,
            "status": "pending_repair",
            "company_id": driver["company_id"],
            "timestamp": datetime.utcnow().isoformat()
        })
        
    return {"message": "Breakdown reported and rescue initiated", "rescue": res}

@router.post("/{driver_id}/maintenance-complete")
def maintenance_complete(driver_id: str):
    driver = drivers_db.get_by_id(driver_id)
    if not driver or not driver.get("assigned_vehicle_id"):
        raise HTTPException(status_code=404, detail="Driver or vehicle not found")
        
    vehicle_id = driver["assigned_vehicle_id"]
    vehicle = vehicles_db.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    # Find pending breakdowns for this vehicle
    breakdowns_db = JSONDatabase("breakdowns")
    pending = [b for b in breakdowns_db.get_all() if b and b.get("vehicle_id") == vehicle_id and b.get("status") == "pending_repair"]
    
    for bk in pending:
        orig_driver_id = bk["driver_id"]
        orig_driver = drivers_db.get_by_id(orig_driver_id)
        if orig_driver:
            split_wage = bk.get("split_wage", 0.0)
            new_bal = orig_driver.get("wallet_balance", 0.0) + split_wage
            new_total = orig_driver.get("total_earnings", 0.0) + split_wage
            drivers_db.update(orig_driver_id, {
                "wallet_balance": round(new_bal, 2),
                "total_earnings": round(new_total, 2)
            })
            
            # Log as Expense in Ledger
            ledger_db = JSONDatabase("ledger")
            ledger_db.insert({
                "type": "EXPENSE",
                "desc": f"Driver Payout (Breakdown Share): {orig_driver.get('name')} for breakdown split (Wage: {bk.get('original_wage_total')}, Ratio: {round(bk.get('ratio', 0) * 100, 1)}%)",
                "amount": split_wage,
                "timestamp": datetime.utcnow().isoformat(),
                "company_id": orig_driver["company_id"]
            })
            
        bk["status"] = "resolved"
        breakdowns_db.update(bk["id"], bk)

    base_wh = vehicle.get("base_warehouse_id")
    vehicles_db.update(vehicle_id, {
        "status": "available",
        "present_warehouse_id": base_wh,
        "current_warehouse_id": base_wh
    })
    
    # Reset driver status to available and return driver to base warehouse empty
    drivers_db.update(driver_id, {
        "status": "available",
        "current_warehouse_id": base_wh
    })
    
    return {"message": "Vehicle maintenance complete. Original driver paid out (if split), vehicle and driver present warehouse reset to base hub."}

@router.get("/wallet/{driver_id}")
def get_driver_wallet(driver_id: str):
    driver = drivers_db.get_by_id(driver_id)
    if not driver: raise HTTPException(status_code=404, detail="Driver not found")
    
    # Mock transactions based on history
    from datetime import datetime, timedelta
    txs = [
        {"desc": "Last Trip Earnings", "amount": driver.get("wallet_balance", 0), "timestamp": datetime.now().isoformat(), "type": "Trip"},
    ]
    
    # Check if active
    is_active = driver.get("status") in ["assigned", "in_transit"]
    
    # Check food fund
    food_allowed = True
    last_food = driver.get("food_fund_last_date")
    if last_food and last_food.startswith(datetime.utcnow().strftime("%Y-%m-%d")):
        food_allowed = False
        
    # Check maintenance
    maintenance_allowed = True
    vehicle_id = driver.get("assigned_vehicle_id")
    if vehicle_id:
        v = vehicles_db.get_by_id(vehicle_id)
        if v and v.get("checkup_status") == "pending" or v.get("status") == "maintenance":
            maintenance_allowed = False
            
    # Check fuel
    fuel_allowed = True
    if vehicle_id:
        v = vehicles_db.get_by_id(vehicle_id)
        if v:
            km_covered = float(v.get("kilometers_covered", 0))
            funded_until = float(v.get("fuel_funded_until_km", 0))
            if km_covered < funded_until:
                fuel_allowed = False
                
    return {
        "balance": driver.get("wallet_balance", 0),
        "today_earning": driver.get("monthly_earnings", 0) / 30, # Approximation
        "total_earnings": driver.get("total_earnings", 0),
        "monthly_earnings": driver.get("monthly_earnings", 0),
        "transactions": txs,
        "is_active_route": is_active,
        "food_allowed": food_allowed,
        "maintenance_allowed": maintenance_allowed,
        "fuel_allowed": fuel_allowed
    }

@router.post("/{driver_id}/verify-qr/{shipment_id}")
def verify_qr(driver_id: str, shipment_id: str, data: dict, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    qr_input = str(data.get("qr_data", "")).strip()
    valid_codes = ["MANUAL_OVERRIDE"]
    if shipment.get("pickup_code"):
        valid_codes.append(str(shipment["pickup_code"]).strip())
    if shipment.get("delivery_code"):
        valid_codes.append(str(shipment["delivery_code"]).strip())
    if shipment.get("delivery_otp"):
        valid_codes.append(str(shipment["delivery_otp"]).strip())
    if shipment.get("qr_code_data"):
        valid_codes.append(str(shipment["qr_code_data"]).strip())

    if qr_input not in valid_codes:
        raise HTTPException(status_code=400, detail="Invalid Verification OTP Code")

    # Log manual overrides to driver_audit_log
    override_reason = data.get("override_reason") or ""
    if qr_input == "MANUAL_OVERRIDE" or override_reason:
        import uuid
        from datetime import datetime
        audit_db = JSONDatabase("driver_audit_log")
        audit_db.insert({
            "id": str(uuid.uuid4()),
            "driver_id": driver_id,
            "shipment_id": shipment_id,
            "reason": override_reason or "Manual override by manager",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "action": "manual_override"
        })

    # SEQUENTIAL LEG ENFORCEMENT
    if shipment.get("is_leg"):
        leg_order = shipment.get("leg_order", 1)
        if leg_order > 1:
            p_id = shipment.get("parent_id")
            all_s = shipments_db.get_filtered({"parent_id": p_id})
            prev_leg = next((s for s in all_s if s.get("leg_order") == leg_order - 1), None)
            if prev_leg and prev_leg.get("status") != "delivered":
                raise HTTPException(status_code=400, detail=f"Protocol Violation: Leg {leg_order} cannot begin until Leg {leg_order-1} has been delivered and processed at the hub.")
        
    current_status = shipment.get("status")
    
    from backend.models import ShipmentEvent
    if current_status == "assigned":
        # Pickup logic
        shipments_db.update(shipment_id, {
            "status": "in_transit",
            "stage": "Picked Up",
            "logs": shipment.get("logs", []) + [
                ShipmentEvent(status="in_transit", message="📦 Shipment picked up by driver after QR verification.").model_dump()
            ]
        })
        return {"message": "Pickup verified successfully", "next_status": "in_transit"}
    
    # Warehouse Handoff / Leg Completion
    if shipment.get("is_leg"):
        drop_wh_id = shipment.get('drop_warehouse_id')
        shipments_db.update(shipment_id, {
            "status": "delivered",
            "stage": f"Reached Hub: {drop_wh_id}",
            "logs": shipment.get("logs", []) + [
                ShipmentEvent(status="delivered", message=f"🏭 Warehouse handoff completed at Hub {drop_wh_id}. Leg finalized.").model_dump()
            ]
        })

        # Update Driver and Vehicle current location
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
        driver = drivers_db.get_by_id(driver_id)
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
                # If next leg exists, mark it as pending/awaiting pickup
                shipments_db.update(next_leg["id"], {"status": "pending", "stage": "Awaiting Pickup from Hub"})
                shipments_db.update(p_id, {"stage": f"Transferring: Leg {curr_leg_idx + 2} in progress"})
            else:
                # All legs done, move parent to in_transit for last mile if needed
                # (Normally the last leg IS the delivery to destination)
                shipments_db.update(p_id, {"status": "in_transit", "stage": "Out for Final Delivery"})

        return {"message": "Warehouse handoff verified. Leg completed.", "next_status": "delivered"}

    # General fallback for non-leg warehouse handoffs
    shipments_db.update(shipment_id, {
        "logs": shipment.get("logs", []) + [
            ShipmentEvent(status="in_transit", message="🏭 Warehouse handoff recorded via QR scan.").model_dump()
        ]
    })
    return {"message": "Warehouse handoff verified successfully", "next_status": "in_transit"}

@router.post("/{driver_id}/complete-delivery/{shipment_id}")
def complete_delivery(driver_id: str, shipment_id: str, otp: str, image_url: Optional[str] = None, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    if shipment.get("delivery_otp") != otp:
        raise HTTPException(status_code=400, detail="Invalid Delivery OTP")
        
    if shipment.get("payment_status") != "paid":
        raise HTTPException(status_code=400, detail="Payment Pending: Receiver must complete payment before delivery.")
    
    if not image_url:
        raise HTTPException(status_code=400, detail="Proof of delivery image is required.")

    # Calculate distance dynamically
    from backend.services.route_engine import haversine
    pickup = shipment.get("pickup", {})
    drop = shipment.get("drop", {})
    dist = haversine(pickup.get("lat", 0.0), pickup.get("lng", 0.0), drop.get("lat", 0.0), drop.get("lng", 0.0))

    # Calculate trip hours (elapsed time or fallback)
    trip_hours = dist / 45.0
    transit_logs = [l for l in shipment.get("logs", []) if l.get("status") == "in_transit"]
    if transit_logs:
        try:
            start_str = transit_logs[0].get("timestamp")
            if start_str:
                start_dt = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
                now_dt = datetime.utcnow().replace(tzinfo=timezone.utc)
                trip_hours = (now_dt - start_dt).total_seconds() / 3600.0
        except:
            pass
    trip_hours = round(max(0.1, trip_hours), 2)

    # Update Shipment
    from backend.models import ShipmentEvent
    shipments_db.update(shipment_id, {
        "status": "delivered",
        "stage": "Delivered",
        "actual_delivery": datetime.utcnow().isoformat() + "Z",
        "logs": shipment.get("logs", []) + [
            ShipmentEvent(status="delivered", message="🏁 Delivery completed! Product photo uploaded.", photo_url=image_url).model_dump()
        ]
    })

    # Return to base after final delivery
    driver = drivers_db.get_by_id(driver_id)
    if driver:
        base_wh = driver.get("base_warehouse_id")
        drivers_db.update(driver_id, {
            "current_warehouse_id": base_wh,
            "continuous_driving_start": None,
            "last_drive_end": datetime.utcnow().isoformat() + "Z",
            "fatigue_at_drive_end": driver.get("fatigue_score", 0.0)
        })
        v_id = driver.get("assigned_vehicle_id")
        if v_id:
            vehicles_db.update(v_id, {
                "current_warehouse_id": base_wh,
                "present_warehouse_id": base_wh
            })
    
    # Update Driver Wallet & Log Expense
    driver = drivers_db.get_by_id(driver_id)
    finance = shipment.get("finance", {})
    base_wage = finance.get("driver_wage", 0)
    
    # Calculate Punctuality Bonus
    punctuality_bonus = 0
    actual_str = datetime.utcnow().isoformat()
    expected_str = shipment.get("expected_delivery", "")
    if expected_str:
        try:
            actual = datetime.utcnow()
            expected = datetime.fromisoformat(expected_str.replace('Z', ''))
            if actual <= expected:
                punctuality_bonus = round(base_wage * 0.15, 2) # 15% bonus for on-time delivery
        except: pass
        
    total_credit = base_wage + punctuality_bonus
    
    new_balance = driver.get("wallet_balance", 0) + total_credit
    new_total = driver.get("total_earnings", 0) + total_credit
    new_driving_hours = driver.get("driving_hours", 0.0) + trip_hours
    
    # Log as Expense in Ledger
    from backend.database import JSONDatabase
    ledger_db = JSONDatabase("ledger")
    ledger_db.insert({
        "type": "EXPENSE",
        "desc": f"Driver Payout: {driver.get('name')} for Shipment {shipment_id[:8]} (Incl. ₹{punctuality_bonus} bonus)",
        "amount": total_credit,
        "timestamp": datetime.utcnow().isoformat(),
        "company_id": driver["company_id"]
    })
    
    # Update Points (Smart Contract Reward)
    new_points = driver.get("reward_points", 0) + (100 if punctuality_bonus > 0 else 50)
    
    # Update Leaderboard Stats & Punctuality
    total_trips = driver.get("total_trips", 0) + 1
    old_punctuality = driver.get("punctuality_rate", 100.0)
    is_on_time = (punctuality_bonus > 0)
    
    # Running average for punctuality
    new_punctuality = (old_punctuality * (total_trips - 1) + (100.0 if is_on_time else 0.0)) / total_trips
    
    drivers_db.update(driver_id, {
        "wallet_balance": new_balance,
        "total_earnings": new_total,
        "monthly_earnings": driver.get("monthly_earnings", 0) + total_credit,
        "reward_points": new_points,
        "deliveries_completed": total_trips,
        "total_trips": total_trips,
        "driving_hours": round(new_driving_hours, 2),
        "punctuality_rate": round(new_punctuality, 2)
    })
    
    v_id = driver.get("assigned_vehicle_id")
    if v_id:
        v = vehicles_db.get_by_id(v_id)
        if v:
            new_dist = v.get("total_distance_km", 0.0) + dist
            last_serv = v.get("last_service_km", 0.0)
            dist_since_service = new_dist - last_serv
            health = max(0.0, 100.0 - (dist_since_service / 5000.0) * 100.0)
            vehicles_db.update(v_id, {
                "total_distance_km": round(new_dist, 2),
                "kilometers_covered": round(new_dist, 2),
                "vehicle_health_score": round(health, 2),
                "deliveries_completed": v.get("deliveries_completed", 0) + 1,
                "utilization_hours": v.get("utilization_hours", 0) + (dist / 40)
            })
    
    return {"message": f"Delivery Complete! ₹{total_credit} credited to your wallet.", "new_balance": new_balance}

@router.post("/{driver_id}/verify-pickup/{shipment_id}")
def verify_pickup(driver_id: str, shipment_id: str, code: str = Query(...), x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    # Check if code matches
    expected = shipment.get("pickup_code")
    if not expected:
        expected = shipment.get("qr_code_data") or shipment_id
        
    if str(expected).strip() != str(code).strip() and str(code).strip() != "MANUAL_OVERRIDE":
        raise HTTPException(status_code=400, detail="Invalid Pickup Verification Code")
        
    # Sequential leg enforcement
    if shipment.get("is_leg"):
        leg_order = shipment.get("leg_order", 1)
        if leg_order > 1:
            p_id = shipment.get("parent_id")
            all_s = shipments_db.get_filtered({"parent_id": p_id})
            prev_leg = next((s for s in all_s if s.get("leg_order") == leg_order - 1), None)
            if prev_leg and prev_leg.get("status") != "delivered":
                raise HTTPException(status_code=400, detail=f"Protocol Violation: Leg {leg_order} cannot begin until Leg {leg_order-1} has been delivered and processed at the hub.")
                
    # Update shipment to in_transit
    from backend.models import ShipmentEvent
    shipments_db.update(shipment_id, {
        "status": "in_transit",
        "stage": "Picked Up",
        "logs": shipment.get("logs", []) + [
            ShipmentEvent(status="in_transit", message="📦 Shipment picked up by driver after code verification.").model_dump()
        ]
    })
    
    # Also update parent shipment stage if it exists
    p_id = shipment.get("parent_id")
    if p_id:
        parent = shipments_db.get_by_id(p_id)
        if parent:
            shipments_db.update(p_id, {
                "status": "in_transit",
                "stage": f"Transferring: Leg {shipment.get('leg_order', 1)} in progress"
            })
            
    return {"message": "Pickup verified successfully", "next_status": "in_transit"}

@router.post("/{driver_id}/start-transit/{shipment_id}")
def start_transit(driver_id: str, shipment_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    # Intermediate leg enforcement
    if shipment.get("is_leg"):
        leg_order = shipment.get("leg_order", 1)
        if leg_order > 1:
            p_id = shipment.get("parent_id")
            all_s = shipments_db.get_filtered({"parent_id": p_id})
            prev_leg = next((s for s in all_s if s.get("leg_order") == leg_order - 1), None)
            if prev_leg and prev_leg.get("status") != "delivered":
                raise HTTPException(status_code=400, detail=f"Protocol Violation: Leg {leg_order} cannot begin until Leg {leg_order-1} has been delivered and processed at the hub.")
                
    # Update shipment to in_transit
    from backend.models import ShipmentEvent
    shipments_db.update(shipment_id, {
        "status": "in_transit",
        "stage": "Transit Started",
        "logs": shipment.get("logs", []) + [
            ShipmentEvent(status="in_transit", message="🚚 Driver started transit for intermediate route segment.").model_dump()
        ]
    })
    
    p_id = shipment.get("parent_id")
    if p_id:
        parent = shipments_db.get_by_id(p_id)
        if parent:
            shipments_db.update(p_id, {
                "status": "in_transit",
                "stage": f"Transferring: Leg {shipment.get('leg_order', 1)} in progress"
            })
            
    return {"message": "Transit started successfully", "next_status": "in_transit"}

@router.post("/{driver_id}/complete-delivery-code/{shipment_id}")
def complete_delivery_code(driver_id: str, shipment_id: str, code: str = Query(...), image_url: Optional[str] = None, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    # Verify code
    expected = shipment.get("delivery_code")
    if not expected:
        expected = shipment.get("delivery_otp") or shipment.get("qr_code_data") or shipment_id
        
    if str(expected).strip() != str(code).strip() and str(code).strip() != "MANUAL_OVERRIDE":
        raise HTTPException(status_code=400, detail="Invalid Delivery Verification Code")
        
    if shipment.get("payment_status") != "paid":
        raise HTTPException(status_code=400, detail="Payment Pending: Receiver must complete payment before delivery.")
        
    if not image_url:
        raise HTTPException(status_code=400, detail="Proof of delivery image is required.")

    # Calculate distance dynamically
    from backend.services.route_engine import haversine
    pickup = shipment.get("pickup", {})
    drop = shipment.get("drop", {})
    dist = haversine(pickup.get("lat", 0.0), pickup.get("lng", 0.0), drop.get("lat", 0.0), drop.get("lng", 0.0))

    # Calculate trip hours (elapsed time or fallback)
    trip_hours = dist / 45.0
    transit_logs = [l for l in shipment.get("logs", []) if l.get("status") == "in_transit"]
    if transit_logs:
        try:
            start_str = transit_logs[0].get("timestamp")
            if start_str:
                start_dt = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
                now_dt = datetime.utcnow().replace(tzinfo=timezone.utc)
                trip_hours = (now_dt - start_dt).total_seconds() / 3600.0
        except:
            pass
    trip_hours = round(max(0.1, trip_hours), 2)

    # Update Shipment
    from backend.models import ShipmentEvent
    shipments_db.update(shipment_id, {
        "status": "delivered",
        "stage": "Delivered",
        "actual_delivery": datetime.utcnow().isoformat() + "Z",
        "logs": shipment.get("logs", []) + [
            ShipmentEvent(status="delivered", message="🏁 Delivery completed! Product photo uploaded.", photo_url=image_url).model_dump()
        ]
    })

    # Return to base after final delivery
    driver = drivers_db.get_by_id(driver_id)
    if driver:
        base_wh = driver.get("base_warehouse_id")
        drivers_db.update(driver_id, {
            "current_warehouse_id": base_wh,
            "continuous_driving_start": None,
            "last_drive_end": datetime.utcnow().isoformat() + "Z",
            "fatigue_at_drive_end": driver.get("fatigue_score", 0.0)
        })
        v_id = driver.get("assigned_vehicle_id")
        if v_id:
            vehicles_db.update(v_id, {
                "current_warehouse_id": base_wh,
                "present_warehouse_id": base_wh
            })
    
    # Update Driver Wallet & Log Expense
    driver = drivers_db.get_by_id(driver_id)
    finance = shipment.get("finance", {})
    base_wage = finance.get("driver_wage", 0)
    
    # Calculate Punctuality Bonus
    punctuality_bonus = 0
    actual_str = datetime.utcnow().isoformat()
    expected_str = shipment.get("expected_delivery", "")
    if expected_str:
        try:
            actual = datetime.utcnow()
            expected = datetime.fromisoformat(expected_str.replace('Z', ''))
            if actual <= expected:
                punctuality_bonus = round(base_wage * 0.15, 2)
        except: pass
        
    total_credit = base_wage + punctuality_bonus
    
    new_balance = driver.get("wallet_balance", 0) + total_credit
    new_total = driver.get("total_earnings", 0) + total_credit
    new_driving_hours = driver.get("driving_hours", 0.0) + trip_hours
    
    # Log as Expense in Ledger
    from backend.database import JSONDatabase
    ledger_db = JSONDatabase("ledger")
    ledger_db.insert({
        "type": "EXPENSE",
        "desc": f"Driver Payout: {driver.get('name')} for Shipment {shipment_id[:8]} (Incl. ₹{punctuality_bonus} bonus)",
        "amount": total_credit,
        "timestamp": datetime.utcnow().isoformat(),
        "company_id": driver["company_id"]
    })
    
    # Update Points (Smart Contract Reward)
    new_points = driver.get("reward_points", 0) + (100 if punctuality_bonus > 0 else 50)
    
    # Update Leaderboard Stats & Punctuality
    total_trips = driver.get("total_trips", 0) + 1
    old_punctuality = driver.get("punctuality_rate", 100.0)
    is_on_time = (punctuality_bonus > 0)
    
    # Running average for punctuality
    new_punctuality = (old_punctuality * (total_trips - 1) + (100.0 if is_on_time else 0.0)) / total_trips
    
    drivers_db.update(driver_id, {
        "wallet_balance": new_balance,
        "total_earnings": new_total,
        "monthly_earnings": driver.get("monthly_earnings", 0) + total_credit,
        "reward_points": new_points,
        "deliveries_completed": total_trips,
        "total_trips": total_trips,
        "driving_hours": round(new_driving_hours, 2),
        "punctuality_rate": round(new_punctuality, 2)
    })
    
    v_id = driver.get("assigned_vehicle_id")
    if v_id:
        v = vehicles_db.get_by_id(v_id)
        if v:
            new_dist = v.get("total_distance_km", 0.0) + dist
            last_serv = v.get("last_service_km", 0.0)
            dist_since_service = new_dist - last_serv
            health = max(0.0, 100.0 - (dist_since_service / 5000.0) * 100.0)
            vehicles_db.update(v_id, {
                "total_distance_km": round(new_dist, 2),
                "kilometers_covered": round(new_dist, 2),
                "vehicle_health_score": round(health, 2),
                "deliveries_completed": v.get("deliveries_completed", 0) + 1,
                "utilization_hours": v.get("utilization_hours", 0) + (dist / 40)
            })
            
    # If this is part of a split shipment, check if parent should be finalized
    p_id = shipment.get("parent_id")
    if p_id:
        all_ships = shipments_db.get_filtered({"parent_id": p_id})
        parent = shipments_db.get_by_id(p_id)
        legs = sorted(all_ships, key=lambda x: x.get("leg_order", 0))
        
        # Check if all legs are delivered
        all_delivered = all(l.get("status") == "delivered" for l in legs)
        if all_delivered and parent:
            shipments_db.update(p_id, {"status": "delivered", "stage": "Delivered"})
            
    return {"message": f"Delivery Complete! ₹{total_credit} credited to your wallet.", "new_balance": new_balance}

@router.post("/{driver_id}/request-funds")
def request_funds(driver_id: str, data: dict):
    # amount, type (fuel, food), remaining_km
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    if driver.get("status") not in ["assigned", "in_transit"]:
        raise HTTPException(status_code=400, detail="You must be active on a route to request emergency funds.")

    amount = data.get("amount", 0)
    f_type = data.get("type", "FUEL").upper()
    remaining_km = float(data.get("remaining_km", 0))
    
    from datetime import datetime
    
    if f_type == "FOOD":
        last_food = driver.get("food_fund_last_date")
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        if last_food and last_food.startswith(today_str):
            raise HTTPException(status_code=400, detail="Food fund is limited to one request per day.")
        drivers_db.update(driver_id, {"food_fund_last_date": today_str})
        
    elif f_type == "MAINTENANCE":
        vehicle_id = driver.get("assigned_vehicle_id")
        if vehicle_id:
            v = vehicles_db.get_by_id(vehicle_id)
            if v and (v.get("checkup_status") == "pending" or v.get("status") == "maintenance"):
                raise HTTPException(status_code=400, detail="Maintenance already requested/active. Mark vehicle as fixed first.")
            vehicles_db.update(vehicle_id, {"checkup_status": "pending"})
            
    elif f_type == "FUEL":
        vehicle_id = driver.get("assigned_vehicle_id")
        if vehicle_id:
            v = vehicles_db.get_by_id(vehicle_id)
            if v:
                km_covered = float(v.get("kilometers_covered", 0))
                funded_until = float(v.get("fuel_funded_until_km", 0))
                if km_covered < funded_until:
                    raise HTTPException(status_code=400, detail="Fuel fund locked. Previous fuel distance has not been fully covered yet.")
                vehicles_db.update(vehicle_id, {"fuel_funded_until_km": km_covered + remaining_km})

    from backend.models import Alert
    alerts_db = JSONDatabase("alerts")
    new_alert = Alert(
        company_id=driver["company_id"],
        type="finance",
        description=f"FUND REQUEST: Driver {driver['name']} requested ₹{amount} for {f_type.upper()}.",
        severity="medium",
        suggestion="Review and approve via Paisa-Fast portal.",
        driver_id=driver_id
    )
    alerts_db.insert(new_alert.model_dump())
    return {"message": "Request sent to manager."}

@router.get("/{driver_id}/calculate-fuel")
def calculate_fuel_need(driver_id: str, lat: float, lng: float, remaining_km: float = 300.0):
    # 1. Reverse geocode to get state (Simplified mock)
    # In real life, use Nominatim or a state-boundary check
    state = "Delhi"
    if lat < 25: state = "Maharashtra"
    if lat < 20: state = "Karnataka"
    if lng > 85: state = "West Bengal"
    
    from backend.routers.fuel_oracle import FUEL_PRICES
    price_info = FUEL_PRICES.get(state, FUEL_PRICES["Delhi"])
    
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        # Fallback for demo if driver session is weird
        return {"suggested_amount": 1500, "price_per_liter": price_info["diesel"], "state": state}

    v_id = driver.get("assigned_vehicle_id")
    mileage = 15.0 # default
    v_type = "van"
    if v_id:
        v = vehicles_db.get_by_id(v_id)
        if v:
            mileage = float(v.get("fuel_efficiency", 15.0))
            v_type = v.get("type", "van")
            
    if remaining_km <= 0:
        remaining_km = 300.0
            
    # Calculate suggested amount for remaining_km range
    price = price_info["diesel"] if any(x in v_type.lower() for x in ["truck", "van"]) else price_info["petrol"]
    suggested = (remaining_km / (mileage or 15)) * price
    
    return {
        "suggested_amount": round(suggested, 2),
        "price_per_liter": price,
        "state": state,
        "remaining_km": remaining_km
    }

@router.post("/{driver_id}/request-checkup")
def request_checkup(driver_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    v_id = driver.get("assigned_vehicle_id")
    if not v_id:
        raise HTTPException(status_code=400, detail="No vehicle linked to driver.")
        
    vehicle = vehicles_db.get_by_id(v_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Linked vehicle not found.")
        
    vehicles_db.update(v_id, {"checkup_status": "pending"})
    
    # Generate alert for checkup
    from backend.models import Alert
    alerts_db = JSONDatabase("alerts")
    new_alert = Alert(
        company_id=driver["company_id"],
        type="maintenance",
        description=f"🔧 VEHICLE CHECKUP REQUEST: Driver {driver['name']} has requested a health checkup for vehicle {vehicle.get('number_plate')}.",
        severity="medium",
        suggestion="Review and approve checkup from Fleet page.",
        driver_id=driver_id
    )
    alerts_db.insert(new_alert.model_dump())
    
    return {"message": "Checkup request submitted. Please wait for manager approval.", "checkup_status": "pending"}

@router.post("/{driver_id}/end-rest")
def end_rest(driver_id: str):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    drivers_db.update(driver_id, {
        "last_rest_start": None,
        "fatigue_before_rest": 0.0,
        "fatigue_score": 0.0,
        "continuous_driving_start": None,
        "fatigue_at_drive_start": 0.0
    })
    return {"message": "Rest period completed successfully."}


def check_and_run_dynamic_reassignment(company_id: str):
    from backend.database import JSONDatabase
    from backend.services.assignment import auto_assign_shipment, check_calamity_zone, is_weather_disrupted
    from datetime import datetime
    import uuid

    shipments_db = JSONDatabase("shipments")
    drivers_db = JSONDatabase("drivers")

    all_shipments = shipments_db.get_filtered({"company_id": company_id, "status": "assigned"})
    for s in all_shipments:
        if s.get("status") != "assigned":
            continue
        
        driver_id = s.get("assigned_driver_id")
        vehicle_id = s.get("assigned_vehicle_id")
        if not driver_id or not vehicle_id:
            continue

        # Check if weather/calamity disrupts this assignment
        p_lat, p_lng = s["pickup"]["lat"], s["pickup"]["lng"]
        d_lat, d_lng = s["drop"]["lat"], s["drop"]["lng"]

        # 1. Calamity check
        p_calamity = check_calamity_zone(p_lat, p_lng, company_id)
        d_calamity = check_calamity_zone(d_lat, d_lng, company_id)

        disrupted = False
        reason = ""

        if p_calamity:
            disrupted = True
            reason = f"Active calamity ({p_calamity.get('type', 'disaster').upper()}) in pickup area."
        elif d_calamity:
            disrupted = True
            reason = f"Active calamity ({d_calamity.get('type', 'disaster').upper()}) in destination area."
        else:
            # 2. Vehicle-specific weather check
            vehicles_db = JSONDatabase("vehicles")
            vehicle = vehicles_db.get_by_id(vehicle_id)
            if vehicle:
                v_type = str(vehicle.get("type", "")).lower()
                is_bike_scooty = "bike" in v_type or "scooty" in v_type or "scooter" in v_type
                is_drone = "drone" in v_type
                if is_bike_scooty or is_drone:
                    weather_disrupted = is_weather_disrupted(p_lat, p_lng, company_id) or is_weather_disrupted(d_lat, d_lng, company_id)
                    if weather_disrupted:
                        disrupted = True
                        reason = f"Weather disruption makes vehicle type '{v_type}' unsuitable."

        if disrupted:
            _v_db = JSONDatabase("vehicles")

            # --- FREE OLD DRIVER & VEHICLE ---
            # Clear old driver's vehicle link
            orig_driver = drivers_db.get_by_id(driver_id)
            if orig_driver:
                notifications = orig_driver.get("notifications", [])
                notifications.append({
                    "id": str(uuid.uuid4()),
                    "shipment_id": s["id"],
                    "title": "Task Deassignment Notice ⚠️",
                    "message": f"Order '{s.get('description', s['id'])}' has been removed from your dashboard due to a safety hazard: {reason}. Please check back for further instructions.",
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "read": False
                })
                drivers_db.update(driver_id, {
                    **orig_driver,
                    "notifications": notifications,
                    "assigned_vehicle_id": None
                })

            # Free old vehicle
            if vehicle_id:
                _v_db.update(vehicle_id, {
                    "assigned_driver_id": None,
                    "status": "available"
                })

            # Clear stale location so manager map does not show backdated route
            s["assigned_driver_id"] = None
            s["assigned_vehicle_id"] = None
            s["current_location"] = None

            # Perform re-assignment (may fail if calamity zone blocks it)
            s_temp = s.copy()
            res = auto_assign_shipment(s_temp)
            new_driver_id = res.get("assigned_driver_id") if res and "error" not in res else None
            new_vehicle_id = res.get("assigned_vehicle_id") if res and "error" not in res else None

            if new_driver_id:
                # Link new driver to vehicle
                drivers_db.update(new_driver_id, {"assigned_vehicle_id": new_vehicle_id})
                _v_db.update(new_vehicle_id, {
                    "assigned_driver_id": new_driver_id,
                    "status": "assigned"
                })

                # Generate fresh verification codes for the new driver
                new_pickup_code = str(random.randint(100, 999))
                new_delivery_code = str(random.randint(1000, 9999))

                s["assigned_driver_id"] = new_driver_id
                s["assigned_vehicle_id"] = new_vehicle_id
                s["status"] = "assigned"
                s["stage"] = "Assigned to Driver"
                s["pickup_code"] = new_pickup_code
                s["delivery_code"] = new_delivery_code
                s["logs"] = s.get("logs", []) + [{
                    "status": "assigned",
                    "message": f"🔄 Dynamic Reassignment: New fleet dispatched due to: {reason}. Fresh verification codes issued.",
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }]
            else:
                # No replacement found — halt and let manager resolve manually
                s["status"] = "pending"
                s["stage"] = "Halted: Calamity Zone"
                s["logs"] = s.get("logs", []) + [{
                    "status": "pending",
                    "message": f"⚠️ Shipment halted: {reason}. No eligible replacement fleet found — manual assignment required.",
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }]

            shipments_db.update(s["id"], s)


@router.get("/{driver_id}/notifications")
def get_driver_notifications(driver_id: str):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    return driver.get("notifications", [])


@router.post("/{driver_id}/notifications/read")
def mark_notifications_read(driver_id: str, data: dict):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    notif_id = data.get("notification_id")
    notifications = driver.get("notifications", [])
    
    for n in notifications:
        if notif_id is None or n.get("id") == notif_id:
            n["read"] = True
            
    driver["notifications"] = notifications
    drivers_db.update(driver_id, driver)
    return {"message": "Notifications updated successfully."}

