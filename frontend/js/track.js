let currentShipmentId = null;
async function requestCustomerOTP() {
    const emailInput = document.getElementById('cust-email');
    const email = emailInput ? emailInput.value.trim() : '';
    if (!email) return alert(getTranslation('alert_enter_email'));
    
    const btn = document.querySelector('#step-phone button');
    if (btn) {
        btn.disabled = true;
        btn.innerText = getTranslation('otp_sending');
    }
    showToast(getTranslation('otp_sending'), 'info');

    try {
        const res = await apiCall('/auth/customer/request-otp', 'POST', { email });
        
        document.getElementById('step-phone').style.display = 'none';
        document.getElementById('step-otp').style.display = 'block';
        document.getElementById('otp-phone-label').innerText = email;
        startOTPTimer('resend-link', 'timer-val', requestCustomerOTP);
        
        if (res.otp) {
            showToast(`${getTranslation('otp_sent_success') || 'OTP Sent'} (Dev Auto-fill: ${res.otp})`, 'success');
            setTimeout(() => {
                const pinBoxes = document.querySelectorAll('.pin-box');
                if (pinBoxes.length === 6) {
                    res.otp.split('').forEach((char, idx) => {
                        pinBoxes[idx].value = char;
                    });
                }
            }, 100);
        } else {
            showToast(getTranslation('otp_sent_success'), 'success');
        }
    } catch (e) {
        if (btn) {
            btn.disabled = false;
            btn.innerText = getTranslation('send_otp') || 'Send OTP';
        }
    }
}

function startOTPTimer(linkId, valId, retryFn) {
    let timeLeft = 10;
    const link = document.getElementById(linkId);
    const val = document.getElementById(valId);
    
    if (!link || !val) return;

    link.style.opacity = '0.5';
    link.style.pointerEvents = 'none';
    link.innerHTML = `${getTranslation('resend_otp_btn')} (<span id="${valId}">${timeLeft}</span>s)`;
    
    const timer = setInterval(() => {
        timeLeft--;
        const v = document.getElementById(valId);
        if (v) v.innerText = timeLeft;
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            link.style.opacity = '1';
            link.style.pointerEvents = 'auto';
            link.innerHTML = getTranslation('resend_otp_now');
            link.onclick = (e) => {
                e.preventDefault();
                retryFn();
            };
        }
    }, 1000);
}
async function verifyCustomerOTP() {
    const email = document.getElementById('cust-email').value.trim();
    const otp = Array.from(document.querySelectorAll('.pin-box')).map(i => i.value?.trim() || '').join('');
    
    if (otp.length < 6) return alert(getTranslation('alert_full_otp'));
    
    const btn = document.querySelector('#step-otp button');
    if (btn) btn.disabled = true;

    try {
        const data = await apiCall('/auth/customer/verify-otp', 'POST', { email, otp });
        showToast(getTranslation('tracking_auth_success') || 'Tracking Access Granted!', 'success');
        localStorage.setItem('tracking_token', data.session_token);
        localStorage.setItem('tracking_email', email);
        
        setTimeout(() => {
            showPanel('list');
            renderOrderList(data.orders);
        }, 1000);
    } catch (e) {
        if (btn) btn.disabled = false;
        showToast(getTranslation('alert_invalid_otp'), 'error');
    }
}

function showPanel(panelId) {
    document.getElementById('auth-panel').style.display = panelId === 'auth' ? 'block' : 'none';
    document.getElementById('list-panel').style.display = panelId === 'list' ? 'block' : 'none';
    document.getElementById('detail-panel').style.display = panelId === 'detail' ? 'block' : 'none';
    
    const chatToggle = document.getElementById('ai-chat-toggle');
    const chatWindow = document.getElementById('ai-chat-window');
    if (panelId === 'detail') {
        const isPaid = window.currentShipmentPaid;
        if (window.shipmentAiConfigured && isPaid) {
            if (chatToggle) chatToggle.style.display = 'flex';
        } else {
            if (chatToggle) chatToggle.style.display = 'none';
            if (chatWindow) chatWindow.style.display = 'none';
        }
    } else {
        if (chatToggle) chatToggle.style.display = 'none';
        if (chatWindow) chatWindow.style.display = 'none';
    }
}

