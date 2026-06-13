// Dedicated script for executive_warehouses.html

let map, fleetMap;
let markers = [];
let currentMarkers = [];
let warehouses = [];
let pendingWhLoc = null;
let suggestedWhLoc = null;
let highlightCircle = null;

function initMap() {
    if (!document.getElementById('map')) return;
    if (map) return; // Prevent double initialization
    
    // Default to a central location (e.g., India center)
    map = L.map('map').setView([20.5937, 78.9629], 5);
    updateMapTheme(map);

    // Apply Official Indian Boundaries (SOI Compliant Overlay)
    applyOfficialBorders(map);

    const isWeatherPage = window.location.pathname.includes('executive_weather.html') || (typeof currentActiveSection !== 'undefined' && currentActiveSection === 'weather');
    if (isWeatherPage) {
        initWeatherMapOnMap(map);
        return;
    }

    // Map click to add warehouse
    map.on('click', e => processLocationDeployment(e.latlng.lat, e.latlng.lng));
    
    loadMapData();
}

async function processLocationDeployment(lat, lng) {
    // 1. Center Map & Add Temporary Marker
    map.setView([lat, lng], 13);
    
    // Smooth scroll to map
    document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (window.tempMarker) map.removeLayer(window.tempMarker);
    window.tempMarker = L.marker([lat, lng], { draggable: true }).addTo(map)
        .bindPopup("Selected Deployment Site").openPopup();
    
    window.tempMarker.on('dragend', function(e) {
        const newPos = e.target.getLatLng();
        processLocationDeployment(newPos.lat, newPos.lng);
    });

    // 2. WATER CHECK: Hardened detection for Oceans and Seas with timeout
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'LogistixLogisticsApp/1.0 (contact@logistix.com)'
            }
        });
        clearTimeout(timeoutId);
        
        const terrain = await response.json();
        
        if (terrain && !terrain.error) {
            const dName = (terrain.display_name || "").toLowerCase();
            const type = (terrain.type || "").toLowerCase();
            const category = (terrain.category || "").toLowerCase();
            
            const isWater = type === 'water' || 
                            type === 'river' ||
                            category === 'natural' || 
                            dName.includes('ocean') || 
                            dName.includes('sea') || 
                            dName.includes('bay') ||
                            dName.includes('river') ||
                            dName.includes('canal') ||
                            dName.includes('waterway');

            if (isWater) {
                return alert("🚨 Invalid Deployment Zone: Warehouse cannot be created in the middle of a water body.");
            }
        }
    } catch(e) {
        console.warn("Terrain check skipped due to API timeout or error:", e);
    }

    pendingWhLoc = { lat, lng };
    
    // 3. AI Check
    try {
        const res = await apiCall(`/manager/warehouses/suggest`, 'POST', {
            lat, lng, 
            company_id: localStorage.getItem('manager_id')
        });
        if (res.strategic_improvement || res.distance_km) {
            suggestedWhLoc = { lat: res.suggested_lat, lng: res.suggested_lng };
            document.getElementById('sug-dist').innerText = `${res.distance_km} km`;
            
            const reasonEl = document.getElementById('sug-reason');
            if (res.reason) {
                reasonEl.innerText = getTranslation(res.reason) || res.reason;
            }
            
            document.getElementById('suggestion-modal').style.display = 'block';
            if (window.updatePageTranslations) updatePageTranslations();
        } else {
            openWhModal(lat, lng);
        }
    } catch(err) {
        if (err.message && err.message.toLowerCase().includes("water body")) {
            if (window.tempMarker) map.removeLayer(window.tempMarker);
            return alert("🚨 " + err.message);
        }
        openWhModal(lat, lng);
    }
}

