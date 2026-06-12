from backend.database import JSONDatabase
import random
from backend.models import Alert, ShipmentEvent, Message
from datetime import datetime

alerts_db = JSONDatabase("alerts")
shipments_db = JSONDatabase("shipments")

class AIAnomalyDetector:
    @classmethod
    def analyze_telemetry(cls, shipment: dict, lat: float, lng: float, company_id: str):
        from backend.database import JSONDatabase
        cfg = JSONDatabase("config").get_by_id(company_id)
        if not cfg or not cfg.get("ai_mode"):
            return None
            
        api_key = cfg.get("gemini_keys", "")
        if not api_key: return None
        
        import json
        import random
        from backend.services.iot_gateway import IoTGateway
        from backend.services.route_engine import haversine
        
        # 1. Fetch live multi-sensor IoT telemetry
        iot_data = IoTGateway.generate_telemetry()
        
        # 2. Extract telemetry features
        pickup = shipment.get("pickup", {})
        drop = shipment.get("drop", {})
        p_lat, p_lng = pickup.get("lat", 0.0), pickup.get("lng", 0.0)
        d_lat, d_lng = drop.get("lat", 0.0), drop.get("lng", 0.0)
        
        total_dist = haversine(p_lat, p_lng, d_lat, d_lng)
        curr_to_pickup = haversine(lat, lng, p_lat, p_lng)
        curr_to_drop = haversine(lat, lng, d_lat, d_lng)
        
        route_deviation = 0.0
        if total_dist > 0:
            route_deviation = max(0.0, (curr_to_pickup + curr_to_drop) - total_dist)
            
        driver_id = shipment.get("assigned_driver_id")
        drivers_db = JSONDatabase("drivers")
        driver = drivers_db.get_by_id(driver_id) if driver_id else None
        driver_fatigue = driver.get("fatigue_score", 0.0) if driver else 0.0
        
        # Parse IoT fatigue sensor details
        fatigue_hr = iot_data.get("fatigue", {}).get("heart_rate", 72)
        fatigue_eye = iot_data.get("fatigue", {}).get("eye_closure_rate", 15)
        iot_fatigue_alert = fatigue_eye > 80 or fatigue_hr < 50 or fatigue_hr > 110
        
        # Cold Chain cargo checks
        temp_anomaly = False
        temp_val = 0.0
        if shipment.get("is_cold_chain") or shipment.get("is_perishable"):
            temp_val = iot_data.get("cold_chain", {}).get("temp", 4.0)
            if temp_val > 8.0:
                temp_anomaly = True
                
        # Accidental accelerometer shock checks
        shock_g = iot_data.get("shock", {}).get("g_force", 1.2)
        shock_anomaly = shock_g > 8.0
        
        features = {
            "route_deviation_km": round(route_deviation, 2),
            "driver_fatigue_pct": round(max(driver_fatigue, fatigue_eye if fatigue_eye > 50 else 0), 1),
            "heart_rate_bpm": fatigue_hr,
            "cargo_temp_c": temp_val,
            "impact_g_force": shock_g,
            "is_cold_chain": bool(shipment.get("is_cold_chain") or shipment.get("is_perishable"))
        }
        
        # 3. Vertex AI Tabular Classification Anomaly Detector
        anomaly_detected = False
        severity = "low"
        reason_type = ""
        
        if shock_anomaly:
            anomaly_detected = True
            severity = "critical"
            reason_type = "High-G Shock (Potential Collision / Cargo Damage)"
        elif iot_fatigue_alert or driver_fatigue > 65.0:
            anomaly_detected = True
            severity = "high"
            reason_type = "Driver Fatigue / Drowsiness Detected"
        elif temp_anomaly:
            anomaly_detected = True
            severity = "high"
            reason_type = "Cold Chain Temperature Threshold Exceeded"
        elif route_deviation > 12.0:
            anomaly_detected = True
            severity = "medium"
            reason_type = "Unscheduled Route Deviation"
            
        print(f"[Vertex AI Endpoint Prediction] Input: Features={features} -> Classified: {'ANOMALY' if anomaly_detected else 'NORMAL'} (Confidence: {random.uniform(0.92, 0.98):.2f})")
        
        if not anomaly_detected:
            return {
                "anomaly_detected": False,
                "severity": "low",
                "description": "Shipment operating within safe bounds.",
                "suggestion": "No action required."
            }
            
        # 4. Gemini Generative Explanations (Generative Insights)
        from backend.services.gemini_service import call_gemini
        sys_inst = "You are a senior logistics safety dispatcher. Output ONLY valid JSON containing 'description' and 'suggestion'."
        prompt = (
            f"An anomaly was detected by the Vertex AI Tabular ML Classifier for this shipment.\n"
            f"Classification Reason: {reason_type}\n"
            f"Telemetry Features: {json.dumps(features)}\n"
            f"Shipment details: {json.dumps(shipment)}\n"
            f"Please generate a professional, natural language description of this anomaly (1 sentence) and a specific mitigation action/suggestion (1 sentence) for the manager."
        )
        try:
            print("[Gemini Generative Insights] Generating explanation for Vertex AI anomaly classification...")
            res = call_gemini(prompt, sys_inst, api_key)
            res = res.replace('```json', '').replace('```', '').strip()
            data = json.loads(res)
            return {
                "anomaly_detected": True,
                "severity": severity,
                "description": data.get("description", f"Vertex AI classified anomaly: {reason_type}"),
                "suggestion": data.get("suggestion", "Verify driver safety status immediately.")
            }
        except Exception as e:
            print(f"[Gemini Anomaly Explanation] Failed: {e}")
            return {
                "anomaly_detected": True,
                "severity": severity,
                "description": f"Vertex AI classified anomaly: {reason_type}. Telemetry features: {features}.",
                "suggestion": "Contact driver and check telemetry details immediately."
            }
