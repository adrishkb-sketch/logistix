from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
import random
from backend.models import CompanyCreate, CompanyLogin, DriverLogin
from backend.database import JSONDatabase
import uuid

router = APIRouter()
companies_db = JSONDatabase("companies")
drivers_db = JSONDatabase("drivers")

# Temporary in-memory OTP store for simulation
otp_store = {}

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
            return {"message": "Login successful", "driver_id": d["id"], "name": d["name"]}
    raise HTTPException(status_code=401, detail="Invalid credentials")
