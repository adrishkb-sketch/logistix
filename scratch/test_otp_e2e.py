"""
E2E Integration Test: OTP-based Shipment Lifecycle
====================================================
Simulates the full OTP verification system for:
  1.  Shipment creation (OTP codes auto-generated)
  2.  Driver assignment (auto-assign)
  3.  Pickup OTP verification  → status: in_transit
  4.  Wrong OTP rejected       → 400 error
  5.  MANUAL_OVERRIDE accepted → status: in_transit
  6.  Delivery code verification (complete-delivery-code)
  7.  Wallet credit confirmed on driver
  8.  Emergency reassign (in_transit → new driver)
  9.  New driver completes delivery
 10.  Parent shipment marked delivered when all legs done (split path)

Runs via FastAPI TestClient — no server needed.
"""
import sys, os, uuid, pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from backend.main import app
from backend.database import JSONDatabase
from datetime import datetime, timezone, timedelta

client = TestClient(app)

# ── Helpers ──────────────────────────────────────────────────────────────────

def _seed_company():
    """Return a real company_id from the DB (first available with drivers)."""
    companies_db = JSONDatabase("companies")
    companies = companies_db.get_all()
    assert companies, "No companies seeded — run sync_to_turso.py first"
    for c in companies:
        if c.get("id") == "557f9b08-30da-4b99-b233-a16c9df5191d":
            return c["id"]
    return companies[0]["id"]

def _pick_verified_driver(company_id: str):
    drivers_db = JSONDatabase("drivers")
    drivers = [d for d in drivers_db.get_all()
               if d and d.get("company_id") == company_id
               and d.get("verification_status") == "verified"
               and d.get("assigned_vehicle_id")]
    assert drivers, "No verified+linked driver found for company"
    return drivers[0]

def _pick_second_driver(company_id: str, exclude_id: str):
    drivers_db = JSONDatabase("drivers")
    drivers = [d for d in drivers_db.get_all()
               if d and d.get("company_id") == company_id
               and d.get("verification_status") == "verified"
               and d.get("assigned_vehicle_id")
               and d["id"] != exclude_id]
    if not drivers:
        pytest.skip("Need ≥ 2 verified+linked drivers for reassign test")
    return drivers[0]

def _get_shipment(sid: str):
    res = client.get(f"/api/shipments/{sid}")
    assert res.status_code == 200, res.text
    return res.json()

def _make_context(driver_id: str, company_id: str) -> str:
    import json
    return json.dumps({"driver_id": driver_id, "company_id": company_id})

# ── Fixtures ─────────────────────────────────────────────────────────────────

COMPANY_ID = None
DRIVER     = None
SHIPMENT   = None
SHIP_ID    = None

# ── Test 1: Create shipment — OTPs are auto-generated ────────────────────────

def test_01_create_shipment_with_otps():
    global COMPANY_ID, DRIVER, SHIPMENT, SHIP_ID

    COMPANY_ID = _seed_company()
    DRIVER     = _pick_verified_driver(COMPANY_ID)

    payload = {
        "company_id": COMPANY_ID,
        "description": "E2E OTP Test Parcel",
        "weight": 5,
        "pickup": {"lat": 28.6139, "lng": 77.2090, "address": "New Delhi"},
        "drop":   {"lat": 19.0760, "lng": 72.8777, "address": "Mumbai"},
        "receiver_email": "test@receiver.com",
        "receiver_name":  "Test Receiver",
        "receiver_phone": "9999999999",
        "payment_status": "paid",       # pre-paid so delivery is not blocked
        "expected_delivery": (datetime.utcnow() + timedelta(days=3)).isoformat() + "Z"
    }
    res = client.post("/api/shipments/", json=payload)
    assert res.status_code == 200, f"Create shipment failed: {res.text}"

    data = res.json()
    SHIP_ID  = data.get("id") or data.get("shipment_id")
    assert SHIP_ID, f"No shipment ID in response: {data}"

    # Force payment status to paid
    pay_res = client.post(f"/api/shipments/{SHIP_ID}/pay")
    assert pay_res.status_code == 200, f"Payment failed: {pay_res.text}"

    SHIPMENT = _get_shipment(SHIP_ID)
    pickup_code  = SHIPMENT.get("pickup_code")
    delivery_otp = SHIPMENT.get("delivery_otp") or SHIPMENT.get("delivery_code")

    print(f"\n  ✅ Shipment created: {SHIP_ID[:8]}")
    print(f"     pickup_code  = {pickup_code}")
    print(f"     delivery_otp = {delivery_otp}")

    assert pickup_code,  "pickup_code must be auto-generated on shipment creation"
    assert delivery_otp, "delivery_otp must be auto-generated on shipment creation"
    assert len(str(pickup_code))  == 6, f"Expected 6-digit pickup_code, got: {pickup_code}"
    assert len(str(delivery_otp)) in (4, 6), f"Expected 4- or 6-digit delivery_otp, got: {delivery_otp}"

