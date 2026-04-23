window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
        document.getElementById('tracking-id').value = id;
        searchShipment();
    }
});

window.searchShipment = async function() {
    console.log("searchShipment triggered");
    const trackingId = document.getElementById('tracking-id').value.trim();
    if (!trackingId) {
        alert("Please enter a tracking ID");
        return;
    }
    
    const resultsDiv = document.getElementById('results');
    const errorMsg = document.getElementById('error-msg');
    const btn = document.getElementById('track-btn');
    
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Searching...';
    }
    
    errorMsg.style.display = 'none';
    resultsDiv.style.display = 'none';

    try {
        console.log("Fetching shipment:", trackingId);
        const shipment = await apiCall(`/shipments/${trackingId}`);
        console.log("Shipment found:", shipment);
        
        document.getElementById('res-desc').innerText = shipment.description;
        document.getElementById('res-id').innerText = shipment.id;
        
        const statusEl = document.getElementById('res-status');
        statusEl.innerText = shipment.status;
        if (shipment.status === 'delivered') statusEl.style.color = 'var(--success)';
        else if (shipment.status === 'in_transit') statusEl.style.color = '#00f2fe';
        else statusEl.style.color = 'white';
        
        const etaEl = document.getElementById('res-eta');
        if (shipment.status === 'delivered') {
            etaEl.innerText = 'Delivered';
            etaEl.style.color = 'var(--success)';
        } else if (shipment.expected_delivery) {
            const dt = new Date(shipment.expected_delivery);
            etaEl.innerText = dt.toLocaleString([], {weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'});
            etaEl.style.color = 'var(--warning)';
        } else {
            etaEl.innerText = 'Calculating...';
        }
        
        document.getElementById('res-otp').innerText = shipment.delivery_otp || 'N/A';
        
        resultsDiv.style.display = 'block';
    } catch(err) {
        console.error("Tracking Error:", err);
        errorMsg.innerText = err.message || "Shipment not found. Please check your ID.";
        errorMsg.style.display = 'block';
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = 'Track';
        }
    }
}
