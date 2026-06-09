from backend.database import JSONDatabase
from typing import Dict, Any, Optional
import uuid

drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")

def normalize_vehicle_type(vtype: str) -> str:
    if not vtype:
        return ""
    s = str(vtype).strip().lower().replace("-", " ").replace("_", " ")
    # Fix common typos
    s = s.replace("derlivery", "delivery")
    # Normalize synonyms
    if "heavy" in s or "large" in s:
        return "heavy_truck"
    if "small" in s or "light" in s:
        return "small_truck"
    if "van" in s:
        return "delivery_van"
    if "bike" in s or "scooty" in s or "scooter" in s or "bicycle" in s:
        return "bike_scooty"
    if "ev" in s:
        return "ev_cargo"
    if "drone" in s:
        return "drone"
    if "truck" in s:
        return "small_truck"
    return s

def check_calamity_zone(lat: float, lng: float, company_id: str) -> Optional[Dict[str, Any]]:
    from backend.services.route_engine import haversine
    from backend.routers.tracking import get_all_active_weather_cells
    cells = get_all_active_weather_cells(company_id)
    for cell in cells:
        if not cell:
            continue
        
        # Only natural calamities pause deliveries
        calamities = ["cyclone", "flood", "earthquake", "hail", "riot", "heatwave"]
        c_type = str(cell.get("type", "")).lower()
        if not any(c in c_type for c in calamities):
            continue
            
        if cell.get("shapeType") == "polyline":
            for pt in cell.get("coordinates", []):
                if haversine(lat, lng, pt["lat"], pt["lng"]) <= 5.0:
                    return cell
        else:
            r = cell.get("radius", 50.0)
            dist = haversine(lat, lng, cell.get("lat", 0.0), cell.get("lng", 0.0))
            if dist <= r:
                return cell
    return None

def check_any_weather_cell(lat: float, lng: float, company_id: str) -> Optional[Dict[str, Any]]:
    from backend.services.route_engine import haversine
    from backend.routers.tracking import get_all_active_weather_cells
    cells = get_all_active_weather_cells(company_id)
    for cell in cells:
        if not cell:
            continue
            
        if cell.get("shapeType") == "polyline":
            for pt in cell.get("coordinates", []):
                if haversine(lat, lng, pt["lat"], pt["lng"]) <= 5.0:
                    return cell
        else:
            r = cell.get("radius", 50.0)
            dist = haversine(lat, lng, cell.get("lat", 0.0), cell.get("lng", 0.0))
            if dist <= r:
                return cell
    return None

def is_weather_disrupted(lat: float, lng: float, company_id: str) -> bool:
    cell = check_any_weather_cell(lat, lng, company_id)
    if cell:
        c_type = str(cell.get("type", "")).lower()
        if any(c in c_type for c in ["rain", "storm", "snow", "fog", "wind", "cyclone", "flood", "hail", "earthquake", "riot", "heatwave"]):
            return True
            
    from backend.services.route_engine import predict_weather_impact
    w = predict_weather_impact(lat, lng)
    cond = str(w.get("condition", "")).lower()
    return any(c in cond for c in ["rain", "storm", "snow", "fog", "wind"])

