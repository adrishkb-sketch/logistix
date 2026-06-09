import math
from backend.models import Location, Shipment, ShipmentEvent
from backend.database import JSONDatabase
import uuid
from datetime import datetime, timedelta

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    # Radius of earth in kilometers. Use 3956 for miles
    r = 6371

    # Convert decimal degrees to radians 
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    # a = sin²(Δφ/2) + cos φ1 ⋅ cos φ2 ⋅ sin²(Δλ/2)
    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2

    # c = 2 ⋅ atan2( √a, √(1−a) )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    # d = R ⋅ c
    distance = r * c
    return distance

def calculate_route_type(pickup: Location, drop: Location, company_id: str) -> str:
    distance = haversine(pickup.lat, pickup.lng, drop.lat, drop.lng)
    if distance < 50:
        return "direct"
        
    wh_p = find_nearest_warehouse(pickup.lat, pickup.lng, company_id)
    wh_d = find_nearest_warehouse(drop.lat, drop.lng, company_id)
    
    if not wh_p or not wh_d:
        return "direct"

    dist_to_wh_p = haversine(pickup.lat, pickup.lng, wh_p["lat"], wh_p["lng"])
    dist_to_wh_d = haversine(drop.lat, drop.lng, wh_d["lat"], wh_d["lng"])
    
    if distance < dist_to_wh_p or distance < dist_to_wh_d:
        return "direct"

    return "warehouse_hop"

def find_nearest_warehouse(lat: float, lng: float, company_id: str) -> dict:
    warehouses_db = JSONDatabase("warehouses")
    all_wh = warehouses_db.get_all()
    company_wh = [w for w in all_wh if w and w.get("company_id") == company_id]
    
    if not company_wh:
        return None
        
    nearest = min(company_wh, key=lambda w: haversine(lat, lng, w["lat"], w["lng"]))
    return nearest

def find_nearest_safe_warehouse(lat: float, lng: float, company_id: str, disaster_cells: list) -> dict:
    warehouses_db = JSONDatabase("warehouses")
    all_wh = warehouses_db.get_all()
    company_wh = [w for w in all_wh if w and w.get("company_id") == company_id]
    
    safe_whs = []
    for wh in company_wh:
        in_zone = False
        for cell in disaster_cells:
            if not cell:
                continue
            calamities = ["cyclone", "flood", "heatwave", "earthquake", "hail", "riot", "storm"]
            c_type = str(cell.get("type", "")).lower()
            if not any(c in c_type for c in calamities):
                continue
                
            if cell.get("shapeType") == "polyline":
                for pt in cell.get("coordinates", []):
                    if haversine(wh["lat"], wh["lng"], pt["lat"], pt["lng"]) <= 5.0:
                        in_zone = True
                        break
            else:
                r = cell.get("radius", 50.0)
                dist = haversine(wh["lat"], wh["lng"], cell.get("lat", 0.0), cell.get("lng", 0.0))
                if dist <= r:
                    in_zone = True
                    break
        if not in_zone:
            safe_whs.append(wh)
            
    if not safe_whs:
        return None
        
    nearest = min(safe_whs, key=lambda w: haversine(lat, lng, w["lat"], w["lng"]))
    return nearest


