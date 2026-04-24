// Manager Dashboard Logic

// Auth Check
if (!localStorage.getItem('manager_id')) {
    window.location.href = '../index.html';
}

document.getElementById('welcome-msg').innerText = `Dashboard - ${localStorage.getItem('manager_name')}`;

let map;
let weatherMap;
let markers = [];
let weatherMarkers = [];

function initMap() {
    // Default to a central location (e.g., India center)
    map = L.map('map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Map click to add warehouse
    map.on('click', async function(e) {
        const name = prompt("Enter Warehouse Name:");
        if (name) {
            try {
                await apiCall('/manager/warehouses', 'POST', {
                    name: name,
                    lat: e.latlng.lat,
                    lng: e.latlng.lng
                });
                loadMapData();
            } catch (err) {}
        }
    });
    
    loadMapData();
}

async function loadMapData() {
    // Clear markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    try {
        const warehouses = await apiCall('/manager/warehouses');
        warehouses.forEach(w => {
            const m = L.marker([w.lat, w.lng], {title: w.name}).addTo(map)
                .bindPopup(`<b>Warehouse:</b> ${w.name}`);
            markers.push(m);
        });

        // Populate base warehouse dropdowns
        const dBase = document.getElementById('d-base');
        const vBase = document.getElementById('v-base');
        if (dBase && vBase && warehouses.length > 0) {
            dBase.innerHTML = '<option value="">Select Base Warehouse</option>';
            vBase.innerHTML = '<option value="">Select Base Warehouse</option>';
            warehouses.forEach(w => {
                dBase.innerHTML += `<option value="${w.id}">${w.name}</option>`;
                vBase.innerHTML += `<option value="${w.id}">${w.name}</option>`;
            });
        }

        const shipments = await apiCall('/shipments/');
        for (const s of shipments) {
            if (s.current_location) {
                // Moving shipment marker
                const m = L.circleMarker([s.current_location.lat, s.current_location.lng], {
                    color: '#00f2fe', radius: 6, fillOpacity: 1
                }).addTo(map).bindPopup(`Shipment: ${s.id.slice(0,6)}...<br>Status: ${s.status}`);
                markers.push(m);
            } else if (s.status === 'pending' || s.status === 'assigned') {
                 // Pickup location marker
                 const m = L.circleMarker([s.pickup.lat, s.pickup.lng], {
                    color: '#f6ad55', radius: 5, fillOpacity: 1
                }).addTo(map).bindPopup(`Pickup: ${s.id.slice(0,6)}...`);
                markers.push(m);
            }
            
            // Draw route with traffic simulation if active or assigned
            if (s.status !== 'delivered') {
                await drawRouteWithTraffic(
                    s.current_location ? s.current_location : s.pickup, 
                    s.drop
                );
            }
        }
    } catch(e) {}
}

async function drawRouteWithTraffic(start, end) {
    try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
        const data = await res.json();
        if(data.routes && data.routes[0]) {
            const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); // Leaflet uses Lat,Lng
            
            // Chunk the coordinates to simulate traffic segments
            const chunkSize = Math.ceil(coords.length / 5);
            for(let i=0; i<coords.length; i+=chunkSize) {
                const chunk = coords.slice(i, i+chunkSize+1);
                // Randomly assign traffic color: 70% Green, 20% Orange, 10% Red
                const rand = Math.random();
                let color = '#48bb78'; // Green
                if (rand > 0.9) color = '#ff4b4b'; // Red
                else if (rand > 0.7) color = '#f6ad55'; // Orange
                
                const pline = L.polyline(chunk, {color: color, weight: 5, opacity: 0.7}).addTo(map);
                markers.push(pline); // Push to markers array so it gets cleared on refresh
            }
        }
    } catch(err) {
        console.error("OSRM Route Failed", err);
    }
}

function showSection(sectionId) {
    document.querySelectorAll('.section-content').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(sectionId).style.display = 'block';
    if(typeof event !== 'undefined' && event && event.target) {
        event.target.classList.add('active');
    }
    
    if (sectionId === 'overview') {
        setTimeout(() => {
            if(map) map.invalidateSize(true);
        }, 300);
        loadMapData();
        loadInsights();
    } else if (sectionId === 'shipments') {
        loadShipments();
    } else if (sectionId === 'weather') {
        setTimeout(initWeatherMap, 300);
    } else if (sectionId === 'messages') {
        loadMessages();
    } else if (sectionId === 'leaderboard') {
        loadLeaderboard();
    } else if (sectionId === 'drivers' || sectionId === 'verifications') {
        loadDriversAndVehicles();
    } else if (sectionId === 'ledger') {
        loadLedger();
    }
}

function logout() {
    localStorage.clear();
    window.location.href = '../index.html';
}

async function loadInsights() {
    try {
        const container = document.getElementById('alerts-container');
        const alerts = await apiCall('/tracking/alerts/active');
        
        if (alerts.length === 0) {
            container.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted);">No active system alerts.</p>`;
            return;
        }

        container.innerHTML = alerts.map(a => `
            <div style="background: rgba(255, 255, 255, 0.05); border-left: 3px solid ${a.severity==='critical'?'var(--danger)':'var(--warning)'}; padding: 10px; margin-bottom: 10px; border-radius: 4px;">
                <p style="margin:0; font-size: 0.9rem;"><strong>${a.type.toUpperCase()}:</strong> ${a.description}<br>
                <em style="color:var(--accent)">Suggestion: ${a.suggestion}</em></p>
                <button class="btn-primary" style="padding:2px 8px; font-size:0.7rem; margin-top:5px;" onclick="resolveAlert('${a.id}')">Resolve</button>
            </div>
        `).join('');
    } catch(e) {}
}

async function resolveAlert(id) {
    // In a real app we'd mark it resolved in DB. For demo we'll just mock it.
    alert("Alert Resolved");
    loadInsights();
}

// Shipments
document.getElementById('create-shipment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const [plat, plng] = document.getElementById('pickup-loc').value.split(',').map(n => parseFloat(n.trim()));
    const [dlat, dlng] = document.getElementById('drop-loc').value.split(',').map(n => parseFloat(n.trim()));
    
    const data = {
        pickup: {lat: plat, lng: plng},
        drop: {lat: dlat, lng: dlng},
        weight: parseFloat(document.getElementById('weight').value),
        description: document.getElementById('description').value
    };
    
    try {
        await apiCall('/shipments/', 'POST', data);
        alert('Shipment Created!');
        document.getElementById('create-shipment-form').reset();
        loadShipments();
    } catch(e) {}
});

// Shipments Table Rendering
let globalShipments = [];
let globalDrivers = [];
let globalVehicles = [];

async function loadShipments() {
    try {
        const [shipments, drivers, vehicles] = await Promise.all([
            apiCall('/shipments/'),
            apiCall('/manager/drivers'),
            apiCall('/manager/vehicles')
        ]);
        globalShipments = shipments;
        globalDrivers = drivers;
        globalVehicles = vehicles;
        
        applyShipmentFilters();
    } catch(e) {
        console.error("Failed to load shipments:", e);
    }
}