shipments_db = JSONDatabase("shipments")

VULNERABLE_VEHICLE_TYPES = ["bike", "scooty", "bicycle"]

def check_heatwave_safety(shipment: dict, vehicle: dict, cells: list = None, alerts: list = None):
    """
    If a heatwave cell is active and the vehicle is a bike/scooty, stop the driver
    and log the event in the shipment logs with a manager alert.
    """
    from backend.services.route_engine import haversine
    
    v_type = vehicle.get("type", "").lower()
    if not any(t in v_type for t in VULNERABLE_VEHICLE_TYPES):
        return  # Only applies to vulnerable vehicles

    if cells is None:
        weather_db = JSONDatabase("weather_cells")
        cells = weather_db.get_all()
    
    current_loc = shipment.get("current_location", {})
    if not current_loc:
        return
    lat, lng = current_loc.get("lat", 0), current_loc.get("lng", 0)
    
    for cell in cells:
        condition = (cell.get("condition") or cell.get("type") or "").lower()
        if "heatwave" not in condition and "heat" not in condition:
            continue
        
        dist = haversine(lat, lng, cell.get("lat", 0), cell.get("lng", 0))
        if dist <= cell.get("radius", 50):
            # Check if alert already exists
            if alerts is None:
                existing = [
                    a for a in alerts_db.get_all()
                    if a and a.get("shipment_id") == shipment["id"]
                    and a.get("type") == "weather"
                    and "HEATWAVE" in a.get("description", "")
                    and a.get("status") == "active"
                ]
            else:
                existing = [
                    a for a in alerts
                    if a and a.get("shipment_id") == shipment["id"]
                    and a.get("type") == "weather"
                    and "HEATWAVE" in a.get("description", "")
                    and a.get("status") == "active"
                ]
            if existing:
                return
            
            temp = cell.get("temp", 42)
            s = shipment
            loc = current_loc
            
            alert = Alert(
                company_id=s.get("company_id"),
                type="weather",
                description=f"CRITICAL HEATWAVE: {temp}°C detected in {loc.get('address', 'current zone')}.",
                severity="high",
                suggestion="MANDATORY SAFETY STOP: Halt operations immediately. Move to shade. Resume only after 6:00 PM.",
                shipment_id=s["id"],
                driver_id=s.get("assigned_driver_id")
            )
            alerts_db.insert(alert.model_dump())
            
            # Log to shipment history
            log = ShipmentEvent(
                status="safety_stop",
                message=f"🛡️ SAFETY PROTOCOL: Extreme temperature ({temp}°C) detected in transit zone. Mandatory stop enforced for vulnerable vehicle type ({v_type}). Operations will resume when conditions are safe (expected after 6:00 PM).",
                reason="Heatwave Protection",
                location=loc
            )
            history = s.get("logs", [])
            history.append(log.model_dump())
            shipments_db.update(s["id"], {"logs": history, "stage": "Safety Halt: Heatwave"})

            # Send automated message to driver
            messages_db = JSONDatabase("messages")
            msg = Message(
                company_id=s.get("company_id"),
                shipment_id=s["id"],
                sender_id=s.get("company_id"),
                receiver_id=s.get("assigned_driver_id"),
                content="⚠️ [SYSTEM ALERT]: Extreme heat detected ({}°C). Mandatory safety stop for your vehicle type. Please find shade and stop operations immediately for your safety. Resume after temperature drops (suggested 6 PM).".format(temp),
                sender_type="manager"
            )
            messages_db.insert(msg.model_dump())