async function deployByPincode() {
    const pin = document.getElementById('search-pincode').value;
    if (!pin) return alert("Please enter a valid pincode");
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&postalcode=${pin}&country=India`, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'LogistixLogisticsApp/1.0 (contact@logistix.com)'
            }
        });
        clearTimeout(timeoutId);
        
        const res = await response.json();
        if (res && res.length > 0) {
            const { lat, lon } = res[0];
            processLocationDeployment(parseFloat(lat), parseFloat(lon));
        } else {
            alert("Pincode not found. Please try manual coordinates.");
        }
    } catch(e) {
        console.warn("Pincode search failed or timed out:", e);
        alert("Search failed or timed out. Check your connection.");
    }
}

async function deployByCoords() {
    const lat = parseFloat(document.getElementById('search-lat').value);
    const lng = parseFloat(document.getElementById('search-lng').value);
    
    if (isNaN(lat) || isNaN(lng)) return alert("Please enter valid Latitude and Longitude");
    processLocationDeployment(lat, lng);
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

async function triggerManualAICheck() {
    if (!pendingWhLoc) return;
    document.getElementById('wh-modal').style.display = 'none';
    processLocationDeployment(pendingWhLoc.lat, pendingWhLoc.lng);
}

async function loadMapData(retryCount = 0) {
    if (!map) return;

    try {
        const companyId = localStorage.getItem('manager_id');
        const [warehouses, allLeaves] = await Promise.all([
            apiCall(`/manager/warehouses/congestion?company_id=${companyId}`),
            apiCall(`/manager/warehouses/leave-requests?company_id=${companyId}`).catch(() => [])
        ]);
        
        // Clear temp marker only after successful fetch
        if (window.tempMarker) {
            map.removeLayer(window.tempMarker);
            window.tempMarker = null;
        }
        // Clear old markers only after successful fetch
        markers.forEach(m => map.removeLayer(m));
        markers = [];

        globalHubs = warehouses;
        globalWarehouses = warehouses;
        const activeLeaves = allLeaves.filter(l => l.status === 'approved');

        warehouses.forEach(w => {
            const isOnLeave = activeLeaves.find(l => l.warehouse_id === w.id);
            const icon = isOnLeave ? ICON_WAREHOUSE_LEAVE : ICON_WAREHOUSE;
            
            const m = L.marker([w.lat, w.lng], {icon: icon, title: w.name}).addTo(map)
                .bindPopup(`<b>Hub:</b> ${w.name}<br><small>Manager: ${w.manager_name}</small>${isOnLeave ? `<br><b style="color:var(--danger)">💤 ON LEAVE (${isOnLeave.start_date})</b>` : ''}`);
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
        
        await loadWarehousesList(warehouses);

    } catch(e) {
        console.error("Map Load Error:", e);
        if (typeof retryCount === 'number' && retryCount < 3) {
            console.log(`Retrying loadMapData in 1s (attempt ${retryCount + 1})...`);
            setTimeout(() => loadMapData(retryCount + 1), 1000);
        }
    }
}

async function loadWarehousesList(warehouses) {
    const tbody = document.getElementById('warehouses-table-body');
    if (!tbody) return;
    
    if (warehouses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;">${getTranslation('no_warehouses')}</td></tr>`;
        return;
    }
    
    const limit = window.tableLimits.warehouses;
    const limited = warehouses.slice(0, limit);

    // Fetch leave status for all warehouses
    const company_id = localStorage.getItem('manager_id');
    const allLeaves = await apiCall(`/manager/warehouses/leave-requests?company_id=${company_id}`).catch(() => []);
    const activeLeaves = allLeaves.filter(l => l.status === 'approved');

    tbody.innerHTML = limited.map(w => {
        const isOnLeave = activeLeaves.find(l => l.warehouse_id === w.id);
        const rowStyle = isOnLeave ? 'background:rgba(239, 68, 68, 0.05); border-left:4px solid var(--danger);' : '';
        
        // Extract congestion parameters
        const incomingCount = w.incoming_count || 0;
        const capacity = w.capacity || 5;
        const congestionPercentage = w.congestion_percentage || 0;
        const barColor = congestionPercentage > 90 ? '#ef4444' : (congestionPercentage > 70 ? '#f59e0b' : '#10b981');
        
        return `
        <tr id="row-wh-${w.id}" style="${rowStyle}">
            <td style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${w.id.substring(0,8)}</td>
            <td>
                <strong id="wh-name-display-${w.id}">${w.name}</strong>
                ${isOnLeave ? `<br><small style="color:var(--danger); font-weight:bold;">💤 ON LEAVE (${isOnLeave.start_date} to ${isOnLeave.end_date})</small>` : ''}
            </td>
            <td>
                <div style="font-size:0.85rem; font-weight:bold; color:var(--primary);" id="wh-manager-display-${w.id}">${w.manager_name || getTranslation('na')}</div>
                <div style="font-size:0.75rem; color:var(--text-muted);" id="wh-contact-display-${w.id}">📞 ${w.contact_number || getTranslation('na')}</div>
            </td>
            <td><span style="font-size:0.85rem;">${w.manager_email || getTranslation('na')}</span></td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="password" readonly value="${w.manager_password || ''}" id="wh-pass-${w.id}" 
                        style="background:transparent; border:none; color:var(--text); width:80px; font-size:0.85rem; pointer-events:none;">
                    <button onclick="toggleWhPass('${w.id}')" style="background:none; border:none; cursor:pointer; padding:0; font-size:1rem;">👁️</button>
                </div>
            </td>
            <td>
                <div style="display:flex; flex-direction:column; gap:4px; min-width:120px; padding-top:4px;">
                    <div style="display:flex; justify-content:space-between; font-size:0.75rem;">
                        <span style="color:var(--text-muted);">${incomingCount}/${capacity} inbound</span>
                        <span style="font-weight:bold; color:${barColor};">${congestionPercentage}%</span>
                    </div>
                    <div style="width:100%; height:8px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden; border: 1px solid rgba(255,255,255,0.04);">
                        <div style="width:${congestionPercentage}%; height:100%; background:linear-gradient(90deg, ${barColor} 0%, #3b82f6 100%); transition:width 0.5s ease;"></div>
                    </div>
                </div>
            </td>
            <td>
                <button class="btn-primary btn-outline" style="padding:6px 12px; font-size:0.75rem; display:flex; align-items:center; gap:4px; width:auto;" onclick="showCongestionForecast('${w.id}')">
                    📊 <span>Forecast</span>
                </button>
            </td>
            <td>${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}</td>
            <td>
                <div style="display:flex; gap:8px;">
                    <button class="btn-primary" style="padding:6px 12px; font-size:0.75rem; background:linear-gradient(135deg, #a855f7 0%, #6366f1 100%); border:none; box-shadow:0 2px 8px rgba(168,85,247,0.2);" onclick="triggerRegionalAIWarehouseReadiness('${w.id}')">🔮 AI Audit</button>
                    <button class="btn-primary btn-accent" style="padding:6px 12px; font-size:0.75rem;" onclick="openEditWarehouse('${w.id}')">✏️ ${getTranslation('edit')}</button>
                    <button class="btn-primary" style="padding:6px 12px; font-size:0.75rem;" onclick="locateWarehouse('${w.id}')">📍 ${getTranslation('locate')}</button>
                </div>
            </td>
        </tr>
        `;
    }).join('');

    renderTableControls('warehouses', warehouses.length, limit, 'refreshWarehousesTable');
}

