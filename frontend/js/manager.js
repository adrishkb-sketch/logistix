// Manager Dashboard Logic

// Auth Check
if (!localStorage.getItem('manager_id')) {
    window.location.href = '../index.html';
}

document.getElementById('welcome-msg').innerText = `Dashboard - ${localStorage.getItem('manager_name')}`;

let map, fleetMap;
let markers = [];
let volumeChart, fleetChart;
let weatherMap;
let weatherMarkers = [];

function initMap() {
    // Default to a central location (e.g., India center)
    map = L.map('map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Apply Official Indian Boundaries (SOI Compliant Overlay)
    applyOfficialBorders(map);

    // Map click to add warehouse
    map.on('click', async function(e) {
        const { lat, lng } = e.latlng;
        
        // WATER CHECK: Hardened detection for Oceans and Seas
        try {
            const terrain = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`).then(r => r.json());
            const dName = (terrain.display_name || "").toLowerCase();
            const isWater = terrain.type === 'water' || 
                            terrain.type === 'river' ||
                            terrain.category === 'natural' || 
                            dName.includes('ocean') || 
                            dName.includes('sea') || 
                            dName.includes('bay') ||
                            dName.includes('river') ||
                            dName.includes('canal') ||
                            dName.includes('waterway') ||
                            !terrain.address; // Deep ocean has no address object

            if (isWater) {
                return alert("🚨 Invalid Deployment Zone: Warehouse cannot be created in the middle of a water body.");
            }
        } catch(e) {
            console.warn("Terrain check skipped due to API timeout");
        }

        pendingWhLoc = { lat, lng };
        
        // AI Check
        try {
            const res = await apiCall(`/manager/warehouses/suggest`, 'POST', {
                lat, lng, 
                company_id: localStorage.getItem('manager_id')
            });
            if (res.strategic_improvement || res.distance_km) {
                suggestedWhLoc = { lat: res.suggested_lat, lng: res.suggested_lng };
                document.getElementById('sug-dist').innerText = `${res.distance_km} km`;
                document.getElementById('sug-reason').innerText = res.reason;
                document.getElementById('suggestion-modal').style.display = 'block';
            } else {
                openWhModal(lat, lng);
            }
        } catch(err) {
            openWhModal(lat, lng);
        }
    });
    
    loadMapData();
}

async function applyOfficialBorders(mapInstance) {
    const boundaryUrl = 'https://raw.githubusercontent.com/datameet/maps/master/Country/india-osm.geojson';
    try {
        const response = await fetch(boundaryUrl);
        const data = await response.json();
        L.geoJSON(data, {
            style: { 
                color: '#3182ce', 
                weight: 3, 
                fillOpacity: 0,
                dashArray: '5, 5'
            },
            interactive: false
        }).addTo(mapInstance);
    } catch(e) {
        console.warn("Sovereignty overlay failed to load");
    }
}

async function confirmSuggestedLocation() {
    const wh = window.pendingWh;
    if (!wh) return;
    await saveWarehouse(wh.name, wh.suggested_lat, wh.suggested_lng);
    document.getElementById('suggestion-modal').style.display = 'none';
}

async function stayWithManualLocation() {
    const wh = window.pendingWh;
    if (!wh) return;
    await saveWarehouse(wh.name, wh.manual_lat, wh.manual_lng);
    document.getElementById('suggestion-modal').style.display = 'none';
}

async function saveWarehouse(name, lat, lng) {
    try {
        await apiCall('/manager/warehouses', 'POST', {
            company_id: localStorage.getItem('manager_id'),
            name: name,
            lat: lat,
            lng: lng
        });
        loadMapData();
        alert(`Warehouse "${name}" deployed successfully!`);
    } catch (err) {
        alert("Failed to deploy warehouse.");
    }
}

async function deleteWarehouse(id) {
    if (!confirm("Are you sure you want to decommission this warehouse? This might affect existing route assignments.")) return;
    try {
        await apiCall(`/manager/warehouses/${id}?company_id=${localStorage.getItem('manager_id')}`, 'DELETE');
        loadMapData();
    } catch(e) {
        alert("Failed to delete warehouse.");
    }
}

async function loadMapData() {
    // Clear markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    try {
        const warehouses = await apiCall(`/manager/warehouses?company_id=${localStorage.getItem('manager_id')}`);
        warehouses.forEach(w => {
            const m = L.marker([w.lat, w.lng], {title: w.name}).addTo(map)
                .bindPopup(`<b>Warehouse:</b> ${w.name}<br><small>Manager: ${w.manager_name}</small>`);
            m.whId = w.id;
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
        
        loadWarehousesList(warehouses);

        const shipments = await apiCall(`/shipments?company_id=${localStorage.getItem('manager_id')}`);
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

function loadWarehousesList(warehouses) {
    const tbody = document.getElementById('warehouses-table-body');
    if (!tbody) return;
    
    if (warehouses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No warehouses deployed yet.</td></tr>';
        return;
    }
    
    tbody.innerHTML = warehouses.map(w => `
        <tr id="row-wh-${w.id}">
            <td style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${w.id.substring(0,8)}</td>
            <td><strong id="wh-name-display-${w.id}">${w.name}</strong></td>
            <td>
                <div style="font-size:0.85rem; font-weight:bold; color:var(--primary);" id="wh-manager-display-${w.id}">${w.manager_name || 'N/A'}</div>
                <div style="font-size:0.75rem; color:var(--text-muted);" id="wh-contact-display-${w.id}">📞 ${w.contact_number || 'N/A'}</div>
            </td>
            <td>${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}</td>
            <td><span style="color:var(--primary); font-weight:bold;" id="wh-drone-display-${w.id}">${w.drone_count || 0}</span> 🛰️</td>
            <td>
                <div style="display:flex; gap:5px;">
                    <button class="btn-primary" style="padding:4px 8px; font-size:0.75rem; background:var(--accent);" onclick="openEditWarehouse('${w.id}')">✏️ Edit</button>
                    <button class="btn-primary" style="padding:4px 8px; font-size:0.75rem; background:var(--primary);" onclick="locateWarehouse('${w.id}')">📍 Locate</button>
                </div>
            </td>
        </tr>
    `).join('');
}

let highlightCircle = null;
function locateWarehouse(id) {
    const marker = markers.find(m => m.whId === id);
    if (marker) {
        map.setView(marker.getLatLng(), 15);
        marker.openPopup();
        
        // Visual highlight
        if (highlightCircle) map.removeLayer(highlightCircle);
        highlightCircle = L.circle(marker.getLatLng(), {
            radius: 200,
            color: 'var(--accent)',
            fillColor: 'var(--accent)',
            fillOpacity: 0.3,
            className: 'pulse-animation'
        }).addTo(map);
        
        setTimeout(() => { if (highlightCircle) map.removeLayer(highlightCircle); }, 5000);
    }
}

async function openEditWarehouse(id) {
    try {
        const whs = await apiCall(`/manager/warehouses?company_id=${localStorage.getItem('manager_id')}`);
        const w = whs.find(item => item.id === id);
        if (!w) return;

        document.getElementById('edit-wh-id').value = w.id;
        document.getElementById('edit-wh-name').value = w.name;
        document.getElementById('edit-wh-manager').value = w.manager_name;
        document.getElementById('edit-wh-contact').value = w.contact_number;
        document.getElementById('edit-wh-drone').value = w.drone_count;

        document.getElementById('wh-edit-modal').style.display = 'block';
    } catch(e) {}
}

async function submitEditWarehouse() {
    const id = document.getElementById('edit-wh-id').value;
    const name = document.getElementById('edit-wh-name').value;
    const manager = document.getElementById('edit-wh-manager').value;
    const contact = document.getElementById('edit-wh-contact').value;
    const drones = parseInt(document.getElementById('edit-wh-drone').value || 0);

    if (!name || !manager || !contact) return alert("All fields are required.");

    try {
        await apiCall(`/manager/warehouses/${id}?company_id=${localStorage.getItem('manager_id')}`, 'PUT', {
            name, manager_name: manager, contact_number: contact, drone_count: drones
        });
        document.getElementById('wh-edit-modal').style.display = 'none';
        loadMapData();
    } catch(e) {
        alert("Failed to update warehouse.");
    }
}

async function decommissionWarehouse() {
    const id = document.getElementById('edit-wh-id').value;
    if (!id) return;
    
    if (!confirm("⚠️ WARNING: Location coordinates are permanent. Once decommissioned, this hub and its operational history will be archived. Continue?")) return;
    
    try {
        await apiCall(`/manager/warehouses/${id}?company_id=${localStorage.getItem('manager_id')}`, 'DELETE');
        document.getElementById('wh-edit-modal').style.display = 'none';
        loadMapData();
    } catch(e) {
        alert("Failed to decommission warehouse.");
    }
}

function openWhModal(lat, lng) {
    pendingWhLoc = {lat, lng};
    document.getElementById('wh-modal').style.display = 'block';
}

async function submitNewWarehouse() {
    const name = document.getElementById('wh-name-input').value;
    const manager = document.getElementById('wh-manager-input').value;
    const contact = document.getElementById('wh-contact-input').value;
    const drones = parseInt(document.getElementById('wh-drone-count').value || 0);
    
    if (!name || !manager || !contact) {
        return alert("Error: Warehouse Name, Manager Name, and Contact Number are all required.");
    }
    if (isNaN(drones) || drones < 0) {
        return alert("Error: Please provide a valid Drone Fleet Size.");
    }
    
    await createWarehouse(name, pendingWhLoc.lat, pendingWhLoc.lng, drones, manager, contact);
    document.getElementById('wh-modal').style.display = 'none';
    document.getElementById('wh-name-input').value = '';
}

async function createWarehouse(name, lat, lng, droneCount = 0, manager = '', contact = '') {
    try {
        await apiCall('/manager/warehouses', 'POST', {
            company_id: localStorage.getItem('manager_id'),
            name, lat, lng, drone_count: droneCount,
            manager_name: manager, contact_number: contact
        });
        loadMapData();
    } catch(e) {}
}

async function confirmSuggestedLocation() {
    const drones = parseInt(document.getElementById('sug-drone-count').value || 0);
    const manager = document.getElementById('sug-manager').value;
    const contact = document.getElementById('sug-contact').value;
    
    if (!manager || !contact) {
        return alert("Error: Manager Name and Contact Number are required for AI-suggested hubs.");
    }
    const name = prompt("Enter Warehouse Name for Strategic Hub:");
    if (name) {
        await createWarehouse(name, suggestedWhLoc.lat, suggestedWhLoc.lng, drones, manager, contact);
        document.getElementById('suggestion-modal').style.display = 'none';
    }
}

async function stayWithManualLocation() {
    const drones = parseInt(document.getElementById('sug-drone-count').value || 0);
    const manager = document.getElementById('sug-manager').value;
    const contact = document.getElementById('sug-contact').value;
    const name = prompt("Enter Warehouse Name for Manual Hub:");
    if (name) {
        await createWarehouse(name, pendingWhLoc.lat, pendingWhLoc.lng, drones, manager, contact);
        document.getElementById('suggestion-modal').style.display = 'none';
    }
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

function showSection(id) {
    const sections = ['analytics', 'warehouses', 'shipments', 'drivers', 'weather', 'leaderboard', 'messages', 'verifications', 'safety', 'ledger', 'oracle', 'strategy-plan', 'network-resilience', 'system'];
    sections.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = s === id ? 'block' : 'none';
    });

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('onclick')?.includes(`'${id}'`)) {
            link.classList.add('active');
        }
    });

    // Specific loads
    if (id === 'analytics') loadInsights();
    if (id === 'warehouses') {
        if (!map) initMap();
        else setTimeout(() => map.invalidateSize(), 200);
        loadMapData();
    }
    if (id === 'shipments') loadShipments();
    if (id === 'drivers') loadDriversAndVehicles();
    if (id === 'weather') initWeatherMap();
    if (id === 'leaderboard') loadLeaderboard();
    if (id === 'messages') loadAllConversations();
    if (id === 'verifications') loadVerifications();
    if (id === 'safety') loadSafetyCenter();
    if (id === 'ledger') loadLedger();
    if (id === 'oracle') loadOracleInsights();
    if (id === 'strategy-plan') loadStrategyPlan();
    if (id === 'network-resilience') loadNetworkResilience();
}

function loadVerifications() {
    loadDriversAndVehicles();
}

showSection('analytics');

function logout() {
    localStorage.clear();
    window.location.href = '../index.html';
}

async function loadInsights() {
    try {
        const container = document.getElementById('alerts-container');
        const [alerts, stats, cascade] = await Promise.all([
            apiCall(`/tracking/alerts/active?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/dashboard/stats?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/analytics/cascade?company_id=${localStorage.getItem('manager_id')}`)
        ]);
        
        // Update Stats Grid
        document.getElementById('stat-timely').innerText = `${stats.timely_percent}%`;
        document.getElementById('stat-revenue').innerText = `$${stats.revenue.toLocaleString()}`;
        document.getElementById('stat-delay').innerText = `${stats.avg_delay_mins}m`;
        document.getElementById('stat-active').innerText = stats.active_shipments;

        // Render Charts & Cascade
        renderManagerCharts(stats);
        renderCascadePredictor(cascade);

        // Safety Badge Update
        const safetyAlerts = alerts.filter(a => (a.type === 'fatigue' || a.type === 'breakdown'));
        const badge = document.getElementById('safety-badge');
        if (badge) {
            badge.innerText = safetyAlerts.length;
            badge.style.display = safetyAlerts.length > 0 ? 'inline' : 'none';
        }

        if (alerts.length === 0) {
            container.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted);">No active system alerts.</p>`;
            return;
        }

        container.innerHTML = alerts.map(a => `
            <div style="background: rgba(255, 255, 255, 0.05); border-left: 3px solid ${a.severity==='critical'?'var(--danger)':'var(--warning)'}; padding: 10px; margin-bottom: 10px; border-radius: 8px; position:relative;">
                <button style="position:absolute; top:8px; right:8px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem;" onclick="resolveAlert('${a.id}')">✖</button>
                <p style="margin:0; padding-right:20px; font-size: 0.9rem;"><strong>${a.type.toUpperCase()}:</strong> ${a.description}<br>
                <em style="color:var(--accent)">Suggestion: ${a.suggestion}</em></p>
                <button class="btn-primary" style="padding:2px 10px; font-size:0.7rem; margin-top:8px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2);" onclick="resolveAlert('${a.id}')">Dismiss Alert</button>
            </div>
        `).join('');
    } catch(e) {}
}

function renderManagerCharts(stats) {
    const volCtx = document.getElementById('volumeChart')?.getContext('2d');
    const fleetCtx = document.getElementById('fleetChart')?.getContext('2d');
    if (!volCtx || !fleetCtx) return;

    if (volumeChart) volumeChart.destroy();
    if (fleetChart) fleetChart.destroy();

    volumeChart = new Chart(volCtx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Shipment Volume',
                data: stats.volume_data,
                borderColor: '#00f2fe',
                backgroundColor: 'rgba(0, 242, 254, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } }
        }
    });
    fleetChart = new Chart(fleetCtx, {
        type: 'doughnut',
        data: {
            labels: ['In-Transit', 'Available', 'Maintenance'],
            datasets: [{
                data: [stats.fleet_dist.in_transit, stats.fleet_dist.available, stats.fleet_dist.maintenance],
                backgroundColor: ['#3182ce', '#48bb78', '#f56565'],
                borderWidth: 0
            }]
        },
        options: {
            cutout: '70%',
            plugins: { legend: { position: 'bottom', labels: { color: '#a0aec0', boxWidth: 12 } } }
        }
    });
}

