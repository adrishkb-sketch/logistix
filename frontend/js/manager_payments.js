// Dedicated script for manager_payments.html

async function loadFundRequests() {
    const cid = localStorage.getItem('manager_id');
    try {
        // Use the new finance/fund-requests endpoint which parses alerts
        const reqs = await apiCall(`/manager/finance/fund-requests?company_id=${cid}`);
        const tbody = document.getElementById('fund-requests-body');
        if (!tbody) return;
        
        if (reqs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">No pending requests.</td></tr>';
            return;
        }

        tbody.innerHTML = reqs.map(r => {
            return `
                <tr>
                    <td>
                        <b>${r.driver_name}</b><br>
                        <small style="color:var(--text-muted);">ID: ${r.driver_id.slice(0,8)}</small>
                    </td>
                    <td><span class="badge" style="background:${r.fund_type === 'REFUEL' ? 'var(--warning)' : 'var(--primary)'}">${r.fund_type}</span></td>
                    <td><b style="color:var(--success);">₹ ${r.amount.toLocaleString()}</b></td>
                    <td>${r.distance.toFixed(1)} km</td>
                    <td style="text-align:center;">
                        <button class="btn-primary" style="padding:6px 12px; font-size:0.75rem; background:var(--success); border-radius:8px;" onclick="releaseFund('${r.alert_id}')">Approve & Release</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch(e) {
        console.error("Fund load failed:", e);
    }
}

async function approveFundRequest(alertId) {
    if (!confirm("Approve this fund request? The amount will be instantly credited to the driver's wallet.")) return;
    try {
        const res = await apiCall(`/manager/finance/approve-fund-request/${alertId}`, 'POST');
        alert(res.message);
        initFintechOracle();
        loadInsights();
    } catch (e) { alert("Failed to approve fund request: " + e.message); }
}

async function rejectFundRequest(alertId) {
    if (!confirm("Are you sure you want to REJECT this fund request?")) return;
    try {
        const res = await apiCall(`/manager/finance/reject-fund-request/${alertId}`, 'POST');
        alert(res.message);
        initFintechOracle();
    } catch (e) { alert("Failed to reject fund request: " + e.message); }
}

async function releaseFund(alertId) {
    if (!confirm('Approve and release these funds to the driver?')) return;
    try {
        await apiCall(`/manager/finance/approve-fund-request/${alertId}`, 'POST');
        showNotification('Funds released successfully.', 'success');
        loadFundRequests();
        initFintechOracle(); // Refresh P&L
    } catch (e) {
        showNotification(e.detail || 'Failed to release funds.', 'error');
    }
}

async function finalizeShipment(shipmentId) {
    if (!confirm("Are you sure you want to mark this shipment as FULLY COMPLETED? This will archive the lifecycle and enable receiver ratings.")) return;
    
    try {
        const res = await apiCall(`/manager/finance/fully-complete/${shipmentId}`, 'POST');
        showNotification(res.message, "success");
        loadShipments();
    } catch (e) {
        showNotification(e.detail || "Finalization failed", "error");
    }
}

async function confirmShipmentPayment(shipmentId) {
    if (!confirm("💳 Confirm that the receiver has paid the full amount? This will unlock the shipment for final OTP delivery.")) return;
    try {
        const res = await apiCall(`/manager/finance/confirm-payment/${shipmentId}`, 'POST');
        showNotification(res.message, "success");
        loadShipments();
        initFintechOracle();
    } catch (e) {
        showNotification(e.detail || "Payment confirmation failed", "error");
    }
}

async function confirmCustomerPayment(shipmentId) {
    try {
        await apiCall(`/manager/finance/confirm-payment/${shipmentId}`, 'POST');
        alert("Payment confirmed. Shipping lifecycle now cleared for delivery.");
        initFintechOracle();
        loadInsights();
    } catch (e) { alert("Failed to confirm payment."); }
}

async function settlePayout(driverId) {
    if (!confirm("Are you sure you want to approve this payout? Ensure the transfer is done via your external banking system.")) return;
    try {
        await apiCall(`/manager/finance/approve-payout/${driverId}`, 'POST');
        alert("Payout settled successfully. Driver wallet has been debited.");
        initFintechOracle();
        loadInsights();
    } catch (e) { alert("Failed to settle payout."); }
}

async function initPage() {
    loadFundRequests();
}

document.addEventListener('DOMContentLoaded', initPage);