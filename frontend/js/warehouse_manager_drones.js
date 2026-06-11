// Drone Hub & Airspace Tracking Logic for Warehouse Managers

window.switchTab = function(tab) {
    const tabToPage = {
        'dash': 'warehouse_manager_dash',
        'verifications': 'warehouse_manager_verifications',
        'fleet': 'warehouse_manager_fleet',
        'gate': 'warehouse_manager_gate',
        'audit': 'warehouse_manager_audit',
        'leaderboard': 'warehouse_manager_leaderboard',
        'settings': 'warehouse_manager_settings',
        'shipments': 'warehouse_manager_shipments',
        'payments': 'warehouse_manager_payments',
        'drones': 'warehouse_manager_drones'
    };
    const currentFilename = window.location.pathname.split('/').pop().split('?')[0].replace('.html', '');
    const expectedPage = tabToPage[tab];
    if (expectedPage && expectedPage !== currentFilename) {
        window.location.href = expectedPage + '.html';
    }
};

let map = null;
let warehouseMarker = null;
let activeDroneMarkers = {};
let globalDrones = [];
let globalShipments = [];
let whId = localStorage.getItem('warehouse_id');
let companyId = localStorage.getItem('company_id');
let whLat = 28.6139;
let whLng = 77.2090;

async function initDronesPage() {
    if (!whId || !companyId) {
        alert("Session expired. Please log in again.");
        window.location.href = "index.html";
        return;
    }
    
    // Fetch warehouse details to get coordinates
    try {
        const whs = await apiCall(`/manager/warehouses?company_id=${companyId}`);
        const currentWh = whs.find(w => w.id === whId);
        if (currentWh) {
            document.getElementById('wh-location-label-short').innerText = currentWh.name;
            whLat = currentWh.lat || 28.6139;
            whLng = currentWh.lng || 77.2090;
        }
    } catch(e) {
        console.error("Failed to load warehouse location", e);
    }
    
    initMap();
    await loadDrones();
    await loadPendingShipments();
    
    // Register form listener
    document.getElementById('add-drone-form').addEventListener('submit', handleAddDrone);
    
    // Periodically update telemetry
    setInterval(updateDroneTelemetry, 4000);
}

function initMap() {
    map = L.map('drone-tracking-map', {
        zoomControl: true,
        attributionControl: false
    }).setView([whLat, whLng], 12);
    
    // Dark themed tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
    }).addTo(map);
    
    // Draw warehouse hub
    const hubIcon = L.divIcon({
        className: 'custom-hub-icon',
        html: `<div style="background:var(--primary); width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow:0 0 15px var(--primary);"></div>`,
        iconSize: [16, 16]
    });
    warehouseMarker = L.marker([whLat, whLng], {icon: hubIcon}).addTo(map)
        .bindPopup("<b>Warehouse Hub Base</b>").openPopup();
}

async function loadDrones() {
    try {
        const drones = await apiCall(`/manager/drones?company_id=${companyId}`);
        globalDrones = drones.filter(d => d.base_warehouse_id === whId);
        renderDrones();
    } catch (e) {
        console.error("Failed to load drones", e);
    }
}

