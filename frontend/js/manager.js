// Manager Dashboard Logic

// Auth Check
if (!localStorage.getItem('manager_id')) {
    window.location.href = '../index.html';
    throw new Error("Redirecting to login...");
}

const mName = localStorage.getItem('manager_name') || getTranslation('manager');
const nameEl = document.getElementById('manager-name');
if (nameEl) nameEl.innerText = mName;

function showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '30px';
    toast.style.background = type === 'success' ? '#48bb78' : (type === 'error' ? '#e53e3e' : '#3182ce');
    toast.style.color = 'white';
    toast.style.zIndex = '100000';
    toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
    toast.style.fontWeight = 'bold';
    toast.style.fontSize = '0.9rem';
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

window.tableLimits = {
    shipments: 5,
    drivers: 5,
    vehicles: 5,
    drones: 5,
    'linked-pairs': 5,
    warehouses: 100,
    nr: 5
};

window.renderTableControls = function(tableKey, dataLength, currentLimit, updateFn) {
    const containerId = `${tableKey}-controls`;
    let container = document.getElementById(containerId);
    if (!container) {
        const tableBody = document.getElementById(`${tableKey}-table-body`);
        const table = tableBody?.closest('table');
        if (!table) return;
        container = document.createElement('div');
        container.id = containerId;
        container.className = 'table-controls-container';
        container.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:12px; background:rgba(255,255,255,0.03); border-radius:0 0 12px 12px; border-top:1px solid var(--border); margin-top:-1px;';
        table.parentNode.insertBefore(container, table.nextSibling);
    }

    if (dataLength <= 5 && currentLimit <= 5) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';

    container.innerHTML = `
        <div style="font-size:0.75rem; color:var(--text-muted);">
            Showing ${Math.min(currentLimit, dataLength)} of ${dataLength}
        </div>
        <div style="display:flex; gap:8px;">
            ${currentLimit > 5 ? `<button class="btn-primary" style="padding:6px 14px; font-size:0.75rem; background:rgba(var(--primary-rgb), 0.1); color:var(--primary); border:1px solid rgba(var(--primary-rgb), 0.4); font-weight:600; border-radius:6px; cursor:pointer;" onclick="tableLimits['${tableKey}'] -= 5; ${updateFn}()">${getTranslation('btn_show_less')}</button>` : ''}
            ${currentLimit < dataLength ? `<button class="btn-primary" style="padding:6px 14px; font-size:0.75rem; background:linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%); color:white; border:none; font-weight:600; border-radius:6px; cursor:pointer; box-shadow:0 4px 12px rgba(var(--primary-rgb),0.3);" onclick="tableLimits['${tableKey}'] += 5; ${updateFn}()">${getTranslation('btn_show_more')}</button>` : ''}
        </div>
    `;
};

let map, fleetMap;
let markers = [];
let globalHubs = [];
let globalDrivers = [];
let globalRisks = [];
let globalVehicles = [];
let volumeChart, fleetChart;
let weatherMarkers = [];
window.simulationPanelClosedByUser = false;
let currentMarkers = [];
let warehouses = [];
let globalDrones = [];
let globalWarehouses = [];
let globalShipments = [];
let currentAssignId = null;
let currentSplitId = null;

const ICON_PICKUP = L.divIcon({
    html: `<div style="background:#3b82f6; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px rgba(59,130,246,0.6); font-size:18px; color:white;">📍</div>`,
    className: 'custom-marker', iconSize: [34, 34], iconAnchor: [17, 17]
});

const ICON_DROP = L.divIcon({
    html: `<div style="background:#10b981; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px rgba(16,185,129,0.6); font-size:18px; color:white;">🏁</div>`,
    className: 'custom-marker', iconSize: [34, 34], iconAnchor: [17, 17]
});

const ICON_WAREHOUSE = L.divIcon({
    html: `<div style="background:#8b5cf6; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px rgba(139,92,246,0.6); font-size:18px; color:white;">🏘️</div>`,
    className: 'custom-marker', iconSize: [34, 34], iconAnchor: [17, 17]
});

const ICON_WAREHOUSE_LEAVE = L.divIcon({
    html: `<div style="background:#ef4444; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px rgba(239,68,68,0.6); font-size:18px; color:white;">💤</div>`,
    className: 'custom-marker', iconSize: [34, 34], iconAnchor: [17, 17]
});

// Real-time Refresh Loop
let lastMsgCount = parseInt(localStorage.getItem('last_seen_msg_count') || '-1');
let currentActiveSection = 'analytics';
let selectedDriverChatId = null;
let currentLookedUpReceiverId = null;
let isSimulationMode = false;

async function checkSimulationStatus() {
    try {
        const status = await apiCall('/simulation/mode/status', 'GET', null, true);
        isSimulationMode = status.active;
        const toggle = document.getElementById('global-sim-toggle');
        const container = document.getElementById('sim-mode-toggle-container');
        if (toggle) toggle.checked = isSimulationMode;
        if (container) {
            if (isSimulationMode) container.classList.add('active');
            else container.classList.remove('active');
        }
    } catch (e) {}
}

async function toggleGlobalSimulationMode(active) {
    const container = document.getElementById('sim-mode-toggle-container');
    try {
        const endpoint = active ? '/simulation/mode/start' : '/simulation/mode/stop';
        const res = await apiCall(endpoint, 'POST');
        isSimulationMode = active;
        
        if (active) {
            container.classList.add('active');
            alert("🚀 Simulation Mode ACTIVE. The platform is now in a Sandbox state. State snapshot created.");
        } else {
            container.classList.remove('active');
            alert("🛑 Simulation Mode DEACTIVATED. System has been reverted to the previous normal state.");
        }
        
        // Full refresh
        loadShipments();
        loadInsights();
        loadMapData();
        if (typeof renderDriverPointsSummary === 'function') renderDriverPointsSummary();
        if (typeof loadDriversAndVehicles === 'function') loadDriversAndVehicles();
        
    } catch (e) {
        console.error("Simulation toggle failed:", e);
        document.getElementById('global-sim-toggle').checked = !active;
        alert("Failed to toggle Simulation Mode. Ensure the backend is running.");
    }
}

// Call check status on init
setTimeout(checkSimulationStatus, 1000);

setInterval(async () => {
    const activeSection = document.querySelector('.section-content:not([style*="display: none"])');
    if (activeSection && activeSection.id === 'shipments') {
        loadShipments();
    }
    checkSimulationStatus();
    
    // Background message check for notifications
    try {
        const mId = localStorage.getItem('manager_id');
        if (!mId || mId === "null") return;
        const msgs = await apiCall(`/tracking/messages/${mId}?company_id=${mId}`, 'GET', null, true);
        
        // Show notification if total count has increased since last SEEN
        if (msgs.length > lastMsgCount) {
            if (currentActiveSection !== 'messages') {
                const badge = document.getElementById('msg-badge');
                if (badge) {
                    badge.style.display = 'inline-block';
                    badge.style.background = 'var(--danger)';
                    badge.style.width = '8px';
                    badge.style.height = '8px';
                    badge.style.borderRadius = '50%';
                    badge.style.border = '2px solid var(--bg)';
                }
                const link = document.getElementById('nav-link-messages');
                if (link) {
                    link.style.fontWeight = '900';
                    link.style.color = 'var(--text)';
                }
            } else {
                // If already in messages section, update the chat but also update the "seen" count
                lastMsgCount = msgs.length;
                localStorage.setItem('last_seen_msg_count', lastMsgCount);
                loadMessages(); // Refresh chat list/window
            }
        }
    } catch(e) {}
}, 5000); // Check every 5s for snappier feel

// Poll for pending driver fund requests → update Paisa-Fast badge
setInterval(async () => {
    try {
        const companyId = localStorage.getItem('manager_id');
        if (!companyId || companyId === "null") return;
        const fundRequests = await apiCall(`/manager/finance/fund-requests?company_id=${companyId}`);
        const badge = document.getElementById('paisa-badge');
        const link = document.getElementById('nav-link-paisa-fast');
        if (fundRequests.length > 0 && currentActiveSection !== 'paisa-fast') {
            if (badge) {
                badge.style.display = 'inline-block';
                badge.style.background = 'var(--danger)';
                badge.style.width = '8px';
                badge.style.height = '8px';
                badge.style.borderRadius = '50%';
                badge.style.border = '2px solid var(--bg)';
                badge.style.marginLeft = '4px';
            }
            if (link) {
                link.style.fontWeight = '900';
                link.style.color = 'var(--text)';
            }
        } else {
            if (badge) badge.style.display = 'none';
            if (link) {
                link.style.fontWeight = '';
                link.style.color = '';
            }
        }
    } catch(e) {}
}, 8000); // Check every 8s

