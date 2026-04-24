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

class SmartContractTx(BaseModel):
    tx_hash: str = Field(default_factory=lambda: f"0x{uuid.uuid4().hex}")
    from_address: str = "Logistix_Escrow"
    to_address: str
    points_awarded: float
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    shipment_id: str
    leg_id: Optional[str] = None

# Data Models

class Location(BaseModel):
    lat: float
    lng: float
    address: Optional[str] = None

import string
import random

def generate_system_id(prefix: str) -> str:
    chars = string.ascii_uppercase + string.digits
    suffix = ''.join(random.choices(chars, k=4))
    return f"{prefix}-{suffix}"

class Driver(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    system_id: str = Field(default_factory=lambda: generate_system_id("DRV"))
    company_id: str
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
    base_warehouse_id: Optional[str] = None
    verification_status: str = "unverified" # unverified, pending_manual, verified
    verification_image: Optional[str] = None
    join_date: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    total_trips: int = 0
    safety_index: float = 100.0
    punctuality_rate: float = 100.0
    health_metrics: Optional[dict] = {
        "heart_rate": 72,
        "blood_pressure": "120/80",
        "oxygen": 98,
        "stress_index": 15
    }
    last_health_check: Optional[str] = None
    last_rest_start: Optional[str] = None
    profile_pic: Optional[str] = None
    customer_ratings: List[float] = Field(default_factory=list)
    work_hours_today: float = 0.0
    # ML Tracking Fields
    years_experience: float = 0.0
    past_accidents: int = 0
    traffic_violations: int = 0
    reward_points: float = 0.0
    phone_number: Optional[str] = None
    
    # Zen Mode Fields
    is_zen_mode: bool = False
    zen_destination: Optional[Location] = None

class Vehicle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    system_id: str = Field(default_factory=lambda: generate_system_id("VEH"))
    company_id: str
    type: str # bike, van, truck
    number_plate: str # e.g. MH-12-AB-1234
    speed: float # avg km/h
    capacity: float # kg
    fuel_efficiency: float # km/l
    vehicle_health_score: float = 100.0
    last_service_date: Optional[str] = None
    status: str = "available" # available, assigned, maintenance
    assigned_driver_id: Optional[str] = None
    base_warehouse_id: Optional[str] = None
    join_date: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    total_distance_km: float = 0.0
    efficiency_score: float = 100.0

class Warehouse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    name: str
    lat: float
    lng: float
    drone_count: int = 0
    contact_number: Optional[str] = None
    manager_name: Optional[str] = None

class ShipmentEvent(BaseModel):
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    status: str
    message: str
    reason: Optional[str] = None # 'weather', 'traffic', 'challan', 'mechanical'
    location: Optional[Location] = None
    photo_url: Optional[str] = None

class Shipment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
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
    pickup_deadline: Optional[str] = None
    performance_stats: Optional[dict] = None
    assigned_driver_id: Optional[str] = None
    assigned_vehicle_id: Optional[str] = None
    current_location: Optional[Location] = None
    parent_id: Optional[str] = None # For multi-leg shipments
    is_leg: bool = False
    leg_order: int = 0
    logs: List[ShipmentEvent] = Field(default_factory=list)
    
    # Cold Chain 2.0 Fields
    is_perishable: bool = False
    vitality: float = 100.0 # 0 to 100
    temperature_last_recorded: Optional[float] = None
    loading_blueprint: Optional[List[dict]] = None
    qr_code_data: Optional[str] = None
    receiver_name: Optional[str] = None
    receiver_phone: Optional[str] = None

class ShipmentCreate(BaseModel):
    pickup: Location
    drop: Location
    weight: float
    description: str
    labels: Optional[List[str]] = []
    is_perishable: bool = False
    receiver_name: str
    receiver_phone: str

class Alert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    type: str # traffic, weather, delay, fatigue
    description: str
    severity: str # low, medium, high, critical
    suggestion: str
    shipment_id: Optional[str] = None
    driver_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    status: str = "active" # active, ignored, resolved

class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    shipment_id: Optional[str] = None
    sender_id: str # company_id or driver_id
    receiver_id: str # company_id or driver_id
    content: str
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    sender_type: str # manager, driver

class JourneyReview(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    shipment_id: str
    driver_id: str
    punctuality_score: float
    safety_score: float
    challan_penalty: float
    total_score: float
    feedback_message: str
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
