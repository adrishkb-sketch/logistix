// Driver Dashboard Logic
// API_BASE is globally defined in api.js

const dId = localStorage.getItem('driver_id');

function showStatusOverlay(message, duration = 4000) {
    const overlay = document.createElement('div');
    overlay.className = 'glass-card';
    overlay.style.cssText = `
        position: fixed;
        top: 30%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 200000;
        padding: 40px;
        min-width: 300px;
        text-align: center;
        background: rgba(10, 15, 28, 0.95);
        border: 2px solid var(--accent);
        box-shadow: 0 0 50px rgba(0, 242, 254, 0.4);
        border-radius: 24px;
        backdrop-filter: blur(20px);
        animation: slideInDown 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;
    overlay.innerHTML = `
        <div style="font-size:4rem; margin-bottom:20px;">⚡</div>
        <h2 style="color:var(--accent); margin-bottom:12px; font-size:2rem; font-weight:800; letter-spacing:-0.5px;">${message}</h2>
        <p style="color:var(--text-muted); font-size:1rem; line-height:1.5;">${getTranslation('status_broadcasted')}</p>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => {
        overlay.style.transition = 'all 0.5s ease';
        overlay.style.opacity = '0';
        overlay.style.transform = 'translate(-50%, -60%)';
        setTimeout(() => overlay.remove(), 500);
    }, duration);
}

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
if (!dId || dId === "null" || dId === "undefined") {
    console.warn("Driver ID missing or invalid. Redirecting to login...");
    window.location.href = '../index.html';
    // Use return or a non-fatal error if possible, but throw is okay for halting script
    throw new Error("AUTH_REQUIRED: Redirecting to login...");
}
const nameEl = document.getElementById('driver-name');
if (nameEl) nameEl.innerText = localStorage.getItem('driver_name') || getTranslation('driver');

let isSimulationMode = false;

function attachSimulationDrag(m) {
    if (!m) return;
    m.on('dragend', async (e) => {
        if (!isSimulationMode) return;
        const { lat, lng } = e.target.getLatLng();
        await apiCall(`/driver/${localStorage.getItem('driver_id')}/location`, 'POST', { lat, lng });
        showNotification(getTranslation('sim_movement_synced'), "success");
    });
}

// Duplicate checkSimulationStatus removed

let map;
let marker;
let driverPerfChart;
let watchId;
let routeCoords = [];
let hasSetInitialView = false;

function showError(msg) {
    const container = document.getElementById('mission-container');
    if (container) {
        container.innerHTML = `
            <div class="glass-card" style="border-left: 4px solid var(--danger); padding: 24px; text-align: center;">
                <h3 style="color: var(--danger);">⚠️ ${getTranslation('error') || 'Error'}</h3>
                <p style="color: var(--muted);">${msg}</p>
                <button class="btn-primary" style="margin-top: 15px; width: auto; padding: 10px 20px;" onclick="location.reload()">
                    ${getTranslation('retry') || 'Retry'} 🔄
                </button>
            </div>
        `;
    }
    // Also show main content if it was hidden
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.style.display = 'block';
    
    // Hide loading spinners
    const spinners = document.querySelectorAll('.spinner');
    spinners.forEach(s => s.style.display = 'none');
}
let lastMsgCount = parseInt(localStorage.getItem('last_seen_msg_count_driver') || '-1');
let currentActiveTab = 'dash';
let isHalted = false;
let lastBearing = 0;

const ICON_PICKUP = L.divIcon({
    html: `<div style="background:#f6ad55; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 10px rgba(246,173,85,0.5); font-size:16px;">🏢</div>`,
    className: 'custom-marker', iconSize: [30, 30], iconAnchor: [15, 15]
});

const ICON_DROP = L.divIcon({
    html: `<div style="background:#48bb78; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 10px rgba(72,187,120,0.5); font-size:16px;">🏁</div>`,
    className: 'custom-marker', iconSize: [30, 30], iconAnchor: [15, 15]
});

function getVehicleIcon(bearing = 0) {
    return L.divIcon({
        html: `<div style="transform:rotate(${bearing}deg); font-size:24px; transition: transform 0.5s ease; filter: drop-shadow(0 0 5px var(--primary));">🚀</div>`,
        className: 'vehicle-marker', iconSize: [30, 30], iconAnchor: [15, 15]
    });
}

async function checkSimulationStatus() {
    try {
        const status = await apiCall('/simulation/mode/status');
        const prev = isSimulationMode;
        isSimulationMode = status.active;
        const ctrl = document.getElementById('simulation-ctrl');
        if (ctrl) ctrl.style.display = isSimulationMode ? 'block' : 'none';
        
        // If simulation state changed, update marker draggability
        if (prev !== isSimulationMode && marker) {
            if (isSimulationMode) {
                marker.dragging.enable();
                attachSimulationDrag(marker);
            } else {
                marker.dragging.disable();
                marker.off('dragend');
            }
        }
        
        if (isSimulationMode) {
            // Check if this driver is halted
            isHalted = status.halted_drivers.includes(dId);
            const haltBtn = document.getElementById('sim-halt-btn');
            if (haltBtn) {
                haltBtn.innerText = isHalted ? getTranslation('resume_movement') : getTranslation('emergency_halt');
                haltBtn.style.background = isHalted ? "var(--success)" : "var(--danger)";
            }
        }
    } catch (e) {}
}

async function toggleSimHalt() {
    try {
        const res = await apiCall(`/simulation/mode/toggle-halt/${dId}`, 'POST');
        isHalted = res.halted;
        const haltBtn = document.getElementById('sim-halt-btn');
        if (haltBtn) {
            haltBtn.innerText = isHalted ? getTranslation('resume_movement_btn') : getTranslation('emergency_halt_btn');
            haltBtn.style.background = isHalted ? "var(--success)" : "var(--danger)";
        }
        showNotification(isHalted ? getTranslation('vehicle_halted_msg') : getTranslation('movement_resumed_msg'), isHalted ? "error" : "success");
    } catch (e) {
        alert("Failed to toggle halt status.");
    }
}

// Initial status check
setTimeout(checkSimulationStatus, 1000);

// Stationary Tracking Variables
let lastMovedTimestamp = Date.now();
let lastLocation = null;
let stationaryAlertShown = false;

// Zen Mode & Motion Tracking
let isZenMode = false;
let motionThreshold = 15; // G-force threshold for erratic driving
let lastMotionAlert = 0;

// Real-time Refresh Loop
setInterval(() => {
    const activeSection = document.querySelector('.section-content:not([style*="display: none"])');
    if (activeSection && (activeSection.id === 'active-tab' || activeSection.id === 'dash-tab')) {
        if (activeSection.id === 'active-tab') loadActiveMission();
        else loadDashStats();
    }
    checkSimulationStatus();
}, 5000);

// Background Notification Poller (Snappier for Chat)
setInterval(async () => {
    try {
        const dId = localStorage.getItem('driver_id');
        if (!dId) return;
        
        const msgs = await apiCall(`/tracking/messages/${dId}?company_id=${localStorage.getItem('company_id')}`);
        
        if (msgs.length > lastMsgCount) {
            if (currentActiveTab !== 'chat') {
                const badge = document.getElementById('chat-badge');
                if (badge) {
                    badge.style.display = 'inline-block';
                    badge.style.background = 'var(--danger)';
                    badge.style.border = '1.5px solid var(--bg)';
                }
                const btn = document.getElementById('btn-tab-chat');
                if (btn) {
                    btn.style.fontWeight = '900';
                    btn.style.color = 'var(--text)';
                }
            } else {
                // Already in chat, just update the seen count
                lastMsgCount = msgs.length;
                localStorage.setItem('last_seen_msg_count_driver', lastMsgCount);
                // Also update the chat list if we are looking at it
                const container = document.getElementById('driver-messages');
                if (container) renderDriverMessages(msgs);
            }
        }
    } catch(e) {}
}, 5000);