function applyShipmentFilters() {
    const searchTerm = (document.getElementById('shipment-search')?.value || '').toLowerCase();
    const sortMode = document.getElementById('shipment-sort')?.value || 'newest';
    
    let parents = globalShipments.filter(s => !s.is_leg);
    const legs = globalShipments.filter(s => s.is_leg);
    
    // Apply search filter
    if (searchTerm) {
        parents = parents.filter(s => 
            s.id.toLowerCase().includes(searchTerm) || 
            s.description.toLowerCase().includes(searchTerm)
        );
    }
    
    // Apply sorting
    parents.sort((a, b) => {
        if (sortMode === 'newest') {
            return new Date(b.created_at) - new Date(a.created_at);
        } else if (sortMode === 'oldest') {
            return new Date(a.created_at) - new Date(b.created_at);
        } else if (sortMode === 'eta') {
            const etaA = a.expected_delivery ? new Date(a.expected_delivery).getTime() : Infinity;
            const etaB = b.expected_delivery ? new Date(b.expected_delivery).getTime() : Infinity;
            return etaA - etaB;
        } else if (sortMode === 'status') {
            return a.status.localeCompare(b.status);
        }
        return 0;
    });
    
    renderShipmentsTable(parents, legs, globalDrivers, globalVehicles);
}