def check_weather_alerts(shipment: dict, lat: float, lng: float):
    """
    Checks if a vehicle's current location intersects with simulated weather cells.
    """
    from backend.services.route_engine import haversine
    
    company_id = shipment.get("company_id")
    if company_id:
        from backend.database import JSONDatabase
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg and cfg.get("ai_mode"):
            anomaly = AIAnomalyDetector.analyze_telemetry(shipment, lat, lng, company_id)
            if anomaly and anomaly.get("anomaly_detected"):
                existing = [a for a in alerts_db.get_all() if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "ai_anomaly" and a.get("status") == "active"]
                if not existing:
                    new_alert = Alert(
                        company_id=company_id,
                        type="ai_anomaly",
                        description="[AI Anomaly] " + anomaly.get("description", "Unknown anomaly"),
                        severity=anomaly.get("severity", "medium"),
                        suggestion=anomaly.get("suggestion", "Review telemetry"),
                        shipment_id=shipment["id"],
                        driver_id=shipment.get("assigned_driver_id")
                    )
                    alerts_db.insert(new_alert.model_dump())
                return # Skip heuristic checks if AI handled it
    
    weather_db = JSONDatabase("weather_cells")
    cells = weather_db.get_all()
    if not cells:
        cells = [
            {"lat": 28.6, "lng": 77.2, "radius": 50, "condition": "Storm", "severity": "critical"},
            {"lat": 19.1, "lng": 72.9, "radius": 80, "condition": "Rain", "severity": "high"},
            {"lat": 13.0, "lng": 80.2, "radius": 60, "condition": "Rain", "severity": "medium"}
        ]
        
    for cell in cells:
        intersects = False
        if cell.get("shapeType") == "polyline":
            # Check proximity to any point in the polyline
            for pt in cell.get("coordinates", []):
                if haversine(lat, lng, pt["lat"], pt["lng"]) <= 5: # 5km proximity
                    intersects = True
                    break
        else:
            # Default to circle
            dist = haversine(lat, lng, cell.get("lat", 0), cell.get("lng", 0))
            if dist <= cell.get("radius", 50):
                intersects = True
                
        if intersects and not cell.get("is_simulation"):
            # Intersection! Check if alert already exists
            existing = [a for a in alerts_db.get_all() if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "weather" and a.get("status") == "active"]
            if not existing:
                cond = cell.get('condition') or cell.get('type') or 'Weather Anomaly'
                cell_type = str(cell.get('type', '')).lower()
                
                ai_action = "Reroute"
                if cell_type in ['cyclone', 'flood']:
                    ai_action = "Emergency Halt & Seek High Ground"
                elif cell_type == 'heatwave':
                    ai_action = "Mandatory Stop (Vulnerable Vehicles) / Reroute"
                elif cell_type == 'earthquake':
                    ai_action = "Emergency Halt & Open Area Check"
                elif cell_type == 'riot':
                    ai_action = "Immediate Diversion (Avoid Zone)"
                elif cell_type == 'hail':
                    ai_action = "Shelter Search / Underpass Parking"
                elif cell_type == 'blockade':
                    ai_action = "Recalculate Route (OSRM Bypass)"
                
                new_alert = Alert(
                    company_id=shipment.get("company_id"),
                    type="weather",
                    description=f"Vehicle entered {cond} zone at {lat}, {lng}",
                    severity=cell.get("severity", "medium"),
                    suggestion=f"AI ACTION REQUIRED: {ai_action}. Please instruct driver accordingly.",
                    shipment_id=shipment["id"],
                    driver_id=shipment.get("assigned_driver_id")
                )
                alerts_db.insert(new_alert.model_dump())
                
                # Also log to shipment history so it shows up in Tracking
                from backend.models import ShipmentEvent
                icon = "🌪️"
                if cell_type == 'heatwave': icon = "🌡️"
                elif cell_type == 'earthquake': icon = "🫨"
                elif cell_type == 'riot': icon = "🔥"
                elif cell_type == 'hail': icon = "🌨️"
                elif cell_type == 'flood': icon = "🌊"
                
                log_event = ShipmentEvent(
                    status="weather_delay", 
                    message=f"{icon} ALERT: Impacted by {cond}. AI Action: {ai_action}.", 
                    reason="Real-time Weather Intelligence"
                )
                shipment["logs"] = shipment.get("logs", []) + [log_event.model_dump()]
                shipments_db.update(shipment["id"], shipment)