function renderCascadePredictor(data) {
    const container = document.getElementById('cascade-container');
    const totalHoursEl = document.getElementById('cascade-total-hours');
    const recDiv = document.getElementById('cascade-recommendation');
    const recText = document.getElementById('cascade-rec-text');
    
    if (!container) return;
    
    totalHoursEl.innerText = `${data.total_impact_hours} hrs`;
    
    if (data.risks.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">
            <div style="font-size:2rem; margin-bottom:10px;">🛡️</div>
            Network Stable. No cascading risks detected.
        </div>`;
        recDiv.style.display = 'none';
        return;
    }
    
    recDiv.style.display = 'block';
    recText.innerText = data.recommendation;
    
    container.innerHTML = data.risks.map(r => `
        <div class="glass-card" style="padding:15px; border-left: 4px solid ${r.severity==='high'?'var(--danger)':'var(--warning)'}; background:rgba(255,255,255,0.02);">
            <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                <span style="font-size:0.7rem; color:var(--text-muted); font-weight:bold;">SOURCE: ${r.source_shipment_id.slice(0,8)}</span>
                <span class="badge" style="background:${r.severity==='high'?'var(--danger)':'var(--warning)'}; font-size:0.6rem;">${r.severity.toUpperCase()} RISK</span>
            </div>
            <h4 style="margin:5px 0;">${r.description}</h4>
            <p style="font-size:0.8rem; color:var(--danger); margin-bottom:10px;">Current Deviation: +${r.current_delay}</p>
            
            <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top:10px;">
                <small style="color:var(--text-muted); display:block; margin-bottom:5px;">PREDICTED HUB IMPACTS:</small>
                ${r.impact_hubs.map(h => `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; font-size:0.8rem;">
                        <span>📍 ${h.location}</span>
                        <span style="color:${h.risk_level==='critical'?'var(--danger)':'var(--warning)'}">+${h.est_delay_mins}m</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

async function loadNetworkResilience() {
    try {
        const data = await apiCall(`/manager/analytics/cascade?company_id=${localStorage.getItem('manager_id')}`);
        
        // Update Total Risk
        document.getElementById('nr-total-risk').innerText = `${data.total_impact_hours} hrs`;
        
        // Update Mitigation Text
        document.getElementById('nr-rec-text').innerText = data.active_risk_count > 0 ? data.recommendation : "System stable. No immediate mitigation required.";
        
        // Update Matrix (Detailed cards)
        const matrix = document.getElementById('nr-matrix');
        if (data.risks.length === 0) {
            matrix.innerHTML = `<div style="text-align:center; padding-top:100px; color:var(--text-muted);">🛡️ All Network Nodes Healthy</div>`;
        } else {
            matrix.innerHTML = data.risks.map(r => `
                <div class="glass-card" style="padding:15px; border-left: 4px solid ${r.severity==='high'?'var(--danger)':'var(--warning)'}; margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between;">
                        <b>Chain ${r.source_shipment_id.slice(0,4)}</b>
                        <span style="color:var(--text-muted)">Deviation: ${r.current_delay}</span>
                    </div>
                    <div style="margin-top:10px; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                        <div style="width:${r.severity==='high'?'85%':'45%'}; height:100%; background:${r.severity==='high'?'var(--danger)':'var(--warning)'};"></div>
                    </div>
                    <small style="display:block; margin-top:5px; color:var(--text-muted);">Impact Probability: ${r.severity==='high'?'Critical':'Elevated'}</small>
                </div>
            `).join('');
        }

        // Update Table
        const tbody = document.getElementById('nr-table-body');
        if (data.risks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="padding:40px; text-align:center; color:var(--text-muted);">No disruption chains detected.</td></tr>`;
        } else {
            tbody.innerHTML = data.risks.map(r => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:12px;">
                        <b>${r.description}</b><br>
                        <small style="color:var(--text-muted)">${r.source_shipment_id}</small>
                    </td>
                    <td style="padding:12px; color:var(--danger)">+${r.current_delay}</td>
                    <td style="padding:12px;">
                        ${r.impact_hubs.map(h => `<span class="badge" style="background:rgba(255,255,255,0.1); margin-right:5px;">${h.location}</span>`).join('')}
                    </td>
                    <td style="padding:12px;">
                        <span class="badge" style="background:${r.severity==='high'?'var(--danger)':'var(--warning)'}">${r.severity.toUpperCase()}</span>
                    </td>
                    <td style="padding:12px; text-align:center;">
                        <button class="btn-primary" style="width:auto; padding:4px 10px; font-size:0.75rem;" onclick="showSection('shipments')">Analyze Path</button>
                    </td>
                </tr>
            `).join('');
        }

    } catch(e) {
        console.error("Resilience Load Error", e);
    }
}

async function loadSafetyCenter() {
    try {
        const [drivers, alerts, shipments] = await Promise.all([
            apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/tracking/alerts/active?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/shipments?company_id=${localStorage.getItem('manager_id')}`)
        ]);

        // 1. Fatigue Alerts
        const fatigueContainer = document.getElementById('fatigue-alerts-list');
        const tiredDrivers = drivers.filter(d => (d.fatigue_score || 0) > 70).sort((a,b) => b.fatigue_score - a.fatigue_score);
        fatigueContainer.innerHTML = tiredDrivers.length ? tiredDrivers.map(d => `
            <div class="glass-card" style="margin-bottom:10px; border-left:4px solid ${d.fatigue_score > 90 ? 'var(--danger)' : 'var(--warning)'}; padding:10px;">
                <div style="display:flex; justify-content:space-between;">
                    <b>${d.name}</b>
                    <span style="color:${d.fatigue_score > 90 ? 'var(--danger)' : 'var(--warning)'}">${d.fatigue_score.toFixed(0)}% Fatigue</span>
                </div>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-top:5px;">Driver ID: ${d.login_id} | Trips: ${d.total_trips || 0}</div>
                <button class="btn-primary" style="margin-top:8px; padding:4px 10px; font-size:0.75rem; width:auto;" onclick="openMessageModal('null', '${d.id}')">💬 Order Emergency Rest</button>
            </div>
        `).join('') : '<p style="color:var(--text-muted); font-size:0.85rem;">All drivers are within safety fatigue levels.</p>';

        // 2. Zen Mode Sessions
        const zenContainer = document.getElementById('zen-sessions-list');
        const zenDrivers = drivers.filter(d => d.is_zen_mode);
        zenContainer.innerHTML = zenDrivers.length ? zenDrivers.map(d => `
            <div class="glass-card" style="margin-bottom:10px; border-left:4px solid var(--primary); padding:10px;">
                <div style="display:flex; justify-content:space-between;">
                    <b>${d.name}</b>
                    <span class="pulse-warning" style="color:var(--primary); font-weight:bold;">🧘 ZEN MODE ACTIVE</span>
                </div>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-top:5px;">AI Rerouted to: ${d.zen_destination ? d.zen_destination.name : 'Safety Point'}</div>
                <div style="display:flex; gap:5px; margin-top:8px;">
                    <button class="btn-primary" style="padding:4px 10px; font-size:0.75rem; width:auto;" onclick="liveTrackByDriver('${d.id}')">📍 Track Safety Route</button>
                    <button class="btn-primary" style="padding:4px 10px; font-size:0.75rem; width:auto; background:rgba(255,255,255,0.1);" onclick="openMessageModal('null', '${d.id}')">💬 Msg</button>
                </div>
            </div>
        `).join('') : '<p style="color:var(--text-muted); font-size:0.85rem;">No active safety reroutes currently.</p>';

        // 3. Incidents Table
        const incidentBody = document.getElementById('incidents-table-body');
        let incidents = [];
        shipments.forEach(s => {
            (s.logs || []).forEach(log => {
                if (log.message.includes("ISSUE:") || log.status === "delayed" || log.status === "disputed") {
                    incidents.push({ shipment: s, log: log, driver: drivers.find(d => d.id === s.assigned_driver_id) });
                }
            });
        });

        incidentBody.innerHTML = incidents.length ? incidents.sort((a,b) => new Date(b.log.timestamp) - new Date(a.log.timestamp)).map(i => `
            <tr>
                <td><b>${i.driver ? i.driver.name : 'System'}</b></td>
                <td><span style="color:var(--danger); font-weight:bold;">${i.log.message}</span></td>
                <td>${new Date(i.log.timestamp).toLocaleTimeString()}</td>
                <td>${i.log.location ? `${i.log.location.lat.toFixed(3)}, ${i.log.location.lng.toFixed(3)}` : 'N/A'}</td>
                <td><span class="status-pill status-${i.shipment.status}">${i.shipment.status}</span></td>
                <td><button class="btn-primary" style="padding:4px 8px; font-size:0.7rem;" onclick="openLogsModal('${i.shipment.id}')">📋 Solve</button></td>
            </tr>
        `).join('') : '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No safety incidents detected.</td></tr>';

        // 4. Score
        const safetyScore = (drivers.reduce((acc, d) => acc + (d.safety_index || 100), 0) / drivers.length) || 100;
        document.getElementById('fleet-safety-index').innerText = `${safetyScore.toFixed(1)}%`;

    } catch(e) {}
}

