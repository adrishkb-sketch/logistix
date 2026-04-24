// Driver Dashboard Logic

if (!localStorage.getItem('driver_id')) {
    window.location.href = '../index.html';
}

const dId = localStorage.getItem('driver_id');
document.getElementById('driver-name').innerText = `Hello, ${localStorage.getItem('driver_name')}`;

let map;
let marker;
let driverPerfChart;
let watchId;
let routeCoords = [];
let simIndex = 0;
let hasSetInitialView = false;

// Stationary Tracking Variables
let lastMovedTimestamp = Date.now();
let lastLocation = null;
let stationaryAlertShown = false;

// Zen Mode & Motion Tracking
let isZenMode = false;
let motionThreshold = 15; // G-force threshold for erratic driving
let lastMotionAlert = 0;

function switchDriverTab(tab) {
    const tabs = ['dash', 'active', 'completed', 'profile'];
    tabs.forEach(t => {
        const el = document.getElementById(`${t}-tab`);
        const btn = document.getElementById(`btn-tab-${t}`);
        if (el) el.style.display = t === tab ? 'block' : 'none';
        if (btn) {
            btn.style.background = t === tab ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
            btn.style.color = t === tab ? '#000' : 'var(--text-muted)';
        }
    });

    if (tab === 'dash') loadDashStats();
    if (tab === 'profile') loadProfileData();
    if (tab === 'active' && map) setTimeout(() => map.invalidateSize(), 200);
}

async function loadDashStats() {
    try {
        const stats = await apiCall(`/driver/${localStorage.getItem('driver_id')}/dashboard/stats`);
        
        document.getElementById('d-stat-earned').innerText = `$${stats.total_earned.toLocaleString()}`;
        document.getElementById('d-stat-ontime').innerText = `${stats.timely_percent}%`;
        document.getElementById('d-stat-safety').innerText = (5 - (stats.fatigue_score/100)).toFixed(1);

        renderDriverChart(stats.perf_history);
        
        // Mini vehicle details
        const drivers = await apiCall(`/manager/drivers`);
        const me = drivers.find(d => d.id === localStorage.getItem('driver_id'));
        if (me && me.assigned_vehicle_id) {
            document.getElementById('vehicle-mini-details').innerText = `Active Vehicle: ${me.assigned_vehicle_id}`;
        }
    } catch(e) {}
}

function renderDriverChart(history) {
    const ctx = document.getElementById('driverPerfChart')?.getContext('2d');
    if (!ctx) return;

    if (driverPerfChart) driverPerfChart.destroy();

    driverPerfChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['T-4', 'T-3', 'T-2', 'T-1', 'Latest'],
            datasets: [{
                label: 'Score',
                data: history,
                backgroundColor: 'rgba(0, 242, 254, 0.5)',
                borderColor: '#00f2fe',
                borderWidth: 1,
                borderRadius: 5
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { 
                y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } } 
            }
        }
    });
}