function updateMapTheme(mapInstance) {
    if (!mapInstance) return;
    const theme = localStorage.getItem('theme') || 'dark';
    const tileUrl = theme === 'dark' 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    
    // Find and remove existing tile layer
    mapInstance.eachLayer(layer => {
        if (layer instanceof L.TileLayer && !layer.options.isOverlay) {
            mapInstance.removeLayer(layer);
        }
    });

    L.tileLayer(tileUrl, {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(mapInstance);
}

function initMap() {
    if (!document.getElementById('map')) return;
    if (map) return; // Prevent double initialization
    
    // Default to a central location (e.g., India center)
    map = L.map('map').setView([20.5937, 78.9629], 5);
    updateMapTheme(map);

    // Apply Official Indian Boundaries (SOI Compliant Overlay)
    applyOfficialBorders(map);

    const isWeatherPage = window.location.pathname.includes('manager_weather.html') || (typeof currentActiveSection !== 'undefined' && currentActiveSection === 'weather');
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
            apiCall(`/manager/warehouses?company_id=${companyId}`),
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
        // Retry logic: if the server is reloading, try again in 1 second (up to 3 times)
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
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">${getTranslation('no_warehouses')}</td></tr>`;
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
            <td>${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}</td>
            <td>
                <div style="display:flex; gap:8px;">
                    <button class="btn-primary btn-accent" style="padding:6px 12px; font-size:0.75rem;" onclick="openEditWarehouse('${w.id}')">✏️ ${getTranslation('edit')}</button>
                    <button class="btn-primary" style="padding:6px 12px; font-size:0.75rem;" onclick="locateWarehouse('${w.id}')">📍 ${getTranslation('locate')}</button>
                </div>
            </td>
        </tr>
        `;
    }).join('');

    renderTableControls('warehouses', warehouses.length, limit, 'refreshWarehousesTable');
}

window.toggleWhPass = function(id) {
    const input = document.getElementById(`wh-pass-${id}`);
    if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
    }
};

window.refreshWarehousesTable = function() {
    loadWarehousesList(globalHubs);
};

let highlightCircle = null;
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

    if (!name || !manager || !contact || !email || !password) return alert("All fields are required.");

    try {
        await apiCall(`/manager/warehouses/${id}?company_id=${localStorage.getItem('manager_id')}`, 'PUT', {
            name, 
            manager_name: manager, 
            contact_number: contact,
            manager_email: email,
            manager_password: password
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
    
    if (!pendingWhLoc || isNaN(pendingWhLoc.lat) || isNaN(pendingWhLoc.lng)) {
        return alert("Error: No location selected on the map. Please click the map first.");
    }
    
    if (!name || !manager || !contact || !email || !password) {
        return alert("Error: Warehouse Name, Manager Name, Contact, Email and Password are all required.");
    }
    
    const success = await createWarehouse(name, pendingWhLoc.lat, pendingWhLoc.lng, manager, contact, email, password);
    if (success) {
        document.getElementById('wh-modal').style.display = 'none';
        document.getElementById('wh-name-input').value = '';
        document.getElementById('wh-manager-input').value = '';
        document.getElementById('wh-contact-input').value = '';
        document.getElementById('wh-email-input').value = '';
        document.getElementById('wh-password-input').value = '';
    }
}

async function createWarehouse(name, lat, lng, manager = '', contact = '', email = '', password = '') {
    try {
        await apiCall('/manager/warehouses', 'POST', {
            company_id: localStorage.getItem('manager_id'),
            name, lat, lng,
            manager_name: manager, 
            contact_number: contact,
            manager_email: email,
            manager_password: password
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
    if (name) {
        const success = await createWarehouse(name, suggestedWhLoc.lat, suggestedWhLoc.lng, manager, contact, email, password);
        if (success) {
            document.getElementById('suggestion-modal').style.display = 'none';
            document.getElementById('sug-manager').value = '';
            document.getElementById('sug-contact').value = '';
            document.getElementById('sug-email').value = '';
            document.getElementById('sug-password').value = '';
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
    if (name) {
        const success = await createWarehouse(name, pendingWhLoc.lat, pendingWhLoc.lng, manager, contact, email, password);
        if (success) {
            document.getElementById('suggestion-modal').style.display = 'none';
            document.getElementById('sug-manager').value = '';
            document.getElementById('sug-contact').value = '';
            document.getElementById('sug-email').value = '';
            document.getElementById('sug-password').value = '';
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

function showSection(id) {
    const pageToSection = {
        'manager_analytics.html': 'analytics',
        'manager_warehouses.html': 'warehouses',
        'manager_shipments.html': 'shipments',
        'manager_receivers.html': 'receivers',
        'manager_drivers.html': 'drivers',
        'manager_weather.html': 'weather',
        'manager_messages.html': 'messages',
        'manager_leaderboard.html': 'leaderboard',
        'manager_verifications.html': 'verifications',
        'manager_safety.html': 'safety',
        
        'manager_oracle.html': 'oracle',
        'manager_fuel_oracle.html': 'fuel-oracle',
        'manager_payments.html': 'paisa-fast',
        'manager_strategy.html': 'strategy-plan',
        'manager_resilience.html': 'network-resilience',
        'manager_system.html': 'system',
        'manager_hub_leaves.html': 'hub-leaves'
    };
    const currentFilename = window.location.pathname.split('/').pop();
    const currentSection = pageToSection[currentFilename] || 'analytics';
    
    if (id !== currentSection && pageToSection[currentFilename]) {
        const targetPage = Object.keys(pageToSection).find(key => pageToSection[key] === id);
        if (targetPage) {
            window.location.href = targetPage;
            return;
        }
    }
    
    currentActiveSection = id;
    const sections = ['analytics', 'warehouses', 'shipments', 'receivers', 'drivers', 'weather', 'leaderboard', 'messages', 'verifications', 'safety', 'ledger', 'oracle', 'fuel-oracle', 'paisa-fast', 'strategy-plan', 'network-resilience', 'system', 'hub-leaves'];
    sections.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = s === id ? 'block' : 'none';
    });

    if (id === 'fuel-oracle') {
        loadFuelPrices();
        initFuelTrendChart();
    }
    if (id === 'paisa-fast') {
        initFintechOracle();
    }

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('onclick')?.includes(`'${id}'`) || link.getAttribute('href')?.includes(currentFilename)) {
            link.classList.add('active');
        }
    });

    // Clear notifications if messages section
    if (id === 'messages') {
        const badge = document.getElementById('msg-badge');
        if (badge) badge.style.display = 'none';
        const link = document.getElementById('nav-link-messages');
        if (link) {
            link.style.fontWeight = '600';
            link.style.color = 'var(--muted)';
        }
        
        // Mark as seen
        apiCall(`/tracking/messages/${localStorage.getItem('manager_id')}?company_id=${localStorage.getItem('manager_id')}`)
            .then(msgs => {
                lastMsgCount = msgs.length;
                localStorage.setItem('last_seen_msg_count', lastMsgCount);
            });
    }

    // Specific loads
    if (id === 'analytics') loadInsights();
    if (id === 'warehouses') {
        if (!map) initMap();
        else setTimeout(() => map.invalidateSize(), 200);
        loadMapData();
    }
    if (id === 'shipments') loadShipments();
    if (id === 'receivers') loadReceivers();
    if (id === 'drivers') loadDriversAndVehicles();
    if (id === 'weather') {
        if (!map) initMap();
        else setTimeout(() => map.invalidateSize(true), 200);
    }
    if (id === 'leaderboard') loadLeaderboard();
    if (id === 'messages') loadMessages();
    if (id === 'verifications') loadVerifications();
    if (id === 'safety') loadSafetyCenter();
    if (id === 'ledger') loadLedger();
    if (id === 'oracle') loadOracleInsights();
    if (id === 'strategy-plan') loadActiveStrategy();
    if (id === 'network-resilience') loadNetworkResilience();
    if (id === 'hub-leaves') loadHubLeaves();
}

function loadVerifications() {
    loadDriversAndVehicles();
}

const pageToSectionInit = {
    'manager_analytics.html': 'analytics',
    'manager_warehouses.html': 'warehouses',
    'manager_shipments.html': 'shipments',
    'manager_receivers.html': 'receivers',
    'manager_drivers.html': 'drivers',
    'manager_weather.html': 'weather',
    'manager_messages.html': 'messages',
    'manager_leaderboard.html': 'leaderboard',
    'manager_verifications.html': 'verifications',
    'manager_safety.html': 'safety',
    
    'manager_oracle.html': 'oracle',
    'manager_fuel_oracle.html': 'fuel-oracle',
    'manager_payments.html': 'paisa-fast',
    'manager_strategy.html': 'strategy-plan',
    'manager_resilience.html': 'network-resilience',
    'manager_system.html': 'system',
    'manager_hub_leaves.html': 'hub-leaves'
};
const initialFilename = window.location.pathname.split('/').pop();
const initialSection = pageToSectionInit[initialFilename] || 'analytics';
showSection(initialSection);
loadDriversAndVehicles(); // Pre-load fleet data

function logout() {
    localStorage.clear();
    window.location.href = '../index.html';
}

// Init Company ID display
const compId = localStorage.getItem('manager_id');
const compIdDisplay = document.getElementById('display-company-id');
if (compIdDisplay && compId) {
    compIdDisplay.innerText = compId;
}

function copyCompanyID() {
    const id = document.getElementById('display-company-id').innerText;
    navigator.clipboard.writeText(id).then(() => {
        alert("Company ID copied to clipboard! 📋");
    });
}

async function loadInsights() {
    try {
        const company_id = localStorage.getItem('manager_id');
        const container = document.getElementById('alerts-container');
        if (!container) return;
        
        // Load data in parallel but handle errors individually
        const [alerts, stats, cascade, pl] = await Promise.all([
            apiCall(`/tracking/alerts/active?company_id=${company_id}`).catch(err => { console.error("Alerts failed:", err); return []; }),
            apiCall(`/manager/dashboard/stats?company_id=${company_id}`).catch(err => { console.error("Stats failed:", err); return null; }),
            apiCall(`/manager/analytics/cascade?company_id=${company_id}`).catch(err => { console.error("Cascade failed:", err); return { risks: [], active_risk_count: 0, total_impact_hours: 0 }; }),
            apiCall(`/manager/finance/p-and-l?company_id=${company_id}`).catch(err => { console.error("P&L failed:", err); return { net_profit: 0 }; })
        ]);
        
        // Update Stats Grid if stats loaded
        if (stats) {
            document.getElementById('stat-timely').innerText = `${stats.timely_percent || 0}%`;
            document.getElementById('stat-delay').innerText = `${stats.avg_delay_mins || 0}m`;
            document.getElementById('stat-active').innerText = stats.active_shipments || 0;
            document.getElementById('stat-drivers').innerText = stats.total_drivers || 0;
            document.getElementById('stat-warehouses').innerText = stats.total_warehouses || 0;
            document.getElementById('stat-vehicles').innerText = stats.total_vehicles || 0;
            
            // Render Charts
            renderManagerCharts(stats);
        }
        
        if (document.getElementById('stat-profits')) {
            document.getElementById('stat-profits').innerText = `₹ ${(pl.net_profit || 0).toLocaleString()}`;
        }

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

    // Global Font Settings
    const chartFont = {
        family: "'Manrope', sans-serif",
        size: 13,
        weight: '600'
    };

    volumeChart = new Chart(volCtx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Shipment Volume',
                data: stats.volume_data,
                borderColor: '#4f8cff',
                backgroundColor: 'rgba(79, 140, 255, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#4f8cff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false }
            },
            scales: { 
                y: { 
                    beginAtZero: true, 
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: { color: '#94a3b8', font: chartFont, padding: 10 }
                }, 
                x: { 
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: chartFont, padding: 10 }
                } 
            }
        }
    });

    fleetChart = new Chart(fleetCtx, {
        type: 'doughnut',
        data: {
            labels: ['In-Transit', 'Available', 'Maintenance'],
            datasets: [{
                data: [stats.fleet_dist.in_transit, stats.fleet_dist.available, stats.fleet_dist.maintenance],
                backgroundColor: ['#4f8cff', '#10b981', '#ef4444'],
                borderWidth: 0,
                hoverOffset: 15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true, // Keep it circular
            cutout: '75%',
            plugins: { 
                legend: { 
                    position: 'bottom', 
                    labels: { 
                        color: '#94a3b8', 
                        font: chartFont,
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    } 
                } 
            }
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
        <div class="glass-card" style="padding:24px; border-left: 4px solid ${r.severity==='high'?'var(--danger)':'var(--warning)'}; background:rgba(255,255,255,0.02); margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                <span style="font-size:0.75rem; color:var(--muted); font-weight:bold; letter-spacing:0.05em;">SOURCE: ${r.source_shipment_id.slice(0,8)}</span>
                <span class="status-pill" style="background:${r.severity==='high'?'var(--danger)':'var(--warning)'}22; color:${r.severity==='high'?'var(--danger)':'var(--warning)'}; font-size:0.7rem;">${r.severity.toUpperCase()} RISK</span>
            </div>
            <h3 style="margin:8px 0; font-size:1.1rem;">${r.description}</h3>
            <p style="font-size:0.9rem; color:var(--danger); font-weight:600; margin-bottom:16px;">Current Deviation: +${r.current_delay}</p>
            
            <div style="border-top: 1px solid var(--border); padding-top:16px;">
                <small style="color:var(--muted); display:block; margin-bottom:8px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em;">Predicted Hub Impacts:</small>
                ${r.impact_hubs.map(h => `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:0.85rem;">
                        <span style="font-weight:600;">📍 ${h.location}</span>
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
        globalRisks = data.risks;
        if (data.risks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="padding:40px; text-align:center; color:var(--text-muted);">No disruption chains detected.</td></tr>`;
        } else {
            const limit = window.tableLimits.nr;
            const limited = data.risks.slice(0, limit);
            tbody.innerHTML = limited.map(r => `
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
            renderTableControls('nr', data.risks.length, limit, 'refreshRisksTable');
        }

    } catch(e) {
        console.error("Resilience Load Error", e);
    }
}

window.refreshRisksTable = function() {
    // We re-use the logic from loadNetworkResilience but without the API call
    const tbody = document.getElementById('nr-table-body');
    const limit = window.tableLimits.nr;
    const limited = globalRisks.slice(0, limit);
    tbody.innerHTML = limited.map(r => `
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
    renderTableControls('nr', globalRisks.length, limit, 'refreshRisksTable');
};

async function loadSafetyCenter() {
    try {
        const mId = localStorage.getItem('manager_id');
        const [drivers, alerts, shipments] = await Promise.all([
            apiCall(`/manager/drivers?company_id=${mId}`),
            apiCall(`/tracking/alerts/active?company_id=${mId}`),
            apiCall(`/shipments?company_id=${mId}`)
        ]);

        // Calculate Fleet Safety Index
        const avgScore = drivers.length ? drivers.reduce((acc, d) => acc + (d.driving_score || 95), 0) / drivers.length : 100;
        const safetyIndexEl = document.getElementById('fleet-safety-index');
        if (safetyIndexEl) {
            safetyIndexEl.innerText = `${avgScore.toFixed(1)}%`;
            safetyIndexEl.style.color = avgScore > 85 ? 'var(--success)' : (avgScore > 70 ? 'var(--warning)' : 'var(--danger)');
        }

        // 1. Fatigue Alerts
        const fatigueContainer = document.getElementById('fatigue-alerts-list');
        const tiredDrivers = drivers.filter(d => (d.fatigue_score || 0) > 65).sort((a,b) => b.fatigue_score - a.fatigue_score);
        fatigueContainer.innerHTML = tiredDrivers.length ? tiredDrivers.map(d => `
            <div class="glass-card" style="margin-bottom:12px; border-left:4px solid ${d.fatigue_score > 85 ? 'var(--danger)' : 'var(--warning)'}; padding:14px; background:rgba(255,255,255,0.02);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:800; font-size:1rem;">${d.name}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">ID: ${d.login_id} • ${d.license_type}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="color:${d.fatigue_score > 85 ? 'var(--danger)' : 'var(--warning)'}; font-weight:900; font-size:1.2rem;">${d.fatigue_score.toFixed(0)}%</div>
                        <small style="text-transform:uppercase; font-size:0.6rem; letter-spacing:1px; color:var(--text-muted);">FATIGUE LEVEL</small>
                    </div>
                </div>
                <div style="display:flex; gap:10px; margin-top:12px;">
                    <button class="btn-primary" style="flex:1; padding:8px; font-size:0.7rem; background:var(--danger);" onclick="openMessageModal('null', '${d.id}', 'EMERGENCY: Automated detected critical fatigue. You are ordered to halt at the nearest safe zone for 12 hours.')">🛑 FORCE HALT</button>
                    <button class="btn-primary" style="flex:1; padding:8px; font-size:0.7rem; background:rgba(255,255,255,0.1);" onclick="liveTrackByDriver('${d.id}')">📍 LOCATE</button>
                </div>
            </div>
        `).join('') : '<div style="text-align:center; padding:40px 0;"><div style="font-size:2rem; margin-bottom:10px;">✅</div><p style="color:var(--text-muted); font-size:0.85rem;">All drivers are within safe fatigue thresholds.</p></div>';

        // 2. Zen Mode Sessions
        const zenContainer = document.getElementById('zen-sessions-list');
        const zenDrivers = drivers.filter(d => d.is_zen_mode);
        zenContainer.innerHTML = zenDrivers.length ? zenDrivers.map(d => `
            <div class="glass-card" style="margin-bottom:12px; border-left:4px solid var(--primary); padding:14px; background:rgba(49, 130, 206, 0.05);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:800; font-size:1rem;">${d.name}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
                            Auto-Reroute: <b>${d.zen_destination ? d.zen_destination.name : 'Safety Haven'}</b>
                        </div>
                    </div>
                    <div class="pulse-warning" style="background:var(--primary); color:white; padding:4px 8px; border-radius:6px; font-size:0.65rem; font-weight:800;">🧘 ZEN ACTIVE</div>
                </div>
                <div style="display:flex; gap:10px; margin-top:12px;">
                    <button class="btn-primary" style="flex:1; padding:8px; font-size:0.7rem;" onclick="liveTrackByDriver('${d.id}')">📍 TRACK SAFETY PATH</button>
                    <button class="btn-primary" style="flex:1; padding:8px; font-size:0.7rem; background:rgba(255,255,255,0.1);" onclick="openMessageModal('null', '${d.id}')">💬 CONNECT</button>
                </div>
            </div>
        `).join('') : '<div style="text-align:center; padding:40px 0;"><div style="font-size:2rem; margin-bottom:10px;">🛡️</div><p style="color:var(--text-muted); font-size:0.85rem;">No active Zen Mode safety interventions.</p></div>';

        // 3. Incidents Table
        const incidentBody = document.getElementById('incidents-table-body');
        let incidents = [];
        shipments.forEach(s => {
            (s.logs || []).forEach(log => {
                if (log.message.includes("ISSUE:") || log.message.includes("BREAKDOWN") || log.status === "delayed" || log.status === "disputed" || log.status === "safety_halt") {
                    incidents.push({ shipment: s, log: log, driver: drivers.find(d => d.id === s.assigned_driver_id) });
                }
            });
        });

        incidentBody.innerHTML = incidents.length ? incidents.sort((a,b) => new Date(b.log.timestamp) - new Date(a.log.timestamp)).slice(0, 20).map(i => `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:12px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${i.driver?.name || 'sys'}" style="width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,0.05);">
                        <div>
                            <b>${i.driver ? i.driver.name : 'Automated System'}</b>
                            <br><small style="color:var(--text-muted)">${i.shipment.id.substring(0,8)}</small>
                        </div>
                    </div>
                </td>
                <td style="padding:12px;">
                    <span style="color:${i.log.status === 'delayed' ? 'var(--warning)' : 'var(--danger)'}; font-weight:800; font-size:0.85rem;">
                        ${i.log.message.replace('ISSUE: ', '')}
                    </span>
                </td>
                <td style="padding:12px; font-size:0.8rem; color:var(--text-muted);">
                    ${new Date(i.log.timestamp).toLocaleString([], {hour:'2-digit', minute:'2-digit', day:'numeric', month:'short'})}
                </td>
                <td style="padding:12px; font-family:monospace; font-size:0.75rem;">
                    ${i.log.location ? `${i.log.location.lat.toFixed(4)}, ${i.log.location.lng.toFixed(4)}` : 'Node Alpha-1'}
                </td>
                <td style="padding:12px;">
                    <span class="status-pill status-${i.shipment.status}" style="font-size:0.6rem;">${i.shipment.status.toUpperCase()}</span>
                </td>
                <td style="padding:12px; text-align:right;">
                    <button class="btn-primary" style="padding:6px 12px; font-size:0.7rem; background:var(--accent);" onclick="openLogsModal('${i.shipment.id}')">📋 ANALYZE</button>
                </td>
            </tr>
        `).join('') : '<tr><td colspan="6" style="text-align:center; padding:50px; color:var(--text-muted);">🛡️ Zero active safety incidents in the last 24 hours.</td></tr>';

    } catch (e) { 
        console.error("Safety Center Load Error:", e);
        showPopupAlert("Failed to sync safety data from neural cloud.");
    }
}

async function liveTrackByDriver(driverId) {
    const shipments = await apiCall(`/shipments?company_id=${localStorage.getItem('manager_id')}`);
    const active = shipments.find(s => s.assigned_driver_id === driverId && s.status !== 'delivered');
    if (active) openTrackModal(active.id);
    else alert("No active shipment for this driver.");
}

let qrInstance = null;
async function openQRModal(shipmentId) {
    const data = await apiCall(`/shipments/${shipmentId}/qr-data`);
    const qrText = data.qr_code_data;

    const modal = document.getElementById('qr-modal');
    const canvas = document.getElementById('qrcode-canvas');
    const text = document.getElementById('qr-id-text');
    
    modal.style.display = 'block';
    canvas.innerHTML = '';
    text.innerText = `Shipment ID: ${shipmentId}\nQR Code: ${qrText}`;
    
    qrInstance = new QRCode(canvas, {
        text: qrText,
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
    const pickupVal = document.getElementById('pickup-loc').value.trim();
    const dropVal = document.getElementById('drop-loc').value.trim();
    
    if (!pickupVal.includes(',') || !dropVal.includes(',')) {
        return showNotification("Please enter coordinates in 'Lat, Lng' format.", "danger");
    }

    const [plat, plng] = pickupVal.split(',').map(n => parseFloat(n.trim()));
    const [dlat, dlng] = dropVal.split(',').map(n => parseFloat(n.trim()));
    
    if (isNaN(plat) || isNaN(plng) || isNaN(dlat) || isNaN(dlng)) {
        return showNotification("Invalid coordinates. Numeric Lat/Lng required.", "danger");
    }

    const phone = document.getElementById('receiver-phone').value.trim();
    if (!/^\d{10}$/.test(phone)) {
        return showNotification("Receiver Phone must be exactly 10 digits.", "danger");
    }

    const email = document.getElementById('receiver-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showNotification("Invalid email address format.", "danger");
    }

    const weight = parseFloat(document.getElementById('weight').value);
    if (isNaN(weight) || weight <= 0) {
        return showNotification("Weight must be a positive number.", "danger");
    }
    
    const data = {
        pickup: {lat: plat, lng: plng},
        drop: {lat: dlat, lng: dlng},
        weight: weight,
        description: document.getElementById('description').value,
        is_perishable: document.getElementById('is-perishable').checked,
        receiver_name: document.getElementById('receiver-name').value,
        receiver_phone: "+91" + phone,
        receiver_email: email,
        eway_bill_no: document.getElementById('eway-no').value || null,
        eway_bill_expiry: document.getElementById('eway-expiry').value || null,
        company_id: localStorage.getItem('manager_id'),
        receiver_id: currentLookedUpReceiverId,
        labels: []
    };
    
    try {
        await apiCall('/shipments/', 'POST', data);
        showNotification('Shipment Created Successfully!', 'success');
        document.getElementById('create-shipment-form').reset();
        
        // Reset receiver lookup UI
        const nameInput = document.getElementById('receiver-name');
        const phoneInput = document.getElementById('receiver-phone');
        const statusDiv = document.getElementById('receiver-lookup-status');
        if (nameInput) {
            nameInput.disabled = false;
            nameInput.style.opacity = '1';
        }
        if (phoneInput) {
            phoneInput.disabled = false;
            phoneInput.style.opacity = '1';
        }
        if (statusDiv) {
            statusDiv.style.display = 'none';
        }

        currentLookedUpReceiverId = null;
        loadShipments();
    } catch(e) {
        console.error("Creation failed:", e);
    }
});

// --- SMART BULK ASSISTANT ENGINE (Multi-Entity Support) ---
let smartQueue = [];
let currentSmartShipment = {};
let smartStepIndex = -1;
let smartType = 'shipment'; // 'shipment', 'driver', or 'vehicle'

const smartConfig = {
    shipment: [
        { 
            field: 'pickup', 
            label: 'Pickup Coordinates (Lat, Lng)', 
            promptKey: 'prompt_shipment_pickup',
            hint: 'Example: 28.7, 77.1',
            validate: val => /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(val),
            error: 'Please enter valid coordinates like "28.70, 77.12". No city names allowed!',
            skipIfCloning: true
        },
        { 
            field: 'drop', 
            label: 'Drop Coordinates (Lat, Lng)', 
            promptKey: 'prompt_shipment_drop',
            hint: 'Example: 19.1, 72.8',
            validate: val => /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(val),
            error: 'Please enter valid coordinates. City names are not accepted.'
        },
        { 
            field: 'weight', 
            label: 'Weight (kg)', 
            promptKey: 'prompt_shipment_weight',
            hint: 'Numbers only please!',
            validate: val => !isNaN(parseFloat(val)) && isFinite(val) && parseFloat(val) > 0,
            error: 'Weight must be a number (e.g. 10.5). Words are not allowed!',
            skipIfCloning: true
        },
        { 
            field: 'description', 
            label: 'Description', 
            promptKey: 'prompt_shipment_desc',
            hint: 'What are you shipping?',
            validate: val => val.length >= 3,
            error: 'err_desc_short',
            skipIfCloning: true
        },
        { 
            field: 'is_perishable', 
            label: 'Perishable', 
            promptKey: 'prompt_shipment_perishable',
            hint: 'Type "Yes" or "No"',
            validate: val => ['yes', 'no', 'y', 'n'].includes(val.toLowerCase()),
            error: 'err_yes_no',
            skipIfCloning: true
        },
        { 
            field: 'receiver_email', 
            label: 'Receiver Email', 
            promptKey: 'prompt_shipment_receiver_email',
            hint: 'example@logistix.com',
            validate: val => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
            error: 'err_email_invalid',
            onComplete: async (email) => {
                const company_id = localStorage.getItem('manager_id');
                const recs = await apiCall(`/manager/receivers?company_id=${company_id}`);
                const found = recs.find(r => r.email.toLowerCase() === email.toLowerCase());
                if (found) {
                    currentSmartShipment.receiver_id = found.id;
                    currentSmartShipment.receiver_name = found.name;
                    currentSmartShipment.receiver_phone = found.phone.replace("+91", "");
                    addAiMessage(`✅ Found ${found.name} (${found.id}) in your records. Auto-filling details...`);
                    // Skip name and phone steps (index 6 and 7) to move to Eway No (index 8)
                    smartStepIndex += 3;
                } else {
                    smartStepIndex++;
                }
            }
        },
        { 
            field: 'receiver_name', 
            label: 'Receiver Name', 
            promptKey: 'prompt_shipment_receiver_name',
            hint: 'Full name',
            validate: val => val.length >= 3,
            error: 'err_name_short'
        },
        { 
            field: 'receiver_phone', 
            label: 'Receiver Phone', 
            promptKey: 'prompt_shipment_receiver_phone',
            hint: '10 digits only',
            validate: val => /^\d{10}$/.test(val),
            error: 'err_phone_10_digits'
        },
        { 
            field: 'eway_no', 
            label: 'E-Way Bill Number', 
            promptKey: 'prompt_shipment_eway_no',
            hint: '12 digit number',
            validate: val => /^\d{12}$/.test(val),
            error: 'err_eway_12_digits',
            skipIfCloning: true
        },
        { 
            field: 'eway_expiry', 
            label: 'E-Way Bill Expiry', 
            promptKey: 'prompt_shipment_eway_expiry',
            hint: 'Format: YYYY-MM-DD',
            validate: val => /^\d{4}-\d{2}-\d{2}$/.test(val),
            error: 'err_date_format',
            skipIfCloning: true
        },
        {
            field: 'confirm',
            label: 'Confirm Details',
            promptKey: 'prompt_shipment_confirm',
            validate: val => ['save', 'reset'].includes(val.toLowerCase()),
            error: 'err_save_reset'
        }
    ],
    driver: [
        {
            field: 'name',
            promptKey: 'prompt_driver_name',
            validate: val => val.length >= 3,
            error: 'err_name_short'
        },
        {
            field: 'login_id',
            promptKey: 'prompt_driver_login',
            validate: val => val.length >= 4,
            error: 'err_login_short'
        },
        {
            field: 'password',
            promptKey: 'prompt_driver_password',
            validate: val => val.length >= 1,
            error: 'err_password_empty'
        },
        {
            field: 'license_type',
            promptKey: 'prompt_driver_license',
            options: ['Truck (Heavy)', 'Truck (Small)', 'Delivery Van', 'Bike/Scooty', 'EV-Cargo'],
            validate: val => true
        },
        {
            field: 'base_hub',
            promptKey: 'prompt_driver_hub',
            options: 'hubs', // Dynamic fetch
            validate: val => val !== "",
            error: 'err_hub_not_found'
        },
        {
            field: 'contact_number',
            promptKey: 'prompt_driver_contact',
            validate: val => /^\d{10}$/.test(val),
            error: 'err_contact_invalid'
        },
        {
            field: 'experience_years',
            promptKey: 'prompt_driver_exp',
            validate: val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0,
            error: 'err_exp_invalid'
        },
        {
            field: 'past_accidents',
            promptKey: 'prompt_driver_accidents',
            validate: val => !isNaN(parseInt(val)) && parseInt(val) >= 0,
            error: 'err_count_invalid'
        },
        {
            field: 'traffic_violations',
            promptKey: 'prompt_driver_violations',
            validate: val => !isNaN(parseInt(val)) && parseInt(val) >= 0,
            error: 'err_count_invalid'
        },
        {
            field: 'confirm',
            promptKey: 'prompt_driver_confirm',
            validate: val => ['save', 'reset'].includes(val.toLowerCase()),
            error: 'err_save_reset'
        }
    ],
    vehicle: [
        {
            field: 'type',
            promptKey: 'prompt_vehicle_type',
            options: ['Truck (Heavy)', 'Truck (Small)', 'Delivery Van', 'Bike/Scooty', 'EV-Cargo'],
            validate: val => true
        },
        {
            field: 'number_plate',
            promptKey: 'prompt_vehicle_plate',
            validate: val => {
                const formatted = val.toUpperCase().replace(/\s/g, '');
                return /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(formatted);
            },
            error: 'err_invalid_plate'
        },
        {
            field: 'capacity',
            promptKey: 'prompt_vehicle_capacity',
            validate: val => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
            error: 'err_invalid_number'
        },
        {
            field: 'base_hub',
            promptKey: 'prompt_vehicle_hub',
            options: 'hubs',
            validate: val => val !== "",
            error: 'err_hub_not_found'
        },
        {
            field: 'confirm',
            promptKey: 'prompt_vehicle_confirm',
            validate: val => ['save', 'reset'].includes(val.toLowerCase())
        }
    ],
    drone: [
        {
            field: 'license_number',
            promptKey: 'prompt_drone_license',
            validate: val => val.length >= 5,
            error: 'err_invalid_license'
        },
        {
            field: 'base_warehouse_id',
            promptKey: 'prompt_drone_hub',
            options: 'hubs',
            validate: val => val !== "",
            error: 'err_hub_not_found'
        },
        {
            field: 'capacity',
            promptKey: 'prompt_drone_capacity',
            validate: val => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
            error: 'err_invalid_number'
        },
        {
            field: 'radius',
            promptKey: 'prompt_drone_radius',
            validate: val => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
            error: 'err_invalid_number'
        },
        {
            field: 'confirm',
            promptKey: 'prompt_drone_confirm',
            validate: val => ['save', 'reset'].includes(val.toLowerCase())
        }
    ]
};

window.openSmartAssistant = function(type = 'shipment') {
    const oldType = smartType;
    smartType = type;
    const modal = document.getElementById('smart-assistant-modal');
    modal.style.display = 'flex';
    const title = document.getElementById('smart-assistant-title');
    const p = document.getElementById('smart-assistant-desc');
    const newBtn = document.getElementById('smart-new-btn');
    const mapTrigger = document.getElementById('smart-map-trigger');

    if (type === 'driver') { 
        if (title) title.innerText = getTranslation('smart_driver_title', 'en');
        if (p) p.innerText = getTranslation('smart_driver_desc', 'en');
        if (newBtn) newBtn.innerText = getTranslation('btn_new_driver', 'en');
        if (mapTrigger) mapTrigger.style.display = 'none';
    }
    else if (type === 'vehicle') { 
        if (title) title.innerText = getTranslation('smart_vehicle_title', 'en');
        if (p) p.innerText = getTranslation('smart_vehicle_desc', 'en');
        if (newBtn) newBtn.innerText = getTranslation('btn_new_vehicle', 'en');
        if (mapTrigger) mapTrigger.style.display = 'none';
    }
    else if (type === 'drone') { 
        if (title) title.innerText = getTranslation('smart_drone_title', 'en');
        if (p) p.innerText = getTranslation('smart_drone_desc', 'en');
        if (newBtn) newBtn.innerText = getTranslation('btn_new_drone', 'en');
        if (mapTrigger) mapTrigger.style.display = 'none';
    }
    else { 
        if (title) title.innerText = getTranslation('smart_bulk_title', 'en');
        if (p) p.innerText = getTranslation('smart_bulk_desc', 'en');
        if (newBtn) newBtn.innerText = getTranslation('new_shipment_btn', 'en');
        if (mapTrigger) mapTrigger.style.display = 'block';
    }


    if (typeof updatePageTranslations === 'function') {
        updatePageTranslations();
    }


    // Pre-fetch hubs if needed
    if ((type === 'driver' || type === 'vehicle' || type === 'drone') && globalHubs.length === 0) {
        loadDriversAndVehicles();
    }

    const input = document.getElementById('smart-command-input');
    if (input && !input.dataset.listener) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                processSmartCommand();
            }
        });
        input.dataset.listener = "true";
    }

    // Force reset if type changed or session ended
    if (oldType !== type || smartStepIndex === -1 || smartStepIndex === 99) {
        startNewSmartEntry();
    }
};

window.closeSmartAssistant = function() {
    document.getElementById('smart-assistant-modal').style.display = 'none';
};

window.startNewSmartEntry = function() {
    currentSmartShipment = {};
    smartStepIndex = 0;
    const area = document.getElementById('smart-chat-area');
    area.innerHTML = '';
    const welcomeText = getTranslation(`smart_welcome_${smartType}`, 'en');
    addAiMessage(`👋 ${welcomeText}`);
    askNextSmartStep();
};

function askNextSmartStep() {
    const steps = smartConfig[smartType];
    let step = steps[smartStepIndex];
    
    // Skip logic for clones (only for shipments)
    while (step && smartType === 'shipment' && currentSmartShipment.is_clone && step.skipIfCloning) {
        smartStepIndex++;
        step = steps[smartStepIndex];
    }

    if (!step) return;

    let prompt = getTranslation(step.promptKey, 'en');
    
    if (step.field === 'confirm') {
        const s = currentSmartShipment;
        let summary = "";
        if (smartType === 'shipment') {
            summary = `• ${getTranslation('label_from', 'en')}: ${s.pickup}<br>• ${getTranslation('label_to', 'en')}: ${s.drop}<br>• ${getTranslation('label_weight', 'en')}: ${s.weight}kg<br>• ${getTranslation('label_desc', 'en')}: ${s.description}<br>• ${getTranslation('label_receiver', 'en')}: ${s.receiver_name}<br>• ${getTranslation('label_eway', 'en')}: ${s.eway_no} (Exp: ${s.eway_expiry})`;
        } else if (smartType === 'driver') {
            summary = `• ${getTranslation('label_name', 'en')}: ${s.name}<br>• ${getTranslation('label_id', 'en')}: ${s.login_id}<br>• ${getTranslation('label_type', 'en')}: ${s.license_type}<br>• ${getTranslation('label_hub', 'en')}: ${s.base_hub}<br>• ${getTranslation('label_exp', 'en')}: ${s.experience_years}y | ${getTranslation('label_acc', 'en')}: ${s.past_accidents} | ${getTranslation('label_viol', 'en')}: ${s.traffic_violations}`;
        } else if (smartType === 'vehicle') {
            summary = `• ${getTranslation('label_type', 'en')}: ${s.type}<br>• ${getTranslation('label_plate', 'en')}: ${s.number_plate}<br>• ${getTranslation('label_cap', 'en')}: ${s.capacity}kg<br>• ${getTranslation('label_hub', 'en')}: ${s.base_hub}`;
        } else if (smartType === 'drone') {
            summary = `• ${getTranslation('label_license', 'en')}: ${s.license_number}<br>• ${getTranslation('label_hub', 'en')}: ${s.base_warehouse_id}<br>• ${getTranslation('label_cap', 'en')}: ${s.capacity}kg<br>• ${getTranslation('label_radius', 'en')}: ${s.radius}km`;
        }
        prompt = prompt.replace('{summary}', summary);
    }
    
    addAiMessage(prompt);
    
    // Dropdown Handling
    const input = document.getElementById('smart-command-input');
    if (step.options) {
        const area = document.getElementById('smart-chat-area');
        const select = document.createElement('select');
        select.className = 'polished-glass-input';
        select.style = 'margin-bottom:10px; width:auto; min-width:240px; max-width:100%; padding: 4px 10px !important; height: 36px !important; font-size: 0.85rem !important; animation: slideUp 0.3s ease; flex: none !important;';
        
        // Disable input to force dropdown selection
        if (input) {
            input.disabled = true;
            input.placeholder = "Please select from the dropdown above...";
            input.style.opacity = "0.5";
        }

        let opts = [];
        if (step.options === 'hubs') {
            opts = globalHubs.map(h => h.name);
        } else {
            opts = step.options;
        }

        select.innerHTML = `<option value="">Select an option...</option>` + opts.map(o => `<option value="${o}">${o}</option>`).join('');
        select.onchange = (e) => {
            if (e.target.value) {
                // Re-enable input
                if (input) {
                    input.disabled = false;
                    input.placeholder = "Type response...";
                    input.style.opacity = "1";
                    input.value = e.target.value;
                }
                processSmartCommand();
                select.remove();
            }
        };
        area.appendChild(select);
        area.scrollTop = area.scrollHeight;
    } else {
        // Ensure input is enabled if no options
        if (input) {
            input.disabled = false;
            input.placeholder = "Type response...";
            input.style.opacity = "1";
        }
    }

    if (step.hint) {
        const area = document.getElementById('smart-chat-area');
        const hint = document.createElement('small');
        hint.style = 'color:var(--muted); margin-top:-10px; margin-bottom:10px; display:block;';
        hint.innerText = `💡 ${step.hint}`;
        area.appendChild(hint);
    }
    if (input && !input.disabled) input.focus();
}

window.processSmartCommand = async function() {
    const input = document.getElementById('smart-command-input');
    let text = input.value.trim();
    if (!text) return;

    addUserMessage(text);
    input.value = '';

    const steps = smartConfig[smartType];

    // Choice Mode
    if (smartStepIndex === 99) {
        if (text.toLowerCase().includes('clone') && smartType === 'shipment') {
            addAiMessage(getTranslation('msg_how_many_clones', 'en'));
            smartStepIndex = 100;
        } else if (text.toLowerCase().includes('more') || text.toLowerCase().includes('new')) {
            startNewSmartEntry();
        } else {
            addAiMessage(getTranslation('msg_type_more', 'en'));
        }
        return;
    }

    if (smartStepIndex === 100) {
        const num = parseInt(text);
        if (isNaN(num) || num <= 0) { 
            addAiMessage(getTranslation('msg_enter_valid_count', 'en')); 
            return; 
        }
        
        if (smartQueue.length === 0 && Object.keys(currentSmartShipment).length === 0) {
            addAiMessage("❌ No shipment found to clone. Please add at least one shipment first.");
            smartStepIndex = 99;
            return;
        }

        const last = smartQueue.length > 0 ? smartQueue[smartQueue.length - 1] : { ...currentSmartShipment };
        addAiMessage(getTranslation('msg_preparing_clones', 'en').replace('{num}', num));
        for(let i=0; i<num; i++) {
            smartQueue.push({ 
                ...last, 
                is_clone: true, 
                clone_index: i + 1, 
                clone_total: num, 
                drop: null, 
                receiver_name: null, 
                receiver_phone: null, 
                receiver_email: null 
            });
        }
        updateSmartUI();
        processCloningQueue();
        return;
    }

    const step = steps[smartStepIndex];
    if (!step) return;

    // Formatting for Number Plate
    if (step.field === 'number_plate') {
        text = text.toUpperCase().replace(/\s/g, '');
        if (text.length === 10) {
            text = text.slice(0,2) + ' ' + text.slice(2,4) + ' ' + text.slice(4,6) + ' ' + text.slice(6);
        }
    }

    // Validation
    if (step.validate && !step.validate(text)) {
        const err = getTranslation(step.error || 'err_invalid_input', 'en');
        addAiMessage(`❌ ${err}`);
        return;
    }

    if (step.field === 'confirm') {
        if (text.toLowerCase() === 'save') {
            if (smartType === 'drone') {
                const dronePayload = {
                    license_number: currentSmartShipment.license_number,
                    base_warehouse_id: globalWarehouses.find(w => w.name === currentSmartShipment.base_warehouse_id)?.id || currentSmartShipment.base_warehouse_id,
                    capacity: parseFloat(currentSmartShipment.capacity),
                    radius: parseFloat(currentSmartShipment.radius),
                    company_id: localStorage.getItem('manager_id')
                };
                apiCall('/manager/drones', 'POST', dronePayload).then(() => {
                    addAiMessage(getTranslation('msg_drone_registered', 'en'));
                    loadDriversAndVehicles();
                    renderDronesTable();
                    addAiMessage(getTranslation('msg_type_more', 'en'));
                    smartStepIndex = 99; 
                }).catch(() => {
                    addAiMessage(getTranslation('error_drone_failed', 'en'));
                    smartStepIndex = 99;
                });
            } else {
                smartQueue.push({ ...currentSmartShipment });
                updateSmartUI();
                
                if (currentSmartShipment.is_clone) {
                    processCloningQueue();
                } else {
                    addAiMessage(getTranslation('msg_added_to_queue', 'en'));
                    addAiMessage(getTranslation('msg_type_more', 'en'));
                    smartStepIndex = 99; 
                }
            }
        } else {
            startNewSmartEntry();
        }
        return;
    }

    currentSmartShipment[step.field] = text;
    
    if (step.onComplete) {
        await step.onComplete(text);
    } else {
        smartStepIndex++;
    }
    
    // Skip logic
    while (steps[smartStepIndex] && smartType === 'shipment' && currentSmartShipment.is_clone && steps[smartStepIndex].skipIfCloning) {
        smartStepIndex++;
    }
    askNextSmartStep();
};

function processCloningQueue() {
    // Find first shipment in queue that is missing unique fields
    const nextIdx = smartQueue.findIndex(s => s.is_clone && (s.drop === null || s.receiver_name === null));
    
    if (nextIdx === -1) {
        addAiMessage("✅ <b>All clones completed!</b> Your queue is ready.");
        smartStepIndex = 99; // Back to choice mode
        updateSmartUI();
        return;
    }

    // Extract it to work on it
    currentSmartShipment = smartQueue[nextIdx];
    smartQueue.splice(nextIdx, 1);
    
    smartStepIndex = 0; // Restart from pickup for this specific clone
    addAiMessage(`🔧 <b>Clone ${currentSmartShipment.clone_index} of ${currentSmartShipment.clone_total}</b>:`);
    askNextSmartStep();
}

window.pickSmartCoordinates = function() {
    openMapPicker(null, (coords) => {
        document.getElementById('smart-command-input').value = coords;
        // Don't auto-process, let user see it first
    });
};

window.confirmSmartQueue = async function() {
    if (smartQueue.length === 0) return;
    const count = smartQueue.length;
    addAiMessage(`🚀 Syncing ${count} entries with server...`);
    
    try {
        for (const s of smartQueue) {
            let endpoint = '/shipments/';
            let data = {};
            
            if (smartType === 'shipment') {
                data = {
                    pickup: { lat: parseFloat(s.pickup.split(',')[0]), lng: parseFloat(s.pickup.split(',')[1]) },
                    drop: { lat: parseFloat(s.drop.split(',')[0]), lng: parseFloat(s.drop.split(',')[1]) },
                    weight: parseFloat(s.weight),
                    description: s.description || "Smart Assistant Entry",
                    is_perishable: s.is_perishable === 'yes' || s.is_perishable === 'y',
                    receiver_name: s.receiver_name,
                    receiver_phone: s.receiver_phone.startsWith('+91') ? s.receiver_phone : "+91" + s.receiver_phone,
                    receiver_email: s.receiver_email,
                    eway_bill_no: s.eway_no,
                    eway_bill_expiry: s.eway_expiry,
                    company_id: localStorage.getItem('manager_id'),
                    labels: []
                };
            } else if (smartType === 'driver') {
                endpoint = '/manager/drivers';
                const hub = globalHubs.find(h => h.name === s.base_hub);
                data = {
                    name: s.name,
                    login_id: s.login_id,
                    password: s.password,
                    license_type: s.license_type.toLowerCase().includes('truck') ? 'truck' : (s.license_type.toLowerCase().includes('bike') ? 'bike' : 'van'),
                    base_warehouse_id: hub ? hub.id : null,
                    experience_years: parseFloat(s.experience_years),
                    contact_number: s.contact_number.startsWith('+91') ? s.contact_number : "+91" + s.contact_number,
                    past_accidents: parseInt(s.past_accidents),
                    traffic_violations: parseInt(s.traffic_violations),
                    company_id: localStorage.getItem('manager_id')
                };
            } else if (smartType === 'vehicle') {
                endpoint = '/manager/vehicles';
                const hub = globalHubs.find(h => h.name === s.base_hub);
                data = {
                    type: s.type.toLowerCase().includes('truck') ? 'truck' : (s.type.toLowerCase().includes('bike') ? 'bike' : 'van'),
                    number_plate: s.number_plate,
                    capacity: parseFloat(s.capacity),
                    fuel_efficiency: 15,
                    base_warehouse_id: hub ? hub.id : null,
                    company_id: localStorage.getItem('manager_id'),
                    status: 'available'
                };
            }
            
            await apiCall(endpoint, 'POST', data);
        }
        showNotification(`Successfully created ${count} ${smartType}s!`, "success");
        clearSmartQueue();
        if (smartType === 'shipment') loadShipments();
        else loadDriversAndVehicles();
        closeSmartAssistant();
    } catch(e) {
        addAiMessage(`❌ Error creating ${smartType}. Check console.`);
        console.error(e);
    }
};

window.updateSmartUI = function() {
    const count = smartQueue.length;
    document.getElementById('smart-queue-count').innerText = count;
    
    const label = document.getElementById('smart-queue-text');
    if (label) {
        if (smartType === 'driver') label.innerText = count === 1 ? 'Driver' : 'Drivers';
        else if (smartType === 'vehicle') label.innerText = count === 1 ? 'Vehicle' : 'Vehicles';
        else label.innerText = count === 1 ? 'Shipment' : 'Shipments';
    }
    
    document.getElementById('smart-queue-preview').style.display = count > 0 ? 'block' : 'none';
};

window.clearSmartQueue = function() {
    smartQueue = [];
    updateSmartUI();
    addAiMessage("🗑️ Queue cleared.");
};

window.addAiMessage = function(text) {
    const area = document.getElementById('smart-chat-area');
    if (!area) return;

    // Support for **bold** text
    let formattedText = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    const msg = document.createElement('div');
    msg.className = 'ai-msg';
    msg.style = 'align-self:flex-start; background:var(--card); padding:12px 16px; border-radius:18px 18px 18px 0; border:1px solid var(--border); font-size:0.95rem; max-width:85%; margin-bottom:12px; line-height:1.4; animation: slideUp 0.3s ease;';
    msg.innerHTML = formattedText;
    area.appendChild(msg);
    area.scrollTop = area.scrollHeight;
};

window.addUserMessage = function(text) {
    const area = document.getElementById('smart-chat-area');
    if (!area) return;
    const msg = document.createElement('div');
    msg.style = 'align-self:flex-end; background:var(--primary); color:white; padding:12px 16px; border-radius:18px 18px 0 18px; font-size:0.95rem; max-width:85%; margin-bottom:12px; line-height:1.4; animation: slideUp 0.3s ease; box-shadow: 0 4px 15px rgba(0,0,0,0.2);';
    msg.innerText = text;
    area.appendChild(msg);
    area.scrollTop = area.scrollHeight;
};

// Add Slide Animation to global styles
if (!document.getElementById('smart-drawer-styles')) {
    const style = document.createElement('style');
    style.id = 'smart-drawer-styles';
    style.innerHTML = `
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

// Shipments Table Rendering

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
    
    const limit = window.tableLimits.shipments;
    const limitedParents = parents.slice(0, limit);

    limitedParents.forEach(s => {
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
            const driverName = (d && d.name) ? d.name : getTranslation('unassigned');
            const plate = (v && v.number_plate) ? v.number_plate : (s.assigned_driver_id === 'DRONE-SYSTEM' ? '🚁 Autonomous Drone' : getTranslation('no_vehicle'));
            
            let performanceMsg = '';
            let rowClass = 'status-ontime';
            const now = new Date();
            const deadline = new Date(s.status === 'pending' || s.status === 'assigned' ? s.pickup_deadline : s.expected_delivery);
            const diffMins = Math.round((now - deadline) / (1000 * 60));
            
            if (s.performance_stats) {
                const ps = s.performance_stats;
                if (ps.status === 'delayed') {
                    rowClass = 'status-delayed';
                    performanceMsg = `<div style="color:var(--danger); font-size:0.7rem;">⚠️ ${getTranslation('delayed')}: ${ps.diff_mins}m</div>`;
                } else if (ps.status === 'early') {
                    rowClass = 'status-early';
                    performanceMsg = `<div style="color:var(--success); font-size:0.7rem;">⚡ ${getTranslation('early')}: ${Math.abs(ps.diff_mins)}m</div>`;
                }
            } else if (diffMins > 0 && s.status !== 'delivered') {
                rowClass = 'status-delayed';
                performanceMsg = `<div style="color:var(--danger); font-size:0.7rem;">⏰ ${getTranslation('delayed')}: ${diffMins}m</div>`;
            }

            tr.className = rowClass;
            tr.innerHTML = `
                <td>
                    <div style="font-weight:bold;">${s.description}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted); font-family:monospace;">${getTranslation('id_label')}: ${s.id.substring(0,8)}</div>
                    ${s.route_type === 'multi-leg' ? '<span style="font-size:0.65rem; color:var(--accent); font-weight:bold;">[HUB ROUTE]</span>' : ''}
                </td>
                <td>
                    <div style="width:80px; height:6px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden; margin-bottom:4px;">
                        <div style="width:${vitality}%; height:100%; background:${vColor};"></div>
                    </div>
                    <small style="color:${vColor}; font-weight:bold;">${s.is_perishable ? `${getTranslation('vitality')}: ${vitality}%` : getTranslation('stable')}</small>
                </td>
                <td>
                    <span class="status-pill status-${s.status}" style="font-size:0.7rem;">${getTranslation(s.status + '_label') || s.status}</span>
                    <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${s.stage ? (getTranslation(s.stage.toLowerCase().replace(/ /g, '_')) || s.stage) : '---'}</div>
                    ${performanceMsg}
                </td>
                <td>
                    <div style="font-size:0.8rem; font-weight:600;">${getTranslation('eway_label')}: ${s.eway_bill_no || getTranslation('na')}</div>
                    <div style="font-size:0.65rem; color:var(--text-muted);">
                        ${getTranslation('exp_label')}: ${s.eway_bill_expiry ? new Date(s.eway_bill_expiry).toLocaleString() : getTranslation('na')}
                    </div>
                </td>
                <td>
                    <div style="font-size:0.8rem; font-weight:600; color:var(--primary);">${driverName}</div>
                    <div style="font-size:0.8rem; font-weight:700; color:#fff; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; display:inline-block; margin-top:4px; border:1px solid rgba(255,255,255,0.2); cursor:${s.loading_blueprint ? 'pointer' : 'default'};" onclick="${s.loading_blueprint ? `viewCargoPlan('${s.id}')` : ''}">
                        ${plate}
                    </div>
                </td>
                <td>
                    <div style="font-size:0.8rem; font-weight:700; color:var(--success);">₹${(s.finance?.suggested_price || 0).toLocaleString()}</div>
                    <div style="font-size:0.6rem; color:var(--text-muted);">Profit: <span style="color:var(--success);">₹${(s.finance?.margin || 0).toLocaleString()}</span></div>
                </td>
                <td>
                    <button class="btn-primary" style="padding:6px 12px; font-size:0.7rem; width:auto; background:var(--accent);" onclick="openShipmentDetailModal('${s.id}')">
                        ⚡ <span data-i18n="btn_manage">Manage</span>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);

            // Indented Legs for Split Shipments
            if (s.status === 'split' || s.route_type === 'multi-leg') {
                const sLegs = legs.filter(l => l.parent_id === s.id).sort((a,b) => a.leg_order - b.leg_order);
                sLegs.forEach(leg => {
                    const lTr = document.createElement('tr');
                    lTr.style.background = 'rgba(255,255,255,0.02)';
                    
                    const ld = drivers.find(d => d.id === leg.assigned_driver_id);
                    const lv = vehicles.find(v => v.id === leg.assigned_vehicle_id);
                    const lDriverName = (ld && ld.name) ? ld.name : getTranslation('unassigned');
                    const lPlate = (lv && lv.number_plate) ? lv.number_plate : getTranslation('no_vehicle');

                    lTr.innerHTML = `
                        <td style="padding-left:30px; font-size:0.8rem; color:var(--text-muted);">↳ Leg ${leg.leg_order}: ${leg.description}</td>
                        <td>---</td>
                        <td><span class="status-pill status-${leg.status}" style="font-size:0.6rem;">${leg.status.toUpperCase()}</span></td>
                        <td>
                            <div style="font-size:0.75rem; color:var(--text-muted);">${getTranslation('eway_label')}: ${leg.eway_bill_no || getTranslation('na')}</div>
                        </td>
                        <td style="padding-left:30px;">
                            <div style="font-size:0.8rem; font-weight:600; color:var(--primary);">${lDriverName}</div>
                            <div style="font-size:0.8rem; font-weight:700; color:#fff; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; display:inline-block; margin-top:4px; border:1px solid rgba(255,255,255,0.2); cursor:${leg.loading_blueprint ? 'pointer' : 'default'};" onclick="${leg.loading_blueprint ? `viewCargoPlan('${leg.id}')` : ''}">
                                ${lPlate}
                            </div>
                        </td>
                        <td>
                            <div style="font-size:0.75rem; color:var(--success); font-weight:bold;">₹${(leg.finance?.suggested_price || 0).toLocaleString()}</div>
                        </td>
                        <td>
                            <button class="btn-primary" style="padding:4px 8px; font-size:0.6rem; width:auto; background:rgba(255,255,255,0.1);" onclick="openShipmentDetailModal('${leg.id}')">
                                ⚡ <span data-i18n="btn_manage">Manage</span>
                            </button>
                        </td>
                    `;
                    tbody.appendChild(lTr);
                });
            }
        } catch(err) {
            console.error("Row render failed:", err, s);
        }
    });

    renderTableControls('shipments', parents.length, window.tableLimits.shipments, 'applyShipmentFilters');
}

window.openShipmentDetailModal = function(id) {
    const s = globalShipments.find(ship => ship.id === id);
    if (!s) return;

    const modal = document.getElementById('shipment-detail-modal');
    document.getElementById('sd-title').innerText = s.description;
    document.getElementById('sd-id').innerText = `ID: ${s.id}`;
    
    const d = globalDrivers.find(drv => drv.id === s.assigned_driver_id);
    const v = globalVehicles.find(vh => vh.id === s.assigned_vehicle_id);
    const driverName = d ? d.name : getTranslation('unassigned');
    const vitality = s.is_perishable ? (s.vitality || 100) : 100;

    let contentHtml = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
            <div class="intel-block">
                <label style="font-size:0.7rem; color:var(--muted); text-transform:uppercase;">Vitality & Health</label>
                <div style="width:100%; height:8px; background:rgba(255,255,255,0.05); border-radius:4px; overflow:hidden; margin:8px 0;">
                    <div style="width:${vitality}%; height:100%; background:${vitality < 40 ? 'var(--danger)' : (vitality < 80 ? 'var(--warning)' : 'var(--success)')};"></div>
                </div>
                <div style="font-weight:700; color:${vitality < 40 ? 'var(--danger)' : (vitality < 80 ? 'var(--warning)' : 'var(--success)')};">
                    ${s.is_perishable ? `${getTranslation('vitality')}: ${vitality}%` : getTranslation('stable')}
                </div>
            </div>
            <div class="intel-block">
                <label style="font-size:0.7rem; color:var(--muted); text-transform:uppercase;">Compliance Status</label>
                <div style="margin-top:8px; font-weight:700;">${getTranslation('eway_label')}: ${s.eway_bill_no || getTranslation('na')}</div>
                <div style="font-size:0.7rem; opacity:0.7;">Expires: ${s.eway_bill_expiry ? new Date(s.eway_bill_expiry).toLocaleString() : 'N/A'}</div>
            </div>
        </div>

        <div class="intel-block" style="background:rgba(255,255,255,0.03); padding:15px; border-radius:12px; border:1px solid var(--border); margin-bottom:20px;">
            <label style="font-size:0.7rem; color:var(--muted); text-transform:uppercase;">Assigned Fleet Intel</label>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                <div>
                    <div style="font-weight:800; color:var(--primary);">${driverName}</div>
                    <div style="font-size:0.8rem; opacity:0.8;">${v ? v.number_plate : (s.assigned_driver_id === 'DRONE-SYSTEM' ? '🚁 Autonomous Drone' : 'No Vehicle')}</div>
                </div>
                ${s.loading_blueprint ? `<button class="btn-action-pill" onclick="viewCargoPlan('${s.id}')">📦 View Cargo Plan</button>` : ''}
            </div>
        </div>
    `;

    if (s.route_type === 'multi-leg' || s.status === 'split') {
        const sLegs = globalShipments.filter(l => l.parent_id === s.id).sort((a,b) => a.leg_order - b.leg_order);
        if (sLegs.length > 0) {
            contentHtml += `<div style="margin-top:20px;">
                <label style="font-size:0.7rem; color:var(--muted); text-transform:uppercase;">Journey Legs (Hub Route)</label>
                <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
                    ${sLegs.map(leg => `
                        <div style="padding:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.8rem;">Leg ${leg.leg_order}: ${getTranslation(leg.leg_type || 'leg')}</span>
                            <span class="status-pill status-${leg.status}" style="font-size:0.6rem;">${leg.status}</span>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        }
    }

    document.getElementById('sd-content').innerHTML = contentHtml;

    const isMultiLegParent = !s.is_leg && (s.status === 'split' || s.route_type === 'multi-leg');
    
    let actionsHtml = `
        <button class="btn-action-details" onclick="openLogsModal('${s.id}')">
            <span class="icon">📜</span> <span data-i18n="btn_timeline">Timeline</span>
        </button>
        <button class="btn-action-details" style="background:var(--accent);" onclick="openTrackModal('${s.id}')">
            <span class="icon">📍</span> <span data-i18n="btn_track">Live Track</span>
        </button>
    `;

    // QR: Only for Main Shipment (not legs)
    if (!s.is_leg) {
        actionsHtml += `
            <button class="btn-action-details" onclick="openQRModal('${s.id}')">
                <span class="icon">🖼️</span> <span data-i18n="btn_qr">Generate QR</span>
            </button>
        `;
    }

    // Message: strictly for splits OR direct main shipments
    if (s.is_leg || !isMultiLegParent) {
        actionsHtml += `
            <button class="btn-action-details" style="background:rgba(255,255,255,0.05);" onclick="openMessageModal('${s.id}', '${s.assigned_driver_id}')" ${!s.assigned_driver_id ? 'disabled' : ''}>
                <span class="icon">💬</span> <span data-i18n="btn_message">Message</span>
            </button>
        `;
    }

    if (!s.is_leg) {
        const isRoutePlanned = s.status === 'split' || s.route_type === 'multi-leg' || s.stage === 'Route Optimized';
        const isAssigned = s.assigned_driver_id || s.status === 'assigned' || s.status === 'in_transit';

        // 1. SPLIT CONTROLS
        if (s.status === 'pending' && !isRoutePlanned) {
            actionsHtml += `
                <button class="btn-action-details" style="background:var(--accent);" onclick="autoSplit('${s.id}')">
                    <span class="icon">🤖</span> <span>Route Splitter</span>
                </button>
                <button class="btn-action-details" style="background:#3182ce;" onclick="openManualSplit('${s.id}')">
                    <span class="icon">⛓️</span> <span data-i18n="btn_manual_split">Manual Split</span>
                </button>
            `;
        } else {
            actionsHtml += `
                <button class="btn-action-details" style="opacity:0.6; cursor:not-allowed; background:var(--muted);" disabled>
                    <span class="icon">🤖</span> <span>Route Finalized</span>
                </button>
                <button class="btn-action-details" style="opacity:0.6; cursor:not-allowed; background:var(--muted);" disabled>
                    <span class="icon">⛓️</span> <span>Route Finalized</span>
                </button>
            `;
        }

        // 2. ASSIGN CONTROLS (Only visible after split)
        if (isRoutePlanned && !isAssigned) {
            actionsHtml += `
                <button class="btn-action-details" style="background:var(--success);" onclick="autoAssignShipment('${s.id}')">
                    <span class="icon">🤖</span> <span>Auto Assign (AI)</span>
                </button>
                <button class="btn-action-details" style="background:#3182ce;" onclick="openManualAssignModal('${s.id}')">
                    <span class="icon">👤</span> <span>Manual Assign</span>
                </button>
            `;
        } else if (isAssigned) {
            actionsHtml += `
                <button class="btn-action-details" style="opacity:0.6; cursor:not-allowed; background:var(--muted);" disabled>
                    <span class="icon">🤖</span> <span>Already Assigned</span>
                </button>
                <button class="btn-action-details" style="opacity:0.6; cursor:not-allowed; background:var(--muted);" disabled>
                    <span class="icon">👤</span> <span>Already Assigned</span>
                </button>
            `;
        } else {
            // Not yet planned
            actionsHtml += `
                <button class="btn-action-details" style="opacity:0.6; cursor:not-allowed; background:var(--muted);" disabled title="Split route first">
                    <span class="icon">🤖</span> <span>Assign (Locked)</span>
                </button>
                <button class="btn-action-details" style="opacity:0.6; cursor:not-allowed; background:var(--muted);" disabled title="Split route first">
                    <span class="icon">👤</span> <span>Assign (Locked)</span>
                </button>
            `;
        }
    } else {
        // For Legs: Assignment is managed strictly through the parent shipment
        actionsHtml += `
            <button class="btn-action-details" style="opacity:0.6; cursor:not-allowed; background:var(--muted);" disabled title="Manage assignments from the Parent Shipment">
                <span class="icon">🔒</span> <span>Managed by Parent</span>
            </button>
        `;
    }

    if (s.payment_status?.toLowerCase() === 'paid' && s.status !== 'finalized') {
        actionsHtml += `
            <button class="btn-action-details" style="background:var(--success);" onclick="finalizeShipment('${s.id}')">
                <span class="icon">✅</span> <span data-i18n="btn_finalize">Finalize</span>
            </button>
        `;
    }

    // Manual Verify: strictly for splits OR direct main shipments
    if (s.is_leg || !isMultiLegParent) {
        actionsHtml += `
            <button class="btn-action-details" style="background:var(--warning); color:#000;" onclick="managerManualVerify('${s.id}')">
                <span class="icon">🛡️</span> <span data-i18n="btn_override">Manual Verify</span>
            </button>
        `;
    }

    actionsHtml += `
        <button class="btn-action-details" style="background:var(--danger);" onclick="deleteItem('shipments', '${s.id}')">
            <span class="icon">🗑️</span> <span data-i18n="btn_delete">Delete</span>
        </button>
    `;

    document.getElementById('shipment-detail-actions').innerHTML = actionsHtml;
    if (typeof updatePageTranslations === 'function') updatePageTranslations();
    modal.style.display = 'flex';
}

window.closeShipmentDetailModal = function() {
    document.getElementById('shipment-detail-modal').style.display = 'none';
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
        const res = await apiCall(`/shipments/${id}/auto-split?company_id=${localStorage.getItem('manager_id')}`, 'POST');
        showNotification(res.message, "success");
        closeShipmentDetailModal();
        loadShipments();
    } catch(e) {
        showNotification("Auto split failed.", "error");
    }
}

async function bulkRouteSplitter() {
    if (!confirm("🚀 World's Strongest Splitter: This will optimize all pending shipments based on the 50km hub-network logic. Proceed?")) return;
    try {
        const res = await apiCall(`/shipments/auto-split/bulk?company_id=${localStorage.getItem('manager_id')}`, 'POST');
        showNotification(res.message, "success");
        loadShipments();
    } catch(e) {
        showNotification("Bulk split failed.", "error");
    }
}

async function managerManualVerify(shipmentId) {
    if (!confirm("⚠️ MANAGER OVERRIDE: Are you sure you want to verify this shipment's QR code manually? This will bypass driver scanning.")) return;
    try {
        // Find the assigned driver for this shipment to use their ID for context
        const s = globalShipments.find(item => item.id === shipmentId);
        if (!s || !s.assigned_driver_id) {
            alert("No driver assigned. Verification cannot proceed.");
            return;
        }
        
        const res = await fetch(`${API_BASE}/driver/${s.assigned_driver_id}/verify-qr/${shipmentId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-logistix-context': JSON.stringify({ 
                    company_id: localStorage.getItem('manager_id'), 
                    role: 'manager',
                    bypass_auth: true // Signal to backend that manager is overriding
                })
            },
            body: JSON.stringify({ qr_data: "MANUAL_OVERRIDE" })
        });
        
        if (res.ok) {
            alert("Manual Verification Successful!");
            loadShipments();
        } else {
            const err = await res.json();
            alert("Error: " + (err.detail || "Verification failed"));
        }
    } catch(e) {
        alert("Verification failed: " + e.message);
    }
}

async function deassignShipment(id) {
    if (!confirm("🚨 Are you sure you want to DEASSIGN this shipment? All legs will be deleted and the shipment will return to 'Pending' status.")) return;
    try {
        const res = await apiCall(`/shipments/${id}/deassign`, 'POST');
        alert(res.message);
        loadShipments();
    } catch(e) {
        alert(e.detail || "Deassignment failed.");
    }
}

window.autoAssignShipment = async function(id) {
    try {
        const res = await apiCall(`/shipments/${id}/auto-assign`, 'POST');
        showNotification("Assignment successful! 🤖", "success");
        loadShipments();
        closeShipmentDetailModal();
    } catch(e) {
        const errorMsg = e.detail || "No suitable vehicles found for this journey configuration.";
        showNotification(`Assignment Failed: ${errorMsg}`, "danger");
    }
}

window.closeShipmentDetailModal = function() {
    document.getElementById('shipment-detail-modal').style.display = 'none';
}

async function openManualAssignModal(id) {
    currentAssignId = id;
    const modal = document.getElementById('manual-assign-modal');
    const container = document.getElementById('manual-assign-container') || document.createElement('div');
    container.id = 'manual-assign-container';
    
    // Clear previous dynamic content but keep the basic structure
    modal.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <h3 style="margin:0;" data-i18n="manual_assignment">Manual Assignment</h3>
            <button style="background:none; border:none; color:white; font-size:1.5rem; cursor:pointer;" onclick="document.getElementById('manual-assign-modal').style.display='none'">&times;</button>
        </div>
        <p class="subtitle" style="margin-bottom:25px;" data-i18n="manual_assignment_desc">Assign specific fleet units to this journey.</p>
        <div id="assign-legs-list" style="max-height:400px; overflow-y:auto; padding-right:10px;">
             <div style="text-align:center; padding:40px;"><div class="spinner"></div><p style="margin-top:10px; color:var(--text-muted);">Fetching journey intel...</p></div>
        </div>
        <button id="confirm-assign-btn" class="btn-primary" onclick="submitManualAssign()" style="width:100%; padding:14px; font-weight:800; letter-spacing:1px; margin-top:20px;">CONFIRM ALL ASSIGNMENTS</button>
    `;
    modal.style.display = 'block';

    try {
        const companyId = localStorage.getItem('manager_id');
        const shipment = await apiCall(`/shipments/${id}`, 'GET');
        const list = document.getElementById('assign-legs-list');
        list.innerHTML = '';

        const legsToAssign = [];
        const children = globalShipments.filter(l => l.parent_id === id).sort((a,b) => a.leg_order - b.leg_order);
        
        if (children.length > 0) {
            // Use locally discovered children
            legsToAssign.push(...children);
        } else if (shipment.child_leg_ids && shipment.child_leg_ids.length > 0 && !shipment.is_leg) {
            // It's a parent, assign children from backend list
            for (const legId of shipment.child_leg_ids) {
                const leg = await apiCall(`/shipments/${legId}`, 'GET');
                legsToAssign.push(leg);
            }
        } else {
            // Single shipment or already a leg
            legsToAssign.push(shipment);
        }

        for (const leg of legsToAssign) {
            const legCard = document.createElement('div');
            legCard.className = 'glass-card';
            legCard.style.cssText = 'padding:15px; margin-bottom:15px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05);';
            
            const legType = leg.leg_type ? leg.leg_type.replace('_', ' ').toUpperCase() : 'DIRECT JOURNEY';
            const icon = leg.leg_type === 'middle_mile' ? '🚛' : (leg.leg_type === 'last_mile' ? '🚁' : '🚲');
            
            legCard.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <span style="font-size:0.7rem; font-weight:800; color:var(--accent); letter-spacing:1px;">${icon} ${legType}</span>
                    <span style="font-size:0.65rem; color:var(--text-muted); font-family:monospace;">ID: ${leg.id.substring(0,8)}</span>
                </div>
                <div style="font-size:0.85rem; margin-bottom:12px; color:var(--text-muted);">
                    ${leg.pickup.address || leg.pickup.name || 'Current'} → ${leg.drop.address || leg.drop.name || 'Next'}
                </div>
                <select id="select-leg-${leg.id}" class="polished-glass-input leg-assign-select" data-leg-id="${leg.id}" style="width:100%; padding:10px; font-size:0.85rem;">
                    <option value="">Searching for eligible ${legType} fleet...</option>
                </select>
            `;
            list.appendChild(legCard);

            // Fetch eligible assets for this specific leg
            apiCall(`/shipments/assets/eligible/${leg.id}?company_id=${companyId}`, 'GET').then(eligible => {
                const select = document.getElementById(`select-leg-${leg.id}`);
                select.innerHTML = '<option value="">Select Asset for this leg</option>';
                
                const renderGroup = (label, assets, icon) => {
                    if (!assets || assets.length === 0) return null;
                    const group = document.createElement('optgroup');
                    group.label = label;
                    assets.sort((a, b) => (b.driver_rating || 0) - (a.driver_rating || 0));
                    assets.forEach(a => {
                        const opt = document.createElement('option');
                        opt.value = JSON.stringify({ driver_id: a.driver_id, vehicle_id: a.vehicle_id });
                        const rating = a.driver_rating ? ` [⭐ ${a.driver_rating.toFixed(1)}]` : '';
                        const plate = a.vehicle_plate ? ` [${a.vehicle_plate}]` : '';
                        opt.textContent = `${icon} ${a.driver_name}${rating} (${a.vehicle_type})${plate}`;
                        group.appendChild(opt);
                    });
                    return group;
                };

                const groups = [
                    renderGroup('📍 Local Hub Assets', eligible.local, '👤'),
                    renderGroup('🔄 Back-haul Optimized', eligible.returning, '🚛'),
                    renderGroup('🛰️ Drone Fleet', eligible.drones, '🚁'),
                    renderGroup('🌐 Other Available', eligible.others, '👤')
                ];

                groups.forEach(g => { if(g) select.appendChild(g); });
                if (select.options.length <= 1) select.innerHTML = '<option value="">No valid vehicles found for this leg weight/type</option>';
            });
        }

    } catch(e) {
        console.error("Manual Assign Load Error:", e);
        showNotification("Failed to load journey segments", "error");
    }
}

async function submitManualAssign() {
    const selects = document.querySelectorAll('.leg-assign-select');
    const assignments = [];
    
    for (const select of selects) {
        if (!select.value) {
            return alert(`Please select an asset for leg ${select.getAttribute('data-leg-id').substring(0,8)}`);
        }
        assignments.push({
            leg_id: select.getAttribute('data-leg-id'),
            data: JSON.parse(select.value)
        });
    }

    try {
        const btn = document.getElementById('confirm-assign-btn');
        btn.disabled = true;
        btn.innerText = "UPDATING ROSTERS...";

        for (const ass of assignments) {
            await apiCall(`/shipments/${ass.leg_id}/assign`, 'POST', {
                driver_id: ass.data.driver_id,
                vehicle_id: ass.data.vehicle_id
            });
        }
        
        showNotification("All journey legs assigned successfully!", "success");
        document.getElementById('manual-assign-modal').style.display = 'none';
        loadShipments();
    } catch(e) {
        showNotification("Partial assignment failure. Check fleet status.", "error");
    } finally {
        const btn = document.getElementById('confirm-assign-btn');
        btn.disabled = false;
        btn.innerText = "CONFIRM ALL ASSIGNMENTS";
    }
}

async function openManualSplit(id) {
    currentSplitId = id;
    goToSplitStep1();
    try {
        const warehouses = await apiCall(`/manager/warehouses?company_id=${localStorage.getItem('manager_id')}`);
        const container = document.getElementById('split-wh-container');
        const searchInput = document.getElementById('split-wh-search');
        if (searchInput) searchInput.value = '';
        
        container.innerHTML = '';
        warehouses.forEach(w => {
            const item = document.createElement('div');
            item.className = 'wh-split-item';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '12px';
            item.style.padding = '10px 15px';
            item.style.marginBottom = '8px';
            item.style.background = 'rgba(255,255,255,0.03)';
            item.style.borderRadius = '12px';
            item.style.transition = 'all 0.2s ease';
            item.style.cursor = 'pointer';
            
            item.innerHTML = `
                <input type="checkbox" value="${w.id}" data-wh-name="${w.name}" class="wh-checkbox" id="wh-split-${w.id}" style="width:18px; height:18px; cursor:pointer; accent-color:var(--primary);">
                <label for="wh-split-${w.id}" style="flex:1; cursor:pointer; font-weight:600; font-size:0.9rem; color:var(--text);">${w.name}</label>
            `;
            
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const cb = item.querySelector('input');
                    cb.checked = !cb.checked;
                }
            });

            container.appendChild(item);
        });
        document.getElementById('split-modal').style.display = 'block';
    } catch(e) {}
}

function goToSplitStep1() {
    document.getElementById('split-step-1').style.display = 'block';
    document.getElementById('split-modal-title').innerText = "Manual Route Split";
}

async function submitManualSplit() {
    const checkboxes = document.querySelectorAll('.wh-checkbox:checked');
    if (checkboxes.length === 0) {
        showNotification("Please select at least one warehouse.", "warning");
        return;
    }
    
    const warehouseIds = Array.from(checkboxes).map(cb => cb.value);
    
    try {
        const res = await apiCall(`/shipments/${currentSplitId}/split/manual?company_id=${localStorage.getItem('manager_id')}`, 'POST', {
            warehouse_ids: warehouseIds,
            assignments: [] // Empty as per user request (don't ask for driver details now)
        });
        
        showNotification(res.message, "success");
        document.getElementById('split-modal').style.display = 'none';
        closeShipmentDetailModal();
        loadShipments();
    } catch(e) {
        showNotification("Manual split failed.", "error");
    }
}


function filterSplitWarehouses() {
    const q = document.getElementById('split-wh-search').value.toLowerCase();
    const items = document.querySelectorAll('.wh-split-item');
    items.forEach(item => {
        const name = item.querySelector('label').innerText.toLowerCase();
        item.style.display = name.includes(q) ? 'flex' : 'none';
    });
}

async function submitManualSplit() {
    const checkboxes = document.querySelectorAll('.wh-checkbox:checked');
    const warehouse_ids = Array.from(checkboxes).map(c => c.value);
    
    const assetSelects = document.querySelectorAll('.leg-asset-select');
    const assignments = Array.from(assetSelects).map(s => {
        if (!s.value) return null;
        return JSON.parse(s.value);
    });

    try {
        const res = await apiCall(`/shipments/${currentSplitId}/split/manual`, 'POST', { 
            warehouse_ids, 
            assignments,
            company_id: localStorage.getItem('manager_id') 
        });
        alert(res.message);
        document.getElementById('split-modal').style.display = 'none';
        loadShipments();
    } catch(e) {
        console.error("Split Error:", e);
        const msg = (typeof e === 'object') ? JSON.stringify(e) : e;
        alert("API Error [" + `/shipments/${currentSplitId}/split/manual` + "]: " + msg);
    }
}

async function autoAssign(id) {
    try {
        const res = await apiCall(`/shipments/${id}/auto-assign`, 'POST');
        if (res.action === 'split') {
            showNotification(`Shipment segmented into ${res.legs_count} legs. ${res.assigned_count} drivers linked.`, 'success');
        } else {
            showNotification("AI successfully assigned driver and vehicle.", "success");
        }
        loadShipments();
    } catch(e) {
        showNotification("Auto-assignment failed. No suitable drivers or vehicles found in proximity.", "error");
    }
}


async function bulkAssign() {
    if (!confirm("Are you sure you want to auto-assign all pending shipments?")) return;
    try {
        const res = await apiCall(`/shipments/bulk-assign?company_id=${localStorage.getItem('manager_id')}`, 'POST');
        alert(res.message);
        loadShipments();
    } catch(e) {}
}

let trackMap;
let trackMarkers = [];

async function openTrackModal(shipmentId) {
    document.getElementById('track-shipment-id').innerText = shipmentId.substring(0,8);
    document.getElementById('track-shipment-id').style.color = '#fff';
    document.getElementById('track-shipment-id').style.backgroundColor = 'rgba(255,255,255,0.1)';
    document.getElementById('track-shipment-id').style.padding = '2px 8px';
    document.getElementById('track-shipment-id').style.borderRadius = '4px';
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
        
        let parentId = target.is_leg ? target.parent_id : target.id;
        let legs = shipments.filter(s => s.parent_id === parentId);
        const mainShipment = target.is_leg ? target : (legs.length > 0 ? (shipments.find(s => s.id === parentId) || target) : target);
        
        // Filter out obsolete legs not in the active child_leg_ids array
        if (mainShipment.child_leg_ids && mainShipment.child_leg_ids.length > 0) {
            legs = legs.filter(s => mainShipment.child_leg_ids.includes(s.id));
        }
        legs.sort((a,b) => a.leg_order - b.leg_order);
        
        // 1. Plot Origin (of the tracked segment)
        let pName = mainShipment.pickup.address || mainShipment.pickup.name || "Initial Pickup";
        const originMarker = L.marker([mainShipment.pickup.lat, mainShipment.pickup.lng], {icon: ICON_PICKUP})
            .addTo(trackMap).bindPopup(target.is_leg ? `<b>Leg ${target.leg_order} Pickup:</b> ${pName}` : `<b>Initial Pickup:</b> ${pName}`);
        trackMarkers.push(originMarker);

        // 2. Plot Destination (of the tracked segment)
        let dName = mainShipment.drop.address || mainShipment.drop.name || "Final Delivery Point";
        const destinationMarker = L.marker([mainShipment.drop.lat, mainShipment.drop.lng], {icon: ICON_DROP})
            .addTo(trackMap).bindPopup(target.is_leg ? `<b>Leg ${target.leg_order} Drop:</b> ${dName}` : `<b>Final Delivery Point:</b> ${dName}`);
        trackMarkers.push(destinationMarker);

        // 3. Plot Intermediate Hubs (ONLY if it's the Parent view)
        if (!target.is_leg && legs.length > 1) {
            legs.forEach((leg, idx) => {
                if (idx < legs.length - 1) {
                    const hubMarker = L.marker([leg.drop.lat, leg.drop.lng], {icon: ICON_WAREHOUSE})
                        .addTo(trackMap).bindPopup(`<b>Hub ${idx + 1}:</b> ${leg.drop.address || leg.drop.name || 'Network Hub'}`);
                    trackMarkers.push(hubMarker);
                }
            });
        }

        // 4. Plot Active Location
        let activeLeg = target.is_leg ? target : (legs.find(l => l.status === 'in_transit' || l.status === 'assigned') || legs[legs.length - 1] || target);
        
        if (activeLeg.current_location) {
            const mC = L.circleMarker([activeLeg.current_location.lat, activeLeg.current_location.lng], {
                color: '#fff', fillColor: '#3b82f6', weight: 3, radius: 10, fillOpacity: 1
            }).addTo(trackMap).bindPopup("Current Unit Location");
            trackMarkers.push(mC);
            trackMap.setView([activeLeg.current_location.lat, activeLeg.current_location.lng], 8);
        } else {
            trackMap.setView([activeLeg.pickup.lat, activeLeg.pickup.lng], 8);
        }

        // 5. Draw Routes (OSRM)
        const segments = legs.length > 0 ? legs : [target];
        for (const seg of segments) {
            if (seg.route_type === 'drone-leg') {
                const dronePath = L.polyline([[seg.pickup.lat, seg.pickup.lng], [seg.drop.lat, seg.drop.lng]], {color: '#f6ad55', weight: 3, dashArray: '5, 10'}).addTo(trackMap);
                trackMarkers.push(dronePath);
            } else {
                try {
                    const rRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${seg.pickup.lng},${seg.pickup.lat};${seg.drop.lng},${seg.drop.lat}?overview=full&geometries=geojson`);
                    const rData = await rRes.json();
                    if(rData.routes && rData.routes[0]) {
                        const coords = rData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                        const color = seg.status === 'delivered' ? '#a0aec0' : '#3182ce';
                        const pline = L.polyline(coords, {color, weight: 6, opacity: 0.85}).addTo(trackMap);
                        trackMarkers.push(pline);
                    }
                } catch(e) {}
            }
        }

        document.getElementById('track-status').innerText = target.status.toUpperCase();
        document.getElementById('track-current').innerText = activeLeg.status === 'in_transit' ? 'In Transit' : activeLeg.status.toUpperCase();
        
        let nextStopStr = activeLeg.drop.address || activeLeg.drop.name || 'Network Hub';
        if (activeLeg.leg_type === 'last_mile' || (!activeLeg.is_leg && !legs.length)) {
            nextStopStr = activeLeg.drop.address || activeLeg.drop.name || 'Receiver Address';
        }
        document.getElementById('track-next').innerText = nextStopStr;

        // 6. Contact Surface
        const allDrivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`);
        const allWh = await apiCall(`/manager/warehouses?company_id=${localStorage.getItem('manager_id')}`);
        
        let cLabel = "📞 Contact Driver:";
        let cVal = "N/A";

        if (activeLeg.route_type === 'drone-leg') {
            const wh = allWh.find(w => w.id === (activeLeg.at_warehouse_id || activeLeg.pickup_warehouse_id));
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
        safetyRating -= (accidents * 1.0); // Penalty for accidents
        safetyRating -= (challans * 0.2);   // Penalty for challans
        safetyRating += (exp * 0.1);       // Reward for years of experience
        safetyRating = Math.max(1.0, Math.min(5.0, safetyRating)); // Cap between 1 and 5

        const driverData = {
            company_id: localStorage.getItem('manager_id'),
            name: document.getElementById('d-name').value,
            login_id: document.getElementById('d-login').value,
            password: document.getElementById('d-pass').value,
            license_type: document.getElementById('d-license').value,
            base_warehouse_id: document.getElementById('d-hub').value,
            years_experience: exp,
            past_accidents: accidents,
            traffic_violations: challans,
            challan_count: challans,
            driving_score: 100.0,
            safety_rating: safetyRating.toFixed(1),
            on_time_rate: 100,
            contact_number: document.getElementById('d-contact') ? (document.getElementById('d-contact').value.length === 10 ? "+91" + document.getElementById('d-contact').value : document.getElementById('d-contact').value) : "N/A"
        };
        await apiCall('/manager/drivers', 'POST', driverData);
        document.getElementById('add-driver-form').reset();
        showNotification("Driver registered successfully!", "success");
        loadDriversAndVehicles();
    } catch(e) {
        showNotification("Failed to register driver.", "error");
    }
});

document.getElementById('add-vehicle-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const vehicleData = {
            company_id: localStorage.getItem('manager_id'),
            type: document.getElementById('v-type').value,
            number_plate: document.getElementById('v-plate').value.replace(/\s/g, '').toUpperCase(),
            capacity: parseFloat(document.getElementById('v-cap').value),
            speed: 60,
            fuel_efficiency: parseFloat(document.getElementById('v-eff').value),
            base_warehouse_id: document.getElementById('v-hub').value,
            vehicle_health_score: 100
        };
        await apiCall('/manager/vehicles', 'POST', vehicleData);
        document.getElementById('add-vehicle-form').reset();
        showNotification("Vehicle registered successfully!", "success");
        loadDriversAndVehicles();
    } catch(e) {
        showNotification("Failed to register vehicle.", "error");
    }
});

document.getElementById('add-drone-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    submitNewDrone();
});

document.getElementById('link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dId = document.getElementById('link-driver').value;
    const vId = document.getElementById('link-vehicle').value;
    if (!dId || !vId) return alert("Select both driver and vehicle");

    // Validation: Same Warehouse Base & Matching License/Vehicle Type
    const driver = globalDrivers.find(d => d.id === dId);
    const vehicle = globalVehicles.find(v => v.id === vId);
    if (driver && vehicle) {
        if (driver.base_warehouse_id !== vehicle.base_warehouse_id) {
            return alert("🚨 Hub Mismatch: Driver and Vehicle must belong to the same base hub for linkage.");
        }
        if (driver.license_type !== vehicle.type) {
            return alert(`🚨 License Mismatch: Driver ${driver.name} has ${driver.license_type} license, cannot drive ${vehicle.type}.`);
        }
    }
    
    try {
        await apiCall(`/manager/link-vehicle?driver_id=${dId}&vehicle_id=${vId}&company_id=${localStorage.getItem('manager_id')}`, 'POST');
        alert("Linked successfully!");
        loadDriversAndVehicles();
    } catch(e) {}
});

let currentMsgShipmentId = null;
let currentMsgDriverId = null;

let miniChatDriverId = null;
let miniChatShipmentId = null;
let miniChatMsgs = [];
let miniChatMediaData = null; // { type: 'image'|'audio', url: base64 }
let miniChatMediaRecorder = null;
let miniChatRecording = false;

async function openMessageModal(shipmentId, driverId) {
    if (!driverId || driverId === 'null' || driverId === 'undefined') {
        alert("Cannot message: No driver assigned to this shipment/leg.");
        return;
    }
    miniChatShipmentId = shipmentId === 'null' ? null : shipmentId;
    miniChatDriverId = driverId;

    if (!globalDrivers.length) {
        const mId = localStorage.getItem('manager_id');
        try {
            globalDrivers = await apiCall(`/manager/drivers?company_id=${mId}`);
        } catch(e) { console.error("Failed to load global drivers for chat", e); }
    }
    const driver = globalDrivers.find(d => d.id === driverId) || { name: 'Driver' };

    let popup = document.getElementById('mini-chat-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'mini-chat-popup';
        popup.innerHTML = `
            <div id="mini-chat-header" style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(79,140,255,0.15);border-bottom:1px solid var(--border);cursor:move;border-radius:18px 18px 0 0;">
                <img id="mini-chat-avatar" src="" style="width:34px;height:34px;border-radius:50%;border:2px solid var(--primary);object-fit:cover;">
                <div style="flex:1;">
                    <div id="mini-chat-name" style="font-weight:700;font-size:0.95rem;color:var(--primary);"></div>
                    <div style="font-size:0.7rem;color:var(--muted);">Direct Line</div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button onclick="showSection('messages');closeMiniChat()" title="Open in full Messages" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;">⤢</button>
                    <button onclick="closeMiniChat()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.1rem;">✕</button>
                </div>
            </div>
            <div id="mini-chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;"></div>
            <div id="mini-chat-media-preview" style="display:none;padding:8px 16px;background:rgba(0,0,0,0.2);border-top:1px solid var(--border);align-items:center;gap:10px;"></div>
            <div style="padding:12px 16px;border-top:1px solid var(--border);flex-shrink:0;">
                <div style="display:flex;gap:8px;align-items:center;">
                    <button onclick="miniChatPickPhoto()" title="Send Photo" class="chat-icon-btn" style="padding:8px 10px;font-size:1rem;">📷</button>
                    <button id="mini-chat-voice-btn" onclick="miniChatToggleRecording()" title="Voice Note" class="chat-icon-btn" style="padding:8px 10px;font-size:1rem;">🎙️</button>
                    <input id="mini-chat-photo-input" type="file" accept="image/*" style="display:none;" onchange="miniChatHandlePhoto(this)">
                    <input id="mini-chat-input" type="text" placeholder="Message..." class="chat-text-input" style="flex:1;min-width:100px;font-size:0.9rem;" onkeydown="if(event.key==='Enter')miniChatSend()">
                    <button onclick="miniChatSend()" class="btn-primary" style="padding:8px 16px;border-radius:10px;font-weight:700;">Send</button>
                </div>
            </div>
        `;
        popup.style.cssText = `
            position: fixed; bottom: 20px; right: 24px; width: 360px; height: 520px;
            background: rgba(15,23,42,0.96); backdrop-filter: blur(24px);
            border: 1px solid var(--border); border-radius: 18px;
            display: flex; flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6);
            z-index: 99999; animation: slideUp 0.3s ease;
        `;
        document.body.appendChild(popup);
        makeDraggable(popup, document.getElementById('mini-chat-header'));
    }

    popup.style.display = 'flex';
    document.getElementById('mini-chat-name').innerText = driver.name;
    document.getElementById('mini-chat-avatar').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.name}`;
    miniChatMediaData = null;
    document.getElementById('mini-chat-media-preview').style.display = 'none';
    document.getElementById('mini-chat-media-preview').innerHTML = '';
    
    const input = document.getElementById('mini-chat-input');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 100);
    }

    await miniChatLoadHistory();
}