function switchDriverTab(tab) {
    currentActiveTab = tab;
    const tabs = ['dash', 'active', 'chat', 'completed', 'contracts', 'wallet', 'profile'];
    tabs.forEach(t => {
        const el = document.getElementById(`${t}-tab`);
        const btn = document.getElementById(`btn-tab-${t}`);
        if (el) el.style.display = t === tab ? 'block' : 'none';
        if (btn) {
            btn.style.background = t === tab ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
            btn.style.color = t === tab ? '#fff' : 'var(--muted)';
        }
    });
    if (tab === 'wallet') loadWallet();
    if (tab === 'contracts') loadContracts();

    if (tab === 'dash') loadDashStats();
    if (tab === 'profile') loadProfileData();
    if (tab === 'chat') {
        loadAlertsAndMessages();
        const badge = document.getElementById('chat-badge');
        if (badge) badge.style.display = 'none';
        const btn = document.getElementById('btn-tab-chat');
        if (btn) {
            btn.style.fontWeight = '700'; // Standard bold
            btn.style.color = 'var(--muted)';
        }
        
        // Mark as seen
        apiCall(`/tracking/messages/${dId}?company_id=${localStorage.getItem('company_id')}`)
            .then(msgs => {
                lastMsgCount = msgs.length;
                localStorage.setItem('last_seen_msg_count_driver', lastMsgCount);
            });
    }
    if (tab === 'active' && map) setTimeout(() => map.invalidateSize(), 200);
}