let congestionChartInstance = null;

function showCongestionForecast(whId) {
    const wh = (globalWarehouses || []).find(w => w.id === whId);
    if (!wh) return;

    document.getElementById('congestion-wh-name').innerText = wh.name;
    document.getElementById('congestion-incoming-count').innerText = wh.incoming_count || 0;
    
    const adviceEl = document.getElementById('congestion-advice');
    adviceEl.innerText = wh.mitigation_advice || "Operations Normal (Optimal Capacity)";
    adviceEl.style.color = wh.needs_mitigation ? "var(--danger)" : "var(--success)";

    document.getElementById('congestion-modal').style.display = 'block';

    const ctx = document.getElementById('congestion-chart').getContext('2d');
    if (congestionChartInstance) {
        congestionChartInstance.destroy();
    }

    const labels = wh.forecast.map(f => f.hour);
    const dataLoads = wh.forecast.map(f => f.predicted_load);
    const dataCongestion = wh.forecast.map(f => f.predicted_congestion);

    congestionChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Predicted Congestion',
                data: dataCongestion,
                borderColor: '#4f8cff',
                backgroundColor: 'rgba(79, 140, 255, 0.15)',
                borderWidth: 2.5,
                tension: 0.4,
                fill: true,
                pointRadius: 2,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed.y;
                            const idx = context.dataIndex;
                            const load = dataLoads[idx];
                            return ` Congestion: ${val}% (Load: ${load}/${wh.capacity || 5})`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    min: 0,
                    max: 100,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.6)',
                        callback: function(value) { return value + '%'; }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.6)',
                        maxTicksLimit: 8
                    }
                }
            }
        }
    });
}
window.showCongestionForecast = showCongestionForecast;

function locateWarehouse(id) {
    const marker = markers.find(m => m.whId === id);
    if (marker) {
        map.setView(marker.getLatLng(), 15);
        marker.openPopup();

        // Smooth scroll to map
        document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
        
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
        document.getElementById('edit-wh-email').value = w.manager_email || '';
        document.getElementById('edit-wh-password').value = w.manager_password || '';
        document.getElementById('edit-wh-capacity').value = w.capacity || 5;

        document.getElementById('wh-edit-modal').style.display = 'block';
    } catch(e) {}
}

