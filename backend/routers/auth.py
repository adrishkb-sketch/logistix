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
    company_name: Optional[str] = None

class OTPVerify(BaseModel):
    email: str
    otp: str
    company_data: CompanyCreate

@router.get("/check-email")
async def check_email(email: str):
    existing = [c for c in companies_db.get_all() if c and c.get("email") == email]
    return {"exists": len(existing) > 0}

@router.post("/company/request-otp")
def request_otp(data: OTPRequest):
    # Check if company already exists
    existing = [c for c in companies_db.get_all() if c and c.get("email") == data.email]
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This email is already registered. Please login instead.")

    otp = str(random.randint(100000, 999999))
    otp_store[data.email] = otp
    
    from backend.services.email_service import EmailService
    success = EmailService.send_otp_email(data.email, otp, purpose="registration", context=data.company_name)
    
    if not success:
        return {"message": "Email service failed. Check server console for code.", "email": data.email}
        
    return {"message": "Verification code sent to your email.", "email": data.email}

@router.post("/company/verify-signup")
def verify_signup(data: OTPVerify):
    stored_otp = otp_store.get(data.email)
    if not stored_otp or stored_otp != data.otp:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")
    
    # Check if company already exists
    existing = [c for c in companies_db.get_all() if c and c.get("email") == data.company_data.email]
    if existing:
        raise HTTPException(status_code=400, detail="Company email already registered")

    new_company = data.company_data.model_dump()
    new_company["id"] = str(uuid.uuid4())
    # In a real app, hash password here!
    companies_db.insert(new_company)
    del otp_store[data.email] # clear OTP
    
    # Send Welcome Email
    from backend.services.email_service import EmailService
    EmailService.send_welcome_email(
        receiver_email=new_company["email"],
        company_name=new_company["name"],
        company_id=new_company["id"],
        password=new_company["password"]
    )
    
    return {"message": "Company registered successfully", "company_id": new_company["id"]}

@router.post("/company/login")
def company_login(data: CompanyLogin):
    companies = companies_db.get_all()
    if companies:
        for c in companies:
            if c and c.get("email") == data.email and c.get("password") == data.password:
                return {
                    "message": "Login successful", 
                    "company_id": c.get("id"), 
                    "name": c.get("name")
                }
    raise HTTPException(status_code=401, detail="Invalid credentials")

@router.post("/driver/login")
def driver_login(data: DriverLogin):
    # 1. Check if Company exists
    company = companies_db.get_by_id(data.company_id)
    if not company:
        raise HTTPException(status_code=401, detail="Invalid Company ID")
        
    # 2. Check Driver credentials under that company
    drivers = drivers_db.get_all()
    company_drivers = [d for d in drivers if d and d.get("company_id") == data.company_id]
    
    driver = next((d for d in company_drivers if d and d.get("login_id") == data.login_id and d.get("password") == data.password), None)
    if not driver:
        raise HTTPException(status_code=401, detail="Invalid Driver ID or Password for this company")
        
    return {
        "driver_id": driver["id"],
        "name": driver["name"],
        "company_id": driver["company_id"]
    }

# ──────────────────────────────────────────────────────────────
# Customer Tracking: Phone → OTP → Orders
# ──────────────────────────────────────────────────────────────

class CustomerOTPRequest(BaseModel):
    email: str

class CustomerOTPVerify(BaseModel):
    email: str
    otp: str

@router.post("/customer/request-otp")
def customer_request_otp(data: CustomerOTPRequest):
    email = data.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email address is required")
    
    all_shipments = shipments_db.get_all()
    matched = [s for s in all_shipments if s and s.get("receiver_email") == email]
    if not matched:
        # Fallback to phone search for legacy shipments if needed, 
        # but user wants email-only for now.
        raise HTTPException(status_code=404, detail="No orders found for this email address")
    
    otp = str(random.randint(100000, 999999))
    customer_otp_store[email] = otp
    
    from backend.services.email_service import EmailService
    success = EmailService.send_otp_email(email, otp, purpose="tracking")
    
    if not success:
        return {"message": "Email delivery failed. Check server console for code.", "email": email}
        
    return {"message": "OTP sent to your email address.", "email": email}

@router.post("/customer/verify-otp")
def customer_verify_otp(data: CustomerOTPVerify):
    email = data.email.strip().lower()
    stored = customer_otp_store.get(email)
    print(f"[DEBUG] OTP Verify: Email={email}, Stored={stored}, Received={data.otp.strip()}")
    
    if not stored:
        raise HTTPException(status_code=401, detail="No active OTP found for this email. Please request a new one.")
        
    if stored != data.otp.strip():
        raise HTTPException(status_code=401, detail="Incorrect verification code. Please check your email and try again.")
    
    del customer_otp_store[email]
    all_shipments = shipments_db.get_all()
    orders = [s for s in all_shipments if s and s.get("receiver_email") == email]
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
    customer_sessions[token] = email
    
    return {"email": email, "orders": slim, "session_token": token}

@router.get("/customer/shipments")
def get_customer_shipments(x_logistix_context: Optional[str] = Header(None)):
    """Lookup all shipments by session token (secured via header)."""
    email = customer_sessions.get(x_logistix_context)
    if not email:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
        
    all_shipments = shipments_db.get_all()
    orders = [s for s in all_shipments if s and s.get("receiver_email") == email]
    orders.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return orders