def check_and_reroute_calamities(shipment: dict, disaster_cells: list = None) -> bool:
    """
    Checks if a shipment's current location or destination intersects with an active calamity zone.
    If so, it applies vehicle-class-aware diversion limits:
      - Bike / Scooty / EV-Cargo : max 15 km to safe hub
      - Van / Delivery Van / Small Truck : max 40 km
      - Heavy Truck               : max 150 km
    If the nearest safe hub is beyond the vehicle's divert range, trigger an Emergency Halt
    instead of sending the vehicle to an unreachable destination.
    Auto-reassigns compatible drivers/vehicles for the diverted shipment.
    """
    if shipment.get("status") not in ["assigned", "in_transit"]:
        return False

    if disaster_cells is None:
        from backend.routers.tracking import get_all_active_weather_cells
        disaster_cells = get_all_active_weather_cells(shipment.get("company_id"))
    
    curr_loc = shipment.get("current_location") or shipment.get("pickup")
    if not curr_loc or not curr_loc.get("lat"):
        return False
        
    lat, lng = curr_loc["lat"], curr_loc["lng"]
    dest = shipment["drop"]
    
    intersecting_calamity = None
    for cell in disaster_cells:
        if not cell:
            continue
        calamities = ["cyclone", "flood", "heatwave", "earthquake", "hail", "riot", "storm"]
        c_type = str(cell.get("type", "")).lower()
        c_severity = str(cell.get("severity", "")).lower()
        is_simulation = cell.get("is_simulation", False)
        
        # Don't divert randomly; only trigger if it is an actual disaster or critical event
        is_actual_calamity = False
        if any(c in c_type for c in ["cyclone", "flood", "earthquake", "riot"]):
            is_actual_calamity = True
        elif c_severity == "critical" or is_simulation:
            if any(c in c_type for c in ["storm", "hail", "heatwave"]):
                is_actual_calamity = True
                
        if not is_actual_calamity:
            continue
            
        intersects = False
        if cell.get("shapeType") == "polyline":
            for pt in cell.get("coordinates", []):
                if haversine(lat, lng, pt["lat"], pt["lng"]) <= 5.0 or haversine(dest["lat"], dest["lng"], pt["lat"], pt["lng"]) <= 5.0:
                    intersects = True
                    break
        else:
            r = cell.get("radius", 50.0)
            dist_curr = haversine(lat, lng, cell.get("lat", 0.0), cell.get("lng", 0.0))
            dist_dest = haversine(dest["lat"], dest["lng"], cell.get("lat", 0.0), cell.get("lng", 0.0))
            if dist_curr <= r or dist_dest <= r:
                intersects = True
                
        if intersects:
            intersecting_calamity = cell
            break
            
    if not intersecting_calamity:
        return False
        
    company_id = shipment.get("company_id")
    calamity_type = intersecting_calamity["type"].upper()
    
    from backend.database import JSONDatabase
    from backend.models import Alert, ShipmentEvent
    alerts_db = JSONDatabase("alerts")
    shipments_db = JSONDatabase("shipments")
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    existing_alert = next((a for a in alerts_db.get_all() if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "calamity_divert" and a.get("status") == "active"), None)
    if existing_alert:
        return False

    # ── Determine vehicle-class divert distance limit ────────────────────────
    vehicle_id = shipment.get("assigned_vehicle_id")
    vehicle = vehicles_db.get_by_id(vehicle_id) if vehicle_id else None
    v_type = str(vehicle.get("type", "")).lower() if vehicle else ""

    is_heavy_truck = "heavy" in v_type or "large" in v_type
    is_small_truck = "small" in v_type or ("truck" in v_type and not is_heavy_truck)
    is_van = "van" in v_type or "delivery" in v_type
    is_bike_scooty = "bike" in v_type or "scooty" in v_type or "scooter" in v_type
    is_ev = "ev" in v_type

    if is_heavy_truck:
        max_divert_km = 150.0
        vehicle_class_label = "Heavy Truck"
    elif is_small_truck or is_van:
        max_divert_km = 40.0
        vehicle_class_label = "Van / Small Truck"
    elif is_bike_scooty or is_ev:
        max_divert_km = 15.0
        vehicle_class_label = "Bike / Scooty / EV"
    else:
        # Unassigned or unknown — use safe default
        max_divert_km = 50.0
        vehicle_class_label = "Unknown"

    # Bypass divert limits for long distance
    long_distance_divert = False

    # ── Find nearest safe warehouse and check distance ───────────────────────
    safe_wh = find_nearest_safe_warehouse(lat, lng, company_id, disaster_cells)
    safe_wh_dist = haversine(lat, lng, safe_wh["lat"], safe_wh["lng"]) if safe_wh else None

    if safe_wh_dist and safe_wh_dist > max_divert_km:
        long_distance_divert = True
        within_range = True
    else:
        within_range = safe_wh is not None and safe_wh_dist <= max_divert_km

    orig_driver_id = shipment.get("assigned_driver_id")

    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    
    expected_str = shipment.get("expected_delivery")
    can_delay = True
    if expected_str:
        try:
            expected_dt = datetime.fromisoformat(expected_str.replace("Z", "+00:00"))
            if expected_dt.tzinfo is None:
                expected_dt = expected_dt.replace(tzinfo=timezone.utc)
            if now + timedelta(hours=24) > expected_dt:
                can_delay = False
        except Exception:
            pass

    if can_delay:
        shipment["stage"] = f"Delayed: Waiting out {calamity_type}"
        shipment["status"] = "delayed"
        
        log_msg = (
            f"🚨 AI CALAMITY DELAY: Due to active {calamity_type}, this shipment is automatically delayed "
            f"for 24 hours to ensure safety without missing the deadline."
        )
        log = ShipmentEvent(status="delayed", message=log_msg, reason=f"Natural Calamity: {calamity_type}")
        shipment["logs"] = shipment.get("logs", []) + [log.model_dump()]
        shipments_db.update(shipment["id"], shipment)
        
        alert = Alert(
            company_id=company_id,
            type="calamity_divert",
            severity="warning",
            description=f"AI AUTO-DELAY: Shipment {shipment['id'][:8]} delayed for 24h due to {calamity_type}.",
            suggestion="Monitor calamity zone. The shipment has enough buffer to wait it out.",
            shipment_id=shipment["id"],
            driver_id=orig_driver_id
        )
        alerts_db.insert(alert.model_dump())
        return True

    elif within_range:
        # Divert, resplit and reassign
        parent_id = shipment.get("parent_id") or shipment["id"]
        parent = shipments_db.get_by_id(parent_id)
        if not parent:
            return False
            
        # Delete old unstarted/active legs
        old_child_ids = parent.get("child_leg_ids", [])
        for cid in old_child_ids:
            cleg = shipments_db.get_by_id(cid)
            if cleg and cleg.get("status") in ["pending", "assigned", "in_transit"]:
                shipments_db.delete(cid)
                
        import uuid as _uuid
        from backend.services.assignment import auto_assign_shipment
        
        # Determine remaining journey legs
        remaining_shipment = {
            "pickup": {"lat": safe_wh["lat"], "lng": safe_wh["lng"], "address": safe_wh["name"]},
            "drop": parent.get("drop"),
            "company_id": company_id
        }
        
        # Decompose the remaining journey through warehouses
        from backend.services.route_engine import decompose_shipment
        remaining_legs = decompose_shipment(remaining_shipment)
        
        new_legs = []
        # Leg 1: Current Loc -> Safe Hub
        leg1_id = "leg_" + str(_uuid.uuid4())[:8]
        leg1 = {
            "id": leg1_id,
            "parent_id": parent_id,
            "company_id": company_id,
            "is_leg": True,
            "leg_order": 1,
            "leg_type": "middle_mile" if long_distance_divert else "first_mile",
            "pickup": curr_loc,
            "drop": {"lat": safe_wh["lat"], "lng": safe_wh["lng"], "address": safe_wh["name"]},
            "drop_warehouse_id": safe_wh["id"],
            "status": "pending",
            "description": parent.get("description", "") + f" [Diverted Leg 1]",
            "finance": parent.get("finance", {})
        }
        new_legs.append(leg1)
        
        # Subsequent Legs (Remaining Journey)
        leg_order_counter = 2
        if not remaining_legs:
            # Direct to drop
            leg2_id = "leg_" + str(_uuid.uuid4())[:8]
            leg2 = {
                "id": leg2_id,
                "parent_id": parent_id,
                "company_id": company_id,
                "is_leg": True,
                "leg_order": leg_order_counter,
                "leg_type": "last_mile",
                "pickup": leg1["drop"],
                "pickup_warehouse_id": safe_wh["id"],
                "drop": parent.get("drop"),
                "status": "pending",
                "description": parent.get("description", "") + f" [Diverted Leg {leg_order_counter}]",
                "finance": parent.get("finance", {})
            }
            new_legs.append(leg2)
        else:
            for rleg in remaining_legs:
                rleg_id = "leg_" + str(_uuid.uuid4())[:8]
                rleg["id"] = rleg_id
                rleg["parent_id"] = parent_id
                rleg["company_id"] = company_id
                rleg["is_leg"] = True
                rleg["leg_order"] = leg_order_counter
                rleg["status"] = "pending"
                rleg["description"] = parent.get("description", "") + f" [Diverted Leg {leg_order_counter}]"
                rleg["finance"] = parent.get("finance", {})
                new_legs.append(rleg)
                leg_order_counter += 1
                
        # Attempt assignment
        assignment_failed = False
        orig_vehicle_id = shipment.get("assigned_vehicle_id")
        for leg in new_legs:
            if leg["leg_order"] == 1:
                leg["assigned_driver_id"] = orig_driver_id
                leg["assigned_vehicle_id"] = orig_vehicle_id
                leg["status"] = "in_transit"
                leg["stage"] = "Diverting to Safe Hub"
                leg["pickup_code"] = shipment.get("pickup_code")
                leg["delivery_code"] = shipment.get("delivery_code")
                leg["delivery_otp"] = shipment.get("delivery_otp")
                leg["current_location"] = curr_loc
                continue
                
            assign = auto_assign_shipment(leg)
            if not assign or "error" in assign:
                assignment_failed = True
                break
            leg["assigned_driver_id"] = assign.get("assigned_driver_id")
            leg["assigned_vehicle_id"] = assign.get("assigned_vehicle_id")
            leg["status"] = "assigned"
            
        if assignment_failed:
            # If we fail to assign ANY of the required vehicles (e.g. no heavy truck for long distance)
            # fallback to Delay or Expiry Return
            from backend.services.route_engine import check_eway_bill_expiry_return
            if check_eway_bill_expiry_return(shipment):
                return True
                
            shipment["stage"] = f"Delayed: Awaiting Vehicle at Safe Hub"
            shipment["status"] = "delayed"
            log = ShipmentEvent(status="delayed", message="🚨 AI FALLBACK: Calamity route requires vehicles currently unavailable. Shipment delayed.", reason=f"Vehicle Unavailable")
            shipment["logs"] = shipment.get("logs", []) + [log.model_dump()]
            shipments_db.update(shipment["id"], shipment)
            return True
            
        # Successfully assigned
        for leg in new_legs:
            shipments_db.insert(leg)
        
        parent["child_leg_ids"] = [l["id"] for l in new_legs]
        parent["route_type"] = "multi-leg"
        parent["status"] = "split"
        parent["stage"] = f"Diverted: Safe Hub ({safe_wh['name']})"
        parent["drop_warehouse_id"] = safe_wh["id"]
        parent["assigned_driver_id"] = None
        parent["assigned_vehicle_id"] = None
        
        log_msg = (
            f"🚨 AI CALAMITY DIVERT: Deadline endangered by {calamity_type}. Shipment automatically diverted "
            f"via safe hub '{safe_wh['name']}'. Route resplit into {len(new_legs)} legs and new drivers assigned."
        )
        log = ShipmentEvent(status="split", message=log_msg, reason=f"Natural Calamity: {calamity_type}")
        parent["logs"] = parent.get("logs", []) + [log.model_dump()]
        shipments_db.update(parent_id, parent)

        alert = Alert(
            company_id=company_id,
            type="calamity_divert",
            severity="critical",
            description=(
                f"AI AUTO-DIVERT: Shipment {parent_id[:8]} rerouted to safe hub '{safe_wh['name']}' "
                f"({round(safe_wh_dist, 1)} km) to avoid missing deadline due to {calamity_type}. "
                f"Route resplit to {len(new_legs)} legs."
            ),
            suggestion=f"Verify driver safety and cargo at {safe_wh['name']}.",
            shipment_id=parent_id,
            driver_id=orig_driver_id
        )
        alerts_db.insert(alert.model_dump())
        return True

    else:
        # ── Emergency halt — safe hub too far or none available ───────────
        dist_info = f"Nearest safe hub is {round(safe_wh_dist, 1)} km away, exceeds {vehicle_class_label} limit of {int(max_divert_km)} km." if safe_wh else "No safe hubs found outside calamity zone."
        shipment["stage"] = "Halted: Calamity Danger Zone"
        shipment["status"] = "delayed"
        
        log_msg = (
            f"🚨 AI EMERGENCY HALT: Due to active {calamity_type}, this shipment has been halted. "
            f"{dist_info} Driver instructed to halt in nearest safe open area and await further instructions."
        )
        log = ShipmentEvent(status="delayed", message=log_msg, reason=f"Natural Calamity: {calamity_type}")
        shipment["logs"] = shipment.get("logs", []) + [log.model_dump()]
        shipments_db.update(shipment["id"], shipment)
        
        if orig_driver_id:
            orig_driver = drivers_db.get_by_id(orig_driver_id)
            if orig_driver:
                import uuid as _uuid
                notifs = orig_driver.get("notifications", [])
                notifs.append({
                    "id": str(_uuid.uuid4()),
                    "shipment_id": shipment["id"],
                    "title": f"🚨 Emergency Halt — {calamity_type}",
                    "message": (
                        f"EMERGENCY: Your order '{shipment.get('description', shipment['id'][:8])}' requires an "
                        f"immediate halt due to an active {calamity_type} calamity. {dist_info} "
                        f"Stop the vehicle in a safe open area and contact the manager immediately."
                    ),
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "read": False
                })
                orig_driver["notifications"] = notifs
                drivers_db.update(orig_driver_id, orig_driver)

        alert = Alert(
            company_id=company_id,
            type="calamity_divert",
            severity="critical",
            description=(
                f"AI EMERGENCY HALT: Shipment {shipment['id'][:8]} halted due to {calamity_type}. "
                f"{dist_info} Driver must not proceed."
            ),
            suggestion="Contact driver immediately to ensure safety. Maintain halt status until calamity zone clears.",
            shipment_id=shipment["id"],
            driver_id=orig_driver_id
        )
        alerts_db.insert(alert.model_dump())
        return True