function renderDrones() {
    const tbody = document.getElementById('drone-table-body');
    const droneSelect = document.getElementById('dispatch-drone-select');
    
    tbody.innerHTML = '';
    droneSelect.innerHTML = '<option value="">Select an available drone</option>';
    
    let total = globalDrones.length;
    let available = 0;
    let active = 0;
    let batterySum = 0;
    
    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No drones registered for this hub.</td></tr>`;
    } else {
        globalDrones.forEach(d => {
            // Simulate battery charge
            if (!d.battery) {
                d.battery = d.status === 'available' ? 100 : Math.floor(50 + Math.random() * 40);
            }
            batterySum += d.battery;
            
            if (d.status === 'available') {
                available++;
                const opt = document.createElement('option');
                opt.value = d.id;
                opt.innerText = `🛸 ${d.system_id || 'Drone'} (${d.license_number}) - Cap: ${d.capacity}kg`;
                droneSelect.appendChild(opt);
            } else if (d.status === 'in_flight') {
                active++;
            }
            
            const tr = document.createElement('tr');
            const statusColor = d.status === 'available' ? 'var(--success)' : (d.status === 'in_flight' ? 'var(--warning)' : 'var(--danger)');
            
            tr.innerHTML = `
                <td><b>${d.system_id || 'DRN-NEW'}</b></td>
                <td>${d.license_number}</td>
                <td>${d.capacity} kg</td>
                <td>${d.radius} km</td>
                <td><span class="status-pill" style="background:${statusColor}22; color:${statusColor};">${d.status.toUpperCase()}</span></td>
                <td>
                    <div style="font-size:0.75rem;">${d.battery}%</div>
                    <div class="drone-battery-bar">
                        <div class="drone-battery-fill" style="width:${d.battery}%; background:${d.battery > 50 ? 'var(--success)' : (d.battery > 20 ? 'var(--warning)' : 'var(--danger)')}"></div>
                    </div>
                </td>
                <td>
                    <button class="btn-primary" onclick="deleteDrone('${d.id}')" style="background:var(--danger); padding:4px 8px; font-size:0.75rem; width:auto;">Delete 🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
    
    document.getElementById('total-drones-count').innerText = total;
    document.getElementById('available-drones-count').innerText = available;
    document.getElementById('active-flights-count').innerText = active;
    document.getElementById('avg-battery-percent').innerText = total > 0 ? `${Math.round(batterySum / total)}%` : '-- %';
}

async function loadPendingShipments() {
    try {
        const shipments = await apiCall(`/shipments?company_id=${companyId}`);
        // Filter final leg deliveries (destined for local drop coordinates or weight < 20kg, status in pending/assigned)
        globalShipments = shipments.filter(s => {
            return s.pickup_warehouse_id === whId && (s.status === 'pending' || s.status === 'assigned');
        });
        
        // Sort shipments: urgent/overdue first
        globalShipments.sort((a, b) => {
            const timeA = a.expected_delivery ? Date.parse(a.expected_delivery) : Infinity;
            const timeB = b.expected_delivery ? Date.parse(b.expected_delivery) : Infinity;
            return timeA - timeB;
        });
        
        const shipSelect = document.getElementById('dispatch-shipment-select');
        shipSelect.innerHTML = '<option value="">Select final-leg shipment</option>';
        
        globalShipments.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            
            let deadlineStr = "";
            let prefix = "📦";
            if (s.expected_delivery) {
                const msDiff = Date.parse(s.expected_delivery) - Date.now();
                const hoursLeft = msDiff / (1000 * 60 * 60);
                if (hoursLeft < 0) {
                    deadlineStr = ` [🚨 OVERDUE by ${Math.abs(hoursLeft).toFixed(1)}h]`;
                    prefix = "🚨 [URGENT]";
                } else if (hoursLeft <= 12) {
                    deadlineStr = ` [⚠️ Due in ${hoursLeft.toFixed(1)}h]`;
                    prefix = "⚠️ [PRIORITY]";
                } else {
                    deadlineStr = ` [Due in ${hoursLeft.toFixed(1)}h]`;
                }
            }
            opt.innerText = `${prefix} #${s.id.substring(0,8)} - ${s.description} (${s.weight}kg)${deadlineStr} -> ${s.drop?.name || 'Local Destination'}`;
            shipSelect.appendChild(opt);
        });
    } catch(e) {
        console.error("Failed to load shipments", e);
    }
}

async function handleAddDrone(e) {
    e.preventDefault();
    const license = document.getElementById('dr-license').value;
    const capacity = parseFloat(document.getElementById('dr-capacity').value);
    const radius = parseFloat(document.getElementById('dr-radius').value);
    
    const newDrone = {
        license_number: license,
        capacity: capacity,
        radius: radius,
        base_warehouse_id: whId,
        company_id: companyId,
        status: "available",
        system_id: "DRN-" + Math.random().toString(36).substring(2,6).toUpperCase()
    };
    
    try {
        await apiCall('/manager/drones', 'POST', newDrone);
        document.getElementById('add-drone-form').reset();
        await loadDrones();
    } catch(err) {
        alert("Failed to add drone: " + err.message);
    }
}