function renderShipmentsTable(parents, legs, drivers, vehicles) {
    const tbody = document.getElementById('shipments-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    parents.forEach(s => {
        try {
            const tr = document.createElement('tr');
            const d = drivers.find(drv => drv.id === s.assigned_driver_id);
            const v = vehicles.find(vh => vh.id === s.assigned_vehicle_id);
            
            const driverName = d ? d.name : 'Unassigned';
            const vehiclePlate = v ? v.number_plate : '';
            
            let fatigueClass = 'low-fatigue';
            if (d && d.fatigue_score > 80) fatigueClass = 'high-fatigue';
            else if (d && d.fatigue_score > 50) fatigueClass = 'mid-fatigue';

            const driverHtml = d ? `
                <div class="driver-name-hover" style="position:relative; cursor:pointer; color:var(--primary); font-weight:600;" onclick="viewFullProfile('driver', '${d.id}')">
                    ${driverName} ${vehiclePlate ? `<small style="color:var(--text-muted)">[${vehiclePlate}]</small>` : ''}
                    <div class="hover-card ${fatigueClass}">
                        <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
                            <img src="${d.profile_pic || `https://api.dicebear.com/7.x/avataaars/svg?seed=${d.name}`}" style="width:40px; height:40px; border-radius:50%;">
                            <div>
                                <div style="font-size:0.9rem; color:white;">${d.name}</div>
                                <div style="font-size:0.7rem; color:var(--text-muted);">Exp: ${d.years_experience || 1.2} years</div>
                                <div style="font-size:0.7rem; color:var(--warning);">Rating: ${((d.customer_ratings && d.customer_ratings.length) ? (d.customer_ratings.reduce((a,b)=>a+b,0)/d.customer_ratings.length).toFixed(1) : 5.0)}⭐</div>
                            </div>
                        </div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">
                            Trips: ${d.total_trips || 0} | Score: ${d.driving_score || 100}%
                        </div>
                        <div style="margin-top:8px;">
                            <small>Fatigue: ${(d.fatigue_score || 0).toFixed(0)}%</small>
                            <div style="width:100%; height:4px; background:rgba(255,255,255,0.1); border-radius:2px;">
                                <div style="width:${d.fatigue_score}%; height:100%; background:${d.fatigue_score > 80 ? 'var(--danger)' : 'var(--warning)'};"></div>
                            </div>
                        </div>
                        <div style="margin-top:10px; font-size:0.7rem; color:var(--accent);">Click for full profile →</div>
                    </div>
                </div>
            ` : 'Unassigned';

            let actionHtml = '';
            if (s.status === 'split') {
                actionHtml = `<small style="color:var(--warning)">Route Split</small>`;
            } else if (s.status === 'pending') {
                actionHtml = `
                    <div style="display:flex; gap:5px; margin-bottom:4px;">
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.8rem;" onclick="autoAssign('${s.id}')">Auto Assign</button>
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.8rem; background:var(--secondary);" onclick="openManualAssign('${s.id}')">👨‍✈️ Manual</button>
                    </div>
                `;
            } else {
                actionHtml = `<div style="display:flex; align-items:center; gap:5px; font-size:0.8rem;"><span style="color:var(--success)">Assigned:</span> ${driverHtml}</div><small>${s.stage}</small>`;
            }

            // Performance Tracking Logic
            let rowClass = '';
            let statusTooltip = 'On Schedule';
            let performanceMsg = '';
            
            if (s.performance_stats) {
                const ps = s.performance_stats;
                if (ps.status === 'delayed') {
                    rowClass = 'status-delayed';
                    performanceMsg = `<br><span style="color:var(--danger); font-weight:bold; font-size:0.75rem;">⚠️ Delay: ${ps.diff_mins}m</span>`;
                    statusTooltip = `🔴 Delayed by ${ps.diff_mins} mins. Remaining: ${ps.dist_remaining_km}km. Weather: ${ps.weather}`;
                } else if (ps.status === 'early') {
                    rowClass = 'status-early';
                    performanceMsg = `<br><span style="color:var(--success); font-weight:bold; font-size:0.75rem;">⚡ Early: ${Math.abs(ps.diff_mins)}m</span>`;
                    statusTooltip = `🟢 Tracking early by ${Math.abs(ps.diff_mins)} mins. Remaining: ${ps.dist_remaining_km}km. Weather: ${ps.weather}`;
                } else {
                    rowClass = 'status-ontime';
                    performanceMsg = `<br><span style="color:var(--accent); font-size:0.75rem;">✅ On Track</span>`;
                    statusTooltip = `🔵 On Schedule. Remaining: ${ps.dist_remaining_km}km. Weather: ${ps.weather}`;
                }
            } else {
                const now = new Date();
                const deadline = new Date(s.status === 'pending' || s.status === 'assigned' ? s.pickup_deadline : s.expected_delivery);
                const diffMins = Math.round((now - deadline) / (1000 * 60));
                if (diffMins > 0 && s.status !== 'delivered') {
                    rowClass = 'status-delayed';
                    performanceMsg = `<br><span style="color:var(--danger); font-weight:bold; font-size:0.75rem;">⏰ Overdue: ${diffMins}m</span>`;
                    statusTooltip = `🔴 Shipment is ${diffMins}m past its deadline.`;
                }
            }

            // Leg Information Summary
            const isLeg = s.is_leg;
            const legInfoTag = isLeg ? `<span style="color:var(--accent); font-weight:bold;">[Leg ${s.leg_order}]</span> ` : '';
            
            let legSummary = '';
            if (s.route_type === 'multi-leg' && !isLeg) {
                const sLegs = legs.filter(l => l.parent_id === s.id).sort((a,b) => a.leg_order - b.leg_order);
                if (sLegs.length > 0) {
                    legSummary = `<div style="margin-top:8px; display:flex; gap:3px;">`;
                    sLegs.forEach(l => {
                        let dotColor = '#a0aec0';
                        if (l.status === 'delivered') dotColor = 'var(--success)';
                        else if (l.status === 'in_transit') dotColor = (l.performance_stats && l.performance_stats.status === 'delayed') ? 'var(--danger)' : 'var(--primary)';
                        else if (l.status === 'assigned') dotColor = 'var(--warning)';
                        legSummary += `<div title="Leg ${l.leg_order}: ${l.status}" style="width:12px; height:12px; border-radius:50%; background:${dotColor}; border:1px solid rgba(255,255,255,0.2);"></div>`;
                    });
                    legSummary += `</div>`;
                    const delayedLeg = sLegs.find(l => l.performance_stats && l.performance_stats.status === 'delayed');
                    if (delayedLeg) performanceMsg = `<br><span style="color:var(--danger); font-size:0.7rem;">⚠️ Delay in Leg ${delayedLeg.leg_order}</span>`;
                }
            }

            tr.className = rowClass;
            const etaFormatted = s.expected_delivery ? new Date(s.expected_delivery).toLocaleString() : 'N/A';

            tr.innerHTML = `
                <td><strong>${legInfoTag}${s.description}</strong><br><small>ID: ${s.id.substring(0,8)} ${isLeg && s.parent_id ? `(Part of ${s.parent_id.substring(0,6)})` : ''}</small>${legSummary}</td>
                <td class="table-status-cell">
                    <span class="badge" style="background: ${s.status==='delivered'?'var(--success)':'rgba(255,255,255,0.1)'}">${s.status}</span>
                    <div class="table-hover-card">
                        <strong>Status Detail</strong><br>
                        <span style="font-size:0.85rem; color:var(--text-muted);">${statusTooltip}</span>
                    </div>
                </td>
                <td>
                    <div style="font-size:0.85rem;">${s.route_type || 'direct'}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:5px;">Sch: ${etaFormatted}${performanceMsg}</div>
                </td>
                <td>
                    ${actionHtml}
                    <button style="background:none; border:none; cursor:pointer; font-size:1rem; margin-left:10px;" onclick="openTrackModal('${s.id}')" title="Live Track">📍</button>
                    <button style="background:none; border:none; cursor:pointer; font-size:1.1rem; margin-left:5px;" onclick="openMessageModal('${s.id}', '${s.assigned_driver_id}')" title="Message Driver">💬</button>
                    <button style="background:none; border:none; cursor:pointer; font-size:1rem; margin-left:5px;" onclick="openLogsModal('${s.id}')" title="View Logs">📜</button>
                </td>
            `;
            tbody.appendChild(tr);

            // If split, also render child legs indented below
            if (s.status === 'split' && !isLeg) {
                const childLegs = legs.filter(l => l.parent_id === s.id).sort((a,b) => a.leg_order - b.leg_order);
                childLegs.forEach(leg => {
                    const legTr = document.createElement('tr');
                    legTr.style.background = 'rgba(255,255,255,0.02)';
                    const legEta = leg.expected_delivery ? new Date(leg.expected_delivery).toLocaleString() : 'N/A';
                    
                    legTr.innerHTML = `
                        <td style="padding-left:30px;">↳ Leg ${leg.leg_order}: ${leg.description}</td>
                        <td><span class="badge" style="background: rgba(255,255,255,0.1); font-size:0.7rem;">${leg.status}</span></td>
                        <td><div style="font-size:0.7rem; color:var(--text-muted);">Sch: ${legEta}</div></td>
                        <td>
                            <button style="background:none; border:none; cursor:pointer; font-size:1rem;" onclick="openTrackModal('${leg.id}')">📍</button>
                        </td>
                    `;
                    tbody.appendChild(legTr);
                });
            }
        } catch (err) {
            console.error("Error rendering shipment row:", err, s);
        }
    });
}

async function optimizeFleet() {
    try {
        const res = await apiCall('/shipments/consolidate', 'POST');
        alert(res.message);
        loadShipments();
    } catch(e) {
        alert("Consolidation failed.");
    }
}

async function autoSplit(id) {
    try {
        const res = await apiCall(`/shipments/${id}/split/auto`, 'POST');
        alert(res.message);
        loadShipments();
    } catch(e) {}
}

async function openManualSplit(id) {
    currentSplitId = id;
    try {
        const warehouses = await apiCall('/manager/warehouses');
        const container = document.getElementById('split-wh-container');
        container.innerHTML = '';
        warehouses.forEach(w => {
            container.innerHTML += `
                <label style="display:block; margin-bottom:5px;">
                    <input type="checkbox" value="${w.id}" class="wh-checkbox"> ${w.name}
                </label>
            `;
        });
        document.getElementById('split-modal').style.display = 'block';
    } catch(e) {}
}

async function submitManualSplit() {
    const checkboxes = document.querySelectorAll('.wh-checkbox:checked');
    const warehouse_ids = Array.from(checkboxes).map(c => c.value);
    
    if (warehouse_ids.length === 0) {
        alert("Please select at least one warehouse.");
        return;
    }
    
    try {
        const res = await apiCall(`/shipments/${currentSplitId}/split/manual`, 'POST', { warehouse_ids });
        alert(res.message);
        document.getElementById('split-modal').style.display = 'none';
        loadShipments();
    } catch(e) {}
}

async function autoAssign(id) {
    try {
        await apiCall(`/shipments/${id}/auto-assign`, 'POST');
        alert("Assigned Successfully");
        loadShipments();
    } catch(e) {}
}

async function openManualAssign(id) {
    currentAssignId = id;
    try {
        const drivers = await apiCall('/manager/drivers');
        // Only show verified drivers who have an assigned vehicle
        const available = drivers.filter(d => d.verification_status === 'verified' && d.assigned_vehicle_id);
        
        const select = document.getElementById('assign-driver-select');
        select.innerHTML = '<option value="">Select a Driver</option>';
        available.forEach(d => {
            select.innerHTML += `<option value="${d.id}">${d.name} (${d.license_type})</option>`;
        });
        
        document.getElementById('assign-modal').style.display = 'block';
    } catch(e) {}
}

async function submitManualAssign() {
    const driverId = document.getElementById('assign-driver-select').value;
    if (!driverId) {
        alert("Please select a driver");
        return;
    }
    
    try {
        // Need to get the driver's vehicle ID for the manual assign API
        const drivers = await apiCall('/manager/drivers');
        const driver = drivers.find(d => d.id === driverId);
        if (!driver || !driver.assigned_vehicle_id) {
            alert("Driver missing assigned vehicle");
            return;
        }
        
        const res = await apiCall(`/shipments/${currentAssignId}/assign?driver_id=${driverId}&vehicle_id=${driver.assigned_vehicle_id}`, 'POST');
        alert(res.message);
        document.getElementById('assign-modal').style.display = 'none';
        loadShipments();
    } catch(e) {}
}

async function bulkAssign() {
    if (!confirm("Are you sure you want to auto-assign all pending shipments?")) return;
    try {
        const res = await apiCall(`/shipments/bulk-assign`, 'POST');
        alert(res.message);
        loadShipments();
    } catch(e) {}
}

let trackMap;
let trackMarkers = [];

async function openTrackModal(shipmentId) {
    document.getElementById('track-shipment-id').innerText = shipmentId.substring(0,8);
    document.getElementById('track-modal').style.display = 'block';
    
    if (!trackMap) {
        trackMap = L.map('track-map').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(trackMap);
    }
    
    // Invalidate size in case modal was hidden
    setTimeout(() => { if (trackMap) trackMap.invalidateSize(true); }, 200);
    
    // Clear old markers/routes
    trackMarkers.forEach(m => trackMap.removeLayer(m));
    trackMarkers = [];
    
    document.getElementById('track-status').innerText = 'Loading...';
    document.getElementById('track-current').innerText = '...';
    document.getElementById('track-next').innerText = '...';
    
    try {
        const shipments = await apiCall('/shipments/');
        const target = shipments.find(s => s.id === shipmentId);
        if (!target) return;
        
        let activeLeg = target;
        let routeSegments = [];
        let finalDrop = target.drop;
        
        // If it's a split parent, gather legs (or if it IS a leg, track the parent flow)
        let parentId = target.is_leg ? target.parent_id : target.id;
        const legs = shipments.filter(s => s.parent_id === parentId).sort((a,b) => a.leg_order - b.leg_order);
        
        if (legs.length > 0) {
            routeSegments = legs;
            activeLeg = legs.find(l => l.status !== 'delivered') || legs[legs.length - 1];
            finalDrop = legs[legs.length - 1].drop;
        } else {
            routeSegments = [target];
        }
        
        document.getElementById('track-status').innerText = target.status.toUpperCase();
        
        if (target.status === 'delivered' || (legs.length > 0 && legs[legs.length-1].status === 'delivered')) {
            document.getElementById('track-status').innerText = 'DELIVERED';
            document.getElementById('track-current').innerText = 'Delivery Completed';
            document.getElementById('track-next').innerText = 'None';
            
            const m = L.marker([finalDrop.lat, finalDrop.lng]).addTo(trackMap).bindPopup("Final Destination (Delivered)");
            trackMarkers.push(m);
            trackMap.setView([finalDrop.lat, finalDrop.lng], 13);
            return;
        }
        
        let curLocStr = "Waiting for GPS...";
        if (activeLeg.current_location) {
            curLocStr = `${activeLeg.current_location.lat.toFixed(4)}, ${activeLeg.current_location.lng.toFixed(4)}`;
            const curMarker = L.circleMarker([activeLeg.current_location.lat, activeLeg.current_location.lng], {
                color: '#00f2fe', radius: 8, fillOpacity: 1
            }).addTo(trackMap).bindPopup("Current Location");
            trackMarkers.push(curMarker);
            trackMap.setView([activeLeg.current_location.lat, activeLeg.current_location.lng], 10);
        } else {
            trackMap.setView([activeLeg.pickup.lat, activeLeg.pickup.lng], 10);
        }
        
        document.getElementById('track-current').innerText = curLocStr;
        document.getElementById('track-next').innerText = activeLeg.drop.address || `Lat: ${activeLeg.drop.lat.toFixed(4)}, Lng: ${activeLeg.drop.lng.toFixed(4)}`;
        
        for (const seg of routeSegments) {
            const start = seg.pickup;
            const end = seg.drop;
            
            const startMarker = L.circleMarker([start.lat, start.lng], {color: '#f6ad55', radius: 5, fillOpacity: 1}).addTo(trackMap);
            const endMarker = L.circleMarker([end.lat, end.lng], {color: '#48bb78', radius: 5, fillOpacity: 1}).addTo(trackMap);
            trackMarkers.push(startMarker, endMarker);
            
            try {
                const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
                const data = await res.json();
                if(data.routes && data.routes[0]) {
                    const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                    let color = '#3182ce'; // Blue
                    if (seg.status === 'delivered') color = '#a0aec0'; // Grey out completed portions
                    const pline = L.polyline(coords, {color: color, weight: 4, opacity: 0.8}).addTo(trackMap);
                    trackMarkers.push(pline);
                }
            } catch(e) {}
        }
        
    } catch(err) {
        console.error("Track Modal Error:", err);
    }
}

// Drivers & Vehicles
document.getElementById('add-driver-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await apiCall('/manager/drivers', 'POST', {
            name: document.getElementById('d-name').value,
            login_id: document.getElementById('d-login').value,
            password: document.getElementById('d-pass').value,
            license_type: document.getElementById('d-license').value,
            base_warehouse_id: document.getElementById('d-base').value,
            years_experience: parseFloat(document.getElementById('d-exp').value || 0),
            past_accidents: parseInt(document.getElementById('d-accidents').value || 0),
            traffic_violations: parseInt(document.getElementById('d-challans').value || 0),
            challan_count: parseInt(document.getElementById('d-challans').value || 0),
            driving_score: Math.floor(Math.random() * 20) + 80, // Mock 80-100 score
            safety_rating: (Math.random() * 2 + 3).toFixed(1), // Mock 3.0-5.0
            on_time_rate: Math.floor(Math.random() * 20) + 80 // Mock 80-100%
        });
        document.getElementById('add-driver-form').reset();
        loadDriversAndVehicles();
    } catch(e) {}
});

document.getElementById('add-vehicle-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await apiCall('/manager/vehicles', 'POST', {
            type: document.getElementById('v-type').value,
            number_plate: document.getElementById('v-plate').value,
            capacity: parseFloat(document.getElementById('v-cap').value),
            speed: 60,
            fuel_efficiency: parseFloat(document.getElementById('v-eff').value),
            base_warehouse_id: document.getElementById('v-base').value,
            vehicle_health_score: Math.floor(Math.random() * 30) + 70 // Mock 70-100 score
        });
        document.getElementById('add-vehicle-form').reset();
        loadDriversAndVehicles();
    } catch(e) {}
});

document.getElementById('link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dId = document.getElementById('link-driver').value;
    const vId = document.getElementById('link-vehicle').value;
    if (!dId || !vId) return alert("Select both driver and vehicle");
    
    try {
        await apiCall(`/manager/link-vehicle?driver_id=${dId}&vehicle_id=${vId}`, 'POST');
        alert("Linked successfully!");
        loadDriversAndVehicles();
    } catch(e) {}
});

async function loadDriversAndVehicles() {
    try {
        const drivers = await apiCall('/manager/drivers');
        const dtbody = document.getElementById('drivers-table-body');
        const dSelect = document.getElementById('link-driver');
        dtbody.innerHTML = '';
        dSelect.innerHTML = '<option value="">Select Driver</option>';
        
        drivers.forEach(d => {
            dtbody.innerHTML += `<tr>
                <td>${d.name} <br><small>${d.login_id}</small></td>
                <td><span class="badge" style="background:rgba(255,255,255,0.1)">${d.license_type}</span><br><small>OT: ${d.on_time_rate || 100}%</small></td>
                <td>${d.driving_score.toFixed(1)}/100<br><small>Safety: ${d.safety_rating || 5.0}⭐</small></td>
                <td><span style="color:${d.challan_count > 0 ? 'var(--danger)' : 'var(--success)'}">${d.challan_count}</span></td>
                <td><strong style="color:var(--accent)">₹${d.reward_points || 0}</strong></td>
                <td>
                    ${d.assigned_vehicle_id ? `<small>Linked</small>` : `<small style="color:var(--warning)">Unlinked</small>`}
                    <button style="background:none; border:none; cursor:pointer; font-size:1rem; margin-left:10px;" onclick="openEditModal('drivers', '${d.id}', '${d.name}', '${d.license_type}')" title="Edit">✏️</button>
                </td>
            </tr>`;
            dSelect.innerHTML += `<option value="${d.id}">${d.name} (${d.license_type})</option>`;
        });
        
        const vehicles = await apiCall('/manager/vehicles');
        const vtbody = document.getElementById('vehicles-table-body');
        const vSelect = document.getElementById('link-vehicle');
        vtbody.innerHTML = '';
        vSelect.innerHTML = '<option value="">Select Vehicle</option>';
        
        vehicles.forEach(v => {
            let healthColor = v.vehicle_health_score > 80 ? 'var(--success)' : (v.vehicle_health_score > 60 ? 'var(--warning)' : 'var(--danger)');
            vtbody.innerHTML += `<tr>
                <td><span class="badge" style="background:rgba(255,255,255,0.1)">${v.type}</span></td>
                <td>${v.number_plate || '<span style="color:var(--text-muted)">Not Set</span>'}</td>
                <td><span style="color:${healthColor}; font-weight:bold;">${v.vehicle_health_score || 100}%</span></td>
                <td>${v.capacity}kg</td>
                <td>
                    ${v.assigned_driver_id ? `<small>Linked</small>` : `<small style="color:var(--warning)">Unlinked</small>`}
                    <button style="background:none; border:none; cursor:pointer; font-size:1rem; margin-left:10px;" onclick="openEditModal('vehicles', '${v.id}', '${v.number_plate || ''}', '${v.capacity}')" title="Edit">✏️</button>
                </td>
            </tr>`;
            vSelect.innerHTML += `<option value="${v.id}">${v.type} - ${v.number_plate} (${v.capacity}kg)</option>`;
        });
        
        // Verifications Table
        const verifTbody = document.getElementById('verifications-table-body');
        verifTbody.innerHTML = '';
        let verifCount = 0;
        
        drivers.forEach(d => {
            if (d.verification_status === "pending_manual") {
                verifCount++;
                const v = vehicles.find(vh => vh.id === d.assigned_vehicle_id);
                const plate = v ? v.number_plate : 'Unknown';
                
                verifTbody.innerHTML += `<tr>
                    <td>${d.name}</td>
                    <td>${plate}</td>
                    <td><img src="http://localhost:8000/images/${d.verification_image}" style="max-height:60px; border-radius:4px;"></td>
                    <td>
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.8rem; background:var(--success)" onclick="manualVerify('${d.id}', 'verified')">Approve</button>
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.8rem; background:var(--danger)" onclick="manualVerify('${d.id}', 'unverified')">Reject</button>
                    </td>
                </tr>`;
            }
        });
        
        const badge = document.getElementById('verif-badge');
        if (verifCount > 0) {
            badge.style.display = 'inline-block';
            badge.innerText = verifCount;
        } else {
            badge.style.display = 'none';
        }
    } catch(e) {}
}

async function manualVerify(driverId, status) {
    try {
        await apiCall(`/manager/verify-driver/${driverId}?status=${status}`, 'POST');
        loadDriversAndVehicles();
    } catch (e) {}
}

// Generic Edit Modal Logic
let currentEditType = null;
let currentEditId = null;
let currentSplitId = null;
let currentAssignId = null;

window.openEditModal = function(type, id, val1, val2) {
    currentEditType = type;
    currentEditId = id;
    document.getElementById('edit-type').innerText = type.charAt(0).toUpperCase() + type.slice(1);
    
    let html = '';
    if (type === 'shipments') {
        html = `<input type="text" id="edit-val1" value="${val1}" placeholder="Description" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px; margin-bottom:10px;">
                <input type="text" id="edit-val2" value="${val2}" placeholder="Status" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px;">`;
    } else if (type === 'drivers') {
        html = `<input type="text" id="edit-val1" value="${val1}" placeholder="Name" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px; margin-bottom:10px;">
                <input type="text" id="edit-val2" value="${val2}" placeholder="License Type" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px;">`;
    } else if (type === 'vehicles') {
        html = `<input type="text" id="edit-val1" value="${val1}" placeholder="Number Plate" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px; margin-bottom:10px;">
                <input type="number" id="edit-val2" value="${val2}" placeholder="Capacity" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px;">`;
    }
    document.getElementById('edit-fields').innerHTML = html;
    document.getElementById('edit-modal').style.display = 'block';
};

document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val1 = document.getElementById('edit-val1').value;
    const val2 = document.getElementById('edit-val2').value;
    
    let payload = {};
    let endpoint = `/${currentEditType}/${currentEditId}`;
    
    if (currentEditType === 'shipments') {
        payload = {description: val1, status: val2};
    } else if (currentEditType === 'drivers') {
        payload = {name: val1, license_type: val2};
        endpoint = `/manager/drivers/${currentEditId}`;
    } else if (currentEditType === 'vehicles') {
        payload = {number_plate: val1, capacity: parseFloat(val2)};
        endpoint = `/manager/vehicles/${currentEditId}`;
    }
    
    try {
        await apiCall(endpoint, 'PUT', payload);
        alert(`Successfully updated!`);
        document.getElementById('edit-modal').style.display = 'none';
        
        if (currentEditType === 'shipments') loadShipments();
        else loadDriversAndVehicles();
    } catch(err) {
        alert("Failed to update.");
    }
});