def check_eway_bill_expiry_return(shipment: dict) -> bool:
    """
    Checks if the shipment's predicted ETA will exceed its E-Way Bill expiry deadline.
    If so, aborts the delivery, reverses coordinates back to sender (original pickup),
    sets status to 'returned', and re-assigns appropriate fleet for the return journey.
    Notifies the original driver of cancellation.
    """
    eway_expiry_str = shipment.get("eway_bill_expiry")
    if not eway_expiry_str:
        return False

    eta_str = shipment.get("expected_delivery")
    if not eta_str:
        return False

    try:
        from datetime import datetime, timezone
        expiry_dt = datetime.fromisoformat(eway_expiry_str.replace("Z", "+00:00"))
        if expiry_dt.tzinfo is None:
            expiry_dt = expiry_dt.replace(tzinfo=timezone.utc)
        eta_dt = datetime.fromisoformat(eta_str.replace("Z", "+00:00"))
        if eta_dt.tzinfo is None:
            eta_dt = eta_dt.replace(tzinfo=timezone.utc)
    except Exception:
        return False

    if eta_dt <= expiry_dt:
        return False

    # ETA exceeds expiry — initiate return to sender
    from backend.database import JSONDatabase
    from backend.models import Alert, ShipmentEvent
    alerts_db = JSONDatabase("alerts")
    shipments_db = JSONDatabase("shipments")
    drivers_db = JSONDatabase("drivers")

    existing = next(
        (a for a in alerts_db.get_all()
         if a and a.get("shipment_id") == shipment["id"]
         and a.get("type") == "compliance_return"
         and a.get("status") == "active"),
        None
    )
    if existing:
        return False

    company_id = shipment.get("company_id")
    orig_driver_id = shipment.get("assigned_driver_id")
    original_pickup = shipment.get("pickup", {})
    original_drop = shipment.get("drop", {})
    eway_no = shipment.get("eway_bill_no", "N/A")

    # Swap drop → pickup (return to sender)
    shipment["drop"] = original_pickup
    shipment["pickup"] = original_drop
    shipment["stage"] = f"Returned: E-Way Bill Expired ({eway_no})"
    shipment["status"] = "cancelled"
    shipment["route_type"] = "return"

    log_msg = (
        f"📋 COMPLIANCE RETURN: E-Way Bill {eway_no} expires on "
        f"{expiry_dt.strftime('%d %b %Y %H:%M UTC')} but predicted ETA is "
        f"{eta_dt.strftime('%d %b %Y %H:%M UTC')}. "
        f"Delivery cannot be completed legally. Shipment is being returned to the sender. "
        f"New destination set to original pickup location."
    )
    log = ShipmentEvent(status="delayed", message=log_msg, reason="E-Way Bill Expiry")
    shipment["logs"] = shipment.get("logs", []) + [log.model_dump()]

    # Clear current assignment and trigger re-assignment for the return trip
    shipment["assigned_driver_id"] = None
    shipment["assigned_vehicle_id"] = None
    shipments_db.update(shipment["id"], shipment)

    # Notify original driver
    if orig_driver_id:
        orig_driver = drivers_db.get_by_id(orig_driver_id)
        if orig_driver:
            import uuid as _uuid
            notifs = orig_driver.get("notifications", [])
            notifs.append({
                "id": str(_uuid.uuid4()),
                "shipment_id": shipment["id"],
                "title": "📋 Delivery Cancelled — E-Way Bill Expired",
                "message": (
                    f"Order '{shipment.get('description', shipment['id'][:8])}' cannot be delivered. "
                    f"E-Way Bill {eway_no} expires before the predicted arrival time. "
                    f"The shipment is being returned to the sender. You have been de-assigned from this task."
                ),
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "read": False
            })
            orig_driver["notifications"] = notifs
            drivers_db.update(orig_driver_id, orig_driver)

    # Try to auto-assign a return vehicle
    from backend.services.assignment import auto_assign_shipment
    return_assign = auto_assign_shipment(shipment)
    if return_assign and "error" not in return_assign:
        shipment["assigned_driver_id"] = return_assign.get("assigned_driver_id")
        shipment["assigned_vehicle_id"] = return_assign.get("assigned_vehicle_id")
        shipment["status"] = "assigned"
        shipments_db.update(shipment["id"], shipment)

    alert = Alert(
        company_id=company_id,
        type="compliance_return",
        severity="critical",
        description=(
            f"COMPLIANCE RETURN: Shipment {shipment['id'][:8]} — E-Way Bill {eway_no} expired before ETA. "
            f"Delivery aborted and shipment returned to sender."
        ),
        suggestion="Renew E-Way Bill and reschedule delivery. Contact the receiver and sender immediately.",
        shipment_id=shipment["id"],
        driver_id=orig_driver_id
    )
    alerts_db.insert(alert.model_dump())
    return True