async function loadDashStats() {
    try {
        const stats = await apiCall(`/driver/${localStorage.getItem('driver_id')}/dashboard/stats`);
        
        document.getElementById('d-stat-earned').innerText = `${Math.floor(stats.total_points || 0)}`;
        document.getElementById('d-stat-ontime').innerText = `${stats.timely_percent}%`;
        document.getElementById('d-stat-safety').innerText = (5 - (stats.fatigue_score/100)).toFixed(1);

        // Populate Last Trip Breakdown
        const summaryBox = document.getElementById('last-trip-summary');
        const summaryContent = document.getElementById('trip-breakdown-content');
        if (stats.latest_breakdown) {
            summaryBox.style.display = 'block';
            const b = stats.latest_breakdown;
            summaryContent.innerHTML = `
                <div style="display:flex; justify-content:space-between;"><span>📏 ${getTranslation('base_distance')}:</span> <span>+${b.base_distance}</span></div>
                <div style="display:flex; justify-content:space-between;"><span>⏱️ ${getTranslation('punctuality_bonus')}:</span> <span>+${b.punctuality_bonus}</span></div>
                <div style="display:flex; justify-content:space-between;"><span>🛡️ ${getTranslation('safety_incentive')}:</span> <span>+${b.safety_incentive}</span></div>
                <div style="display:flex; justify-content:space-between;"><span>🧘 ${getTranslation('wellness_bonus')}:</span> <span>+${b.wellness_bonus}</span></div>
                ${b.customer_rating_bonus !== undefined ? `<div style="display:flex; justify-content:space-between;"><span>🌟 ${getTranslation('receiver_rating_bonus')}:</span> <span>${b.customer_rating_bonus >= 0 ? '+' : ''}${b.customer_rating_bonus}</span></div>` : ''}
                <hr style="border:0; border-top:1px solid rgba(255,255,255,0.1); margin:8px 0;">
                <div style="display:flex; justify-content:space-between; font-weight:bold; color:var(--success);"><span>${getTranslation('total_points')}:</span> <span>${b.total}</span></div>
            `;
        } else {
            summaryBox.style.display = 'none';
        }

        if (stats.perf_history && stats.perf_history.length > 0) {
            renderDriverChart(stats.perf_history);
        } else {
            renderDriverChart([0, 0, 0, 0, 0]); 
        }
        
        // Mini vehicle details
        const drivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('company_id')}`);
        const me = drivers && Array.isArray(drivers) ? drivers.find(d => String(d.id) === String(localStorage.getItem('driver_id'))) : null;
        
        if (me && me.assigned_vehicle_id) {
            document.getElementById('vehicle-mini-details').innerText = `${getTranslation('active_vehicle_label')}${me.assigned_vehicle_id}`;
            
            // Handle Breakdown/Maintenance UI
            const vehicles = await apiCall(`/manager/vehicles?company_id=${localStorage.getItem('company_id')}`);
            const v = vehicles && Array.isArray(vehicles) ? vehicles.find(veh => veh.id === me.assigned_vehicle_id) : null;
            
            const statusBadge = document.getElementById('vehicle-status-badge');
            const actionsDiv = document.getElementById('vehicle-actions');
            const rescueInfo = document.getElementById('breakdown-rescue-info');
            
            if (v) {
                if (v.status === 'maintenance') {
                    statusBadge.innerText = getTranslation('under_maintenance');
                    statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
                    statusBadge.style.color = 'var(--danger)';
                    actionsDiv.innerHTML = `<button class="btn-primary" style="padding:8px 16px; background:var(--success); font-size:0.85rem;" onclick="completeMaintenance()">🔧 ${getTranslation('mark_repaired')}</button>`;
                    rescueInfo.style.display = 'block';
                    document.getElementById('rescue-details').innerText = getTranslation('maintenance_lock_desc');
                } else {
                    statusBadge.innerText = (getTranslation(v.status) || v.status).toUpperCase().replace('_', '-');
                    statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                    statusBadge.style.color = 'var(--success)';
                    actionsDiv.innerHTML = `<button class="btn-primary" style="padding:8px 16px; background:var(--danger); font-size:0.85rem;" onclick="reportBreakdown()">🚨 ${getTranslation('report_breakdown')}</button>`;
                    rescueInfo.style.display = 'none';
                }
                
                // Enrich details with health and efficiency
                const health = stats.vehicle_health || 100;
                const healthColor = health > 70 ? 'var(--success)' : (health > 30 ? 'var(--warning)' : 'var(--danger)');
                document.getElementById('vehicle-mini-details').innerHTML = `
                    <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
                        <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                            <span>🛡️ ${getTranslation('vehicle_health')}</span>
                            <span style="color:${healthColor}">${health.toFixed(1)}%</span>
                        </div>
                        <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                            <div style="width:${health}%; height:100%; background:${healthColor}; transition:width 0.5s ease;"></div>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-top:5px; font-size:0.8rem;">
                            <span>⛽ ${getTranslation('label_fuel_efficiency')}</span>
                            <span style="color:var(--accent)">${stats.fuel_efficiency || 0} km/L</span>
                        </div>
                    </div>
                `;
            } else {
                document.getElementById('vehicle-mini-details').innerText = getTranslation('vehicle_data_not_found');
            }
        }
    } catch(e) {
        console.error("Error in loadDashStats:", e);
    }
}

async function reportBreakdown() {
    if (!confirm(getTranslation('breakdown_confirm'))) return;
    try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout: 5000}));
        const res = await apiCall(`/driver/${dId}/breakdown`, 'POST', { lat: pos.coords.latitude, lng: pos.coords.longitude });
        showNotification(getTranslation('breakdown_reported'), "error");
        loadDashStats();
    } catch (e) {
        await apiCall(`/driver/${dId}/breakdown`, 'POST', { lat: 0, lng: 0 });
        showNotification(getTranslation('breakdown_no_gps'), "error");
        loadDashStats();
    }
}

async function completeMaintenance() {
    try {
        await apiCall(`/driver/${dId}/maintenance-complete`, 'POST');
        showNotification(getTranslation('vehicle_cleared'), "success");
        loadDashStats();
    } catch (e) {
        showNotification("Failed to update status.", "error");
    }
}

function renderDriverChart(history) {
    const ctx = document.getElementById('driverPerfChart')?.getContext('2d');
    if (!ctx) return;

    if (driverPerfChart) driverPerfChart.destroy();

    driverPerfChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Trip -4', 'Trip -3', 'Trip -2', 'Trip -1', 'Latest'],
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
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { 
                y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } } 
            }
        }
    });
}

async function loadMissions(autoStartNext = false) {
    console.info(`[Bootstrap] Starting loadMissions for Driver: ${dId}`);
    try {
        const companyId = localStorage.getItem('company_id');
        if (!companyId || companyId === "undefined") {
            console.warn("[Bootstrap] Missing company_id, attempting to fetch...");
        }

        // Fetch driver info to check verification status
        const drivers = await apiCall(`/manager/drivers?company_id=${companyId}`);
        const me = drivers && Array.isArray(drivers) ? drivers.find(d => String(d.id) === String(dId)) : null;
        
        const mainContent = document.getElementById('main-content');
        const vScreen = document.getElementById('verification-screen');
        const vUploadBox = document.getElementById('v-upload-box');
        const vPendingBox = document.getElementById('v-pending-box');
        const vNoVehicleBox = document.getElementById('v-no-vehicle-box');
        const vScreenMsg = document.getElementById('v-screen-msg');
        const reportBtn = document.getElementById('report-issue-btn');

        if (!me) {
            console.error("[Bootstrap] Driver profile not found in company list");
            if (mainContent) mainContent.style.display = 'none';
            if (vScreen) {
                vScreen.style.display = 'block';
                vNoVehicleBox.style.display = 'block';
                vUploadBox.style.display = 'none';
                vPendingBox.style.display = 'none';
            }
            return;
        }

        // Safety & Fitness Block
        const v_id = me.assigned_vehicle_id;
        const vehicles = await apiCall(`/manager/vehicles?company_id=${companyId}`);
        const myVehicle = v_id ? vehicles.find(v => v.id === v_id) : null;

        if (me.is_fit === false || (myVehicle && myVehicle.is_operational === false)) {
            if (mainContent) mainContent.style.display = 'none';
            if (vScreen) {
                vScreen.style.display = 'block';
                vUploadBox.style.display = 'none';
                vPendingBox.style.display = 'none';
                vNoVehicleBox.style.display = 'none';
                
                let blockMsg = "";
                if (me.is_fit === false) blockMsg += "🚨 YOU ARE MARKED AS UNFIT. PLEASE TAKE REST. ";
                if (myVehicle && myVehicle.is_operational === false) blockMsg += "🛠️ VEHICLE BREAKDOWN REPORTED. MISSION ABORTED.";
                
                vScreenMsg.innerHTML = `<div style="padding:40px; text-align:center;">
                    <div style="font-size:5rem; margin-bottom:20px;">🛑</div>
                    <h1 style="color:var(--danger); font-size:2.5rem; margin-bottom:20px;">SAFETY BLOCK</h1>
                    <p style="font-size:1.4rem; line-height:1.6; font-weight:bold;">${blockMsg}</p>
                    <p style="margin-top:20px; color:var(--text-muted);">Please contact your Hub Manager for clearance once you or your vehicle are ready.</p>
                </div>`;
            }
            return;
        }

        const vStatus = me ? (me.verification_status || "unverified") : "unverified";
        
        if (vStatus === "unverified") {
            mainContent.style.display = 'none';
            if (reportBtn) reportBtn.style.display = 'none';
            vScreen.style.display = 'block';
            vUploadBox.style.display = 'block';
            vPendingBox.style.display = 'none';
            vNoVehicleBox.style.display = 'none';
            vScreenMsg.innerText = getTranslation('v_verify_desc');
        } else if (me) {
            // Verified driver logic
            if (me.verification_status === "pending_manual") {
                mainContent.style.display = 'none';
                if (vScreen) {
                    vScreen.style.display = 'block';
                    vUploadBox.style.display = 'none';
                    vPendingBox.style.display = 'block';
                    vNoVehicleBox.style.display = 'none';
                }
            } else {
                // Driver is verified!
                mainContent.style.display = 'block';
                if (vScreen) vScreen.style.display = 'none';
                if (reportBtn) reportBtn.style.display = 'block';
                
                if (!me.assigned_vehicle_id) {
                    // Show a warning in the dashboard rather than hiding it
                    const vehicleCard = document.getElementById('vehicle-status-card');
                    if (vehicleCard) {
                        vehicleCard.style.borderLeftColor = 'var(--warning)';
                        document.getElementById('vehicle-status-badge').innerText = "PENDING ASSIGNMENT";
                        document.getElementById('vehicle-mini-details').innerText = "Waiting for manager to assign a vehicle...";
                    }
                }
                loadDashStats();
            }
        }

        const shipments = await apiCall(`/driver/${dId}/shipments`);
        const container = document.getElementById('mission-container');
        
        const activeShipments = shipments.filter(s => s.status !== 'delivered' && s.status !== 'finalized');
        const completedShipments = shipments.filter(s => s.status === 'delivered' || s.status === 'finalized');
        
        // Render Completed Orders
        const completedContainer = document.getElementById('completed-container');
        let compHtml = `<h3>${getTranslation('completed_orders')}</h3>`;
        if (completedShipments.length === 0) {
            compHtml += `<p>${getTranslation('no_completed_orders')}</p>`;
        } else {
            completedShipments.forEach(s => {
                const isWarehouseHandoff = s.is_leg && s.drop.address;
                const dropTitle = isWarehouseHandoff ? `${getTranslation('warehouse_handoff')}: ${s.drop.address}` : getTranslation('customer_delivery');
                completedContainer.innerHTML += `
                    <div class="glass-card" style="margin-bottom:15px; border-left: 4px solid var(--success); opacity: 0.8;">
                        <h4 style="margin-bottom:5px; color:var(--success);">✅ ${s.description}</h4>
                        <p style="margin-bottom:5px; font-size: 0.9rem; color:var(--text-muted);"><b>ID:</b> ${s.id}</p>
                        <p style="margin-bottom:5px; font-size: 0.9rem;"><b>${getTranslation('type_label')}:</b> ${dropTitle}</p>
                        <p style="margin-bottom:5px; font-size: 0.9rem;"><b>${getTranslation('otp_used')}:</b> ${s.delivery_otp || 'N/A'}</p>
                    </div>
                `;
            });
        }
        
        if (activeShipments.length === 0) {
            container.innerHTML = `<div class="glass-card"><p>${getTranslation('no_active_shipments')}</p></div>`;
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
            let html = `<h3>${getTranslation('multi_stop_roadmap')} (${orderedStops.length} ${getTranslation('stops_label') || 'Stops'})</h3><div class="timeline">`;
            
            orderedStops.forEach((stop, idx) => {
                const isCurrent = idx === 0;
                const dotColor = stop.type === 'pickup' ? '#f6ad55' : '#48bb78';
                const actionText = stop.type === 'pickup' ? `📦 ${getTranslation('pickup')}` : `📍 ${getTranslation('drop')}`;
                const s = stop.shipment;
                
                let actionBtn = '';
                const isLocked = idx > 0;
                
                if (isCurrent) {
                    const isWarehouseDelivery = s.is_leg || (s.at_warehouse_id && s.status === 'in_transit');
                    const isLastMile = !s.is_leg && s.status === 'in_transit';

                    if (stop.type === 'pickup') {
                        actionBtn = `
                            <button class="btn-primary" style="margin-top:10px; width:100%;" onclick="handleScan('${s.id}', 'pickup')">📸 ${getTranslation('scan_qr_pickup')}</button>
                        `;
                    } else if (isLastMile) {
                        actionBtn = `
                            <button class="btn-primary btn-success" style="margin-top:10px; width:100%;" onclick="completeDeliveryFlow('${s.id}')">🏁 ${getTranslation('deliver_to_customer')}</button>
                        `;
                    } else {
                        // Warehouse handoff
                        actionBtn = `
                            <button class="btn-primary" style="margin-top:10px; width:100%; background:var(--warning);" onclick="handleScan('${s.id}', 'warehouse')">🏢 ${getTranslation('scan_qr_warehouse')}</button>
                        `;
                    }
                } else {
                        actionBtn = `
                            <button class="btn-primary" disabled style="margin-top:10px; width:100%; background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.3); border:1px dashed rgba(255,255,255,0.1); cursor:not-allowed;">${getTranslation('locked_pending')}</button>
                        `;
                }
                
                html += `
                    <div class="timeline-node" style="${isLocked ? 'filter: grayscale(1) blur(2px); pointer-events: none;' : ''}">
                        <div class="timeline-dot" style="background:${dotColor}; opacity:${isLocked ? 0.3 : 1}"></div>
                        <div class="glass-card" style="${isCurrent ? 'border-left: 4px solid var(--accent);' : 'opacity: 0.4; filter: blur(3px);'}">
                            <h4 style="margin-bottom:5px; color:${dotColor}; opacity:${isLocked ? 0.5 : 1}">${actionText} ${isLocked ? `(${getTranslation('queued')})` : ''}</h4>
                            <p style="margin-bottom:5px; font-size: 0.9rem;"><b>${getTranslation('shipment_label')}:</b> ${s.description} (ID: ${s.id.slice(0,8)})</p>
                            
                            ${actionBtn}
                            
                            ${s.is_perishable ? `
                                <div style="background:rgba(0,242,254,0.1); padding:10px; border-radius:8px; border:1px solid var(--primary); margin:10px 0;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                                        <span style="font-size:0.75rem; color:var(--primary); font-weight:bold;">❄️ ${getTranslation('cold_chain_cargo')}</span>
                                        <span style="font-size:0.75rem; font-weight:bold; color:${(s.vitality||100) < 60 ? 'var(--danger)' : 'var(--success)'}">${(s.vitality||100).toFixed(0)}% ${getTranslation('vitality')}</span>
                                    </div>
                                    <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                                        <div style="width:${s.vitality||100}%; height:100%; background:${(s.vitality||100) < 60 ? 'var(--danger)' : 'var(--primary)'};"></div>
                                    </div>
                                    <p style="font-size:0.7rem; color:var(--text-muted); margin-top:5px;">${getTranslation('perishable_ai_warning')}</p>
                                </div>
                            ` : ''}

                            <p style="margin-bottom:5px; font-size: 0.85rem; color:var(--warning);"><b>⏳ ${getTranslation('deadline_label')}:</b> ${formatDate(stop.type === 'pickup' ? s.pickup_deadline : s.expected_delivery)}</p>
                            <p style="margin-bottom:5px; font-size: 0.9rem;"><b>${getTranslation('location_label')}:</b> ${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}</p>
                            
                            ${s.is_leg ? `
                                <div style="margin:10px 0; padding:12px; border-radius:8px; background:rgba(245, 158, 11, 0.1); border:1px solid var(--warning); border-left: 4px solid var(--warning);">
                                    <p style="margin:0; font-size:0.75rem; color:var(--warning); font-weight:bold; text-transform:uppercase; letter-spacing:1px;">${getTranslation('rendezvous_protocol')}</p>
                                    <p style="margin:5px 0 0 0; font-size:1.1rem; font-weight:bold; color:white;">${getTranslation('meet_at')} ${stop.type === 'pickup' ? getTranslation('outbound_hub') : getTranslation('receiving_hub')}</p>
                                    <p style="margin:2px 0 0 0; font-size:0.9rem; color:var(--text-muted);">${getTranslation('handoff_coord_desc')}</p>
                                    
                                    ${isCurrent && stop.type === 'pickup' ? `
                                        <div style="display:flex; gap:10px; margin-top:12px;">
                                            ${s.has_refuel_req ? `
                                                <button class="btn-primary" disabled style="flex:1; background:rgba(255,255,255,0.05); color:var(--text-muted); border:1px dashed var(--border); font-size:0.75rem; cursor:default;">✅ ${getTranslation('refuel_requested')}</button>
                                            ` : `
                                                <button class="btn-primary" style="flex:1; background:rgba(245, 158, 11, 0.2); color:var(--warning); border:1px solid var(--warning); font-size:0.75rem;" id="refuel-btn-${s.id}" onclick="triggerFundRequest('${s.id}', 'refuel')">⛽ ${getTranslation('refuel')}</button>
                                            `}
                                            
                                            ${s.has_toll_req ? `
                                                <button class="btn-primary" disabled style="flex:1; background:rgba(255,255,255,0.05); color:var(--text-muted); border:1px dashed var(--border); font-size:0.75rem; cursor:default;">✅ ${getTranslation('toll_requested')}</button>
                                            ` : `
                                                <button class="btn-primary" style="flex:1; background:rgba(79, 140, 255, 0.2); color:var(--primary); border:1px solid var(--primary); font-size:0.75rem;" id="toll-btn-${s.id}" onclick="triggerFundRequest('${s.id}', 'toll')">🛣️ ${getTranslation('toll')}</button>
                                            `}
                                        </div>
                                    ` : ''}
                                </div>
                            ` : ''}

                            ${s.performance_stats ? `
                                <div style="margin:8px 0; padding:8px; border-radius:6px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);">
                                    <div style="display:flex; justify-content:space-between; align-items:center;">
                                        <span style="font-size:0.75rem; color:var(--text-muted);">${getTranslation('journey_status_label')}</span>
                                        <span class="badge" style="background:${s.performance_stats.status === 'delayed' ? 'var(--danger)' : (s.performance_stats.status === 'early' ? 'var(--success)' : 'var(--primary)')}; font-size:0.7rem;">
                                            ${s.performance_stats.status.toUpperCase()} (${s.performance_stats.diff_mins}m)
                                        </span>
                                    </div>
                                    <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px;">
                                         ${s.performance_stats.dist_remaining_km}km ${getTranslation('left_label')} | ${getTranslation('weather_label')}: ${s.performance_stats.weather}
                                    </div>
                                </div>
                            ` : ''}
                            
                            ${(stop.type === 'drop' && s.receiver_name) ? `
                                <div style="margin:10px 0; padding:12px; border-radius:8px; background:rgba(72, 187, 120, 0.1); border:1px solid var(--success); border-left: 4px solid var(--success);">
                                    <p style="margin:0; font-size:0.75rem; color:var(--success); font-weight:bold; text-transform:uppercase; letter-spacing:1px;">${getTranslation('recipient_details_label')}</p>
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
                const theme = localStorage.getItem('theme') || 'dark';
                const tileUrl = theme === 'dark' 
                    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
                L.tileLayer(tileUrl, { attribution: '&copy; CARTO' }).addTo(map);
                applyOfficialBorders(map);
                
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
            container.innerHTML = `<div class="glass-card"><p>${getTranslation('awaiting_verification')}</p></div>`;
            document.getElementById('route-map').style.display = 'none';
            document.getElementById('fullscreen-btn').style.display = 'none';
        } else {
            container.innerHTML = `<div class="glass-card"><p>${getTranslation('no_stops_to_route')}</p></div>`;
            document.getElementById('route-map').style.display = 'none';
        }
        
        // Fetch and show dynamic alerts/messages
        loadAlertsAndMessages();
        
    } catch(e) {
        console.error("[Bootstrap] loadMissions Failed:", e);
        showError(`${getTranslation('failed_load_dashboard')}: ${e.message}`);
    }
}

document.getElementById('verify-form-main')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('plate-image-main').files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    const btn = document.getElementById('verify-btn-main');
    btn.innerText = getTranslation('scanning_plate');
    btn.disabled = true;
    
    try {
        console.log(`[Verification] Uploading to ${API_BASE}/driver/${dId}/verify...`);
        const res = await fetch(`${API_BASE}/driver/${dId}/verify`, {
            method: 'POST',
            body: formData
        });
        
        if (!res.ok) {
            const errData = await res.json().catch(() => ({detail: "Server Error"}));
            throw new Error(errData.detail || getTranslation('verification_failed'));
        }
        
        const data = await res.json();
        console.log("[Verification] Success:", data);
        
        if (data.status === "verified") {
            alert(getTranslation('verification_success') + "\n" + (data.ml_result.message || ""));
        } else {
            alert(getTranslation('verification_pending') + "\n" + (data.ml_result.message || getTranslation('manual_review_required')));
        }
        loadMissions();
    } catch (err) {
        console.error("[Verification] Error:", err);
        alert("❌ " + getTranslation('verification_error') + ": " + err.message);
        btn.innerText = getTranslation('upload_verify');
        btn.disabled = false;
    }
});

// Removed old startJourney as map init is now auto-triggered in loadMissions

async function updateLocation(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    
    if (!marker) {
        marker = L.marker([lat, lng], {icon: getVehicleIcon(0), draggable: isSimulationMode}).addTo(map);
        attachSimulationDrag(marker);
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
    console.warn(getTranslation('gps_failed_msg'));
    
    if (!map) return;
    
    showNotification(getTranslation('map_click_enabled'), "success");
    
    map.on('click', async function(e) {
        if (isHalted) {
            showNotification(getTranslation('vehicle_halted'), "error");
            return;
        }
        
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        if (!marker) {
            marker = L.marker([lat, lng], {icon: getVehicleIcon(0), draggable: isSimulationMode}).addTo(map);
            attachSimulationDrag(marker);
        } else {
            const prev = marker.getLatLng();
            const bearing = Math.atan2(lng - prev.lng, lat - prev.lat) * 180 / Math.PI;
            if (Math.abs(bearing - lastBearing) > 5) {
                lastBearing = bearing;
                marker.setIcon(getVehicleIcon(bearing));
            }
            marker.setLatLng([lat, lng]);
        }
        
        if (!hasSetInitialView) {
            map.setView([lat, lng], 15);
            hasSetInitialView = true;
        }
        
        try {
            await apiCall(`/driver/${dId}/location`, 'POST', {lat, lng});
        } catch(e) {}
    });
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
        const icon = stop.type === 'pickup' ? ICON_PICKUP : ICON_DROP;
        const m = L.marker([stop.lat, stop.lng], {icon: icon}).addTo(map);
        
        let popupHtml = `<b>${stop.type === 'pickup' ? getTranslation('pickup') : getTranslation('drop')}</b><br>${stop.shipment.description}`;
        if (isCurrent) {
            if (stop.type === 'pickup') {
                 popupHtml += `<br><button style="margin-top:5px; background:var(--primary); color:white; border:none; padding:5px; border-radius:4px; cursor:pointer;" onclick="confirmPickup('${stop.shipment.id}')">${getTranslation('confirm_pickup')}</button>`;
            } else {
                 popupHtml += `<br><button style="margin-top:5px; background:var(--success); color:white; border:none; padding:5px; border-radius:4px; cursor:pointer;" onclick="confirmDelivery('${stop.shipment.id}', '${stop.shipment.delivery_otp}')">${getTranslation('confirm_drop_otp')}</button>`;
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


function showDynamicAlert(type, msg) {
    const banner = document.getElementById('instruction-banner');
    banner.innerText = msg;
    banner.style.display = 'block';
    if (type === 'weather') banner.style.background = 'linear-gradient(90deg, #3182ce, #2b6cb0)';
    if (type === 'fatigue') banner.style.background = 'linear-gradient(90deg, #e53e3e, #c53030)';
    if (type === 'traffic') banner.style.background = 'linear-gradient(90deg, #f6ad55, #ed8936)';
}


function showPopupAlert(msg) {
    const container = document.getElementById('alert-container');
    const alertDiv = document.createElement('div');
    alertDiv.className = 'glass-card alert-popup';
    alertDiv.style.borderLeft = '4px solid var(--danger)';
    alertDiv.style.marginBottom = '10px';
    alertDiv.innerHTML = `
        <h4 style="color:var(--danger); margin-bottom:5px;">⚠️ ${getTranslation('alert_label')}</h4>
        <p style="font-size:0.85rem">${msg}</p>
        <button class="btn-primary" style="margin-top:10px; padding: 5px;" onclick="this.parentElement.remove()">${getTranslation('acknowledge')}</button>
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
                banner.innerHTML = `❄️ <b>${getTranslation('cold_chain_active')}:</b> ${getTranslation('product_vitality')} <b>${v.toFixed(0)}%</b>. ${getTranslation('avoid_delays')}.`;
                banner.style.background = v < 60 ? 'linear-gradient(90deg, #e53e3e, #c53030)' : 'linear-gradient(90deg, #3182ce, #2b6cb0)';
                banner.style.display = 'block';
            } else {
                banner.style.display = 'none';
            }
        }
        
        // Fetch Messages
        const msgs = await apiCall(`/tracking/messages/${dId}?company_id=${localStorage.getItem('company_id')}`);
        
        if (msgs.length > lastMsgCount) {
            if (currentActiveTab !== 'chat') {
                const badge = document.getElementById('chat-badge');
                if (badge) {
                    badge.style.display = 'inline-block';
                    badge.style.background = 'var(--danger)';
                    badge.style.border = '1.5px solid var(--bg)';
                }
                const btn = document.getElementById('btn-tab-chat');
                if (btn) {
                    btn.style.fontWeight = '900';
                    btn.style.color = 'var(--text)';
                }
            } else {
                lastMsgCount = msgs.length;
                localStorage.setItem('last_seen_msg_count_driver', lastMsgCount);
            }
        }

        renderDriverMessages(msgs);
    } catch(e) {}
}