// Alerts Mocking
function simulateAlert() {
    // In a real app this would poll. We just show a mockup toast
    const container = document.getElementById('alert-container');
    const alertDiv = document.createElement('div');
    alertDiv.className = 'glass-card alert-popup';
    alertDiv.style.borderLeft = '4px solid var(--danger)';
    alertDiv.innerHTML = `
        <h4 style="color:var(--danger); margin-bottom:5px;">⚠️ Critical Alert</h4>
        <p style="font-size:0.85rem">Weather warning on active route.</p>
        <button class="btn-primary" style="margin-top:10px; padding: 5px;" onclick="this.parentElement.remove()">Acknowledge</button>
    `;
    container.appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), 10000);
}

async function updateDynamicEta(sid) {
    try {
        const data = await apiCall(`/tracking/${sid}`);
        const el = document.getElementById(`eta-${sid}`);
        if (el && data.dynamic_eta) {
            const deta = data.dynamic_eta;
            el.innerHTML = `
                <span style="color:var(--accent)">${deta.weather_icon} ${deta.weather}</span><br>
                <span style="font-weight:bold; color:var(--warning)">Adjusted: ${deta.adjusted_mins}m</span><br>
                <small>(+${deta.delay_mins}m AI penalty)</small>
            `;
        }
    } catch(e) {}
}

