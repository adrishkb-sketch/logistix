let currentShipmentId = null;

async function requestCustomerOTP() {
    let phone = document.getElementById('cust-phone').value.trim();
    if (!phone) return alert("Please enter your phone number.");
    
    // Auto-prepend +91 if only 10 digits provided
    if (phone.length === 10 && !isNaN(phone)) {
        phone = "+91" + phone;
    }
    
    try {
        const res = await apiCall('/auth/customer/request-otp', 'POST', { phone });
        alert(res.message);
        document.getElementById('step-phone').style.display = 'none';
        document.getElementById('step-otp').style.display = 'block';
        document.getElementById('otp-phone-label').innerText = phone;
        startOTPTimer('resend-link', 'timer-val', requestCustomerOTP);
    } catch (e) {
        // Error already handled by apiCall
    }
}

function startOTPTimer(linkId, valId, retryFn) {
    let timeLeft = 10;
    const link = document.getElementById(linkId);
    const val = document.getElementById(valId);
    
    if (!link || !val) return;

    link.style.opacity = '0.5';
    link.style.pointerEvents = 'none';
    link.innerHTML = `Resend OTP (<span id="${valId}">${timeLeft}</span>s)`;
    
    const timer = setInterval(() => {
        timeLeft--;
        const v = document.getElementById(valId);
        if (v) v.innerText = timeLeft;
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            link.style.opacity = '1';
            link.style.pointerEvents = 'auto';
            link.innerHTML = `Resend OTP Now`;
            link.onclick = (e) => {
                e.preventDefault();
                retryFn();
            };
        }
    }, 1000);
}

async function verifyCustomerOTP() {
    const phone = document.getElementById('cust-phone').value.trim();
    const otp = Array.from(document.querySelectorAll('.pin-box')).map(i => i.value).join('');
    
    if (otp.length < 4) return alert("Please enter the full OTP.");
    
    try {
        const data = await apiCall('/auth/customer/verify-otp', 'POST', { phone, otp });
        localStorage.setItem('tracking_token', data.session_token);
        localStorage.setItem('tracking_phone', phone);
        
        showPanel('list');
        renderOrderList(data.orders);
    } catch (e) {
        alert("Invalid OTP or session expired.");
    }
}

function showPanel(panelId) {
    document.getElementById('auth-panel').style.display = panelId === 'auth' ? 'block' : 'none';
    document.getElementById('list-panel').style.display = panelId === 'list' ? 'block' : 'none';
    document.getElementById('detail-panel').style.display = panelId === 'detail' ? 'block' : 'none';
}