function renderDriverMessages(msgs) {
    const container = document.getElementById('driver-messages');
    if (!container) return;
    
    // Use the same beautiful bubble layout as the manager dashboard
    container.innerHTML = msgs.length === 0
        ? `<p style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:20px;">${getTranslation('no_conversation_history')}</p>`
        : msgs.map(m => {
            const isMe = m.sender_type === 'driver';
            let mediaHtml = '';
            if (m.media_type === 'image' && m.media_url) {
                mediaHtml = `<img src="${m.media_url}" style="max-width:100%;border-radius:10px;margin-top:6px;display:block;cursor:pointer;" onclick="window.open('${m.media_url}')" alt="photo">`;
            } else if (m.media_type === 'audio' && m.media_url) {
                mediaHtml = `<div class="audio-placeholder" data-src="${m.media_url}" data-accent="${isMe ? 'rgba(255,255,255,0.25)' : 'rgba(79,140,255,0.4)'}"></div>`;
            }
            return `
                <div style="display:flex; justify-content:${isMe ? 'flex-end' : 'flex-start'}; margin-bottom:14px; width:100%;">
                    <div style="max-width:80%; padding:12px 16px; border-radius:16px;
                                background:${isMe ? 'var(--primary)' : 'rgba(255,255,255,0.08)'};
                                color:${isMe ? '#fff' : 'var(--text)'};
                                border-bottom-${isMe ? 'right' : 'left'}-radius:2px;
                                border: 1px solid ${isMe ? 'transparent' : 'var(--border)'};
                                box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                        <div style="font-size:0.65rem; margin-bottom:4px; opacity:0.7; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">
                            ${isMe ? getTranslation('you') : getTranslation('operations_label')}
                        </div>
                        ${m.content && m.content !== '[Media]' ? `<div style="font-size:0.95rem; line-height:1.4;">${m.content}</div>` : ''}
                        ${mediaHtml}
                        <div style="font-size:0.6rem; margin-top:6px; text-align:right; opacity:0.6;">
                            ${new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    
    container.scrollTop = container.scrollHeight;
    container.querySelectorAll('.audio-placeholder').forEach(ph => {
        ph.replaceWith(buildAudioPlayer(ph.dataset.src, ph.dataset.accent));
    });
}

let driverChatMediaData = null;
let driverMediaRecorder = null;
let driverRecording = false;

async function sendMessageToManager() {
    const content = (document.getElementById('manager-msg-content').value || '').trim();
    if (!content && !driverChatMediaData) return;

    const dId = localStorage.getItem('driver_id');
    const shipments = await apiCall(`/driver/${dId}/shipments`);
    const activeShipment = shipments.find(s => s.status === 'in_transit' || s.status === 'assigned');

    try {
        const companyId = localStorage.getItem('company_id');
        await apiCall('/tracking/messages', 'POST', {
            shipment_id: activeShipment ? activeShipment.id : null,
            company_id: companyId,
            sender_id: dId,
            receiver_id: companyId,
            content: content || (driverChatMediaData ? '[Media]' : ''),
            sender_type: 'driver',
            media_url: driverChatMediaData ? driverChatMediaData.url : null,
            media_type: driverChatMediaData ? driverChatMediaData.type : null
        });
        document.getElementById('manager-msg-content').value = '';
        driverChatMediaData = null;
        const preview = document.getElementById('driver-media-preview');
        if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
        loadAlertsAndMessages();
    } catch(e) {
        alert(getTranslation('failed_send_message'));
    }
}

function driverChatPickPhoto() {
    document.getElementById('driver-photo-input').click();
}

function driverChatHandlePhoto(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        driverChatMediaData = { type: 'image', url: e.target.result };
        const preview = document.getElementById('driver-media-preview');
        preview.style.display = 'flex';
        preview.innerHTML = `<img src="${e.target.result}" style="height:52px;border-radius:8px;border:1px solid var(--border);"><span style="font-size:0.8rem;color:var(--muted);flex:1;">${getTranslation('photo_ready')}</span><button onclick="driverClearMedia()" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1.1rem;">✕</button>`;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function driverClearMedia() {
    driverChatMediaData = null;
    const preview = document.getElementById('driver-media-preview');
    if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
}

async function driverChatToggleRecording() {
    const btn = document.getElementById('driver-voice-btn');
    if (!driverRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const chunks = [];
            driverMediaRecorder = new MediaRecorder(stream);
            driverMediaRecorder.ondataavailable = e => chunks.push(e.data);
            driverMediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = (ev) => {
                    driverChatMediaData = { type: 'audio', url: ev.target.result };
                    const preview = document.getElementById('driver-media-preview');
                    preview.style.display = 'flex';
                    preview.innerHTML = `<button onclick="driverClearMedia()" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1.1rem;flex-shrink:0;">✕</button>`;
                    const player = buildAudioPlayer(ev.target.result, 'rgba(79,140,255,0.4)');
                    preview.insertBefore(player, preview.firstChild);
                };
                reader.readAsDataURL(blob);
                stream.getTracks().forEach(t => t.stop());
            };
            driverMediaRecorder.start();
            driverRecording = true;
            btn.innerText = '⏹️';
            btn.style.background = 'rgba(229,62,62,0.2)';
            btn.style.color = 'var(--danger)';
        } catch(e) {
            alert(getTranslation('mic_access_denied'));
        }
    } else {
        driverMediaRecorder.stop();
        driverRecording = false;
        btn.innerText = '🎙️';
        btn.style.background = 'rgba(255,255,255,0.08)';
        btn.style.color = 'var(--text)';
    }
}