async function liveTrackByDriver(driverId) {
    const shipments = await apiCall(`/shipments?company_id=${localStorage.getItem('manager_id')}`);
    const active = shipments.find(s => s.assigned_driver_id === driverId && s.status !== 'delivered');
    if (active) openTrackModal(active.id);
    else alert("No active shipment for this driver.");
}

let qrInstance = null;
async function openQRModal(shipmentId) {
    const shipments = await apiCall(`/shipments?company_id=${localStorage.getItem('manager_id')}`);
    const s = shipments.find(item => item.id === shipmentId);
    if (!s) return;

    const modal = document.getElementById('qr-modal');
    const canvas = document.getElementById('qrcode-canvas');
    const text = document.getElementById('qr-id-text');
    
    modal.style.display = 'block';
    canvas.innerHTML = '';
    text.innerText = `Shipment Reference: ${s.id}`;
    
    qrInstance = new QRCode(canvas, {
        text: s.qr_code_data,
        width: 200,
        height: 200,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

function downloadQR() {
    const img = document.querySelector('#qrcode-canvas img');
    if (!img) return;
    const link = document.createElement('a');
    link.download = `shipment_qr_${new Date().getTime()}.png`;
    link.href = img.src;
    link.click();
}

async function viewCargoPlan(shipmentId) {
    try {
        const shipments = await apiCall(`/shipments?company_id=${localStorage.getItem('manager_id')}`);
        const s = shipments.find(item => item.id === shipmentId);
        
        if (!s || !s.loading_blueprint) {
            alert("No cargo loading plan found for this shipment yet.");
            return;
        }

        const modal = document.getElementById('cargo-plan-modal');
        const content = document.getElementById('cargo-plan-content');
        modal.style.display = 'block';

        content.innerHTML = `
            <div style="background:rgba(49, 130, 206, 0.1); padding:15px; border-radius:10px; margin-bottom:20px; text-align:center;">
                <div style="font-size:0.8rem; color:var(--primary); font-weight:bold;">UTILIZATION SCORE</div>
                <div style="font-size:2rem; font-weight:bold;">92.4%</div>
            </div>
            ${s.loading_blueprint.map(b => `
                <div style="margin-bottom:15px; background:rgba(255,255,255,0.03); padding:15px; border-radius:8px; border-left:4px solid var(--primary);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.75rem; color:var(--accent); font-weight:bold;">LAYER ${b.layer}</span>
                        <span style="font-size:0.75rem; color:var(--text-muted);">${b.position}</span>
                    </div>
                    <div style="margin:10px 0; font-size:1rem; font-weight:bold; color:white;">${b.items.join(", ")}</div>
                    <p style="font-size:0.85rem; color:var(--text-muted); margin:0; line-height:1.4;">${b.instruction}</p>
                </div>
            `).join('')}
        `;
    } catch(e) {
        alert("Failed to load cargo plan.");
    }
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
        description: document.getElementById('description').value,
        is_perishable: document.getElementById('is-perishable').checked,
        receiver_name: document.getElementById('receiver-name').value,
        receiver_phone: document.getElementById('receiver-phone').value
    };
    
    try {
        data.company_id = localStorage.getItem('manager_id');
        await apiCall('/shipments/', 'POST', data);
        alert('Shipment Created Successfully!');
        document.getElementById('create-shipment-form').reset();
        loadShipments();
    } catch(e) {}
});

// Shipments Table Rendering
let globalShipments = [];
let globalDrivers = [];
let globalVehicles = [];
let globalWarehouses = [];

async function loadShipments() {
    try {
        const [shipments, drivers, vehicles] = await Promise.all([
            apiCall(`/shipments?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/vehicles?company_id=${localStorage.getItem('manager_id')}`)
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
            
            // 1. Vitality Calculation
            const vitality = s.is_perishable ? (s.vitality || 100) : 100;
            let vColor = 'var(--success)';
            if (vitality < 40) vColor = 'var(--danger)';
            else if (vitality < 80) vColor = 'var(--warning)';

            // 2. Driver & Performance Intel
            const d = drivers.find(drv => drv.id === s.assigned_driver_id);
            const v = vehicles.find(vh => vh.id === s.assigned_vehicle_id);
            const driverName = d ? d.name : 'Unassigned';
            
            let performanceMsg = '';
            let rowClass = 'status-ontime';
            const now = new Date();
            const deadline = new Date(s.status === 'pending' || s.status === 'assigned' ? s.pickup_deadline : s.expected_delivery);
            const diffMins = Math.round((now - deadline) / (1000 * 60));
            
            if (s.performance_stats) {
                const ps = s.performance_stats;
                if (ps.status === 'delayed') {
                    rowClass = 'status-delayed';
                    performanceMsg = `<div style="color:var(--danger); font-size:0.7rem;">⚠️ Delay: ${ps.diff_mins}m</div>`;
                } else if (ps.status === 'early') {
                    rowClass = 'status-early';
                    performanceMsg = `<div style="color:var(--success); font-size:0.7rem;">⚡ Early: ${Math.abs(ps.diff_mins)}m</div>`;
                }
            } else if (diffMins > 0 && s.status !== 'delivered') {
                rowClass = 'status-delayed';
                performanceMsg = `<div style="color:var(--danger); font-size:0.7rem;">⏰ Overdue: ${diffMins}m</div>`;
            }

            tr.className = rowClass;
            tr.innerHTML = `
                <td>
                    <div style="font-weight:bold;">${s.description}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted); font-family:monospace;">ID: ${s.id.substring(0,8)}</div>
                    ${s.route_type === 'multi-leg' ? '<span style="font-size:0.65rem; color:var(--accent); font-weight:bold;">[HUB ROUTE]</span>' : ''}
                </td>
                <td>
                    <div style="width:80px; height:6px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden; margin-bottom:4px;">
                        <div style="width:${vitality}%; height:100%; background:${vColor};"></div>
                    </div>
                    <small style="color:${vColor}; font-weight:bold;">${s.is_perishable ? `Vitality: ${vitality}%` : 'Stable'}</small>
                </td>
                <td>
                    <span class="status-pill status-${s.status}" style="font-size:0.7rem;">${s.status}</span>
                    <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${s.stage}</div>
                    ${performanceMsg}
                </td>
                <td>
                    <div style="font-size:0.8rem; font-weight:600; color:var(--primary);">${driverName}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted); cursor:${s.loading_blueprint ? 'pointer' : 'default'};" onclick="${s.loading_blueprint ? `viewCargoPlan('${s.id}')` : ''}">
                        ${v ? v.number_plate : 'No Vehicle'}
                        ${s.loading_blueprint ? '<span style="color:var(--primary); margin-left:4px;">📦</span>' : ''}
                    </div>
                </td>
                <td>
                    <div style="display:flex; gap:5px; flex-wrap:wrap;">
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.7rem;" onclick="openQRModal('${s.id}')" title="Shipment QR">🔳</button>
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.7rem;" onclick="openLogsModal('${s.id}')" title="Timeline">📜</button>
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.7rem; background:var(--accent);" onclick="openTrackModal('${s.id}')" title="Track">📍</button>
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.7rem; background:rgba(255,255,255,0.05);" onclick="openMessageModal('${s.id}', '${s.assigned_driver_id}')" title="Message">💬</button>
                        ${s.status === 'pending' ? `
                            <button class="btn-primary" style="padding:4px 8px; font-size:0.7rem; background:var(--success);" onclick="autoAssign('${s.id}')">🤖 Auto</button>
                            <button class="btn-primary" style="padding:4px 8px; font-size:0.7rem; background:#3182ce;" onclick="openManualAssign('${s.id}')">👤 Manual</button>
                            <button class="btn-primary" style="padding:4px 8px; font-size:0.7rem; background:var(--warning); color:#000;" onclick="openManualSplit('${s.id}')">✂️ Split</button>
                        ` : ''}
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.7rem; background:rgba(0,0,0,0.2);" onclick="openEditModal('shipments', '${s.id}', '${s.description}', '${s.status}')">✏️</button>
                        <button class="btn-primary" style="padding:4px 8px; font-size:0.7rem; background:var(--danger);" onclick="deleteItem('shipments', '${s.id}')">🗑️</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);

            // Indented Legs for Split Shipments
            if (s.status === 'split') {
                const sLegs = legs.filter(l => l.parent_id === s.id).sort((a,b) => a.leg_order - b.leg_order);
                sLegs.forEach(leg => {
                    const lTr = document.createElement('tr');
                    lTr.style.background = 'rgba(255,255,255,0.02)';
                    const lVitality = leg.is_perishable ? (leg.vitality || 100) : 100;
                    
                    lTr.innerHTML = `
                        <td style="padding-left:30px; font-size:0.8rem; color:var(--text-muted);">↳ Leg ${leg.leg_order}: ${leg.description}</td>
                        <td><div style="width:50px; height:4px; background:rgba(255,255,255,0.05); border-radius:2px; overflow:hidden;"><div style="width:${lVitality}%; height:100%; background:var(--success);"></div></div></td>
                        <td><span style="font-size:0.65rem; padding:2px 6px; border-radius:10px; background:rgba(255,255,255,0.05);">${leg.status}</span></td>
                        <td colspan="2">
                            <button style="background:none; border:none; cursor:pointer; font-size:0.8rem;" onclick="openLogsModal('${leg.id}')">📜</button>
                            <button style="background:none; border:none; cursor:pointer; font-size:0.8rem;" onclick="openTrackModal('${leg.id}')">📍</button>
                        </td>
                    `;
                    tbody.appendChild(lTr);
                });
            }
        } catch (err) {
            console.error("Error rendering shipment:", err, s);
        }
    });
}

async function optimizeFleet() {
    try {
        const res = await apiCall(`/shipments/consolidate?company_id=${localStorage.getItem('manager_id')}`, 'POST');
        alert(res.message);
        loadShipments();
    } catch(e) {
        alert("Consolidation failed.");
    }
}

async function autoSplit(id) {
    try {
        const res = await apiCall(`/shipments/${id}/split/auto?company_id=${localStorage.getItem('manager_id')}`, 'POST');
        alert(res.message);
        loadShipments();
    } catch(e) {}
}

async function openManualSplit(id) {
    currentSplitId = id;
    try {
        const warehouses = await apiCall(`/manager/warehouses?company_id=${localStorage.getItem('manager_id')}`);
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
        const res = await apiCall(`/shipments/${currentSplitId}/split/manual`, 'POST', { warehouse_ids, company_id: localStorage.getItem('manager_id') });
        alert(res.message);
        document.getElementById('split-modal').style.display = 'none';
        loadShipments();
    } catch(e) {}
}

async function autoAssign(id) {
    try {
        await apiCall(`/shipments/${id}/auto-assign`, 'POST', { company_id: localStorage.getItem('manager_id') });
        alert("Assigned Successfully");
        loadShipments();
    } catch(e) {}
}

async function openManualAssign(id) {
    currentAssignId = id;
    try {
        const drivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`);
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
        const drivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`);
        const driver = drivers.find(d => d.id === driverId);
        if (!driver || !driver.assigned_vehicle_id) {
            alert("Driver missing assigned vehicle");
            return;
        }
        
        const res = await apiCall(`/shipments/${currentAssignId}/assign?driver_id=${driverId}&vehicle_id=${driver.assigned_vehicle_id}&company_id=${localStorage.getItem('manager_id')}`, 'POST');
        alert(res.message);
        document.getElementById('assign-modal').style.display = 'none';
        loadShipments();
    } catch(e) {}
}

async function bulkAssign() {
    if (!confirm("Are you sure you want to auto-assign all pending shipments?")) return;
    try {
        const res = await apiCall(`/shipments/bulk-assign`, 'POST', { company_id: localStorage.getItem('manager_id') });
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
        const shipments = await apiCall(`/shipments?company_id=${localStorage.getItem('manager_id')}`);
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
            
            if (seg.route_type === 'drone-leg') {
                // Specialized Drone visualization
                const dronePath = L.polyline([[start.lat, start.lng], [end.lat, end.lng]], {color: '#f6ad55', weight: 3, dashArray: '5, 10'}).addTo(trackMap);
                trackMarkers.push(dronePath);
                
                const droneIcon = L.divIcon({
                    html: '<div class="pulse-warning" style="font-size:24px;">🛰️</div>',
                    className: 'fleet-dot',
                    iconSize: [30, 30]
                });
                const droneMarker = L.marker([start.lat, start.lng], {icon: droneIcon}).addTo(trackMap);
                trackMarkers.push(droneMarker);
                
                document.getElementById('track-status').innerHTML = "🛰️ <span style='color:var(--warning);'>Autonomous Drone In Flight</span>";
                document.getElementById('track-next').innerText = "Airborne Last-Mile";
            } else {
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
        }

        // Dynamic Contact Surface
        const allDrivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`);
        const allWh = await apiCall(`/manager/warehouses?company_id=${localStorage.getItem('manager_id')}`);
        
        let cLabel = "📞 Contact Driver:";
        let cVal = "N/A";

        if (activeLeg.route_type === 'drone-leg') {
            const wh = allWh.find(w => w.id === activeLeg.at_warehouse_id);
            cLabel = "🛰️ Drone Support (Hub):";
            cVal = wh ? `${wh.manager_name} | ${wh.contact_number}` : "Drone Dispatch Center";
        } else {
            const d = allDrivers.find(drv => drv.id === activeLeg.assigned_driver_id);
            cVal = d ? `${d.name} | ${d.phone_number || 'No Phone'}` : "Unassigned";
            if (activeLeg.is_leg) cLabel = "📞 Leg Driver:";
        }

        document.getElementById('track-contact-label').innerText = cLabel;
        document.getElementById('track-contact-value').innerText = cVal;
        
    } catch(err) {
        console.error("Track Modal Error:", err);
    }
}

// Drivers & Vehicles
document.getElementById('add-driver-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const exp = parseFloat(document.getElementById('d-exp').value || 0);
        const accidents = parseInt(document.getElementById('d-accidents').value || 0);
        const challans = parseInt(document.getElementById('d-challans').value || 0);

        // Algorithmic Safety Rating Logic
        let safetyRating = 5.0;
        safetyRating -= (accidents * 1.0); // Penalty for accidents (Backend aligned)
        safetyRating -= (challans * 0.2);   // Penalty for challans
        safetyRating += (exp * 0.1);       // Reward for years of experience
        safetyRating = Math.max(1.0, Math.min(5.0, safetyRating)); // Cap between 1 and 5

        const driverData = {
            company_id: localStorage.getItem('manager_id'),
            name: document.getElementById('d-name').value,
            login_id: document.getElementById('d-login').value,
            password: document.getElementById('d-pass').value,
            license_type: document.getElementById('d-license').value,
            base_warehouse_id: document.getElementById('d-base').value,
            years_experience: exp,
            past_accidents: accidents,
            traffic_violations: challans,
            challan_count: challans,
            driving_score: 100.0, // New drivers start with a perfect score
            safety_rating: safetyRating.toFixed(1),
            on_time_rate: 100, // Initial perfect rate
            phone_number: document.getElementById('d-phone').value
        };
        await apiCall('/manager/drivers', 'POST', driverData);
        document.getElementById('add-driver-form').reset();
        loadDriversAndVehicles();
    } catch(e) {}
});

