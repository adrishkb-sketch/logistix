from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header
from backend.services.auth_utils import verify_context
from backend.database import JSONDatabase
from typing import Dict, Any, Optional
from backend.services.ocr_service import process_number_plate_image
import os
import uuid
import random
from datetime import datetime

router = APIRouter()
shipments_db = JSONDatabase("shipments")
drivers_db = JSONDatabase("drivers")

@router.get("/{driver_id}/shipments")
def get_driver_shipments(driver_id: str, x_logistix_context: Optional[str] = Header(None)):
    verify_context(driver_id, x_logistix_context)
    from backend.services.cold_chain import calculate_shipment_vitality
    all_shipments = shipments_db.get_all()
    assigned = [s for s in all_shipments if s.get("assigned_driver_id") == driver_id]
    
    # Recalculate vitality for perishables
    for s in assigned:
        if s.get("is_perishable"):
            new_v = calculate_shipment_vitality(s)
            if new_v != s.get("vitality"):
                s["vitality"] = new_v
                shipments_db.update(s["id"], {"vitality": new_v})
                
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
    # In a real app we might update driver's current location.
    # Here we update the shipment's current location if they are carrying one.
    from backend.services.alert_engine import check_weather_alerts
    from backend.services.route_engine import check_shipment_performance
    
    all_shipments = shipments_db.get_all()
    for s in all_shipments:
        if s.get("assigned_driver_id") == driver_id and s.get("status") in ["in_transit", "assigned"]:
            # GPS Speed Guard: Reject jumps faster than 120km/h
            prev_loc = s.get("current_location")
            last_update = s.get("last_location_time")
            now = datetime.utcnow()
            
            if prev_loc and last_update:
                from backend.services.route_engine import haversine
                dist_jump = haversine(prev_loc["lat"], prev_loc["lng"], location["lat"], location["lng"])
                try:
                    last_time = datetime.fromisoformat(last_update.replace('Z', ''))
                    seconds = (now - last_time).total_seconds()
                    if seconds > 10: # Only check if at least 10s passed to avoid noise
                        kmh = (dist_jump / seconds) * 3600
                        from backend.services.simulation_engine import simulation_engine
                        if kmh > 120 and not simulation_engine.active:
                            from backend.models import Alert
                            alert = Alert(
                                company_id=s["company_id"],
                                type="fatigue",
                                description=f"SECURITY: Impossible GPS jump ({round(kmh)}km/h) for Driver {driver_id}. Potential spoofing.",
                                severity="high",
                                suggestion="Verify driver coordinates. Signal may be spoofed or hardware malfunctioning.",
                                driver_id=driver_id,
                                shipment_id=s["id"]
                            )
                            JSONDatabase("alerts").insert(alert.model_dump())
                            continue # Reject this specific update segment
                except: pass
            
            s["last_location_time"] = now.isoformat() + "Z"

            driver = drivers_db.get_by_id(driver_id)
            vehicles_db = JSONDatabase("vehicles")
            vehicle = vehicles_db.get_by_id(driver["assigned_vehicle_id"]) if driver.get("assigned_vehicle_id") else None
            
            perf = check_shipment_performance(s, driver, vehicle)
            
            # Heatwave Safety Check
            from backend.services.alert_engine import check_heatwave_safety
            if vehicle:
                check_heatwave_safety(s, vehicle)
            
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
            warehouses = JSONDatabase("warehouses").get_all()
            in_warehouse = False
            for w in warehouses:
                dist = haversine(location["lat"], location["lng"], w["lat"], w["lng"])
                if dist < 0.5: # within 500m
                    in_warehouse = True
                    if s.get("at_warehouse_id") != w["id"]:
                        from backend.models import ShipmentEvent
                        checkpoint_log = ShipmentEvent(
                            status="in_transit",
                            message=f"🏭 Arrived at Warehouse: {w['name']}. Undergoing processing.",
                            reason="Automatic Warehouse Proximity Checkpoint",
                            location=location
                        )
                        s["logs"] = s.get("logs", []) + [checkpoint_log.model_dump()]
                        s["at_warehouse_id"] = w["id"]
                        
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
                from backend.database import JSONDatabase
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
                "status": "in_transit",
                "performance_stats": perf,
                "logs": s["logs"],
                "at_warehouse_id": s.get("at_warehouse_id")
            })
            
            # Real-time weather alerting
            check_weather_alerts(s, location["lat"], location["lng"])
            return {"message": "Location updated", "performance": perf}
    return {"message": "Location updated"}

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
            
        # Upload to Supabase Storage
        from backend.database import supabase
        public_url = None
        if supabase:
            try:
                supabase.storage.from_("logistix-assets").upload(
                    file=file_bytes,
                    path=filename,
                    file_options={"content-type": file.content_type}
                )
                public_url = supabase.storage.from_("logistix-assets").get_public_url(filename)
                print(f"[Verification] Supabase Upload Success: {public_url}")
            except Exception as e:
                print(f"[Verification] Supabase Upload Error: {e}")
                public_url = f"/images/{filename}" # fallback
        else:
            public_url = f"/images/{filename}" # fallback
            
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
                all_vehicles = vehicles_db.get_all()
                target_v = next((v for v in all_vehicles if normalize(v.get("number_plate", "")) == found_norm), None)
                if target_v:
                    v_id = target_v["id"]
                    drivers_db.update(driver_id, {"assigned_vehicle_id": v_id})
                    ml_result["verified"] = True
                    ml_result["message"] = f"Vehicle {target_v.get('number_plate')} identified and assigned to you."
                    print(f"[Verification] Auto-linked driver {driver_id} to vehicle {v_id}")
            except Exception as e:
                print(f"[Verification] Auto-link Error: {e}")

        # Update status
        new_status = "verified" if ml_result["verified"] else "pending_manual"
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
        
    contents = await file.read()
    
    # Mock ML Computer Vision Logic for Cargo Damage
    import random
    import hashlib
    # Deterministic pass/fail based on file contents
    file_hash = int(hashlib.md5(contents).hexdigest()[:8], 16)
    
    # 20% chance of detecting damage
    is_damaged = (file_hash % 100) < 20
    
    if is_damaged:
        from backend.models import ShipmentEvent
        log_event = ShipmentEvent(status="disputed", message="🚫 AI Cargo Scanner detected damage at pickup. Handover halted.", reason="Packaging tear detected by CV.")
        shipment["logs"] = shipment.get("logs", []) + [log_event.model_dump()]
        shipment["status"] = "disputed"
        shipment["stage"] = "Damage Dispute"
        shipments_db.update(shipment_id, shipment)
        return {"status": "fail", "message": "Damage detected. Shipment marked as disputed."}
    
    return {"status": "pass", "message": "Cargo quality verified. Safe for pickup."}