// Polling for updates
setInterval(loadAlertsAndMessages, 5000);

async function loadProfileData() {
    const dId = localStorage.getItem('driver_id');
    const data = await apiCall(`/manager/drivers/${dId}/profile`);
    const p = data.profile;
    
    document.getElementById('p-name').innerText = p.name || getTranslation('driver_label');
    document.getElementById('p-login').innerText = `@${p.login_id || 'user'}`;
    document.getElementById('p-trips').innerText = p.total_trips || 0;
    document.getElementById('p-safety').innerText = `${(p.safety_index || 100).toFixed(1)}%`;
    document.getElementById('p-punct').innerText = `${(p.punctuality_rate || 100).toFixed(1)}%`;
    
    const avgRating = (p.customer_ratings && p.customer_ratings.length > 0) ? (p.customer_ratings.reduce((a,b)=>a+b,0)/p.customer_ratings.length).toFixed(1) : "5.0";
    document.getElementById('p-rating').innerText = `${avgRating} ⭐`;
    document.getElementById('p-wallet').innerText = `${p.reward_points || 0}`;
    
    // Calculate Platform Tenure in Days
    const joinDate = p.join_date ? new Date(p.join_date) : new Date();
    const today = new Date();
    const diffTime = Math.abs(today - joinDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    document.getElementById('p-experience').innerText = `${diffDays} ${getTranslation('days_label')}`;
    
    // Health Card Population
    const hStatus = document.getElementById('h-status');
    if (p.is_fit === false) {
        hStatus.innerText = getTranslation('status_unfit') || "UNFIT (AUDIT)";
        hStatus.style.background = "var(--danger)";
    } else if (p.health_metrics) {
        document.getElementById('h-rate').innerText = `${p.health_metrics.heart_rate} BPM`;
        document.getElementById('h-bp').innerText = p.health_metrics.blood_pressure;
        document.getElementById('h-o2').innerText = `${p.health_metrics.oxygen}%`;
        document.getElementById('h-stress').innerText = p.health_metrics.stress_index;
        
        if (p.health_metrics.stress_index > 80 || p.health_metrics.heart_rate > 120) {
            hStatus.innerText = getTranslation('rest_required');
            hStatus.style.background = "var(--danger)";
        } else {
            hStatus.innerText = getTranslation('fit_to_drive');
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

function openHealthModal() {
    document.getElementById('health-modal').style.display = 'block';
}

function closeHealthModal() {
    document.getElementById('health-modal').style.display = 'none';
}

document.getElementById('health-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const metrics = {
        heart_rate: document.getElementById('v-heart-rate').value,
        blood_pressure: document.getElementById('v-bp').value,
        oxygen: document.getElementById('v-oxygen').value,
        stress_index: document.getElementById('v-stress').value
    };
    
    try {
        await apiCall(`/driver/${localStorage.getItem('driver_id')}/health`, 'POST', metrics);
        alert(getTranslation('vitals_updated_success'));
        closeHealthModal();
        loadProfileData();
    } catch (e) {
        alert(getTranslation('failed_update_vitals'));
    }
});

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
        alert(getTranslation('upload_failed'));
    }
}

