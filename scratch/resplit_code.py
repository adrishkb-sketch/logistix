@router.post("/{shipment_id}/resplit")
def resplit_route(shipment_id: str):
    from backend.database import JSONDatabase
    from backend.services.route_engine import decompose_shipment
    from backend.routers.shipment import _generate_legs
    from backend.services.assignment import auto_assign_shipment
    from backend.models import ShipmentEvent
    import traceback

    try:
        shipments_db = JSONDatabase("shipments")
        drivers_db = JSONDatabase("drivers")
        vehicles_db = JSONDatabase("vehicles")
        
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
            
        for leg in unstarted_legs:
            d_id = leg.get("assigned_driver_id")
            v_id = leg.get("assigned_vehicle_id")
            if d_id:
                drivers_db.update(d_id, {"status": "available", "current_shipment_id": None})
            if v_id:
                vehicles_db.update(v_id, {"status": "available"})
            shipments_db.delete(leg["id"])
            
        valid_leg_ids = [l["id"] for l in legs if l not in unstarted_legs]
        
        pseudo_shipment = shipment.copy()
        pseudo_shipment["pickup"] = start_location
        
        new_legs_data = decompose_shipment(pseudo_shipment)
        
        start_order = active_leg["leg_order"] + 1 if active_leg else 1
        
        if new_legs_data:
            for ld in new_legs_data:
                ld["leg_order"] = start_order
                start_order += 1
                
            new_leg_ids = _generate_legs(shipment, new_legs_data)
        else:
            new_direct_data = [{
                "pickup": start_location,
                "drop": shipment["drop"],
                "leg_type": "last_mile" if active_leg else "direct",
                "leg_order": start_order
            }]
            if start_warehouse_id:
                new_direct_data[0]["pickup_warehouse_id"] = start_warehouse_id
                
            new_leg_ids = _generate_legs(shipment, new_direct_data)
            
        # Assign new legs
        for nid in new_leg_ids:
            new_leg = shipments_db.get_by_id(nid)
            if new_leg:
                assigned = auto_assign_shipment(new_leg)
                if assigned and "error" not in assigned:
                    new_leg["assigned_driver_id"] = assigned["assigned_driver_id"]
                    new_leg["assigned_vehicle_id"] = assigned["assigned_vehicle_id"]
                    new_leg["status"] = "assigned"
                    shipments_db.update(nid, new_leg)
                    
        log_msg = f"🔀 DYNAMIC RE-SPLIT: Route was dynamically re-calculated from current position. {len(unstarted_legs)} unstarted legs were voided, {len(new_leg_ids)} new optimal legs generated."
        log = ShipmentEvent(status="split", message=log_msg, reason="Manager requested re-split based on real-time conditions")
        
        shipments_db.update(shipment_id, {
            "child_leg_ids": valid_leg_ids + new_leg_ids,
            "route_type": "multi-leg" if valid_leg_ids or len(new_leg_ids) > 1 else "direct",
            "logs": shipment.get("logs", []) + [log.model_dump()]
        })
            
        return {"message": "Route successfully re-split and optimal drivers generated."}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
