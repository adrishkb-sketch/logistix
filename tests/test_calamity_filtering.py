import sys
import os
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from backend.main import app
from backend.database import JSONDatabase

def test_calamity_filtering():
    company_id = "557f9b08-30da-4b99-b233-a16c9df5191d"
    
    # Databases
    weather_db = JSONDatabase("weather_cells")
    alerts_db = JSONDatabase("alerts")
    shipments_db = JSONDatabase("shipments")
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    # Save original database states
    orig_weather = weather_db.get_all()
    orig_alerts = alerts_db.get_all()
    orig_shipments = shipments_db.get_all()
    
    client = TestClient(app)
    try:
        # Clear out simulated cells and active calamity alerts for testing
        weather_db.write([])
        
        # Ensure we have at least one active shipment matching the company
        # Let's find one or create one
        shipment = next((s for s in orig_shipments if s and s.get("company_id") == company_id and s.get("status") in ("assigned", "in_transit")), None)
        if not shipment:
            # Create a mock shipment
            driver_id = "drv_test"
            vehicle_id = "veh_test"
            shipment = {
                "id": "ship_test_calamity",
                "company_id": company_id,
                "status": "in_transit",
                "description": "Calamity Filter Test Shipment",
                "assigned_driver_id": driver_id,
                "assigned_vehicle_id": vehicle_id,
                "current_location": {"lat": 19.076, "lng": 72.8777}, # Mumbai
                "pickup": {"lat": 19.076, "lng": 72.8777},
                "drop": {"lat": 28.7041, "lng": 77.1025} # Delhi
            }
            shipments_db.insert(shipment)
            
            # Ensure mock driver and vehicle exist
            drivers_db.insert({"id": driver_id, "company_id": company_id, "name": "Test Driver", "assigned_vehicle_id": vehicle_id})
            vehicles_db.insert({"id": vehicle_id, "company_id": company_id, "number_plate": "MH-01-AB-1234", "type": "Heavy Truck"})
        
        curr_loc = shipment.get("current_location") or shipment.get("pickup")
        assert curr_loc and "lat" in curr_loc, "Shipment must have lat/lng location"
        lat = curr_loc["lat"]
        lng = curr_loc["lng"]
        
        # Clear existing active calamity alerts for this shipment
        for a in alerts_db.get_all():
            if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "calamity_divert":
                alerts_db.delete(a["id"])

        # ─── CASE 1: Non-calamity cell (e.g. Rain) ───
        # Insert a simulated rain cell intersecting our shipment
        rain_cell = {
            "id": "sim_rain_cell",
            "company_id": company_id,
            "type": "rain",
            "condition": "Rain",
            "severity": "warning",
            "lat": lat,
            "lng": lng,
            "radius": 50, # intersects!
            "is_simulation": True
        }
        weather_db.insert(rain_cell)
        
        # Query fleet weather
        res = client.get(f"/api/tracking/fleet/weather?company_id={company_id}")
        assert res.status_code == 200, res.text
        data = res.json()
        
        # Verify that rain cell is NOT treated as a calamity action proposal
        assert shipment["id"] not in [item["id"] for item in data["affected_list"]], "Rain cell should not trigger AI action"
        
        # Verify no active calamity alert was generated
        active_alerts = [a for a in alerts_db.get_all() if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "calamity_divert" and a.get("status") == "active"]
        assert len(active_alerts) == 0, "No active alert should be created for rain"

        # ─── CASE 2: Actual calamity cell (e.g. Cyclone) ───
        # Clear rain cell
        weather_db.delete("sim_rain_cell")
        
        cyclone_cell = {
            "id": "sim_cyclone_cell",
            "company_id": company_id,
            "type": "cyclone",
            "condition": "Cyclone",
            "severity": "critical",
            "lat": lat,
            "lng": lng,
            "radius": 50, # intersects!
            "is_simulation": True
        }
        weather_db.insert(cyclone_cell)
        
        # Query fleet weather again
        res = client.get(f"/api/tracking/fleet/weather?company_id={company_id}")
        assert res.status_code == 200, res.text
        data = res.json()
        
        # Verify that cyclone cell IS treated as a calamity action proposal
        affected_ids = [item["id"] for item in data["affected_list"]]
        assert shipment["id"] in affected_ids, "Cyclone cell must trigger AI action"
        
        # Verify active calamity alert was generated in database
        active_alerts = [a for a in alerts_db.get_all() if a and a.get("shipment_id") == shipment["id"] and a.get("type") == "calamity_divert" and a.get("status") == "active"]
        assert len(active_alerts) == 1, "An active alert must be created for cyclone"
        print("Calamity filtering test passed successfully!")

    finally:
        # Restore original database states
        weather_db.write(orig_weather)
        alerts_db.write(orig_alerts)
        shipments_db.write(orig_shipments)

if __name__ == "__main__":
    test_calamity_filtering()
