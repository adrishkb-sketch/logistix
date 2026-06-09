import sys
import os
from os.path import dirname, abspath

# Add backend to path
sys.path.append(dirname(dirname(abspath(__file__))))

from backend.database import JSONDatabase

def view_times():
    db = JSONDatabase("shipments")
    parent = db.get_by_id("0b998889-130a-481c-ace6-ecfa5cf32ff8")
    if parent:
        print("PARENT:")
        print("  Description:", parent.get("description"))
        print("  Created At:", parent.get("created_at"))
        print("  Pickup Deadline:", parent.get("pickup_deadline"))
        print("  Expected Delivery:", parent.get("expected_delivery"))
        print("  Logs:", [l.get("timestamp") for l in parent.get("logs", [])])
        
    legs = [s for s in db.get_all() if s.get("parent_id") == "0b998889-130a-481c-ace6-ecfa5cf32ff8"]
    for l in legs:
        print(f"LEG {l.get('leg_order')}:")
        print("  ID:", l.get("id"))
        print("  Pickup Deadline:", l.get("pickup_deadline"))
        print("  Expected Delivery:", l.get("expected_delivery"))

if __name__ == "__main__":
    view_times()