function closeMiniChat() {
    const popup = document.getElementById('mini-chat-popup');
    if (popup) popup.style.display = 'none';
    if (miniChatMediaRecorder && miniChatRecording) {
        miniChatMediaRecorder.stop();
    }
}

async function miniChatLoadHistory() {
    const mId = localStorage.getItem('manager_id');
    const allMsgs = await apiCall(`/tracking/messages/${mId}?company_id=${mId}`);
    miniChatMsgs = allMsgs.filter(m => m.sender_id === miniChatDriverId || m.receiver_id === miniChatDriverId)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    miniChatRender();
}

function miniChatRender() {
    const container = document.getElementById('mini-chat-messages');
    if (!container) return;
    container.innerHTML = miniChatMsgs.length === 0
        ? '<div style="text-align:center;color:var(--muted);font-size:0.85rem;padding:30px;">No messages yet. Say hello! 👋</div>'
        : miniChatMsgs.map(m => {
            const isMe = m.sender_type === 'manager';
            let mediaHtml = '';
            if (m.media_type === 'image' && m.media_url) {
                mediaHtml = `<img src="${m.media_url}" style="max-width:100%;border-radius:8px;margin-top:6px;display:block;" alt="photo">`;
            } else if (m.media_type === 'audio' && m.media_url) {
                mediaHtml = `<div class="audio-placeholder" data-src="${m.media_url}" data-accent="${isMe ? 'rgba(255,255,255,0.25)' : 'rgba(79,140,255,0.4)'}"></div>`;
            }
            return `
                <div style="display:flex;justify-content:${isMe ? 'flex-end' : 'flex-start'};">
                    <div style="max-width:80%;padding:10px 14px;border-radius:14px;
                                background:${isMe ? 'var(--primary)' : 'rgba(255,255,255,0.07)'};
                                color:${isMe ? '#fff' : 'var(--text)'};
                                border-bottom-${isMe ? 'right' : 'left'}-radius:2px;
                                border:1px solid ${isMe ? 'transparent' : 'var(--border)'};
                                box-shadow:0 2px 8px rgba(0,0,0,0.15);">
                        ${m.content ? `<div style="font-size:0.9rem;line-height:1.4;">${m.content}</div>` : ''}
                        ${mediaHtml}
                        <div style="font-size:0.6rem;margin-top:4px;text-align:right;opacity:0.65;">
                            ${new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    container.scrollTop = container.scrollHeight;
    // Inject custom audio players
    container.querySelectorAll('.audio-placeholder').forEach(ph => {
        ph.replaceWith(buildAudioPlayer(ph.dataset.src, ph.dataset.accent));
    });
}

async function miniChatSend() {
    const input = document.getElementById('mini-chat-input');
    const content = (input.value || '').trim();
    if (!content && !miniChatMediaData) return;

    const mId = localStorage.getItem('manager_id');
    const payload = {
        company_id: mId,
        shipment_id: miniChatShipmentId,
        sender_id: mId,
        receiver_id: miniChatDriverId,
        content: content || (miniChatMediaData ? '[Media]' : ''),
        sender_type: 'manager',
        media_url: miniChatMediaData ? miniChatMediaData.url : null,
        media_type: miniChatMediaData ? miniChatMediaData.type : null
    };

    try {
        await apiCall('/tracking/messages', 'POST', payload);
        input.value = '';
        miniChatMediaData = null;
        document.getElementById('mini-chat-media-preview').style.display = 'none';
        document.getElementById('mini-chat-media-preview').innerHTML = '';
        await miniChatLoadHistory();
        // Also refresh main messages if open
        if (currentActiveSection === 'messages') loadMessages();
    } catch(e) {
        showNotification(getTranslation('msg_failed', 'en'), 'error');
    }
}

function miniChatPickPhoto() {
    document.getElementById('mini-chat-photo-input').click();
}

function miniChatHandlePhoto(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        miniChatMediaData = { type: 'image', url: e.target.result };
        const preview = document.getElementById('mini-chat-media-preview');
        preview.style.display = 'flex';
        preview.innerHTML = `<img src="${e.target.result}" style="height:60px;border-radius:8px;border:1px solid var(--border);"><span style="font-size:0.75rem;color:var(--muted);flex:1;">Photo ready to send</span><button onclick="miniChatClearMedia()" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1.1rem;">✕</button>`;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function miniChatClearMedia() {
    miniChatMediaData = null;
    const preview = document.getElementById('mini-chat-media-preview');
    preview.style.display = 'none';
    preview.innerHTML = '';
}

async function miniChatToggleRecording() {
    const btn = document.getElementById('mini-chat-voice-btn');
    if (!miniChatRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const chunks = [];
            miniChatMediaRecorder = new MediaRecorder(stream);
            miniChatMediaRecorder.ondataavailable = e => chunks.push(e.data);
            miniChatMediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = (ev) => {
                    miniChatMediaData = { type: 'audio', url: ev.target.result };
                    const preview = document.getElementById('mini-chat-media-preview');
                    preview.style.display = 'flex';
                    preview.innerHTML = `<button onclick="miniChatClearMedia()" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1.1rem;flex-shrink:0;">✕</button>`;
                    const player = buildAudioPlayer(ev.target.result, 'rgba(79,140,255,0.4)');
                    preview.insertBefore(player, preview.firstChild);
                };
                reader.readAsDataURL(blob);
                stream.getTracks().forEach(t => t.stop());
            };
            miniChatMediaRecorder.start();
            miniChatRecording = true;
            btn.innerText = '⏹️';
            btn.style.background = 'rgba(229,62,62,0.2)';
            btn.style.color = 'var(--danger)';
            btn.title = 'Stop Recording';
        } catch(e) {
            alert('Microphone access denied. Please allow microphone permission.');
        }
    } else {
        miniChatMediaRecorder.stop();
        miniChatRecording = false;
        btn.innerText = '🎙️';
        btn.style.background = 'rgba(255,255,255,0.08)';
        btn.style.color = 'var(--text)';
        btn.title = 'Voice Note';
    }
}