async function startRest() {
    const dId = localStorage.getItem('driver_id');
    if (confirm(getTranslation('rest_period_confirm'))) {
        await submitIncident('resting');
        alert(getTranslation('rest_period_logged'));
        loadProfileData();
    }
}

function logout() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    localStorage.clear();
    window.location.href = '../index.html';
}

window.onload = loadMissions;


function openIncidentModal() {
    document.getElementById('incident-modal').style.display = 'block';
}

async function submitIncident(type, fromStationary = false) {
    if (fromStationary) document.getElementById('stationary-modal').style.display = 'none';
    else document.getElementById('incident-modal').style.display = 'none';
    
    if (type === 'breakdown') {
        return reportBreakdown();
    }
    
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
            description: `${getTranslation('driver_reported')} ${type} ${getTranslation('issue_label')}.`,
            lat: lat,
            lng: lng
        });
        alert(`🚨 ${getTranslation('incident_reported')}: ${type.toUpperCase()}. ${getTranslation('manager_notified')}.`);
        loadMissions();
        loadProfileData();
    } catch(err) {
        alert(getTranslation('failed_report_incident'));
    }
}

async function requestSensorPermission() {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        // iOS 13+ requires explicit permission
        try {
            const permissionState = await DeviceMotionEvent.requestPermission();
            if (permissionState === 'granted') {
                window.addEventListener('devicemotion', handleMotion);
                document.getElementById('sensor-btn').innerText = `🛡️ ${getTranslation('safety_active')}`;
                document.getElementById('sensor-btn').style.background = "var(--success)";
                alert(getTranslation('sensors_calibrated'));
            }
        } catch (error) {
            console.error(error);
            alert(getTranslation('sensor_access_denied'));
        }
    } else {
        // Android / Desktop non-standard
        window.addEventListener('devicemotion', handleMotion);
        document.getElementById('sensor-btn').innerText = `🛡️ ${getTranslation('safety_active')}`;
        document.getElementById('sensor-btn').style.background = "var(--success)";
        alert(getTranslation('sensors_active'));
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
        
        document.getElementById('zen-rest-stop-name').innerText = `${getTranslation('nearest_label')}: ${bestStop.name} (${bestStop.rating}⭐)`;
        document.getElementById('zen-rest-stop-amenities').innerText = `${getTranslation('facilities')}: ${bestStop.amenities.join(", ")}`;
        
        // Notify Backend
        await apiCall(`/driver/${localStorage.getItem('driver_id')}/zen`, 'POST', {
            is_active: true,
            reason: reason,
            destination: bestStop
        });
        
        // Update mission roadmap temporarily (visual only for now)
        const banner = document.getElementById('instruction-banner');
        banner.innerHTML = `🧘 <b>${getTranslation('zen_mode_active')}:</b> ${getTranslation('safety_reroute_to')} ${bestStop.name}. ${getTranslation('take_a_break')}.`;
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
    alert(getTranslation('rest_logged_fatigue_reduced'));
    await submitIncident('resting');
    deactivateZen();
}