function renderEmptyOrdersState() {
    const textNoOrders = getTranslation('no_orders_found') || "No orders found for this email.";
    return `
        <div class="glass-card" style="text-align: center; padding: 48px 24px; border: 1px dashed var(--border); border-radius: 24px; background: rgba(255, 255, 255, 0.01); box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2); margin-top: 20px;">
            <style>
                @keyframes float-emoji {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-12px); }
                }
                .floating-box-emoji {
                    animation: float-emoji 3s ease-in-out infinite;
                    display: inline-block;
                }
            </style>
            <div class="floating-box-emoji" style="font-size: 4.5rem; margin-bottom: 20px;">📦</div>
            <h3 style="font-size: 1.4rem; font-weight: 700; margin-bottom: 12px; color: var(--text);">No Shipments Found</h3>
            <p style="color: var(--muted); max-width: 380px; margin: 0 auto 24px auto; font-size: 0.95rem; line-height: 1.6;">
                ${textNoOrders}
            </p>
            <div style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--primary); font-weight: 600; background: rgba(79, 140, 255, 0.1); padding: 8px 16px; border-radius: 30px;">
                <span class="pulse-dot" style="width: 8px; height: 8px; background: var(--primary); border-radius: 50%; display: inline-block; box-shadow: 0 0 8px var(--primary);"></span>
                Successfully Verified
            </div>
        </div>
    `;
}

