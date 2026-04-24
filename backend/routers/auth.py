from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
import random
from backend.models import CompanyCreate, CompanyLogin, DriverLogin
from backend.database import JSONDatabase
import uuid

router = APIRouter()
companies_db = JSONDatabase("companies")
drivers_db = JSONDatabase("drivers")
shipments_db = JSONDatabase("shipments")

# Temporary in-memory OTP store for simulation
otp_store = {}
customer_otp_store = {}  # phone -> otp

class OTPRequest(BaseModel):
    email: str

class OTPVerify(BaseModel):
    email: str
    otp: str
    company_data: CompanyCreate

@router.post("/company/request-otp")
def request_otp(data: OTPRequest):
    # Simulate sending OTP
    otp = str(random.randint(100000, 999999))
    otp_store[data.email] = otp
    print(f"\n--- [MOCK OTP EMAIL] ---")
    print(f"To: {data.email}")
    print(f"Your Logistix verification code is: {otp}")
    print(f"------------------------\n")
    return {"message": "OTP generated. Check server console.", "email": data.email}

@router.post("/company/verify-signup")
def verify_signup(data: OTPVerify):
    stored_otp = otp_store.get(data.email)
    if not stored_otp or stored_otp != data.otp:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")
    
    # Check if company already exists
    existing = [c for c in companies_db.get_all() if c["email"] == data.company_data.email]
    if existing:
        raise HTTPException(status_code=400, detail="Company email already registered")

    new_company = data.company_data.model_dump()
    new_company["id"] = str(uuid.uuid4())
    # In a real app, hash password here!
    companies_db.insert(new_company)
    del otp_store[data.email] # clear OTP
    return {"message": "Company registered successfully", "company_id": new_company["id"]}

@router.post("/company/login")
def company_login(data: CompanyLogin):
    companies = companies_db.get_all()
    for c in companies:
        if c["email"] == data.email and c["password"] == data.password:
            return {"message": "Login successful", "company_id": c["id"], "name": c["name"]}
    raise HTTPException(status_code=401, detail="Invalid credentials")

@router.post("/driver/login")
def driver_login(data: DriverLogin):
    drivers = drivers_db.get_all()
    for d in drivers:
        if d["login_id"] == data.login_id and d["password"] == data.password:
            return {"message": "Login successful", "driver_id": d["id"], "name": d["name"], "company_id": d.get("company_id")}
    raise HTTPException(status_code=401, detail="Invalid credentials")

# ──────────────────────────────────────────────────────────────
# Customer Tracking: Phone → OTP → Orders
# ──────────────────────────────────────────────────────────────

class CustomerOTPRequest(BaseModel):
    phone: str

class CustomerOTPVerify(BaseModel):
    phone: str
    otp: str

@router.post("/customer/request-otp")
def customer_request_otp(data: CustomerOTPRequest):
    phone = data.phone.strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")
    all_shipments = shipments_db.get_all()
    matched = [s for s in all_shipments if s.get("receiver_phone") == phone]
    if not matched:
        raise HTTPException(status_code=404, detail="No orders found for this phone number")
    otp = str(random.randint(100000, 999999))
    customer_otp_store[phone] = otp
    print(f"\n--- [MOCK CUSTOMER OTP SMS] ---")
    print(f"To: {phone}")
    print(f"Your Logistix tracking code is: {otp}")
    print(f"--------------------------------\n")
    return {"message": "OTP sent. Check server console.", "phone": phone}

@router.post("/customer/verify-otp")
def customer_verify_otp(data: CustomerOTPVerify):
    phone = data.phone.strip()
    stored = customer_otp_store.get(phone)
    if not stored or stored != data.otp.strip():
        raise HTTPException(status_code=401, detail="Invalid or expired OTP")
    del customer_otp_store[phone]
    all_shipments = shipments_db.get_all()
    orders = [s for s in all_shipments if s.get("receiver_phone") == phone]
    orders.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    slim = []
    for s in orders:
        slim.append({
            "id": s.get("id"),
            "description": s.get("description"),
            "status": s.get("status"),
            "stage": s.get("stage"),
            "expected_delivery": s.get("expected_delivery"),
            "created_at": s.get("created_at"),
            "receiver_name": s.get("receiver_name"),
        })
    return {"phone": phone, "orders": slim}

@router.get("/customer/shipments")
def get_customer_shipments(phone: str):
    """Lookup all shipments by receiver phone (used for order-id search)."""
    all_shipments = shipments_db.get_all()
    orders = [s for s in all_shipments if s.get("receiver_phone") == phone]
    orders.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return orders