let drawControl;
let drawnItems;
let baseLayers;

function initWeatherMap() {
    if (weatherMap) {
        weatherMap.remove();
    }
    
    // Define Map Layers
    const standard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    const terrain = L.tileLayer('https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}{r}.png', {
        attribution: 'Map tiles by Stamen Design'
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    });
    
    baseLayers = {
        "standard": standard,
        "terrain": terrain,
        "satellite": satellite
    };

    weatherMap = L.map('weather-map', {
        layers: [standard]
    }).setView([20.5937, 78.9629], 5);
    
    // Initialize Draw FeatureGroup
    drawnItems = new L.FeatureGroup();
    weatherMap.addLayer(drawnItems);
    
    // Setup Draw Control but don't add it globally visible
    drawControl = new L.Control.Draw({
        edit: { featureGroup: drawnItems },
        draw: {
            polygon: false,
            rectangle: false,
            marker: false,
            circlemarker: false,
            circle: true,
            polyline: true
        }
    });

    weatherMap.on(L.Draw.Event.CREATED, function (e) {
        const type = e.layerType;
        const layer = e.layer;
        drawnItems.addLayer(layer);
        
        handleCustomDisaster(type, layer);
    });
    
    // Add real-time precipitation radar via RainViewer
    fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then(res => res.json())
        .then(data => {
            const past = data.radar.past;
            if (past && past.length > 0) {
                const latest = past[past.length - 1].path;
                L.tileLayer(`https://tilecache.rainviewer.com${latest}/256/{z}/{x}/{y}/2/1_1.png`, {
                    opacity: 0.6,
                    zIndex: 10
                }).addTo(weatherMap);
            }
        })
        .catch(e => console.log("Radar not loaded", e));

    loadWeatherFleetData();
    setInterval(loadWeatherFleetData, 10000); // Update every 10s
}

