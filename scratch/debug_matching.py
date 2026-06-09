import sys
import os
from os.path import dirname, abspath

# Add backend to path
sys.path.append(dirname(dirname(abspath(__file__))))

from backend.database import JSONDatabase
from backend.services.assignment import normalize_vehicle_type, check_calamity_zone, is_weather_disrupted
from backend.services.route_engine import haversine, find_nearest_warehouse
from backend.services.driver_intel import calculate_driver_performance_score

def debug_matching():
    print("=== DEBUGGING MATCHING FOR xyz (1cd1e383-5cba-45ee-b38d-c14b4a080a44) ===")
    company_id = "1cd1e383-5cba-45ee-b38d-c14b4a080a44"

    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    shipments_db = JSONDatabase("shipments")

    all_ships = shipments_db.get_all()
    legs = [s for s in all_ships if s.get("parent_id") == "0b998889-130a-481c-ace6-ecfa5cf32ff8"]
    if not legs:
        print("Shipment legs for 0b998889-130a-481c-ace6-ecfa5cf32ff8 not found in DB!")
        return

    drivers = [d for d in drivers_db.get_all() if d and d.get("company_id") == company_id]
    vehicles = [v for v in vehicles_db.get_all() if v and v.get("company_id") == company_id]

    print(f"Loaded {len(legs)} legs, {len(drivers)} drivers, {len(vehicles)} vehicles.")

    for leg in legs:
        print(f"\n--- Diagnosing Leg {leg.get('id')} ({leg.get('leg_type')}) ---")
        p_lat, p_lng = leg["pickup"]["lat"], leg["pickup"]["lng"]
        d_lat, d_lng = leg["drop"]["lat"], leg["drop"]["lng"]
        distance = haversine(p_lat, p_lng, d_lat, d_lng)
        is_direct = not leg.get("is_leg", False) and distance < 50
        is_first_mile = leg.get("leg_type") == "first_mile"
        is_last_mile = leg.get("leg_type") == "last_mile"
        is_middle_mile = leg.get("leg_type") == "middle_mile"

        print(f"Leg Info: direct={is_direct}, first_mile={is_first_mile}, last_mile={is_last_mile}, middle_mile={is_middle_mile}")
        print(f"Pickup: {p_lat}, {p_lng}; Drop: {d_lat}, {d_lng}; Distance: {distance:.2f} km")
        print(f"Pickup WH ID: {leg.get('pickup_warehouse_id')}, Drop WH ID: {leg.get('drop_warehouse_id')}")

        p_weather_disrupted = is_weather_disrupted(p_lat, p_lng, company_id)
        d_weather_disrupted = is_weather_disrupted(d_lat, d_lng, company_id)
        print(f"Weather Info: pickup_disrupted={p_weather_disrupted}, drop_disrupted={d_weather_disrupted}")

        for strict_hub in [True, False]:
            matches = []
            rejections = []
            print(f"  Trying Pass: strict_hub={strict_hub}")
            for d in drivers:
                d_name = d.get("name", "Unknown Driver")
                
                # Check status
                if d.get("status") not in ["available", "on_duty"]:
                    rejections.append(f"{d_name}: status={d.get('status')}")
                    continue
                if d.get("is_fit") == False:
                    rejections.append(f"{d_name}: marked unfit")
                    continue
                
                v_id = d.get("assigned_vehicle_id")
                if not v_id:
                    rejections.append(f"{d_name}: no assigned vehicle")
                    continue

                vehicle = next((v for v in vehicles if v.get("id") == v_id), None)
                if not vehicle:
                    rejections.append(f"{d_name}: vehicle {v_id} not found in company vehicles")
                    continue

                if vehicle.get("is_operational") == False:
                    rejections.append(f"{d_name}: vehicle not operational")
                    continue

                if float(vehicle.get("vehicle_health_score", 100.0)) <= 0.0:
                    rejections.append(f"{d_name}: vehicle health <= 0")
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

                is_suitable = False
                if is_direct:
                    nearest_wh = find_nearest_warehouse(p_lat, p_lng, company_id)
                    if strict_hub and nearest_wh:
                        if v_base != nearest_wh["id"] or v_present != nearest_wh["id"]:
                            rejections.append(f"{d_name}: v_base={v_base}, v_present={v_present} != nearest WH {nearest_wh['id']}")
                            continue
                    if is_small_truck or is_van:
                        is_suitable = True
                    else:
                        rejections.append(f"{d_name}: vehicle type {v_type} not suitable for direct")
                elif is_first_mile:
                    if is_bike_scooty or is_ev:
                        is_suitable = True
                    else:
                        rejections.append(f"{d_name}: vehicle type {v_type} not suitable for first mile")
                elif is_last_mile:
                    weather_disrupted = p_weather_disrupted or d_weather_disrupted
                    if weather_disrupted:
                        if is_van:
                            is_suitable = True
                        else:
                            rejections.append(f"{d_name}: vehicle type {v_type} grounded in storm")
                    else:
                        if is_van or is_bike_scooty:
                            is_suitable = True
                        else:
                            rejections.append(f"{d_name}: vehicle type {v_type} not suitable for last mile")
                elif is_middle_mile:
                    if is_heavy_truck or is_small_truck:
                        is_suitable = True
                    else:
                        rejections.append(f"{d_name}: vehicle type {v_type} not suitable for middle mile")

                if not is_suitable:
                    continue

                # Capacity Check
                active_for_v = [s for s in all_ships if s and s.get("assigned_vehicle_id") == vehicle["id"] and s.get("status") in ["assigned", "in_transit"]]
                curr_load = sum(s.get("weight", 0) for s in active_for_v)
                v_cap = vehicle.get("capacity") or 1000.0
                if curr_load + leg.get("weight", 0) > float(v_cap):
                    rejections.append(f"{d_name}: overloaded ({curr_load + leg.get('weight', 0)} > {v_cap})")
                    continue

                matches.append((d, vehicle))
            
            if matches:
                print(f"    Success: Found {len(matches)} suitable candidates!")
                for m_drv, m_veh in matches[:3]:
                    print(f"      Candidate: Driver={m_drv['name']}, Vehicle={m_veh['number_plate']} ({m_veh['type']})")
                break
            else:
                print(f"    Failed: 0 matches. Sample rejection reasons (first 10 unique):")
                seen_rejections = set()
                count = 0
                for r in rejections:
                    r_clean = r.split(": ")[1] if ": " in r else r
                    if r_clean not in seen_rejections:
                        seen_rejections.add(r_clean)
                        print(f"      - {r}")
                        count += 1
                        if count >= 10:
                            break

if __name__ == "__main__":
    debug_matching()