document.getElementById('add-vehicle-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const vehicleData = {
            company_id: localStorage.getItem('manager_id'),
            type: document.getElementById('v-type').value,
            number_plate: document.getElementById('v-plate').value,
            capacity: parseFloat(document.getElementById('v-cap').value),
            speed: 60,
            fuel_efficiency: parseFloat(document.getElementById('v-eff').value),
            base_warehouse_id: document.getElementById('v-base').value,
            vehicle_health_score: 100 // New vehicles start at perfect health
        };
        await apiCall('/manager/vehicles', 'POST', vehicleData);
        document.getElementById('add-vehicle-form').reset();
        loadDriversAndVehicles();
    } catch(e) {}
});

document.getElementById('link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dId = document.getElementById('link-driver').value;
    const vId = document.getElementById('link-vehicle').value;
    if (!dId || !vId) return alert("Select both driver and vehicle");

    // Validation: Same Warehouse Base
    const driver = globalDrivers.find(d => d.id === dId);
    const vehicle = globalVehicles.find(v => v.id === vId);
    if (driver && vehicle && driver.base_warehouse_id !== vehicle.base_warehouse_id) {
        return alert("🚨 Hub Mismatch: Driver and Vehicle must belong to the same base hub for linkage.");
    }
    
    try {
        await apiCall(`/manager/link-vehicle?driver_id=${dId}&vehicle_id=${vId}&company_id=${localStorage.getItem('manager_id')}`, 'POST');
        alert("Linked successfully!");
        loadDriversAndVehicles();
    } catch(e) {}
});