// Predictive Fatigue check
setInterval(async () => {
    const dId = localStorage.getItem('driver_id');
    const drivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('company_id')}`);
    const me = drivers.find(d => d.id === dId);
    if (me && me.fatigue_score > 90 && !isZenMode) {
        triggerZenMode("extreme_fatigue");
    }
}, 10000);



let html5QrScanner = null;
let currentVerifyId = null;
let qrVerified = false;
let qrFailCount = 0;

async function manualVerify(shipmentId, type) {
    if (!confirm(getTranslation('manual_override_confirm'))) return;
    try {
        await apiCall(`/driver/${dId}/verify-qr/${shipmentId}`, 'POST', { qr_data: "MANUAL_OVERRIDE" });
        closeVerifyModal();
        showNotification(getTranslation('manual_verification_success'), "success");
        qrFailCount = 0;
        loadMissions();
        if (type === 'delivery') proceedToLastMile(shipmentId);
    } catch(e) {
        alert(getTranslation('manual_verification_failed') + ": " + e.message);
    }
}

async function openVerifyModal(shipmentId, type = 'pickup') {
    currentVerifyId = shipmentId;
    qrVerified = false;
    qrFailCount = 0;
    document.getElementById('verify-modal').style.display = 'block';
    document.getElementById('qr-reader').style.display = 'block';
    document.getElementById('qr-success-msg').style.display = 'none';
    document.getElementById('btn-manual-verify').style.display = 'none';
    
    // Hide standard submit, we will handle it via callback
    document.getElementById('btn-submit-verify').style.display = 'none';
    
    // Fetch shipment to get qr_code_data
    const shipments = await apiCall(`/driver/${dId}/shipments`); 
    const s = shipments.find(item => item.id === shipmentId);
    if (!s) return;

    if (!html5QrScanner) {
        html5QrScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 });
    }
    
    html5QrScanner.render(async (decodedText) => {
        const expected = String(s.qr_code_data || s.id).trim().toLowerCase();
        const actual = String(decodedText).trim().toLowerCase();
        
        if (actual === expected || actual === String(s.id).trim().toLowerCase()) {
            qrVerified = true;
            document.getElementById('qr-success-msg').style.display = 'block';
            html5QrScanner.clear();
            
            // Auto-submit for Pickup/Warehouse
            if (type === 'pickup' || type === 'warehouse') {
                try {
                    await apiCall(`/driver/${dId}/verify-qr/${shipmentId}`, 'POST', { qr_data: decodedText });
                    closeVerifyModal();
                    showNotification(type === 'pickup' ? getTranslation('pickup_success') : getTranslation('warehouse_handoff_recorded'), "success");
                    loadMissions();
                } catch(e) {
                    alert(getTranslation('verification_failed') + ": " + e.message);
                }
            } else if (type === 'delivery') {
                // Return to delivery flow
                closeVerifyModal();
                proceedToLastMile(shipmentId);
            }
        } else {
            qrFailCount++;
            showNotification(`${getTranslation('qr_mismatch')} (${qrFailCount}/3)`, "error");
            
            if (qrFailCount >= 3) {
                html5QrScanner.clear();
                document.getElementById('qr-reader').style.display = 'none';
                const msg = document.getElementById('qr-success-msg');
                msg.style.display = 'block';
                msg.style.background = 'rgba(236,201,75,0.1)';
                msg.style.borderColor = 'var(--warning)';
                msg.innerHTML = `
                    <p style="color:var(--warning); font-weight:bold; margin:0;">🚨 ${getTranslation('qr_verification_failed')}</p>
                    <p style="color:var(--text); font-size:0.8rem; margin-top:5px;">${getTranslation('qr_manual_contact_manager')}</p>
                `;
            }
            
            // Highlight mismatch in modal
            const reader = document.getElementById('qr-reader');
            reader.style.borderColor = 'var(--danger)';
            setTimeout(() => { reader.style.borderColor = 'var(--primary)'; }, 2000);
        }
    }, (err) => {});
}

async function handleScan(shipmentId, type) {
    openVerifyModal(shipmentId, type);
}

async function completeDeliveryFlow(shipmentId) {
    // Step 1: Scan QR
    handleScan(shipmentId, 'delivery');
}

async function proceedToLastMile(shipmentId) {
    // Step 2: OTP
    const otp = prompt(getTranslation('enter_delivery_otp'));
    if (!otp) return;

    // Step 3: Photo
    alert(getTranslation('capture_photo_at_location'));
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showNotification(getTranslation('completing_delivery'), "info");
        
        try {
            // Upload photo first
            const formData = new FormData();
            formData.append('file', file);
            const uploadRes = await fetch(`${API_BASE}/driver/${dId}/upload-evidence`, {
                method: 'POST',
                body: formData
            });
            const uploadData = await uploadRes.json();
            const photoUrl = uploadData.image_url || uploadData.url;

            // Complete delivery
            await apiCall(`/driver/${dId}/complete-delivery/${shipmentId}?otp=${otp}&image_url=${encodeURIComponent(photoUrl)}`, 'POST');
            showNotification(getTranslation('delivery_successful'), "success");
            loadMissions();
            loadWallet();
        } catch(e) {
            alert(getTranslation('error_label') + ": " + e.message + ". " + getTranslation('check_payment_status'));
        }
    };
    input.click();
}

function closeVerifyModal() {
    if (html5QrScanner) html5QrScanner.clear();
    document.getElementById('verify-modal').style.display = 'none';
    document.getElementById('btn-manual-verify').style.display = 'none';
    qrFailCount = 0;
}


async function uploadFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}

async function applyOfficialBorders(mapInstance) {
    const boundaryUrl = 'https://raw.githubusercontent.com/datameet/maps/master/Country/india-osm.geojson';
    try {
        const response = await fetch(boundaryUrl);
        const data = await response.json();
        L.geoJSON(data, {
            style: { color: '#3182ce', weight: 3, fillOpacity: 0, dashArray: '5, 5' },
            interactive: false
        }).addTo(mapInstance);
    } catch(e) {
        console.warn("Sovereignty overlay failed to load");
    }
}

async function initDriverDashboard() {
    const overlay = document.getElementById('location-lock-overlay');
    const btn = overlay ? overlay.querySelector('button') : null;
    const originalText = btn ? btn.innerText : '';

    if (!navigator.geolocation) {
        showNotification("Geolocation is not supported by your browser.", "error");
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerText = getTranslation('location_checking') || "Checking...";
    }

    try {
        const pos = await new Promise((res, rej) => {
            navigator.geolocation.getCurrentPosition(res, rej, {
                enableHighAccuracy: true, 
                timeout: 8000,
                maximumAge: 0
            });
        });
        
        if (overlay) overlay.style.display = 'none';
        document.querySelector('.driver-layout').style.filter = 'none';
        document.querySelector('.driver-layout').style.pointerEvents = 'auto';
        
        loadMissions();
    } catch (err) {
        console.error("Location Error:", err);
        let msgKey = 'location_error_unknown';
        if (err.code === 1) msgKey = 'location_error_denied';
        else if (err.code === 2) msgKey = 'location_error_unavailable';
        else if (err.code === 3) msgKey = 'location_error_timeout';
        
        const msg = getTranslation(msgKey);
        showNotification(msg, "error");

        if (overlay) overlay.style.display = 'flex';
        document.querySelector('.driver-layout').style.filter = 'blur(15px)';
        document.querySelector('.driver-layout').style.pointerEvents = 'none';
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = originalText || getTranslation('btn_enable_location');
        }
    }
}

window.retryLocation = function() {
    initDriverDashboard();
};

initDriverDashboard();

async function loadWallet() {
    try {
        const driverId = localStorage.getItem('driver_id');
        const stats = await apiCall(`/driver/wallet/${driverId}`);
        
        document.getElementById('w-balance').innerText = `₹ ${stats.balance.toLocaleString()}`;
        document.getElementById('w-today').innerText = `₹ ${stats.today_earning.toLocaleString()}`;
        document.getElementById('w-bonus').innerText = `₹ ${stats.total_bonuses.toLocaleString()}`;
        
        const tList = document.getElementById('wallet-transactions');
        tList.innerHTML = '';
        stats.transactions.forEach(t => {
            const div = document.createElement('div');
            div.className = 'glass-card';
            div.style.padding = '12px';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.background = 'rgba(255,255,255,0.03)';
            
            div.innerHTML = `
                <div>
                    <div style="font-weight:bold; font-size:0.9rem;">${t.desc}</div>
                    <small style="color:var(--text-muted)">${new Date(t.timestamp).toLocaleString()}</small>
                </div>
                <div style="text-align:right;">
                    <div style="color:${t.amount > 0 ? 'var(--success)' : 'var(--danger)'}; font-weight:bold;">${t.amount > 0 ? '+' : ''}₹${t.amount}</div>
                    <small style="color:var(--text-muted)">${t.type}</small>
                </div>
            `;
            tList.appendChild(div);
        });
    } catch (e) {
        console.error("Wallet Error:", e);
    }
}

async function withdrawMoney() {
    alert(getTranslation('withdrawal_initiated'));
}

window.calculateSuggestedFuel = async function(e) {
    if (e && e.preventDefault) e.preventDefault();
    const btn = e ? (e.currentTarget || e.target || e) : null;
    if (!btn || !btn.innerText) return;
    
    const originalText = btn.innerText;
    btn.innerText = '⌛';
    btn.disabled = true;

    try {
        const lat = lastLat || 28.6139;
        const lng = lastLng || 77.2090;
        
        const data = await apiCall(`/driver/${dId}/calculate-fuel?lat=${lat}&lng=${lng}`, 'GET');
        document.getElementById('fund-req-amount').value = Math.round(data.suggested_amount);
        document.getElementById('fund-req-type').value = 'FUEL';
        showNotification(`${getTranslation('fuel_oracle')}: ₹${data.price_per_liter}/L ${getTranslation('in_label')} ${data.state}. ${getTranslation('suggested_amount')}: ₹${Math.round(data.suggested_amount)}`, 'success');
    } catch (e) {
        showNotification(getTranslation('fuel_oracle_unavailable'), "error");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

window.loadContracts = async function() {
    const container = document.getElementById('contracts-list');
    container.innerHTML = `<p style="text-align:center;">${getTranslation('analyzing_escrow')}</p>`;
    
    try {
        const shipments = await apiCall(`/driver/${dId}/shipments`, 'GET');
        const stats = await apiCall(`/driver/${dId}/dashboard/stats`, 'GET');
        
        const totalPointsEl = document.getElementById('contract-points-total');
        if (totalPointsEl) totalPointsEl.innerText = `${stats.total_points || 0} pts`;
        
        if (!shipments || shipments.length === 0) {
            container.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:20px;">${getTranslation('no_contracts_found')}</p>`;
            return;
        }
        
        container.innerHTML = shipments.map(s => {
            const isPaid = s.payment_status === 'paid';
            const statusColor = isPaid ? 'var(--success)' : 'var(--warning)';
            const pointsValue = s.is_perishable ? 75 : 50;
            
            return `
                <div class="glass-card" style="padding:20px; border-left:4px solid ${statusColor};">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                        <div>
                            <h4 style="margin:0;" id="det-id">${getTranslation('order_hash')} #${s.id.substring(0,8)}</h4>
                            <small style="color:var(--text-muted)">${getTranslation('type_label')}: ${s.description || getTranslation('general_cargo')}</small>
                        </div>
                        <div style="text-align:right;">
                            <span class="badge" style="background:${statusColor}22; color:${statusColor}; font-size:0.7rem;">${isPaid ? getTranslation('escrow_released') : getTranslation('escrow_locked')}</span>
                        </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px; font-size:0.85rem;">
                        <div style="color:var(--text-muted);">
                            💰 ${getTranslation('payout_label')}: <span style="color:var(--text); font-weight:bold;">₹${s.finance?.driver_payout || 0}</span>
                        </div>
                        <div style="color:var(--accent); font-weight:bold;">
                            🏆 +${pointsValue} ${getTranslation('reward_points')}
                        </div>
                    </div>
                    ${!isPaid ? `<p style="margin:10px 0 0 0; font-size:0.7rem; color:var(--warning);">⚠️ ${getTranslation('manager_verify_payment_notice')}</p>` : ''}
                </div>
            `;
        }).join('');
    } catch (e) {
        container.innerHTML = `<p style="text-align:center; color:var(--danger);">${getTranslation('failed_load_contracts')}</p>`;
    }
}