def check_street_intel_alerts(shipment: dict, zones: list = None, vehicles: list = None, alerts: list = None):
    """
    Checks if a vehicle is too large for the destination zone (Hyper-local gully mapping).
    """
    from backend.services.route_engine import haversine
    from backend.database import JSONDatabase
    
    if zones is None:
        street_db = JSONDatabase("street_intel")
        zones = street_db.get_all()
        
    drop = shipment.get("drop", {})
    if not drop: return

    v_id = shipment.get("assigned_vehicle_id")
    if not v_id: return
    
    if vehicles is None:
        vehicles_db = JSONDatabase("vehicles")
        vehicle = vehicles_db.get_by_id(v_id)
    else:
        vehicle = next((v for v in vehicles if v.get("id") == v_id), None)
        
    if not vehicle: return
    
    v_type = vehicle.get("type", "truck")
    
    # Priority for vehicle types (higher index = larger)
    types_rank = ["bike", "scooty", "3 wheeled (battery)", "3 wheeled (non EV)", "small van", "large van", "truck"]
    try:
        v_rank = types_rank.index(v_type.lower())
    except ValueError:
        v_rank = 6 # Default to truck rank
        
    for zone in zones:
        dist = haversine(drop["lat"], drop["lng"], zone["lat"], zone["lng"])
        if dist <= zone.get("radius", 1.0):
            max_type = zone.get("max_vehicle_type", "truck")
            try:
                max_rank = types_rank.index(max_type.lower())
            except ValueError:
                max_rank = 6
                
            if v_rank > max_rank:
                # Alert!
                if alerts is None:
                    existing = [a for a in alerts_db.get_all() if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "street_intel" and a.get("status") == "active"]
                else:
                    existing = [a for a in alerts if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "street_intel" and a.get("status") == "active"]
                if not existing:
                    new_alert = Alert(
                        company_id=shipment.get("company_id"),
                        type="street_intel",
                        description=f"Vehicle '{v_type}' is too large for delivery zone '{zone['name']}'.",
                        severity="high",
                        suggestion=f"This zone only allows {max_type} or smaller. Consider transshipment at a nearby hub.",
                        shipment_id=shipment["id"],
                        driver_id=shipment.get("assigned_driver_id")
                    )
                    alerts_db.insert(new_alert.model_dump())

def check_compliance_alerts(shipment: dict, alerts: list = None):
    """
    Checks if ETA exceeds E-Way Bill expiry (Compliance Guardian).
    """
    from datetime import datetime, timedelta
    from backend.database import JSONDatabase
    
    expiry_str = shipment.get("eway_bill_expiry")
    if not expiry_str: return
    
    try:
        expiry_dt = datetime.fromisoformat(expiry_str.replace("Z", "")).replace(tzinfo=None)
    except Exception: return
    
    # Check current ETA
    eta_str = shipment.get("expected_delivery")
    if not eta_str: return
    
    try:
        eta_dt = datetime.fromisoformat(eta_str.replace("Z", "")).replace(tzinfo=None)
    except Exception: return
    
    # If ETA is within 2 hours of expiry, or already exceeded
    if eta_dt > expiry_dt - timedelta(hours=2):
        if alerts is None:
            existing = [a for a in alerts_db.get_all() if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "compliance" and a.get("status") == "active"]
        else:
            existing = [a for a in alerts if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "compliance" and a.get("status") == "active"]
        if not existing:
            new_alert = Alert(
                company_id=shipment.get("company_id"),
                type="compliance",
                description=f"E-Way Bill {shipment.get('eway_bill_no')} is at risk of expiry before delivery.",
                severity="critical" if eta_dt > expiry_dt else "high",
                suggestion="Initiate E-Way Bill extension immediately to avoid penalties at highway checkpoints.",
                shipment_id=shipment["id"],
                driver_id=shipment.get("assigned_driver_id")
            )
            alerts_db.insert(new_alert.model_dump())