async function submitEditWarehouse() {
    const id = document.getElementById('edit-wh-id').value;
    const name = document.getElementById('edit-wh-name').value;
    const manager = document.getElementById('edit-wh-manager').value;
    const contact = document.getElementById('edit-wh-contact').value;
    const email = document.getElementById('edit-wh-email').value;
    const password = document.getElementById('edit-wh-password').value;
    const capacity = parseInt(document.getElementById('edit-wh-capacity').value) || 5;

    if (!name || !manager || !contact || !email || !password) return alert("All fields are required.");

    try {
        await apiCall(`/manager/warehouses/${id}?company_id=${localStorage.getItem('manager_id')}`, 'PUT', {
            name, 
            manager_name: manager, 
            contact_number: contact,
            manager_email: email,
            manager_password: password,
            capacity: capacity
        });
        document.getElementById('wh-edit-modal').style.display = 'none';
        loadMapData();
        if (typeof loadDriversAndVehicles === 'function') loadDriversAndVehicles();
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
        if (typeof loadDriversAndVehicles === 'function') loadDriversAndVehicles();
    } catch(e) {
        alert("Failed to decommission warehouse.");
    }
}

function openWhModal(lat, lng) {
    pendingWhLoc = {lat, lng};
    document.getElementById('display-lat').innerText = lat.toFixed(6);
    document.getElementById('display-lng').innerText = lng.toFixed(6);
    document.getElementById('wh-modal').style.display = 'block';
}

async function submitNewWarehouse() {
    const name = document.getElementById('wh-name-input').value;
    const manager = document.getElementById('wh-manager-input').value;
    const contact = document.getElementById('wh-contact-input').value;
    const email = document.getElementById('wh-email-input').value;
    const password = document.getElementById('wh-password-input').value;
    const capacity = parseInt(document.getElementById('wh-capacity-input').value) || 5;
    
    if (!pendingWhLoc || isNaN(pendingWhLoc.lat) || isNaN(pendingWhLoc.lng)) {
        return alert("Error: No location selected on the map. Please click the map first.");
    }
    
    if (!name || !manager || !contact || !email || !password) {
        return alert("Error: Warehouse Name, Manager Name, Contact, Email and Password are all required.");
    }
    
    const success = await createWarehouse(name, pendingWhLoc.lat, pendingWhLoc.lng, manager, contact, email, password, capacity);
    if (success) {
        document.getElementById('wh-modal').style.display = 'none';
        document.getElementById('wh-name-input').value = '';
        document.getElementById('wh-manager-input').value = '';
        document.getElementById('wh-contact-input').value = '';
        document.getElementById('wh-email-input').value = '';
        document.getElementById('wh-password-input').value = '';
        document.getElementById('wh-capacity-input').value = '5';
    }
}

async function createWarehouse(name, lat, lng, manager = '', contact = '', email = '', password = '', capacity = 5) {
    try {
        await apiCall('/manager/warehouses', 'POST', {
            company_id: localStorage.getItem('manager_id'),
            name, lat, lng,
            manager_name: manager, 
            contact_number: contact,
            manager_email: email,
            manager_password: password,
            capacity: capacity
        });
        loadMapData();
        if (typeof loadDriversAndVehicles === 'function') loadDriversAndVehicles();
        return true;
    } catch(e) {
        console.error("Create warehouse failed:", e);
        return false;
    }
}

async function adoptStrategicLocation() {
    const manager = document.getElementById('sug-manager').value;
    const contact = document.getElementById('sug-contact').value;
    const email = document.getElementById('sug-email').value;
    const password = document.getElementById('sug-password').value;

    if (!manager || !contact || !email || !password) {
        return alert("Error: Manager Name, Contact, Email and Password are required for AI-suggested hubs.");
    }
    const name = prompt("Enter Warehouse Name for Strategic Hub:");
    const capacity = parseInt(document.getElementById('sug-capacity').value) || 5;
    if (name) {
        const success = await createWarehouse(name, suggestedWhLoc.lat, suggestedWhLoc.lng, manager, contact, email, password, capacity);
        if (success) {
            document.getElementById('suggestion-modal').style.display = 'none';
            document.getElementById('sug-manager').value = '';
            document.getElementById('sug-contact').value = '';
            document.getElementById('sug-email').value = '';
            document.getElementById('sug-password').value = '';
            document.getElementById('sug-capacity').value = '5';
        }
    }
}