function changeMapLayer() {
    const layerType = document.getElementById('map-layer').value;
    // Remove existing layers
    Object.values(baseLayers).forEach(layer => weatherMap.removeLayer(layer));
    // Add selected layer
    baseLayers[layerType].addTo(weatherMap);
}

let currentDrawHandler = null;
function toggleDrawMode() {
    const type = document.getElementById('disaster-type').value;
    if (currentDrawHandler) {
        currentDrawHandler.disable();
    }
    
    if (type === 'cyclone' || type === 'flood') {
        currentDrawHandler = new L.Draw.Circle(weatherMap, drawControl.options.draw.circle);
    } else {
        currentDrawHandler = new L.Draw.Polyline(weatherMap, drawControl.options.draw.polyline);
    }
    currentDrawHandler.enable();
}

async function handleCustomDisaster(shapeType, layer) {
    const disasterType = document.getElementById('disaster-type').value;
    let payload = { type: disasterType, shapeType: shapeType };
    
    if (shapeType === 'circle') {
        payload.lat = layer.getLatLng().lat;
        payload.lng = layer.getLatLng().lng;
        payload.radius = layer.getRadius() / 1000; // convert meters to km
    } else if (shapeType === 'polyline') {
        payload.coordinates = layer.getLatLngs().map(ll => ({lat: ll.lat, lng: ll.lng}));
    }
    
    try {
        const res = await apiCall('/simulation/disaster/custom', 'POST', payload);
        
        // Show Simulation Panel
        const panel = document.getElementById('simulation-panel');
        document.getElementById('sim-affected-count').innerText = res.affected_count || 0;
        document.getElementById('sim-ai-recommendation').innerText = res.recommendation || "No action needed.";
        
        const listContainer = document.getElementById('sim-affected-list');
        if (res.affected_list && res.affected_list.length > 0) {
            listContainer.innerHTML = res.affected_list.map(s => `
                <div style="font-size:0.75rem; margin-bottom:10px; padding:8px; background:rgba(255,255,255,0.05); border-radius:4px; border-left:3px solid var(--warning);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <strong>${s.description}</strong>
                        <span style="color:var(--accent);">${s.id.substring(0,8)}</span>
                    </div>
                    <div style="margin:4px 0; color:var(--text-muted);">
                        Driver: ${s.driver_name} [${s.vehicle_plate}]
                    </div>
                    <div style="color:var(--success); font-weight:600;">AI Solution: ${s.ai_action}</div>
                    <div style="font-style:italic; font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${s.driver_instruction}</div>
                    <div style="margin-top:5px; display:flex; gap:5px;">
                        <button style="padding:2px 6px; font-size:0.7rem; background:var(--primary); border:none; color:white; border-radius:3px; cursor:pointer;" onclick="executeAIAction('${s.id}')">Apply AI Solution</button>
                        <button style="padding:2px 6px; font-size:0.7rem; background:rgba(255,255,255,0.1); border:1px solid white; color:white; border-radius:3px; cursor:pointer;" onclick="manualDivert('${s.id}')">Manual Divert</button>
                    </div>
                </div>
            `).join('');
        } else {
            listContainer.innerHTML = '<p style="color:var(--text-muted); font-size:0.75rem;">No active shipments in path.</p>';
        }
        
        panel.style.display = 'block';
        
        loadWeatherFleetData();
    } catch(err) {
        alert("Failed to create custom disaster.");
    }
}

function applySimulationFixes() {
    alert("Executing AI contingency protocols for all affected shipments. Rerouting in progress...");
    document.getElementById('simulation-panel').style.display = 'none';
}

function executeAIAction(shipmentId) {
    alert(`AI contingecy applied for shipment ${shipmentId.substring(0,8)}. Diverting via OSRM bypass.`);
}

function manualDivert(shipmentId) {
    const reason = prompt("Enter custom diversion reason:");
    if (reason) alert(`Manual diversion logged for ${shipmentId.substring(0,8)}: ${reason}`);
}

async function clearDisasters() {
    try {
        await apiCall('/simulation/disaster/clear', 'POST');
        drawnItems.clearLayers();
        loadWeatherFleetData();
        loadShipments(); // Reload shipments to reflect reverted logs
        document.getElementById('simulation-panel').style.display = 'none';
    } catch(err) {
        alert("Failed to clear disasters.");
    }
}

async function stopSimulation(simId) {
    try {
        await apiCall(`/simulation/disaster/${simId}`, 'DELETE');
        loadWeatherFleetData();
        loadShipments();
        alert("Simulation stopped. Impact reverted.");
    } catch(err) {
        alert("Failed to stop simulation.");
    }
}

async function dispatchRescueVehicle() {
    const shipmentId = document.getElementById('logs-shipment-id').innerText;
    if(!shipmentId) return;
    
    document.getElementById('rescue-btn').innerText = "Assigning Rescue...";
    document.getElementById('rescue-btn').disabled = true;
    
    try {
        const res = await apiCall(`/shipments/${shipmentId}/rescue`, 'POST');
        alert("Rescue vehicle dispatched successfully! " + (res.message || ""));
        document.getElementById('logs-modal').style.display = 'none';
        loadShipments();
    } catch (err) {
        alert("Failed to dispatch rescue vehicle. Ensure idle vehicles are available.");
    } finally {
        document.getElementById('rescue-btn').innerText = "🚨 Dispatch Rescue Vehicle";
        document.getElementById('rescue-btn').disabled = false;
    }
}

