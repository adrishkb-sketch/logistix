from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from backend.database import JSONDatabase
from typing import Dict, Any
from backend.services.ocr_service import process_number_plate_image
import os
import uuid
import random
from datetime import datetime

router = APIRouter()
shipments_db = JSONDatabase("shipments")
drivers_db = JSONDatabase("drivers")

@router.get("/{driver_id}/shipments")
def get_driver_shipments(driver_id: str):
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
def toggle_zen(driver_id: str, data: dict):
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
def update_driver_location(driver_id: str, location: Dict[str, Any]):
    # In a real app we might update driver's current location.
    # Here we update the shipment's current location if they are carrying one.
    from backend.services.alert_engine import check_weather_alerts
    from backend.services.route_engine import check_shipment_performance
    
    all_shipments = shipments_db.get_all()
    for s in all_shipments:
        if s.get("assigned_driver_id") == driver_id and s.get("status") in ["in_transit", "assigned"]:
            # Recalculate Performance
            driver = drivers_db.get_by_id(driver_id)
            vehicles_db = JSONDatabase("vehicles")
            vehicle = vehicles_db.get_by_id(driver["assigned_vehicle_id"]) if driver.get("assigned_vehicle_id") else None
            
            perf = check_shipment_performance(s, driver, vehicle)
            
            # Check for status change to log it
            prev_perf = s.get("performance_stats") or {}
            if perf["status"] != prev_perf.get("status"):
                from backend.models import ShipmentEvent
                status_emoji = "🔴" if perf["status"] == "delayed" else ("🟢" if perf["status"] == "early" else "🔵")
                log_msg = f"{status_emoji} Performance changed to {perf['status'].upper()}. Predicted Delay: {perf['diff_mins']}m."
                log = ShipmentEvent(
                    status=perf["status"],
                    message=log_msg,
                    reason=f"AI recalculated ETA based on GPS at {location['lat']}, {location['lng']}. Weather: {perf['weather']}",
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
                            message=f"📍 Reached Hub: {w['name']}",
                            reason="Automatic GPS Checkpoint",
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
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    if not driver.get("assigned_vehicle_id"):
        raise HTTPException(status_code=400, detail="No vehicle assigned to driver")
        
    vehicles_db = JSONDatabase("vehicles")
    vehicle = vehicles_db.get_by_id(driver["assigned_vehicle_id"])
    expected_plate = vehicle.get("number_plate", "UNKNOWN")
    
    # Save image
    ext = file.filename.split('.')[-1]
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = f"data/images/{filename}"
    
    with open(filepath, "wb") as buffer:
        buffer.write(await file.read())
        
    # Process ML
    ml_result = process_number_plate_image(filepath, expected_plate)
    
    # Update status
    new_status = "verified" if ml_result["verified"] else "pending_manual"
    drivers_db.update(driver_id, {
        "verification_status": new_status,
        "verification_image": filename,
        "verification_message": ml_result["message"]
    })
    
    return {
        "status": new_status,
        "ml_result": ml_result,
        "image_url": f"/images/{filename}"
    }

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
        log_event = ShipmentEvent(status="disputed", message="AI Cargo Scanner detected damage at pickup. Handover halted.", reason="Packaging tear detected by CV.")
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
        log = ShipmentEvent(
            status="delayed" if incident_type in ["breakdown", "challan"] else active["status"], 
            message=f"ISSUE: {incident_type.upper()} at {lat or 'unknown'}, {lng or 'unknown'}.", 
            reason=desc,
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