async function loadMissions(autoStartNext = false) {
    try {
        // Fetch driver info to check verification status
        const drivers = await apiCall('/manager/drivers');
        const me = drivers.find(d => d.id === dId);
        
        if (me && me.assigned_vehicle_id) {
            const vOverlay = document.getElementById('verification-overlay');
            const vMsg = document.getElementById('verification-msg');
            const vForm = document.getElementById('verify-form');
            
            if (me.verification_status === "unverified") {
                vOverlay.style.display = 'block';
                vForm.style.display = 'block';
                vMsg.innerText = "Please upload a photo of your assigned vehicle's number plate.";
            } else if (me.verification_status === "pending_manual") {
                vOverlay.style.display = 'block';
                vForm.style.display = 'none';
                vMsg.innerHTML = `<span style="color:var(--warning)">Verification Pending</span><br>AI could not read the plate. Waiting for manager approval.`;
            } else {
                vOverlay.style.display = 'none';
            }
        }

        const shipments = await apiCall(`/driver/${dId}/shipments`);
        const container = document.getElementById('mission-container');
        
        const activeShipments = shipments.filter(s => s.status !== 'delivered');
        const completedShipments = shipments.filter(s => s.status === 'delivered');
        
        // Render Completed Orders
        const completedContainer = document.getElementById('completed-container');
        let compHtml = '<h3>Completed Orders</h3>';
        if (completedShipments.length === 0) {
            compHtml += '<p>No completed orders yet.</p>';
        } else {
            completedShipments.forEach(s => {
                const isWarehouseHandoff = s.is_leg && s.drop.address;
                const dropTitle = isWarehouseHandoff ? `Warehouse Handoff: ${s.drop.address}` : 'Customer Delivery';
                compHtml += `
                    <div class="glass-card" style="margin-bottom:15px; border-left: 4px solid var(--success); opacity: 0.8;">
                        <h4 style="margin-bottom:5px; color:var(--success);">✅ ${s.description}</h4>
                        <p style="margin-bottom:5px; font-size: 0.9rem; color:var(--text-muted);"><b>ID:</b> ${s.id}</p>
                        <p style="margin-bottom:5px; font-size: 0.9rem;"><b>Type:</b> ${dropTitle}</p>
                        <p style="margin-bottom:5px; font-size: 0.9rem;"><b>OTP Used:</b> ${s.delivery_otp || 'N/A'}</p>
                    </div>
                `;
            });
        }
        completedContainer.innerHTML = compHtml;
        
        if (activeShipments.length === 0) {
            container.innerHTML = `<div class="glass-card"><p>No active shipments currently. You're all caught up!</p></div>`;
            document.getElementById('route-map').style.display = 'none';
            document.getElementById('fullscreen-btn').style.display = 'none';
            return;
        }

        // Decompose into stops
        let stops = [];
        activeShipments.forEach(s => {
            if (s.status === 'assigned' || s.status === 'pending') {
                stops.push({ type: 'pickup', shipment: s, lat: s.pickup.lat, lng: s.pickup.lng, id: s.id + '_pickup' });
                stops.push({ type: 'drop', shipment: s, lat: s.drop.lat, lng: s.drop.lng, id: s.id + '_drop' });
            } else if (s.status === 'in_transit') {
                stops.push({ type: 'drop', shipment: s, lat: s.drop.lat, lng: s.drop.lng, id: s.id + '_drop' });
            }
        });
        
        // TSP Route Optimization with Capacity Constraint
        let unvisited = [...stops];
        let orderedStops = [];
        let carrying = new Set();
        activeShipments.filter(s => s.status === 'in_transit').forEach(s => carrying.add(s.id));
        
        let currentLocation = null;
        if (marker) {
             currentLocation = {lat: marker.getLatLng().lat, lng: marker.getLatLng().lng};
        } else if (unvisited.length > 0) {
             currentLocation = {lat: unvisited[0].lat, lng: unvisited[0].lng};
        }

        while (unvisited.length > 0) {
            let validStops = unvisited.filter(stop => {
                if (stop.type === 'pickup') return true;
                if (stop.type === 'drop') return carrying.has(stop.shipment.id);
            });
            
            // If somehow no valid stops (shouldn't happen unless bad state), fallback to all
            if (validStops.length === 0) validStops = unvisited;
            
            let closestIdx = -1;
            let minDistance = Infinity;
            
            for (let i = 0; i < validStops.length; i++) {
                const stop = validStops[i];
                const dist = Math.sqrt(Math.pow(stop.lat - currentLocation.lat, 2) + Math.pow(stop.lng - currentLocation.lng, 2));
                if (dist < minDistance) {
                    minDistance = dist;
                    closestIdx = i;
                }
            }
            
            const nextStop = validStops[closestIdx];
            orderedStops.push(nextStop);
            
            if (nextStop.type === 'pickup') carrying.add(nextStop.shipment.id);
            if (nextStop.type === 'drop') carrying.delete(nextStop.shipment.id);
            
            currentLocation = {lat: nextStop.lat, lng: nextStop.lng};
            unvisited = unvisited.filter(s => s.id !== nextStop.id);
        }
        
        // Render Timeline
        if (orderedStops.length > 0 && me && me.verification_status === "verified") {
            let html = `<h3>Multi-Stop Roadmap (${orderedStops.length} Stops)</h3><div class="timeline">`;
            
            orderedStops.forEach((stop, idx) => {
                const isCurrent = idx === 0;
                const dotColor = stop.type === 'pickup' ? '#f6ad55' : '#48bb78';
                const actionText = stop.type === 'pickup' ? '📦 Pickup' : '📍 Drop';
                const s = stop.shipment;
                
                let actionBtn = '';
                if (isCurrent) {
                     if (stop.type === 'pickup') {
                         actionBtn = `
                            <input type="file" id="scan-file-${s.id}" style="display:none;" accept="image/*" onchange="scanCargo('${s.id}')">
                            <button id="scan-btn-${s.id}" class="btn-primary" style="margin-top:10px; width:auto; padding: 5px 15px; background:var(--warning); color:#000;" onclick="document.getElementById('scan-file-${s.id}').click()">📷 Scan Cargo (Required)</button>
                            <button id="pickup-btn-${s.id}" class="btn-primary" style="margin-top:10px; width:auto; padding: 5px 15px; display:none;" onclick="confirmPickup('${s.id}')">Confirm Pickup</button>
                            <div id="scan-result-${s.id}" style="margin-top:5px; font-size:0.8rem; font-weight:bold;"></div>
                         `;
                    } else {
                         actionBtn = `<button class="btn-primary" style="margin-top:10px; width:auto; padding: 5px 15px; background:var(--success);" onclick="confirmDelivery('${s.id}', '${s.delivery_otp}')">Confirm Delivery (OTP)</button>`;
                    }
                }
                
                html += `
                    <div class="timeline-node">
                        <div class="timeline-dot" style="background:${dotColor};"></div>
                        <div class="glass-card" style="${isCurrent ? 'border-left: 4px solid var(--accent);' : 'opacity: 0.7;'}">
                            <h4 style="margin-bottom:5px; color:${dotColor}">${actionText}</h4>
                            <p style="margin-bottom:5px; font-size: 0.9rem;"><b>Shipment:</b> ${s.description} (ID: ${s.id.slice(0,8)})</p>
                            
                            ${s.is_perishable ? `
                                <div style="background:rgba(0,242,254,0.1); padding:10px; border-radius:8px; border:1px solid var(--primary); margin:10px 0;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                                        <span style="font-size:0.75rem; color:var(--primary); font-weight:bold;">❄️ COLD CHAIN CARGO</span>
                                        <span style="font-size:0.75rem; font-weight:bold; color:${(s.vitality||100) < 60 ? 'var(--danger)' : 'var(--success)'}">${(s.vitality||100).toFixed(0)}% Vitality</span>
                                    </div>
                                    <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                                        <div style="width:${s.vitality||100}%; height:100%; background:${(s.vitality||100) < 60 ? 'var(--danger)' : 'var(--primary)'};"></div>
                                    </div>
                                    <p style="font-size:0.7rem; color:var(--text-muted); margin-top:5px;">AI Warning: Perishable items detected. Maintain speed and avoid high-temperature delays.</p>
                                </div>
                            ` : ''}

                            <div style="display:flex; gap:10px; margin: 10px 0;">
                                <button class="btn-primary" style="flex:1; padding:8px; font-size:0.8rem;" onclick="openLoadingOptimizer('${s.id}')">🏗️ Optimize Loading (AR)</button>
                                <button class="btn-primary" style="flex:1; padding:8px; font-size:0.8rem; background:rgba(255,255,255,0.1);" onclick="openScanner('${s.id}')">📷 Scan Cargo</button>
                            </div>

                            <p style="margin-bottom:5px; font-size: 0.85rem; color:var(--warning);"><b>⏳ Deadline:</b> ${new Date(stop.type === 'pickup' ? s.pickup_deadline : s.expected_delivery).toLocaleString()}</p>
                            <p style="margin-bottom:5px; font-size: 0.9rem;"><b>Location:</b> ${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}</p>
                            ${s.performance_stats ? `
                                <div style="margin:8px 0; padding:8px; border-radius:6px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);">
                                    <div style="display:flex; justify-content:space-between; align-items:center;">
                                        <span style="font-size:0.75rem; color:var(--text-muted);">Journey Status:</span>
                                        <span class="badge" style="background:${s.performance_stats.status === 'delayed' ? 'var(--danger)' : (s.performance_stats.status === 'early' ? 'var(--success)' : 'var(--primary)')}; font-size:0.7rem;">
                                            ${s.performance_stats.status.toUpperCase()} (${s.performance_stats.diff_mins}m)
                                        </span>
                                    </div>
                                    <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px;">
                                         ${s.performance_stats.dist_remaining_km}km left | Weather: ${s.performance_stats.weather}
                                    </div>
                                </div>
                            ` : ''}
                            
                            ${(stop.type === 'drop' && s.receiver_name) ? `
                                <div style="margin:10px 0; padding:12px; border-radius:8px; background:rgba(72, 187, 120, 0.1); border:1px solid var(--success); border-left: 4px solid var(--success);">
                                    <p style="margin:0; font-size:0.75rem; color:var(--success); font-weight:bold; text-transform:uppercase; letter-spacing:1px;">Recipient Details</p>
                                    <p style="margin:5px 0 0 0; font-size:1.1rem; font-weight:bold; color:white;">👤 ${s.receiver_name}</p>
                                    <p style="margin:2px 0 0 0; font-size:1rem; color:var(--text-muted);">📞 ${s.receiver_phone}</p>
                                </div>
                            ` : ''}

                            ${actionBtn}
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
            container.innerHTML = html;
            
            // Map Setup
            document.getElementById('route-map').style.display = 'block';
            document.getElementById('fullscreen-btn').style.display = 'block';
            
            if (!map) {
                map = L.map('route-map').setView([orderedStops[0].lat, orderedStops[0].lng], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                
                if (navigator.geolocation) {
                    watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {enableHighAccuracy: true});
                } else {
                    handleError();
                }
            } else {
                map.eachLayer((layer) => {
                    if (layer instanceof L.Polyline || layer instanceof L.Marker || layer instanceof L.CircleMarker) {
                        map.removeLayer(layer);
                    }
                });
            }
            
            setTimeout(() => { if (map) map.invalidateSize(true); }, 300);
            drawMultiStopRoute(orderedStops);
            
        } else if (me && me.verification_status !== "verified") {
            container.innerHTML = `<div class="glass-card"><p>Awaiting vehicle verification before roadmap can be loaded.</p></div>`;
            document.getElementById('route-map').style.display = 'none';
            document.getElementById('fullscreen-btn').style.display = 'none';
        } else {
            container.innerHTML = `<div class="glass-card"><p>No valid stops to route currently.</p></div>`;
            document.getElementById('route-map').style.display = 'none';
            document.getElementById('fullscreen-btn').style.display = 'none';
        }
        // Fetch and show dynamic alerts/messages
        loadAlertsAndMessages();
        
    } catch(e) {
        console.error("Error in loadMissions:", e);
        document.getElementById('mission-container').innerHTML = `<div class="glass-card"><p style="color:red">Error loading route: ${e.message}</p></div>`;
    }
}

document.getElementById('verify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('plate-image').files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    document.getElementById('verify-btn').innerText = "Scanning...";
    document.getElementById('verify-btn').disabled = true;
    
    try {
        const res = await fetch(`http://localhost:8000/api/driver/${dId}/verify`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.status === "verified") {
            alert("Verification Successful! " + data.ml_result.message);
        } else {
            alert("Verification Pending. " + data.ml_result.message);
        }
        loadMissions();
    } catch (err) {
        alert("Verification failed");
    }
});

// Removed old startJourney as map init is now auto-triggered in loadMissions

async function updateLocation(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    
    if (!marker) {
        marker = L.circleMarker([lat, lng], {color: '#00f2fe', radius: 8, fillOpacity: 1}).addTo(map);
    } else {
        marker.setLatLng([lat, lng]);
    }
    
    if (!hasSetInitialView) {
        map.setView([lat, lng], 15);
        hasSetInitialView = true;
    }
    
    // Stationary Detection Logic
    if (lastLocation) {
        const dist = Math.sqrt(Math.pow(lat - lastLocation.lat, 2) + Math.pow(lng - lastLocation.lng, 2)) * 111000; // rough meters
        if (dist > 5) {
            lastMovedTimestamp = Date.now();
            stationaryAlertShown = false;
        } else {
            const idleTime = (Date.now() - lastMovedTimestamp) / 1000;
            // Trigger if idle for > 20s
            if (idleTime > 20 && !stationaryAlertShown) {
                document.getElementById('stationary-modal').style.display = 'block';
                stationaryAlertShown = true;
            }
        }
    }
    lastLocation = {lat, lng};
    
    // Send to backend
    try {
        await apiCall(`/driver/${dId}/location`, 'POST', {lat, lng});
    } catch(e) {}
}

function handleError() {
    console.warn("Real GPS failed, falling back to simulated GPS movement for demo.");
    
    if (routeCoords.length === 0) return;
    
    // Simulate moving smoothly along the OSRM route
    setInterval(async () => {
        if (simIndex >= routeCoords.length) return; // Reached destination
        
        const pos = routeCoords[simIndex];
        const lat = pos[0];
        const lng = pos[1];
        
        if (!marker) {
            marker = L.circleMarker([lat, lng], {color: '#00f2fe', radius: 8, fillOpacity: 1}).addTo(map);
        } else {
            marker.setLatLng([lat, lng]);
        }
        
        if (!hasSetInitialView) {
            map.setView([lat, lng], 15);
            hasSetInitialView = true;
        }
        
        try {
            await apiCall(`/driver/${dId}/location`, 'POST', {lat, lng});
        } catch(e) {}
        
        simIndex += 2; // Move a bit faster through the coordinates array
    }, 1000);
}

async function drawMultiStopRoute(stops) {
    if (stops.length === 0) return;
    
    // Re-add current driver marker if exists
    if (marker) {
        marker.addTo(map);
    }
    
    // Draw markers
    stops.forEach((stop, idx) => {
        const isCurrent = idx === 0;
        const color = stop.type === 'pickup' ? '#f6ad55' : '#48bb78';
        const m = L.circleMarker([stop.lat, stop.lng], {color: color, radius: isCurrent ? 8 : 5, fillOpacity: 1}).addTo(map);
        
        let popupHtml = `<b>${stop.type === 'pickup' ? '📦 Pickup' : '📍 Drop'}</b><br>${stop.shipment.description}`;
        if (isCurrent) {
            if (stop.type === 'pickup') {
                 popupHtml += `<br><button style="margin-top:5px; background:var(--primary); color:white; border:none; padding:5px; border-radius:4px; cursor:pointer;" onclick="confirmPickup('${stop.shipment.id}')">Confirm Pickup</button>`;
            } else {
                 popupHtml += `<br><button style="margin-top:5px; background:var(--success); color:white; border:none; padding:5px; border-radius:4px; cursor:pointer;" onclick="confirmDelivery('${stop.shipment.id}', '${stop.shipment.delivery_otp}')">Confirm Drop (OTP)</button>`;
            }
        }
        m.bindPopup(popupHtml);
        if (isCurrent) m.openPopup();
    });
    
    // OSRM handles up to 100 coordinates
    let coordsString = stops.map(s => `${s.lng},${s.lat}`).join(';');
    if (marker) {
        coordsString = `${marker.getLatLng().lng},${marker.getLatLng().lat};` + coordsString;
    }
    
    try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`);
        const data = await res.json();
        if(data.routes && data.routes[0]) {
            routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            
            const chunkSize = Math.ceil(routeCoords.length / 5);
            for(let i=0; i<routeCoords.length; i+=chunkSize) {
                const chunk = routeCoords.slice(i, i+chunkSize+1);
                const rand = Math.random();
                let color = '#3182ce'; 
                if (rand > 0.9) color = '#ff4b4b'; 
                else if (rand > 0.7) color = '#f6ad55'; 
                
                L.polyline(chunk, {color: color, weight: 5, opacity: 0.7}).addTo(map);
            }
        }
    } catch(err) {}
}

async function confirmPickup(shipmentId) {
    openVerifyModal(shipmentId);
}

function showDynamicAlert(type, msg) {
    const banner = document.getElementById('instruction-banner');
    banner.innerText = msg;
    banner.style.display = 'block';
    if (type === 'weather') banner.style.background = 'linear-gradient(90deg, #3182ce, #2b6cb0)';
    if (type === 'fatigue') banner.style.background = 'linear-gradient(90deg, #e53e3e, #c53030)';
    if (type === 'traffic') banner.style.background = 'linear-gradient(90deg, #f6ad55, #ed8936)';
}

async function confirmDelivery(shipmentId, correctOtp) {
    const inputOtp = prompt("Enter 4-digit Delivery OTP given to customer:");
    if (!inputOtp) return;
    
    if (inputOtp === correctOtp || inputOtp === '1234') { // Allow 1234 as master bypass for demo
        try {
            await apiCall(`/shipments/${shipmentId}`, 'PUT', {status: 'delivered', stage: 'Completed'});
            showPopupAlert("Delivery Successful! Loading next destination...");
            
            // Clear old simulated movement
            routeCoords = [];
            simIndex = 0;
            
            await loadMissions();
            
        } catch(e) {
            alert("Failed to update status.");
        }
    } else {
        alert("Incorrect OTP! Please verify with customer.");
    }
}

function showPopupAlert(msg) {
    const container = document.getElementById('alert-container');
    const alertDiv = document.createElement('div');
    alertDiv.className = 'glass-card alert-popup';
    alertDiv.style.borderLeft = '4px solid var(--danger)';
    alertDiv.style.marginBottom = '10px';
    alertDiv.innerHTML = `
        <h4 style="color:var(--danger); margin-bottom:5px;">⚠️ Alert</h4>
        <p style="font-size:0.85rem">${msg}</p>
        <button class="btn-primary" style="margin-top:10px; padding: 5px;" onclick="this.parentElement.remove()">Acknowledge</button>
    `;
    container.appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), 10000);
}

function toggleFullscreen() {
    const mapDiv = document.getElementById('route-map');
    if (!document.fullscreenElement) {
        if (mapDiv.requestFullscreen) {
            mapDiv.requestFullscreen();
        } else if (mapDiv.webkitRequestFullscreen) { /* Safari */
            mapDiv.webkitRequestFullscreen();
        } else if (mapDiv.msRequestFullscreen) { /* IE11 */
            mapDiv.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { /* Safari */
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { /* IE11 */
            document.msExitFullscreen();
        }
    }
}

async function loadAlertsAndMessages() {
    try {
        const dId = localStorage.getItem('driver_id');
        const shipments = await apiCall(`/driver/${dId}/shipments`);
        const activeShipment = shipments.find(s => s.status === 'in_transit');
        
        if (activeShipment) {
            // Fetch real alerts for this shipment
            const data = await apiCall(`/tracking/${activeShipment.id}`);
            const banner = document.getElementById('instruction-banner');
            const weatherAlert = data.alerts.find(a => a.type === 'weather');
            
            if (weatherAlert) {
                banner.innerText = `⚠️ ${weatherAlert.description}. ${weatherAlert.suggestion}`;
                banner.style.display = 'block';
            } else if (activeShipment.is_perishable) {
                const v = activeShipment.vitality || 100;
                banner.innerHTML = `❄️ <b>Cold Chain Active:</b> Product Vitality at <b>${v.toFixed(0)}%</b>. Avoid delays.`;
                banner.style.background = v < 60 ? 'linear-gradient(90deg, #e53e3e, #c53030)' : 'linear-gradient(90deg, #3182ce, #2b6cb0)';
                banner.style.display = 'block';
            } else {
                banner.style.display = 'none';
            }
        }
        
        // Fetch Messages
        const msgs = await apiCall(`/tracking/messages/${dId}`);
        const container = document.getElementById('driver-messages');
        container.innerHTML = msgs.length === 0 ? '<p style="font-size:0.8rem; color:var(--text-muted)">No messages from manager.</p>' : msgs.map(m => `
            <div style="margin-bottom:8px; padding:8px; background:${m.sender_type==='driver'?'rgba(49, 130, 206, 0.1)':'rgba(72, 187, 120, 0.1)'}; border-radius:6px; border-left:3px solid ${m.sender_type==='driver'?'var(--primary)':'var(--success)'}">
                <div style="font-size:0.7rem; color:var(--text-muted);">${m.sender_type==='manager'?'Manager':'You'} - ${new Date(m.created_at).toLocaleTimeString()}</div>
                <div style="font-size:0.85rem;">${m.content}</div>
            </div>
        `).join('');
        container.scrollTop = container.scrollHeight;
        
    } catch(e) {}
}

async function sendMessageToManager() {
    const content = document.getElementById('manager-msg-content').value;
    if (!content) return;
    
    const dId = localStorage.getItem('driver_id');
    const shipments = await apiCall(`/driver/${dId}/shipments`);
    const activeShipment = shipments.find(s => s.status === 'in_transit' || s.status === 'assigned');
    
    try {
        await apiCall('/tracking/messages', 'POST', {
            shipment_id: activeShipment ? activeShipment.id : null,
            sender_id: dId,
            receiver_id: 'manager', // In a multi-company app this would be specific
            content: content,
            sender_type: 'driver'
        });
        document.getElementById('manager-msg-content').value = '';
        loadAlertsAndMessages();
    } catch(e) {
        alert("Failed to send message.");
    }
}

// Polling for updates
setInterval(loadAlertsAndMessages, 5000);

async function loadProfileData() {
    const dId = localStorage.getItem('driver_id');
    const data = await apiCall(`/manager/drivers/${dId}/profile`);
    const p = data.profile;
    
    document.getElementById('p-name').innerText = p.name || "Driver";
    document.getElementById('p-login').innerText = `@${p.login_id || 'user'}`;
    document.getElementById('p-trips').innerText = p.total_trips || 0;
    document.getElementById('p-safety').innerText = `${(p.safety_index || 100).toFixed(1)}%`;
    document.getElementById('p-punct').innerText = `${(p.punctuality_rate || 100).toFixed(1)}%`;
    
    const avgRating = (p.customer_ratings && p.customer_ratings.length > 0) ? (p.customer_ratings.reduce((a,b)=>a+b,0)/p.customer_ratings.length).toFixed(1) : "5.0";
    document.getElementById('p-rating').innerText = `${avgRating} ⭐`;
    document.getElementById('p-wallet').innerText = `${p.reward_points || 0}`;
    
    // Health Card Population
    if (p.health_metrics) {
        document.getElementById('h-rate').innerText = `${p.health_metrics.heart_rate} BPM`;
        document.getElementById('h-bp').innerText = p.health_metrics.blood_pressure;
        document.getElementById('h-o2').innerText = `${p.health_metrics.oxygen}%`;
        document.getElementById('h-stress').innerText = p.health_metrics.stress_index;
        
        const hStatus = document.getElementById('h-status');
        if (p.health_metrics.stress_index > 80 || p.health_metrics.heart_rate > 120) {
            hStatus.innerText = "REST REQUIRED";
            hStatus.style.background = "var(--danger)";
        } else {
            hStatus.innerText = "FIT TO DRIVE";
            hStatus.style.background = "var(--success)";
        }
    }

    const fBar = document.getElementById('p-fatigue-bar');
    fBar.style.width = `${p.fatigue_score}%`;
    fBar.style.background = p.fatigue_score > 80 ? 'var(--danger)' : p.fatigue_score > 50 ? 'var(--warning)' : 'var(--primary)';
    
    if (p.profile_pic) {
        document.getElementById('profile-img').src = p.profile_pic;
    } else {
        document.getElementById('profile-img').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.name}`;
    }
}

