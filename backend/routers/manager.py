from fastapi import APIRouter, HTTPException
from backend.models import Driver, Vehicle, Warehouse
from backend.database import JSONDatabase

router = APIRouter()
drivers_db = JSONDatabase("drivers")
vehicles_db = JSONDatabase("vehicles")
warehouses_db = JSONDatabase("warehouses")

# Drivers CRUD
@router.post("/drivers")
def create_driver(driver: Driver):
    return drivers_db.insert(driver.model_dump())

@router.get("/drivers")
def get_drivers():
    return drivers_db.get_all()

@router.delete("/drivers/{driver_id}")
def delete_driver(driver_id: str):
    if drivers_db.delete(driver_id):
        return {"message": "Deleted"}
    raise HTTPException(status_code=404, detail="Driver not found")

# Vehicles CRUD
@router.post("/vehicles")
def create_vehicle(vehicle: Vehicle):
    return vehicles_db.insert(vehicle.model_dump())

@router.get("/vehicles")
def get_vehicles():
    return vehicles_db.get_all()

@router.delete("/vehicles/{vehicle_id}")
def delete_vehicle(vehicle_id: str):
    if vehicles_db.delete(vehicle_id):
        return {"message": "Deleted"}
    raise HTTPException(status_code=404, detail="Vehicle not found")

# Warehouses CRUD
@router.post("/warehouses")
def create_warehouse(warehouse: Warehouse):
    return warehouses_db.insert(warehouse.model_dump())

@router.get("/warehouses")
def get_warehouses():
    return warehouses_db.get_all()

@router.put("/drivers/{driver_id}")
def update_driver(driver_id: str, data: dict):
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    drivers_db.update(driver_id, data)
    return {"message": "Driver updated successfully"}

@router.put("/vehicles/{vehicle_id}")
def update_vehicle(vehicle_id: str, data: dict):
    vehicle = vehicles_db.get_by_id(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    vehicles_db.update(vehicle_id, data)
    return {"message": "Vehicle updated successfully"}

@router.post("/link-vehicle")
def link_driver_to_vehicle(driver_id: str, vehicle_id: str):
    driver = drivers_db.get_by_id(driver_id)
    vehicle = vehicles_db.get_by_id(vehicle_id)
    
    if not driver or not vehicle:
        raise HTTPException(status_code=404, detail="Driver or Vehicle not found")
        
    # Validation
    if driver["license_type"] != vehicle["type"]:
        raise HTTPException(status_code=400, detail=f"License mismatch: {driver['name']} has {driver['license_type']} license, cannot drive {vehicle['type']}.")
        
    # Unlink any existing
    if vehicle.get("assigned_driver_id"):
        drivers_db.update(vehicle["assigned_driver_id"], {"assigned_vehicle_id": None})
    if driver.get("assigned_vehicle_id"):
        vehicles_db.update(driver["assigned_vehicle_id"], {"assigned_driver_id": None})
        
    # Link
    drivers_db.update(driver_id, {"assigned_vehicle_id": vehicle_id, "verification_status": "unverified"})
    vehicles_db.update(vehicle_id, {"assigned_driver_id": driver_id})
    
    return {"message": "Linked successfully"}

@router.post("/verify-driver/{driver_id}")
def manual_verify_driver(driver_id: str, status: str):
    if status not in ["verified", "unverified"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    driver = drivers_db.get_by_id(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    drivers_db.update(driver_id, {"verification_status": status})
    return {"message": f"Driver marked as {status}"}
