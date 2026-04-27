from fastapi import APIRouter, HTTPException, status, Header
from pydantic import BaseModel
from typing import Optional, List
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
customer_sessions = {}  # token -> phone

class OTPRequest(BaseModel):
    email: str

class OTPVerify(BaseModel):
    email: str
    otp: str
    company_data: CompanyCreate

@router.get("/check-email")
async def check_email(email: str):
    existing = [c for c in companies_db.get_all() if c.get("email") == email]
    return {"exists": len(existing) > 0}

@router.post("/company/request-otp")
def request_otp(data: OTPRequest):
    # Check if company already exists
    existing = [c for c in companies_db.get_all() if c.get("email") == data.email]
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This email is already registered. Please login instead.")

    otp = str(random.randint(100000, 999999))
    otp_store[data.email] = otp
    
    from backend.services.email_service import EmailService
    success = EmailService.send_otp_email(data.email, otp)
    
    if not success:
        # Fallback to mock in case of failure for now
        print(f"\n--- [FALLBACK MOCK OTP EMAIL] ---")
        print(f"To: {data.email}")
        print(f"Code: {otp}")
        print(f"----------------------------------\n")
        return {"message": "Email service failed. Check server console for code.", "email": data.email}
        
    return {"message": "Verification code sent to your email.", "email": data.email}

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
    try:
        drivers = drivers_db.get_all()
        for d in drivers:
            if d.get("login_id") == data.login_id and d.get("password") == data.password:
                return {
                    "message": "Login successful", 
                    "driver_id": d.get("id"), 
                    "name": d.get("name", "Driver"), 
                    "company_id": d.get("company_id")
                }
        raise HTTPException(status_code=401, detail="Invalid credentials")
    except Exception as e:
        print(f"Driver Login Critical Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
    
    # Auto-prepend +91 if only 10 digits are provided
    if len(phone) == 10 and phone.isdigit():
        phone = "+91" + phone

    all_shipments = shipments_db.get_all()
    matched = [s for s in all_shipments if s.get("receiver_phone") == phone]
    if not matched:
        raise HTTPException(status_code=404, detail="No orders found for this phone number")
    
    otp = str(random.randint(100000, 999999))
    customer_otp_store[phone] = otp
    
    from backend.services.whatsapp_service import WhatsAppService
    success = WhatsAppService.send_otp(phone, otp)
    
    if not success:
        print(f"\n--- [FALLBACK MOCK CUSTOMER OTP SMS] ---")
        print(f"To: {phone}")
        print(f"Code: {otp}")
        print(f"----------------------------------------\n")
        return {"message": "WhatsApp delivery failed. Check server console for code.", "phone": phone}
        
    return {"message": "OTP sent to your WhatsApp number.", "phone": phone}

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

    token = str(uuid.uuid4())
    customer_sessions[token] = phone
    
    return {"phone": phone, "orders": slim, "session_token": token}

@router.get("/customer/shipments")
def get_customer_shipments(x_logistix_context: Optional[str] = Header(None)):
    """Lookup all shipments by session token (secured via header)."""
    phone = customer_sessions.get(x_logistix_context)
    if not phone:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
        
    all_shipments = shipments_db.get_all()
    orders = [s for s in all_shipments if s.get("receiver_phone") == phone]
    orders.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return orders