async function uploadProfilePic() {
    const file = document.getElementById('profile-upload').files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const dId = localStorage.getItem('driver_id');
        // Re-use vehicle verification endpoint for image upload or create new
        // For demo, we'll just convert to base64 and update driver profile
        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result;
            await apiCall(`/manager/drivers/${dId}`, 'PUT', { profile_pic: base64 });
            loadProfileData();
        };
        reader.readAsDataURL(file);
    } catch(e) {
        alert("Upload failed");
    }
}

async function startRest() {
    const dId = localStorage.getItem('driver_id');
    if (confirm("Starting a rest period will reduce your fatigue level. Ready to clock out for a break?")) {
        await submitIncident('resting');
        alert("Rest period logged. Your fatigue level has been reduced.");
        loadProfileData();
    }
}

function logout() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    localStorage.clear();
    window.location.href = '../index.html';
}

window.onload = loadMissions;

async function scanCargo(shipmentId) {
    const fileInput = document.getElementById(`scan-file-${shipmentId}`);
    if (!fileInput) return;
    const file = fileInput.files[0];
    if (!file) return;

    const resDiv = document.getElementById(`scan-result-${shipmentId}`);
    const scanBtn = document.getElementById(`scan-btn-${shipmentId}`);
    const pickupBtn = document.getElementById(`pickup-btn-${shipmentId}`);
    
    resDiv.innerText = "Analyzing cargo image...";
    resDiv.style.color = "var(--text-muted)";
    scanBtn.style.display = "none";
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch(`${API_BASE}/driver/${localStorage.getItem('driver_id')}/scan-cargo/${shipmentId}`, {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        
        if (data.status === 'pass') {
            resDiv.innerText = "✅ Quality Verified. Safe to pickup.";
            resDiv.style.color = "var(--success)";
            pickupBtn.style.display = "inline-block";
        } else {
            resDiv.innerText = "❌ Damage Detected: " + data.message;
            resDiv.style.color = "var(--danger)";
            setTimeout(loadMissions, 2000);
        }
    } catch(err) {
        resDiv.innerText = "Error scanning image.";
        resDiv.style.color = "var(--danger)";
        scanBtn.style.display = "inline-block";
    }
}

function openIncidentModal() {
    document.getElementById('incident-modal').style.display = 'block';
}

async function submitIncident(type, fromStationary = false) {
    if (fromStationary) document.getElementById('stationary-modal').style.display = 'none';
    else document.getElementById('incident-modal').style.display = 'none';
    
    // Get current location if available
    let lat = null;
    let lng = null;
    if (navigator.geolocation) {
        const pos = await new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(resolve, () => resolve(null));
        });
        if (pos) {
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
        }
    }

    try {
        const dId = localStorage.getItem('driver_id');
        await apiCall(`/driver/${dId}/incident`, 'POST', {
            type: type,
            description: `Driver reported a ${type} issue.`,
            lat: lat,
            lng: lng
        });
        alert(`🚨 Incident reported: ${type.toUpperCase()}. Manager has been notified.`);
        loadMissions();
        loadProfileData();
    } catch(err) {
        alert("Failed to report incident.");
    }
}

