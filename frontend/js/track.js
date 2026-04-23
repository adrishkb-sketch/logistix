window.onload = () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
        document.getElementById('tracking-id').value = id;
        searchShipment();
    }
};

async function searchShipment() {
    const trackingId = document.getElementById('tracking-id').value.trim();
    if (!trackingId) return;
    
    const resultsDiv = document.getElementById('results');
    const errorMsg = document.getElementById('error-msg');
    const btn = document.querySelector('button[type="submit"]');
    
    btn.disabled = true;
    btn.innerText = 'Searching...';
    errorMsg.style.display = 'none';
    resultsDiv.style.display = 'none';

    try {
        const shipment = await apiCall(`/shipments/${trackingId}`);
        
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
        errorMsg.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerText = 'Track';
    }
}
