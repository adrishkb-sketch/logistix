import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import JSONDatabase

client = TestClient(app)

def test_manager_withdrawal_flow():
    # 1. Create a mock company & warehouse
    warehouses_db = JSONDatabase("warehouses")
    companies_db = JSONDatabase("companies")
    withdrawals_db = JSONDatabase("withdrawals")
    ledger_db = JSONDatabase("ledger")

    # Get a company and warehouse to use
    all_whs = warehouses_db.get_all()
    if not all_whs:
        # Seed a dummy warehouse
        wh_id = "test-wh-id"
        warehouses_db.insert({
            "id": wh_id,
            "name": "Test Hub",
            "manager_name": "Test Manager",
            "company_id": "557f9b08-30da-4b99-b233-a16c9df5191d",
            "wallet_balance": 1000.0,
            "total_earnings": 1000.0
        })
    else:
        wh_id = all_whs[0]["id"]
        # Set a clear wallet balance
        warehouses_db.update(wh_id, {"wallet_balance": 1000.0, "total_earnings": 1000.0})

    wh = warehouses_db.get_by_id(wh_id)
    company_id = wh.get("company_id", "557f9b08-30da-4b99-b233-a16c9df5191d")

    # 2. Request a withdrawal
    response = client.post("/api/manager/withdraw", json={
        "warehouse_id": wh_id,
        "amount": 250.0
    })
    assert response.status_code == 200
    res_data = response.json()
    assert "withdrawal_id" in res_data
    withdrawal_id = res_data["withdrawal_id"]

    # Verify wallet balance was debited
    wh_after = warehouses_db.get_by_id(wh_id)
    assert wh_after.get("wallet_balance") == 750.0

    # 3. Check withdrawals list
    list_resp = client.get(f"/api/manager/withdrawals?company_id={company_id}")
    assert list_resp.status_code == 200
    withdrawals = list_resp.json()
    my_req = next((w for w in withdrawals if w["id"] == withdrawal_id), None)
    assert my_req is not None
    assert my_req["status"] == "pending"
    assert my_req["amount"] == 250.0

    # 4. Reject the withdrawal first (funds should be refunded)
    reject_resp = client.post(f"/api/manager/withdrawals/{withdrawal_id}/reject")
    assert reject_resp.status_code == 200
    wh_rejected = warehouses_db.get_by_id(wh_id)
    assert wh_rejected.get("wallet_balance") == 1000.0

    # 5. Create a new request to test approval
    response2 = client.post("/api/manager/withdraw", json={
        "warehouse_id": wh_id,
        "amount": 400.0
    })
    assert response2.status_code == 200
    withdrawal_id2 = response2.json()["withdrawal_id"]
    assert warehouses_db.get_by_id(wh_id).get("wallet_balance") == 600.0

    # Approve the request
    approve_resp = client.post(f"/api/manager/withdrawals/{withdrawal_id2}/approve")
    assert approve_resp.status_code == 200
    
    # Wallet balance should remain 600 (already debited), but request status should be approved
    req2 = withdrawals_db.get_by_id(withdrawal_id2)
    assert req2["status"] == "approved"

    # Clean up test withdrawals
    withdrawals_db.delete(withdrawal_id)
    withdrawals_db.delete(withdrawal_id2)