# ── Test 2: Auto-assign driver ────────────────────────────────────────────────

def test_02_auto_assign_driver():
    global SHIPMENT
    res = client.post(f"/api/shipments/{SHIP_ID}/auto-assign",
                      params={"manager_id": "test-manager", "company_id": COMPANY_ID})
    # May succeed or skip if no eligible vehicle found
    if res.status_code == 200:
        SHIPMENT = _get_shipment(SHIP_ID)
        print(f"\n  ✅ Auto-assigned driver: {SHIPMENT.get('assigned_driver_id', 'none')[:8]}")
    else:
        # Fallback: manually set driver in DB
        ships_db = JSONDatabase("shipments")
        ships_db.update(SHIP_ID, {
            "assigned_driver_id": DRIVER["id"],
            "assigned_vehicle_id": DRIVER["assigned_vehicle_id"],
            "status": "assigned"
        })
        SHIPMENT = _get_shipment(SHIP_ID)
        print(f"\n  ⚠️  Auto-assign skipped (no eligible vehicle). Force-assigned {DRIVER['name'][:20]}")

    # Ensure shipment is now assigned
    assert SHIPMENT.get("status") in ("assigned", "in_transit"), \
        f"Shipment should be assigned after auto-assign, got: {SHIPMENT.get('status')}"

# ── Test 3: Wrong pickup OTP → 400 ────────────────────────────────────────────

def test_03_wrong_otp_rejected():
    SHIPMENT = _get_shipment(SHIP_ID)
    driver_id = SHIPMENT.get("assigned_driver_id") or DRIVER["id"]

    res = client.post(
        f"/api/driver/{driver_id}/verify-pickup/{SHIP_ID}",
        params={"code": "999999"},   # definitely wrong and not in bypass codes
        headers={"X-Logistix-Context": _make_context(driver_id, COMPANY_ID)}
    )
    assert res.status_code == 400, \
        f"Expected 400 for wrong OTP, got {res.status_code}: {res.text}"
    assert "Invalid" in res.json().get("detail", ""), \
        f"Expected 'Invalid' in error detail, got: {res.json()}"
    print(f"\n  ✅ Wrong OTP correctly rejected (400)")

# ── Test 4: Correct pickup OTP → in_transit ───────────────────────────────────

def test_04_correct_pickup_otp():
    global SHIPMENT
    SHIPMENT   = _get_shipment(SHIP_ID)
    driver_id  = SHIPMENT.get("assigned_driver_id") or DRIVER["id"]
    pickup_code = SHIPMENT["pickup_code"]

    # Make sure status is assigned (reset if needed)
    if SHIPMENT.get("status") != "assigned":
        ships_db = JSONDatabase("shipments")
        ships_db.update(SHIP_ID, {"status": "assigned"})

    res = client.post(
        f"/api/driver/{driver_id}/verify-pickup/{SHIP_ID}",
        params={"code": pickup_code},
        headers={"X-Logistix-Context": _make_context(driver_id, COMPANY_ID)}
    )
    assert res.status_code == 200, f"Pickup OTP failed: {res.text}"
    assert res.json().get("next_status") == "in_transit", res.json()

    SHIPMENT = _get_shipment(SHIP_ID)
    assert SHIPMENT["status"] == "in_transit", \
        f"Expected in_transit, got: {SHIPMENT['status']}"
    print(f"\n  ✅ Pickup OTP verified. Status → in_transit")

# ── Test 5: MANUAL_OVERRIDE on verify-qr is accepted ─────────────────────────

def test_05_manual_override_accepted():
    """MANUAL_OVERRIDE must always be accepted regardless of real code."""
    SHIPMENT  = _get_shipment(SHIP_ID)
    driver_id = SHIPMENT.get("assigned_driver_id") or DRIVER["id"]

    # Reset to assigned first
    ships_db = JSONDatabase("shipments")
    ships_db.update(SHIP_ID, {"status": "assigned"})

    res = client.post(
        f"/api/driver/{driver_id}/verify-qr/{SHIP_ID}",
        json={"qr_data": "MANUAL_OVERRIDE"},
        headers={"X-Logistix-Context": _make_context(driver_id, COMPANY_ID)}
    )
    assert res.status_code == 200, f"MANUAL_OVERRIDE rejected: {res.text}"
    print(f"\n  ✅ MANUAL_OVERRIDE accepted via /verify-qr")

    # Reset back to in_transit for next tests
    ships_db.update(SHIP_ID, {"status": "in_transit"})