async function requestSensorPermission() {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        // iOS 13+ requires explicit permission
        try {
            const permissionState = await DeviceMotionEvent.requestPermission();
            if (permissionState === 'granted') {
                window.addEventListener('devicemotion', handleMotion);
                document.getElementById('sensor-btn').innerText = "🛡️ Safety Active";
                document.getElementById('sensor-btn').style.background = "var(--success)";
                alert("Safety Sensors Calibrated & Active.");
            }
        } catch (error) {
            console.error(error);
            alert("Sensor access denied. Safety monitoring disabled.");
        }
    } else {
        // Android / Desktop non-standard
        window.addEventListener('devicemotion', handleMotion);
        document.getElementById('sensor-btn').innerText = "🛡️ Safety Active";
        document.getElementById('sensor-btn').style.background = "var(--success)";
        alert("Safety Sensors Active.");
    }
}

function handleMotion(event) {
    if (isZenMode) return;
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;
    
    const force = Math.sqrt(acc.x*acc.x + acc.y*acc.y + acc.z*acc.z);
    
    // Erratic detection (Sudden Braking / Swerving)
    if (force > motionThreshold && (Date.now() - lastMotionAlert > 5000)) {
        console.log("Erratic driving detected! Force:", force);
        lastMotionAlert = Date.now();
        triggerZenMode("erratic_driving");
    }
}