async function stayWithManualLocation() {
    const manager = document.getElementById('sug-manager').value;
    const contact = document.getElementById('sug-contact').value;
    const email = document.getElementById('sug-email').value;
    const password = document.getElementById('sug-password').value;

    if (!manager || !contact || !email || !password) {
        return alert("Error: Manager Name, Contact, Email and Password are required.");
    }

    const name = prompt("Enter Warehouse Name for Manual Hub:");
    const capacity = parseInt(document.getElementById('sug-capacity').value) || 5;
    if (name) {
        const success = await createWarehouse(name, pendingWhLoc.lat, pendingWhLoc.lng, manager, contact, email, password, capacity);
        if (success) {
            document.getElementById('suggestion-modal').style.display = 'none';
            document.getElementById('sug-manager').value = '';
            document.getElementById('sug-contact').value = '';
            document.getElementById('sug-email').value = '';
            document.getElementById('sug-password').value = '';
            document.getElementById('sug-capacity').value = '5';
        }
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

function showInfoTip(el) {
    const tip = el.getAttribute('data-tip');
    if (!tip) return;
    // Remove existing tips to avoid stacking
    const existing = document.querySelectorAll('.oracle-tip-toast');
    existing.forEach(t => t.remove());

    const div = document.createElement('div');
    div.className = 'oracle-tip-toast';
    div.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.9);
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(20px);
        color: white;
        padding: 30px;
        border-radius: 24px;
        z-index: 100000;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        border: 1px solid var(--primary);
        max-width: 400px;
        width: 90%;
        text-align: center;
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    `;
    
    div.innerHTML = `
        <div style="font-size: 2.5rem; margin-bottom: 15px;">💡</div>
        <h3 style="margin: 0 0 10px 0; color: var(--primary);">Intelligence Insight</h3>
        <p style="margin: 0; font-size: 1rem; line-height: 1.6; opacity: 0.9;">${tip}</p>
        <button class="btn-primary" style="margin-top: 25px; width: auto; padding: 10px 30px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);" onclick="this.parentElement.remove()">Got it</button>
    `;
    
    document.body.appendChild(div);
    
    // Trigger animation
    setTimeout(() => {
        div.style.opacity = '1';
        div.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 10);

    // Auto-close on outside click
    const closer = (e) => {
        if (!div.contains(e.target) && e.target !== el) {
            div.remove();
            document.removeEventListener('click', closer);
        }
    };
    setTimeout(() => document.addEventListener('click', closer), 100);
}

async function initPage() {
    initMap(); loadMapData();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
} else {
    initPage();
}

window.addEventListener('themeChanged', () => {
    if (map) {
        updateMapTheme(map);
    }
});

// Expose functions to global window scope for inline HTML event handlers
window.loadMapData = loadMapData;
window.deployByPincode = deployByPincode;
window.deployByCoords = deployByCoords;
window.triggerManualAICheck = triggerManualAICheck;
window.locateWarehouse = locateWarehouse;
window.openEditWarehouse = openEditWarehouse;
window.submitEditWarehouse = submitEditWarehouse;
window.decommissionWarehouse = decommissionWarehouse;
window.submitNewWarehouse = submitNewWarehouse;
window.adoptStrategicLocation = adoptStrategicLocation;
window.stayWithManualLocation = stayWithManualLocation;
window.toggleWhPass = function(id) {
    const input = document.getElementById(`wh-pass-${id}`);
    if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
    }
};
window.refreshWarehousesTable = function() {
    loadWarehousesList(globalWarehouses || globalHubs || []);
};

async function triggerRegionalAIWarehouseReadiness(whId) {
    const reportDiv = document.getElementById('wh-readiness-report');
    const modal = document.getElementById('wh-readiness-modal');
    if (!reportDiv || !modal) return;
    
    // Check key before calling API
    await ensureGeminiApiKey();
    
    reportDiv.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px 0;">🔮 Running AI hub readiness & resource check... Please wait.</p>';
    modal.style.display = 'block';
    
    try {
        const companyId = localStorage.getItem('manager_id');
        const res = await apiCall(`/manager/ai/wh-readiness`, 'POST', { 
            company_id: companyId,
            warehouse_id: whId
        });
        reportDiv.innerHTML = parseMarkdownToHtml(res.report);
    } catch(err) {
        reportDiv.innerHTML = `<p style="color:var(--danger);">Failed to generate AI Hub Readiness report: ${err.message}</p>`;
    }
}
window.triggerRegionalAIWarehouseReadiness = triggerRegionalAIWarehouseReadiness;