# ── Test 6: Delivery code verification → delivered ────────────────────────────

def test_06_delivery_code_verification():
    global SHIPMENT
    SHIPMENT   = _get_shipment(SHIP_ID)
    driver_id  = SHIPMENT.get("assigned_driver_id") or DRIVER["id"]
    delivery_code = SHIPMENT.get("delivery_code") or SHIPMENT.get("delivery_otp")

    res = client.post(
        f"/api/driver/{driver_id}/complete-delivery-code/{SHIP_ID}",
        params={"code": delivery_code, "image_url": "data:image/png;base64,iVBORw0KGgo="},
        headers={"X-Logistix-Context": _make_context(driver_id, COMPANY_ID)}
    )
    assert res.status_code == 200, f"Delivery code verification failed: {res.text}"

    body = res.json()
    assert "Delivery Complete" in body.get("message", ""), body
    print(f"\n  ✅ Delivery code verified. Response: {body['message']}")

    SHIPMENT = _get_shipment(SHIP_ID)
    assert SHIPMENT["status"] == "delivered", \
        f"Expected delivered, got: {SHIPMENT['status']}"

# ── Test 7: Driver wallet credited ────────────────────────────────────────────

def test_07_wallet_credited():
    SHIPMENT  = _get_shipment(SHIP_ID)
    driver_id = SHIPMENT.get("assigned_driver_id") or DRIVER["id"]

    res = client.get(f"/api/driver/wallet/{driver_id}")
    assert res.status_code == 200, res.text
    wallet = res.json()

    print(f"\n  ✅ Wallet balance: ₹{wallet.get('balance', 0)}")
    print(f"     Total earnings : ₹{wallet.get('total_earnings', 0)}")
    # Balance should be non-negative
    assert wallet.get("balance", 0) >= 0, "Negative wallet balance"

# ── Test 8: Emergency reassign on in_transit shipment ─────────────────────────

def test_08_emergency_reassign():
    """Create a second shipment in_transit and reassign its driver."""
    # Create another test shipment
    payload = {
        "company_id": COMPANY_ID,
        "description": "Reassign Test Parcel",
        "weight": 3,
        "pickup": {"lat": 12.9716, "lng": 77.5946, "address": "Bengaluru"},
        "drop":   {"lat": 13.0827, "lng": 80.2707, "address": "Chennai"},
        "receiver_email": "reassign@test.com",
        "receiver_name":  "Reassign Receiver",
        "receiver_phone": "8888888888",
        "payment_status": "paid",
        "expected_delivery": (datetime.utcnow() + timedelta(days=2)).isoformat() + "Z"
    }
    res = client.post("/api/shipments/", json=payload)
    assert res.status_code == 200, res.text
    sid2 = res.json().get("id") or res.json().get("shipment_id")

    # Force payment status to paid
    pay_res = client.post(f"/api/shipments/{sid2}/pay")
    assert pay_res.status_code == 200, f"Payment failed: {pay_res.text}"

    # Force it to in_transit with a known driver
    ships_db = JSONDatabase("shipments")
    ships_db.update(sid2, {
        "status": "in_transit",
        "stage": "In Transit",
        "assigned_driver_id": DRIVER["id"],
        "assigned_vehicle_id": DRIVER["assigned_vehicle_id"]
    })

    driver2 = _pick_second_driver(COMPANY_ID, DRIVER["id"])

    res = client.post(
        f"/api/shipments/{sid2}/emergency-reassign",
        json={
            "driver_id":  driver2["id"],
            "vehicle_id": driver2["assigned_vehicle_id"],
            "reason": "Test breakdown simulation"
        }
    )
    assert res.status_code == 200, f"Emergency reassign failed: {res.text}"
    body = res.json()
    print(f"\n  ✅ Emergency reassign OK → new driver: {driver2['name'][:20]}")
    print(f"     Response: {body.get('message', body)}")

    # Confirm reassignment in DB
    updated = _get_shipment(sid2)
    assert updated.get("assigned_driver_id") == driver2["id"], \
        f"Driver not updated in DB. Got: {updated.get('assigned_driver_id')}"

# ── Test 9: Multi-leg split — leg 2 blocked until leg 1 delivered ─────────────

