from fastapi import APIRouter, HTTPException
from backend.database import JSONDatabase

router = APIRouter()
shipments_db = JSONDatabase("shipments")
alerts_db = JSONDatabase("alerts")

@router.get("/{shipment_id}")
def track_shipment(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    # Fetch alerts for this shipment
    all_alerts = alerts_db.get_all()
    active_alerts = [a for a in all_alerts if a.get("shipment_id") == shipment_id and a.get("status") == "active"]
    
    return {
        "shipment": shipment,
        "alerts": active_alerts
    }
