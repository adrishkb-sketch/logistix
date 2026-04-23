// Driver Dashboard Logic

if (!localStorage.getItem('driver_id')) {
    window.location.href = '../index.html';
}

const dId = localStorage.getItem('driver_id');
document.getElementById('driver-name').innerText = `Hello, ${localStorage.getItem('driver_name')}`;

let currentMission = null;
let map;
let marker;
let watchId;
let routeCoords = [];
let simIndex = 0;
let hasSetInitialView = false;

function switchDriverTab(tab) {
    if (tab === 'active') {
        document.getElementById('active-tab').style.display = 'block';
        document.getElementById('completed-tab').style.display = 'none';
        document.getElementById('btn-tab-active').style.background = 'var(--primary)';
        document.getElementById('btn-tab-active').style.color = 'white';
        document.getElementById('btn-tab-completed').style.background = 'rgba(255,255,255,0.1)';
        document.getElementById('btn-tab-completed').style.color = 'var(--text-muted)';
        if (map) map.invalidateSize();
    } else {
        document.getElementById('active-tab').style.display = 'none';
        document.getElementById('completed-tab').style.display = 'block';
        document.getElementById('btn-tab-completed').style.background = 'var(--primary)';
        document.getElementById('btn-tab-completed').style.color = 'white';
        document.getElementById('btn-tab-active').style.background = 'rgba(255,255,255,0.1)';
        document.getElementById('btn-tab-active').style.color = 'var(--text-muted)';
    }
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
            return;
        }

        // TSP Route Optimization (Nearest Neighbor Heuristic)
        // Sort active shipments based on closest pickup to previous dropoff
        let unassigned = [...activeShipments];
        let optimizedRoute = [];
        let currentLocation = null; // In real life, use driver's GPS. Here we just pick the first in list.
        
        if (unassigned.length > 0) {
            currentLocation = unassigned[0].pickup;
        }
        
        while (unassigned.length > 0) {
            // Find closest pickup to current location
            let closestIdx = 0;
            let minDistance = Infinity;
            
            for (let i = 0; i < unassigned.length; i++) {
                const s = unassigned[i];
                // Simple Euclidean dist for heuristic sorting
                const dist = Math.sqrt(Math.pow(s.pickup.lat - currentLocation.lat, 2) + Math.pow(s.pickup.lng - currentLocation.lng, 2));
                if (dist < minDistance) {
                    minDistance = dist;
                    closestIdx = i;
                }
            }
            
            const nextShipment = unassigned.splice(closestIdx, 1)[0];
            optimizedRoute.push(nextShipment);
            currentLocation = nextShipment.drop; // Next step starts from this dropoff
        }
        
        // Take the first active shipment as current
        currentMission = optimizedRoute[0];
        
        // Hide start button if not verified
        let startBtnHtml = '';
        if (me && me.verification_status === "verified") {
            startBtnHtml = `
                <button id="start-btn" class="btn-primary" style="margin-top:20px;" onclick="startJourney()">🚀 Start Journey</button>
                <button id="deliver-btn" class="btn-primary" style="margin-top:10px; background:var(--success); display:none;" onclick="confirmDelivery('${currentMission.id}', '${currentMission.delivery_otp}')">✅ Confirm Delivery (OTP)</button>
            `;
        }
        
        // Render Itinerary
        let html = `<h3>Optimized Itinerary (${optimizedRoute.length} Stops)</h3>`;
        
        optimizedRoute.forEach((s, idx) => {
            const isCurrent = idx === 0;
            const isWarehouseHandoff = s.is_leg && s.drop.address;
            const dropTitle = isWarehouseHandoff ? `Warehouse Handoff: ${s.drop.address}` : 'Customer Delivery';
            
            const expectedTime = s.expected_delivery ? new Date(s.expected_delivery) : new Date();
            const windowStart = new Date(expectedTime.getTime() - 60*60000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            const windowEnd = expectedTime.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            
            html += `
                <div class="glass-card mission-card" style="${isCurrent ? 'border-left: 4px solid var(--accent);' : 'opacity: 0.7;'} margin-bottom:15px;">
                    <h4 style="margin-bottom:10px;">Stop ${idx + 1}: ${isCurrent ? '(Current)' : ''} ${s.description}</h4>
                    <p style="margin-bottom:5px;"><b>Shipment ID:</b> ${s.id.slice(0,8)}</p>
                    <p style="margin-bottom:5px; color:var(--warning); font-weight:bold;"><b>Schedule:</b> ${windowStart} - ${windowEnd}</p>
                    <p style="margin-bottom:5px;"><b>Type:</b> ${dropTitle}</p>
                    <p style="margin-bottom:5px;"><b>Labels:</b> ${(s.labels || []).join(', ') || 'Standard'}</p>
                    <div style="display:flex; justify-content:space-between; margin-top:10px;">
                        <div>
                            <small style="color:var(--text-muted)">Pickup</small>
                            <p>${s.pickup.lat.toFixed(4)}, ${s.pickup.lng.toFixed(4)}</p>
                        </div>
                        <div>
                            <small style="color:var(--text-muted)">Drop</small>
                            <p>${s.drop.lat.toFixed(4)}, ${s.drop.lng.toFixed(4)}</p>
                        </div>
                    </div>
                    ${isCurrent ? startBtnHtml : ''}
                </div>
            `;
        });
        
        container.innerHTML = html;
        
        // Auto-start next mission if requested
        if (autoStartNext && optimizedRoute.length > 0) {
            setTimeout(startJourney, 1000); // start the new journey automatically
        } else if (optimizedRoute.length === 0) {
            document.getElementById('route-map').style.display = 'none';
            document.getElementById('deliver-btn').style.display = 'none';
        }
    } catch(e) {}
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

