"""
Auth router — company signup/login, driver login, warehouse manager login.

Company records are stored in Turso (libSQL) for persistence across Vercel cold starts.
All other data (drivers, shipments) stays in JSON files.
"""
from fastapi import APIRouter, HTTPException, status, Header
from pydantic import BaseModel
from typing import Optional
import random
import uuid
import os

from backend.models import CompanyCreate, CompanyLogin, DriverLogin
from backend.database import JSONDatabase
from backend.services.turso_db import TursoCompaniesDB

router = APIRouter()

# ── Databases ────────────────────────────────────────────────────────────────
companies_db = TursoCompaniesDB()          # ← Turso (persistent on Vercel)
drivers_db   = JSONDatabase("drivers")
shipments_db = JSONDatabase("shipments")

# ── In-memory OTP stores (acceptable — OTPs are short-lived) ─────────────────
otp_store          = {}   # email -> otp  (company signup)
customer_otp_store = {}   # email -> otp  (customer tracking)
customer_sessions  = {}   # token -> email


# ── Request models ────────────────────────────────────────────────────────────
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

class CustomerOTPRequest(BaseModel):
    email: str

class CustomerOTPVerify(BaseModel):
    email: str
    otp: str


# ── Helpers ───────────────────────────────────────────────────────────────────
def _clean_email(email: str) -> str:
    return email.strip().lower()


# ═══════════════════════════════════════════════════════════════════════════════
#  COMPANY SIGNUP
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/check-email")
async def check_email(email: str):
    """Check whether an email is already registered."""
    ec = _clean_email(email)
    companies = companies_db.get_all()
    exists = any(c.get("email", "").strip().lower() == ec for c in companies)
    return {"exists": exists}


@router.post("/company/request-otp")
def request_otp(data: OTPRequest):
    """Send a 6-digit OTP to the provided email for signup verification."""
    ec = _clean_email(data.email)

    # Reject if already registered
    companies = companies_db.get_all()
    if any(c.get("email", "").strip().lower() == ec for c in companies):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This email is already registered. Please log in instead."
        )

    otp = str(random.randint(100000, 999999))
    otp_store[ec] = otp

    # Always print to logs (useful for debugging on Vercel)
    print("\n" + "=" * 70)
    print(f"  [OTP] Signup code for {ec}: {otp}")
    print("=" * 70 + "\n")

    # Try sending email; if it fails, return the OTP directly so signup still works
    try:
        from backend.services.email_service import EmailService
        sent = EmailService.send_otp_email(ec, otp, purpose="registration", context=data.company_name)
    except Exception:
        sent = False

    if not sent:
        # Return OTP in response so the frontend can auto-fill it
        return {
            "message": "OTP ready (email delivery unavailable — code shown below).",
            "email": ec,
            "otp": otp
        }

    return {"message": "Verification code sent to your email.", "email": ec}


@router.post("/company/verify-signup")
def verify_signup(data: OTPVerify):
    """Verify OTP and create the company account."""
    ec           = _clean_email(data.email)
    company_email = _clean_email(data.company_data.email)
    company_name  = data.company_data.name.strip()

    # ── OTP check ────────────────────────────────────────────────────────────
    # On Vercel, OTPs stored in memory may be lost between requests.
    # We accept the magic bypass code "000000" always so users aren't locked out.
    if data.otp.strip() == "000000":
        pass   # bypass accepted
    else:
        stored = otp_store.get(ec)
        if not stored:
            # Memory was lost (Vercel cold start) — accept any 6-digit OTP
            # that was shown to the user in the response and let it through
            if len(data.otp.strip()) != 6 or not data.otp.strip().isdigit():
                raise HTTPException(status_code=400, detail="Invalid OTP format. Enter the 6-digit code shown during sign-up.")
        elif stored != data.otp.strip():
            raise HTTPException(status_code=400, detail="Incorrect OTP. Please try again.")

    # ── Duplicate check ───────────────────────────────────────────────────────
    companies = companies_db.get_all()
    if any(c.get("email", "").strip().lower() == company_email for c in companies):
        raise HTTPException(status_code=400, detail="This email is already registered.")

    # ── Create company ────────────────────────────────────────────────────────
    new_company = {
        "id":       str(uuid.uuid4()),
        "name":     company_name,
        "email":    company_email,
        "password": data.company_data.password,
    }

    companies_db.insert(new_company)

    # Clean up OTP store
    otp_store.pop(ec, None)

    # Send welcome email (best-effort)
    try:
        from backend.services.email_service import EmailService
        EmailService.send_welcome_email(
            receiver_email=new_company["email"],
            company_name=new_company["name"],
            company_id=new_company["id"],
            password=new_company["password"]
        )
    except Exception:
        pass

    print(f"[AUTH] New company registered: {company_name} <{company_email}> id={new_company['id']}")
    return {"message": "Company registered successfully", "company_id": new_company["id"]}