def decompose_shipment(shipment: dict) -> list:
    """
    World's Strongest Route Splitter logic (Refined):
    1. If distance < 50km, no split (direct).
    2. Find nearest warehouses Wp and Wd.
    3. If direct distance < dist(P, Wp) or direct distance < dist(D, Wd), stay direct.
    4. Omit first_mile if pickup is within 2km of Wp.
    5. Omit last_mile if drop is within 2km of Wd.
    """
    p_lat, p_lng = shipment["pickup"]["lat"], shipment["pickup"]["lng"]
    d_lat, d_lng = shipment["drop"]["lat"], shipment["drop"]["lng"]
    company_id = shipment["company_id"]
    
    dist_total = haversine(p_lat, p_lng, d_lat, d_lng)
    
    if dist_total < 50:
        return []

    wh_p = find_nearest_warehouse(p_lat, p_lng, company_id)
    wh_d = find_nearest_warehouse(d_lat, d_lng, company_id)
    
    if not wh_p or not wh_d:
        return []

    dist_to_wh_p = haversine(p_lat, p_lng, wh_p["lat"], wh_p["lng"])
    dist_to_wh_d = haversine(d_lat, d_lng, wh_d["lat"], wh_d["lng"])
    
    # REFINEMENT: If direct distance is shorter than going to the "nearest" hub, don't split
    if dist_total < dist_to_wh_p or dist_total < dist_to_wh_d:
        return []

    legs = []
    leg_order = 1
    
    # 1. First Mile Leg
    if dist_to_wh_p > 2.0:
        legs.append({
            "pickup": shipment["pickup"],
            "drop": {"lat": wh_p["lat"], "lng": wh_p["lng"], "address": wh_p["name"]},
            "drop_warehouse_id": wh_p["id"],
            "leg_type": "first_mile",
            "leg_order": leg_order
        })
        leg_order += 1
        
    # 2. Middle Mile Leg (Only if Wp != Wd)
    if wh_p["id"] != wh_d["id"]:
        legs.append({
            "pickup": {"lat": wh_p["lat"], "lng": wh_p["lng"], "address": wh_p["name"]},
            "drop": {"lat": wh_d["lat"], "lng": wh_d["lng"], "address": wh_d["name"]},
            "pickup_warehouse_id": wh_p["id"],
            "drop_warehouse_id": wh_d["id"],
            "leg_type": "middle_mile",
            "leg_order": leg_order
        })
        leg_order += 1
        
    # 3. Last Mile Leg
    if dist_to_wh_d > 2.0:
        legs.append({
            "pickup": {"lat": wh_d["lat"], "lng": wh_d["lng"], "address": wh_d["name"] if wh_p["id"] != wh_d["id"] else wh_p["name"]},
            "drop": shipment["drop"],
            "pickup_warehouse_id": wh_d["id"] if wh_p["id"] != wh_d["id"] else wh_p["id"],
            "leg_type": "last_mile",
            "leg_order": leg_order
        })
        
    return legs

