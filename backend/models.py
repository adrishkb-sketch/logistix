from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime
import uuid

# Models for Request Bodies

class CompanyCreate(BaseModel):
    name: str
    email: EmailStr
    password: str

class CompanyLogin(BaseModel):
    email: EmailStr
    password: str

class DriverLogin(BaseModel):
    login_id: str
    password: str

# Data Models

class Driver(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    login_id: str
    password: str
    rating: float = 5.0
    safety_rating: float = 5.0
    fatigue_score: float = 0.0
    on_time_rate: float = 100.0
    total_deliveries: int = 0
    status: str = "available" # available, assigned, on_duty
    license_type: str = "van" # bike, van, truck
    challan_count: int = 0
    driving_score: float = 100.0 # out of 100
    assigned_vehicle_id: Optional[str] = None
    verification_status: str = "unverified" # unverified, pending_manual, verified
    verification_image: Optional[str] = None

class Vehicle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str # bike, van, truck
    number_plate: str # e.g. MH-12-AB-1234
    speed: float # avg km/h
    capacity: float # kg
    fuel_efficiency: float # km/l
    vehicle_health_score: float = 100.0
    last_service_date: Optional[str] = None
    status: str = "available" # available, assigned, maintenance
    assigned_driver_id: Optional[str] = None

class Warehouse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    lat: float
    lng: float

class Location(BaseModel):
    lat: float
    lng: float
    address: Optional[str] = None

class Shipment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    pickup: Location
    drop: Location
    weight: float
    description: str
    labels: List[str] = Field(default_factory=list)
    delivery_otp: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    status: str = "pending" # pending, assigned, in_transit, delivered
    route_type: Optional[str] = None # direct, warehouse
    stage: str = "Awaiting Assignment"
    expected_delivery: Optional[str] = None
    assigned_driver_id: Optional[str] = None
    assigned_vehicle_id: Optional[str] = None
    current_location: Optional[Location] = None
    parent_id: Optional[str] = None # For multi-leg shipments
    is_leg: bool = False
    leg_order: int = 0

class ShipmentCreate(BaseModel):
    pickup: Location
    drop: Location
    weight: float
    description: str
    labels: Optional[List[str]] = []

class Alert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str # traffic, weather, delay, fatigue
    description: str
    severity: str # low, medium, high, critical
    suggestion: str
    shipment_id: Optional[str] = None
    driver_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    status: str = "active" # active, ignored, resolved