function makeDraggable(el, handle) {
    let ox=0,oy=0,cx=0,cy=0;
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        cx=e.clientX; cy=e.clientY;
        document.onmouseup = () => { document.onmouseup=null; document.onmousemove=null; };
        document.onmousemove = (ev) => {
            ox=cx-ev.clientX; oy=cy-ev.clientY; cx=ev.clientX; cy=ev.clientY;
            el.style.top=(el.offsetTop-oy)+'px'; el.style.left=(el.offsetLeft-ox)+'px';
            el.style.bottom='auto'; el.style.right='auto';
        };
    });
}

async function submitMessage() {
    // Legacy compatibility wrapper
    const content = document.getElementById('msg-content')?.value;
    if (!content) return;
    try {
        await apiCall('/tracking/messages', 'POST', {
            shipment_id: miniChatShipmentId,
            company_id: localStorage.getItem('manager_id'),
            sender_id: localStorage.getItem('manager_id'),
            receiver_id: miniChatDriverId,
            content: content,
            sender_type: 'manager'
        });
        document.getElementById('message-modal').style.display = 'none';
        showNotification(getTranslation('msg_sent', 'en'), "success");
    } catch (e) {
        alert("Failed to send message to driver.");
    }
}

async function loadDriversAndVehicles() {
    try {
        const [drivers, vehicles, warehouses, shipments, drones] = await Promise.all([
            apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/vehicles?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/warehouses?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/shipments?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/drones?company_id=${localStorage.getItem('manager_id')}`).catch(() => [])
        ]);
        globalDrivers = drivers;
        globalVehicles = vehicles;
        globalWarehouses = warehouses;
        globalHubs = warehouses;
        globalDrones = drones;
        
        // Populate Hub Filters and Add-Form Hubs
        const dHubFilter = document.getElementById('driver-filter-hub');
        const vHubFilter = document.getElementById('vehicle-filter-hub');
        const dHubSelect = document.getElementById('d-hub');
        const vHubSelect = document.getElementById('v-hub');
        
        const hubsHtml = '<option value="">All Hubs</option>' + warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
        const baseHubsHtml = '<option value="">Select Base Hub</option>' + warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
        
        if (dHubFilter) dHubFilter.innerHTML = hubsHtml;
        if (vHubFilter) vHubFilter.innerHTML = hubsHtml;
        if (dHubSelect) dHubSelect.innerHTML = baseHubsHtml;
        if (vHubSelect) vHubSelect.innerHTML = baseHubsHtml;
        const drHubSelect = document.getElementById('drone-base-hub');
        if (drHubSelect) drHubSelect.innerHTML = baseHubsHtml;

        renderDriversTable();
        renderVehiclesTable();
        renderDronesTable();
        renderLinkedPairs();

        const verifTbody = document.getElementById('verifications-table-body');
        if (verifTbody) {
            verifTbody.innerHTML = '';
            let verifCount = 0;
            drivers.forEach(d => {
                if (d.verification_status === "pending_manual") {
                    verifCount++;
                    const assignedVehicle = vehicles.find(vh => vh.id === d.assigned_vehicle_id);
                    const unlinkedVehicles = vehicles.filter(vh => !drivers.some(dr => dr.assigned_vehicle_id === vh.id));
                    
                    let vehicleDisplay = '';
                    if (assignedVehicle) {
                        vehicleDisplay = `<span class="badge" style="background:var(--success)22; color:var(--success);">${assignedVehicle.number_plate}</span>`;
                    } else {
                        vehicleDisplay = `
                            <div style="display:flex; flex-direction:column; gap:5px;">
                                <small style="color:var(--warning);">No vehicle linked</small>
                                <select id="verif-v-select-${d.id}" style="padding:4px; font-size:0.75rem; background:rgba(0,0,0,0.2); border:1px solid var(--border); color:white; border-radius:4px;">
                                    <option value="">Select Vehicle</option>
                                    ${unlinkedVehicles.map(vh => `<option value="${vh.id}">${vh.number_plate} (${vh.type})</option>`).join('')}
                                </select>
                            </div>
                        `;
                    }

                    const imgUrl = d.verification_image || null;
                    const isBrokenRelative = imgUrl && 
                        (imgUrl.startsWith('/images/') || imgUrl.startsWith('images/'));
                    
                    let fullImgUrl = imgUrl;
                    if (imgUrl && (imgUrl.startsWith('/images/') || imgUrl.startsWith('images/'))) {
                        const cleanPath = imgUrl.startsWith('/') ? imgUrl : '/' + imgUrl;
                        const backendHost = typeof API_BASE !== 'undefined' && API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : '';
                        fullImgUrl = backendHost + cleanPath;
                    }

                    let imgHtml;
                    if (!imgUrl) {
                        imgHtml = '<span style="color:var(--text-muted); font-size:0.8rem;">No Image</span>';
                    } else if (isBrokenRelative) {
                        imgHtml = `<div style="padding:8px; background:rgba(239,68,68,0.1); border:1px solid var(--danger); border-radius:8px; font-size:0.75rem; color:var(--danger);">⚠️ Image unavailable<br><small style="opacity:0.7;">Driver must re-upload</small></div>`;
                    } else {
                        imgHtml = `<img src="${fullImgUrl}" 
                            style="max-height:80px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.3); cursor:pointer;" 
                            onclick="window.zoomImage('${fullImgUrl}')"
                            onerror="this.outerHTML='<div style=\\'padding:8px; background:rgba(239,68,68,0.1); border:1px solid var(--danger); border-radius:8px; font-size:0.75rem; color:var(--danger);\\'>⚠️ Image failed to load<br><small style=\\'opacity:0.7;\\'>Driver must re-upload</small></div>'"
                        >`;
                    }
                    
                    verifTbody.innerHTML += `<tr>
                        <td style="padding:15px 20px;"><b>${d.name}</b><br><small>${d.system_id || d.id.slice(0,8)}</small></td>
                        <td style="padding:15px 20px;">${vehicleDisplay}</td>
                        <td style="padding:15px 20px;">${imgHtml}</td>
                        <td style="padding:15px 20px; text-align:right;">
                            <div style="display:flex; gap:10px; justify-content:flex-end;">
                                <button class="btn-primary btn-success" style="padding:8px 16px; font-size:0.75rem;" onclick="manualVerify('${d.id}', 'verified')">Approve ✅</button>
                                <button class="btn-primary btn-danger" style="padding:8px 16px; font-size:0.75rem;" onclick="manualVerify('${d.id}', 'unverified')">Reject ❌</button>
                            </div>
                        </td>
                    </tr>`;
                }
            });
            
            if (verifCount === 0) {
                verifTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:40px; color:var(--text-muted);">🎉 All caught up! No pending manual verifications.</td></tr>';
            }
            
            const badge = document.getElementById('verif-badge');
            if (badge) {
                badge.style.display = verifCount > 0 ? 'inline-block' : 'none';
            }

            const verifSection = document.getElementById('manual-verifications-section');
            if (verifSection) {
                verifSection.style.display = verifCount > 0 ? 'block' : 'none';
            }
        }

        // Verified Vehicles Table
        const verifiedTbody = document.getElementById('verified-vehicles-table-body');
        if (verifiedTbody) {
            verifiedTbody.innerHTML = '';
            let registryCount = 0;
            drivers.forEach(d => {
                if (d.verification_status === "verified" && d.assigned_vehicle_id) {
                    registryCount++;
                    const v = vehicles.find(vh => vh.id === d.assigned_vehicle_id);
                    if (v) {
                        const hasActiveShipment = shipments.some(s => s.assigned_driver_id === d.id && ["assigned", "in_transit", "picked_up"].includes(s.status));
                        verifiedTbody.innerHTML += `<tr>
                            <td>${v.type}</td>
                            <td><b style="font-family:monospace; letter-spacing:1px;">${formatDisplayPlate(v.number_plate)}</b></td>
                            <td><small>${v.system_id || v.id.slice(0,8)}</small></td>
                            <td>${d.name}</td>
                            <td>
                                <button class="btn-primary" style="padding:4px 8px; font-size:0.8rem; background:var(--danger)" 
                                    ${hasActiveShipment ? 'disabled title="Vehicle in use"' : ''}
                                    onclick="unverifyDriver('${d.id}')">Unverify</button>
                            </td>
                        </tr>`;
                    }
                }
            });
            
            if (registryCount === 0) {
                verifiedTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">No verified assets in registry yet.</td></tr>';
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
    if (!Array.isArray(globalDrivers)) globalDrivers = [];
    if (!Array.isArray(globalWarehouses)) globalWarehouses = [];
    
    dtbody.innerHTML = '';
    if (dSelect) dSelect.innerHTML = '<option value="">Select Driver</option>';
    
    const searchTerm = (document.getElementById('driver-search')?.value || '').toLowerCase();
    const typeFilter = document.getElementById('driver-filter-type')?.value || '';
    const hubFilter = document.getElementById('driver-filter-hub')?.value || '';
    const sortMode = document.getElementById('driver-sort')?.value || 'name';

    let filtered = globalDrivers.filter(d => {
        const matchesSearch = (d.name || '').toLowerCase().includes(searchTerm) || (d.system_id || '').toLowerCase().includes(searchTerm);
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

    const limit = window.tableLimits.drivers;
    const limited = filtered.slice(0, limit);

    limited.forEach(d => {
        const joinDate = d.join_date ? new Date(d.join_date) : new Date();
        const diffDays = Math.floor(Math.abs(new Date() - joinDate) / (1000 * 60 * 60 * 24));
        const baseWh = globalWarehouses.find(w => w.id === d.base_warehouse_id);
        
        let linkedVehInfo = `<span class="status-pill" style="background:var(--warning)22; color:var(--warning); margin:0;">Unlinked</span>`;
        if (d.assigned_vehicle_id) {
            const v = globalVehicles.find(vh => vh.id === d.assigned_vehicle_id);
            if (v) {
                const vHub = globalWarehouses.find(w => w.id === v.base_warehouse_id);
                linkedVehInfo = `
                    <div style="font-size:0.85rem; font-weight:bold; color:var(--success);">
                        🚗 ${formatDisplayPlate(v.number_plate)}
                    </div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">
                        📍 Hub: ${vHub ? vHub.name : 'N/A'}
                    </div>
                `;
            }
        }

        dtbody.innerHTML += `<tr>
            <td><b style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="openDriverProfile('${d.id}')">${d.name}</b><br><small style="color:var(--accent); font-family:monospace;">${d.system_id || 'ID: ' + d.id.substring(0,8)}</small></td>
            <td><small style="font-family:monospace;">${d.login_id || 'N/A'}</small></td>
            <td>
                <div style="display:flex; align-items:center; gap:5px;">
                    <input type="password" value="${d.password || ''}" readonly id="pass-d-${d.id}" style="background:none; border:none; color:var(--text); font-family:monospace; font-size:0.8rem; width:80px; outline:none;">
                    <button onclick="togglePasswordVisibility('pass-d-${d.id}', this)" style="background:none; border:none; cursor:pointer; font-size:0.9rem; padding:0;">👁️</button>
                </div>
            </td>
            <td><span class="status-pill" style="background:rgba(255,255,255,0.1)">${d.license_type || 'N/A'}</span></td>
            <td><b style="color:var(--primary);">${diffDays} Days</b></td>
            <td>${d.driving_score ? d.driving_score.toFixed(1) : '100.0'}/100<br><small>Safety: ${d.safety_rating || 5.0}⭐</small></td>
            <td><span style="color:${d.past_accidents > 0 ? 'var(--danger)' : 'var(--success)'}">${d.past_accidents || 0}</span></td>
            <td><span style="color:${d.challan_count > 0 ? 'var(--danger)' : 'var(--success)'}">${d.challan_count}</span></td>
            <td><strong style="color:var(--accent)">${d.reward_points || 0}</strong></td>
            <td><small>${baseWh ? baseWh.name : 'N/A'}</small></td>
            <td>${linkedVehInfo}</td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="btn-primary btn-accent" style="padding:8px; border-radius:8px; width:36px; height:36px;" onclick="openEditModal('drivers', '${d.id}')" title="Edit">✏️</button>
                    <button class="btn-primary btn-danger" style="padding:8px; border-radius:8px; width:36px; height:36px;" onclick="deleteItem('drivers', '${d.id}')" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>`;
        if (dSelect && !d.assigned_vehicle_id) {
            dSelect.innerHTML += `<option value="${d.id}">${d.name} (${d.system_id}) - ${baseWh ? baseWh.name : 'No Hub'}</option>`;
        }
    });
    renderTableControls('drivers', filtered.length, window.tableLimits.drivers, 'renderDriversTable');
    if (window.updatePageTranslations) updatePageTranslations();
};

window.renderLinkedPairs = function() {
    const tbody = document.getElementById('linked-pairs-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = globalDrivers.filter(d => d.assigned_vehicle_id);
    const limit = window.tableLimits['linked-pairs'];
    const limited = filtered.slice(0, limit);

    limited.forEach(d => {
        const vehicle = globalVehicles.find(v => v.id === d.assigned_vehicle_id);
        const hub = globalWarehouses.find(w => w.id === d.base_warehouse_id);
        
        tbody.innerHTML += `<tr>
            <td><b>${d.name}</b><br><small>${d.system_id}</small></td>
            <td><b>${vehicle ? vehicle.type : 'Unknown'}</b><br><small>${vehicle ? vehicle.number_plate : 'N/A'}</small></td>
            <td><small>${hub ? hub.name : 'N/A'}</small></td>
            <td style="text-align: center;">
                <button class="btn-primary btn-danger" style="padding:6px 16px; font-size:0.75rem;" onclick="unlinkVehicle('${d.id}')">Unlink</button>
            </td>
        </tr>`;
    });
    renderTableControls('linked-pairs', filtered.length, limit, 'renderLinkedPairs');
    if (window.updatePageTranslations) updatePageTranslations();
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
    if (!Array.isArray(globalVehicles)) globalVehicles = [];
    if (!Array.isArray(globalWarehouses)) globalWarehouses = [];
    
    vtbody.innerHTML = '';
    if (vSelect) vSelect.innerHTML = '<option value="">Select Vehicle</option>';
    
    const searchTerm = (document.getElementById('vehicle-search')?.value || '').toLowerCase();
    const typeFilter = document.getElementById('vehicle-filter-type')?.value || '';
    const hubFilter = document.getElementById('vehicle-filter-hub')?.value || '';
    const statusFilter = document.getElementById('vehicle-filter-status')?.value || '';
    const sortMode = document.getElementById('vehicle-sort')?.value || 'type';

    let filtered = globalVehicles.filter(v => {
        const matchesSearch = (v.number_plate || '').toLowerCase().includes(searchTerm) || (v.system_id || '').toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || v.type === typeFilter;
        const matchesHub = !hubFilter || v.base_warehouse_id === hubFilter;
        const matchesStatus = !statusFilter || v.status === statusFilter;
        return matchesSearch && matchesType && matchesHub && matchesStatus;
    });

    // Sorting
    filtered.sort((a, b) => {
        if (sortMode === 'health') return (b.vehicle_health_score || 0) - (a.vehicle_health_score || 0);
        if (sortMode === 'capacity') return (b.capacity || 0) - (a.capacity || 0);
        return a.type.localeCompare(b.type);
    });

    const limit = window.tableLimits.vehicles;
    const limited = filtered.slice(0, limit);

    limited.forEach(v => {
        const baseWh = globalWarehouses.find(w => w.id === v.base_warehouse_id);
        const activeShipment = globalShipments.find(s => s.assigned_vehicle_id === v.id && (s.status === 'assigned' || s.status === 'in_transit'));
        
        let healthColor = v.vehicle_health_score > 80 ? 'var(--success)' : (v.vehicle_health_score > 60 ? 'var(--warning)' : 'var(--danger)');
        
        let statusTag = '';
        if (v.status === 'maintenance') statusTag = `<span class="status-pill" style="background:var(--danger)22; color:var(--danger); font-size:0.6rem;">MAINTENANCE</span>`;
        else if (v.status === 'in_transit' || activeShipment) statusTag = `<span class="status-pill" style="background:var(--primary)22; color:var(--primary); font-size:0.6rem;">ON-TRIP</span>`;
        else statusTag = `<span class="status-pill" style="background:var(--success)22; color:var(--success); font-size:0.6rem;">AVAILABLE</span>`;

        let destInfo = '<span style="color:var(--text-muted)">Stationary</span>';
        if (activeShipment) {
            destInfo = `<div style="font-size:0.8rem; color:var(--primary);"><b>Dest:</b> ${activeShipment.drop_address || activeShipment.drop.address || 'Target Hub'}</div>`;
            
            // Check if it's a back-haul (returning to base)
            if (baseWh && activeShipment.drop) {
                // Approximate check if heading towards base (we don't have JS haversine yet, so we'll check address or IDs)
                if (activeShipment.drop_warehouse_id === v.base_warehouse_id) {
                    destInfo += `<span class="badge" style="background:var(--success); color:white; font-size:0.6rem; padding:2px 6px; margin-top:4px; display:inline-block;">🏠 BACK-HAUL</span>`;
                }
            }
        }

        const linkedDriver = globalDrivers.find(d => d.assigned_vehicle_id === v.id);
        
        vtbody.innerHTML += `<tr>
            <td><b>${v.type}</b><br><small style="color:var(--accent); font-family:monospace;">${v.system_id || 'ID: ' + v.id.substring(0,8)}</small></td>
            <td><b style="font-family:monospace; letter-spacing:1px;">${formatDisplayPlate(v.number_plate)}</b></td>
            <td><span style="color:${healthColor}; font-weight:bold;">${v.vehicle_health_score || 100}%</span></td>
            <td>${v.capacity}kg<br><small>Eff: ${v.fuel_efficiency}km/l</small></td>
            <td><small>${baseWh ? baseWh.name : 'N/A'}</small></td>
            <td>${destInfo}</td>
            <td>${statusTag}</td>
            <td>
                ${linkedDriver ? `<b>${linkedDriver.name}</b><br><small>${linkedDriver.system_id}</small>` : `<span class="status-pill" style="background:var(--warning)22; color:var(--warning); margin:0;">Unlinked</span>`}
            </td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="btn-primary btn-accent" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="openEditModal('vehicles', '${v.id}')" title="Edit">✏️</button>
                    <button class="btn-primary btn-danger" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="deleteItem('vehicles', '${v.id}')" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>`;
        if (vSelect && !linkedDriver) {
            vSelect.innerHTML += `<option value="${v.id}">${v.type} - ${formatDisplayPlate(v.number_plate)} (${v.system_id}) - ${baseWh ? baseWh.name : 'No Hub'}</option>`;
        }
    });
    renderTableControls('vehicles', filtered.length, window.tableLimits.vehicles, 'renderVehiclesTable');
};

window.renderDronesTable = function() {
    const dtbody = document.getElementById('drones-table-body');
    if (!dtbody) return;
    if (!Array.isArray(globalDrones)) globalDrones = [];
    
    dtbody.innerHTML = '';
    
    const searchTerm = (document.getElementById('drone-search')?.value || '').toLowerCase();
    const hubFilter = document.getElementById('drone-filter-hub')?.value || '';

    let filtered = globalDrones.filter(d => {
        const matchesSearch = (d.license_number || '').toLowerCase().includes(searchTerm) || (d.system_id || '').toLowerCase().includes(searchTerm);
        const matchesHub = !hubFilter || d.base_warehouse_id === hubFilter;
        return matchesSearch && matchesHub;
    });

    const limit = window.tableLimits.drones;
    const limited = filtered.slice(0, limit);

    limited.forEach(d => {
        const baseWh = globalWarehouses.find(w => w.id === d.base_warehouse_id);
        
        dtbody.innerHTML += `<tr>
            <td><b style="font-family:monospace;">${d.license_number}</b><br><small style="color:var(--accent);">${d.system_id || d.id.substring(0,8)}</small></td>
            <td><small>${baseWh ? baseWh.name : 'N/A'}</small></td>
            <td><b>${d.capacity}</b> kg</td>
            <td><b>${d.radius}</b> km</td>
            <td><span class="status-pill" style="background:var(--success)22; color:var(--success); font-size:0.6rem;">${getTranslation('status_ready', 'en')}</span></td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="btn-primary btn-accent" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="openEditModal('drones', '${d.id}', '${d.license_number}', '${d.base_warehouse_id}', '${d.capacity}', '${d.radius}')" title="Edit">✏️</button>
                    <button class="btn-primary btn-danger" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="deleteItem('drones', '${d.id}')" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>`;
    });
    
    if (filtered.length === 0) {
        dtbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">${getTranslation('no_drones_found', 'en')}</td></tr>`;
    }
    renderTableControls('drones', filtered.length, limit, 'renderDronesTable');
};

async function submitNewDrone() {
    const license = document.getElementById('drone-license').value;
    const hub = document.getElementById('drone-base-hub').value;
    const cap = parseFloat(document.getElementById('drone-capacity').value);
    const rad = parseFloat(document.getElementById('drone-radius').value);

    if (!license || !hub || isNaN(cap) || isNaN(rad)) {
        return showNotification("All fields are required.", "error");
    }

    try {
        await apiCall('/manager/drones', 'POST', {
            license_number: license,
            base_warehouse_id: hub,
            capacity: cap,
            radius: rad,
            company_id: localStorage.getItem('manager_id')
        });
        showNotification("Drone registered successfully!", "success");
        document.getElementById('add-drone-form').reset();
        loadDriversAndVehicles();
    } catch(err) {
        showNotification("Failed to register drone.", "error");
    }
}

async function manualVerify(driverId, status) {
    try {
        let url = `/manager/verify-driver/${driverId}?status=${status}&company_id=${localStorage.getItem('manager_id')}`;
        
        if (status === 'verified') {
            const vSelect = document.getElementById(`verif-v-select-${driverId}`);
            if (vSelect && vSelect.value) {
                url += `&vehicle_id=${vSelect.value}`;
            }
        }
        
        await apiCall(url, 'POST');
        loadDriversAndVehicles();
    } catch (e) {
        console.error("Verification failed", e);
    }
}

async function unverifyDriver(driverId) {
    if (!confirm("Are you sure you want to unverify this vehicle? This will block the driver immediately.")) return;
    try {
        await apiCall(`/manager/unverify-driver/${driverId}?company_id=${localStorage.getItem('manager_id')}`, 'POST');
        loadDriversAndVehicles();
    } catch (e) {}
}

window.togglePasswordVisibility = function(id, btn) {
    const el = document.getElementById(id);
    if (el.type === 'password') {
        el.type = 'text';
        btn.innerText = '🙈';
    } else {
        el.type = 'password';
        btn.innerText = '👁️';
    }
}

window.openEditModal = function(type, id, val1, val2, val3, val4) {
    currentEditType = type;
    currentEditId = id;
    document.getElementById('edit-type').innerText = type.charAt(0).toUpperCase() + type.slice(1);
    
    let html = '';
    const fieldStyle = `style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:10px; font-family:inherit; font-size:0.95rem;"`;
    const types = ['Truck (Heavy)', 'Truck (Small)', 'Delivery Van', 'Bike/Scooty', 'EV-Cargo'];

    if (type === 'shipments') {
        html = `<div style="display:flex;flex-direction:column;gap:10px;">
                    <input type="text" id="edit-val1" value="${val1 || ''}" placeholder="Description" ${fieldStyle}>
                    <input type="text" id="edit-val2" value="${val2 || ''}" placeholder="Status" ${fieldStyle}>
                </div>`;
    } else if (type === 'drones') {
        const hubOptions = (globalWarehouses || []).map(w => `<option value="${w.id}" ${w.id === val2 ? 'selected' : ''}>${w.name}</option>`).join('');
        html = `<div style="display:flex;flex-direction:column;gap:10px;">
                    <label style="font-size:0.75rem; color:var(--text-muted);">License Number</label>
                    <input type="text" id="edit-dr-license" value="${val1 || ''}" ${fieldStyle}>
                    <label style="font-size:0.75rem; color:var(--text-muted);">Base Warehouse</label>
                    <select id="edit-dr-hub" ${fieldStyle}>
                        ${hubOptions}
                    </select>
                    <label style="font-size:0.75rem; color:var(--text-muted);">Capacity (kg)</label>
                    <input type="number" id="edit-dr-cap" value="${val3 || ''}" ${fieldStyle}>
                    <label style="font-size:0.75rem; color:var(--text-muted);">Flight Radius (km)</label>
                    <input type="number" id="edit-dr-rad" value="${val4 || ''}" ${fieldStyle}>
                </div>`;
    } else if (type === 'drivers') {
        const d = globalDrivers.find(item => item.id === id);
        html = `<div style="display:flex;flex-direction:column;gap:10px;">
                    <label style="font-size:0.8rem; color:var(--primary);">Full Name</label>
                    <input type="text" id="edit-d-name" value="${d.name || ''}" ${fieldStyle}>
                    
                    <label style="font-size:0.8rem; color:var(--primary);">Login ID</label>
                    <input type="text" id="edit-d-login" value="${d.login_id || ''}" ${fieldStyle}>
                    
                    <label style="font-size:0.8rem; color:var(--primary);">Password</label>
                    <input type="text" id="edit-d-pass" value="${d.password || ''}" ${fieldStyle}>
                    
                    <label style="font-size:0.8rem; color:var(--primary);">License Type</label>
                    <select id="edit-d-license" ${fieldStyle}>
                        ${types.map(t => `<option value="${t}" ${t === d.license_type ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                    
                    <label style="font-size:0.8rem; color:var(--primary);">Years of Experience</label>
                    <input type="number" id="edit-d-exp" value="${d.years_experience || 0}" ${fieldStyle}>
                    
                    <label style="font-size:0.8rem; color:var(--primary);">Contact Number</label>
                    <input type="text" id="edit-d-contact" value="${d.contact_number || ''}" ${fieldStyle}>
                    
                    <label style="font-size:0.8rem; color:var(--primary);">Base Hub</label>
                    <select id="edit-d-hub" ${fieldStyle}>
                        ${globalWarehouses.map(w => `<option value="${w.id}" ${w.id === d.base_warehouse_id ? 'selected' : ''}>${w.name}</option>`).join('')}
                    </select>
                </div>`;
    } else if (type === 'vehicles') {
        const v = globalVehicles.find(item => item.id === id);
        html = `<div style="display:flex;flex-direction:column;gap:10px;">
                    <label style="font-size:0.8rem; color:var(--primary);">Number Plate</label>
                    <input type="text" id="edit-v-plate" value="${v.number_plate || ''}" ${fieldStyle}>
                    
                    <label style="font-size:0.8rem; color:var(--primary);">Vehicle Type</label>
                    <select id="edit-v-type" ${fieldStyle}>
                        ${types.map(t => `<option value="${t}" ${t === v.type ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                    
                    <label style="font-size:0.8rem; color:var(--primary);">Capacity (kg)</label>
                    <input type="number" id="edit-v-cap" value="${v.capacity || 0}" ${fieldStyle}>
                    
                    <label style="font-size:0.8rem; color:var(--primary);">Fuel Efficiency (km/l)</label>
                    <input type="number" id="edit-v-eff" value="${v.fuel_efficiency || 0}" ${fieldStyle}>
                    
                    <label style="font-size:0.8rem; color:var(--primary);">Base Hub</label>
                    <select id="edit-v-hub" ${fieldStyle}>
                        ${globalWarehouses.map(w => `<option value="${w.id}" ${w.id === v.base_warehouse_id ? 'selected' : ''}>${w.name}</option>`).join('')}
                    </select>
                </div>`;
    }
    document.getElementById('edit-fields').innerHTML = html;
    document.getElementById('edit-modal').style.display = 'block';
};

document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    let payload = { company_id: localStorage.getItem('manager_id') };
    let endpoint = `/${currentEditType}/${currentEditId}`;
    
    if (currentEditType === 'shipments') {
        const val1 = document.getElementById('edit-val1').value;
        const val2 = document.getElementById('edit-val2').value;
        payload = { ...payload, description: val1, status: val2 };
    } else if (currentEditType === 'drivers') {
        payload = { 
            ...payload, 
            name: document.getElementById('edit-d-name').value,
            login_id: document.getElementById('edit-d-login').value,
            password: document.getElementById('edit-d-pass').value,
            license_type: document.getElementById('edit-d-license').value,
            years_experience: parseFloat(document.getElementById('edit-d-exp').value),
            contact_number: document.getElementById('edit-d-contact').value,
            base_warehouse_id: document.getElementById('edit-d-hub').value
        };
        endpoint = `/manager/drivers/${currentEditId}`;
    } else if (currentEditType === 'vehicles') {
        payload = { 
            ...payload, 
            number_plate: document.getElementById('edit-v-plate').value,
            type: document.getElementById('edit-v-type').value,
            capacity: parseFloat(document.getElementById('edit-v-cap').value),
            base_warehouse_id: document.getElementById('edit-v-hub').value,
            fuel_efficiency: parseFloat(document.getElementById('edit-v-eff').value)
        };
        endpoint = `/manager/vehicles/${currentEditId}`;
    } else if (currentEditType === 'drones') {
        payload = {
            ...payload,
            license_number: document.getElementById('edit-dr-license').value,
            base_warehouse_id: document.getElementById('edit-dr-hub').value,
            capacity: parseFloat(document.getElementById('edit-dr-cap').value),
            radius: parseFloat(document.getElementById('edit-dr-rad').value)
        };
        endpoint = `/manager/drones/${currentEditId}`;
    }
    
    try {
        await apiCall(endpoint, 'PUT', payload);
        showNotification(`Successfully updated!`, "success");
        document.getElementById('edit-modal').style.display = 'none';
        
        if (currentEditType === 'shipments') loadShipments();
        else loadDriversAndVehicles();
    } catch(err) {
        showNotification("Failed to update.", "error");
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

function initWeatherMapOnMap(mapInstance) {
    // Remove the anonymous base tile layer added by updateMapTheme() so we
    // exclusively manage layers through baseLayers.
    mapInstance.eachLayer(layer => {
        if (layer instanceof L.TileLayer && !layer.options.isOverlay) {
            mapInstance.removeLayer(layer);
        }
    });

    // Define Map Layers
    const theme = localStorage.getItem('theme') || 'dark';
    const standardUrl = theme === 'dark'
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

    const standard = L.tileLayer(standardUrl, { attribution: '&copy; CARTO' });
    const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    });

    baseLayers = {
        'standard':  standard,
        'terrain':   terrain,
        'satellite': satellite
    };

    // Add standard as the active base layer immediately
    standard.addTo(mapInstance);

    // Initialize Draw FeatureGroup
    drawnItems = new L.FeatureGroup();
    mapInstance.addLayer(drawnItems);
    
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
    mapInstance.addControl(drawControl);

    mapInstance.on(L.Draw.Event.CREATED, function (e) {
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
                    zIndex: 10,
                    isOverlay: true
                }).addTo(mapInstance);
            }
        })
        .catch(e => console.log("Radar not loaded", e));

    loadWeatherFleetData();
    setInterval(loadWeatherFleetData, 10000); // Update every 10s

    // Make simulation panels draggable
    makeDraggable(document.getElementById('active-sims-container'));
    makeDraggable(document.getElementById('simulation-panel'));

    setTimeout(() => {
        if (mapInstance) {
            mapInstance.invalidateSize(true);
        }
    }, 300);
}

function makeDraggable(el) {
    if (!el) return;
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = el.querySelector('h3, h4'); 
    if (header) {
        header.onmousedown = dragMouseDown;
    } else {
        el.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        el.style.top = (el.offsetTop - pos2) + "px";
        el.style.left = (el.offsetLeft - pos1) + "px";
        el.style.right = 'auto'; 
        el.style.bottom = 'auto';
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

function changeMapLayer() {
    if (!map) return;
    const layerType = document.getElementById('map-layer').value;
    if (!baseLayers || !baseLayers[layerType]) return;

    // Remove every base tile layer (not rainviewer overlay, not SOI border)
    map.eachLayer(layer => {
        if (layer instanceof L.TileLayer && !layer.options.isOverlay) {
            map.removeLayer(layer);
        }
    });

    // Add the chosen layer
    baseLayers[layerType].addTo(map);
}

let currentDrawHandler = null;
function toggleDrawMode() {
    if (!map) { console.warn('toggleDrawMode: map not ready'); return; }
    if (!drawControl) { console.warn('toggleDrawMode: drawControl not initialised'); return; }

    const type = document.getElementById('disaster-type').value;

    // Disable any previous handler
    if (currentDrawHandler) {
        try { currentDrawHandler.disable(); } catch(e) {}
        currentDrawHandler = null;
    }

    // L.Draw options may be true (boolean) or an options object
    const drawOpts = drawControl.options && drawControl.options.draw ? drawControl.options.draw : {};
    const circleOptions   = (drawOpts.circle   && typeof drawOpts.circle   === 'object') ? drawOpts.circle   : {};
    const polylineOptions = (drawOpts.polyline  && typeof drawOpts.polyline === 'object') ? drawOpts.polyline : {};

    const circleTypes = ['cyclone', 'flood', 'heatwave', 'earthquake', 'riot', 'hail', 'storm', 'snow', 'fog', 'rain', 'cloud'];
    if (circleTypes.includes(type)) {
        currentDrawHandler = new L.Draw.Circle(map, circleOptions);
    } else {
        currentDrawHandler = new L.Draw.Polyline(map, polylineOptions);
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
        await apiCall('/simulation/disaster/custom', 'POST', payload);
        window.simulationPanelClosedByUser = false;
        loadWeatherFleetData();
    } catch(err) {
        alert("Failed to create custom disaster.");
    }
}

function closeSimulationPanel() {
    const panel = document.getElementById('simulation-panel');
    if (panel) panel.style.display = 'none';
    window.simulationPanelClosedByUser = true;
}

function applySimulationFixes() {
    alert("Executing AI contingency protocols for all affected shipments. Rerouting in progress...");
    closeSimulationPanel();
}

function executeAIAction(shipmentId) {
    alert(`AI contingecy applied for shipment ${shipmentId.substring(0,8)}. Diverting via OSRM bypass.`);
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
        const data = await apiCall('/tracking/fleet/weather?company_id=' + localStorage.getItem('manager_id'), 'GET', null, true);
        
        // Clear old markers
        weatherMarkers.forEach(m => map.removeLayer(m));
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
                <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:10px 0; font-weight:600; color:var(--text);">${c.type.toUpperCase()}</td>
                    <td style="color:var(--text-muted);">${c.shapeType}</td>
                    <td style="text-align:right;"><button class="btn-primary btn-danger" style="padding:6px 12px; font-size:0.65rem;" onclick="stopSimulation('${c.id}')">STOP</button></td>
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
                }).addTo(map).bindPopup(`<b>${cell.icon || '🌡️'} ${cell.type} System</b>`);
                weatherMarkers.push(polyline);
            } else {
                const circle = L.circle([cell.lat, cell.lng], {
                    radius: cell.radius * 1000, 
                    color: cell.color, 
                    fillColor: cell.color, 
                    fillOpacity: 0.2,
                    className: animClass
                }).addTo(map).bindPopup(`<b>${cell.icon || '🌩️'} ${cell.type} System</b><br>Severity: ${cell.severity}`);
                weatherMarkers.push(circle);
                
                // Add an icon in the center of the weather cell
                const iconMarker = L.marker([cell.lat, cell.lng], {
                    icon: L.divIcon({
                        className: 'weather-div-icon',
                        html: `<div style="font-size:24px; text-shadow: 0 0 10px rgba(0,0,0,0.5);">${cell.icon || '🌦️'}</div>`,
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    })
                }).addTo(map);
                weatherMarkers.push(iconMarker);
            }
        });
        
        // Plot Fleet
        data.fleet.forEach(v => {
            const icon = L.divIcon({
                html: `<div style="background:var(--primary); width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow: 0 0 10px var(--primary);"></div>`,
                className: 'fleet-dot'
            });
            const m = L.marker([v.lat, v.lng], {icon: icon}).addTo(map)
                .bindPopup(`
                    <b>Driver:</b> ${v.driver}<br>
                    <b>Local Weather:</b> ${v.weather.icon} ${v.weather.condition}${v.weather.temp != null ? ' · ' + v.weather.temp + '°C' : ''}<br>
                    <b>Fatigue:</b> ${v.fatigue}%
                `);
            weatherMarkers.push(m);
        });

        // Update Simulation / Automated Results Panel dynamically (real and simulation weather)
        const panel = document.getElementById('simulation-panel');
        if (panel) {
            if (data.affected_count > 0) {
                document.getElementById('sim-affected-count').innerText = data.affected_count;
                document.getElementById('sim-ai-recommendation').innerText = data.recommendation || "No action needed.";
                
                const listContainer = document.getElementById('sim-affected-list');
                if (listContainer) {
                    if (data.affected_list && data.affected_list.length > 0) {
                        listContainer.innerHTML = data.affected_list.map(s => {
                            const stage = (s.stage || '').toLowerCase();
                            const aiDiverted = stage.includes('diverted: safe hub');
                            const aiHalted   = stage.includes('halted: calamity') || stage.includes('halted: disaster');
                            const aiReturned = stage.includes('returned:');
                            const aiHandled  = aiDiverted || aiHalted || aiReturned;

                            let aiStatusBadge = '';
                            if (aiDiverted) {
                                aiStatusBadge = `<div style="margin-top:5px; display:inline-flex; align-items:center; gap:4px; background:rgba(72,187,120,0.15); border:1px solid var(--success); border-radius:20px; padding:3px 10px; font-size:0.7rem; color:var(--success); font-weight:700;">✅ Rerouted by AI — ${s.stage}</div>`;
                            } else if (aiHalted) {
                                aiStatusBadge = `<div style="margin-top:5px; display:inline-flex; align-items:center; gap:4px; background:rgba(245,101,101,0.15); border:1px solid var(--danger,#f56565); border-radius:20px; padding:3px 10px; font-size:0.7rem; color:var(--danger,#f56565); font-weight:700;">🚨 Emergency Halt — AI Decision Active</div>`;
                            } else if (aiReturned) {
                                aiStatusBadge = `<div style="margin-top:5px; display:inline-flex; align-items:center; gap:4px; background:rgba(237,137,54,0.15); border:1px solid var(--warning); border-radius:20px; padding:3px 10px; font-size:0.7rem; color:var(--warning); font-weight:700;">📋 Returning to Sender — AI Initiated</div>`;
                            }

                            const manualBtns = aiHandled ? '' : `
                                <div style="margin-top:5px; display:flex; gap:5px;">
                                    <button style="padding:2px 6px; font-size:0.7rem; background:var(--primary); border:none; color:white; border-radius:3px; cursor:pointer;" onclick="executeAIAction('${s.id}')">Apply AI Solution</button>
                                </div>`;

                            return `
                            <div style="font-size:0.75rem; margin-bottom:10px; padding:8px; background:rgba(255,255,255,0.05); border-radius:4px; border-left:3px solid ${aiHandled ? 'var(--success)' : 'var(--warning)'};">
                                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                    <strong>${s.description}</strong>
                                    <span style="color:var(--accent);">${s.id.substring(0,8)}</span>
                                </div>
                                <div style="margin:4px 0; color:var(--text-muted);">
                                    Driver: ${s.driver_name} [${s.vehicle_plate}]
                                </div>
                                <div style="color:var(--success); font-weight:600;">AI Solution: ${s.ai_action}${s.condition ? ' <span style="font-weight:400;color:var(--text-muted);">[' + s.condition + ']</span>' : ''}</div>
                                <div style="font-style:italic; font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${s.driver_instruction}</div>
                                ${aiStatusBadge}
                                ${manualBtns}
                            </div>`;
                        }).join('');
                    } else {
                        listContainer.innerHTML = '<p style="color:var(--text-muted); font-size:0.75rem;">No active shipments in path.</p>';
                    }
                }
                if (!window.simulationPanelClosedByUser) {
                    panel.style.display = 'block';
                }
            } else {
                panel.style.display = 'none';
            }
        }
        
    } catch(e) {
        console.error("Fleet fetch error", e);
    }
}

