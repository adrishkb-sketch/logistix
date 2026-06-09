import sys
import os
from datetime import datetime

# Set up PYTHONPATH
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from backend.database import JSONDatabase
from backend.services.assignment import auto_assign_shipment
from backend.services.route_engine import check_and_reroute_calamities

def run_tests():
    print("=== STARTING DYNAMIC ASSIGNMENT & CALAMITY CONTINGENCY TESTS ===")
    
    # Initialize databases
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    warehouses_db = JSONDatabase("warehouses")
    shipments_db = JSONDatabase("shipments")
    weather_db = JSONDatabase("weather_cells")
    alerts_db = JSONDatabase("alerts")
    
    company_id = "test_company_assignment"
    
    # Clean up any previous test records
    drivers_db.delete_many("data->>company_id", company_id)
    vehicles_db.delete_many("data->>company_id", company_id)
    warehouses_db.delete_many("data->>company_id", company_id)
    shipments_db.delete_many("data->>company_id", company_id)
    weather_db.delete_many("data->>company_id", company_id)
    alerts_db.delete_many("data->>company_id", company_id)
    
    # ── Seed Warehouses ──
    wh_a = {
        "id": "wh_A",
        "company_id": company_id,
        "name": "Mumbai Main Hub",
        "lat": 19.0760,
        "lng": 72.8777,
        "max_capacity": 500,
        "has_drone_pad": True
    }
    wh_b = {
        "id": "wh_B",
        "company_id": company_id,
        "name": "Pune Hub",
        "lat": 18.5000,
        "lng": 74.1600,
        "max_capacity": 300,
        "has_drone_pad": True
    }
    wh_safe = {
        "id": "wh_Safe",
        "company_id": company_id,
        "name": "Thane Safe Hub",
        "lat": 19.2183,
        "lng": 72.9781,
        "max_capacity": 200,
        "has_drone_pad": False
    }
    warehouses_db.insert(wh_a)
    warehouses_db.insert(wh_b)
    warehouses_db.insert(wh_safe)
    
    # ── Helpers to register Driver + Vehicle ──
    def register_pair(drv_id, name, v_id, plate, v_type, base_wh, present_wh=None, license_type="truck"):
        drv = {
            "id": drv_id,
            "company_id": company_id,
            "name": name,
            "license_type": license_type,
            "base_warehouse_id": base_wh,
            "assigned_vehicle_id": v_id,
            "status": "available",
            "is_fit": True,
            "verification_status": "verified",
            "fatigue_score": 10.0,
            "safety_rating": 4.8
        }
        veh = {
            "id": v_id,
            "company_id": company_id,
            "type": v_type,
            "number_plate": plate,
            "base_warehouse_id": base_wh,
            "present_warehouse_id": present_wh or base_wh,
            "status": "available",
            "is_operational": True,
            "capacity": 1000,
            "vehicle_health_score": 95.0
        }
        drivers_db.insert(drv)
        vehicles_db.insert(veh)

    # 1. Direct Delivery Scenario Mock Setup
    # Require: small truck and delivery van. Small truck has priority.
    # Must be based and present at the nearest warehouse (wh_A) from pickup.
    register_pair("drv_dt_small", "Small Truck Driver", "veh_dt_small", "MH-01-T1", "truck (small)", "wh_A", "wh_A", "truck")
    register_pair("drv_dt_van", "Delivery Van Driver", "veh_dt_van", "MH-01-V1", "delivery van", "wh_A", "wh_A", "truck")
    # Wrong base/present warehouse (should be rejected for wh_A pickup)
    register_pair("drv_dt_wrong_hub", "Wrong Hub Driver", "veh_dt_wrong_hub", "MH-02-T2", "truck (small)", "wh_B", "wh_B", "truck")
    
    # 2. First Mile Scenario Mock Setup
    # Require: bike/scooty and EV-Cargo. Bike > EV standard. EV > Bike in bad weather.
    register_pair("drv_fm_bike", "Bike Rider", "veh_fm_bike", "MH-01-B1", "bike/scooty", "wh_A", "wh_A", "bike")
    register_pair("drv_fm_ev", "EV Cargo Rider", "veh_fm_ev", "MH-01-E1", "ev-cargo", "wh_A", "wh_A", "bike")
    
    # 3. Last Mile Scenario Mock Setup
    # Require: drone, delivery van, bike. Drone > Van > Bike standard. Drones & Bikes grounded in bad weather.
    register_pair("drv_lm_drone", "Drone System", "veh_lm_drone", "DRONE-01", "drone", "wh_B", "wh_B", "drone")
    register_pair("drv_lm_van", "Last Mile Van Driver", "veh_lm_van", "MH-03-V2", "delivery van", "wh_B", "wh_B", "truck")
    register_pair("drv_lm_bike", "Last Mile Bike Rider", "veh_lm_bike", "MH-03-B2", "bike/scooty", "wh_B", "wh_B", "bike")
    
    # 4. Middle Mile Scenario Mock Setup
    # Require: Heavy Truck and Small Truck. Heavy > Small.
    # Back-haul: wh_B to wh_A shipment.
    # veh_mm_heavy: base wh_B, present wh_B (standard truck)
    # veh_mm_backhaul: base wh_A, present wh_B (back-haul return truck)
    register_pair("drv_mm_heavy", "Heavy Truck Driver", "veh_mm_heavy", "MH-01-H1", "truck (heavy)", "wh_B", "wh_B", "truck")
    register_pair("drv_mm_backhaul", "Backhaul Driver", "veh_mm_backhaul", "MH-01-H2", "truck (heavy)", "wh_A", "wh_B", "truck")

    print("Mock fleet seeded.")

    # ── Test 1: Direct Delivery Priority (<50km) ──
    print("\nRunning Test 1: Direct Delivery Priority...")
    shipment_direct = {
        "id": "ship_direct",
        "company_id": company_id,
        "pickup": {"lat": 19.0765, "lng": 72.8780, "address": "Near Mumbai Hub"}, # very close to wh_A (nearest)
        "drop": {"lat": 19.1000, "lng": 72.9000, "address": "Vandre East"},
        "weight": 10,
        "is_leg": False
    }
    res = auto_assign_shipment(shipment_direct)
    assert "error" not in res, f"Assignment failed: {res}"
    # Small Truck has priority over Delivery Van
    assert res["assigned_vehicle_id"] == "veh_dt_small", f"Expected small truck, got {res['assigned_vehicle_id']}"
    print("✅ Test 1 Passed: Small truck correctly prioritized for direct delivery close to hub.")

    # ── Test 2: Via 1 Warehouse Leg 1 (First Mile) - Standard Weather ──
    print("\nRunning Test 2: First Mile Priority (Standard)...")
    shipment_fm = {
        "id": "ship_first_mile",
        "company_id": company_id,
        "pickup": {"lat": 19.0500, "lng": 72.8500, "address": "Bandra"},
        "drop": {"lat": 19.0760, "lng": 72.8777, "address": "Mumbai Main Hub"},
        "weight": 5,
        "is_leg": True,
        "leg_type": "first_mile"
    }
    res = auto_assign_shipment(shipment_fm)
    assert "error" not in res
    # Bike > EV-Cargo standard priority
    assert res["assigned_vehicle_id"] == "veh_fm_bike", f"Expected bike, got {res['assigned_vehicle_id']}"
    print("✅ Test 2 Passed: Bike correctly preferred for first mile in normal weather.")

    # ── Test 3: Via 1 Warehouse Leg 1 (First Mile) - Bad Weather Reversal ──
    print("\nRunning Test 3: First Mile Priority (Storm Reversal)...")
    # Simulate bad weather (Storm/Cyclone) in Mumbai
    storm_cell = {
        "id": "storm_cell_mumbai",
        "company_id": company_id,
        "type": "storm",
        "lat": 19.0500,
        "lng": 72.8500,
        "radius": 15,
        "shapeType": "circle",
        "severity": "critical",
        "is_simulation": True
    }
    weather_db.insert(storm_cell)
    
    # Under storm, Bike is de-prioritized or EV-Cargo is prioritized
    res = auto_assign_shipment(shipment_fm)
    assert "error" not in res
    # Reversed priority: EV-Cargo > Bike
    assert res["assigned_vehicle_id"] == "veh_fm_ev", f"Expected EV Cargo under storm, got {res['assigned_vehicle_id']}"
    print("✅ Test 3 Passed: EV-Cargo correctly preferred under storm conditions.")
    
    # Clear storm cell
    weather_db.delete_many("data->>id", "storm_cell_mumbai")

    # ── Test 4: Via 1 Warehouse Leg 2 (Last Mile) - Bad Weather Grounding ──
    print("\nRunning Test 4: Last Mile Grounding...")
    shipment_lm = {
        "id": "ship_last_mile",
        "company_id": company_id,
        "pickup": {"lat": 18.5000, "lng": 74.1600, "address": "Pune Hub"},
        "drop": {"lat": 18.5100, "lng": 74.1700, "address": "Pune Target"},
        "weight": 2,
        "is_leg": True,
        "leg_type": "last_mile",
        "pickup_warehouse_id": "wh_B"
    }
    # Test 4a: Normal weather (Drone should be assigned via fast-path)
    from backend.services.route_engine import check_drone_viability
    d_viability = check_drone_viability(shipment_lm["pickup"]["lat"], shipment_lm["pickup"]["lng"], shipment_lm["drop"]["lat"], shipment_lm["drop"]["lng"], shipment_lm["weight"])
    print(f"DEBUG Drone Viability check: {d_viability}")
    
    drone_veh_list = [
        v for v in JSONDatabase("vehicles").get_all()
        if v and "drone" in v.get("type", "").lower()
        and v.get("base_warehouse_id") == shipment_lm.get("pickup_warehouse_id")
        and v.get("status") == "available"
    ]
    print(f"DEBUG Drone Vehicles list: {drone_veh_list}")

    res_normal = auto_assign_shipment(shipment_lm)
    print(f"DEBUG res_normal: {res_normal}")
    assert "error" not in res_normal
    assert res_normal["assigned_vehicle_id"] == "veh_lm_drone", f"Expected drone, got {res_normal['assigned_vehicle_id']}"
    print("✅ Test 4a Passed: Drone correctly assigned under normal weather.")
    
    # Test 4b: Ground drones & bikes in bad weather
    rain_cell = {
        "id": "rain_cell_pune",
        "company_id": company_id,
        "type": "storm", # storm grounds drones/bikes without pausing deliveries
        "lat": 18.5000,
        "lng": 74.1600,
        "radius": 10,
        "shapeType": "circle",
        "severity": "critical",
        "is_simulation": True
    }
    weather_db.insert(rain_cell)
    
    res_storm = auto_assign_shipment(shipment_lm)
    assert "error" not in res_storm
    # Drone and bike grounded. Only delivery van should match.
    assert res_storm["assigned_vehicle_id"] == "veh_lm_van", f"Expected delivery van in storm, got {res_storm['assigned_vehicle_id']}"
    print("✅ Test 4b Passed: Drone and Bike grounded; Van successfully selected.")
    
    weather_db.delete_many("data->>id", "rain_cell_pune")

    # ── Test 5: Middle Mile & Back-haul Return Preference ──
    print("\nRunning Test 5: Middle-Mile Handoff & Back-haul return...")
    shipment_mm = {
        "id": "ship_middle_mile",
        "company_id": company_id,
        "pickup": {"lat": 18.5204, "lng": 73.8567, "address": "Pune Hub"},
        "drop": {"lat": 19.0760, "lng": 72.8777, "address": "Mumbai Hub"},
        "weight": 80,
        "is_leg": True,
        "leg_type": "middle_mile",
        "pickup_warehouse_id": "wh_B",
        "drop_warehouse_id": "wh_A"
    }
    res = auto_assign_shipment(shipment_mm)
    assert "error" not in res
    # veh_mm_backhaul is based in wh_A, but physically present in wh_B (the shipment source).
    # It should receive a back-haul boost and win over veh_mm_heavy (based in wh_B).
    assert res["assigned_vehicle_id"] == "veh_mm_backhaul", f"Expected backhaul truck, got {res['assigned_vehicle_id']}"
    print("✅ Test 5 Passed: Back-haul truck prioritized successfully.")

    # ── Test 6: Calamity Detection and Safe Hub Rerouting ──
    print("\nRunning Test 6: Calamity Rerouting & Alerts...")
    # Seed a disaster (cyclone) centered between Mumbai and Pune
    disaster = {
        "id": "cyclone_disaster",
        "company_id": company_id,
        "type": "cyclone",
        "lat": 18.8000,
        "lng": 73.3000,
        "radius": 35, # 35km zone to cover Lonavala but leave wh_safe and Mumbai out
        "shapeType": "circle",
        "severity": "critical",
        "is_simulation": True
    }
    weather_db.insert(disaster)
    
    # Active transit shipment passing through the disaster region
    shipment_transit = {
        "id": "ship_transit_divert",
        "company_id": company_id,
        "current_location": {"lat": 18.7500, "lng": 73.2000, "address": "Moving near Lonavala"},
        "pickup": {"lat": 18.5204, "lng": 73.8567, "address": "Pune Hub"},
        "drop": {"lat": 19.0760, "lng": 72.8777, "address": "Mumbai Hub"}, # Path is through Lonavala disaster zone
        "status": "in_transit",
        "stage": "Transit",
        "logs": []
    }
    shipments_db.insert(shipment_transit)
    
    # Run the calamity check
    rerouted = check_and_reroute_calamities(shipment_transit, [disaster])
    assert rerouted is True, "Calamity check should have triggered a reroute"
    
    # Fetch updated shipment
    updated_shipment = shipments_db.get_by_id("ship_transit_divert")
    # Destination must be updated to the nearest safe warehouse (wh_safe)
    assert updated_shipment["drop_warehouse_id"] == "wh_Safe", f"Expected destination wh_Safe, got {updated_shipment['drop_warehouse_id']}"
    assert "Diverted: Safe Hub" in updated_shipment["stage"]
    assert updated_shipment["status"] == "split"
    
    # Verify alert generation in alerts_db
    alerts = alerts_db.get_filtered({"company_id": company_id, "type": "calamity_divert"})
    assert len(alerts) == 1, f"Expected 1 calamity alert, found {len(alerts)}"
    alert = alerts[0]
    assert alert["shipment_id"] == "ship_transit_divert"
    assert alert["severity"] == "critical"
    print("✅ Test 6 Passed: Calamity triggered automatic safe-hub rerouting and critical alert successfully.")

    # ── Clean up test records ──
    drivers_db.delete_many("data->>company_id", company_id)
    vehicles_db.delete_many("data->>company_id", company_id)
    warehouses_db.delete_many("data->>company_id", company_id)
    shipments_db.delete_many("data->>company_id", company_id)
    weather_db.delete_many("data->>company_id", company_id)
    alerts_db.delete_many("data->>company_id", company_id)
    print("\n=== ALL TESTS PASSED SUCCESSFULLY ===")

if __name__ == "__main__":
    run_tests()