def simulate_traffic(lat: float, lng: float) -> dict:
    """
    Simulates real-time traffic levels based on coordinates.
    """
    import random
    # Deterministic seed for demo stability
    seed = int((abs(lat) + abs(lng)) * 1000) % 100
    if seed < 20: return {"level": "Heavy", "color": "#ef4444", "delay_mult": 2.2, "reason": "Major Congestion"}
    if seed < 50: return {"level": "Moderate", "color": "#f59e0b", "delay_mult": 1.4, "reason": "Slow Moving"}
    return {"level": "Light", "color": "#10b981", "delay_mult": 1.0, "reason": "Free Flow"}

def optimize_multi_stop_route(start_lat: float, start_lng: float, stops: list) -> list:
    """
    Greedy TSP optimization for multi-stop routing.
    """
    optimized = []
    current_lat, current_lng = start_lat, start_lng
    remaining = list(stops)
    
    while remaining:
        next_stop = min(remaining, key=lambda s: haversine(current_lat, current_lng, s["lat"], s["lng"]))
        optimized.append(next_stop)
        current_lat, current_lng = next_stop["lat"], next_stop["lng"]
        remaining.remove(next_stop)
        
    return optimized

def predict_weather_impact(lat: float, lng: float) -> dict:
    """
    Mock ML Model to predict weather at a given coordinate.
    In production, this would call a weather API or a regional ML model.
    """
    import random
    # Deterministic-ish weather based on lat/lng for demo consistency
    seed = int((lat + lng) * 100) % 100
    if seed < 15: return {"condition": "Storm", "multiplier": 2.5, "icon": "⛈️"}
    if seed < 40: return {"condition": "Rain", "multiplier": 1.5, "icon": "🌧️"}
    if seed < 60: return {"condition": "Cloudy", "multiplier": 1.1, "icon": "☁️"}
    return {"condition": "Clear", "multiplier": 1.0, "icon": "☀️"}