async function loadMessages() {
    try {
        const mId = localStorage.getItem('manager_id');
        const msgs = (await apiCall(`/tracking/messages/${mId}?company_id=${mId}`)) || [];
        globalDrivers = await apiCall(`/manager/drivers?company_id=${mId}`);
        
        // Ensure globalDrivers is an array and filter out invalid/null elements
        globalDrivers = (globalDrivers || []).filter(d => d && d.id && d.name);
        
        const searchInputEl = document.getElementById('driver-chat-search');
        const searchQuery = (searchInputEl ? searchInputEl.value : '').toLowerCase();
        
        // Only verified drivers should appear in the messages list
        const verifiedDrivers = globalDrivers.filter(d => d.verification_status === "verified");
        const filteredDrivers = verifiedDrivers.filter(d => d.name && typeof d.name === 'string' && d.name.toLowerCase().includes(searchQuery));
        
        const driverListContainer = document.getElementById('chat-driver-list');
        if (!driverListContainer) return;
        
        // Group messages by driver
        const conversations = {};
        
        globalDrivers.forEach(d => {
            const dMsgs = msgs.filter(m => m && (m.sender_id === d.id || m.receiver_id === d.id));
            dMsgs.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
            
            conversations[d.id] = {
                driver: d,
                messages: dMsgs,
                lastMessage: dMsgs.length > 0 ? dMsgs[dMsgs.length - 1] : null
            };
        });

        // Render Sidebar (filtered)
        if (filteredDrivers.length === 0) {
            if (verifiedDrivers.length === 0) {
                driverListContainer.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted); font-size:0.85rem;">No verified drivers found.</div>`;
            } else {
                driverListContainer.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted); font-size:0.85rem;">No drivers match the search query.</div>`;
            }
        } else {
            driverListContainer.innerHTML = filteredDrivers.map(d => {
                const conv = conversations[d.id] || { messages: [], lastMessage: null };
                const isSelected = selectedDriverChatId === d.id;
                const lastText = conv.lastMessage ? (conv.lastMessage.content || "[Media]") : "No messages yet";
                
                let lastTime = "";
                if (conv.lastMessage && conv.lastMessage.created_at) {
                    try {
                        const parsedDate = new Date(conv.lastMessage.created_at);
                        if (!isNaN(parsedDate.getTime())) {
                            lastTime = parsedDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                        }
                    } catch (timeErr) {
                        console.warn("Error parsing message timestamp:", timeErr);
                    }
                }
                
                return `
                    <div class="chat-driver-item ${isSelected ? 'active' : ''}" 
                         onclick="selectDriverChat('${d.id}')"
                         style="padding:16px 24px; cursor:pointer; border-bottom:1px solid var(--border); transition:0.2s; background:${isSelected ? 'rgba(79, 140, 255, 0.1)' : 'transparent'};">
                        <div style="display:flex; gap:12px; align-items:center;">
                            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${d.name}" style="width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.1);">
                            <div style="flex:1; overflow:hidden;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                                    <b style="font-size:0.9rem; color:${isSelected ? 'var(--primary)' : 'var(--text)'}">${d.name}</b>
                                    <span style="font-size:0.65rem; color:var(--muted);">${lastTime}</span>
                                </div>
                                <p style="margin:0; font-size:0.75rem; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${lastText}</p>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (selectedDriverChatId) {
            renderChatWindow(conversations[selectedDriverChatId]);
        }
    } catch(e) {
        console.error("Error loading messages:", e);
        const driverListContainer = document.getElementById('chat-driver-list');
        if (driverListContainer) {
            driverListContainer.innerHTML = `<div style="padding:20px; text-align:center; color:var(--danger); font-size:0.85rem;">⚠️ Failed to load drivers: ${e.message || e}</div>`;
        }
    }
}

function filterDriverChatList() {
    loadMessages(); // Just re-run with current search query
}

function selectDriverChat(driverId) {
    selectedDriverChatId = driverId;
    
    // UI Updates
    document.getElementById('chat-placeholder').style.display = 'none';
    document.getElementById('chat-header').style.display = 'flex';
    document.getElementById('chat-messages-container').style.display = 'block';
    document.getElementById('chat-input-area').style.display = 'block';
    
    const driver = globalDrivers.find(d => d.id === driverId);
    if (driver) {
        document.getElementById('chat-driver-avatar').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.name}`;
    }

    // Mobile: slide to chat panel
    const shell = document.querySelector('.chat-shell');
    if (shell) shell.classList.add('chat-open');
    
    loadMessages();
}

function closeMobileChat() {
    // Mobile back button — slide back to driver list
    const shell = document.querySelector('.chat-shell');
    if (shell) shell.classList.remove('chat-open');
    selectedDriverChatId = null;
    document.getElementById('chat-placeholder').style.display = 'flex';
    document.getElementById('chat-header').style.display = 'none';
    document.getElementById('chat-messages-container').style.display = 'none';
    document.getElementById('chat-input-area').style.display = 'none';
}

function renderChatWindow(conv) {
    const container = document.getElementById('chat-messages-container');
    const headerName = document.getElementById('chat-driver-name');
    headerName.innerText = conv.driver.name;

    if (conv.messages.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--muted);">No conversation history with this driver. Start the chat below.</div>';
    } else {
        container.innerHTML = conv.messages.map(m => {
            const isMe = m.sender_type === 'manager';
            let mediaHtml = '';
            if (m.media_type === 'image' && m.media_url) {
                mediaHtml = `<img src="${m.media_url}" style="max-width:100%;border-radius:10px;margin-top:8px;display:block;cursor:pointer;" onclick="window.zoomImage('${m.media_url}')" alt="photo">`;
            } else if (m.media_type === 'audio' && m.media_url) {
                mediaHtml = `<div class="audio-placeholder" data-src="${m.media_url}" data-accent="${isMe ? 'rgba(255,255,255,0.25)' : 'rgba(79,140,255,0.4)'}"></div>`;
            }
            return `
                <div style="display:flex; justify-content:${isMe ? 'flex-end' : 'flex-start'}; margin-bottom:16px;">
                    <div style="max-width:72%; padding:12px 16px; border-radius:16px;
                                background:${isMe ? 'var(--primary)' : 'rgba(255,255,255,0.05)'};
                                color:${isMe ? '#fff' : 'var(--text)'};
                                border-bottom-${isMe ? 'right' : 'left'}-radius:2px;
                                border: 1px solid ${isMe ? 'transparent' : 'var(--border)'};
                                box-shadow:0 2px 8px rgba(0,0,0,0.15);">
                        ${m.content && m.content !== '[Media]' ? `<div style="font-size:0.95rem; line-height:1.4;">${m.content}</div>` : ''}
                        ${mediaHtml}
                        <div style="font-size:0.65rem; margin-top:4px; text-align:right; opacity:0.7;">
                            ${new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
    container.scrollTop = container.scrollHeight;
    container.querySelectorAll('.audio-placeholder').forEach(ph => {
        ph.replaceWith(buildAudioPlayer(ph.dataset.src, ph.dataset.accent));
    });
}

let mainChatMediaData = null;
let mainChatMediaRecorder = null;
let mainChatRecording = false;

async function sendMessageToSelectedDriver() {
    const input = document.getElementById('manager-chat-input');
    const content = (input.value || '').trim();
    if (!content && !mainChatMediaData) return;
    if (!selectedDriverChatId) return;

    try {
        const mId = localStorage.getItem('manager_id');
        await apiCall('/tracking/messages', 'POST', {
            company_id: mId,
            sender_id: mId,
            receiver_id: selectedDriverChatId,
            content: content || (mainChatMediaData ? '[Media]' : ''),
            sender_type: 'manager',
            media_url: mainChatMediaData ? mainChatMediaData.url : null,
            media_type: mainChatMediaData ? mainChatMediaData.type : null
        });
        input.value = '';
        mainChatMediaData = null;
        const preview = document.getElementById('main-chat-media-preview');
        if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }

        const msgs = await apiCall(`/tracking/messages/${mId}?company_id=${mId}`);
        lastMsgCount = msgs.length;
        localStorage.setItem('last_seen_msg_count', lastMsgCount);

        loadMessages();
    } catch(e) {
        showNotification(getTranslation('msg_failed'), 'error');
    }
}

function mainChatPickPhoto() {
    document.getElementById('main-chat-photo-input').click();
}

function mainChatHandlePhoto(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        mainChatMediaData = { type: 'image', url: e.target.result };
        const preview = document.getElementById('main-chat-media-preview');
        preview.style.display = 'flex';
        preview.innerHTML = `<img src="${e.target.result}" style="height:56px;border-radius:8px;border:1px solid var(--border);"><span style="font-size:0.8rem;color:var(--muted);flex:1;">Photo attached</span><button onclick="mainChatClearMedia()" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1.1rem;">✕</button>`;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function mainChatClearMedia() {
    mainChatMediaData = null;
    const preview = document.getElementById('main-chat-media-preview');
    if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
}

async function mainChatToggleRecording() {
    const btn = document.getElementById('main-chat-voice-btn');
    if (!mainChatRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const chunks = [];
            mainChatMediaRecorder = new MediaRecorder(stream);
            mainChatMediaRecorder.ondataavailable = e => chunks.push(e.data);
            mainChatMediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = (ev) => {
                    mainChatMediaData = { type: 'audio', url: ev.target.result };
                    const preview = document.getElementById('main-chat-media-preview');
                    preview.style.display = 'flex';
                    preview.innerHTML = `<button onclick="mainChatClearMedia()" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1.1rem;flex-shrink:0;">✕</button>`;
                    const player = buildAudioPlayer(ev.target.result, 'rgba(79,140,255,0.4)');
                    preview.insertBefore(player, preview.firstChild);
                };
                reader.readAsDataURL(blob);
                stream.getTracks().forEach(t => t.stop());
            };
            mainChatMediaRecorder.start();
            mainChatRecording = true;
            btn.innerText = '⏹️';
            btn.style.background = 'rgba(229,62,62,0.2)';
            btn.style.color = 'var(--danger)';
        } catch(e) {
            alert('Microphone access denied.');
        }
    } else {
        mainChatMediaRecorder.stop();
        mainChatRecording = false;
        btn.innerText = '🎙️';
        btn.style.background = 'rgba(255,255,255,0.08)';
        btn.style.color = 'var(--text)';
    }
}


async function loadLeaderboard() {
    const category = document.getElementById('leader-type').value;
    const sortSelect = document.getElementById('leader-sort');
    
    // Update sort options based on category
    if (category === 'vehicle' && !sortSelect.dataset.isVehicle) {
        sortSelect.innerHTML = `
            <option value="overall">${getTranslation('gen_ranking')}</option>
            <option value="vehicle_health_score">${getTranslation('health_score')}</option>
            <option value="fuel_efficiency">${getTranslation('fuel_efficiency')}</option>
            <option value="distance">${getTranslation('dist_covered')}</option>
            <option value="deliveries">${getTranslation('deliveries_made')}</option>
        `;
        sortSelect.dataset.isVehicle = "true";
    } else if (category === 'driver' && sortSelect.dataset.isVehicle) {
        sortSelect.innerHTML = `
            <option value="overall">${getTranslation('gen_ranking')}</option>
            <option value="safety_index">${getTranslation('safety_index_label')}</option>
            <option value="punctuality_rate">${getTranslation('punctuality_label')}</option>
            <option value="rating">${getTranslation('rating_label')}</option>
            <option value="deliveries">${getTranslation('deliveries_completed_label')}</option>
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
                            ${category === 'driver' ? `<br><small style="color:var(--text-muted)">${getTranslation('stat_deliveries') || 'Deliveries'}: ${item.deliveries_completed || 0}</small>` : ''}
                        </div>
                    </div>
                </td>
                <td><span style="color:var(--accent); font-weight:bold;">${displayScore}</span></td>
                <td>${item.operational_days || 0}</td>
                <td><span class="status-pill" style="font-size:0.7rem;">${item.status}</span></td>
                <td><button class="btn-primary" style="padding:4px 8px; font-size:0.7rem;" onclick="viewFullProfile('${category}', '${item.id}')">${getTranslation('view_profile_btn')}</button></td>
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
        
        // Handle non-human vehicle profile pic
        let profilePic = p.profile_pic;
        if (type === 'vehicle') {
            const vType = (p.type || 'van').toLowerCase();
            let emoji = '🚐';
            let color = '#4f8cff';
            if (vType.includes('truck')) {
                emoji = '🚚';
                color = '#f59e0b';
            } else if (vType.includes('bike') || vType.includes('scooty') || vType.includes('scooter')) {
                emoji = '🏍️';
                color = '#10b981';
            } else if (vType.includes('drone')) {
                emoji = '🛸';
                color = '#8b5cf6';
            }
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
                <defs>
                    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="${color}" stop-opacity="0.2"/>
                        <stop offset="100%" stop-color="${color}" stop-opacity="0.05"/>
                    </linearGradient>
                </defs>
                <rect width="100" height="100" rx="50" fill="url(#g)" stroke="${color}" stroke-width="2"/>
                <text x="50%" y="62%" font-size="45" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
            </svg>`;
            profilePic = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        } else {
            profilePic = p.profile_pic || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.name}`;
        }
        
        document.getElementById('prof-image').src = profilePic;
        document.getElementById('prof-name').innerText = p.name || p.number_plate;
        document.getElementById('prof-sub').innerText = type === 'driver' ? `@${p.login_id || 'user'} | ${(p.license_type || 'regular').toUpperCase()} ${getTranslation('license_label')}` : `${(p.type || 'vehicle').toUpperCase()} | ${getTranslation('health_label')}: ${p.vehicle_health_score || 100}%`;
        
        if (type === 'driver') {
            // Restore Trips / Hours tab if hidden
            const tabContainer = document.getElementById('prof-tab-container');
            if (tabContainer) tabContainer.style.display = 'block';
            
            document.getElementById('prof-stat-1').innerText = `${(p.safety_index || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-2').innerText = `${(p.punctuality_rate || 100).toFixed(1)}%`;
            
            // Show manually entered years of experience
            document.getElementById('prof-stat-3').innerText = `${p.years_experience || 0} Years`;
            document.getElementById('prof-stat-4').innerText = `${p.total_trips || p.deliveries_completed || 0}`;
            
            let avgRating = 5.0;
            if (p.rating_count && p.rating_count > 0) {
                avgRating = p.total_rating_sum / p.rating_count;
            } else if (p.rating !== undefined) {
                avgRating = p.rating;
            }
            document.getElementById('prof-stat-5').innerText = `${avgRating.toFixed(1)}⭐`;
            document.getElementById('prof-stat-5').style.display = 'block';
            document.getElementById('prof-stat-6').innerText = `₹${p.wallet_balance || 0} / ${p.reward_points || 0} pts`;
            
            document.getElementById('prof-meter-label').innerText = `${getTranslation('fatigue_level_label')}: ${(p.fatigue_score || 0).toFixed(0)}%`;
            const meter = document.getElementById('prof-meter-bar');
            meter.style.width = `${p.fatigue_score || 0}%`;
            meter.style.background = (p.fatigue_score || 0) > 80 ? 'var(--danger)' : 'var(--primary)';

            // Driving Status Logic
            const statusEl = document.getElementById('prof-driving-status');
            const hasActiveShipment = shipments.some(s => s.status === 'in_transit');
            const isResting = p.fatigue_score > 80;
            const hasVehicle = p.vehicle_id !== null;

            if (p.is_on_duty === false) {
                statusEl.innerText = "NOT WORKING";
                statusEl.style.background = "rgba(239, 68, 68, 0.15)";
                statusEl.style.color = "var(--danger)";
            } else if (hasActiveShipment) {
                statusEl.innerText = getTranslation('status_on_road');
                statusEl.style.background = "rgba(16, 185, 129, 0.15)";
                statusEl.style.color = "var(--success)";
            } else if (isResting) {
                statusEl.innerText = getTranslation('status_resting');
                statusEl.style.background = "rgba(79, 140, 255, 0.15)";
                statusEl.style.color = "var(--primary)";
            } else if (hasVehicle) {
                statusEl.innerText = getTranslation('status_ready');
                statusEl.style.background = "rgba(245, 158, 11, 0.15)";
                statusEl.style.color = "var(--warning)";
            } else {
                statusEl.innerText = getTranslation('status_unavailable');
                statusEl.style.background = "rgba(255, 255, 255, 0.05)";
                statusEl.style.color = "var(--text-muted)";
            }
            
            // Dynamic Medical Health Card injection and update
            let hCard = document.getElementById('prof-health-card');
            if (!hCard) {
                hCard = document.createElement('div');
                hCard.id = 'prof-health-card';
                hCard.className = 'glass-card';
                hCard.style.cssText = 'padding:15px; background:linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(0, 0, 0, 0)); border: 1px solid rgba(239, 68, 68, 0.2); margin-top: 15px; margin-bottom: 20px; text-align: left;';
                hCard.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <h4 style="margin:0; color:var(--danger);">❤️ Driver Vitals (Smartwatch Live)</h4>
                        <span id="prof-health-status" class="badge" style="background:var(--success); font-size:0.7rem;">FIT TO DRIVE</span>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px;">
                        <div style="text-align:center;">
                            <div style="font-size:0.7rem; color:var(--text-muted);">HEART RATE</div>
                            <div id="prof-health-rate" style="font-size:1.1rem; font-weight:bold; color:var(--danger);">-- BPM</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:0.7rem; color:var(--text-muted);">BLOOD PRESSURE</div>
                            <div id="prof-health-bp" style="font-size:1.1rem; font-weight:bold; color:white;">--/--</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:0.7rem; color:var(--text-muted);">OXYGEN (SpO2)</div>
                            <div id="prof-health-o2" style="font-size:1.1rem; font-weight:bold; color:var(--accent);">--%</div>
                        </div>
                    </div>
                `;
                const targetHeader = document.querySelector('#profile-modal h4:last-of-type') || document.getElementById('prof-trips-body')?.closest('.table-container');
                if (targetHeader) {
                    targetHeader.parentNode.insertBefore(hCard, targetHeader);
                } else {
                    document.getElementById('profile-modal').appendChild(hCard);
                }
            }
            
            if (p.health_metrics) {
                hCard.style.display = 'block';
                document.getElementById('prof-health-rate').innerText = `${p.health_metrics.heart_rate || '--'} BPM`;
                document.getElementById('prof-health-bp').innerText = p.health_metrics.blood_pressure || '--/--';
                document.getElementById('prof-health-o2').innerText = `${p.health_metrics.oxygen || '--'}%`;
                
                const statusBadge = document.getElementById('prof-health-status');
                if (p.is_fit === false) {
                    statusBadge.innerText = "UNFIT (AUDIT)";
                    statusBadge.style.background = "var(--danger)";
                } else {
                    const hr = p.health_metrics.heart_rate;
                    const o2 = p.health_metrics.oxygen;
                    let abnormal = hr < 55 || hr > 110 || o2 < 92;
                    if (p.health_metrics.blood_pressure && p.health_metrics.blood_pressure.includes('/')) {
                        const parts = p.health_metrics.blood_pressure.split('/');
                        const syst = parseInt(parts[0]);
                        const diast = parseInt(parts[1]);
                        if (syst < 90 || syst > 140 || diast < 60 || diast > 95) {
                            abnormal = true;
                        }
                    }
                    if (abnormal) {
                        statusBadge.innerText = "ABNORMAL VITALS";
                        statusBadge.style.background = "var(--danger)";
                    } else {
                        statusBadge.innerText = "FIT TO DRIVE";
                        statusBadge.style.background = "var(--success)";
                    }
                }
            } else {
                hCard.style.display = 'none';
            }
            
            // Dynamic Driving Hours Tab injection
            let tabContainer = document.getElementById('prof-tab-container');
            if (!tabContainer) {
                const oldHeading = document.querySelector('#profile-modal h4:last-of-type');
                if (oldHeading) oldHeading.style.display = 'none';
                
                tabContainer = document.createElement('div');
                tabContainer.id = 'prof-tab-container';
                tabContainer.style.cssText = 'margin-top: 15px; margin-bottom: 15px; text-align: left;';
                tabContainer.innerHTML = `
                    <div style="display:flex; gap:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; margin-bottom:12px;">
                        <span id="prof-btn-trips" style="cursor:pointer; font-weight:bold; color:var(--primary); font-size:1rem; border-bottom:2px solid var(--primary); padding-bottom:6px;" onclick="window.switchProfTab('trips')">Recent Trip History</span>
                        <span id="prof-btn-hours" style="cursor:pointer; font-weight:bold; color:var(--text-muted); font-size:1rem; padding-bottom:6px;" onclick="window.switchProfTab('hours')">Driving Hours</span>
                    </div>
                    <div id="prof-tab-hours-table" class="table-container" style="display:none;">
                        <table style="font-size:0.85rem; width:100%; border-collapse:collapse;">
                            <thead>
                                <tr style="text-align:left; border-bottom:1px solid var(--border);">
                                    <th style="padding:8px;">Trip ID</th>
                                    <th style="padding:8px;">Route</th>
                                    <th style="padding:8px;">Distance</th>
                                    <th style="padding:8px;">Hours Worked</th>
                                </tr>
                            </thead>
                            <tbody id="prof-hours-body"></tbody>
                        </table>
                    </div>
                `;
                const tripsTableContainer = document.getElementById('prof-trips-body').closest('.table-container');
                tripsTableContainer.parentNode.insertBefore(tabContainer, tripsTableContainer);
                tripsTableContainer.id = 'prof-tab-trips-table';
                
                window.switchProfTab = function(tab) {
                    const tripsTable = document.getElementById('prof-tab-trips-table');
                    const hoursTable = document.getElementById('prof-tab-hours-table');
                    const btnTrips = document.getElementById('prof-btn-trips');
                    const btnHours = document.getElementById('prof-btn-hours');
                    if (tab === 'trips') {
                        tripsTable.style.display = 'block';
                        hoursTable.style.display = 'none';
                        btnTrips.style.color = 'var(--primary)';
                        btnTrips.style.borderBottom = '2px solid var(--primary)';
                        btnHours.style.color = 'var(--text-muted)';
                        btnHours.style.borderBottom = 'none';
                    } else {
                        tripsTable.style.display = 'none';
                        hoursTable.style.display = 'block';
                        btnTrips.style.color = 'var(--text-muted)';
                        btnTrips.style.borderBottom = 'none';
                        btnHours.style.color = 'var(--primary)';
                        btnHours.style.borderBottom = '2px solid var(--primary)';
                    }
                };
            }
            
            const tripsTable = document.getElementById('prof-tab-trips-table');
            if (tripsTable) tripsTable.style.display = 'block';
            
            const hoursBody = document.getElementById('prof-hours-body');
            if (hoursBody) {
                const getHaversine = (lat1, lon1, lat2, lon2) => {
                    const R = 6371;
                    const dLat = (lat2-lat1) * Math.PI / 180;
                    const dLon = (lon2-lon1) * Math.PI / 180;
                    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                              Math.sin(dLon/2) * Math.sin(dLon/2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                    return R * c;
                };
                hoursBody.innerHTML = shipments.map(s => {
                    const distVal = getHaversine(s.pickup.lat, s.pickup.lng, s.drop.lat, s.drop.lng);
                    const dist = distVal.toFixed(1) + ' km';
                    const hrs = (s.driving_hours || (distVal / 45.0)).toFixed(1) + ' hrs';
                    const route = `${s.pickup.address || 'Pickup'} → ${s.drop.address || 'Drop'}`;
                    return `
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                            <td style="padding:8px; font-family:monospace;">${s.id.substring(0,8)}</td>
                            <td style="padding:8px;">${route}</td>
                            <td style="padding:8px;">${dist}</td>
                            <td style="padding:8px; font-weight:bold; color:var(--primary);">${hrs}</td>
                        </tr>
                    `;
                }).join('');
            }
            if (window.switchProfTab) window.switchProfTab('trips');
            
        } else {
            // Hide health card and tab container for vehicles
            const hCard = document.getElementById('prof-health-card');
            if (hCard) hCard.style.display = 'none';
            const tabContainer = document.getElementById('prof-tab-container');
            if (tabContainer) tabContainer.style.display = 'none';
            const tripsTable = document.getElementById('prof-tab-trips-table');
            if (tripsTable) tripsTable.style.display = 'block';
            
            document.getElementById('prof-stat-1').innerText = `${(p.efficiency_score || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-2').innerText = `${p.vehicle_health_score || 100}%`;
            document.getElementById('prof-stat-3').innerText = `${(p.total_distance_km || p.kilometers_covered || 0).toFixed(0)} km`;
            document.getElementById('prof-stat-4').innerText = `${p.deliveries_completed || 0}`;
            document.getElementById('prof-stat-5').innerText = ''; 
            document.getElementById('prof-stat-6').innerText = '';
            
            document.getElementById('prof-meter-label').innerText = getTranslation('fuel_eff_index_label');
            document.getElementById('prof-meter-bar').style.width = '85%';
        }
        
        const tripsBody = document.getElementById('prof-trips-body');
        tripsBody.innerHTML = shipments.map(s => `
            <tr>
                <td>${s.id.substring(0,8)}</td>
                <td>${s.pickup.address.split(',')[0]} → ${s.drop.address.split(',')[0]}</td>
                <td>${new Date(s.created_at).toLocaleDateString()}</td>
                <td><span class="status-pill" style="font-size:0.7rem;">${s.status}</span></td>
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

            timeline.innerHTML = sortedLogs.map((log, idx) => {
                const meta = statusMeta[log.status] || { icon: '📍', color: '#94a3b8', label: 'System Update' };
                const d = new Date(log.timestamp);
                const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                const isLast = idx === sortedLogs.length - 1;

                return `
                <div style="display:flex; gap:16px; padding-bottom:${isLast ? '10px' : '24px'}; position:relative;">
                    <div style="display:flex; flex-direction:column; align-items:center; flex-shrink:0; width:36px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:${meta.color}15; border:1px solid ${meta.color}33; display:flex; align-items:center; justify-content:center; font-size:1rem; flex-shrink:0;">
                            ${meta.icon}
                        </div>
                        ${!isLast ? `<div style="width:2px; flex:1; background:rgba(255,255,255,0.05); margin-top:6px;"></div>` : ''}
                    </div>
                    <div style="flex:1; padding-top:2px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:0.7rem; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; color:${meta.color};">${meta.label}</span>
                            <span style="font-size:0.65rem; color:var(--text-muted);">${dateStr}, ${timeStr}</span>
                        </div>
                        <div style="background:rgba(255,255,255,0.02); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.03);">
                            <p style="margin:0; font-size:0.85rem; color:var(--text); opacity:0.9;">${log.message}</p>
                            ${log.reason ? `<div style="margin-top:5px; font-size:0.75rem; color:var(--text-muted); font-style:italic; border-top:1px solid rgba(255,255,255,0.03); padding-top:5px;">Note: ${log.reason}</div>` : ''}
                            ${log.photo_url ? `
                                <div style="margin-top:10px; border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,0.1);">
                                    <img src="${log.photo_url}" style="width:100%; display:block; cursor:zoom-in;" onclick="window.zoomImage('${log.photo_url}')">
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('');
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
    const pbody = document.getElementById('driver-points-body');
    if (!tbody || !pbody) return;
    
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">${getTranslation('loading_ledger')}</td></tr>`;
    
    try {
        // Fetch Ledger
        const txs = await apiCall('/manager/ledger?company_id=' + localStorage.getItem('manager_id'));
        
        // Fetch Drivers for Summary
        if (!globalDrivers.length) {
            globalDrivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`);
        }

        renderDriverPointsSummary();

        if (txs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">${getTranslation('no_contracts')}</td></tr>`;
            return;
        }
        
        txs.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        tbody.innerHTML = txs.map(tx => {
            const isBoost = tx.shipment_id === 'GLOBAL_BOOST';
            const driver = globalDrivers.find(d => d.id === tx.to_address);
            const driverLabel = driver ? driver.name : (tx.to_address || 'N/A').substring(0, 8) + '...';
            const shipLabel = isBoost
                ? `<span style="color:var(--warning); font-size:0.75rem;">⚡ GLOBAL BOOST</span>`
                : (tx.shipment_id || '').substring(0, 8);
            return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05); ${isBoost ? 'background:rgba(246,173,85,0.04);' : ''}">
                <td style="padding:10px; color:#00f2fe; font-family:monospace; font-size:0.8rem;">${(tx.tx_hash || '—').substring(0,18)}...</td>
                <td style="padding:10px; font-size:0.8rem;">${new Date(tx.timestamp).toLocaleString()}</td>
                <td style="padding:10px;">${shipLabel}</td>
                <td style="padding:10px;">${driverLabel}</td>
                <td style="padding:10px; color:var(--success); font-weight:bold;">🏆 ${tx.points_awarded}</td>
            </tr>`;
        }).join('');
    } catch(err) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--danger);">Error loading ledger.</td></tr>';
    }
}

window.renderDriverPointsSummary = async function() {
    const pbody = document.getElementById('driver-points-body');
    if (!pbody) return;

    const companyId = localStorage.getItem('manager_id');

    // Always ensure all three data sets are loaded before sorting
    if (!globalDrivers.length) {
        globalDrivers = await apiCall(`/manager/drivers?company_id=${companyId}`);
    }
    if (!globalVehicles.length) {
        globalVehicles = await apiCall(`/manager/vehicles?company_id=${companyId}`);
    }
    if (!globalWarehouses.length) {
        globalWarehouses = await apiCall(`/manager/warehouses?company_id=${companyId}`);
    }

    const sortMode = document.getElementById('ledger-driver-sort')?.value || 'points';

    let sorted = [...globalDrivers];
    sorted.sort((a, b) => {
        if (sortMode === 'points') return (b.reward_points || 0) - (a.reward_points || 0);
        if (sortMode === 'warehouse') {
            const wA = globalWarehouses.find(w => w.id === a.base_warehouse_id)?.name || '';
            const wB = globalWarehouses.find(w => w.id === b.base_warehouse_id)?.name || '';
            return wA.localeCompare(wB);
        }
        if (sortMode === 'vehicle') {
            const vA = globalVehicles.find(v => v.id === a.assigned_vehicle_id)?.type || 'Unlinked';
            const vB = globalVehicles.find(v => v.id === b.assigned_vehicle_id)?.type || 'Unlinked';
            return vA.localeCompare(vB);
        }
        return 0;
    });

    if (!sorted.length) {
        pbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">No drivers found.</td></tr>';
        return;
    }

    pbody.innerHTML = sorted.map(d => {
        const vehicle = globalVehicles.find(v => v.id === d.assigned_vehicle_id);
        const hub = globalWarehouses.find(w => w.id === d.base_warehouse_id);
        return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:10px;"><b>${d.name}</b><br><small style="color:var(--text-muted)">${d.system_id}</small></td>
                <td style="padding:10px;">${vehicle ? `<b>${vehicle.type}</b><br><small>${vehicle.number_plate}</small>` : `<small style="color:var(--text-muted)">${getTranslation('unlinked')}</small>`}</td>
                <td style="padding:10px;"><small>${hub ? hub.name : 'N/A'}</small></td>
                <td style="padding:10px; color:var(--accent); font-weight:bold; font-size:1.1rem;">${Math.floor(d.reward_points || 0)}</td>
            </tr>
        `;
    }).join('');
};

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

    const password = prompt("Enter MANAGER PASSWORD to authorize this destructive action:");
    if (!password) return;
    
    try {
        const res = await apiCall(`/manager/system/reset-${type}`, 'POST', { manager_password: password });
        alert(res.message);
        // Reload the UI
        loadShipments();
        loadMapData();
        loadInsights();
        initFintechOracle();
        if (type === 'drivers' || type === 'vehicles' || type === 'operations') {
            loadDriversAndVehicles();
            loadLeaderboard();
        }
    } catch(err) {
        alert(`Failed to reset ${type}.`);
    }
}

async function requestDeleteAccount() {
    const password = prompt("To authorize account deletion, please enter your Manager Password:");
    if (!password) return;

    const btn = document.getElementById('request-del-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerText = getTranslation('otp_sending') || "Sending OTP...";
    }
    showToast(getTranslation('otp_sending') || "Sending OTP...", 'info');

    try {
        const companyId = localStorage.getItem('manager_id');
        const res = await apiCall(`/manager/system/delete-account-request`, 'POST', { 
            company_id: companyId,
            manager_password: password
        });
        
        showToast(getTranslation('otp_sent_success'), 'success');
        document.getElementById('delete-account-step1').style.display = 'none';
        document.getElementById('delete-account-step2').style.display = 'block';
        
        // Initialize PIN auto-focus listeners if not already done
        initDeletePinListeners();
        
        if (typeof updatePageTranslations === 'function') updatePageTranslations();
        startOTPTimer('resend-link-del', 'timer-val-del', requestDeleteAccount);
    } catch(err) {
        if (btn) {
            btn.disabled = false;
            btn.innerText = getTranslation('btn_delete_account') || 'Delete Company Account';
        }
        // apiCall already shows an alert for the error (e.g. "Incorrect password")
    }
}

function initDeletePinListeners() {
    const pins = document.querySelectorAll('.delete-pin');
    pins.forEach((pin, idx) => {
        // Auto-focus next box
        pin.oninput = (e) => {
            if (pin.value && idx < pins.length - 1) {
                pins[idx + 1].focus();
            }
        };
        // Backspace support
        pin.onkeydown = (e) => {
            if (e.key === 'Backspace' && !pin.value && idx > 0) {
                pins[idx - 1].focus();
            }
            if (e.key === 'Enter') {
                confirmDeleteAccount();
            }
        };
    });
}

function startOTPTimer(linkId, valId, retryFn) {
    let timeLeft = 10;
    const link = document.getElementById(linkId);
    const val = document.getElementById(valId);
    
    if (!link || !val) return;

    link.style.opacity = '0.5';
    link.style.pointerEvents = 'none';
    link.innerHTML = `${getTranslation('resend_otp')} (<span id="${valId}">${timeLeft}</span>s)`;
    
    const timer = setInterval(() => {
        timeLeft--;
        const v = document.getElementById(valId);
        if (v) v.innerText = timeLeft;
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            link.style.opacity = '1';
            link.style.pointerEvents = 'auto';
            link.innerHTML = getTranslation('resend_otp_now') || `Resend OTP Now`;
            link.onclick = (e) => {
                e.preventDefault();
                retryFn();
            };
        }
    }, 1000);
}

async function confirmDeleteAccount() {
    const otp = Array.from(document.querySelectorAll('.delete-pin')).map(i => i.value).join('');
    if (!otp || otp.length < 6) {
        showToast("Please enter a valid 6-digit OTP.", "error");
        return;
    }
    
    const btn = document.getElementById('confirm-del-btn');
    if (btn) btn.disabled = true;

    try {
        const companyId = localStorage.getItem('manager_id');
        const res = await apiCall(`/manager/system/delete-account-confirm?company_id=${companyId}&otp=${otp}`, 'POST');
        showToast(res.message, 'success');
        setTimeout(() => logout(), 2000);
    } catch(err) {
        if (btn) btn.disabled = false;
        showToast("Incorrect OTP or account already deleted.", "error");
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
    } else if (type === 'drones') {
        endpoint = `/manager/drones/${id}?company_id=${localStorage.getItem('manager_id')}`;
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
    const budget = parseInt(document.getElementById('param-budget').value) * 100000;
    
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
            driver_incentive: incentive,
            budget: budget
        });
        
        lastOracleRes = res;
        lastOracleRes.params = { months, wh, whLoc, fleet, green, auto, incentive, budget };
        
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
        const stats = await apiCall('/manager/system/baseline-stats?company_id=' + localStorage.getItem('manager_id'));
        const strategyData = { 
            ...lastOracleRes, 
            company_id: localStorage.getItem('manager_id'),
            baselines: stats,
            timestamp: new Date().toISOString()
        };
        await apiCall('/simulation/strategy/save', 'POST', strategyData);
        showNotification("Strategy Plan Activated! Tracking initialized.", "success");
        loadActiveStrategy();
        showSection('strategy-plan');
    } catch(e) {
        showNotification("Failed to save strategy.", "error");
    }
}

async function loadActiveStrategy() {
    const mId = localStorage.getItem('manager_id');
    const msg = document.getElementById('no-strategy-msg');
    const content = document.getElementById('active-strategy-content');
    if (!msg || !content) return;

    try {
        const plan = await apiCall(`/simulation/strategy/active?company_id=${mId}`);
        if (!plan) {
            msg.style.display = 'block';
            content.style.display = 'none';
            return;
        }

        msg.style.display = 'none';
        content.style.display = 'block';

        // 1. Render Forecast Summary
        document.getElementById('sf-predicted').innerText = `₹${(plan.summary.net_profit / 100000).toFixed(1)}L`;
        document.getElementById('sf-confidence').innerText = `${plan.summary.efficiency_score.toFixed(0)}% Efficiency Target`;
        document.getElementById('sf-risk').innerText = `Horizon: ${plan.params.months} Months | Risk: ${plan.risk_level}`;

        // 2. Fetch Current Stats to calculate Achievement
        const current = await apiCall(`/manager/system/baseline-stats?company_id=${mId}`);
        const base = plan.baselines;

        const targets = [
            { 
                label: "Warehouse Expansion", 
                current: current.warehouse_count - base.warehouse_count, 
                target: plan.params.wh,
                unit: "Hubs" 
            },
            { 
                label: "Fleet Increase", 
                current: current.vehicle_count - base.vehicle_count, 
                target: Math.round(base.vehicle_count * (plan.params.fleet / 100)),
                unit: "Vehicles" 
            },
            { 
                label: "EV Conversion", 
                current: current.ev_count, 
                target: Math.round(current.vehicle_count * (plan.params.green / 100)),
                unit: "EVs" 
            }
        ];

        // 3. Render Progress Bars
        const container = document.getElementById('progress-bars-container');
        container.innerHTML = targets.map(t => {
            const progress = t.target > 0 ? Math.min(100, Math.max(0, (t.current / t.target) * 100)) : (t.current >= 0 ? 100 : 0);
            return `
                <div style="margin-bottom:20px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <span style="font-weight:700;">${t.label}</span>
                        <span style="color:var(--text-muted); font-size:0.85rem;">${t.current} / ${t.target} ${t.unit}</span>
                    </div>
                    <div style="height:12px; background:rgba(255,255,255,0.05); border-radius:6px; overflow:hidden; border:1px solid rgba(255,255,255,0.1);">
                        <div style="width:${progress}%; height:100%; background:linear-gradient(90deg, var(--primary), var(--accent)); transition: width 1s ease-in-out;"></div>
                    </div>
                    <div style="text-align:right; font-size:0.7rem; color:var(--accent); font-weight:bold; margin-top:4px;">${progress.toFixed(1)}% ACHIEVED</div>
                </div>
            `;
        }).join('');

        // 4. Recommendation & Risk
        document.getElementById('benchmark-data').innerHTML = `
            <div style="padding:15px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                <div style="color:var(--accent); font-weight:bold; font-size:0.8rem; margin-bottom:5px;">AI GUIDANCE</div>
                <p style="margin:0; font-size:0.9rem; line-height:1.4;">${plan.ai_recommendation}</p>
                <div style="margin-top:15px; font-size:0.75rem; color:var(--text-muted);">
                    Activated: ${new Date(plan.timestamp).toLocaleDateString()}
                </div>
            </div>
        `;

    } catch (e) {
        console.error("Strategy load error:", e);
    }
}

async function clearActiveStrategy() {
    if (!confirm("Are you sure you want to terminate this strategy? Active tracking will be lost.")) return;
    try {
        await apiCall(`/simulation/strategy/active?company_id=${localStorage.getItem('manager_id')}`, 'DELETE');
        showNotification("Strategy cleared.", "success");
        loadActiveStrategy();
    } catch (e) {
        showNotification("Failed to clear strategy.", "error");
    }
}

async function boostDriverPoints() {
    const percent = parseFloat(document.getElementById('boost-percent').value);
    if (!percent || percent <= 0) {
        alert('Please enter a valid percentage greater than 0.');
        return;
    }
    if (!confirm(`Apply a ${percent}% points boost to ALL drivers in your fleet?`)) return;
    try {
        const res = await apiCall('/manager/ledger/boost', 'POST', {
            company_id: localStorage.getItem('manager_id'),
            percentage: percent
        });
        alert(res.message);
        // Force-refresh global drivers cache so wallet summary reflects new totals
        globalDrivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`);
        renderDriverPointsSummary();
        loadLedger();
    } catch(err) {
        alert('Failed to apply boost: ' + (err.message || err));
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


// Handle Info Icon Clicks for mobile/desktop preference
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('info-icon')) {
        const tip = e.target.getAttribute('data-tip');
        if (tip) alert(tip);
    }
});

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

// --- MAP PICKER LOGIC ---
let pickingMap = null;
let pickingMarker = null;
let currentPickerTarget = null;
let pickedCoords = null;

let smartPickerCallback = null;

function openMapPicker(targetId, callback) {
    currentPickerTarget = targetId;
    smartPickerCallback = callback;
    const modal = document.getElementById('map-picker-modal');
    modal.style.display = 'flex'; 
    
    document.getElementById('map-picker-title').innerText = targetId === 'pickup-loc' ? 'Select Pickup Location' : (targetId ? 'Select Drop Location' : 'Select Smart Coordinate');
    document.getElementById('current-pick-display').innerText = 'Click on map to pick a location...';
    pickedCoords = null;

    if (!pickingMap) {
        setTimeout(() => {
            pickingMap = L.map('picking-map').setView([20.5937, 78.9629], 5);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(pickingMap);
            applyOfficialBorders(pickingMap);

            pickingMap.on('click', function(e) {
                const { lat, lng } = e.latlng;
                pickedCoords = { lat, lng };
                if (pickingMarker) pickingMarker.setLatLng(e.latlng);
                else pickingMarker = L.marker(e.latlng).addTo(pickingMap);
                document.getElementById('current-pick-display').innerText = `Selected: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            });
            setTimeout(() => pickingMap.invalidateSize(), 50);
        }, 50);
    } else {
        setTimeout(() => {
            pickingMap.invalidateSize();
            if (pickingMarker) {
                pickingMap.removeLayer(pickingMarker);
                pickingMarker = null;
            }
        }, 50);
    }

    if (targetId) {
        const currentVal = document.getElementById(targetId).value;
        if (currentVal && currentVal.includes(',')) {
            const [lat, lng] = currentVal.split(',').map(s => parseFloat(s.trim()));
            if (!isNaN(lat) && !isNaN(lng)) {
                const ll = L.latLng(lat, lng);
                pickingMap.setView(ll, 12);
                pickingMarker = L.marker(ll).addTo(pickingMap);
                pickedCoords = { lat, lng };
                document.getElementById('current-pick-display').innerText = `Current: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            }
        }
    }
}

function confirmMapPick() {
    if (!pickedCoords) {
        showNotification('Please click on the map first', 'warning');
        return;
    }
    const coordsStr = `${pickedCoords.lat.toFixed(4)}, ${pickedCoords.lng.toFixed(4)}`;
    if (currentPickerTarget) {
        document.getElementById(currentPickerTarget).value = coordsStr;
    }
    if (smartPickerCallback) {
        smartPickerCallback(coordsStr);
    }
    closeMapPicker();
}

function closeMapPicker() {
    document.getElementById('map-picker-modal').style.display = 'none';
    currentPickerTarget = null;
    smartPickerCallback = null;
    pickedCoords = null;
}

async function autoAssignFleet() {
    if (!confirm("Are you sure you want to automatically link all unassigned drivers and vehicles? This will match them based on base hub and vehicle type.")) return;
    
    try {
        const res = await apiCall(`/manager/auto-assign-fleet?company_id=${localStorage.getItem('manager_id')}`, 'POST');
        alert(res.message);
        loadDriversAndVehicles();
    } catch (e) {
        console.error("Auto-assign failed:", e);
    }
}

let currentBulkData = [];

function openBulkUploadModal() {
    document.getElementById('bulk-upload-modal').style.display = 'block';
    document.getElementById('bulk-preview-section').style.display = 'none';
    document.getElementById('sheets-url').value = '';
    document.getElementById('file-name-display').innerText = '';
}

function closeBulkUploadModal() {
    document.getElementById('bulk-upload-modal').style.display = 'none';
}

async function handleBulkFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    document.getElementById('file-name-display').innerText = `Selected: ${file.name}`;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const res = await fetch(`${API_BASE}/shipments/bulk-parse?company_id=${localStorage.getItem('manager_id')}`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (res.ok) renderBulkPreview(data);
        else alert(data.detail || "Failed to parse file");
    } catch (e) {
        alert("Upload failed.");
    }
}

async function previewGoogleSheets() {
    const url = document.getElementById('sheets-url').value.trim();
    if (!url) return alert("Please enter a Google Sheets URL");
    
    try {
        const res = await apiCall(`/shipments/bulk-parse?company_id=${localStorage.getItem('manager_id')}&url_req=${encodeURIComponent(url)}`, 'POST');
        renderBulkPreview(res);
    } catch (e) {
        alert("Failed to fetch Google Sheet data.");
    }
}

function renderBulkPreview(data) {
    const shipments = data.shipments;
    currentBulkData = shipments;
    document.getElementById('bulk-count').innerText = shipments.length;
    document.getElementById('bulk-preview-section').style.display = 'block';
    
    // Display errors if any
    const errorDiv = document.getElementById('bulk-errors');
    if (errorDiv) {
        if (data.errors && data.errors.length > 0) {
            errorDiv.innerHTML = `<div class="glass-card" style="border-color:var(--danger); background:rgba(239,68,68,0.05); padding:10px; margin-bottom:15px;">
                <h4 style="color:var(--danger); margin-top:0;">⚠️ Parsing Errors (${data.errors.length} rows skipped)</h4>
                <ul style="font-size:0.8rem; color:var(--text-muted); margin:0; padding-left:20px;">
                    ${data.errors.slice(0, 5).map(e => `<li>${e}</li>`).join('')}
                    ${data.errors.length > 5 ? `<li>...and ${data.errors.length - 5} more</li>` : ''}
                </ul>
            </div>`;
            errorDiv.style.display = 'block';
        } else {
            errorDiv.style.display = 'none';
        }
    }

    const tbody = document.getElementById('bulk-preview-body');
    tbody.innerHTML = shipments.map(s => `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding:10px; font-size:0.8rem;">${s.pickup.lat.toFixed(3)}, ${s.pickup.lng.toFixed(3)}</td>
            <td style="padding:10px; font-size:0.8rem;">${s.drop.lat.toFixed(3)}, ${s.drop.lng.toFixed(3)}</td>
            <td style="padding:10px;">${s.weight}kg</td>
            <td style="padding:10px;">${s.description}</td>
            <td style="padding:10px; font-size:0.8rem;">${s.receiver_name}<br><small>${s.receiver_phone}</small></td>
            <td style="padding:10px; text-align:center;">${s.is_perishable ? '✅' : '❌'}</td>
            <td style="padding:10px; font-size:0.8rem;">
                <b>${s.eway_bill_no || 'N/A'}</b><br>
                <small>${s.eway_bill_expiry || ''}</small>
            </td>
        </tr>
    `).join('');
}

async function confirmBulkUpload() {
    const btn = document.getElementById('confirm-bulk-btn');
    btn.disabled = true;
    btn.innerText = 'Creating Shipments...';
    
    try {
        const res = await apiCall('/shipments/bulk-confirm', 'POST', currentBulkData);
        
        let msg = `Successfully created ${res.success.length} shipments.`;
        if (res.errors.length > 0) {
            msg += `\n\nFailed: ${res.errors.length}\nErrors:\n${res.errors.map(e => `- ${e.description}: ${e.error}`).join('\n')}`;
        }
        
        alert(msg);
        closeBulkUploadModal();
        loadShipments();
    } catch (e) {
        alert("Bulk creation failed.");
    } finally {
        btn.disabled = false;
        btn.innerText = 'Confirm & Create Shipments';
    }
}

// Bulk Driver Upload
let currentBulkDrivers = [];
function openDriverBulkModal() {
    document.getElementById('bulk-driver-modal').style.display = 'block';
    document.getElementById('driver-preview-section').style.display = 'none';
}
function closeDriverBulkModal() { document.getElementById('bulk-driver-modal').style.display = 'none'; }

async function handleDriverBulkFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
        const res = await fetch(`${API_BASE}/manager/drivers/bulk-parse?company_id=${localStorage.getItem('manager_id')}`, { method:'POST', body:fd });
        const data = await res.json(); renderDriverBulkPreview(data);
    } catch(err) { alert("Failed to parse drivers."); }
}
async function previewDriverSheets() {
    const url = document.getElementById('driver-sheets-url').value;
    try {
        const res = await apiCall(`/manager/drivers/bulk-parse?company_id=${localStorage.getItem('manager_id')}&url_req=${encodeURIComponent(url)}`, 'POST');
        renderDriverBulkPreview(res);
    } catch(err) { alert("Failed to fetch driver data."); }
}
function renderDriverBulkPreview(data) {
    const drivers = data.drivers;
    currentBulkDrivers = drivers;
    document.getElementById('driver-bulk-count').innerText = drivers.length;
    document.getElementById('driver-preview-section').style.display = 'block';
    
    // Error handling
    const errorDiv = document.getElementById('driver-bulk-errors');
    if (errorDiv) {
        if (data.errors && data.errors.length > 0) {
            errorDiv.innerHTML = `<div class="glass-card" style="border-color:var(--danger); background:rgba(239,68,68,0.05); padding:10px; margin-bottom:15px;">
                <h4 style="color:var(--danger); margin-top:0;">⚠️ Parsing Errors (${data.errors.length} rows skipped)</h4>
                <ul style="font-size:0.8rem; color:var(--text-muted); margin:0; padding-left:20px;">
                    ${data.errors.slice(0, 5).map(e => `<li>${e}</li>`).join('')}
                </ul>
            </div>`;
            errorDiv.style.display = 'block';
        } else {
            errorDiv.style.display = 'none';
        }
    }

    document.getElementById('driver-preview-body').innerHTML = drivers.map(d => {
        const wh = globalWarehouses.find(w => w.id === d.base_warehouse_id);
        const hubName = wh ? wh.name : d.base_warehouse_id;
        return `<tr><td>${d.name}</td><td>${d.license_type}</td><td>${hubName}</td><td>${d.contact_number}</td></tr>`;
    }).join('');
}
async function confirmDriverBulk() {
    try {
        const res = await apiCall('/manager/drivers/bulk-confirm', 'POST', currentBulkDrivers);
        let msg = res.message;
        if (res.errors && res.errors.length > 0) {
            msg += "\n\nIssues:\n" + res.errors.join('\n');
        }
        alert(msg); 
        closeDriverBulkModal(); 
        loadDriversAndVehicles();
    } catch(err) { alert("Bulk upload failed."); }
}

// Bulk Vehicle Upload
let currentBulkVehicles = [];
function openVehicleBulkModal() {
    document.getElementById('bulk-vehicle-modal').style.display = 'block';
    document.getElementById('vehicle-preview-section').style.display = 'none';
}
function closeVehicleBulkModal() { document.getElementById('bulk-vehicle-modal').style.display = 'none'; }

async function handleVehicleBulkFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
        const res = await fetch(`${API_BASE}/manager/vehicles/bulk-parse?company_id=${localStorage.getItem('manager_id')}`, { method:'POST', body:fd });
        const data = await res.json(); renderVehicleBulkPreview(data);
    } catch(err) { alert("Failed to parse vehicles."); }
}
async function previewVehicleSheets() {
    const url = document.getElementById('vehicle-sheets-url').value;
    try {
        const res = await apiCall(`/manager/vehicles/bulk-parse?company_id=${localStorage.getItem('manager_id')}&url_req=${encodeURIComponent(url)}`, 'POST');
        renderVehicleBulkPreview(res);
    } catch(err) { alert("Failed to fetch vehicle data."); }
}
function renderVehicleBulkPreview(data) {
    const vehicles = data.vehicles;
    currentBulkVehicles = vehicles;
    document.getElementById('vehicle-bulk-count').innerText = vehicles.length;
    document.getElementById('vehicle-preview-section').style.display = 'block';
    
    // Error handling
    const errorDiv = document.getElementById('vehicle-bulk-errors');
    if (errorDiv) {
        if (data.errors && data.errors.length > 0) {
            errorDiv.innerHTML = `<div class="glass-card" style="border-color:var(--danger); background:rgba(239,68,68,0.05); padding:10px; margin-bottom:15px;">
                <h4 style="color:var(--danger); margin-top:0;">⚠️ Parsing Errors (${data.errors.length} rows skipped)</h4>
                <ul style="font-size:0.8rem; color:var(--text-muted); margin:0; padding-left:20px;">
                    ${data.errors.slice(0, 5).map(e => `<li>${e}</li>`).join('')}
                </ul>
            </div>`;
            errorDiv.style.display = 'block';
        } else {
            errorDiv.style.display = 'none';
        }
    }

    document.getElementById('vehicle-preview-body').innerHTML = vehicles.map(v => {
        const wh = globalWarehouses.find(w => w.id === v.base_warehouse_id);
        const hubName = wh ? wh.name : v.base_warehouse_id;
        return `<tr><td>${v.type}</td><td>${hubName}</td><td>${v.number_plate}</td><td>${v.capacity}kg</td></tr>`;
    }).join('');
}
async function confirmVehicleBulk() {
    try {
        const res = await apiCall('/manager/vehicles/bulk-confirm', 'POST', currentBulkVehicles);
        let msg = res.message;
        if (res.errors && res.errors.length > 0) {
            msg += "\n\nIssues:\n" + res.errors.join('\n');
        }
        alert(msg); 
        closeVehicleBulkModal(); 
        loadDriversAndVehicles();
    } catch(err) { alert("Bulk upload failed."); }
}

// Bulk Drone Upload
let currentBulkDrones = [];
function openDroneBulkModal() {
    document.getElementById('bulk-drone-modal').style.display = 'block';
    document.getElementById('drone-preview-section').style.display = 'none';
}
function closeDroneBulkModal() { document.getElementById('bulk-drone-modal').style.display = 'none'; }

async function handleDroneBulkFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
        const res = await fetch(`${API_BASE}/manager/drones/bulk-parse?company_id=${localStorage.getItem('manager_id')}`, { method:'POST', body:fd });
        const data = await res.json(); renderDroneBulkPreview(data);
    } catch(err) { alert("Failed to parse drones."); }
}
async function previewDroneSheets() {
    const url = document.getElementById('drone-sheets-url').value;
    try {
        const res = await apiCall(`/manager/drones/bulk-parse?company_id=${localStorage.getItem('manager_id')}&url_req=${encodeURIComponent(url)}`, 'POST');
        renderDroneBulkPreview(res);
    } catch(err) { alert("Failed to fetch drone data."); }
}
function renderDroneBulkPreview(data) {
    const drones = data.drones;
    currentBulkDrones = drones;
    document.getElementById('drone-bulk-count').innerText = drones.length;
    document.getElementById('drone-preview-section').style.display = 'block';
    
    // Error handling
    const errorDiv = document.getElementById('drone-bulk-errors');
    if (errorDiv) {
        if (data.errors && data.errors.length > 0) {
            errorDiv.innerHTML = `<div class="glass-card" style="border-color:var(--danger); background:rgba(239,68,68,0.05); padding:10px; margin-bottom:15px;">
                <h4 style="color:var(--danger); margin-top:0;">⚠️ Parsing Errors (${data.errors.length} rows skipped)</h4>
                <ul style="font-size:0.8rem; color:var(--text-muted); margin:0; padding-left:20px;">
                    ${data.errors.slice(0, 5).map(e => `<li>${e}</li>`).join('')}
                </ul>
            </div>`;
            errorDiv.style.display = 'block';
        } else {
            errorDiv.style.display = 'none';
        }
    }

    document.getElementById('drone-preview-body').innerHTML = drones.map(d => {
        const wh = globalWarehouses.find(w => w.id === d.base_warehouse_id);
        const hubName = wh ? wh.name : d.base_warehouse_id;
        return `<tr><td>${d.license_number}</td><td>${hubName}</td><td>${d.capacity}kg</td><td>${d.radius}km</td></tr>`;
    }).join('');
}
async function confirmDroneBulk() {
    try {
        const res = await apiCall('/manager/drones/bulk-confirm', 'POST', currentBulkDrones);
        let msg = res.message;
        if (res.errors && res.errors.length > 0) {
            msg += "\n\nIssues:\n" + res.errors.join('\n');
        }
        alert(msg); 
        closeDroneBulkModal(); 
        loadDriversAndVehicles();
    } catch(err) { alert("Bulk upload failed."); }
}

async function extendEwayBill(shipmentId) {
    if (!confirm("Are you sure you want to request an E-Way Bill extension for 24 hours?")) return;
    
    try {
        await apiCall(`/shipments/${shipmentId}/extend-eway`, 'POST');
        alert("E-Way Bill extension requested successfully!");
        loadShipments();
    } catch (e) {
        alert("Failed to extend E-Way Bill.");
    }
}

function openBroadcastModal() {
    const modal = document.getElementById('broadcast-modal');
    const input = document.getElementById('broadcast-input');
    if (modal) modal.style.display = 'block';
    if (input) {
        input.value = '';
        input.focus();
    }
}

function closeBroadcastModal() {
    const modal = document.getElementById('broadcast-modal');
    if (modal) modal.style.display = 'none';
}

async function sendBroadcast() {
    const input = document.getElementById('broadcast-input');
    const btn = document.getElementById('broadcast-confirm-btn');
    const text = input ? input.value.trim() : "";
    
    if (!text) return alert("Please type a message to broadcast.");
    
    const managerId = localStorage.getItem('manager_id');
    const originalText = btn.innerText;
    
    try {
        btn.disabled = true;
        btn.innerText = "Sending... ⏳";
        
        await apiCall('/tracking/broadcast', 'POST', {
            company_id: managerId,
            sender_id: managerId,
            content: text
        });
        
        alert("Broadcast sent successfully to all drivers!");
        closeBroadcastModal();
    } catch (e) {
        console.error("Broadcast failed:", e);
        alert("Failed to send broadcast. " + (e.message || "Please check your connection."));
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

async function loadFuelPrices() {
    try {
        const prices = await apiCall('/fuel/prices');
        const list = document.getElementById('fuel-price-list');
        list.innerHTML = '';
        
        Object.keys(prices).forEach(state => {
            const data = prices[state];
            const div = document.createElement('div');
            div.className = 'glass-card';
            div.style.padding = '15px';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.background = 'rgba(255,255,255,0.03)';
            
            // Color based on price
            const isHigh = data.diesel > 90;
            const priceColor = isHigh ? 'var(--danger)' : 'var(--success)';
            
            div.innerHTML = `
                <div>
                    <h4 style="margin:0;">${state}</h4>
                    <small style="color:var(--text-muted)">Petrol: ₹${data.petrol}</small>
                </div>
                <div style="text-align:right;">
                    <div style="color:${priceColor}; font-weight:bold;">₹${data.diesel}</div>
                    <small style="color:var(--text-muted)">Diesel</small>
                </div>
            `;
            list.appendChild(div);
        });
    } catch (e) {
        console.error("Failed to load fuel prices", e);
    }
}

async function runFuelOptimization() {
    const statesInput = document.getElementById('route-states-input').value;
    if (!statesInput) return alert("Please enter states in your route.");
    
    const states = statesInput.split(',').map(s => s.trim());
    
    try {
        const result = await apiCall('/fuel/optimize', 'POST', { states });
        const resDiv = document.getElementById('fuel-optimization-result');
        resDiv.style.display = 'block';
        
        document.getElementById('opt-best-state').innerText = `Optimal Stop: ${result.best_state}`;
        document.getElementById('opt-suggestion').innerText = result.suggestion;
        document.getElementById('opt-savings').innerText = result.potential_savings_per_liter;
        
        // Also update total savings mock
        document.getElementById('fuel-savings-total').innerText = `₹${(result.potential_savings_per_liter * 500).toLocaleString()}`;
    } catch (e) {
        alert("Optimization failed.");
    }
}

let fuelTrendChart = null;
function initFuelTrendChart() {
    const ctx = document.getElementById('fuelTrendChart').getContext('2d');
    if (fuelTrendChart) fuelTrendChart.destroy();
    
    const days = Array.from({length: 30}, (_, i) => `Day ${i+1}`);
    const data = Array.from({length: 30}, () => 85 + Math.random() * 10);
    
    fuelTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Avg Diesel Price (India)',
                data: data,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9aa4b2' } },
                x: { grid: { display: false }, ticks: { display: false } }
            }
        }
    });
}

async function finalizeShipment(shipmentId) {
    if (!confirm("Are you sure you want to mark this shipment as FULLY COMPLETED? This will archive the lifecycle and enable receiver ratings.")) return;
    
    try {
        const res = await apiCall(`/manager/finance/fully-complete/${shipmentId}`, 'POST');
        showNotification(res.message, "success");
        loadShipments();
    } catch (e) {
        showNotification(e.detail || "Finalization failed", "error");
    }
}

async function recalculateAllFinances() {
    if (!confirm("💰 FINANCE SYNC: This will recalculate revenue, fuel budgets, and driver wages for ALL shipments in your history based on distances and current fuel prices. This cannot be undone. Proceed?")) return;
    
    try {
        const mId = localStorage.getItem('manager_id');
        const res = await apiCall(`/manager/finance/recalculate-all?company_id=${mId}`, 'POST');
        showNotification(res.message, "success");
        loadShipments();
    } catch (e) {
        showNotification("Failed to sync finances.", "error");
    }
}

// PAISA-FAST FINTECH ORACLE
let fintechChart = null;
async function confirmShipmentPayment(shipmentId) {
    if (!confirm("💳 Confirm that the receiver has paid the full amount? This will unlock the shipment for final OTP delivery.")) return;
    try {
        const res = await apiCall(`/manager/finance/confirm-payment/${shipmentId}`, 'POST');
        showNotification(res.message, "success");
        loadShipments();
        initFintechOracle();
    } catch (e) {
        showNotification(e.detail || "Payment confirmation failed", "error");
    }
}

async function initFintechOracle() {
    try {
        const mId = localStorage.getItem('manager_id');
        const stats = await apiCall(`/manager/fintech-stats?company_id=${mId}`);
        const pl = await apiCall(`/manager/finance/p-and-l?company_id=${mId}`);
        
        // Update Overview Cards
        const updateVal = (id, val, prefix='₹ ') => {
            const el = document.getElementById(id);
            if (el) el.innerText = prefix + (val || 0).toLocaleString();
        };

        updateVal('fintech-daily-revenue', stats.daily_revenue);
        updateVal('fintech-total-revenue', stats.total_revenue);
        updateVal('fintech-total-expenses', stats.total_expenses);
        updateVal('fintech-cod', stats.digital_escrow);
        updateVal('fintech-profit', stats.net_profit);

        // Render Settlements (Timeline of past 5 transactions)
        const sList = document.getElementById('fintech-settlement-list');
        if (sList) {
            sList.innerHTML = stats.recent_settlements.length ? stats.recent_settlements.map(s => `
                <div class="glass-card" style="padding:14px; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); margin-bottom:10px;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:${s.type === 'REVENUE' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}; display:flex; align-items:center; justify-content:center; font-size:1.1rem;">
                            ${s.type === 'REVENUE' ? '💰' : '💸'}
                        </div>
                        <div>
                            <div style="font-weight:700; font-size:0.9rem; color:var(--text);">${s.desc}</div>
                            <small style="color:var(--text-muted);">${new Date(s.timestamp).toLocaleString([], {hour:'2-digit', minute:'2-digit', day:'numeric', month:'short'})}</small>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="color:${s.type === 'REVENUE' ? 'var(--success)' : 'var(--danger)'}; font-weight:800; font-size:1rem;">
                            ${s.type === 'REVENUE' ? '+' : '-'}₹${s.amount.toLocaleString()}
                        </div>
                        <small style="color:var(--text-muted); text-transform:uppercase; font-size:0.65rem; letter-spacing:1px;">${s.type}</small>
                    </div>
                </div>
            `).join('') : '<p style="text-align:center; color:var(--text-muted);">No recent settlements</p>';
        }

        // Payout Table (Drivers with pending balance)
        const pTable = document.getElementById('fintech-payout-table');
        if (pTable) {
            const allDrivers = await apiCall(`/manager/drivers?company_id=${mId}`);
            const pending = allDrivers.filter(d => (d.wallet_balance || 0) > 0);
            pTable.innerHTML = pending.length ? pending.map(d => `
                <tr>
                    <td>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${d.name}" style="width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.05);">
                            <div>
                                <div style="font-weight:700;">${d.name}</div>
                                <small style="color:var(--text-muted);">${d.license_type} • ${d.login_id}</small>
                            </div>
                        </div>
                    </td>
                    <td style="color:var(--success); font-weight:800; font-size:1.1rem;">₹${(d.wallet_balance || 0).toLocaleString()}</td>
                    <td>
                        <button class="btn-primary" style="padding:6px 12px; font-size:0.75rem; background:#10b981; border-radius:8px;" onclick="settlePayout('${d.id}')">
                            Release Funds
                        </button>
                    </td>
                </tr>
            `).join('') : '<tr><td colspan="3" style="text-align:center; padding:30px; color:var(--text-muted);">No pending driver payouts</td></tr>';
        }

        // Payment Audit (Unpaid/Paid status monitoring)
        const paTable = document.getElementById('fintech-payment-audit-table');
        if (paTable) {
            const allShips = await apiCall(`/shipments?company_id=${mId}`);
            // Only show parent shipments (not internal legs) in Customer Payment Audit
            const recentShips = allShips.filter(s => !s.is_leg).slice(-20).reverse();
            paTable.innerHTML = recentShips.length ? recentShips.map(s => `
                <tr>
                    <td>
                        <div style="font-weight:700;">${s.description}</div>
                        <small style="color:var(--text-muted); font-family:monospace;">ID: ${s.id.substring(0,8)}</small>
                    </td>
                    <td style="font-weight:700;">₹${(s.finance?.suggested_price || 0).toLocaleString()}</td>
                    <td>
                        <span class="status-pill status-${s.payment_status}" style="font-size:0.65rem;">
                            ${s.payment_status.toUpperCase()}
                        </span>
                    </td>
                    <td>
                        ${s.payment_status === 'unpaid' ? `
                            <button class="btn-primary" style="padding:6px 12px; font-size:0.75rem; background:var(--accent); border-radius:8px;" onclick="confirmCustomerPayment('${s.id}')">
                                Manual Pay
                            </button>
                        ` : '<span style="color:var(--success); font-weight:bold;">✓ Verified</span>'}
                    </td>
                </tr>
            `).join('') : '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No shipment history</td></tr>';
        }

        // Escrow Table (Active Smart Contracts)
        const eTable = document.getElementById('fintech-escrow-table');
        if (eTable) {
            eTable.innerHTML = stats.escrow_contracts.length ? stats.escrow_contracts.map(c => `
                <tr>
                    <td style="font-family:monospace; font-size:0.8rem; color:var(--primary); font-weight:700;">${c.id}</td>
                    <td><b>${c.counterparty}</b></td>
                    <td style="font-weight:700;">₹${c.value.toLocaleString()}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div style="width:8px; height:8px; border-radius:50%; background:${c.status.includes('LOCKED') ? '#f59e0b' : '#3b82f6'};"></div>
                            <span style="font-size:0.75rem; font-weight:bold; color:var(--text);">${c.status}</span>
                        </div>
                    </td>
                    <td style="font-size:0.85rem; color:var(--text-muted);">
                        ${c.status.includes('AWAITING') ? `
                            <button class="btn-primary" style="padding:4px 10px; font-size:0.7rem; background:var(--warning); color:#000; border-radius:6px; font-weight:800;" onclick="confirmShipmentPayment('${c.shipment_id}')">
                                Confirm Payment 💰
                            </button>
                        ` : c.eta}
                    </td>
                </tr>
            `).join('') : '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No active smart contracts in escrow</td></tr>';
        }

        // Fund Requests Table
        const frTable = document.getElementById('fintech-fund-requests-table');
        if (frTable) {
            const fundRequests = await apiCall(`/manager/finance/fund-requests?company_id=${mId}`);
            frTable.innerHTML = fundRequests.length ? fundRequests.map(r => `
                <tr>
                    <td>
                        <div style="font-weight:700;">${r.driver_name}</div>
                        <small style="color:var(--text-muted);">ID: ${r.driver_id.substring(0,5)}</small>
                    </td>
                    <td style="color:var(--warning); font-weight:800; font-size:1.1rem;">₹${r.amount.toLocaleString()}</td>
                    <td>
                        <div style="font-weight:700;">${r.fund_type.toUpperCase()}</div>
                        <small style="color:var(--accent); font-weight:bold;">${r.distance} KM (Leg)</small>
                    </td>
                    <td>
                        <div style="display:flex; gap:8px;">
                            <button class="btn-primary" style="padding:6px 12px; font-size:0.75rem; background:var(--success); border-radius:8px;" onclick="approveFundRequest('${r.alert_id}')">Approve</button>
                            <button class="btn-primary" style="padding:6px 12px; font-size:0.75rem; background:var(--danger); border-radius:8px;" onclick="rejectFundRequest('${r.alert_id}')">Reject</button>
                        </div>
                    </td>
                </tr>
            `).join('') : '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No pending requests</td></tr>';
        }

        // Revenue Velocity Chart
        const chartEl = document.getElementById('fintechRevenueChart');
        if (chartEl) {
            const ctx = chartEl.getContext('2d');
            if (fintechChart) fintechChart.destroy();
            fintechChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: stats.chart_data.labels,
                    datasets: [{
                        label: 'Revenue Flow',
                        data: stats.chart_data.values,
                        borderColor: '#10b981',
                        borderWidth: 3,
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#10b981'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9aa4b2', font: { size: 10 } } },
                        x: { grid: { display: false }, ticks: { color: '#9aa4b2', font: { size: 10 } } }
                    }
                }
            });
        }
    } catch (e) { console.error("Fintech Oracle Error:", e); }
}

async function settlePayout(driverId) {
    if (!confirm("Are you sure you want to approve this payout? Ensure the transfer is done via your external banking system.")) return;
    try {
        await apiCall(`/manager/finance/approve-payout/${driverId}`, 'POST');
        alert("Payout settled successfully. Driver wallet has been debited.");
        initFintechOracle();
        loadInsights();
    } catch (e) { alert("Failed to settle payout."); }
}

async function confirmCustomerPayment(shipmentId) {
    try {
        await apiCall(`/manager/finance/confirm-payment/${shipmentId}`, 'POST');
        alert("Payment confirmed. Shipping lifecycle now cleared for delivery.");
        initFintechOracle();
        loadInsights();
    } catch (e) { alert("Failed to confirm payment."); }
}

async function approveFundRequest(alertId) {
    if (!confirm("Approve this fund request? The amount will be instantly credited to the driver's wallet.")) return;
    try {
        const res = await apiCall(`/manager/finance/approve-fund-request/${alertId}`, 'POST');
        alert(res.message);
        initFintechOracle();
        loadInsights();
    } catch (e) { alert("Failed to approve fund request: " + e.message); }
}

async function rejectFundRequest(alertId) {
    if (!confirm("Are you sure you want to REJECT this fund request?")) return;
    try {
        const res = await apiCall(`/manager/finance/reject-fund-request/${alertId}`, 'POST');
        alert(res.message);
        initFintechOracle();
    } catch (e) { alert("Failed to reject fund request: " + e.message); }
}

/* ── Smooth Draggable Floating Panels ─────────────────────────────────────
   Handles both mouse (desktop) and touch (mobile) events.
   Panels are dragged by their .drag-handle child.
   On mobile (≤768px) dragging is disabled — panels go static.
   ─────────────────────────────────────────────────────────────────────── */
function initDraggablePanels() {
    document.querySelectorAll('.draggable-panel').forEach(panel => {
        const handle = panel.querySelector('.drag-handle');
        if (!handle) return;

        let startX, startY, startLeft, startTop, rafId;
        let isDragging = false;

        const getLeft = () => parseFloat(panel.style.left) || panel.getBoundingClientRect().left;
        const getTop  = () => parseFloat(panel.style.top)  || panel.getBoundingClientRect().top;

        function onStart(clientX, clientY) {
            if (window.innerWidth <= 768) return; // Disable on mobile — panels are static
            isDragging = true;
            startX = clientX;
            startY = clientY;
            startLeft = getLeft();
            startTop  = getTop();
            panel.classList.add('is-dragging');
            panel.style.position = 'absolute';
        }

        function onMove(clientX, clientY) {
            if (!isDragging) return;
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                const dx = clientX - startX;
                const dy = clientY - startY;
                const parent = panel.offsetParent;
                const maxLeft = parent ? parent.clientWidth  - panel.offsetWidth  : window.innerWidth  - panel.offsetWidth;
                const maxTop  = parent ? parent.clientHeight - panel.offsetHeight : window.innerHeight - panel.offsetHeight;

                const newLeft = Math.max(0, Math.min(maxLeft, startLeft + dx));
                const newTop  = Math.max(0, Math.min(maxTop,  startTop  + dy));

                panel.style.left = newLeft + 'px';
                panel.style.top  = newTop  + 'px';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
            });
        }

        function onEnd() {
            isDragging = false;
            cancelAnimationFrame(rafId);
            panel.classList.remove('is-dragging');
        }

        // Mouse events
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            onStart(e.clientX, e.clientY);
        });
        window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
        window.addEventListener('mouseup', onEnd);

        // Touch events (mobile — only if not in static mode, but guard anyway)
        handle.addEventListener('touchstart', e => {
            const t = e.touches[0];
            onStart(t.clientX, t.clientY);
        }, { passive: true });
        handle.addEventListener('touchmove', e => {
            const t = e.touches[0];
            onMove(t.clientX, t.clientY);
        }, { passive: true });
        handle.addEventListener('touchend', onEnd);
    });
}

// Run after the DOM and weather section are ready
document.addEventListener('DOMContentLoaded', initDraggablePanels);
window.addEventListener('themeChanged', () => {
    const isWeatherPage = window.location.pathname.includes('manager_weather.html') || (typeof currentActiveSection !== 'undefined' && currentActiveSection === 'weather');
    if (isWeatherPage) {
        const theme = localStorage.getItem('theme') || 'dark';
        const standardUrl = theme === 'dark' 
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
        
        if (map) {
            map.eachLayer(layer => {
                if (layer instanceof L.TileLayer && !layer.options.isOverlay && layer._url && !layer._url.includes('arcgisonline') && !layer._url.includes('opentopomap') && !layer._url.includes('rainviewer')) {
                    map.removeLayer(layer);
                }
            });
            L.tileLayer(standardUrl, { attribution: '&copy; CARTO' }).addTo(map);
        }
    } else {
        updateMapTheme(map);
    }
});
async function validateVehiclePlate(plate) {
    const warning = document.getElementById('plate-warning');
    if (!plate || plate.length < 4) {
        if (warning) warning.style.display = 'none';
        return;
    }
    try {
        const res = await apiCall(`/manager/check-plate?plate=${encodeURIComponent(plate)}`, 'GET');
        if (warning) {
            warning.style.display = res.exists ? 'block' : 'none';
        }
    } catch (e) {
        console.error("Plate check failed:", e);
    }
}
window.validateVehiclePlate = validateVehiclePlate;

window.handlePlateInput = function(input) {
    let val = input.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (val.length > 10) val = val.substring(0, 10);
    
    let formatted = "";
    for (let i = 0; i < val.length; i++) {
        if (i === 2 || i === 4 || i === 6) formatted += " ";
        formatted += val[i];
    }
    input.value = formatted;
    
    // Validate clean version
    validateVehiclePlate(val);
}

window.formatDisplayPlate = function(plate) {
    if (!plate) return 'N/A';
    let val = plate.replace(/\s/g, '').toUpperCase();
    let formatted = "";
    for (let i = 0; i < val.length; i++) {
        if (i === 2 || i === 4 || i === 6) formatted += " ";
        formatted += val[i];
    }
    return formatted;
}

window.showMergeSuggestions = async function() {
    const modal = document.getElementById('merge-modal');
    const container = document.getElementById('merge-suggestions-container');
    modal.style.display = 'flex';
    container.innerHTML = '<p style="text-align:center;">Scanning for merge opportunities...</p>';
    
    try {
        const data = await apiCall('/manager/merge-suggestions', 'GET');
        
        if (!data.suggestions || data.suggestions.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">No new merge opportunities found at this time.</p>';
            return;
        }
        
        container.innerHTML = data.suggestions.map((sug, index) => {
            const shipIds = sug.shipment_ids.map(id => id.substring(0,8)).join(', ');
            const typeIcon = sug.type === 'hub_transit' ? '🏗️' : '📍';
            return `
                <div class="glass-card" style="margin-bottom:15px; padding:20px; border-left:4px solid var(--accent); background:rgba(255,255,255,0.03);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="flex:1;">
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                                <span style="font-size:1.2rem;">${typeIcon}</span>
                                <h4 style="margin:0; font-weight:800; color:var(--text);">${sug.reason}</h4>
                            </div>
                            <p style="margin:0; font-size:0.85rem; color:var(--text-muted); line-height:1.6;">
                                <b style="color:var(--text);">Shipments (${sug.count}):</b> <span style="font-family:monospace; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;">${shipIds}</span> <br>
                                <b style="color:var(--text);">Total Combined Weight:</b> <span style="color:var(--accent); font-weight:bold;">${sug.total_weight.toFixed(1)} kg</span>
                            </p>
                        </div>
                        <button class="btn-primary" style="padding:10px 20px; font-size:0.85rem; width:auto; background:var(--success); box-shadow: 0 4px 15px rgba(16, 185, 129, 0.2);" onclick="approveMerge(${index})" id="btn-merge-${index}">Approve Merge</button>
                    </div>
                </div>
            `;
        }).join('');
        
        // Store suggestions globally so we can access shipment_ids
        window.currentMergeSuggestions = data.suggestions;
        
    } catch (e) {
        container.innerHTML = '<p style="text-align:center; color:var(--danger);">Failed to fetch merge suggestions.</p>';
    }
}

window.approveMerge = async function(index) {
    const btn = document.getElementById(`btn-merge-${index}`);
    btn.disabled = true;
    btn.innerText = 'Consolidating...';
    
    const sug = window.currentMergeSuggestions[index];
    
    try {
        await apiCall('/manager/approve-merge', 'POST', {
            company_id: localStorage.getItem('manager_id'),
            shipment_ids: sug.shipment_ids
        });
        
        btn.innerText = 'Merged ✅';
        btn.style.background = 'var(--success)';
        
        // Reload shipments
        if (typeof loadShipments === 'function') {
            loadShipments();
        }
        
        setTimeout(() => {
            showMergeSuggestions(); // Refresh list
        }, 1500);
        
    } catch (e) {
        btn.disabled = false;
        btn.innerText = 'Approve Merge';
        alert('Merge failed.');
    }
}

async function loadFundRequests() {
    const cid = localStorage.getItem('manager_id');
    try {
        // Use the new finance/fund-requests endpoint which parses alerts
        const reqs = await apiCall(`/manager/finance/fund-requests?company_id=${cid}`);
        const tbody = document.getElementById('fund-requests-body');
        if (!tbody) return;
        
        if (reqs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">No pending requests.</td></tr>';
            return;
        }

        tbody.innerHTML = reqs.map(r => {
            return `
                <tr>
                    <td>
                        <b>${r.driver_name}</b><br>
                        <small style="color:var(--text-muted);">ID: ${r.driver_id.slice(0,8)}</small>
                    </td>
                    <td><span class="badge" style="background:${r.fund_type === 'REFUEL' ? 'var(--warning)' : 'var(--primary)'}">${r.fund_type}</span></td>
                    <td><b style="color:var(--success);">₹ ${r.amount.toLocaleString()}</b></td>
                    <td>${r.distance.toFixed(1)} km</td>
                    <td style="text-align:center;">
                        <button class="btn-primary" style="padding:6px 12px; font-size:0.75rem; background:var(--success); border-radius:8px;" onclick="releaseFund('${r.alert_id}')">Approve & Release</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch(e) {
        console.error("Fund load failed:", e);
    }
}

async function releaseFund(alertId) {
    if (!confirm('Approve and release these funds to the driver?')) return;
    try {
        await apiCall(`/manager/finance/approve-fund-request/${alertId}`, 'POST');
        showNotification('Funds released successfully.', 'success');
        loadFundRequests();
        initFintechOracle(); // Refresh P&L
    } catch (e) {
        showNotification(e.detail || 'Failed to release funds.', 'error');
    }
}

// Ensure it loads when showing ledger section
const originalShowSection = window.showSection;
window.showSection = function(id) {
    if (id === 'ledger') loadFundRequests();
    if (originalShowSection) originalShowSection(id);
};

// --- RECEIVER MANAGEMENT ---

window.loadReceivers = async function() {
    try {
        const company_id = localStorage.getItem('manager_id');
        const receivers = await apiCall(`/manager/receivers?company_id=${company_id}`);
        renderReceiversTable(receivers);
    } catch (err) {
        console.error("Failed to load receivers:", err);
    }
};

function renderReceiversTable(receivers) {
    const tbody = document.getElementById('receivers-table-body');
    if (!tbody) return;

    if (!receivers || receivers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:60px; color:var(--text-muted);"><div style="font-size:3rem; margin-bottom:15px; opacity:0.3;">👥</div><span data-i18n="no_data">No receiver data available.</span></td></tr>`;
        return;
    }

    tbody.innerHTML = receivers.map(r => `
        <tr>
            <td style="font-family:monospace; color:var(--primary); font-weight:700;">${r.id}</td>
            <td style="font-weight:600;">${r.name}</td>
            <td style="color:var(--muted);">${r.email}</td>
            <td style="color:var(--muted); font-weight:700;">${r.phone}</td>
            <td>
                <div style="display:flex; gap:8px;">
                    <button class="btn-primary" style="width:auto; padding:6px 12px; font-size:0.75rem; background:rgba(255,255,255,0.05); border:1px solid var(--border);" onclick="viewReceiverOrders('${r.id}')">📦 Orders</button>
                    <button class="btn-primary" style="width:auto; padding:6px 12px; font-size:0.75rem; background:rgba(79, 140, 255, 0.1); color:var(--primary); border:1px solid var(--primary);" onclick="editReceiver('${r.id}')">✏️ Edit</button>
                    <button class="btn-primary" style="width:auto; padding:6px 12px; font-size:0.75rem; background:rgba(255, 75, 75, 0.1); color:#ff4b4b; border:1px solid #ff4b4b;" onclick="deleteReceiver('${r.id}')">🗑️ Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

window.lookupReceiverByEmail = async function(email) {
    const statusDiv = document.getElementById('receiver-lookup-status');
    const nameInput = document.getElementById('receiver-name');
    const phoneInput = document.getElementById('receiver-phone');
    
    if (!email || !email.includes('@')) {
        statusDiv.style.display = 'none';
        return;
    }

    try {
        const company_id = localStorage.getItem('manager_id');
        const receivers = await apiCall(`/manager/receivers?company_id=${company_id}`);
        const found = receivers.find(r => r.email.toLowerCase() === email.toLowerCase());

        if (found) {
            currentLookedUpReceiverId = found.id;
            statusDiv.innerHTML = `<span style="color:var(--success); font-weight:700;">✅ Found: ${found.name} (${found.id})</span>`;
            statusDiv.style.display = 'block';
            
            nameInput.value = found.name;
            phoneInput.value = found.phone.replace("+91", "");
            
            nameInput.disabled = true;
            phoneInput.disabled = true;
            nameInput.style.opacity = '0.5';
            phoneInput.style.opacity = '0.5';
        } else {
            currentLookedUpReceiverId = null;
            statusDiv.innerHTML = `<span style="color:var(--primary); font-weight:700;">🆕 New Receiver Record</span>`;
            statusDiv.style.display = 'block';
            
            nameInput.disabled = false;
            phoneInput.disabled = false;
            nameInput.style.opacity = '1';
            phoneInput.style.opacity = '1';
        }
    } catch (err) {
        console.error("Receiver lookup failed", err);
    }
};

window.viewReceiverOrders = function(id) {
    showNotification("View Orders logic coming soon!");
};

window.editReceiver = async function(id) {
    try {
        const company_id = localStorage.getItem('manager_id');
        const receivers = await apiCall(`/manager/receivers?company_id=${company_id}`);
        const r = receivers.find(rec => rec.id === id);
        if (!r) return;

        const newName = prompt("Edit Name:", r.name);
        const newPhone = prompt("Edit Phone:", r.phone);
        const newEmail = prompt("Edit Email:", r.email);

        if (newName && newPhone && newEmail) {
            await apiCall('/manager/receivers/upsert', 'POST', {
                ...r,
                name: newName,
                phone: newPhone,
                email: newEmail
            });
            showNotification("Receiver updated successfully!");
            loadReceivers();
        }
    } catch (err) {
        showNotification("Failed to update receiver", "error");
    }
};

window.deleteReceiver = async function(id) {
    if (!confirm("Are you sure you want to delete this receiver? This will NOT delete their shipments but will remove them from your contacts.")) return;
    
    try {
        const company_id = localStorage.getItem('manager_id');
        await apiCall(`/manager/receivers/${id}?company_id=${company_id}`, 'DELETE');
        showNotification("Receiver deleted successfully!");
        loadReceivers();
    } catch (err) {
        showNotification("Failed to delete receiver", "error");
    }
};

async function openDriverProfile(id) {
    const d = globalDrivers.find(item => item.id === id);
    if (!d) return;

    document.getElementById('dp-name').innerText = d.name;
    document.getElementById('dp-id').innerText = `ID: ${d.system_id || d.id.slice(0,8)}`;
    document.getElementById('dp-img').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${d.name}`;
    
    // Status & Duty
    const dutyBadge = document.getElementById('dp-duty-badge');
    const isOnDuty = d.is_on_duty !== false;
    dutyBadge.innerText = isOnDuty ? '🟢 ON DUTY' : '🔴 NOT WORKING';
    dutyBadge.style.background = isOnDuty ? 'var(--success)22' : 'var(--danger)22';
    dutyBadge.style.color = isOnDuty ? 'var(--success)' : 'var(--danger)';

    // Metrics
    document.getElementById('dp-punctuality').innerText = `${d.punctuality_rate || 98}%`;
    document.getElementById('dp-breaks').innerText = d.breaks_taken || 0;
    document.getElementById('dp-rating').innerText = `${d.safety_rating || 5.0} ⭐`;
    document.getElementById('dp-points').innerText = d.reward_points || 0;

    // Fatigue
    const fatigue = d.fatigue_level || 15;
    document.getElementById('dp-fatigue-bar').style.width = `${fatigue}%`;
    document.getElementById('dp-fatigue-bar').style.background = fatigue > 70 ? 'var(--danger)' : (fatigue > 40 ? 'var(--warning)' : 'var(--success)');

    // Vitals
    const health = d.health_metrics || {};
    document.getElementById('dp-heart').innerText = health.heart_rate ? `${health.heart_rate} BPM` : '--';
    document.getElementById('dp-o2').innerText = health.oxygen_level ? `${health.oxygen_level}%` : '--';
    document.getElementById('dp-stress').innerText = health.stress_index || '--';

    document.getElementById('driver-profile-modal').style.display = 'block';
}

window.loadHubLeaves = async function() {
    const tbody = document.getElementById('hub-leaves-body');
    if (!tbody) return;
    
    const companyId = localStorage.getItem('manager_id');
    try {
        const [reqs, warehouses] = await Promise.all([
            apiCall(`/manager/warehouses/leave-requests?company_id=${companyId}`),
            apiCall(`/manager/warehouses?company_id=${companyId}`)
        ]);
        
        const total = reqs.length;
        const pending = reqs.filter(r => (r.status || '').toLowerCase() === 'pending').length;
        const active = reqs.filter(r => (r.status || '').toLowerCase() === 'approved').length;

        if (document.getElementById('total-leave-count')) document.getElementById('total-leave-count').innerText = total;
        if (document.getElementById('pending-leave-count')) document.getElementById('pending-leave-count').innerText = pending;
        if (document.getElementById('active-leave-count')) document.getElementById('active-leave-count').innerText = active;

        if (total === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="padding:40px; text-align:center; color:var(--text-muted);">No operational leave requests found.</td></tr>';
            return;
        }
        
        tbody.innerHTML = reqs.reverse().map(r => {
            const wh = warehouses.find(w => w.id === r.warehouse_id);
            const status = (r.status || 'pending').toLowerCase();
            const statusColor = status === 'approved' ? 'var(--success)' : (status === 'rejected' ? 'var(--danger)' : 'var(--warning)');
            
            return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05); transition: background 0.3s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                    <td style="padding:20px 24px;">
                        <div style="font-weight:700; font-size:1.05rem; color:#fff;">${wh ? wh.name : 'Unknown Hub'}</div>
                        <div style="font-family:monospace; color:var(--text-muted); font-size:0.75rem; margin-top:4px;">ID: ${r.warehouse_id.substring(0,8)}</div>
                    </td>
                    <td style="padding:20px 24px;">
                        <div style="color:var(--accent); font-weight:700; font-size:0.95rem;">${r.start_date} <span style="color:var(--text-muted); font-weight:400; margin:0 4px;">→</span> ${r.end_date}</div>
                        <div style="color:var(--text-muted); font-size:0.75rem; margin-top:4px;">Registered: ${new Date(r.created_at).toLocaleDateString()}</div>
                    </td>
                    <td style="padding:20px 24px;">
                        <span class="status-pill" style="background:${statusColor}22; color:${statusColor}; font-weight:800; font-size:0.75rem; padding:6px 12px; border-radius:30px; border:1px solid ${statusColor}44; text-transform:uppercase; letter-spacing:0.5px;">
                            ${status}
                        </span>
                    </td>
                    <td style="padding:20px 24px; text-align:right;">
                        ${status === 'pending' ? `
                            <button class="btn-primary" style="background:var(--success); color:white; padding:10px 20px; margin-right:8px; border:none; border-radius:12px; cursor:pointer; font-weight:700; font-size:0.85rem; box-shadow:0 4px 15px rgba(16, 185, 129, 0.2);" onclick="updateLeaveStatus('${r.id}', 'approved')">Approve ✅</button>
                            <button class="btn-primary" style="background:var(--danger); color:white; padding:10px 20px; border:none; border-radius:12px; cursor:pointer; font-weight:700; font-size:0.85rem; box-shadow:0 4px 15px rgba(239, 68, 68, 0.2);" onclick="updateLeaveStatus('${r.id}', 'rejected')">Reject ❌</button>
                        ` : `
                            <div style="color:var(--text-muted); font-style:italic; font-size:0.85rem; background:rgba(255,255,255,0.03); display:inline-block; padding:8px 16px; border-radius:10px; border:1px solid rgba(255,255,255,0.05);">
                                Action Resolved (${status})
                            </div>
                        `}
                    </td>
                </tr>
            `;
        }).join('');
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:40px; text-align:center; color:var(--danger);">Failed to load registry.</td></tr>';
    }
};

window.updateLeaveStatus = async function(reqId, status) {
    if (!confirm(`Are you sure you want to ${status} this request?`)) return;
    try {
        const companyId = localStorage.getItem('manager_id');
        await apiCall(`/manager/warehouses/leave-requests/${reqId}/status?status=${status}&company_id=${companyId}`, 'PUT');
        showNotification(`Request ${status} successfully.`, "success");
        loadHubLeaves();
    } catch(e) {
        showNotification("Failed to update status.", "error");
    }
};
