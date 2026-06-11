import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.routers.tracking import track_shipment
from backend.database import JSONDatabase

try:
    s_db = JSONDatabase("shipments")
    all_ships = s_db.get_all()
    if all_ships:
        shipment_id = all_ships[0]["id"]
        print(f"Testing with shipment ID: {shipment_id}")
        res = track_shipment(shipment_id)
        print("Success! Response keys:", res.keys())
    else:
        print("No shipments found in database.")
except Exception as e:
    import traceback
    print("Error occurred:")
    traceback.print_exc()