def calculate_dynamic_eta(distance_km: float, v_type: str, weather: dict, fatigue: int, health: int, lat: float = 0, lng: float = 0, wait_time_mins: int = 0) -> dict:
    """
    AI Model to calculate adjusted ETA.
    """
    # Base speed in km/h
    base_speed = 40 # Average city speed
    if "truck" in v_type.lower(): base_speed = 60
    if v_type.lower() in ["bike", "scooty"]: base_speed = 35
    
    base_time_mins = (distance_km / base_speed) * 60
    
    # Weather Impact
    w_cond = weather.get("condition", "Clear")
    if w_cond == "Clear":
        w_mult = 0.9
    elif w_cond == "Cloudy":
        w_mult = 1.0
    elif w_cond == "Rain":
        w_mult = 1.3
        if v_type.lower() in ["bike", "scooty"]:
            w_mult = 1.6
    elif w_cond == "Storm":
        w_mult = 1.8
        if v_type.lower() in ["bike", "scooty"]:
            w_mult = 2.5
    else:
        w_mult = weather.get("multiplier", 1.0)
        
    # Fatigue Impact (Driver slows down or drives optimally)
    if fatigue < 15:
        f_mult = 0.95
    elif fatigue >= 50:
        f_mult = 1.2
    else:
        f_mult = 1.0
        
    # Traffic Impact
    traffic = simulate_traffic(lat, lng) if lat != 0 else {"delay_mult": 1.0, "level": "Light", "reason": "Free Flow"}
    t_level = traffic.get("level", "Light")
    if t_level == "Light":
        t_mult = 0.9
    elif t_level == "Moderate":
        t_mult = 1.2
    elif t_level == "Heavy":
        t_mult = 1.6
    else:
        t_mult = 1.0

    # Health Impact (Vehicle issues)
    if health >= 95:
        h_mult = 0.95
    elif health < 70:
        h_mult = 1.25
    else:
        h_mult = 1.0
        
    adjusted_time = (base_time_mins * w_mult * f_mult * h_mult * t_mult) + wait_time_mins
    delay = adjusted_time - base_time_mins
    
    # AI Reasoning for early/late predictions
    reasons_list = []
    if w_cond in ["Rain", "Storm"]:
        reasons_list.append(f"adverse weather ({w_cond}) along the route")
    elif w_cond == "Clear":
        reasons_list.append("clear sky conditions")
        
    if fatigue < 15:
        reasons_list.append("fully alert and well-rested driver")
    elif fatigue >= 50:
        reasons_list.append("reduced driver speeds for safety rest breaks")
        
    if health >= 95:
        reasons_list.append("pristine vehicle health status")
    elif health < 70:
        reasons_list.append("reduced speed limits due to degraded vehicle health")
        
    if t_level == "Light":
        reasons_list.append("optimal free-flowing traffic flow")
    elif t_level == "Heavy":
        reasons_list.append("heavy congestion bottlenecks")
        
    if not reasons_list:
        reasons_list.append("normal transit parameters")
        
    reason_str = "Route optimization model inputs: " + ", ".join(reasons_list) + "."
    
    return {
        "base_mins": round(base_time_mins),
        "adjusted_mins": round(adjusted_time),
        "delay_mins": round(delay),
        "wait_time_mins": wait_time_mins,
        "weather": w_cond,
        "weather_icon": weather.get("icon", "☀️"),
        "reason": reason_str,
        "factors": {
            "weather_impact": round((w_mult - 1) * 100),
            "fatigue_impact": round((f_mult - 1) * 100),
            "health_impact": round((h_mult - 1) * 100),
            "wait_impact_mins": wait_time_mins
        }
    }