async function loadDriversAndVehicles() {
    try {
        const [drivers, vehicles, warehouses] = await Promise.all([
            apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/vehicles?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/warehouses?company_id=${localStorage.getItem('manager_id')}`)
        ]);
        globalDrivers = drivers;
        globalVehicles = vehicles;
        globalWarehouses = warehouses;
        
        // Populate Hub Filters
        const dHubFilter = document.getElementById('driver-filter-hub');
        const vHubFilter = document.getElementById('vehicle-filter-hub');
        const hubsHtml = '<option value="">All Hubs</option>' + warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
        if (dHubFilter) dHubFilter.innerHTML = hubsHtml;
        if (vHubFilter) vHubFilter.innerHTML = hubsHtml;

        renderDriversTable();
        renderVehiclesTable();
        renderLinkedPairs();

        const verifTbody = document.getElementById('verifications-table-body');
        if (verifTbody) {
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
            if (badge) {
                badge.innerText = verifCount;
                badge.style.display = verifCount > 0 ? 'inline-block' : 'none';
            }
        }
    } catch(err) {
        console.error("Dashboard load failed", err);
    }
}

window.renderDriversTable = function() {
    const dtbody = document.getElementById('drivers-table-body');
    const dSelect = document.getElementById('link-driver');
    if (!dtbody) return;
    
    dtbody.innerHTML = '';
    if (dSelect) dSelect.innerHTML = '<option value="">Select Driver</option>';
    
    const searchTerm = (document.getElementById('driver-search')?.value || '').toLowerCase();
    const typeFilter = document.getElementById('driver-filter-type')?.value || '';
    const hubFilter = document.getElementById('driver-filter-hub')?.value || '';
    const sortMode = document.getElementById('driver-sort')?.value || 'name';

    let filtered = globalDrivers.filter(d => {
        const matchesSearch = d.name.toLowerCase().includes(searchTerm) || d.system_id.toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || d.license_type === typeFilter;
        const matchesHub = !hubFilter || d.base_warehouse_id === hubFilter;
        return matchesSearch && matchesType && matchesHub;
    });

    // Sorting
    filtered.sort((a, b) => {
        if (sortMode === 'score') return (b.driving_score || 0) - (a.driving_score || 0);
        if (sortMode === 'points') return (b.reward_points || 0) - (a.reward_points || 0);
        return a.name.localeCompare(b.name);
    });

    filtered.forEach(d => {
        const joinDate = d.join_date ? new Date(d.join_date) : new Date();
        const diffDays = Math.floor(Math.abs(new Date() - joinDate) / (1000 * 60 * 60 * 24));
        const baseWh = globalWarehouses.find(w => w.id === d.base_warehouse_id);
        
        dtbody.innerHTML += `<tr>
            <td><b>${d.name}</b><br><small style="color:var(--accent); font-family:monospace;">${d.system_id || 'ID: ' + d.id.substring(0,8)}</small></td>
            <td><span class="badge" style="background:rgba(255,255,255,0.1)">${d.license_type}</span><br><small>Tenure: ${diffDays} Days</small></td>
            <td>${d.driving_score ? d.driving_score.toFixed(1) : '100.0'}/100<br><small>Safety: ${d.safety_rating || 5.0}⭐</small></td>
            <td><span style="color:${d.challan_count > 0 ? 'var(--danger)' : 'var(--success)'}">${d.challan_count}</span></td>
            <td><strong style="color:var(--accent)">${d.reward_points || 0}</strong></td>
            <td><small>${baseWh ? baseWh.name : 'N/A'}</small></td>
            <td>
                ${d.assigned_vehicle_id ? `<small>Linked</small>` : `<small style="color:var(--warning)">Unlinked</small>`}
                <button style="background:none; border:none; cursor:pointer; font-size:1.1rem; margin-left:10px;" onclick="openEditModal('drivers', '${d.id}', '${d.name}', '${d.license_type}', '${d.base_warehouse_id}')" title="Edit">✏️</button>
                <button style="background:none; border:none; cursor:pointer; font-size:1.1rem; margin-left:5px; color:var(--danger);" onclick="deleteItem('drivers', '${d.id}')" title="Delete">🗑️</button>
            </td>
        </tr>`;
        if (dSelect) dSelect.innerHTML += `<option value="${d.id}">${d.name} (${d.system_id}) - ${baseWh ? baseWh.name : 'No Hub'}</option>`;
    });
};

window.renderLinkedPairs = function() {
    const tbody = document.getElementById('linked-pairs-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    globalDrivers.filter(d => d.assigned_vehicle_id).forEach(d => {
        const vehicle = globalVehicles.find(v => v.id === d.assigned_vehicle_id);
        const hub = globalWarehouses.find(w => w.id === d.base_warehouse_id);
        
        tbody.innerHTML += `<tr>
            <td><b>${d.name}</b><br><small>${d.system_id}</small></td>
            <td><b>${vehicle ? vehicle.type : 'Unknown'}</b><br><small>${vehicle ? vehicle.number_plate : 'N/A'}</small></td>
            <td><small>${hub ? hub.name : 'N/A'}</small></td>
            <td>
                <button class="btn-primary" style="padding:4px 8px; font-size:0.8rem; background:var(--danger)" onclick="unlinkVehicle('${d.id}')">Unlink</button>
            </td>
        </tr>`;
    });
};

window.unlinkVehicle = async function(driverId) {
    if (!confirm("Are you sure you want to unlink this vehicle and driver?")) return;
    try {
        await apiCall(`/manager/unlink-vehicle?driver_id=${driverId}`, 'POST');
        loadDriversAndVehicles();
    } catch(e) {
        alert("Failed to unlink.");
    }
};

window.renderVehiclesTable = function() {
    const vtbody = document.getElementById('vehicles-table-body');
    const vSelect = document.getElementById('link-vehicle');
    if (!vtbody) return;
    
    vtbody.innerHTML = '';
    if (vSelect) vSelect.innerHTML = '<option value="">Select Vehicle</option>';
    
    const searchTerm = (document.getElementById('vehicle-search')?.value || '').toLowerCase();
    const typeFilter = document.getElementById('vehicle-filter-type')?.value || '';
    const hubFilter = document.getElementById('vehicle-filter-hub')?.value || '';
    const sortMode = document.getElementById('vehicle-sort')?.value || 'type';

    let filtered = globalVehicles.filter(v => {
        const matchesSearch = v.number_plate.toLowerCase().includes(searchTerm) || v.system_id.toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || v.type === typeFilter;
        const matchesHub = !hubFilter || v.base_warehouse_id === hubFilter;
        return matchesSearch && matchesType && matchesHub;
    });

    // Sorting
    filtered.sort((a, b) => {
        if (sortMode === 'health') return (b.vehicle_health_score || 0) - (a.vehicle_health_score || 0);
        if (sortMode === 'capacity') return (b.capacity || 0) - (a.capacity || 0);
        return a.type.localeCompare(b.type);
    });

    filtered.forEach(v => {
        const baseWh = globalWarehouses.find(w => w.id === v.base_warehouse_id);
        let healthColor = v.vehicle_health_score > 80 ? 'var(--success)' : (v.vehicle_health_score > 60 ? 'var(--warning)' : 'var(--danger)');
        vtbody.innerHTML += `<tr>
            <td><b>${v.type}</b><br><small style="color:var(--accent); font-family:monospace;">${v.system_id || 'ID: ' + v.id.substring(0,8)}</small></td>
            <td>${v.number_plate || '<span style="color:var(--text-muted)">Not Set</span>'}</td>
            <td><span style="color:${healthColor}; font-weight:bold;">${v.vehicle_health_score || 100}%</span></td>
            <td>${v.capacity}kg<br><small>Eff: ${v.fuel_efficiency}km/l</small></td>
            <td><small>${baseWh ? baseWh.name : 'N/A'}</small></td>
            <td>
                ${v.assigned_driver_id ? `<small>Linked</small>` : `<small style="color:var(--warning)">Unlinked</small>`}
                <button style="background:none; border:none; cursor:pointer; font-size:1.1rem; margin-left:10px;" onclick="openEditModal('vehicles', '${v.id}', '${v.number_plate || ''}', '${v.capacity}', '${v.base_warehouse_id}', '${v.fuel_efficiency}')" title="Edit">✏️</button>
                <button style="background:none; border:none; cursor:pointer; font-size:1.1rem; margin-left:5px; color:var(--danger);" onclick="deleteItem('vehicles', '${v.id}')" title="Delete">🗑️</button>
            </td>
        </tr>`;
        if (vSelect) vSelect.innerHTML += `<option value="${v.id}">${v.type} - ${v.number_plate} (${v.system_id}) - ${baseWh ? baseWh.name : 'No Hub'}</option>`;
    });
};

async function manualVerify(driverId, status) {
    try {
        await apiCall(`/manager/verify-driver/${driverId}?status=${status}&company_id=${localStorage.getItem('manager_id')}`, 'POST');
        loadDriversAndVehicles();
    } catch (e) {}
}

// Generic Edit Modal Logic
let currentEditType = null;
let currentEditId = null;
let currentSplitId = null;
let currentAssignId = null;

window.openEditModal = function(type, id, val1, val2, val3, val4) {
    currentEditType = type;
    currentEditId = id;
    document.getElementById('edit-type').innerText = type.charAt(0).toUpperCase() + type.slice(1);
    
    let html = '';
    if (type === 'shipments') {
        html = `<input type="text" id="edit-val1" value="${val1}" placeholder="Description" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px; margin-bottom:10px;">
                <input type="text" id="edit-val2" value="${val2}" placeholder="Status" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px;">`;
    } else if (type === 'drivers' || type === 'vehicles') {
        const placeholder1 = type === 'drivers' ? 'Name' : 'Number Plate';
        const placeholder2 = type === 'drivers' ? 'License Type' : 'Capacity';
        const inputType2 = type === 'drivers' ? 'text' : 'number';
        
        html = `<input type="text" id="edit-val1" value="${val1}" placeholder="${placeholder1}" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px; margin-bottom:10px;">
                <input type="${inputType2}" id="edit-val2" value="${val2}" placeholder="${placeholder2}" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px; margin-bottom:10px;">`;
        
        if (type === 'vehicles') {
            html += `<input type="number" id="edit-val4" value="${val4 || ''}" placeholder="Fuel Efficiency (km/l)" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px; margin-bottom:10px;">`;
        }

        html += `<select id="edit-val3" style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:8px;">
                    <option value="">Select Base Hub</option>
                    ${globalWarehouses.map(w => `<option value="${w.id}" ${w.id === val3 ? 'selected' : ''}>${w.name}</option>`).join('')}
                </select>`;
    }
    document.getElementById('edit-fields').innerHTML = html;
    document.getElementById('edit-modal').style.display = 'block';
};

document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val1 = document.getElementById('edit-val1').value;
    const val2 = document.getElementById('edit-val2').value;
    const val3 = document.getElementById('edit-val3')?.value;
    const val4 = document.getElementById('edit-val4')?.value;
    
    let payload = { company_id: localStorage.getItem('manager_id') };
    let endpoint = `/${currentEditType}/${currentEditId}`;
    
    if (currentEditType === 'shipments') {
        payload = { ...payload, description: val1, status: val2 };
    } else if (currentEditType === 'drivers') {
        payload = { ...payload, name: val1, license_type: val2, base_warehouse_id: val3 };
        endpoint = `/manager/drivers/${currentEditId}`;
    } else if (currentEditType === 'vehicles') {
        payload = { ...payload, number_plate: val1, capacity: parseFloat(val2), base_warehouse_id: val3, fuel_efficiency: parseFloat(val4) };
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
        const data = await apiCall(`/tracking/${sid}?company_id=${localStorage.getItem('manager_id')}`);
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
    let payload = { company_id: localStorage.getItem('manager_id'), type: disasterType, shapeType: shapeType };
    
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
        await apiCall('/simulation/disaster/clear', 'POST', { company_id: localStorage.getItem('manager_id') });
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
        await apiCall(`/simulation/disaster/${simId}?company_id=${localStorage.getItem('manager_id')}`, 'DELETE');
        loadWeatherFleetData();
        loadShipments();
        alert("Simulation stopped. Impact reverted.");
    } catch(err) {
        alert("Failed to stop simulation.");
    }
}

async function loadWeatherFleetData() {
    try {
        const data = await apiCall('/tracking/fleet/weather?company_id=' + localStorage.getItem('manager_id'));
        
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
                const polyline = L.polyline(cell.coordinates, {
                    color: cell.color || '#dd6b20', weight: 8, opacity: 0.8, className: animClass
                }).addTo(weatherMap).bindPopup(`<b>${cell.icon || '🌡️'} ${cell.type} System</b>`);
                weatherMarkers.push(polyline);
            } else {
                const circle = L.circle([cell.lat, cell.lng], {
                    radius: cell.radius * 1000, 
                    color: cell.color, 
                    fillColor: cell.color, 
                    fillOpacity: 0.2,
                    className: animClass
                }).addTo(weatherMap).bindPopup(`<b>${cell.icon || '🌩️'} ${cell.type} System</b><br>Severity: ${cell.severity}`);
                weatherMarkers.push(circle);
                
                // Add an icon in the center of the weather cell
                const iconMarker = L.marker([cell.lat, cell.lng], {
                    icon: L.divIcon({
                        className: 'weather-div-icon',
                        html: `<div style="font-size:24px; text-shadow: 0 0 10px rgba(0,0,0,0.5);">${cell.icon || '🌦️'}</div>`,
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    })
                }).addTo(weatherMap);
                weatherMarkers.push(iconMarker);
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
        const data = await apiCall(`/manager/leaderboard?category=${category}&sort_by=${sortBy}&company_id=${localStorage.getItem('manager_id')}`);
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
        const data = await apiCall(`/manager/${type}s/${id}/profile?company_id=${localStorage.getItem('manager_id')}`);
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
        const data = await apiCall(`/tracking/${shipmentId}?company_id=${localStorage.getItem('manager_id')}`);
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
                    ${log.photo_url ? `
                        <div style="margin-top:10px; border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,0.1);">
                            <img src="${log.photo_url}" style="width:100%; display:block; cursor:zoom-in;" onclick="window.open('${log.photo_url}')">
                        </div>
                    ` : ''}
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
        const review = await apiCall(`/manager/reviews/${sid}?company_id=${localStorage.getItem('manager_id')}`);
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
        const txs = await apiCall('/manager/ledger?company_id=' + localStorage.getItem('manager_id'));
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
            company_id: localStorage.getItem('manager_id'),
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

async function systemReset(type) {
    if (!confirm(`CRITICAL WARNING: Are you sure you want to delete all ${type} data? This action is permanent and cannot be reversed.`)) {
        return;
    }
    
    try {
        const res = await apiCall(`/manager/system/reset-${type}?company_id=${localStorage.getItem('manager_id')}`, 'POST');
        alert(res.message);
        // Reload the UI
        loadShipments();
        loadMapData();
        loadInsights();
        if (type === 'drivers' || type === 'vehicles') {
            loadDriversAndVehicles();
            loadLeaderboard();
        }
    } catch(err) {
        alert(`Failed to reset ${type}.`);
    }
}

async function requestDeleteAccount() {
    if (!confirm("Are you absolutely sure? Your account and all company data will be permanently deleted.")) {
        return;
    }
    
    try {
        const companyId = localStorage.getItem('manager_id');
        const res = await apiCall(`/manager/system/delete-account-request?company_id=${companyId}`, 'POST');
        alert(res.message);
        document.getElementById('delete-account-step1').style.display = 'none';
        document.getElementById('delete-account-step2').style.display = 'block';
    } catch(err) {
        alert("Failed to request account deletion.");
    }
}

async function confirmDeleteAccount() {
    const otp = document.getElementById('delete-otp').value;
    if (!otp || otp.length < 6) {
        alert("Please enter a valid 6-digit OTP.");
        return;
    }
    
    try {
        const companyId = localStorage.getItem('manager_id');
        const res = await apiCall(`/manager/system/delete-account-confirm?company_id=${companyId}&otp=${otp}`, 'POST');
        alert(res.message);
        logout(); // Force logout after deletion
    } catch(err) {
        alert("Incorrect OTP or account already deleted.");
    }
}
async function dispatchRescueVehicle() {
    const sid = document.getElementById('logs-shipment-id').innerText;
    if (!sid) return;
    
    try {
        const drivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`);
        const vehicles = await apiCall(`/manager/vehicles?company_id=${localStorage.getItem('manager_id')}`);
        
        const freeDriver = drivers.find(d => !d.assigned_vehicle_id && d.verification_status === 'verified');
        const freeVehicle = vehicles.find(v => !v.assigned_driver_id && v.status === 'available');
        
        if (!freeDriver || !freeVehicle) {
            alert("No available drivers or vehicles found for rescue. Please add more fleet resources.");
            return;
        }
        
        if (confirm(`Rescue Proposal:\nAssign ${freeDriver.name} with vehicle ${freeVehicle.number_plate} to recover Shipment ${sid.substring(0,8)}?\n\nThis will resume the journey.`)) {
            try {
                await apiCall('/manager/rescue-shipment', 'POST', {
                    company_id: localStorage.getItem('manager_id'),
                    shipment_id: sid,
                    driver_id: freeDriver.id,
                    vehicle_id: freeVehicle.id
                });
                alert("Rescue mission dispatched! The shipment status has been restored.");
                document.getElementById('logs-modal').style.display = 'none';
                loadShipments();
            } catch(err) {
                alert("Failed to dispatch rescue.");
            }
        }
    } catch(e) {
        alert("Failed to load rescue resources.");
    }
}
async function deleteItem(type, id) {
    if (!confirm(`Are you sure you want to delete this ${type.slice(0,-1)}?`)) return;
    
    let endpoint = `/${type}/${id}?company_id=${localStorage.getItem('manager_id')}`;
    if (type === 'drivers' || type === 'vehicles') {
        endpoint = `/manager/${type}/${id}?company_id=${localStorage.getItem('manager_id')}`;
    } else if (type === 'shipments') {
        endpoint = `/shipments/${id}?company_id=${localStorage.getItem('manager_id')}`;
    }
    
    try {
        await apiCall(endpoint, 'DELETE');
        alert("Deleted successfully!");
        if (type === 'shipments') loadShipments();
        else loadDriversAndVehicles();
    } catch(err) {
        alert("Failed to delete.");
    }
}
let lastOracleRes = null;

async function runOracleSimulation() {
    const months = parseInt(document.getElementById('param-months').value);
    const wh = parseInt(document.getElementById('param-wh').value);
    const whLoc = document.getElementById('param-loc').value;
    const fleet = parseInt(document.getElementById('param-fleet').value);
    const green = parseInt(document.getElementById('param-green').value);
    const auto = parseInt(document.getElementById('param-auto').value);
    const incentive = parseInt(document.getElementById('param-incentive').value);
    
    // UI Loading state
    document.getElementById('oracle-placeholder').style.display = 'none';
    document.getElementById('oracle-data').style.display = 'none';
    
    const resultsContainer = document.getElementById('oracle-results');
    const existingLoader = document.getElementById('oracle-loading');
    if (existingLoader) existingLoader.remove();
    
    resultsContainer.innerHTML += '<div id="oracle-loading" style="color:var(--primary); font-weight:bold; margin:20px 0;">🔮 AI is analyzing Tier-market variables and simulating operational cycles...</div>';

    try {
        const res = await apiCall('/simulation/strategy-oracle', 'POST', {
            company_id: localStorage.getItem('manager_id'),
            months: months,
            wh_expansion: wh,
            wh_location: whLoc,
            fleet_expansion: fleet,
            green_policy: green,
            automation_level: auto,
            driver_incentive: incentive
        });
        
        lastOracleRes = res;
        lastOracleRes.params = { months, wh, whLoc, fleet, green, auto, incentive };
        
        // Remove loading
        const loader = document.getElementById('oracle-loading');
        if (loader) loader.remove();
        
        // Show data
        document.getElementById('oracle-data').style.display = 'block';
        document.getElementById('res-profit').innerText = `₹${(res.summary.net_profit / 100000).toFixed(1)}L`;
        document.getElementById('res-eta').innerText = `${res.summary.efficiency_score.toFixed(1)}%`;
        document.getElementById('res-co2').innerText = `${res.summary.carbon_reduction.toFixed(1)}%`;
        document.getElementById('res-roi').innerText = `${res.summary.roi_percentage}%`;
        document.getElementById('res-ai-msg').innerText = res.ai_recommendation;
        document.getElementById('profit-calc').innerText = res.breakdown;
        
        const riskEl = document.getElementById('res-risk');
        riskEl.innerText = res.risk_level;
        riskEl.style.color = res.risk_level === 'Low' ? 'var(--success)' : (res.risk_level === 'Medium' ? 'var(--warning)' : 'var(--danger)');
        
    } catch(err) {
        alert("Strategy simulation failed.");
        document.getElementById('oracle-placeholder').style.display = 'block';
    }
}

async function applyOracleStrategy() {
    if (!lastOracleRes) return;
    try {
        // Fetch current baseline stats before saving
        const stats = await apiCall('/manager/system/baseline-stats?company_id=' + localStorage.getItem('manager_id'));
        
        const strategyData = { 
            ...lastOracleRes, 
            company_id: localStorage.getItem('manager_id'),
            baselines: stats // Store what we had at the moment of activation
        };
        
        await apiCall('/simulation/strategy/save', 'POST', strategyData);
        alert("Strategy Plan Activated! You can now track progress in the Operational Strategy section.");
        showSection('strategy-plan');
    } catch(e) {
        alert("Failed to save strategy.");
    }
}

async function boostDriverPoints() {
    const percent = document.getElementById('boost-percent').value;
    try {
        await apiCall('/manager/ledger/boost', 'POST', {
            company_id: localStorage.getItem('manager_id'),
            percentage: parseFloat(percent)
        });
        alert(`Successfully boosted fleet reward points by ${percent}%!`);
        loadLedger();
        // Also refresh strategy plan as it might affect 'Driver Focus' progress if we add that
        loadStrategyPlan(); 
    } catch(err) {
        alert("Failed to apply boost.");
    }
}

async function clearActiveStrategy() {
    if (!confirm("Are you sure you want to clear your current strategy plan? This will stop all active target tracking.")) return;
    try {
        await apiCall('/simulation/strategy/active?company_id=' + localStorage.getItem('manager_id'), 'DELETE');
        alert("Strategy plan cleared.");
        loadStrategyPlan();
    } catch(e) {
        alert("Failed to clear strategy.");
    }
}

async function loadStrategyPlan() {
    console.log("Loading Strategy Plan...");
    const noMsg = document.getElementById('no-strategy-msg');
    const content = document.getElementById('active-strategy-content');
    
    if (!noMsg || !content) return;

    try {
        const plan = await apiCall('/simulation/strategy/active?company_id=' + localStorage.getItem('manager_id'));
        if (!plan || !plan.params) {
            noMsg.style.display = 'block';
            content.style.display = 'none';
            return;
        }

        noMsg.style.display = 'none';
        content.style.display = 'block';

        const params = plan.params;
        const summary = plan.summary;
        const baselines = plan.baselines || { warehouse_count: 0, vehicle_count: 0, ev_count: 0 };

        // Fetch current live stats to compare
        const currentStats = await apiCall('/manager/system/baseline-stats?company_id=' + localStorage.getItem('manager_id'));

        document.getElementById('target-list').innerHTML = `
            ${params.fleet > 0 ? `<p style="margin-bottom:12px; font-size:1rem;">• Fleet Expansion: <b style="color:var(--primary)">+${params.fleet}%</b></p>` : ''}
            ${params.wh > 0 ? `<p style="margin-bottom:12px; font-size:1rem;">• Hub Expansion: <b style="color:var(--primary)">${params.wh} (${params.whLoc === 'tier1' ? 'Metro' : 'Regional'})</b></p>` : ''}
            ${params.green > 0 ? `<p style="margin-bottom:12px; font-size:1rem;">• EV Transition: <b style="color:var(--primary)">${params.green}%</b></p>` : ''}
            ${params.auto > 0 ? `<p style="margin-bottom:12px; font-size:1rem;">• Warehouse AI: <b style="color:var(--primary)">Level ${params.auto}</b></p>` : ''}
            ${params.incentive > 0 ? `<p style="margin-bottom:12px; font-size:1rem;">• Driver Focus: <b style="color:var(--primary)">+${params.incentive}% Incentives</b></p>` : ''}
        `;

        document.getElementById('benchmark-data').innerHTML = `
            <div style="background:rgba(72,187,120,0.1); padding:15px; border-radius:8px; border:1px solid rgba(72,187,120,0.2);">
                <small style="color:var(--text-muted)">Projected Profit (Horizon)</small>
                <h2 style="color:var(--success); margin:5px 0;">₹${(summary.net_profit/100000).toFixed(1)}L</h2>
            </div>
            <div style="margin-top:15px;">
                <p style="margin-bottom:8px;">🎯 Efficiency Target: <b>${summary.efficiency_score.toFixed(1)}%</b></p>
                <p style="margin-bottom:8px;">🌱 CO2 Reduction: <b>${summary.carbon_reduction.toFixed(1)}%</b></p>
                <p style="margin-bottom:8px;">📈 Projected ROI: <b>${summary.roi_percentage}%</b></p>
            </div>
        `;

        // Calculate REAL progress
        const wh_added = currentStats.warehouse_count - baselines.warehouse_count;
        const vh_added_pct = baselines.vehicle_count > 0 ? ((currentStats.vehicle_count - baselines.vehicle_count) / baselines.vehicle_count) * 100 : (currentStats.vehicle_count > 0 ? 100 : 0);
        
        const progressData = [
            { 
                label: "Fleet Scale-up", 
                current: vh_added_pct, 
                target: params.fleet, 
                action: 'drivers', 
                btn: "Add Fleet" 
            },
            { 
                label: "Hub Network Expansion", 
                current: (wh_added / (params.wh || 1)) * 100, 
                target: 100, 
                action: 'overview', 
                btn: "Deploy Hubs" 
            },
            { 
                label: "EV Fleet Conversion", 
                current: currentStats.vehicle_count > 0 ? (currentStats.ev_count / currentStats.vehicle_count) * 100 : 0, 
                target: params.green, 
                action: 'drivers', 
                btn: "Convert to EV" 
            },
            { 
                label: "AI Automation Deployment", 
                current: Math.min(params.auto, 15), // Mock progress for AI
                target: params.auto, 
                action: 'oracle', 
                btn: "Refine AI" 
            },
            { 
                label: "Driver Incentive Program", 
                current: params.incentive > 0 ? 45 : 0, // Mock based on boost
                target: params.incentive, 
                action: 'ledger', 
                btn: "Boost Points" 
            }
        ];

        document.getElementById('progress-bars-container').innerHTML = progressData
            .filter(p => p.target > 0)
            .map(p => {
                const percent = Math.min(100, (p.current / p.target) * 100);
                return `
                <div class="strategy-progress-row" style="margin-bottom: 25px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:8px;">
                        <div class="progress-label" style="flex:1;">
                            <span style="font-weight:600;">${p.label}</span>
                            <span style="display:block; font-size:0.8rem; color:var(--text-muted);">${p.current.toFixed(1)}% achieved / <span class="target-marker">${p.target.toFixed(0)}% Goal</span></span>
                        </div>
                        <button class="btn-primary" style="width:auto; padding:5px 12px; font-size:0.75rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.2);" onclick="showSection('${p.action}')">Take Action →</button>
                    </div>
                    <div class="progress-track" style="height:10px; background:rgba(255,255,255,0.05); border-radius:5px; overflow:hidden;">
                        <div class="progress-fill" style="width: ${percent}%; height:100%; background:linear-gradient(90deg, var(--primary), var(--accent)); transition: width 0.5s ease;"></div>
                    </div>
                </div>
            `;}).join('');

    } catch(e) {
        console.error("Strategy load failed:", e);
    }
}
