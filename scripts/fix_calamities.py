import sys
import os

# Add the backend path so we can import from backend
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.database import JSONDatabase
from backend.services.route_engine import check_and_reroute_calamities
from backend.routers.tracking import get_all_active_weather_cells

def migrate_existing_calamities():
    shipments_db = JSONDatabase("shipments")
    all_shipments = shipments_db.get_all()
    
    # Process only active, non-leg shipments first to avoid duplicate processing of legs
    active_parents = [s for s in all_shipments if s and s.get("status") in ["assigned", "in_transit"] and not s.get("is_leg")]
    
    count = 0
    for s in active_parents:
        # Check against active weather cells
        cells = get_all_active_weather_cells(s.get("company_id"))
        result = check_and_reroute_calamities(s, cells)
        if result:
            count += 1
            print(f"Migrated/Updated shipment {s['id']}")
            
    print(f"Migration complete. Processed {count} shipments affected by calamities.")

if __name__ == "__main__":
    migrate_existing_calamities()