def auto_assign_shipment(shipment: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Upgraded AI Vehicle Assignment Engine.
    Enforces exact priority mapping, calamity safety locks, back-haul truck prioritization,
    weather-priority reversing for first-mile, and drone weather grounding.
    """
    from backend.services.route_engine import haversine, find_nearest_warehouse
    from backend.services.driver_intel import calculate_driver_performance_score
    from backend.services.finance_engine import estimate_delivery_cost
    from backend.database import JSONDatabase
    import uuid

    # 1. Weight Guard
    if shipment.get("weight", 0) > 100:
        return {"error": "Overweight: Shipment exceeds 100kg limit."}

    company_id = shipment.get("company_id")
    if not company_id:
        # Resolve company_id from parent if leg
        p_id = shipment.get("parent_id")
        if p_id:
            parent = JSONDatabase("shipments").get_by_id(p_id)
            if parent:
                company_id = parent.get("company_id")
    
    if not company_id:
        return {"error": "Company ID not resolved."}

    p_lat, p_lng = shipment["pickup"]["lat"], shipment["pickup"]["lng"]
    d_lat, d_lng = shipment["drop"]["lat"], shipment["drop"]["lng"]

    # 2. CALAMITY SAFETY LOCK
    # If pickup or drop is in a calamity zone, deliveries must be paused
    p_calamity = check_calamity_zone(p_lat, p_lng, company_id)
    d_calamity = check_calamity_zone(d_lat, d_lng, company_id)
    if p_calamity:
        return {"error": f"Delivery paused: Calamity ({p_calamity['type'].upper()}) active in pickup area."}
    if d_calamity:
        return {"error": f"Delivery paused: Calamity ({d_calamity['type'].upper()}) active in destination area."}

    # Identify Legs
    leg_type = shipment.get("leg_type")
    is_leg = shipment.get("is_leg", False)
    
    # Calculate route type / leg markers
    distance = haversine(p_lat, p_lng, d_lat, d_lng)
    is_direct = not is_leg and distance < 50
    
    is_first_mile = leg_type == "first_mile"
    is_last_mile = leg_type == "last_mile"
    is_middle_mile = leg_type == "middle_mile"

    # 3. Last Leg Drone Check (Only for Last Mile under normal weather conditions)
    if is_last_mile:
        weather_disrupted = is_weather_disrupted(p_lat, p_lng, company_id) or is_weather_disrupted(d_lat, d_lng, company_id)
        if not weather_disrupted:
            from backend.services.route_engine import check_drone_viability
            drone_vehicles = [
                v for v in JSONDatabase("vehicles").get_all()
                if v and "drone" in v.get("type", "").lower()
                and v.get("base_warehouse_id") == shipment.get("pickup_warehouse_id")
                and v.get("status") == "available"
            ]
            if drone_vehicles:
                drone_intel = check_drone_viability(p_lat, p_lng, d_lat, d_lng, shipment.get("weight", 0))
                if drone_intel.get("viable"):
                    chosen_drone = drone_vehicles[0]
                    return {
                        "assigned_driver_id": "DRONE-SYSTEM",
                        "assigned_vehicle_id": chosen_drone["id"],
                        "status": "in_transit",
                        "stage": "Drone Air Delivery",
                        "route_type": "drone-leg",
                        "finance": estimate_delivery_cost(shipment, "drone")
                    }

    # Gather Fleet Data
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    all_shipments = JSONDatabase("shipments").get_all()
    
    # Auto-pair any unlinked drivers and vehicles for this company first
    try:
        all_drivers = drivers_db.get_all()
        all_vehicles = vehicles_db.get_all()
        unlinked_drivers = [d for d in all_drivers if d and d.get("company_id") == company_id and not d.get("assigned_vehicle_id")]
        unlinked_vehicles = [v for v in all_vehicles if v and v.get("company_id") == company_id and not v.get("assigned_driver_id")]
        
        if unlinked_drivers and unlinked_vehicles:
            driver_updates = []
            vehicle_updates = []
            vehicle_pool = unlinked_vehicles[:]
            for d in unlinked_drivers:
                dtype = str(d.get("license_type") or "").strip().lower()
                dhub = str(d.get("base_warehouse_id") or "").strip()
                if not dtype or not dhub:
                    continue
                # Find a matching vehicle
                match_idx = -1
                for idx, v in enumerate(vehicle_pool):
                    vtype = str(v.get("type") or "").strip().lower()
                    vhub = str(v.get("base_warehouse_id") or "").strip()
                    if vhub == dhub and normalize_vehicle_type(vtype) == normalize_vehicle_type(dtype):
                        match_idx = idx
                        break
                if match_idx != -1:
                    match = vehicle_pool.pop(match_idx)
                    driver_updates.append((d["id"], {"assigned_vehicle_id": match["id"], "verification_status": "unverified"}))
                    vehicle_updates.append((match["id"], {"assigned_driver_id": d["id"]}))
            
            if driver_updates:
                drivers_db.update_many(driver_updates)
            if vehicle_updates:
                vehicles_db.update_many(vehicle_updates)
    except Exception as ep:
        print(f"Auto-pairing fleet failed during assignment: {ep}")

    drivers = [d for d in drivers_db.get_all() if d and d.get("company_id") == company_id]
    vehicles = [v for v in vehicles_db.get_all() if v and v.get("company_id") == company_id]
    
    if not drivers:
        return {"error": "Hub Empty: No drivers registered."}

    # Two-pass assignment check: first strict hub, then relaxed
    available_pairs = []
    rejection_reasons = []
    
    for strict_hub in [True, False]:
        available_pairs = []
        rejection_reasons = []
        
        for d in drivers:
            d_name = d.get("name", "Unknown Driver")
            
            # Status & Fitness Checks
            if d.get("status") not in ["available", "on_duty"]:
                rejection_reasons.append(f"{d_name}: Driver status is {d.get('status')}")
                continue
            if d.get("is_fit") == False:
                rejection_reasons.append(f"{d_name}: Driver marked UNFIT")
                continue
            
            v_id = d.get("assigned_vehicle_id")
            if not v_id: 
                rejection_reasons.append(f"{d_name}: No vehicle linked")
                continue
            
            vehicle = next((v for v in vehicles if v.get("id") == v_id), None)
            if not vehicle:
                # Direct lookup fallback in case of company_id mismatch
                vehicle = vehicles_db.get_by_id(v_id)
                if not vehicle:
                    rejection_reasons.append(f"{d_name}: Linked vehicle {v_id} not found")
                    continue
                
            if vehicle.get("is_operational") == False:
                rejection_reasons.append(f"{d_name}: Vehicle {vehicle.get('number_plate')} is in maintenance")
                continue

            if float(vehicle.get("vehicle_health_score", 100.0)) <= 0.0:
                rejection_reasons.append(f"{d_name}: Vehicle {vehicle.get('number_plate')} health is 0%")
                continue
            
            v_type = str(vehicle.get("type", "")).lower()
            v_base = vehicle.get("base_warehouse_id")
            # Check present_warehouse_id (fallback to current_warehouse_id or base_warehouse_id)
            v_present = vehicle.get("present_warehouse_id") or vehicle.get("current_warehouse_id") or v_base
            v_plate = vehicle.get("number_plate", "Unknown")

            # Normalize Vehicle Types
            is_heavy_truck = "heavy" in v_type or "large" in v_type
            is_small_truck = "small" in v_type or ("truck" in v_type and not is_heavy_truck)
            is_van = "van" in v_type or "delivery" in v_type
            is_bike_scooty = "bike" in v_type or "scooty" in v_type or "scooter" in v_type
            is_ev = "ev" in v_type
            is_drone = "drone" in v_type

            # 4. Apply Dynamic Priority Matrices
            priority_score = 0
            is_suitable = False

            if is_direct:
                # DIRECT DELIVERIES: Truck (Small) or Delivery Van only.
                # Base and present warehouse must match nearest warehouse from pickup.
                nearest_wh = find_nearest_warehouse(p_lat, p_lng, company_id)
                if strict_hub and nearest_wh:
                    if v_base != nearest_wh["id"] or v_present != nearest_wh["id"]:
                        rejection_reasons.append(f"{d_name}: Vehicle not present at pickup's nearest hub {nearest_wh['name']}.")
                        continue

                if is_small_truck:
                    priority_score = 100000  # Truck (Small) priority
                    is_suitable = True
                elif is_van:
                    priority_score = 50000   # Delivery Van priority
                    is_suitable = True
                else:
                    rejection_reasons.append(f"{d_name}: Only Truck (Small) or Delivery Van allowed for direct deliveries.")
                    continue

            elif is_first_mile:
                # VIA 1 WAREHOUSE: LEG 1 (Pickup to Warehouse)
                # Allowed: Bike/scooty or EV-Cargo.
                if is_bike_scooty or is_ev:
                    is_suitable = True
                    weather_disrupted = is_weather_disrupted(p_lat, p_lng, company_id)
                    if weather_disrupted:
                        # Reverse priority order: EV-Cargo > Bike/scooty
                        priority_score = 100000 if is_ev else 50000
                    else:
                        # Standard priority order: Bike/scooty > EV-Cargo
                        priority_score = 100000 if is_bike_scooty else 50000
                else:
                    rejection_reasons.append(f"{d_name}: Only Bike/scooty or EV-Cargo allowed for first mile.")
                    continue

            elif is_last_mile:
                # VIA 1 WAREHOUSE: LEG 2 (Warehouse to Destination)
                # Allowed: Drone (already handled above), Delivery Van, Bike/scooty.
                weather_disrupted = is_weather_disrupted(p_lat, p_lng, company_id) or is_weather_disrupted(d_lat, d_lng, company_id)
                if weather_disrupted:
                    # Drones and Bikes are grounded
                    if is_van:
                        priority_score = 100000
                        is_suitable = True
                    else:
                        rejection_reasons.append(f"{d_name}: Bicycles/Bikes/Drones grounded due to storm/rain.")
                        continue
                else:
                    if is_van:
                        priority_score = 100000
                        is_suitable = True
                    elif is_bike_scooty:
                        priority_score = 50000
                        is_suitable = True
                    else:
                        rejection_reasons.append(f"{d_name}: Invalid vehicle type for last mile.")
                        continue

            elif is_middle_mile:
                # MIDDLE MILE: Trucks (Heavy) and Trucks (Small) only
                if is_heavy_truck or is_small_truck:
                    is_suitable = True
                    # Priority: Truck (Heavy) > Truck (Small)
                    priority_score = 100000 if is_heavy_truck else 50000
                    
                    # Back-haul Return Preference:
                    # If vehicle is based on drop warehouse but present at pickup warehouse
                    pickup_wh_id = shipment.get("pickup_warehouse_id")
                    drop_wh_id = shipment.get("drop_warehouse_id")
                    if v_base == drop_wh_id and v_present == pickup_wh_id:
                        # Give massive boost so it overrides other trucks based at pickup warehouse
                        priority_score += 500000
                else:
                    rejection_reasons.append(f"{d_name}: Only Heavy or Small Trucks allowed for middle-mile movements.")
                    continue

            if not is_suitable:
                continue

            # Capacity Check
            active_for_v = [s for s in all_shipments if s and s.get("assigned_vehicle_id") == vehicle["id"] and s.get("status") in ["assigned", "in_transit"]]
            curr_load = sum(s.get("weight", 0) for s in active_for_v)
            ship_weight = shipment.get("weight", 0)
            
            # Robust capacity check with fallback defaults
            v_cap = vehicle.get("capacity")
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
                    
            if curr_load + ship_weight > v_cap:
                rejection_reasons.append(f"{d_name}: Overloaded ({curr_load + ship_weight}kg > {v_cap}kg)")
                continue

            # CO2 Penalty Calculation
            co2_penalty = 0
            if not is_ev and not is_bike_scooty and not is_drone:
                from backend.models import Vehicle
                v_age = Vehicle(**vehicle).current_age
                # Base penalty for fossil fuel vehicles, increased by 5% for every year of vehicle age
                co2_penalty = 500 * (1.0 + (v_age * 0.05))

            # Score Calculation
            score = priority_score + calculate_driver_performance_score(d) + (float(d.get("safety_rating", 5.0) or 5.0) * 10) - co2_penalty
            
            # Distance penalty
            wh_to_query = v_present or v_base
            if wh_to_query:
                warehouses_db = JSONDatabase("warehouses")
                base_wh = warehouses_db.get_by_id(wh_to_query)
                if base_wh:
                    dist_to_pickup = haversine(base_wh["lat"], base_wh["lng"], p_lat, p_lng)
                    score -= (dist_to_pickup * 100)

            available_pairs.append({
                "driver": d,
                "vehicle": vehicle,
                "score": score
            })
            
        if available_pairs:
            break

    if not available_pairs:
        unique_reasons = list(set(rejection_reasons))[:3]
        err_msg = " | ".join(unique_reasons) if unique_reasons else "No local fleet matches journey criteria."
        return {"error": err_msg}

    available_pairs.sort(key=lambda x: x["score"], reverse=True)
    best = available_pairs[0]

    return {
        "assigned_driver_id": best["driver"]["id"],
        "assigned_vehicle_id": best["vehicle"]["id"],
        "status": "assigned",
        "stage": "Assigned to Driver",
        "finance": estimate_delivery_cost(shipment, best["vehicle"]["type"].lower()),
        "pickup_deadline": None
    }

def get_assignment_recommendations_for_shipment(shipment: Dict[str, Any]) -> list:
    from backend.services.route_engine import haversine, find_nearest_warehouse
    from backend.services.driver_intel import calculate_driver_performance_score
    from backend.services.finance_engine import estimate_delivery_cost
    from backend.database import JSONDatabase
    
    company_id = shipment.get("company_id")
    if not company_id:
        p_id = shipment.get("parent_id")
        if p_id:
            parent = JSONDatabase("shipments").get_by_id(p_id)
            if parent:
                company_id = parent.get("company_id")
    
    if not company_id: return []
    
    p_lat, p_lng = shipment["pickup"]["lat"], shipment["pickup"]["lng"]
    d_lat, d_lng = shipment["drop"]["lat"], shipment["drop"]["lng"]

    leg_type = shipment.get("leg_type")
    is_leg = shipment.get("is_leg", False)
    distance = haversine(p_lat, p_lng, d_lat, d_lng)
    is_direct = not is_leg and distance < 50
    
    is_first_mile = leg_type == "first_mile"
    is_last_mile = leg_type == "last_mile"
    is_middle_mile = leg_type == "middle_mile"

    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    all_shipments = JSONDatabase("shipments").get_all()
    
    drivers = [d for d in drivers_db.get_all() if d and d.get("company_id") == company_id]
    vehicles = [v for v in vehicles_db.get_all() if v and v.get("company_id") == company_id]
    
    available_pairs = []

    for d in drivers:
        if d.get("status") not in ["available", "on_duty"] or d.get("is_fit") == False:
            continue
        v_id = d.get("assigned_vehicle_id")
        if not v_id: continue
        vehicle = next((v for v in vehicles if v.get("id") == v_id), None)
        if not vehicle or vehicle.get("is_operational") == False or float(vehicle.get("vehicle_health_score", 100.0)) <= 0.0:
            continue
        
        v_type = str(vehicle.get("type", "")).lower()
        v_base = vehicle.get("base_warehouse_id")
        v_present = vehicle.get("present_warehouse_id") or vehicle.get("current_warehouse_id") or v_base
        
        is_heavy_truck = "heavy" in v_type or "large" in v_type
        is_small_truck = "small" in v_type or ("truck" in v_type and not is_heavy_truck)
        is_van = "van" in v_type or "delivery" in v_type
        is_bike_scooty = "bike" in v_type or "scooty" in v_type or "scooter" in v_type
        is_ev = "ev" in v_type
        is_drone = "drone" in v_type
        
        priority_score = 0
        is_suitable = False

        if is_direct:
            nearest_wh = find_nearest_warehouse(p_lat, p_lng, company_id)
            if not nearest_wh or (v_base != nearest_wh["id"] or v_present != nearest_wh["id"]): continue
            if is_small_truck:
                priority_score = 100000; is_suitable = True
            elif is_van:
                priority_score = 50000; is_suitable = True
        elif is_first_mile:
            if is_bike_scooty or is_ev:
                is_suitable = True
                priority_score = 100000 if is_bike_scooty else 50000
        elif is_last_mile:
            if is_van:
                priority_score = 100000; is_suitable = True
            elif is_bike_scooty:
                priority_score = 50000; is_suitable = True
        elif is_middle_mile:
            if is_heavy_truck or is_small_truck:
                is_suitable = True
                priority_score = 100000 if is_heavy_truck else 50000
                pickup_wh_id = shipment.get("pickup_warehouse_id")
                drop_wh_id = shipment.get("drop_warehouse_id")
                if v_base == drop_wh_id and v_present == pickup_wh_id:
                    priority_score += 500000

        if not is_suitable: continue

        active_for_v = [s for s in all_shipments if s and s.get("assigned_vehicle_id") == vehicle["id"] and s.get("status") in ["assigned", "in_transit"]]
        curr_load = sum(s.get("weight", 0) for s in active_for_v)
        ship_weight = shipment.get("weight", 0)
        v_cap = vehicle.get("capacity")
        if not v_cap: v_cap = 1000.0
        else:
            try: v_cap = float(v_cap)
            except: v_cap = 1000.0
                
        if curr_load + ship_weight > v_cap: continue

        co2_penalty = 0
        if not is_ev and not is_bike_scooty and not is_drone:
            from backend.models import Vehicle
            v_age = Vehicle(**vehicle).current_age
            co2_penalty = 500 * (1.0 + (v_age * 0.05))

        score = priority_score + calculate_driver_performance_score(d) + (d.get("safety_rating", 5) * 10) - co2_penalty
        
        wh_to_query = v_present or v_base
        if wh_to_query:
            warehouses_db = JSONDatabase("warehouses")
            base_wh = warehouses_db.get_by_id(wh_to_query)
            if base_wh:
                dist_to_pickup = haversine(base_wh["lat"], base_wh["lng"], p_lat, p_lng)
                score -= (dist_to_pickup * 100)

        available_pairs.append({
            "driver_id": d["id"],
            "driver_name": d.get("name"),
            "vehicle_id": vehicle["id"],
            "vehicle_type": vehicle.get("type"),
            "number_plate": vehicle.get("number_plate"),
            "score": score,
            "co2_penalty": co2_penalty
        })

    available_pairs.sort(key=lambda x: x["score"], reverse=True)
    return available_pairs

def assign_rescue_vehicle(driver_id: str, vehicle_id: str, location: Dict[str, Any]):
    from backend.database import JSONDatabase
    from backend.services.route_engine import haversine
    from datetime import datetime
    import uuid

    shipments_db = JSONDatabase("shipments")
    vehicles_db = JSONDatabase("vehicles")
    drivers_db = JSONDatabase("drivers")
    warehouses_db = JSONDatabase("warehouses")
    
    all_shipments = shipments_db.get_all()
    broken_shipments = [s for s in all_shipments if s and s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit"]]
    
    if not broken_shipments:
        return None
    
    driver = drivers_db.get_by_id(driver_id)
    company_id = driver.get("company_id")
    total_weight = sum(s.get("weight", 0) for s in broken_shipments)
    
    # Get broken vehicle type and category
    broken_vehicle = vehicles_db.get_by_id(vehicle_id)
    if not broken_vehicle:
        return None
    
    broken_type = broken_vehicle.get("type", "").lower()
    is_heavy = "heavy" in broken_type or "large" in broken_type
    is_small = "small" in broken_type or ("truck" in broken_type and not is_heavy)
    is_van = "van" in broken_type or "delivery" in broken_type
    is_bike = "bike" in broken_type or "scooty" in broken_type or "scooter" in broken_type
    is_ev = "ev" in broken_type
    is_drone = "drone" in broken_type

    # Sort warehouses by distance from breakdown location
    warehouses = warehouses_db.get_all()
    warehouses.sort(key=lambda w: haversine(location["lat"], location["lng"], w["lat"], w["lng"]))

    rescue_pair = None
    for wh in warehouses:
        potential_drivers = [d for d in drivers_db.get_all() if d and d.get("company_id") == company_id and d.get("id") != driver_id and d.get("status") in ("available", "on_duty") and d.get("assigned_vehicle_id")]
        for d in potential_drivers:
            v = vehicles_db.get_by_id(d["assigned_vehicle_id"])
            if not v or v.get("status") != "available" or v.get("is_operational") == False:
                continue
            
            # Check if vehicle is present at this warehouse
            v_wh = v.get("present_warehouse_id") or v.get("current_warehouse_id") or v.get("base_warehouse_id")
            if v_wh != wh["id"]:
                continue
            
            # Check type match
            t = v.get("type", "").lower()
            matches = False
            if is_heavy: matches = ("heavy" in t or "large" in t)
            elif is_small: matches = ("small" in t or ("truck" in t and not ("heavy" in t or "large" in t)))
            elif is_van: matches = ("van" in t or "delivery" in t)
            elif is_bike: matches = ("bike" in t or "scooty" in t or "scooter" in t)
            elif is_ev: matches = ("ev" in t)
            elif is_drone: matches = ("drone" in t)
            
            v_cap = v.get("capacity")
            if not v_cap:
                if is_heavy: v_cap = 10000.0
                elif is_small: v_cap = 3000.0
                elif is_van: v_cap = 1500.0
                elif is_ev: v_cap = 800.0
                elif is_bike: v_cap = 80.0
                elif is_drone: v_cap = 15.0
                else: v_cap = 1000.0
            else:
                try:
                    v_cap = float(v_cap)
                except (ValueError, TypeError):
                    v_cap = 1000.0

            if matches and v_cap >= total_weight:
                rescue_pair = (d, v)
                break
        if rescue_pair:
            break

    if rescue_pair:
        new_d, new_v = rescue_pair
        
        # Calculate ratio and split wages
        total_original_wage = 0.0
        ratios = []
        
        for s in broken_shipments:
            p_lat, p_lng = s["pickup"]["lat"], s["pickup"]["lng"]
            d_lat, d_lng = s["drop"]["lat"], s["drop"]["lng"]
            b_lat, b_lng = location["lat"], location["lng"]
            
            total_dist = haversine(p_lat, p_lng, d_lat, d_lng)
            completed_dist = haversine(p_lat, p_lng, b_lat, b_lng)
            
            ratio = 0.0
            if total_dist > 0:
                ratio = min(1.0, max(0.0, completed_dist / total_dist))
            ratios.append(ratio)
            
            finance = s.get("finance", {})
            orig_wage = finance.get("driver_wage", 0.0)
            total_original_wage += orig_wage
            
            rescue_wage = round(orig_wage * (1.0 - ratio), 2)
            
            # Update shipment to rescue driver/vehicle and rescue wage
            new_finance = finance.copy()
            new_finance["driver_wage"] = rescue_wage
            
            rescue_details = {
                "original_driver_id": driver_id,
                "original_vehicle_id": vehicle_id,
                "rescue_driver_id": new_d["id"],
                "rescue_vehicle_id": new_v["id"],
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
            
            shipments_db.update(s["id"], {
                "assigned_driver_id": new_d["id"],
                "assigned_vehicle_id": new_v["id"],
                "status": "assigned",
                "finance": new_finance,
                "rescue_details": rescue_details
            })
            
            logs = s.get("logs", [])
            logs.append({
                "status": "assigned",
                "message": f"🚑 RESCUE: Shipments transferred to {new_d['name']} due to vehicle breakdown. Payout split ratio: {round(ratio * 100, 1)}% original driver, {round((1.0 - ratio) * 100, 1)}% rescue driver.",
                "reason": "Automatic rescue initiated.",
                "location": location,
                "timestamp": datetime.utcnow().isoformat() + "Z"
            })
            shipments_db.update(s["id"], {"logs": logs})
            
        vehicles_db.update(new_v["id"], {"status": "assigned"})
        
        avg_ratio = sum(ratios) / len(ratios) if ratios else 0.0
        
        return {
            "driver_name": new_d["name"],
            "vehicle_id": new_v["id"],
            "ratio": avg_ratio,
            "original_wage_total": total_original_wage,
            "split_wage": round(total_original_wage * avg_ratio, 2)
        }
        
    return None

def reoptimize_driver_route(driver_id: str):
    from backend.database import JSONDatabase
    from backend.services.route_engine import optimize_multi_stop_route, haversine
    from datetime import datetime, timedelta

    shipments_db = JSONDatabase("shipments")
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")

    # Get all non-delivered tasks for this driver
    active_tasks = [s for s in shipments_db.get_all() if s and s.get("assigned_driver_id") == driver_id and s.get("status") in ["assigned", "in_transit"]]
    if len(active_tasks) < 1: return

    driver = drivers_db.get_by_id(driver_id)
    vehicle = vehicles_db.get_by_id(driver.get("assigned_vehicle_id")) if driver else None
    
    # Start from current vehicle location or first task pickup
    start_lat = vehicle.get("last_known_location", {}).get("lat") if vehicle else active_tasks[0]["pickup"]["lat"]
    start_lng = vehicle.get("last_known_location", {}).get("lng") if vehicle else active_tasks[0]["pickup"]["lng"]

    # Simple Optimization: Group by Shipment
    # 1. Sort shipments by the distance from current location to their PICKUP
    active_tasks.sort(key=lambda s: haversine(start_lat, start_lng, s["pickup"]["lat"], s["pickup"]["lng"]))
    
    # 2. Update deadlines sequentially
    curr_lat, curr_lng = start_lat, start_lng
    current_time = datetime.utcnow()
    
    for s in active_tasks:
        from backend.services.time_utils import snap_eta_to_business_hours
        # Travel to Pickup
        dist_to_p = haversine(curr_lat, curr_lng, s["pickup"]["lat"], s["pickup"]["lng"])
        time_to_p = (dist_to_p / 30.0) * 60.0 # Slow in city
        current_time += timedelta(minutes=time_to_p + 10) # 10m buffer
        shipments_db.update(s["id"], {"pickup_deadline": snap_eta_to_business_hours(current_time).isoformat() + "Z"})
        
        # Travel to Drop
        dist_to_d = haversine(s["pickup"]["lat"], s["pickup"]["lng"], s["drop"]["lat"], s["drop"]["lng"])
        time_to_d = (dist_to_d / 40.0) * 60.0 
        current_time += timedelta(minutes=time_to_d + 15) # 15m buffer
        shipments_db.update(s["id"], {"expected_delivery": snap_eta_to_business_hours(current_time).isoformat() + "Z"})
        
        curr_lat, curr_lng = s["drop"]["lat"], s["drop"]["lng"]

    return active_tasks