// ZEN MODE & MOTION DETECTION
// Initial check (Android often doesn't need click, but we added button for safety)
if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission !== 'function') {
    window.addEventListener('devicemotion', handleMotion);
}

async function triggerZenMode(reason) {
    if (isZenMode) return;
    isZenMode = true;
    
    const overlay = document.getElementById('zen-overlay');
    overlay.style.display = 'flex';
    
    // Get current loc for rest stop search
    const pos = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(resolve, () => resolve({coords:{latitude:20.59, longitude:78.96}}));
    });
    
    try {
        const stops = await apiCall(`/driver/safety/rest-stops?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
        const bestStop = stops[0]; // Nearest high rated
        
        document.getElementById('zen-rest-stop-name').innerText = `Nearest: ${bestStop.name} (${bestStop.rating}⭐)`;
        document.getElementById('zen-rest-stop-amenities').innerText = `Facilities: ${bestStop.amenities.join(", ")}`;
        
        // Notify Backend
        await apiCall(`/driver/${localStorage.getItem('driver_id')}/zen`, 'POST', {
            is_active: true,
            reason: reason,
            destination: bestStop
        });
        
        // Update mission roadmap temporarily (visual only for now)
        const banner = document.getElementById('instruction-banner');
        banner.innerHTML = `🧘 <b>Zen Mode Active:</b> Safety reroute to ${bestStop.name}. Take a break.`;
        banner.style.background = 'linear-gradient(90deg, #6b46c1, #553c9a)';
        banner.style.display = 'block';
        
    } catch(e) {
        console.error("Zen Mode error:", e);
    }
}

async function deactivateZen() {
    isZenMode = false;
    document.getElementById('zen-overlay').style.display = 'none';
    await apiCall(`/driver/${localStorage.getItem('driver_id')}/zen`, 'POST', { is_active: false });
    loadMissions();
}

async function confirmArrival() {
    alert("Safety rest logged. Fatigue score will be reduced. Take your time.");
    await submitIncident('resting');
    deactivateZen();
}

// Predictive Fatigue check
setInterval(async () => {
    const dId = localStorage.getItem('driver_id');
    const drivers = await apiCall('/manager/drivers');
    const me = drivers.find(d => d.id === dId);
    if (me && me.fatigue_score > 90 && !isZenMode) {
        triggerZenMode("extreme_fatigue");
    }
}, 10000);

async function openLoadingOptimizer(shipmentId) {
    document.getElementById('loader-modal').style.display = 'flex';
    document.getElementById('loader-step-1').style.display = 'block';
    document.getElementById('loader-result').style.display = 'none';
}

async function analyzeLoading() {
    const fileInput = document.getElementById('vehicle-photo');
    if (!fileInput.files[0]) {
        alert("Please take a photo of the vehicle cargo area first.");
        return;
    }

    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = "🌀 AI Calculating Space...";
    btn.disabled = true;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const res = await fetch(`${API_BASE_URL}/driver/${localStorage.getItem('driver_id')}/optimize-loading`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        
        btn.innerText = originalText;
        btn.disabled = false;

        if (data.status === 'success') {
            document.getElementById('loader-step-1').style.display = 'none';
            document.getElementById('loader-result').style.display = 'block';
            
            const blueprintContainer = document.getElementById('stacking-blueprint');
            blueprintContainer.innerHTML = data.blueprint.map(b => `
                <div style="margin-bottom:15px; background:rgba(255,255,255,0.03); padding:10px; border-radius:8px; border-left:3px solid var(--primary);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.7rem; color:var(--accent); font-weight:bold;">LAYER ${b.layer}</span>
                        <span style="font-size:0.7rem; color:var(--text-muted);">${b.position}</span>
                    </div>
                    <div style="margin:5px 0; font-size:0.9rem; font-weight:bold;">${b.items.join(", ")}</div>
                    <p style="font-size:0.75rem; color:var(--text-muted); margin:0;">${b.instruction}</p>
                </div>
            `).join('');
        }
    } catch(e) {
        alert("Spatial analysis failed. Please try again.");
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

let html5QrScanner = null;
let currentVerifyId = null;
let qrVerified = false;

async function openVerifyModal(shipmentId) {
    currentVerifyId = shipmentId;
    qrVerified = false;
    document.getElementById('verify-modal').style.display = 'block';
    document.getElementById('qr-success-msg').style.display = 'none';
    document.getElementById('btn-submit-verify').disabled = true;
    
    // Fetch shipment to get qr_code_data
    const shipments = await apiCall(`/shipments?company_id=${localStorage.getItem('manager_id') || ''}`); // Driver context
    const s = shipments.find(item => item.id === shipmentId);
    if (!s) return;

    if (!html5QrScanner) {
        html5QrScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 });
    }
    
    html5QrScanner.render((decodedText) => {
        if (decodedText === s.qr_code_data) {
            qrVerified = true;
            document.getElementById('qr-success-msg').style.display = 'block';
            document.getElementById('btn-submit-verify').disabled = false;
            html5QrScanner.clear();
        } else {
            alert("QR Code Mismatch! Please scan the correct package.");
        }
    }, (err) => {
        // console.error(err);
    });
}

function closeVerifyModal() {
    if (html5QrScanner) html5QrScanner.clear();
    document.getElementById('verify-modal').style.display = 'none';
}

async function submitVerification() {
    if (!qrVerified) return alert("QR verification required");
    
    const fileInput = document.getElementById('v-photo');
    if (!fileInput.files || !fileInput.files[0]) return alert("Please upload a photo of the shipment");
    
    const photoUrl = await uploadFile(fileInput.files[0]);
    if (!photoUrl) return alert("Photo upload failed");
    
    try {
        // We update status and add log with photo
        await apiCall(`/shipments/${currentVerifyId}`, 'PUT', {
            status: 'in_transit', 
            stage: 'Picked Up',
            log_entry: {
                status: 'in_transit',
                message: `📦 PICKUP VERIFIED: QR scanned and photo uploaded by driver.`,
                photo_url: photoUrl
            }
        });
        
        closeVerifyModal();
        showPopupAlert("Verification Successful! Package Picked Up.");
        loadMissions();
    } catch(e) {
        alert("Failed to complete pickup.");
    }
}

async function uploadFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}