async function loadWeatherFleetData() {
    try {
        const data = await apiCall('/tracking/fleet/weather');
        
        // Clear old markers
        weatherMarkers.forEach(m => weatherMap.removeLayer(m));
        weatherMarkers = [];
        
        // Render Active Simulations Table
        const simsTable = document.getElementById('sims-table');
        const simsBody = document.getElementById('sims-body');
        const emptyMsg = document.getElementById('sims-empty-msg');
        const activeSims = data.cells.filter(c => c.is_simulation);
        
        if (activeSims.length > 0) {
            simsTable.style.display = 'table';
            emptyMsg.style.display = 'none';
            simsBody.innerHTML = activeSims.map(c => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:5px 0;">${c.type.toUpperCase()}</td>
                    <td>${c.shapeType}</td>
                    <td><button style="background:var(--danger); border:none; color:white; padding:2px 8px; border-radius:4px; cursor:pointer; font-size:0.7rem;" onclick="stopSimulation('${c.id}')">STOP</button></td>
                </tr>
            `).join('');
        } else {
            simsTable.style.display = 'none';
            emptyMsg.style.display = 'block';
        }
        
        // Draw Weather Cells
        data.cells.forEach(cell => {
            let animClass = '';
            let type = (cell.type || '').toLowerCase();
            if (type === 'cyclone') animClass = 'anim-cyclone';
            else if (type === 'flood') animClass = 'anim-flood';
            else if (type === 'blockade') animClass = 'anim-blockade';
            else animClass = 'anim-rain';
            
            if (cell.shapeType === 'polyline') {
                // Polylines don't support divIcon natively without plugins, so we draw an animated line using SVG
                const polyline = L.polyline(cell.coordinates, {
                    color: '#dd6b20', weight: 8, opacity: 0.8, className: 'anim-blockade'
                }).addTo(weatherMap).bindPopup(`<b>${cell.type} System</b>`);
                weatherMarkers.push(polyline);
            } else {
                // Standard circle radius conversion to bounds
                const radiusMeters = (cell.radius || 50) * 1000;
                // Calculate rough size in pixels (Leaflet doesn't natively support divIcon with geographic radius, so we approximate or just use a fixed size divIcon that looks massive, or use SVG circle)
                // Actually, L.circle has a className option!
                const circle = L.circle([cell.lat, cell.lng], {
                    color: 'transparent',
                    fillColor: 'transparent',
                    radius: radiusMeters,
                    className: animClass
                }).addTo(weatherMap).bindPopup(`<b>${cell.type || cell.condition} System</b>`);
                weatherMarkers.push(circle);
            }
        });
        
        // Plot Fleet
        data.fleet.forEach(v => {
            const icon = L.divIcon({
                html: `<div style="background:var(--primary); width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow: 0 0 10px var(--primary);"></div>`,
                className: 'fleet-dot'
            });
            const m = L.marker([v.lat, v.lng], {icon: icon}).addTo(weatherMap)
                .bindPopup(`
                    <b>Driver:</b> ${v.driver}<br>
                    <b>Local Weather:</b> ${v.weather.icon} ${v.weather.condition}<br>
                    <b>Fatigue:</b> ${v.fatigue}%
                `);
            weatherMarkers.push(m);
        });
        
    } catch(e) {
        console.error("Fleet fetch error", e);
    }
}

let activeMessageShipmentId = null;
let activeMessageDriverId = null;

async function openMessageModal(shipmentId, driverId) {
    if (!driverId) {
        alert("Shipment not assigned to any driver.");
        return;
    }
    activeMessageShipmentId = shipmentId;
    activeMessageDriverId = driverId;
    
    const drivers = await apiCall('/manager/drivers');
    const driver = drivers.find(d => d.id === driverId);
    document.getElementById('msg-driver-name').innerText = driver ? driver.name : 'Unknown';
    document.getElementById('message-modal').style.display = 'block';
}

async function submitMessage() {
    const content = document.getElementById('msg-content').value;
    if (!content) return;
    
    try {
        await apiCall('/tracking/messages', 'POST', {
            shipment_id: activeMessageShipmentId,
            sender_id: localStorage.getItem('manager_id'),
            receiver_id: activeMessageDriverId,
            content: content,
            sender_type: 'manager'
        });
        document.getElementById('message-modal').style.display = 'none';
        document.getElementById('msg-content').value = '';
        alert("Message sent!");
    } catch(e) {
        alert("Failed to send message.");
    }
}

async function loadMessages() {
    try {
        const msgs = await apiCall(`/tracking/messages/${localStorage.getItem('manager_id')}`);
        const container = document.getElementById('messages-container');
        container.innerHTML = msgs.length === 0 ? '<p>No messages yet.</p>' : msgs.reverse().map(m => `
            <div style="margin-bottom:10px; padding:10px; background:${m.sender_type==='manager'?'rgba(49, 130, 206, 0.2)':'rgba(72, 187, 120, 0.2)'}; border-radius:8px; border-left:4px solid ${m.sender_type==='manager'?'var(--primary)':'var(--success)'}">
                <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:5px;">
                    <b>${m.sender_type==='manager'?'You':'Driver'}</b>
                    <span>${new Date(m.created_at).toLocaleString()}</span>
                </div>
                <p style="margin:0; font-size:0.9rem;">${m.content}</p>
            </div>
        `).join('');
    } catch(e) {}
}

async function loadLeaderboard() {
    const category = document.getElementById('leader-type').value;
    const sortSelect = document.getElementById('leader-sort');
    
    // Update sort options based on category
    if (category === 'vehicle' && !sortSelect.dataset.isVehicle) {
        sortSelect.innerHTML = `
            <option value="overall">General Ranking</option>
            <option value="vehicle_health_score">Health Score</option>
            <option value="fuel_efficiency">Fuel Efficiency</option>
        `;
        sortSelect.dataset.isVehicle = "true";
    } else if (category === 'driver' && sortSelect.dataset.isVehicle) {
        sortSelect.innerHTML = `
            <option value="overall">General Ranking</option>
            <option value="safety_index">Safety Index</option>
            <option value="punctuality_rate">Punctuality</option>
            <option value="rating">Customer Rating</option>
        `;
        sortSelect.removeAttribute('data-is-vehicle');
    }
    
    const sortBy = sortSelect.value;
    
    try {
        const data = await apiCall(`/manager/leaderboard?category=${category}&sort_by=${sortBy}`);
        const tbody = document.getElementById('leaderboard-body');
        
        tbody.innerHTML = data.map((item, index) => {
            let scoreVal = 0;
            if (category === 'driver') {
                scoreVal = sortBy === 'overall' ? (item.overall_score || 100) : (item[sortBy] !== undefined ? item[sortBy] : 100);
            } else {
                scoreVal = sortBy === 'overall' ? (item.efficiency_score || 100) : (item[sortBy] !== undefined ? item[sortBy] : 100);
            }
            // Format score correctly
            const displayScore = typeof scoreVal === 'number' ? scoreVal.toFixed(1) : scoreVal;

            return `
            <tr>
                <td>#${index + 1}</td>
                <td>
                    <div style="display:flex; gap:10px; align-items:center; cursor:pointer;" onclick="viewFullProfile('${category}', '${item.id}')">
                        <img src="${item.profile_pic || `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.name || item.number_plate}`}" style="width:30px; height:30px; border-radius:50%;">
                        <div>
                            <strong>${item.name || item.number_plate}</strong>
                            ${category === 'driver' ? `<br><small style="color:var(--text-muted)">Trips: ${item.total_trips}</small>` : ''}
                        </div>
                    </div>
                </td>
                <td><span style="color:var(--accent); font-weight:bold;">${displayScore}</span></td>
                <td><span class="badge" style="font-size:0.7rem;">${item.status}</span></td>
                <td><button class="btn-primary" style="padding:4px 8px; font-size:0.7rem;" onclick="viewFullProfile('${category}', '${item.id}')">View Profile</button></td>
            </tr>
            `;
        }).join('');
    } catch(e) {
        console.error("Leaderboard error:", e);
    }
}

async function viewFullProfile(type, id) {
    try {
        const data = await apiCall(`/manager/${type}s/${id}/profile`);
        const p = data.profile;
        const shipments = data.recent_shipments;
        
        const modal = document.getElementById('profile-modal');
        document.getElementById('prof-image').src = p.profile_pic || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.name || p.number_plate}`;
        document.getElementById('prof-name').innerText = p.name || p.number_plate;
        document.getElementById('prof-sub').innerText = type === 'driver' ? `@${p.login_id || 'user'} | ${(p.license_type || 'regular').toUpperCase()} License` : `${(p.type || 'vehicle').toUpperCase()} | Health: ${p.vehicle_health_score || 100}%`;
        
        if (type === 'driver') {
            document.getElementById('prof-stat-1').innerText = `${(p.safety_index || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-2').innerText = `${(p.punctuality_rate || 100).toFixed(1)}%`;
            
            let expMonths = 0;
            if (p.join_date) {
                expMonths = Math.floor((new Date() - new Date(p.join_date)) / (1000 * 60 * 60 * 24 * 30));
            }
            document.getElementById('prof-stat-3').innerText = `${expMonths || 0} months`;
            document.getElementById('prof-stat-4').innerText = `${p.total_trips || 0}`;
            
            let avgRating = 5.0;
            if (p.customer_ratings && p.customer_ratings.length > 0) {
                avgRating = p.customer_ratings.reduce((a,b)=>a+b,0) / p.customer_ratings.length;
            } else if (p.rating !== undefined) {
                avgRating = p.rating;
            }
            document.getElementById('prof-stat-5').innerText = `${avgRating.toFixed(1)}⭐`;
            document.getElementById('prof-stat-5').style.display = 'block';
            document.getElementById('prof-stat-6').innerText = `₹${p.reward_points || 0}`;
            
            document.getElementById('prof-meter-label').innerText = `Fatigue Level: ${(p.fatigue_score || 0).toFixed(0)}%`;
            const meter = document.getElementById('prof-meter-bar');
            meter.style.width = `${p.fatigue_score || 0}%`;
            meter.style.background = (p.fatigue_score || 0) > 80 ? 'var(--danger)' : 'var(--primary)';
        } else {
            document.getElementById('prof-stat-1').innerText = `${(p.efficiency_score || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-2').innerText = `${p.vehicle_health_score || 100}%`;
            document.getElementById('prof-stat-3').innerText = `${(p.total_distance_km || 0).toFixed(0)} km`;
            document.getElementById('prof-stat-4').innerText = 'Grade A';
            document.getElementById('prof-stat-5').innerText = ''; 
            document.getElementById('prof-stat-6').innerText = '';
            
            document.getElementById('prof-meter-label').innerText = `Fuel Efficiency Index`;
            document.getElementById('prof-meter-bar').style.width = '85%';
        }
        
        const tripsBody = document.getElementById('prof-trips-body');
        tripsBody.innerHTML = shipments.map(s => `
            <tr>
                <td>${s.id.substring(0,8)}</td>
                <td>${s.pickup.address.split(',')[0]} → ${s.drop.address.split(',')[0]}</td>
                <td>${new Date(s.created_at).toLocaleDateString()}</td>
                <td><span class="badge" style="font-size:0.7rem;">${s.status}</span></td>
            </tr>
        `).join('');
        
        modal.style.display = 'block';
    } catch(e) {
        console.error("Profile view error:", e);
        alert("Could not load full profile data.");
    }
}

// Init
window.onload = () => {
    initMap();
    loadInsights();
    setTimeout(() => {
        if(map) map.invalidateSize(true);
    }, 500);
};

async function openLogsModal(shipmentId) {
    document.getElementById('logs-modal').style.display = 'block';
    document.getElementById('logs-shipment-id').innerText = shipmentId;
    const timeline = document.getElementById('manager-timeline');
    timeline.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Loading logs...</p>';
    
    try {
        const data = await apiCall(`/tracking/${shipmentId}`);
        const shipment = data.shipment;
        
        // Setup Journey Review Button
        const btn = document.getElementById('view-review-btn');
        const revContainer = document.getElementById('review-container');
        revContainer.style.display = 'none'; // reset
        
        if (shipment.status === 'delivered') {
            btn.style.display = 'block';
            // Save shipmentId to button dataset for fetch
            btn.dataset.sid = shipmentId;
        } else {
            btn.style.display = 'none';
        }
        
        // Show Rescue Button if Breakdown
        const rescueContainer = document.getElementById('rescue-container');
        if (shipment.stage === 'Vehicle Breakdown') {
            rescueContainer.style.display = 'block';
        } else {
            rescueContainer.style.display = 'none';
        }
        
        if (shipment.logs && shipment.logs.length > 0) {
            const sortedLogs = [...shipment.logs].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
            timeline.innerHTML = sortedLogs.map(log => `
                <div class="timeline-event ${log.status === 'delivered' ? 'delivered' : ''}">
                    <div class="timeline-time">${new Date(log.timestamp).toLocaleString()}</div>
                    <div class="timeline-msg">${log.message}</div>
                    ${log.reason ? `<div class="timeline-reason">Reason: ${log.reason}</div>` : ''}
                </div>
            `).join('');
        } else {
            timeline.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">No history available.</p>';
        }
    } catch(err) {
        console.error(err);
        timeline.innerHTML = '<p style="color:var(--danger); font-size:0.85rem;">Failed to load logs.</p>';
    }
}

async function fetchJourneyReview() {
    const btn = document.getElementById('view-review-btn');
    const sid = btn.dataset.sid;
    const revContainer = document.getElementById('review-container');
    
    try {
        const review = await apiCall(`/manager/reviews/${sid}`);
        document.getElementById('rev-punct').innerText = `${review.punctuality_score}%`;
        document.getElementById('rev-safety').innerText = `${review.safety_score}%`;
        document.getElementById('rev-challan').innerText = `-${review.challan_penalty}`;
        document.getElementById('rev-total').innerText = `${review.total_score}%`;
        document.getElementById('rev-feedback').innerText = `"${review.feedback_message}"`;
        
        revContainer.style.display = 'block';
        btn.style.display = 'none'; // Hide button after showing
    } catch(err) {
        alert("Scorecard not available yet or error fetching.");
    }
}
async function loadLedger() {
    const tbody = document.getElementById('ledger-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading Blockchain Ledger...</td></tr>';
    
    try {
        const txs = await apiCall('/manager/ledger');
        if (txs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No Smart Contract transactions found.</td></tr>';
            return;
        }
        
        txs.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        tbody.innerHTML = txs.map(tx => `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:10px; color:#00f2fe; font-family:monospace; font-size:0.8rem;">${tx.tx_hash}</td>
                <td style="padding:10px; font-size:0.8rem;">${new Date(tx.timestamp).toLocaleString()}</td>
                <td style="padding:10px;">${tx.shipment_id.substring(0,8)}</td>
                <td style="padding:10px;">${tx.to_address.substring(0,8)}...</td>
                <td style="padding:10px; color:var(--success); font-weight:bold;">🏆 ${tx.points_awarded}</td>
            </tr>
        `).join('');
    } catch(err) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--danger);">Error loading ledger.</td></tr>';
    }
}

async function triggerDisaster(type, lat, lng) {
    try {
        const payload = {
            type: type,
            lat: lat,
            lng: lng,
            radius: 150
        };
        const res = await apiCall('/simulation/disaster', 'POST', payload);
        alert(res.message);
        
        // Reload map and alerts immediately
        loadMapData();
        loadInsights();
        loadShipments();
    } catch(err) {
        alert("Failed to simulate disaster.");
    }
}