@router.post("/{driver_id}/optimize-loading")
async def optimize_loading(driver_id: str, file: UploadFile = File(...)):
    # In a real app, this would use Computer Vision (CV) to:
    # 1. Detect vehicle dimensions from the photo
    # 2. Detect cargo volume from the photo
    # 3. Calculate 3D Bin Packing
    
    import random
    # Mocked Stacking Blueprint
    blueprint = [
        {"layer": 1, "items": ["Heavy Box A", "Crate B", "Medicine Cooler"], "position": "Floor - Rear", "instruction": "Stack heaviest items first at the base against the cabin wall."},
        {"layer": 2, "items": ["Perishable Box C", "Light Parcel D"], "position": "Mid - Center", "instruction": "Place cold chain items in the center for optimal temperature stability."},
        {"layer": 3, "items": ["Fragile Envelopes"], "position": "Top - Front", "instruction": "Secure fragile envelopes on top using elastic nets."}
    ]
    
    utilization = random.uniform(85, 98)
    
    # Save to active shipment for manager visibility
    all_shipments = shipments_db.get_all()
    active = next((s for s in all_shipments if s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit"]), None)
    if active:
        shipments_db.update(active["id"], {"loading_blueprint": blueprint})

    return {
        "status": "success",
        "utilization_boost": "22%",
        "total_utilization": f"{utilization:.1f}%",
        "blueprint": blueprint,
        "message": "AI Spatial Optimization Complete. 3D Blueprint Generated."
    }

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
    alerts_db = JSONDatabase("alerts")
    vehicles_db = JSONDatabase("vehicles")
    
    # Update driver stats
    if incident_type == "challan":
        driver["challan_count"] = driver.get("challan_count", 0) + 1
        from backend.services.driver_intel import calculate_driver_performance_score
        driver["driving_score"] = calculate_driver_performance_score(driver)
        drivers_db.update(driver_id, driver)
    elif incident_type == "resting":
        # Resting reduces fatigue
        new_fatigue = max(0, driver.get("fatigue_score", 0) - 40)
        drivers_db.update(driver_id, {"fatigue_score": new_fatigue, "last_rest_start": datetime.utcnow().isoformat()})
    elif incident_type in ["toll", "refuel"]:
        # Minor stop log
        pass
        
    # Find active shipment
    all_shipments = shipments_db.get_all()
    active = next((s for s in all_shipments if s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit"]), None)
    
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
        
    all_ships = shipments_db.get_all()
    my_ships = [s for s in all_ships if s.get("assigned_driver_id") == driver_id]
    
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
    
    return {
        "total_trips": len(my_ships),
        "delivered_count": len(delivered),
        "timely_percent": round(timely_percent, 1),
        "total_points": driver.get("reward_points", 0), # Corrected key
        "latest_breakdown": latest_breakdown,
        "reward_points": driver.get("reward_points", 0),
        "fatigue_score": driver.get("fatigue_score", 0),
        "perf_history": perf_history
    }

@router.post("/{driver_id}/health")
def update_health_metrics(driver_id: str, metrics: Dict[str, Any]):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    driver["health_metrics"] = {
        "heart_rate": int(metrics.get("heart_rate", 70)),
        "blood_pressure": metrics.get("blood_pressure", "120/80"),
        "oxygen": int(metrics.get("oxygen", 98)),
        "stress_index": int(metrics.get("stress_index", 10)),
        "last_updated": datetime.utcnow().isoformat()
    }
    drivers_db.update(driver_id, driver)
    return {"message": "Health metrics updated successfully"}

@router.post("/{driver_id}/breakdown")
def report_breakdown(driver_id: str, location: Dict[str, Any]):
    driver = drivers_db.get_by_id(driver_id)
    if not driver or not driver.get("assigned_vehicle_id"):
        raise HTTPException(status_code=404, detail="Driver or vehicle not found")
    
    vehicle_id = driver["assigned_vehicle_id"]
    from backend.database import JSONDatabase
    vehicles_db = JSONDatabase("vehicles")
    vehicles_db.update(vehicle_id, {"status": "maintenance"})
    
    alerts_db = JSONDatabase("alerts")
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
    return {"message": "Breakdown reported and rescue initiated", "rescue": res}

@router.post("/{driver_id}/maintenance-complete")
def maintenance_complete(driver_id: str):
    driver = drivers_db.get_by_id(driver_id)
    if not driver or not driver.get("assigned_vehicle_id"):
        raise HTTPException(status_code=404, detail="Driver or vehicle not found")
        
    vehicle_id = driver["assigned_vehicle_id"]
    from backend.database import JSONDatabase
    vehicles_db = JSONDatabase("vehicles")
    vehicles_db.update(vehicle_id, {"status": "available"})
    return {"message": "Vehicle is now available for duty"}

@router.get("/wallet/{driver_id}")
def get_driver_wallet(driver_id: str):
    driver = drivers_db.get_by_id(driver_id)
    if not driver: raise HTTPException(status_code=404, detail="Driver not found")
    
    # Mock transactions based on history
    from datetime import datetime, timedelta
    txs = [
        {"desc": "Last Trip Earnings", "amount": driver.get("wallet_balance", 0), "timestamp": datetime.now().isoformat(), "type": "Trip"},
    ]
    
    return {
        "balance": driver.get("wallet_balance", 0),
        "today_earning": driver.get("monthly_earnings", 0) / 30, # Approximation
        "total_earnings": driver.get("total_earnings", 0),
        "monthly_earnings": driver.get("monthly_earnings", 0),
        "transactions": txs
    }

@router.post("/{driver_id}/complete-delivery/{shipment_id}")
def complete_delivery(driver_id: str, shipment_id: str, otp: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment: raise HTTPException(status_code=404, detail="Shipment not found")
    
    if shipment.get("delivery_otp") != otp:
        raise HTTPException(status_code=400, detail="Invalid Delivery OTP")
        
    if shipment.get("payment_status") != "paid":
        raise HTTPException(status_code=400, detail="Payment Pending: Manager must confirm payment before delivery release.")
        
    # Update Shipment
    shipments_db.update(shipment_id, {
        "status": "delivered",
        "stage": "Delivered",
        "actual_delivery": datetime.utcnow().isoformat() + "Z"
    })
    
    # Update Driver Wallet
    driver = drivers_db.get_by_id(driver_id)
    payout = shipment.get("finance", {}).get("driver_payout", 0)
    food = shipment.get("finance", {}).get("food_allowance", 0)
    total_credit = payout + food
    
    new_balance = driver.get("wallet_balance", 0) + total_credit
    new_total = driver.get("total_earnings", 0) + total_credit
    
    drivers_db.update(driver_id, {
        "wallet_balance": new_balance,
        "total_earnings": new_total,
        "monthly_earnings": driver.get("monthly_earnings", 0) + total_credit
    })
    
    return {"message": f"Delivery Complete! ₹{total_credit} credited to your wallet.", "new_balance": new_balance}

@router.post("/{driver_id}/request-funds")
def request_funds(driver_id: str, data: dict):
    # amount, type (fuel, food)
    driver = drivers_db.get_by_id(driver_id)
    amount = data.get("amount", 0)
    f_type = data.get("type", "fuel")
    
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