async function startJourney() {
    document.getElementById('start-btn').disabled = true;
    document.getElementById('start-btn').innerText = 'Journey in Progress';
    document.getElementById('deliver-btn').style.display = 'block';
    document.getElementById('route-map').style.display = 'block';
    document.getElementById('fullscreen-btn').style.display = 'block';
    
    // Init map
    map = L.map('route-map').setView([currentMission.pickup.lat, currentMission.pickup.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    
    // Force resize since it was hidden
    setTimeout(() => { if (map) map.invalidateSize(true); }, 300);
    
    // Add Drop Marker
    L.marker([currentMission.drop.lat, currentMission.drop.lng], {title: 'Destination'}).addTo(map).bindPopup("Drop");

    // Draw route with traffic
    await drawRouteWithTraffic(currentMission.pickup, currentMission.drop);

    // Start GPS Tracking Simulation
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {enableHighAccuracy: true});
    } else {
        alert("Geolocation not supported.");
    }
}

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

async function drawRouteWithTraffic(start, end) {
    try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
        const data = await res.json();
        if(data.routes && data.routes[0]) {
            routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); // Leaflet uses Lat,Lng
            
            let hasTraffic = false;
            
            // Chunk the coordinates to simulate traffic segments
            const chunkSize = Math.ceil(routeCoords.length / 5);
            for(let i=0; i<routeCoords.length; i+=chunkSize) {
                const chunk = routeCoords.slice(i, i+chunkSize+1);
                // Randomly assign traffic color: 70% Green, 20% Orange, 10% Red
                const rand = Math.random();
                let color = '#48bb78'; // Green
                if (rand > 0.9) {
                    color = '#ff4b4b'; // Red
                    hasTraffic = true;
                }
                else if (rand > 0.7) color = '#f6ad55'; // Orange
                
                L.polyline(chunk, {color: color, weight: 5, opacity: 0.7}).addTo(map);
            }
            
            if (hasTraffic) {
                // Extend ETA by 30 mins
                let dt = new Date(currentMission.expected_delivery || new Date());
                dt.setMinutes(dt.getMinutes() + 30);
                const newExpected = dt.toISOString();
                
                try {
                    await apiCall(`/shipments/${currentMission.id}`, 'PUT', {expected_delivery: newExpected});
                    currentMission.expected_delivery = newExpected;
                    showDynamicAlert('traffic', "Heavy Traffic Detected! Redrawing route and extending deadline by 30 mins to ensure safety.");
                    
                    // Refresh the left panel itinerary to show new time
                    loadMissions(false); 
                } catch(e) {}
            }
            
            // Simulate random weather or fatigue alert after 8s
            setTimeout(() => {
                const r = Math.random();
                if (r < 0.3) showDynamicAlert('weather', '⚠️ Severe weather warning: Heavy rain ahead. Proceed slowly.');
                else if (r > 0.8) showDynamicAlert('fatigue', '⚠️ Fatigue Alert: You have been driving for over 4 hours. Please take a rest stop.');
            }, 8000);
        }
    } catch(err) {}
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
            
            // Clear current map tracking state
            if (map) {
                map.eachLayer((layer) => {
                    if (layer instanceof L.Polyline || layer instanceof L.Marker || layer instanceof L.CircleMarker) {
                        map.removeLayer(layer);
                    }
                });
            }
            marker = null;
            routeCoords = [];
            simIndex = 0;
            hasSetInitialView = false;
            
            // Load next missions and automatically start the next route
            await loadMissions(true);
            
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

function logout() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    localStorage.clear();
    window.location.href = '../index.html';
}

window.onload = loadMissions;