function renderOrderList(orders) {
    const list = document.getElementById('orders-list');
    if (!orders || orders.length === 0) {
        list.innerHTML = renderEmptyOrdersState();
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
    list.innerHTML = `<p style="text-align:center;">${getTranslation('loading_orders')}</p>`;
    
    try {
        const myOrders = await apiCall('/auth/customer/shipments');
        
        if (myOrders.length === 0) {
            list.innerHTML = renderEmptyOrdersState();
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
        list.innerHTML = `<p style="color:var(--danger);">${getTranslation('failed_load_orders')}</p>`;
    }
}

async function viewOrder(id) {
    try {
        const trackingData = await apiCall(`/tracking/${id}`);
        const s = trackingData.shipment;
        const dynamicEta = trackingData.dynamic_eta;
        const activeAlerts = trackingData.alerts;
        
        currentShipmentId = s.id;
        window.shipmentAiConfigured = trackingData.ai_configured;
        window.chatHistory = [];
        
        document.getElementById('det-id').innerText = `${getTranslation('order_hash')} #${s.id.substring(0,8)}`;
        document.getElementById('det-desc').innerText = s.description;
        
        const statusEl = document.getElementById('det-status');
        statusEl.innerText = s.status.toUpperCase();
        statusEl.className = `status-pill status-${s.status}`;
        
        // Use dynamic ETA if available
        let etaText = getTranslation('pending_label');
        let statusNote = '';
        if (s.status === 'delivered') {
            etaText = getTranslation('delivered_label');
        } else {
            let arrivalTime = s.expected_delivery;
            if (dynamicEta && dynamicEta.estimated_arrival) {
                arrivalTime = dynamicEta.estimated_arrival;
            }
            if (arrivalTime) {
                const eta = new Date(arrivalTime);
                etaText = eta.toLocaleDateString() + ' ' + eta.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                
                const delayMins = dynamicEta ? dynamicEta.delay_mins : 0;
                if (delayMins > 0) {
                    statusNote = `<br><span style="color:var(--danger); font-size:0.75rem; font-weight:bold;">⏳ Late: Delayed by ${delayMins} mins (Reason: ${dynamicEta.weather || 'weather'})</span>`;
                } else if (delayMins < 0) {
                    statusNote = `<br><span style="color:var(--success); font-size:0.75rem; font-weight:bold;">⚡ Early: Arriving ${Math.abs(delayMins)} mins ahead of schedule</span>`;
                } else {
                    statusNote = `<br><span style="color:var(--success); font-size:0.75rem; font-weight:bold;">✅ On Time</span>`;
                }
            }
        }
        document.getElementById('det-eta').innerHTML = etaText + statusNote;
        
        const pickupEl = document.getElementById('det-pickup');
        if (pickupEl) {
            if (s.pickup_deadline) {
                const pd = new Date(s.pickup_deadline);
                pickupEl.innerText = pd.toLocaleDateString() + ' ' + pd.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            } else {
                pickupEl.innerText = getTranslation('pending_label') || 'Pending';
            }
        }
        
        document.getElementById('det-loc').innerText = s.current_location ? `${s.current_location.lat.toFixed(4)}, ${s.current_location.lng.toFixed(4)}` : getTranslation('pending_label');
        document.getElementById('det-vehicle').innerText = s.assigned_vehicle_id ? getTranslation('vehicle_linked') : getTranslation('awaiting_fleet');
        
        // Render Dynamic ETA Factors if available
        const infoGrid = document.getElementById('track-info-grid');
        const existingFactors = document.getElementById('dynamic-eta-factors');
        
        if (dynamicEta) {
            const offsetHtml = dynamicEta.delay_mins > 0 
                ? `<span style="color:var(--danger); font-weight:800;">+${dynamicEta.delay_mins} mins (Late)</span>` 
                : (dynamicEta.delay_mins < 0 ? `<span style="color:var(--success); font-weight:800;">${dynamicEta.delay_mins} mins (Early)</span>` : `<span style="color:var(--success); font-weight:800;">On Time</span>`);
                
            const factorsInnerHtml = `
                <h4 style="margin: 0 0 12px 0; color: var(--primary); font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">📡 Live Transit Insights</h4>
                <div style="display: flex; flex-direction: column; gap: 12px; font-size: 0.9rem; line-height: 1.5;">
                    <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div><strong>Weather:</strong> ${dynamicEta.weather_icon || '☀️'} ${dynamicEta.weather || 'Clear'}</div>
                        <div><strong>Traffic:</strong> 🚦 Live Flow</div>
                        <div><strong>Schedule Status:</strong> ${offsetHtml}</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.03);">
                        <p style="margin: 0; font-size: 0.85rem; color: var(--text-muted);">
                            🤖 <strong>AI ETA Prediction Model:</strong><br>
                            ${dynamicEta.reason || 'Transit parameters are standard. Tracking active.'}
                        </p>
                    </div>
                </div>
            `;
            
            if (existingFactors === null) {
                const factorsHtml = `
                    <div id="dynamic-eta-factors" class="glass-card" style="grid-column: 1 / -1; background: rgba(79, 140, 255, 0.05); padding: 20px; border-radius: 16px; border: 1px solid var(--primary); margin-top: 15px; box-shadow: 0 4px 15px rgba(79,140,255,0.15);">
                        ${factorsInnerHtml}
                    </div>
                `;
                infoGrid.insertAdjacentHTML('beforeend', factorsHtml);
            } else {
                 existingFactors.innerHTML = factorsInnerHtml;
            }
        } else {
            if (existingFactors) existingFactors.remove();
        }

        // Render Legs if it's a multi-leg journey
        const legs = trackingData.legs || [];
        if (legs.length > 0) {
            let legsContainer = document.getElementById('track-legs-container');
            if (!legsContainer) {
                legsContainer = document.createElement('div');
                legsContainer.id = 'track-legs-container';
                legsContainer.style.cssText = 'grid-column: 1 / -1; margin-top: 15px; display: flex; flex-direction: column; gap: 10px;';
                infoGrid.appendChild(legsContainer);
            }
            
            legsContainer.innerHTML = `
                <h4 style="margin: 0 0 5px 0; color: var(--primary);">Journey Legs</h4>
                ${legs.map(leg => {
                    const legType = leg.leg_type ? leg.leg_type.replace('_', ' ').toUpperCase() : 'JOURNEY';
                    const icon = leg.leg_type === 'middle_mile' ? '🚛' : (leg.leg_type === 'last_mile' ? '🚁' : '🚲');
                    const pickup = leg.pickup?.address || leg.pickup?.name || 'Current';
                    const drop = leg.drop?.address || leg.drop?.name || 'Next';
                    
                    let legEta = 'Pending ETA';
                    if (leg.expected_delivery) {
                        const ed = new Date(leg.expected_delivery);
                        legEta = ed.toLocaleDateString() + ' ' + ed.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                    }
                    
                    let waitingNote = '';
                    if (leg.pickup_deadline && leg.leg_type === 'middle_mile') {
                        const pd = new Date(leg.pickup_deadline);
                        const now = new Date();
                        if (pd > now) {
                            waitingNote = `<span style="color:var(--warning); font-size:0.75rem;"> (Awaiting Consolidation: starts ${pd.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})})</span>`;
                        }
                    }

                    return `
                    <div style="background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
                        <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
                            <span style="font-size:0.8rem; font-weight:800; color:var(--accent);">${icon} ${legType}</span>
                            <span class="status-pill status-${leg.status}" style="font-size:0.6rem;">${leg.status.toUpperCase()}</span>
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom: 5px;">
                            <strong>Route:</strong> ${pickup} &rarr; ${drop}
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom: 5px;">
                            <strong>ETA:</strong> ${legEta} ${waitingNote}
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-muted);">
                            <strong>Allocated Rev:</strong> ₹ ${(leg.finance?.suggested_price || 0).toLocaleString()}
                        </div>
                    </div>
                    `;
                }).join('')}
            `;
        } else {
            const existing = document.getElementById('track-legs-container');
            if (existing) existing.remove();
        }
        
        
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

        // Delivery Code for non-delivered AND PAID
        const otpBox = document.getElementById('det-otp-box');
        if (s.status !== 'delivered' && s.payment_status === 'paid') {
            otpBox.style.display = 'block';
            document.getElementById('det-otp').innerText = s.delivery_code || s.delivery_otp || 'N/A';
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
                        ${log.reason ? `<div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.05); font-size:0.75rem; color:var(--text-muted); font-style:italic;">${getTranslation('note_label')}: ${log.reason}</div>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        window.currentShipmentPaid = (s.payment_status === 'paid');
        const isPaid = s.payment_status === 'paid';
        
        const mapContainer = document.getElementById('track-map');
        const infoGridEl = document.getElementById('track-info-grid');
        const timelineContainer = document.getElementById('track-timeline-section');
        
        if (mapContainer) mapContainer.style.display = isPaid ? 'block' : 'none';
        if (infoGridEl) infoGridEl.style.display = isPaid ? 'grid' : 'none';
        if (timelineContainer) timelineContainer.style.display = isPaid ? 'block' : 'none';

        const factorsEl = document.getElementById('dynamic-eta-factors');
        if (factorsEl) factorsEl.style.display = isPaid ? 'block' : 'none';
        const legsEl = document.getElementById('track-legs-container');
        if (legsEl) legsEl.style.display = isPaid ? 'block' : 'none';

        showPanel('detail');
        if (isPaid) {
            initMap(s, dynamicEta, trackingData.vehicle_type, trackingData.legs || []);
        }
    } catch (e) {
        console.error(e);
        alert(getTranslation('failed_load_details'));
    }
}

let trackMap = null;
let trackMarker = null;
let vehicleAnimationInterval = null;
let trackWeatherLayers = [];

async function initMap(shipment, dynamicEta, vehicleType, legs = []) {
    if (vehicleAnimationInterval) {
        clearInterval(vehicleAnimationInterval);
        vehicleAnimationInterval = null;
    }

    let loc = shipment.current_location || shipment.pickup;
    let activeLeg = null;
    if (legs && legs.length > 0) {
        activeLeg = legs.find(l => l.status === 'in_transit' || l.status === 'assigned') || legs.find(l => l.status !== 'delivered');
        if (activeLeg) {
            loc = activeLeg.current_location || activeLeg.pickup;
        }
    }

    if (!trackMap) {
        const mapContainer = document.getElementById('track-map');
        if (!mapContainer) return;
        
        const theme = localStorage.getItem('theme') || 'dark';
        trackMap = new google.maps.Map(document.getElementById('track-map'), {
            center: { lat: loc.lat, lng: loc.lng }, zoom: 13,
            styles: theme === 'dark' ? [
                { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
            ] : []
        });
        
    } else {
        trackMap.setCenter({lat: loc.lat, lng: loc.lng});
        if (trackMarker) trackMap.removeLayer(trackMarker);
    }

    // Clear any existing polylines
    trackMap.eachLayer(layer => {
        if (layer instanceof L.Polyline) {
            trackMap.removeLayer(layer);
        }
    });

    // Clear previous weather layers
    trackWeatherLayers.forEach(l => trackMap.removeLayer(l));
    trackWeatherLayers = [];

    // Fetch and draw live calamity/weather cells
    try {
        const weatherRes = await apiCall(`/tracking/fleet/weather?company_id=${shipment.company_id}`, 'GET', null, true);
        if (weatherRes && weatherRes.cells) {
            weatherRes.cells.forEach(cell => {
                let animClass = 'weather-cell-pulse';
                if (cell.severity === 'critical') animClass = 'weather-cell-critical-pulse';
                
                if (cell.shapeType === 'polyline') {
                    const polyline = L.polyline(cell.coordinates, {
                        color: cell.color || '#dd6b20', weight: 8, opacity: 0.8, className: animClass
                    }).addTo(trackMap).bindPopup(`<b>${cell.icon || '🌡️'} ${cell.type} System</b>`);
                    trackWeatherLayers.push(polyline);
                } else {
                    const circle = L.circle([cell.lat, cell.lng], {
                        radius: cell.radius * 1000, 
                        color: cell.color || '#e53e3e', 
                        fillColor: cell.color || '#e53e3e', 
                        fillOpacity: 0.2,
                        className: animClass
                    }).addTo(trackMap).bindPopup(`<b>${cell.icon || '🌩️'} ${cell.type} System</b><br>Severity: ${cell.severity}`);
                    trackWeatherLayers.push(circle);
                    
                    const iconMarker = L.marker([cell.lat, cell.lng], {
                        icon: L.divIcon({
                            className: 'weather-div-icon',
                            html: `<div style="font-size:24px; text-shadow: 0 0 10px rgba(0,0,0,0.5);">${cell.icon || '🌦️'}</div>`,
                            iconSize: [30, 30],
                            iconAnchor: [15, 15]
                        })
                    }).addTo(trackMap);
                    trackWeatherLayers.push(iconMarker);
                }
            });
        }
    } catch (err) {
        console.error("Failed to load weather cells on tracking page", err);
    }
    
    // Draw completed legs as dashed grey lines
    if (legs && legs.length > 0) {
        const completedLegs = legs.filter(l => l.status === 'delivered');
        completedLegs.forEach(l => {
            if (l.pickup && l.drop) {
                const completedLine = L.polyline([[l.pickup.lat, l.pickup.lng], [l.drop.lat, l.drop.lng]], {
                    color: '#718096',
                    weight: 2,
                    dashArray: '5, 5',
                    opacity: 0.6
                }).addTo(trackMap);
            }
        });
    }
    
    // Determine Emoji
    let emoji = '🚚';
    const vt = (vehicleType || '').toLowerCase();
    if (vt.includes('drone')) {
        emoji = '🛸';
    } else if (vt.includes('bike') || vt.includes('scooty') || vt.includes('scooter')) {
        emoji = '🏍️';
    } else if (vt.includes('van') || vt.includes('delivery')) {
        emoji = '🚐';
    } else if (vt.includes('truck')) {
        emoji = '🚚';
    }
    
    // Create a custom icon for the delivery vehicle
    const vehicleIcon = L.divIcon({
        html: `<div style="font-size:24px; filter:drop-shadow(0 2px 5px rgba(0,0,0,0.5));">${emoji}</div>`,
        className: 'custom-vehicle-icon',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    
    trackMarker = L.marker([loc.lat, loc.lng], {icon: vehicleIcon}).addTo(trackMap);
    
    // Add destination marker
    if (shipment.drop) {
        L.marker([shipment.drop.lat, shipment.drop.lng], {
            icon: L.divIcon({ html: '🎯', className: 'dest-icon', iconSize: [24,24] })
        }).addTo(trackMap);
        
        // Fetch OSRM route path
        let routeCoords = [];
        try {
            let coordString = `${loc.lng},${loc.lat}`;
            if (legs && legs.length > 0 && activeLeg) {
                const remainingLegs = legs.filter(l => l.leg_order >= activeLeg.leg_order).sort((a,b) => a.leg_order - b.leg_order);
                remainingLegs.forEach(l => {
                    if (l.drop && l.drop.lng) {
                        coordString += `;${l.drop.lng},${l.drop.lat}`;
                    }
                });
            } else {
                coordString += `;${shipment.drop.lng},${shipment.drop.lat}`;
            }
            
            const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
            const res = await fetch(url);
            const json = await res.json();
            if (json.routes && json.routes[0]) {
                routeCoords = json.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            }
        } catch (e) {
            console.error("OSRM path fetch failed:", e);
        }

        // Draw path line (using OSRM path or fallback straight line)
        let pathLine;
        if (routeCoords.length > 0) {
            pathLine = routeCoords;
        } else {
            pathLine = [[loc.lat, loc.lng]];
            if (legs && legs.length > 0 && activeLeg) {
                const remainingLegs = legs.filter(l => l.leg_order >= activeLeg.leg_order).sort((a,b) => a.leg_order - b.leg_order);
                remainingLegs.forEach(l => {
                    pathLine.push([l.drop.lat, l.drop.lng]);
                });
            } else {
                pathLine.push([shipment.drop.lat, shipment.drop.lng]);
            }
        }
        L.polyline(pathLine, {color: 'var(--primary)', weight: 3, opacity: 0.8}).addTo(trackMap);

        // Animate marker along the path if in transit
        const isMoving = shipment.status === 'in_transit' || (activeLeg && activeLeg.status === 'in_transit');
        if (isMoving && routeCoords.length > 1) {
            let currentPtIndex = 0;
            let subStep = 0;
            const subStepsCount = 10; // Interpolate 10 frames between consecutive coordinate nodes
            const totalSteps = routeCoords.length;
            
            vehicleAnimationInterval = setInterval(() => {
                if (!trackMarker) return;
                
                const startPt = routeCoords[currentPtIndex];
                const endPt = routeCoords[(currentPtIndex + 1) % totalSteps];
                
                // Linear interpolation for a playful moving animation along the road geometry
                const lat = startPt[0] + (endPt[0] - startPt[0]) * (subStep / subStepsCount);
                const lng = startPt[1] + (endPt[1] - startPt[1]) * (subStep / subStepsCount);
                
                trackMarker.setLatLng([lat, lng]);
                
                subStep++;
                if (subStep >= subStepsCount) {
                    subStep = 0;
                    currentPtIndex = (currentPtIndex + 1) % totalSteps;
                }
            }, 60); // 60ms updates result in super-smooth transition along OSRM route path
        }
    }
    
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
    if (val === 0) return alert(getTranslation('alert_select_rating'));
    
    const commentEl = document.getElementById('rating-comment');
    const comment = commentEl ? commentEl.value.trim() : '';
    
    const btn = document.getElementById('submit-rating-btn');
    btn.disabled = true;
    btn.innerText = getTranslation('submitting_btn');
    
    try {
        await apiCall(`/shipments/${currentShipmentId}/rate`, 'POST', { rating: val, review: comment });
        alert(getTranslation('thank_you_feedback'));
        document.getElementById('rating-box').style.display = 'none';
    } catch (e) {
        alert(getTranslation('failed_submit_rating'));
        btn.disabled = false;
        btn.innerText = getTranslation('submit_rating');
    }
}

function logoutCustomer() {
    location.reload();
}

async function simulatePayment() {
    const btn = document.getElementById('btn-pay-now');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = getTranslation('processing_pmt');

    try {
        await apiCall(`/shipments/${currentShipmentId}/pay`, 'POST');
        alert(getTranslation('pmt_success'));
        viewOrder(currentShipmentId); // Refresh UI
    } catch (e) {
        alert(getTranslation('pmt_failed'));
        btn.disabled = false;
        btn.innerText = originalText;
    }
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


/* ── CUSTOMER AI CHATBOT FUNCTIONALITY ───────────────────────── */
window.chatHistory = [];

window.toggleAIChat = function() {
    const win = document.getElementById('ai-chat-window');
    if (!win) return;
    
    const isHidden = win.style.display === 'none' || win.style.display === '';
    win.style.display = isHidden ? 'flex' : 'none';
    
    if (isHidden) {
        const msgContainer = document.getElementById('ai-chat-messages');
        if (msgContainer && msgContainer.children.length === 0) {
            msgContainer.innerHTML = `
                <div style="align-self: flex-start; background: rgba(255,255,255,0.05); border: 1px solid var(--border); padding: 12px 16px; border-radius: 16px 16px 16px 4px; max-width: 85%; line-height: 1.5; color: var(--text);">
                    Hi! I am your <b>Logistix AI Assistant</b>. I have live access to your shipment details. Ask me anything about its status, ETA, route, weather, or billing! 📦
                </div>
            `;
            window.chatHistory = [];
        }
        document.getElementById('ai-chat-input').focus();
    }
};

window.sendAIChatMessage = async function() {
    const input = document.getElementById('ai-chat-input');
    const msgContainer = document.getElementById('ai-chat-messages');
    if (!input || !msgContainer || !currentShipmentId) return;
    
    const text = input.value.trim();
    if (!text) return;
    
    input.value = '';
    
    // Add user message to UI
    msgContainer.innerHTML += `
        <div style="align-self: flex-end; background: var(--primary); padding: 12px 16px; border-radius: 16px 16px 4px 16px; max-width: 85%; line-height: 1.5; color: white; font-weight: 600;">
            ${text}
        </div>
    `;
    msgContainer.scrollTop = msgContainer.scrollHeight;
    
    // Display typing bubble
    const typingId = 'ai-typing-' + Date.now();
    msgContainer.innerHTML += `
        <div id="${typingId}" style="align-self: flex-start; background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 12px 16px; border-radius: 16px 16px 16px 4px; max-width: 80%; display: flex; align-items: center; gap: 4px; padding-top: 16px; padding-bottom: 16px;">
            <span style="width: 6px; height: 6px; background: var(--muted); border-radius: 50%; display: inline-block; animation: typingPulse 0.6s infinite alternate;"></span>
            <span style="width: 6px; height: 6px; background: var(--muted); border-radius: 50%; display: inline-block; animation: typingPulse 0.6s infinite alternate 0.2s;"></span>
            <span style="width: 6px; height: 6px; background: var(--muted); border-radius: 50%; display: inline-block; animation: typingPulse 0.6s infinite alternate 0.4s;"></span>
        </div>
    `;
    msgContainer.scrollTop = msgContainer.scrollHeight;
    
    try {
        const res = await apiCall(`/tracking/${currentShipmentId}/chat`, 'POST', {
            message: text,
            history: window.chatHistory
        });
        
        // Remove typing
        const bubble = document.getElementById(typingId);
        if (bubble) bubble.remove();
        
        // Render formatted response
        const formatted = parseMarkdownToHtml(res.response);
        msgContainer.innerHTML += `
            <div style="align-self: flex-start; background: rgba(255,255,255,0.05); border: 1px solid var(--border); padding: 12px 16px; border-radius: 16px 16px 16px 4px; max-width: 85%; line-height: 1.5; color: var(--text);">
                ${formatted}
            </div>
        `;
        
        window.chatHistory.push({ role: 'user', text: text });
        window.chatHistory.push({ role: 'model', text: res.response });
        
    } catch(err) {
        const bubble = document.getElementById(typingId);
        if (bubble) bubble.remove();
        
        msgContainer.innerHTML += `
            <div style="align-self: flex-start; background: rgba(229, 62, 62, 0.1); border: 1px solid var(--danger); padding: 12px 16px; border-radius: 16px; max-width: 85%; line-height: 1.5; color: var(--danger);">
                ⚠️ Sorry, I had trouble reaching the neural cloud. Please try again.
            </div>
        `;
    }
    
    msgContainer.scrollTop = msgContainer.scrollHeight;
};
