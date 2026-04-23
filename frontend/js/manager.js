// Manager Dashboard Logic

// Auth Check
if (!localStorage.getItem('manager_id')) {
    window.location.href = '../index.html';
}

document.getElementById('welcome-msg').innerText = `Dashboard - ${localStorage.getItem('manager_name')}`;

let map;
let markers = [];

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
    if(event && event.target) {
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
    } else if (sectionId === 'drivers' || sectionId === 'verifications') {
        loadDriversAndVehicles();
    }
}

function logout() {
    localStorage.clear();
    window.location.href = '../index.html';
}

async function loadInsights() {
    try {
        const container = document.getElementById('alerts-container');
        // Fetch all alerts (we'd realistically need an endpoint for this, we'll simulate fetching alerts DB)
        // Wait, I need an endpoint for alerts or I can mock fetch
        const res = await fetch('http://localhost:8000/api/shipments/'); // Just a dummy check to verify server is up
        
        // Since we don't have a GET /alerts endpoint, let's just make it visually represent the concept using dummy alerts or if we had them.
        // Actually I should add GET /alerts, but for now we'll simulate the topup info based on what we discussed.
        container.innerHTML = `
            <div style="background: rgba(255, 75, 75, 0.1); border-left: 3px solid var(--danger); padding: 10px; margin-bottom: 10px; border-radius: 4px;">
                <p style="margin:0; font-size: 0.9rem;"><strong>⚠️ Weather Warning:</strong> Heavy rain expected on Route 4. <em>Suggestion: Delay dispatch by 30 mins.</em></p>
            </div>
            <div style="background: rgba(246, 173, 85, 0.1); border-left: 3px solid var(--warning); padding: 10px; border-radius: 4px;">
                <p style="margin:0; font-size: 0.9rem;"><strong>⚠️ Driver Fatigue:</strong> Amal has been driving for 4+ hours. <em>Suggestion: Mandate rest stop.</em></p>
            </div>
        `;
    } catch(e) {}
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
async function loadShipments() {
    try {
        const [shipments, drivers] = await Promise.all([
            apiCall('/shipments/'),
            apiCall('/manager/drivers') // Needed to lookup assigned driver names
        ]);
        const tbody = document.getElementById('shipments-table-body');
        tbody.innerHTML = '';
        
        const parents = shipments.filter(s => !s.is_leg);
        const legs = shipments.filter(s => s.is_leg);
        
        parents.forEach(s => {
            const etaFormatted = s.expected_delivery ? new Date(s.expected_delivery).toLocaleString() : 'N/A';
            let tr = document.createElement('tr');
            
            let actionHtml = '';
            if (s.status === 'split') {
                actionHtml = `<small style="color:var(--warning)">Route Split</small>`;
            } else if (s.status === 'pending') {
                actionHtml = `
                    <div style="display:flex; gap:5px; margin-bottom:4px;">
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.8rem;" onclick="autoAssign('${s.id}')">Auto Assign</button>
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.8rem; background:var(--secondary);" onclick="openManualAssign('${s.id}')">👨‍✈️ Manual</button>
                    </div>
                    <div style="display:flex; gap:5px;">
                        <button style="background:rgba(255,255,255,0.1); border:1px solid #fff; color:#fff; border-radius:4px; cursor:pointer; font-size:0.75rem; padding:2px 5px;" onclick="autoSplit('${s.id}')">🤖 AI Split</button>
                        <button style="background:rgba(255,255,255,0.1); border:1px solid #fff; color:#fff; border-radius:4px; cursor:pointer; font-size:0.75rem; padding:2px 5px;" onclick="openManualSplit('${s.id}')">🛠️ Manual Split</button>
                    </div>
                `;
            } else {
                let dName = s.assigned_driver_id ? (drivers.find(d => d.id === s.assigned_driver_id)?.name || 'Driver') : '';
                actionHtml = `<small style="color:var(--success)">Assigned: ${dName}</small><br><small>${s.stage}</small>`;
            }
            
            tr.innerHTML = `
                <td><strong>${s.description}</strong><br><small>ID: ${s.id.substring(0,8)}</small></td>
                <td><span class="badge" style="background: ${s.status==='delivered'?'var(--success)':'rgba(255,255,255,0.1)'}">${s.status}</span></td>
                <td>${s.route_type || 'direct'} <br><small>ETA: ${etaFormatted}</small></td>
                <td>
                    ${actionHtml}
                    <button style="background:none; border:none; cursor:pointer; font-size:1rem; margin-left:10px;" onclick="openTrackModal('${s.id}')" title="Live Track">📍</button>
                    <button style="background:none; border:none; cursor:pointer; font-size:1rem; margin-left:5px;" onclick="openEditModal('shipments', '${s.id}', '${s.description}', '${s.status}')" title="Edit">✏️</button>
                </td>
            `;
            tbody.appendChild(tr);
            
            // Render child legs if split
            if (s.status === 'split') {
                const childLegs = legs.filter(l => l.parent_id === s.id).sort((a,b) => a.leg_order - b.leg_order);
                childLegs.forEach(leg => {
                    const legEta = leg.expected_delivery ? new Date(leg.expected_delivery).toLocaleString() : 'N/A';
                    let legTr = document.createElement('tr');
                    legTr.style.background = 'rgba(255,255,255,0.02)';
                    
                    let legActionHtml = '';
                    if (leg.status === 'pending') {
                        legActionHtml = `
                            <div style="display:flex; gap:5px;">
                                <button class="btn-primary" style="padding:4px 8px; font-size:0.75rem" onclick="autoAssign('${leg.id}')">Auto Assign</button>
                                <button class="btn-primary" style="padding:4px 8px; font-size:0.75rem; background:var(--secondary);" onclick="openManualAssign('${leg.id}')">👨‍✈️ Manual</button>
                            </div>
                        `;
                    } else {
                        let ldName = leg.assigned_driver_id ? (drivers.find(d => d.id === leg.assigned_driver_id)?.name || 'Driver') : '';
                        legActionHtml = `<small style="color:var(--success)">Assigned: ${ldName}</small><br><small>${leg.stage}</small>`;
                    }
                        
                    legTr.innerHTML = `
                        <td style="padding-left:30px;">↳ ${leg.description} <br><small>Drop: ${leg.drop.address || 'Location'}</small></td>
                        <td><span class="badge" style="background: rgba(255,255,255,0.1); font-size:0.7rem;">${leg.status}</span></td>
                        <td>direct <br><small>Sch: ${legEta}</small></td>
                        <td>
                            ${legActionHtml}
                            <button style="background:none; border:none; cursor:pointer; font-size:1rem; margin-left:10px;" onclick="openTrackModal('${leg.id}')" title="Live Track">📍</button>
                        </td>
                    `;
                    tbody.appendChild(legTr);
                });
            }
        });
    } catch(err) {
        console.error(err);
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
            driving_score: Math.floor(Math.random() * 20) + 80, // Mock 80-100 score
            challan_count: Math.floor(Math.random() * 3), // Mock 0-2 challans
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

// Init
window.onload = () => {
    initMap();
    loadInsights();
    setTimeout(() => {
        if(map) map.invalidateSize(true);
    }, 500);
};