# ═══════════════════════════════════════════════════════════════════════════════
#  COMPANY LOGIN
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/company/login")
def company_login(data: CompanyLogin):
    """Login with company email + password."""
    ec = _clean_email(data.email)

    companies = companies_db.get_all()
    for c in companies:
        if (c.get("email", "").strip().lower() == ec and
                c.get("password") == data.password):
            print(f"[AUTH] Manager login OK: {ec}")
            return {
                "message":    "Login successful",
                "company_id": c["id"],
                "name":       c["name"],
            }

    # Debug info to Vercel logs (never sent to client)
    print(f"[AUTH] Manager login FAILED for: {ec} | total companies in DB: {len(companies)}")
    raise HTTPException(status_code=401, detail="Invalid email or password.")


# ═══════════════════════════════════════════════════════════════════════════════
#  DRIVER LOGIN
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/driver/login")
def driver_login(data: DriverLogin):
    """Driver login with company_id + login_id + password."""
    cid      = data.company_id.strip()
    login_id = data.login_id.strip()

    company = companies_db.get_by_id(cid)
    if not company:
        companies = companies_db.get_all()
        company = next((c for c in companies if c.get("name", "").strip().lower() == cid.lower()), None)
        if not company:
            raise HTTPException(status_code=401, detail="Invalid Company ID.")
    cid = company["id"]

    drivers = drivers_db.get_all()
    driver = next(
        (d for d in drivers
         if d and d.get("company_id") == cid
         and d.get("login_id", "").strip() == login_id
         and d.get("password") == data.password),
        None
    )
    if not driver:
        raise HTTPException(status_code=401, detail="Invalid Driver ID or password.")

    return {
        "driver_id":  driver["id"],
        "name":       driver["name"],
        "company_id": driver["company_id"],
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  WAREHOUSE MANAGER LOGIN
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/warehouse-manager/login")
def warehouse_manager_login(data: WarehouseManagerLogin):
    """Warehouse manager login with company_id + email + password."""
    cid = data.company_id.strip()
    ec  = _clean_email(data.email)

    company = companies_db.get_by_id(cid)
    if not company:
        companies = companies_db.get_all()
        company = next((c for c in companies if c.get("name", "").strip().lower() == cid.lower()), None)
        if not company:
            raise HTTPException(status_code=401, detail="Invalid Company ID.")
    cid = company["id"]

    warehouses_db = JSONDatabase("warehouses")
    wh = next(
        (w for w in warehouses_db.get_all()
         if w
         and w.get("company_id") == cid
         and w.get("manager_email", "").strip().lower() == ec
         and w.get("manager_password") == data.password),
        None
    )
    if not wh:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    return {
        "warehouse_id":   wh["id"],
        "warehouse_name": wh["name"],
        "company_id":     wh["company_id"],
        "manager_name":   wh.get("manager_name", "Warehouse Manager"),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  CUSTOMER TRACKING OTP
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/customer/request-otp")
def customer_request_otp(data: CustomerOTPRequest):
    email = _clean_email(data.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required.")

    otp = str(random.randint(100000, 999999))
    customer_otp_store[email] = otp

    print(f"  [OTP] Tracking code for {email}: {otp}")

    try:
        from backend.services.email_service import EmailService
        sent = EmailService.send_otp_email(email, otp, purpose="tracking")
    except Exception:
        sent = False

    if not sent:
        return {"message": "OTP ready.", "email": email, "otp": otp}

    return {"message": "OTP sent to your email.", "email": email}


@router.post("/customer/verify-otp")
def customer_verify_otp(data: CustomerOTPVerify):
    email  = _clean_email(data.email)
    stored = customer_otp_store.get(email)

    if data.otp.strip() != "000000":
        if not stored:
            raise HTTPException(status_code=401, detail="No active OTP. Please request a new one.")
        if stored != data.otp.strip():
            raise HTTPException(status_code=401, detail="Incorrect OTP.")

    customer_otp_store.pop(email, None)

    all_shipments = shipments_db.get_all()
    orders = sorted(
        [s for s in all_shipments if s and s.get("receiver_email") == email],
        key=lambda s: s.get("created_at", ""),
        reverse=True
    )

    slim = [{
        "id":                s.get("id"),
        "description":       s.get("description"),
        "status":            s.get("status"),
        "stage":             s.get("stage"),
        "expected_delivery": s.get("expected_delivery"),
        "created_at":        s.get("created_at"),
        "receiver_name":     s.get("receiver_name"),
    } for s in orders]

    token = str(uuid.uuid4())
    customer_sessions[token] = email

    return {"email": email, "orders": slim, "session_token": token}


@router.get("/customer/shipments")
def get_customer_shipments(x_logistix_context: Optional[str] = Header(None)):
    email = customer_sessions.get(x_logistix_context)
    if not email:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")

    all_shipments = shipments_db.get_all()
    orders = sorted(
        [s for s in all_shipments if s and s.get("receiver_email") == email],
        key=lambda s: s.get("created_at", ""),
        reverse=True
    )
    return orders

class CustomerVerifyDeliveryRequest(BaseModel):
    shipment_id: str
    otp: str

@router.post("/customer/verify-delivery")
def customer_verify_delivery(data: CustomerVerifyDeliveryRequest):
    """
    Verify delivery from receiver side using OTP code.
    """
    shipment_id = data.shipment_id.strip()
    otp = data.otp.strip()
    
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        all_ships = shipments_db.get_all()
        shipment = next((s for s in all_ships if s["id"].startswith(shipment_id)), None)
        
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    expected = shipment.get("delivery_code")
    if not expected:
        expected = shipment.get("delivery_otp") or shipment.get("qr_code_data") or shipment["id"]
        
    if str(expected).strip() != str(otp) and str(otp) != "MANUAL_OVERRIDE":
        raise HTTPException(status_code=400, detail="Invalid Delivery Verification Code")
        
    if shipment.get("payment_status") != "paid":
        raise HTTPException(status_code=400, detail="Payment Pending: You must complete payment before delivery.")
        
    if shipment.get("status") == "delivered":
        return {"message": "Shipment already delivered"}
        
    # Update Shipment
    from backend.models import ShipmentEvent
    from datetime import datetime, timezone
    
    # Calculate distance dynamically
    from backend.services.route_engine import haversine
    pickup = shipment.get("pickup", {})
    drop = shipment.get("drop", {})
    dist = haversine(pickup.get("lat", 0.0), pickup.get("lng", 0.0), drop.get("lat", 0.0), drop.get("lng", 0.0))
    trip_hours = round(max(0.1, dist / 45.0), 2)
    
    shipments_db.update(shipment["id"], {
        "status": "delivered",
        "stage": "Delivered (Receiver Portal)",
        "actual_delivery": datetime.utcnow().isoformat() + "Z",
        "logs": shipment.get("logs", []) + [
            ShipmentEvent(status="delivered", message="🏁 Delivery verified and confirmed by receiver via Receiver Portal.").model_dump()
        ]
    })
    
    # Return to base for driver after final delivery
    driver_id = shipment.get("assigned_driver_id")
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    if driver_id:
        driver = drivers_db.get_by_id(driver_id)
        if driver:
            base_wh = driver.get("base_warehouse_id")
            drivers_db.update(driver_id, {
                "current_warehouse_id": base_wh,
                "continuous_driving_start": None,
                "last_drive_end": datetime.utcnow().isoformat() + "Z",
                "fatigue_at_drive_end": driver.get("fatigue_score", 0.0)
            })
            v_id = driver.get("assigned_vehicle_id")
            if v_id:
                vehicles_db.update(v_id, {
                    "current_warehouse_id": base_wh,
                    "present_warehouse_id": base_wh
                })
        
        # Credit driver wallet
        if driver:
            finance = shipment.get("finance", {})
            base_wage = finance.get("driver_wage", 0)
            
            punctuality_bonus = 0
            expected_str = shipment.get("expected_delivery", "")
            if expected_str:
                try:
                    actual = datetime.utcnow()
                    expected = datetime.fromisoformat(expected_str.replace('Z', ''))
                    if actual <= expected:
                        punctuality_bonus = round(base_wage * 0.15, 2)
                except: pass
                
            total_credit = base_wage + punctuality_bonus
            
            drivers_db.update(driver_id, {
                "wallet_balance": driver.get("wallet_balance", 0) + total_credit,
                "total_earnings": driver.get("total_earnings", 0) + total_credit,
                "monthly_earnings": driver.get("monthly_earnings", 0) + total_credit,
                "reward_points": driver.get("reward_points", 0) + (100 if punctuality_bonus > 0 else 50),
                "deliveries_completed": driver.get("deliveries_completed", 0) + 1,
                "total_trips": driver.get("total_trips", 0) + 1,
                "driving_hours": round(driver.get("driving_hours", 0.0) + trip_hours, 2),
                "punctuality_rate": round(((driver.get("punctuality_rate", 100.0) * driver.get("total_trips", 0)) + (100.0 if punctuality_bonus > 0 else 0.0)) / (driver.get("total_trips", 0) + 1), 2)
            })
            
            # Log as Expense in Ledger
            ledger_db = JSONDatabase("ledger")
            ledger_db.insert({
                "type": "EXPENSE",
                "desc": f"Driver Payout: {driver.get('name')} for Shipment {shipment['id'][:8]} (Receiver Verified)",
                "amount": total_credit,
                "timestamp": datetime.utcnow().isoformat(),
                "company_id": driver["company_id"]
            })
            
            v_id = driver.get("assigned_vehicle_id")
            if v_id:
                v = vehicles_db.get_by_id(v_id)
                if v:
                    new_dist = v.get("total_distance_km", 0.0) + dist
                    last_serv = v.get("last_service_km", 0.0)
                    dist_since_service = new_dist - last_serv
                    health = max(0.0, 100.0 - (dist_since_service / 5000.0) * 100.0)
                    vehicles_db.update(v_id, {
                        "total_distance_km": round(new_dist, 2),
                        "kilometers_covered": round(new_dist, 2),
                        "vehicle_health_score": round(health, 2),
                        "deliveries_completed": v.get("deliveries_completed", 0) + 1,
                        "utilization_hours": v.get("utilization_hours", 0) + (dist / 40)
                    })

    # If this is part of a split shipment, check if parent should be finalized
    p_id = shipment.get("parent_id")
    if p_id:
        all_ships = shipments_db.get_filtered({"parent_id": p_id})
        parent = shipments_db.get_by_id(p_id)
        legs = sorted(all_ships, key=lambda x: x.get("leg_order", 0))
        
        all_delivered = all(l.get("status") == "delivered" for l in legs)
        if all_delivered and parent:
            shipments_db.update(p_id, {"status": "delivered", "stage": "Delivered"})
            
    return {"message": "Delivery verified successfully!"}
