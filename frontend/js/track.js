let currentShipmentId = null;

async function requestCustomerOTP() {
    const phone = document.getElementById('cust-phone').value.trim();
    if (!phone) return alert("Please enter your phone number.");
    
    try {
        // Mock OTP send
        document.getElementById('step-phone').style.display = 'none';
        document.getElementById('step-otp').style.display = 'block';
        document.getElementById('otp-phone-label').innerText = phone;
    } catch (e) {
        alert("Failed to send OTP.");
    }
}

async function verifyCustomerOTP() {
    const phone = document.getElementById('cust-phone').value.trim();
    // Verify logic...
    showPanel('list');
    loadCustomerOrders(phone);
}

function showPanel(panelId) {
    document.getElementById('auth-panel').style.display = panelId === 'auth' ? 'block' : 'none';
    document.getElementById('list-panel').style.display = panelId === 'list' ? 'block' : 'none';
    document.getElementById('detail-panel').style.display = panelId === 'detail' ? 'block' : 'none';
}

async function loadCustomerOrders(phone) {
    const list = document.getElementById('orders-list');
    list.innerHTML = '<p style="text-align:center;">Loading orders...</p>';
    
    try {
        const allShipments = await apiCall('/shipments?company_id=all'); // Admin view or filter by phone
        // In this demo, we filter by receiver_phone
        const myOrders = allShipments.filter(s => s.receiver_phone === phone);
        
        if (myOrders.length === 0) {
            list.innerHTML = '<p style="text-align:center; color:var(--muted);">No orders found for this number.</p>';
            return;
        }
        
        list.innerHTML = myOrders.map(s => `
            <div class="glass-card order-card" onclick="viewOrder('${s.id}')">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h3 style="margin:0;">${s.description}</h3>
                        <small style="color:var(--muted);">Order #${s.id.substring(0,8)}</small>
                    </div>
                    <span class="status-pill status-${s.status}">${s.status.toUpperCase()}</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<p style="color:var(--danger);">Failed to load orders.</p>';
    }
}

async function viewOrder(id) {
    try {
        const s = await apiCall(`/shipments/${id}`);
        currentShipmentId = s.id;
        
        document.getElementById('det-id').innerText = `Order #${s.id.substring(0,8)}`;
        document.getElementById('det-desc').innerText = s.description;
        
        const statusEl = document.getElementById('det-status');
        statusEl.innerText = s.status.toUpperCase();
        statusEl.className = `status-pill status-${s.status}`;
        
        const eta = new Date(s.expected_delivery);
        document.getElementById('det-eta').innerText = s.status === 'delivered' ? 'Delivered' : eta.toLocaleDateString() + ' ' + eta.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        document.getElementById('det-loc').innerText = s.current_location ? `${s.current_location.lat.toFixed(2)}, ${s.current_location.lng.toFixed(2)}` : 'Pending';
        document.getElementById('det-vehicle').innerText = s.assigned_vehicle_id ? 'Vehicle Linked' : 'Awaiting Fleet';
        
        // OTP for non-delivered
        const otpBox = document.getElementById('det-otp-box');
        if (s.status !== 'delivered') {
            otpBox.style.display = 'block';
            document.getElementById('det-otp').innerText = s.delivery_otp;
        } else {
            otpBox.style.display = 'none';
        }
        
        // Rating Box for delivered but not yet rated
        const ratingBox = document.getElementById('rating-box');
        if (s.status === 'delivered' && !s.customer_rating) {
            ratingBox.style.display = 'block';
        } else {
            ratingBox.style.display = 'none';
        }
        
        // Timeline
        const timeline = document.getElementById('det-timeline');
        timeline.innerHTML = (s.logs || []).reverse().map(log => `
            <div class="timeline-step">
                <div class="timeline-dot"></div>
                <div style="font-weight:700; font-size:0.95rem;">${log.message}</div>
                <div style="font-size:0.8rem; color:var(--muted);">${new Date(log.timestamp).toLocaleString()}</div>
            </div>
        `).join('');

        showPanel('detail');
        initMap(s);
    } catch (e) {
        alert("Failed to load order details.");
    }
}

let trackMap = null;
let trackMarker = null;

function initMap(shipment) {
    const loc = shipment.current_location || shipment.pickup;
    if (!trackMap) {
        const mapContainer = document.getElementById('track-map');
        if (!mapContainer) return;
        trackMap = L.map('track-map').setView([loc.lat, loc.lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(trackMap);
    } else {
        trackMap.setView([loc.lat, loc.lng], 13);
        if (trackMarker) trackMap.removeLayer(trackMarker);
    }
    trackMarker = L.marker([loc.lat, loc.lng]).addTo(trackMap);
    setTimeout(() => trackMap.invalidateSize(), 200);
}

function setRating(val) {
    document.getElementById('selected-rating').value = val;
    const stars = document.querySelectorAll('.rating-star');
    stars.forEach((s, i) => {
        if (i < val) s.classList.add('active');
        else s.classList.remove('active');
    });
}

async function submitRating() {
    const val = parseInt(document.getElementById('selected-rating').value);
    if (val === 0) return alert("Please select a star rating.");
    
    const btn = document.getElementById('submit-rating-btn');
    btn.disabled = true;
    btn.innerText = 'Submitting...';
    
    try {
        await apiCall(`/shipments/${currentShipmentId}/rate`, 'POST', { rating: val });
        alert("Thank you for your feedback!");
        document.getElementById('rating-box').style.display = 'none';
    } catch (e) {
        alert("Failed to submit rating.");
        btn.disabled = false;
        btn.innerText = 'Submit Rating';
    }
}

function logoutCustomer() {
    location.reload();
}

// Auto-focus PIN boxes
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('pin-box')) {
        if (e.target.value && e.target.nextElementSibling) {
            e.target.nextElementSibling.focus();
        }
    }
});