async function deleteDrone(droneId) {
    if (!confirm("Are you sure you want to remove this drone?")) return;
    try {
        await apiCall(`/manager/drones/${droneId}`, 'DELETE');
        await loadDrones();
    } catch(err) {
        alert("Failed to delete drone.");
    }
}

async function dispatchDroneDelivery() {
    const shipmentId = document.getElementById('dispatch-shipment-select').value;
    const droneId = document.getElementById('dispatch-drone-select').value;
    
    if (!shipmentId || !droneId) {
        alert("Please select both a shipment and an available drone.");
        return;
    }
    
    const drone = globalDrones.find(d => d.id === droneId);
    const shipment = globalShipments.find(s => s.id === shipmentId);
    
    if (!drone || !shipment) return;
    
    // Assign shipment status & trigger flight animation
    try {
        // Mark shipment as in_transit and drone as in_flight
        await apiCall(`/manager/drones/${droneId}`, 'PUT', { status: "in_flight", battery: 95 });
        await apiCall(`/shipments/${shipmentId}/assign`, 'POST', {
            driver_id: null,
            vehicle_id: drone.id
        });
        
        // Trigger flight animation on Leaflet map
        animateDroneFlight(drone, shipment);
        
        await loadDrones();
        await loadPendingShipments();
    } catch(e) {
        alert("Failed to dispatch drone delivery.");
    }
}

function animateDroneFlight(drone, shipment) {
    const destLat = shipment.drop?.lat || (whLat + (Math.random() - 0.5) * 0.08);
    const destLng = shipment.drop?.lng || (whLng + (Math.random() - 0.5) * 0.08);
    
    // Draw route line
    const routeLine = L.polyline([[whLat, whLng], [destLat, destLng]], {
        color: '#a855f7',
        weight: 3,
        dashArray: '5, 10',
        opacity: 0.8
    }).addTo(map);
    
    // Create animated drone marker
    const droneDiv = L.divIcon({
        className: 'animated-drone-icon',
        html: `<div style="background:#a855f7; width:14px; height:14px; border-radius:50%; border:2px solid white; box-shadow:0 0 10px #a855f7; text-align:center; font-size:0.6rem; color:white; line-height:14px;">🛸</div>`,
        iconSize: [14, 14]
    });
    
    const droneMarker = L.marker([whLat, whLng], {icon: droneDiv}).addTo(map)
        .bindPopup(`<b>Drone ${drone.system_id}</b><br>Delivering Shipment #${shipment.id.substring(0,8)}`).openPopup();
        
    let progress = 0;
    const duration = 120; // 120 steps (~6 seconds)
    
    const interval = setInterval(async () => {
        progress++;
        const ratio = progress / duration;
        
        // Calculate current location
        const curLat = whLat + (destLat - whLat) * ratio;
        const curLng = whLng + (destLng - whLng) * ratio;
        
        droneMarker.setLatLng([curLat, curLng]);
        
        // Drain battery
        drone.battery = Math.max(10, Math.round(95 - ratio * 35));
        
        if (progress >= duration) {
            clearInterval(interval);
            
            // Delivery Complete logic
            droneMarker.bindPopup(`<b>Delivery Complete!</b>`).openPopup();
            
            setTimeout(async () => {
                map.removeLayer(droneMarker);
                map.removeLayer(routeLine);
                
                // Complete shipment status in backend
                try {
                    await apiCall(`/manager/shipments/${shipment.id}/complete-drone`, 'POST', {
                        drone_id: drone.id,
                        battery: drone.battery
                    });
                    
                    alert(`Drone ${drone.system_id} successfully delivered shipment #${shipment.id.substring(0,8)}!`);
                    await loadDrones();
                    await loadPendingShipments();
                } catch(e) {
                    console.error("Handoff completion failed", e);
                }
            }, 2000);
        }
    }, 50);
}

function updateDroneTelemetry() {
    // Regenerate / charge batteries slowly for available drones
    globalDrones.forEach(d => {
        if (d.status === 'available' && d.battery < 100) {
            d.battery = Math.min(100, d.battery + 2);
        }
    });
    renderDrones();
}

document.addEventListener('DOMContentLoaded', initDronesPage);
