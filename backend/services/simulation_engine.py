import threading
import time
import os
from datetime import datetime
from backend.database import JSONDatabase
from backend.services.route_engine import haversine

class SimulationEngine:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(SimulationEngine, cls).__new__(cls)
                cls._instance.active = False
                cls._instance.thread = None
                cls._instance.halted_drivers = set() # driver_id -> bool
            return cls._instance

    def start(self):
        if self.active:
            return
        
        # Snapshot state before starting
        JSONDatabase.snapshot()
        
        self.active = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.active = False
        if self.thread:
            self.thread.join(timeout=1)
        
        # Restore state
        JSONDatabase.restore()
        self.halted_drivers.clear()

    def toggle_driver_halt(self, driver_id: str):
        if driver_id in self.halted_drivers:
            self.halted_drivers.remove(driver_id)
            return False
        else:
            self.halted_drivers.add(driver_id)
            return True

    def _run_loop(self):
        shipments_db = JSONDatabase("shipments")
        while self.active:
            try:
                all_shipments = shipments_db.get_all()
                for s in all_shipments:
                    if s.get("status") == "in_transit":
                        driver_id = s.get("assigned_driver_id")
                        if driver_id in self.halted_drivers:
                            continue
                        
                        # Move logic
                        curr = s.get("current_location") or s.get("pickup")
                        dest = s.get("drop")
                        
                        # Calculate distance to dest
                        dist = haversine(curr["lat"], curr["lng"], dest["lat"], dest["lng"])
                        
                        if dist < 0.1: # Arrived
                            if s.get("route_type") == "drone-leg":
                                # Drone delivery completed!
                                from backend.models import ShipmentEvent
                                wh_id = s.get("pickup_warehouse_id")
                                log = ShipmentEvent(
                                    status="delivered",
                                    message="🏁 Drone landing successful. Shipment delivered to customer doorstep.",
                                    reason="Autonomous flight path completed."
                                )
                                s["logs"] = s.get("logs", []) + [log.model_dump()]
                                s["status"] = "delivered"
                                s["stage"] = "Delivered"
                                s["actual_delivery"] = datetime.utcnow().isoformat() + "Z"
                                shipments_db.update(s["id"], s)
                                
                                # Log Maintenance Expense for Drone
                                if s.get("finance"):
                                    from backend.database import JSONDatabase
                                    ledger_db = JSONDatabase("ledger")
                                    maint = s["finance"].get("maintenance_cost", 50.0)
                                    ledger_db.insert({
                                        "type": "EXPENSE",
                                        "desc": f"Drone Maintenance: Segment {s['id'][:8]}",
                                        "amount": maint,
                                        "timestamp": datetime.utcnow().isoformat(),
                                        "company_id": s.get("company_id")
                                    })
                            continue
                            
                        # Move ~100m per tick (72km/h)
                        move_dist = 0.1 
                        ratio = move_dist / dist if dist > 0 else 0
                        if ratio > 1: ratio = 1
                        
                        new_lat = curr["lat"] + (dest["lat"] - curr["lat"]) * ratio
                        new_lng = curr["lng"] + (dest["lng"] - curr["lng"]) * ratio
                        
                        new_loc = {"lat": new_lat, "lng": new_lng, "address": "Simulated Movement"}
                        
                        # Update shipment location
                        shipments_db.update(s["id"], {"current_location": new_loc})
                        
                        # Call the real update logic to trigger warehouse proximity etc.
                        from backend.routers.driver import update_driver_location
                        if driver_id:
                            try:
                                # We call it but we don't want to re-run the whole loop if possible
                                # For now, just let the manual update logic handle it
                                # This will trigger warehouse logs etc.
                                update_driver_location(driver_id, new_loc, x_logistix_context=driver_id)
                            except Exception as e:
                                print(f"Sim update error: {e}")
                
            except Exception as e:
                print(f"Simulation Error: {e}")
            
            time.sleep(5) # Sim Tick every 5s

simulation_engine = SimulationEngine()