def check_shipment_performance(shipment: dict, driver: dict = None, vehicle: dict = None) -> dict:
    from datetime import datetime, timezone, timedelta
    
    now = datetime.now(timezone.utc)
    try:
        expected = datetime.fromisoformat(shipment["expected_delivery"].replace('Z', '+00:00'))
        if expected.tzinfo is None:
            expected = expected.replace(tzinfo=timezone.utc)
    except Exception:
        return {"status": "on_time", "diff_mins": 0}
    
    curr_loc = shipment.get("current_location") or shipment.get("pickup")
    dest = shipment["drop"]
    
    dist = haversine(curr_loc["lat"], curr_loc["lng"], dest["lat"], dest["lng"])
    
    # Get impact factors
    weather = predict_weather_impact(curr_loc["lat"], curr_loc["lng"])
    v_type = vehicle["type"] if vehicle else "van"
    fatigue = driver.get("fatigue_score", 0) if driver else 0
    health = vehicle.get("vehicle_health_score", 100) if vehicle else 100
    
    eta_info = calculate_dynamic_eta(dist, v_type, weather, fatigue, health, curr_loc["lat"], curr_loc["lng"])
    
    predicted_arrival = now + timedelta(minutes=eta_info["adjusted_mins"])
    diff = (predicted_arrival - expected).total_seconds() / 60.0
    
    status = "on_time"
    if diff > 10: status = "delayed"
    elif diff < -10: status = "early"
    
    return {
        "status": status,
        "diff_mins": round(diff),
        "eta_mins": eta_info["adjusted_mins"],
        "weather": eta_info["weather"],
        "traffic": simulate_traffic(curr_loc["lat"], curr_loc["lng"]),
        "factors": eta_info["factors"],
        "predicted_arrival": predicted_arrival.isoformat(),
        "dist_remaining_km": round(dist, 1)
    }

def check_drone_viability(lat: float, lng: float, dest_lat: float, dest_lng: float, weight: float = 0.0) -> dict:
    """
    AI model to decide if the last-mile should be a drone leg.
    Criteria: Distance <= 10km, Weight <= 5kg, and High Traffic/Congestion area.
    """
    dist = haversine(lat, lng, dest_lat, dest_lng)
    
    # Mock Traffic Engine
    # In a real app, this would query Google Traffic or TomTom
    seed = int((dest_lat + dest_lng) * 100) % 100
    is_congested = seed > 40 # 60% of urban areas marked as congested
    
    viable = dist <= 10.0 and weight <= 5.0 and is_congested
    
    reason = "Traffic congestion detected. Drone delivery recommended."
    if weight > 5.0:
        reason = "Shipment too heavy for drone (max 5kg)."
    elif dist > 10.0:
        reason = "Destination out of drone range (max 10km)."
    elif not is_congested:
        reason = "Direct truck/van delivery is optimal (low traffic)."
        
    return {
        "viable": viable,
        "distance": round(dist, 2),
        "is_congested": is_congested,
        "reason": reason
    }