async function handleFundRequest() {
    const amt = document.getElementById('fund-req-amount').value;
    const type = document.getElementById('fund-req-type').value;
    if (!amt || amt <= 0) {
        showNotification(getTranslation('enter_valid_amount'), "error");
        return;
    }
    
    try {
        await apiCall(`/driver/${dId}/request-funds`, 'POST', {
            amount: parseFloat(amt), 
            type: type
        });
        showNotification(`${getTranslation('emergency_fund_sent')} ₹${amt} (${type})!`, 'success');
        document.getElementById('fund-req-amount').value = '';
    } catch (e) {
        showNotification(getTranslation('failed_send_request'), "error");
    }
}

async function completeDelivery(shipmentId) {
    const otp = prompt(getTranslation('enter_delivery_otp'));
    if (!otp) return;
    
    // We also need to upload a photo proof
    const confirmPhoto = confirm(getTranslation('confirm_photo_upload'));
    if (!confirmPhoto) return;
    
    try {
        const dummyPhoto = `https://api.dicebear.com/7.x/identicon/svg?seed=${shipmentId}_proof`;
        const res = await apiCall(`/driver/${dId}/complete-delivery/${shipmentId}?otp=${otp}&image_url=${encodeURIComponent(dummyPhoto)}`, 'POST');
        showNotification(res.message, 'success');
        loadMissions();
        loadWallet();
    } catch(e) {
        showNotification(getTranslation('error_label') + ": " + (e.message || getTranslation('invalid_otp_or_pending')), "error");
    }
}

window.addEventListener('themeChanged', (e) => {
    if (!map) return;
    const theme = e.detail.mode;
    const tileUrl = theme === 'dark' 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    
    map.eachLayer(layer => {
        if (layer instanceof L.TileLayer) {
            map.removeLayer(layer);
        }
    });
    L.tileLayer(tileUrl, { attribution: '&copy; CARTO' }).addTo(map);
});


async function triggerFundRequest(shipmentId, type) {
    const driverId = localStorage.getItem('driver_id');
    let amount = 0;
    
    if (type === 'toll') {
        const val = prompt(getTranslation('enter_toll_amount'));
        if (!val || isNaN(val)) return;
        amount = parseFloat(val);
    }

    try {
        const btn = document.getElementById(`${type}-btn-${shipmentId}`);
        
        // Show high-visibility overlay
        const actionLabel = type === 'refuel' ? getTranslation('refuelling_in_progress') : getTranslation('toll_payment_processing');
        showStatusOverlay(actionLabel);

        if (btn) {
            btn.disabled = true;
            btn.innerText = getTranslation('requested');
        }
        
        const res = await apiCall(`/driver/${driverId}/fund-request/${shipmentId}`, 'POST', { type, amount });
        alert(res.message);
        
        // Disable button visually
        if (btn) {
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
            btn.innerText = type === 'refuel' ? `✅ ${getTranslation('refuel_req_sent')}` : `✅ ${getTranslation('toll_req_sent')}`;
        }
    } catch (e) {
        alert(getTranslation('failed_submit_request') + ": " + (e.message || "Error"));
        const btn = document.getElementById(`${type}-btn-${shipmentId}`);
        if (btn) {
            btn.disabled = false;
        }
    }
}

// Duty & Watch Logic
let watchSyncActive = false;
let watchSyncInterval = null;

async function toggleDuty() {
    const btn = document.getElementById('duty-toggle-btn');
    const isOnDuty = btn.innerText.includes('ON DUTY');
    const newStatus = !isOnDuty;

    try {
        const res = await apiCall(`/driver/${dId}/toggle-duty`, 'POST', { is_on_duty: newStatus });
        btn.innerText = newStatus ? '🟢 ON DUTY' : '🔴 NOT WORKING';
        btn.style.background = newStatus ? 'var(--success)' : 'var(--danger)';
        showNotification(res.message, "success");
    } catch(e) {
        showNotification("Failed to update status", "error");
    }
}

function toggleWatchSync() {
    const btn = document.getElementById('watch-sync-btn');
    watchSyncActive = !watchSyncActive;

    if (watchSyncActive) {
        btn.innerText = '⌚ SYNCING...';
        btn.style.borderColor = 'var(--success)';
        btn.style.color = 'var(--success)';
        showNotification("Smartwatch Sync Enabled", "success");
        
        watchSyncInterval = setInterval(simulateWatchData, 5000);
    } else {
        btn.innerText = '⌚ SYNC WATCH';
        btn.style.borderColor = 'var(--accent)';
        btn.style.color = 'var(--text)';
        clearInterval(watchSyncInterval);
        showNotification("Smartwatch Sync Disabled", "warning");
    }
}

async function simulateWatchData() {
    // Simulate heart rate and oxygen
    const hr = Math.floor(Math.random() * (130 - 65 + 1)) + 65; // 65-130
    const o2 = Math.floor(Math.random() * (100 - 88 + 1)) + 88; // 88-100
    const bp = `${110 + Math.floor(Math.random()*20)}/${70 + Math.floor(Math.random()*15)}`;
    
    // Update UI
    document.getElementById('h-rate').innerText = hr + ' BPM';
    document.getElementById('h-o2').innerText = o2 + '%';
    document.getElementById('h-bp').innerText = bp;
    document.getElementById('h-sync').innerText = 'Just now (Watch)';

    // Abnormal Check
    if (hr > 125 || o2 < 92) {
        triggerHealthEmergency(hr, o2);
    } else {
        // Normal update to backend
        apiCall(`/driver/${dId}/update-vitals`, 'POST', {
            heart_rate: hr,
            blood_pressure: bp,
            oxygen_level: o2,
            stress_index: Math.floor(Math.random() * 40)
        }).catch(() => {});
    }
}

async function triggerHealthEmergency(hr, o2) {
    if (window.emergencyInProgress) return;
    window.emergencyInProgress = true;
    
    clearInterval(watchSyncInterval);
    alert(`🚨 HEALTH ALERT: Abnormal vitals detected (HR: ${hr}, SpO2: ${o2}%). Initiating Emergency Docking.`);
    
    try {
        const loc = marker ? marker.getLatLng() : {lat: 28.6139, lng: 77.2090};
        const res = await apiCall(`/driver/${dId}/health-emergency`, 'POST', { lat: loc.lat, lng: loc.lng });
        
        alert(`🚑 ROUTE UPDATED: Nearest warehouse found - ${res.warehouse_name}. Please proceed there immediately and dock the vehicle.`);
        
        // Force UI update
        location.reload();
    } catch(e) {
        showNotification("Emergency signal failed. Contact manager immediately!", "error");
    }
}
