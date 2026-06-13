import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import JSONDatabase
from backend.services.route_engine import decompose_shipment
from backend.services.assignment import auto_assign_shipment

def test_ai_splitting_and_assignment_fallback():
    # 1. Setup config for company ID
    companies_db = JSONDatabase("companies")
    all_companies = companies_db.get_all()
    assert all_companies, "No companies found in database."
    company_id = all_companies[0]["id"]
    
    config_db = JSONDatabase("config")
    
    # Save original config to restore later
    original_cfg = config_db.get_by_id(company_id) or {}
    
    try:
        # Enable AI Mode with mock keys
        config_db.update(company_id, {
            "ai_mode": True,
            "gemini_keys": ["MOCK_KEY_1", "MOCK_KEY_2"]
        })
        
        # 2. Test mock shipment route splitting
        shipment = {
            "company_id": company_id,
            "pickup": {"lat": 28.6139, "lng": 77.2090, "address": "New Delhi"},
            "drop": {"lat": 19.0760, "lng": 72.8777, "address": "Mumbai"},
            "weight": 10,
            "is_leg": False
        }
        
        # Since keys are mock, Gemini API calls will fail, triggering fallback gracefully.
        legs = decompose_shipment(shipment)
        assert isinstance(legs, list), "Should return a list of legs"
        
        if legs:
            assert len(legs) > 0
            leg = legs[0]
            # Test assignment fallback on a leg
            assignment = auto_assign_shipment(leg)
            assert "assigned_driver_id" in assignment
            assert "assigned_vehicle_id" in assignment
            assert "ai_reasoning" in assignment
            assert "stage" in assignment
            assert assignment["stage"] == "Assigned via Gemini AI Engine"
            print("AI Mode Enabled: Fallback triggers successfully.")

        # 3. Test AI Mode OFF fallback
        config_db.update(company_id, {
            "ai_mode": False,
            "gemini_keys": []
        })
        legs = decompose_shipment(shipment)
        if legs:
            leg = legs[0]
            assignment = auto_assign_shipment(leg)
            assert assignment["stage"] == "Assigned to Driver (Gemini AI not activated)"
            print("AI Mode Disabled: Core logic falls back to default stage successfully.")
            
        print("AI Routing & Assignment Fallback Verification PASSED!")
        
    finally:
        # Restore original configuration
        config_db.update(company_id, original_cfg)

if __name__ == "__main__":
    test_ai_splitting_and_assignment_fallback()