function renderOrderList(orders) {
    const list = document.getElementById('orders-list');
    if (!orders || orders.length === 0) {
        list.innerHTML = `<p style="text-align:center; color:var(--muted);">${getTranslation('no_orders_found') || 'No orders found for this number.'}</p>`;
        return;
    }
    
    list.innerHTML = orders.map(s => `
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
}

async function loadCustomerOrders() {
    const list = document.getElementById('orders-list');
    list.innerHTML = '<p style="text-align:center;">Loading orders...</p>';
    
    try {
        const myOrders = await apiCall('/auth/customer/shipments');
        
        if (myOrders.length === 0) {
            list.innerHTML = `<p style="text-align:center; color:var(--muted);">${getTranslation('no_orders_found') || 'No orders found for this number.'}</p>`;
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
        document.getElementById('det-eta').innerText = s.status === 'delivered' ? getTranslation('delivered_label') : eta.toLocaleDateString() + ' ' + eta.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        document.getElementById('det-loc').innerText = s.current_location ? `${s.current_location.lat.toFixed(2)}, ${s.current_location.lng.toFixed(2)}` : getTranslation('pending_label');
        document.getElementById('det-vehicle').innerText = s.assigned_vehicle_id ? getTranslation('vehicle_linked') : getTranslation('awaiting_fleet');
        
        // Payment Box
        const payBox = document.getElementById('payment-box');
        const payBtn = document.getElementById('btn-pay-now');
        if (s.status !== 'delivered' && s.payment_status === 'unpaid') {
            payBox.style.display = 'block';
            document.getElementById('det-amount').innerText = `₹ ${(s.finance?.suggested_price || 0).toLocaleString()}`;
        } else if (s.payment_status === 'paid') {
            payBox.style.display = 'block';
            document.getElementById('det-amount').innerText = getTranslation('paid');
            document.getElementById('det-amount').style.color = 'var(--success)';
            payBtn.style.display = 'none';
        } else {
            payBox.style.display = 'none';
        }

        // OTP for non-delivered AND PAID
        const otpBox = document.getElementById('det-otp-box');
        if (s.status !== 'delivered' && s.payment_status === 'paid') {
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
        
        // Timeline — richly designed
        const timeline = document.getElementById('det-timeline');
        const logs = (s.logs || []).slice().reverse();
        
        const statusMeta = {
            'pending':        { icon: '📥', color: '#94a3b8', label: getTranslation('order_received') },
            'assigned':       { icon: '🚛', color: '#3b82f6', label: getTranslation('fleet_assigned') },
            'in_transit':     { icon: '🛤️', color: '#6366f1', label: getTranslation('in_transit') },
            'at_warehouse':   { icon: '🏭', color: '#8b5cf6', label: getTranslation('arrived_hub') },
            'released':       { icon: '📤', color: '#0ea5e9', label: getTranslation('dispatched_hub') },
            'delivered':      { icon: '✨', color: '#10b981', label: getTranslation('delivered') },
            'safety_stop':    { icon: '🛡️', color: '#f59e0b', label: getTranslation('safety_halt') },
            'delayed':        { icon: '⏳', color: '#f59e0b', label: getTranslation('delayed') },
            'breakdown':      { icon: '🆘', color: '#ef4444', label: getTranslation('breakdown') },
            'disputed':       { icon: '🚫', color: '#dc2626', label: getTranslation('disputed') },
            'split':          { icon: '🔗', color: '#a855f7', label: getTranslation('route_optimized') }
        };

        timeline.innerHTML = logs.map((log, idx) => {
            const meta = statusMeta[log.status] || { icon: '📍', color: '#94a3b8', label: 'System Update' };
            const d = new Date(log.timestamp);
            const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
            const isLast = idx === logs.length - 1;

            return `
            <div style="display:flex; gap:20px; padding-bottom:${isLast ? '10px' : '30px'}; position:relative;">
                <!-- Left: icon + connector line -->
                <div style="display:flex; flex-direction:column; align-items:center; flex-shrink:0; width:42px;">
                    <div style="width:42px; height:42px; border-radius:12px; background:${meta.color}15; border:1px solid ${meta.color}44; display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                        ${meta.icon}
                    </div>
                    ${!isLast ? `<div style="width:2px; flex:1; background:linear-gradient(${meta.color}44, transparent); margin-top:8px;"></div>` : ''}
                </div>
                <!-- Right: content -->
                <div style="flex:1; padding-top:2px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:${meta.color};">${meta.label}</span>
                        <span style="font-size:0.75rem; color:var(--text-muted); font-family:monospace; background:rgba(255,255,255,0.03); padding:2px 6px; border-radius:4px;">${dateStr}, ${timeStr}</span>
                    </div>
                    <div style="background:rgba(255,255,255,0.02); padding:12px 16px; border-radius:12px; border:1px solid rgba(255,255,255,0.05); position:relative;">
                        <p style="margin:0; font-size:0.9rem; color:var(--text); line-height:1.6; opacity:0.9;">${log.message}</p>
                        ${log.reason ? `<div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.05); font-size:0.75rem; color:var(--text-muted); font-style:italic;">Note: ${log.reason}</div>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

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
        const theme = localStorage.getItem('theme') || 'dark';
        const tileUrl = theme === 'dark' 
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
        L.tileLayer(tileUrl, { attribution: '&copy; CARTO' }).addTo(trackMap);
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

async function simulatePayment() {
    alert("Simulating redirect to Payment Gateway (UPI/Card)...");
    setTimeout(async () => {
        alert("Payment Successful! Informing Logistix Manager for confirmation.");
        document.getElementById('btn-pay-now').innerText = getTranslation('awaiting_manager_conf');
        document.getElementById('btn-pay-now').disabled = true;
    }, 2000);
}

window.addEventListener('themeChanged', (e) => {
    if (!trackMap) return;
    const theme = e.detail.mode;
    const tileUrl = theme === 'dark' 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    
    trackMap.eachLayer(layer => {
        if (layer instanceof L.TileLayer) {
            trackMap.removeLayer(layer);
        }
    });
    L.tileLayer(tileUrl, { attribution: '&copy; CARTO' }).addTo(trackMap);
});

