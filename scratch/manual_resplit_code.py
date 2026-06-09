from pydantic import BaseModel
from typing import Optional

class ManualResplitRequest(BaseModel):
    warehouse_id: Optional[str] = None

@router.post("/{shipment_id}/manual-resplit")
def manual_resplit_route(shipment_id: str, data: ManualResplitRequest):
    from backend.database import JSONDatabase
    from backend.routers.shipment import _generate_legs
    from backend.services.assignment import auto_assign_shipment
    from backend.models import ShipmentEvent
    import traceback

    try:
        shipments_db = JSONDatabase("shipments")
        drivers_db = JSONDatabase("drivers")
        vehicles_db = JSONDatabase("vehicles")
        warehouses_db = JSONDatabase("warehouses")
        
        shipment = shipments_db.get_by_id(shipment_id)
        if not shipment:
            raise HTTPException(status_code=404, detail="Shipment not found")
            
        all_ships = shipments_db.get_all()
        legs = [s for s in all_ships if s.get("parent_id") == shipment_id]
        legs.sort(key=lambda x: x.get("leg_order", 0))
        
        active_leg = None
        for leg in reversed(legs):
            if leg.get("status") in ["delivered", "in_transit"]:
                active_leg = leg
                break
                
        start_location = active_leg["drop"] if active_leg else shipment["pickup"]
        start_warehouse_id = active_leg.get("drop_warehouse_id") if active_leg else None
        
        unstarted_legs = []
        if active_leg:
            idx = legs.index(active_leg)
            unstarted_legs = legs[idx+1:]
        else:
            unstarted_legs = legs
            
        if not unstarted_legs and legs:
            raise HTTPException(status_code=400, detail="All legs are already active or completed. Nothing to resplit.")
            
        # Free up drivers
        for leg in unstarted_legs:
            d_id = leg.get("assigned_driver_id")
            v_id = leg.get("assigned_vehicle_id")
            if d_id:
                drivers_db.update(d_id, {"status": "available", "current_shipment_id": None})
            if v_id:
                vehicles_db.update(v_id, {"status": "available"})
            shipments_db.delete(leg["id"])
            
        valid_leg_ids = [l["id"] for l in legs if l not in unstarted_legs]
        start_order = active_leg["leg_order"] + 1 if active_leg else 1
        
        new_legs_data = []
        
        if data.warehouse_id:
            wh = warehouses_db.get_by_id(data.warehouse_id)
            if not wh:
                raise HTTPException(status_code=404, detail="Chosen warehouse not found")
                
            # Leg A
            leg_a = {
                "pickup": start_location,
                "drop": {"lat": wh["lat"], "lng": wh["lng"], "address": wh["name"]},
                "drop_warehouse_id": wh["id"],
                "leg_type": "middle_mile" if start_warehouse_id else "first_mile",
                "leg_order": start_order
            }
            if start_warehouse_id:
                leg_a["pickup_warehouse_id"] = start_warehouse_id
            new_legs_data.append(leg_a)
            
            # Leg B
            leg_b = {
                "pickup": {"lat": wh["lat"], "lng": wh["lng"], "address": wh["name"]},
                "drop": shipment["drop"],
                "pickup_warehouse_id": wh["id"],
                "leg_type": "last_mile",
                "leg_order": start_order + 1
            }
            new_legs_data.append(leg_b)
        else:
            # Direct
            leg_direct = {
                "pickup": start_location,
                "drop": shipment["drop"],
                "leg_type": "last_mile" if start_warehouse_id else "direct",
                "leg_order": start_order
            }
            if start_warehouse_id:
                leg_direct["pickup_warehouse_id"] = start_warehouse_id
            new_legs_data.append(leg_direct)
            
        new_leg_ids = _generate_legs(shipment, new_legs_data)
        
        log_msg = f"🔀 MANUAL RE-ROUTE: Route dynamically altered. {len(unstarted_legs)} unstarted legs voided, {len(new_leg_ids)} new legs generated."
        log = ShipmentEvent(status="split", message=log_msg, reason="Manager manually selected custom route.")
        
        shipments_db.update(shipment_id, {
            "child_leg_ids": valid_leg_ids + new_leg_ids,
            "route_type": "multi-leg" if valid_leg_ids or len(new_leg_ids) > 1 else "direct",
            "logs": shipment.get("logs", []) + [log.model_dump()]
        })
            
        return {"message": "Manual route successfully configured."}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