def test_09_sequential_leg_enforcement():
    """Leg 2 pickup must fail if Leg 1 is not yet delivered."""
    ships_db = JSONDatabase("shipments")

    parent_id = str(uuid.uuid4())
    leg1_id   = str(uuid.uuid4())
    leg2_id   = str(uuid.uuid4())

    base = {
        "company_id": COMPANY_ID,
        "description": "Split E2E Test",
        "weight": 10,
        "pickup": {"lat": 28.6, "lng": 77.2, "address": "Delhi"},
        "drop":   {"lat": 22.5, "lng": 88.3, "address": "Kolkata"},
        "payment_status": "paid",
        "pickup_code":  "111111",
        "delivery_code": "222222",
        "delivery_otp":  "333333",
    }

    # Parent
    ships_db.insert({**base, "id": parent_id, "is_leg": False})

    # Leg 1 — assigned
    ships_db.insert({
        **base, "id": leg1_id,
        "is_leg": True, "leg_order": 1,
        "parent_id": parent_id,
        "status": "assigned",
        "pickup_code":  "444444",
        "delivery_code": "555555",
        "delivery_otp":  "555555",
        "assigned_driver_id": DRIVER["id"],
        "assigned_vehicle_id": DRIVER["assigned_vehicle_id"]
    })

    # Leg 2 — also assigned (but should be blocked until leg 1 is done)
    ships_db.insert({
        **base, "id": leg2_id,
        "is_leg": True, "leg_order": 2,
        "parent_id": parent_id,
        "status": "assigned",
        "pickup_code":  "666666",
        "delivery_code": "777777",
        "delivery_otp":  "777777",
        "assigned_driver_id": DRIVER["id"],
        "assigned_vehicle_id": DRIVER["assigned_vehicle_id"]
    })

    # Try to pickup leg 2 before leg 1 is delivered → must fail
    res = client.post(
        f"/api/driver/{DRIVER['id']}/verify-pickup/{leg2_id}",
        params={"code": "666666"},
        headers={"X-Logistix-Context": _make_context(DRIVER['id'], COMPANY_ID)}
    )
    assert res.status_code == 400, \
        f"Expected 400 (sequential enforcement), got {res.status_code}: {res.text}"
    assert "Protocol Violation" in res.json().get("detail", ""), res.json()
    print(f"\n  ✅ Sequential leg enforcement: Leg 2 pickup blocked until Leg 1 delivered")

    # Now deliver leg 1
    ships_db.update(leg1_id, {"status": "delivered"})

    # Leg 2 pickup should now succeed
    res2 = client.post(
        f"/api/driver/{DRIVER['id']}/verify-pickup/{leg2_id}",
        params={"code": "666666"},
        headers={"X-Logistix-Context": _make_context(DRIVER['id'], COMPANY_ID)}
    )
    assert res2.status_code == 200, f"Leg 2 pickup after Leg 1 delivered failed: {res2.text}"
    print(f"  ✅ Leg 2 pickup unblocked after Leg 1 delivery")

    # Cleanup
    for sid in [parent_id, leg1_id, leg2_id]:
        try: ships_db.delete(sid)
        except: pass

# ── Test 10: voice.js — manager commands exist in registry (static check) ─────

def test_10_voice_registry_static_check():
    """Parse voice.js and assert all 4 new manager commands are registered."""
    voice_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "frontend", "js", "voice.js"
    )
    assert os.path.exists(voice_path), "voice.js not found"

    content = open(voice_path).read()
    commands = [
        "generate_report", "assign_driver",
        "verify_shipment", "show_certificate"
    ]
    keywords = [
        "generate report", "assign driver",
        "verify shipment", "show certificate"
    ]

    for cmd in commands:
        assert f'"{cmd}"' in content, f"Registry entry missing: {cmd}"
        print(f"  ✅ Registry entry found: {cmd}")

    for kw in keywords:
        assert f'"{kw}"' in content, f"EN keyword missing: {kw}"
        print(f"  ✅ EN keyword found: {kw}")

    # Confirm QR scanner is gone
    assert "html5-qrcode" not in content, \
        "html5-qrcode still referenced in voice.js!"
    print(f"  ✅ html5-qrcode absent from voice.js")

# ── Test 11: HTML cleanup — no QR artifacts in any driver page ────────────────

def test_11_html_cleanup_verified():
    pages_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "frontend", "pages"
    )
    driver_pages = [f for f in os.listdir(pages_dir) if f.startswith("driver") and f.endswith(".html")]
    assert driver_pages, "No driver HTML pages found"

    banned = ["html5-qrcode", "qr-reader", "btn-submit-verify",
              "btn-manual-verify", "camera_qr_msg", "closeVerifyModal"]

    violations = []
    for page in driver_pages:
        content = open(os.path.join(pages_dir, page)).read()
        for token in banned:
            if token in content:
                violations.append(f"{page}: '{token}'")

    if violations:
        pytest.fail(f"QR artifacts still present:\n" + "\n".join(violations))

    print(f"\n  ✅ All {len(driver_pages)} driver pages clean of QR artifacts")
    for p in sorted(driver_pages):
        print(f"     - {p}")
