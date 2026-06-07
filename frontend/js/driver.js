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

window.zoomImage = function(src) {
    if (!src || src === '#') return;
    
    let modal = document.getElementById('image-zoom-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'image-zoom-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 999999;
            opacity: 0;
            transition: opacity 0.25s ease;
            pointer-events: none;
            backdrop-filter: blur(10px);
        `;
        
        modal.innerHTML = `
            <div style="position: relative; max-width: 90%; max-height: 90%; display: flex; justify-content: center; align-items: center; box-shadow: 0 20px 50px rgba(0,0,0,0.5); border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                <img id="zoom-modal-img" src="" style="max-width: 100%; max-height: 80vh; object-fit: contain; display: block; border-radius: 12px;" />
                <button style="position: absolute; top: 15px; right: 15px; background: rgba(0,0,0,0.6); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 1.5rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s;" onclick="window.closeZoomModal()">✕</button>
            </div>
        `;
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal || e.target.tagName === 'BUTTON') {
                window.closeZoomModal();
            }
        });
        
        document.body.appendChild(modal);
    }
    
    const img = document.getElementById('zoom-modal-img');
    img.src = src;
    
    modal.style.pointerEvents = 'auto';
    modal.style.opacity = '1';
};

window.closeZoomModal = function() {
    const modal = document.getElementById('image-zoom-modal');
    if (modal) {
        modal.style.opacity = '0';
        modal.style.pointerEvents = 'none';
    }
};

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
let legendControl = null;
let hudControl = null;
let rerouteControlBtn = null;
let activeRoutePolylines = [];

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
    const tabToPage = {
        'dash': 'driver_tasks.html',
        'active': 'driver_live.html',
        'chat': 'driver_chat.html',
        'completed': 'driver_history.html',
        
        'wallet': 'driver_wallet.html',
        'profile': 'driver_account.html'
    };
    const currentFilename = window.location.pathname.split('/').pop();
    const expectedPage = tabToPage[tab];
    if (expectedPage && expectedPage !== currentFilename && (currentFilename.startsWith('driver_') || currentFilename === 'driver.html')) {
        window.location.href = expectedPage;
        return;
    }

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

        // Populate Driver Notifications Banner
        const notifContainer = document.getElementById('driver-notifications-container');
        if (notifContainer) {
            const unread = (stats.notifications || []).filter(n => !n.read);
            if (unread.length > 0) {
                notifContainer.style.display = 'block';
                notifContainer.innerHTML = unread.map(n => `
                    <div class="glass-card" style="padding: 1rem; border-left: 4px solid var(--warning); margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; background: rgba(245, 158, 11, 0.05); border-radius: 12px;">
                        <div style="font-size: 0.85rem; color: var(--text); text-align: left;">
                            <div style="font-weight: bold; color: var(--warning); margin-bottom: 4px;">⚠️ ${n.title || 'Notification'}</div>
                            <div>${n.message || ''}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">${n.timestamp ? new Date(n.timestamp).toLocaleString() : ''}</div>
                        </div>
                        <button class="btn-primary" onclick="markDriverNotifRead('${n.id}')" style="width: auto; padding: 6px 12px; font-size: 0.75rem; background: var(--warning); color: #000; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; margin-left: 15px;">
                            Mark Read
                        </button>
                    </div>
                `).join('');
            } else {
                notifContainer.style.display = 'none';
                notifContainer.innerHTML = '';
            }
        }

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

// Helper functions for Vitals check and overlays
const checkVitalsStatus = (me) => {
    if (!me.health_metrics || !me.last_health_check) {
        return { valid: false, reason: "Vitals Required: Please update your medical health vitals before going on duty." };
    }
    
    // Check 24 hour expiration
    try {
        const lastCheck = new Date(me.last_health_check);
        const now = new Date();
        const diffHrs = (now - lastCheck) / (1000 * 60 * 60);
        if (diffHrs > 24) {
            return { valid: false, reason: "Vitals Expired: Vitals must be updated every 24 hours. Please sync your smartwatch." };
        }
    } catch(e) {
        return { valid: false, reason: "Vitals Error: Please re-sync your smartwatch." };
    }
    
    const hm = me.health_metrics;
    const hr = hm.heart_rate || 72;
    const o2 = hm.oxygen || hm.oxygen_level || 98;
    const bp = hm.blood_pressure || "120/80";
    
    if (hr < 55 || hr > 110 || o2 < 92) {
        return { valid: false, reason: `Abnormal Vitals: Heart Rate (${hr} BPM) or SpO2 (${o2}%) is outside safe limits.` };
    }
    
    if (bp && bp.includes('/')) {
        try {
            const parts = bp.split('/');
            const syst = parseInt(parts[0]);
            const diast = parseInt(parts[1]);
            if (syst < 90 || syst > 140 || diast < 60 || diast > 95) {
                return { valid: false, reason: `Abnormal Vitals: Blood Pressure (${bp}) is outside safe limits.` };
            }
        } catch(e) {}
    }
    
    return { valid: true };
};

function initBlockingOverlays() {
    if (!document.getElementById('vitals-warning-overlay')) {
        const div = document.createElement('div');
        div.id = 'vitals-warning-overlay';
        div.style.cssText = 'display:none; position:fixed; inset:0; z-index:100000; background:rgba(10, 15, 28, 0.9); backdrop-filter:blur(15px); flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:30px; box-sizing:border-box;';
        div.innerHTML = `
            <div class="glass-card" style="max-width:400px; padding:30px; border:2px solid var(--danger); box-shadow:0 0 50px rgba(239,68,68,0.2); border-radius:20px; box-sizing:border-box;">
                <div style="font-size:4rem; margin-bottom:15px; filter:drop-shadow(0 0 10px var(--danger));">❤️</div>
                <h3 style="color:var(--danger); margin-bottom:12px; font-weight:800; margin-top:0;">Vitals Sync Required</h3>
                <p id="vitals-warning-text" style="color:var(--text-muted); margin-bottom:24px; font-size:0.95rem; line-height:1.5;"></p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button class="btn-primary" id="vitals-sync-btn-overlay" style="background:var(--accent); color:#000; font-weight:800; border:none; padding:12px; border-radius:10px; cursor:pointer; font-size:0.95rem;">⌚ Sync Smartwatch Vitals</button>
                    <button class="btn-primary" id="vitals-close-btn-overlay" style="background:transparent; border:1px solid rgba(255,255,255,0.2); color:white; padding:12px; border-radius:10px; cursor:pointer; font-size:0.95rem;">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(div);
        
        document.getElementById('vitals-sync-btn-overlay').addEventListener('click', () => {
            document.getElementById('vitals-warning-overlay').style.display = 'none';
            const syncBtn = document.getElementById('relocated-watch-sync-btn') || document.getElementById('watch-sync-btn');
            if (syncBtn) {
                if (!watchSyncActiveRelocated) {
                    toggleWatchSyncRelocated(syncBtn);
                }
            } else {
                toggleWatchSync();
            }
        });
        document.getElementById('vitals-close-btn-overlay').addEventListener('click', () => {
            document.getElementById('vitals-warning-overlay').style.display = 'none';
        });
    }

    if (!document.getElementById('vehicle-health-block-overlay')) {
        const div = document.createElement('div');
        div.id = 'vehicle-health-block-overlay';
        div.style.cssText = 'display:none; position:fixed; inset:0; z-index:99999; background:rgba(10, 15, 28, 0.92); backdrop-filter:blur(20px); flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:30px; box-sizing:border-box;';
        div.innerHTML = `
            <div class="glass-card" style="max-width:400px; padding:40px; border:2px solid var(--warning); box-shadow:0 0 50px rgba(245,158,11,0.25); border-radius:24px; box-sizing:border-box;">
                <div style="font-size:5rem; margin-bottom:20px; filter:drop-shadow(0 0 15px rgba(245,158,11,0.3));">🔧</div>
                <h2 style="color:var(--warning); margin-bottom:15px; font-weight:800; font-size:1.8rem; margin-top:0;">Vehicle Health 0%</h2>
                <p style="color:var(--text-muted); margin-bottom:30px; font-size:1.05rem; line-height:1.6;">Your vehicle is due for immediate maintenance. All actions are blocked until a vehicle checkup is approved by the manager.</p>
                <div id="checkup-status-container"></div>
            </div>
        `;
        document.body.appendChild(div);
    }

    if (!document.getElementById('rest-timer-overlay')) {
        const div = document.createElement('div');
        div.id = 'rest-timer-overlay';
        div.style.cssText = 'display:none; position:fixed; inset:0; z-index:99998; background:rgba(10, 15, 28, 0.95); backdrop-filter:blur(20px); flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:30px; box-sizing:border-box;';
        div.innerHTML = `
            <div class="glass-card" style="max-width:400px; padding:40px; border:2px solid var(--primary); box-shadow:0 0 50px rgba(79, 140, 255, 0.25); border-radius:24px; box-sizing:border-box;">
                <div class="zen-breathing" style="font-size:5rem; margin-bottom:20px;">🧘</div>
                <h2 style="color:var(--primary); margin-bottom:15px; font-weight:800; font-size:1.8rem; margin-top:0;">MANDATORY REST</h2>
                <p style="color:var(--text-muted); margin-bottom:20px; font-size:1.05rem; line-height:1.6;">You are currently in your mandatory 8-hour rest period. Please take this time to recuperate.</p>
                <div id="rest-countdown-timer" style="font-size:2.2rem; font-weight:bold; font-family:monospace; color:white; margin-bottom:30px;">08:00:00</div>
                <button class="btn-primary" id="fast-forward-rest-btn" style="background:var(--success); color:black; font-weight:800; border:none; padding:12px 24px; border-radius:10px; cursor:pointer; font-size:1rem; width:100%;">⚡ Fast-Forward Rest (Demo)</button>
            </div>
        `;
        document.body.appendChild(div);
        
        document.getElementById('fast-forward-rest-btn').addEventListener('click', async () => {
            try {
                const res = await apiCall(`/driver/${dId}/end-rest`, 'POST');
                showNotification(res.message, "success");
                document.getElementById('rest-timer-overlay').style.display = 'none';
                if (window.restTimerInterval) clearInterval(window.restTimerInterval);
                loadMissions();
            } catch(e) {
                showNotification("Failed to fast-forward rest period", "error");
            }
        });
    }

    if (!document.getElementById('geolocation-block-overlay')) {
        const div = document.createElement('div');
        div.id = 'geolocation-block-overlay';
        div.style.cssText = 'display:none; position:fixed; inset:0; z-index:100001; background:rgba(10, 15, 28, 0.97); backdrop-filter:blur(25px); flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:30px; box-sizing:border-box;';
        div.innerHTML = `
            <div class="glass-card" style="max-width:420px; padding:40px; border:2px solid var(--danger); box-shadow:0 0 80px rgba(239,68,68,0.3), inset 0 0 30px rgba(239,68,68,0.05); border-radius:24px; box-sizing:border-box;">
                <div style="font-size:5rem; margin-bottom:20px; filter:drop-shadow(0 0 20px rgba(239,68,68,0.5)); animation: pulse 2s infinite;">🚨</div>
                <h2 style="color:var(--danger); margin:0 0 12px 0; font-weight:900; font-size:1.6rem; letter-spacing:-0.5px;">Geolocation Access Required</h2>
                <p style="color:var(--text-muted); margin-bottom:8px; font-size:0.95rem; line-height:1.6;">LogistiX requires real-time GPS tracking to operate. Location access is <strong style='color:var(--danger);'>mandatory</strong> for all active drivers.</p>
                <p style="color:rgba(255,255,255,0.4); margin-bottom:24px; font-size:0.8rem; line-height:1.5;">Please enable location permissions in your browser settings and try again. Your position is tracked for route optimization, ETA calculation, and safety compliance.</p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button class="btn-primary" id="geo-retry-btn" style="background:linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%); color:#000; font-weight:800; border:none; padding:14px; border-radius:12px; cursor:pointer; font-size:1rem; box-shadow:0 4px 15px rgba(79,140,255,0.3);">📍 Retry Location Access</button>
                    <p style="color:rgba(255,255,255,0.3); font-size:0.7rem; margin:8px 0 0 0;">If using Chrome: Settings → Site Settings → Location → Allow</p>
                </div>
            </div>
        `;
        document.body.appendChild(div);

        document.getElementById('geo-retry-btn').addEventListener('click', () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        // Success — hide overlay and start watch
                        document.getElementById('geolocation-block-overlay').style.display = 'none';
                        showNotification('✅ Location access granted! GPS tracking active.', 'success');
                        watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {enableHighAccuracy: true});
                    },
                    (err) => {
                        showNotification('❌ Location access still denied. Please check browser settings.', 'error');
                    },
                    {enableHighAccuracy: true, timeout: 10000}
                );
            } else {
                showNotification('Geolocation is not supported by this browser.', 'error');
            }
        });
    }

    if (!document.getElementById('switch-toggle-styles')) {
        const style = document.createElement('style');
        style.id = 'switch-toggle-styles';
        style.textContent = `
            .switch {
              position: relative;
              display: inline-block;
              width: 48px;
              height: 24px;
            }
            .switch input {
              opacity: 0;
              width: 0;
              height: 0;
            }
            .slider {
              position: absolute;
              cursor: pointer;
              top: 0; left: 0; right: 0; bottom: 0;
              background-color: rgba(255,255,255,0.1);
              transition: .4s;
              border-radius: 24px;
              border: 1px solid var(--border);
            }
            .slider:before {
              position: absolute;
              content: "";
              height: 16px;
              width: 16px;
              left: 3px;
              bottom: 3px;
              background-color: white;
              transition: .4s;
              border-radius: 50%;
            }
            input:checked + .slider {
              background-color: var(--success);
              border-color: var(--success);
            }
            input:checked + .slider:before {
              transform: translateX(24px);
            }
            input:disabled + .slider {
              opacity: 0.5;
              cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    }
}

function showVitalsWarningOverlay(reason) {
    const overlay = document.getElementById('vitals-warning-overlay');
    const textEl = document.getElementById('vitals-warning-text');
    if (overlay && textEl) {
        textEl.innerText = reason;
        overlay.style.display = 'flex';
    }
}

function closeVitalsWarningOverlay() {
    const overlay = document.getElementById('vitals-warning-overlay');
    if (overlay) overlay.style.display = 'none';
}

function showRestOverlay(lastRestStartStr) {
    const overlay = document.getElementById('rest-timer-overlay');
    if (!overlay) return;
    
    overlay.style.display = 'flex';
    
    if (window.restTimerInterval) clearInterval(window.restTimerInterval);
    
    const updateTimer = () => {
        const restStart = new Date(lastRestStartStr);
        const now = new Date();
        const elapsedMs = now - restStart;
        const totalMs = 8 * 60 * 60 * 1000; 
        const remainingMs = totalMs - elapsedMs;
        
        if (remainingMs <= 0) {
            clearInterval(window.restTimerInterval);
            overlay.style.display = 'none';
            apiCall(`/driver/${dId}/end-rest`, 'POST').then(() => {
                showNotification("Mandatory rest period completed! Rerouting to destination.", "success");
                loadMissions();
            });
        } else {
            const hrs = Math.floor(remainingMs / (1000 * 60 * 60));
            const mins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
            const secs = Math.floor((remainingMs % (1000 * 60)) / 1000);
            
            const hrStr = String(hrs).padStart(2, '0');
            const minStr = String(mins).padStart(2, '0');
            const secStr = String(secs).padStart(2, '0');
            
            document.getElementById('rest-countdown-timer').innerText = `${hrStr}:${minStr}:${secStr}`;
        }
    };
    
    updateTimer();
    window.restTimerInterval = setInterval(updateTimer, 1000);
}

async function requestVehicleCheckup() {
    try {
        const res = await apiCall(`/driver/${dId}/request-checkup`, 'POST');
        showNotification(res.message, "success");
        loadMissions();
    } catch(e) {
        showNotification(e.message || "Failed to request checkup", "error");
    }
}

let watchSyncActiveRelocated = false;
let watchSyncIntervalRelocated = null;

function toggleWatchSyncRelocated(btn) {
    watchSyncActiveRelocated = !watchSyncActiveRelocated;

    if (watchSyncActiveRelocated) {
        btn.innerText = '⌚ SYNCING...';
        btn.style.borderColor = 'var(--success)';
        btn.style.color = 'var(--success)';
        showNotification("Smartwatch Sync Enabled", "success");
        
        watchSyncIntervalRelocated = setInterval(async () => {
            const hr = Math.floor(Math.random() * (130 - 65 + 1)) + 65; 
            const o2 = Math.floor(Math.random() * (100 - 88 + 1)) + 88; 
            const bp = `${110 + Math.floor(Math.random()*20)}/${70 + Math.floor(Math.random()*15)}`;
            
            if (document.getElementById('h-rate')) document.getElementById('h-rate').innerText = hr + ' BPM';
            if (document.getElementById('h-o2')) document.getElementById('h-o2').innerText = o2 + '%';
            if (document.getElementById('h-bp')) document.getElementById('h-bp').innerText = bp;
            if (document.getElementById('h-sync')) document.getElementById('h-sync').innerText = 'Just now (Watch)';
            
            const hrAbnormal = hr < 55 || hr > 110;
            const o2Abnormal = o2 < 92;
            let bpAbnormal = false;
            try {
                const parts = bp.split('/');
                const syst = parseInt(parts[0]);
                const diast = parseInt(parts[1]);
                if (syst < 90 || syst > 140 || diast < 60 || diast > 95) bpAbnormal = true;
            } catch(e) {}
            
            const abnormal = hrAbnormal || o2Abnormal || bpAbnormal;
            
            try {
                const res = await apiCall(`/driver/${dId}/update-vitals`, 'POST', {
                    heart_rate: hr,
                    blood_pressure: bp,
                    oxygen_level: o2
                });
                
                if (window.currentDriverObj) {
                    window.currentDriverObj.health_metrics = {
                        heart_rate: hr,
                        blood_pressure: bp,
                        oxygen: o2,
                        last_updated: new Date().toISOString()
                    };
                    window.currentDriverObj.last_health_check = new Date().toISOString();
                }
                
                if (abnormal) {
                    clearInterval(watchSyncIntervalRelocated);
                    btn.innerText = '⌚ SYNC WATCH';
                    btn.style.borderColor = 'var(--accent)';
                    btn.style.color = 'var(--text)';
                    watchSyncActiveRelocated = false;
                    
                    const dutySwitch = document.getElementById('duty-switch');
                    const statusText = document.getElementById('duty-status-text');
                    if (dutySwitch) {
                        dutySwitch.checked = false;
                        if (statusText) {
                            statusText.innerText = 'NOT WORKING';
                            statusText.style.color = 'var(--danger)';
                        }
                    }
                    if (window.currentDriverObj) window.currentDriverObj.is_on_duty = false;
                    
                    triggerHealthEmergency(hr, o2);
                }
            } catch(err) {
                console.error("Vitals update failed", err);
            }
        }, 5000);
    } else {
        btn.innerText = '⌚ SYNC WATCH';
        btn.style.borderColor = 'var(--accent)';
        btn.style.color = 'var(--text)';
        clearInterval(watchSyncIntervalRelocated);
        showNotification("Smartwatch Sync Disabled", "warning");
    }
}

let uiInitialized = false;
function replaceDutyAndWatchButtons(me, activeShipments) {
    if (uiInitialized) return;
    const dutyBtn = document.getElementById('duty-toggle-btn');
    const watchBtn = document.getElementById('watch-sync-btn');
    
    if (dutyBtn) {
        const parent = dutyBtn.parentNode;
        if (parent) {
            const hasActiveTrip = activeShipments && activeShipments.length > 0;
            const isOnDuty = me.is_on_duty !== false;
            
            parent.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding: 12px 16px; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:16px; box-sizing:border-box; margin-bottom:10px;">
                    <span style="font-weight:700; font-size:0.9rem; color:var(--text); display:flex; align-items:center; gap:8px;">
                        🚦 <span data-i18n="duty_status_label">Duty Status</span>: 
                        <span id="duty-status-text" style="color:${isOnDuty ? 'var(--success)' : 'var(--danger)'};">
                            ${isOnDuty ? 'ON DUTY' : 'NOT WORKING'}
                        </span>
                    </span>
                    <label class="switch">
                        <input type="checkbox" id="duty-switch" ${isOnDuty ? 'checked' : ''} ${hasActiveTrip ? 'disabled' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            `;
            
            const dutySwitch = document.getElementById('duty-switch');
            if (dutySwitch) {
                dutySwitch.addEventListener('change', async function() {
                    const newStatus = this.checked;
                    if (newStatus && checkVitalsStatus(me).valid === false) {
                        this.checked = false;
                        showVitalsWarningOverlay(checkVitalsStatus(me).reason);
                        return;
                    }
                    
                    try {
                        const res = await apiCall(`/driver/${dId}/toggle-duty`, 'POST', { is_on_duty: newStatus });
                        const statusText = document.getElementById('duty-status-text');
                        if (statusText) {
                            statusText.innerText = newStatus ? 'ON DUTY' : 'NOT WORKING';
                            statusText.style.color = newStatus ? 'var(--success)' : 'var(--danger)';
                        }
                        me.is_on_duty = newStatus;
                        showNotification(res.message, "success");
                    } catch(e) {
                        this.checked = !newStatus;
                        showNotification(e.message || "Failed to update status", "error");
                    }
                });
            }
        }
    }
    
    const hStatus = document.getElementById('h-status');
    if (hStatus) {
        let relocatedWatchBtn = document.getElementById('relocated-watch-sync-btn');
        if (!relocatedWatchBtn) {
            const medCard = hStatus.closest('.glass-card');
            if (medCard) {
                relocatedWatchBtn = document.createElement('button');
                relocatedWatchBtn.id = 'relocated-watch-sync-btn';
                relocatedWatchBtn.className = 'btn-primary';
                relocatedWatchBtn.style.cssText = 'width:100%; margin-top:12px; background:rgba(255,255,255,0.05); border:1px solid var(--accent); font-weight:800; border-radius:14px; padding:12px; box-sizing:border-box;';
                relocatedWatchBtn.innerHTML = '⌚ SYNC SMARTWATCH VITALS';
                
                relocatedWatchBtn.addEventListener('click', function() {
                    toggleWatchSyncRelocated(this);
                });
                
                medCard.appendChild(relocatedWatchBtn);
            }
        }
    }
    uiInitialized = true;
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
        window.currentDriverObj = me;
        
        const mainContent = document.getElementById('main-content');
        const vScreen = document.getElementById('verification-screen');
        const vUploadBox = document.getElementById('v-upload-box');
        const vPendingBox = document.getElementById('v-pending-box');
        const vNoVehicleBox = document.getElementById('v-no-vehicle-box');
        const vScreenMsg = document.getElementById('v-screen-msg');
        const reportBtn = document.getElementById('report-issue-btn');
        const secControls = document.getElementById('secondary-controls-bar');

        if (!me) {
            console.error("[Bootstrap] Driver profile not found in company list");
            if (mainContent) mainContent.style.display = 'none';
            if (secControls) secControls.style.display = 'none';
            if (vScreen) {
                vScreen.style.display = 'block';
                vNoVehicleBox.style.display = 'block';
                vUploadBox.style.display = 'none';
                vPendingBox.style.display = 'none';
            }
            return;
        }

        initBlockingOverlays();

        // 1. MANDATORY REST OVERLAY CHECK
        if (me.last_rest_start) {
            showRestOverlay(me.last_rest_start);
            if (mainContent) mainContent.style.display = 'none';
            if (secControls) secControls.style.display = 'none';
            if (reportBtn) reportBtn.style.display = 'none';
            return;
        } else {
            const restOverlay = document.getElementById('rest-timer-overlay');
            if (restOverlay) restOverlay.style.display = 'none';
            if (window.restTimerInterval) clearInterval(window.restTimerInterval);
        }

        // 2. Safety & Fitness Block
        const v_id = me.assigned_vehicle_id;
        const vehicles = await apiCall(`/manager/vehicles?company_id=${companyId}`);
        const myVehicle = v_id ? vehicles.find(v => v.id === v_id) : null;

        if (me.is_fit === false || (myVehicle && myVehicle.is_operational === false)) {
            if (mainContent) mainContent.style.display = 'none';
            if (secControls) secControls.style.display = 'none';
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
            if (reportBtn) reportBtn.style.display = 'none';
            return;
        }

        // 3. Vehicle Health 0% check (except during transit)
        const shipments = await apiCall(`/driver/${dId}/shipments`);
        const activeShipments = shipments.filter(s => s.status !== 'delivered' && s.status !== 'finalized');
        const inTransit = activeShipments.some(s => s.status === 'in_transit');

        if (myVehicle && (myVehicle.vehicle_health_score <= 0) && !inTransit) {
            const containerEl = document.getElementById('checkup-status-container');
            if (myVehicle.checkup_status === 'pending') {
                containerEl.innerHTML = `
                    <div style="font-size: 1.15rem; font-weight: bold; color: var(--warning); padding: 15px; background: rgba(245, 158, 11, 0.1); border: 1px solid var(--warning); border-radius: 12px; margin-bottom: 15px;">
                        ⏳ Checkup Request Pending Approval
                    </div>
                    <p style="color: var(--text-muted); font-size: 0.95rem; margin:0;">Please wait for warehouse or fleet manager approval.</p>
                `;
            } else {
                containerEl.innerHTML = `
                    <button onclick="requestVehicleCheckup()" class="btn-primary" style="background: var(--warning); color: black; font-weight: 800; border: none; padding: 14px 24px; border-radius: 12px; font-size: 1.1rem; cursor: pointer; width: 100%; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.2);">
                        🔧 Request Vehicle Checkup
                    </button>
                `;
            }
            document.getElementById('vehicle-health-block-overlay').style.display = 'flex';
            if (mainContent) mainContent.style.display = 'none';
            if (secControls) secControls.style.display = 'none';
            if (reportBtn) reportBtn.style.display = 'none';
            return;
        } else {
            const vOverlay = document.getElementById('vehicle-health-block-overlay');
            if (vOverlay) vOverlay.style.display = 'none';
        }

        // Dynamically replace the old duty and watch sync UI buttons
        replaceDutyAndWatchButtons(me, activeShipments);


        // 1. VEHICLE ASSIGNMENT CHECK
        if (!me.assigned_vehicle_id) {
            if (mainContent) mainContent.style.display = 'none';
            if (secControls) secControls.style.display = 'none';
            if (vScreen) {
                vScreen.style.display = 'block';
                vUploadBox.style.display = 'none';
                vPendingBox.style.display = 'none';
                vNoVehicleBox.style.display = 'block';
                
                vNoVehicleBox.innerHTML = `
                    <style>
                        @keyframes floatIcon {
                            0% { transform: translateY(0px) scale(1); }
                            50% { transform: translateY(-10px) scale(1.05); }
                            100% { transform: translateY(0px) scale(1); }
                        }
                        @keyframes glowWarning {
                            0% { box-shadow: 0 0 15px rgba(245, 158, 11, 0.1); }
                            50% { box-shadow: 0 0 30px rgba(245, 158, 11, 0.3); }
                            100% { box-shadow: 0 0 15px rgba(245, 158, 11, 0.1); }
                        }
                        .premium-warn-card {
                            background: rgba(15, 23, 42, 0.6);
                            backdrop-filter: blur(20px);
                            border: 1px solid rgba(245, 158, 11, 0.2);
                            border-radius: 24px;
                            padding: 40px 30px;
                            max-width: 450px;
                            margin: 20px auto;
                            animation: glowWarning 4s infinite ease-in-out;
                        }
                        .floating-truck {
                            font-size: 5rem;
                            margin-bottom: 25px;
                            display: inline-block;
                            animation: floatIcon 3s infinite ease-in-out;
                            filter: drop-shadow(0 0 15px rgba(245, 158, 11, 0.3));
                        }
                    </style>
                    <div class="premium-warn-card">
                        <div class="floating-truck">🚛</div>
                        <h2 style="color: var(--warning); font-size: 1.8rem; font-weight: 800; margin-bottom: 12px;">No Vehicle Assigned</h2>
                        <p style="color: var(--text-muted); font-size: 1rem; line-height: 1.6; margin-bottom: 30px;">
                            Your profile has not been assigned a vehicle yet. Please check back later once your manager links you to a vehicle.
                        </p>
                        <button class="btn-primary" onclick="loadMissions()" style="background: linear-gradient(135deg, var(--warning) 0%, var(--accent) 100%); color: #000; font-weight: 800; border: none; border-radius: 12px; padding: 12px 30px; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.3); cursor: pointer;">
                            🔄 Refresh Status
                        </button>
                    </div>
                `;
            }
            if (reportBtn) reportBtn.style.display = 'none';
            return;
        }

        // 2. SECURITY VERIFICATION CHECK
        const vStatus = me.verification_status || "unverified";
        const imgUrl = me.verification_image;
        const isBrokenRelative = imgUrl && 
            (imgUrl.startsWith('/images/') || imgUrl.startsWith('images/'));
        
        if (vStatus === "unverified" || (vStatus === "pending_manual" && (!imgUrl || isBrokenRelative))) {
            if (mainContent) mainContent.style.display = 'none';
            if (secControls) secControls.style.display = 'none';
            if (reportBtn) reportBtn.style.display = 'none';
            if (vScreen) {
                vScreen.style.display = 'block';
                vUploadBox.style.display = 'block';
                vPendingBox.style.display = 'none';
                vNoVehicleBox.style.display = 'none';
                
                if (vStatus === "pending_manual" && (!imgUrl || isBrokenRelative)) {
                    vScreenMsg.innerHTML = `<span style="color:var(--danger); font-weight:bold;">⚠️ Previous upload was incomplete or invalid (image unavailable). Please re-upload your vehicle's number plate.</span>`;
                } else if (me.verification_message) {
                    vScreenMsg.innerHTML = `<span style="color:var(--warning); font-weight:bold;">❌ Verification failed: ${me.verification_message}. Please try again.</span>`;
                } else {
                    vScreenMsg.innerText = getTranslation('v_verify_desc');
                }
            }
            return;
        } else if (vStatus === "pending_manual") {
            if (mainContent) mainContent.style.display = 'none';
            if (secControls) secControls.style.display = 'none';
            if (reportBtn) reportBtn.style.display = 'none';
            if (vScreen) {
                vScreen.style.display = 'block';
                vUploadBox.style.display = 'none';
                vPendingBox.style.display = 'block';
                vNoVehicleBox.style.display = 'none';
            }
            return;
        }

        // 3. Driver is verified!
        if (mainContent) mainContent.style.display = 'block';
        if (secControls) secControls.style.display = 'flex';
        if (vScreen) vScreen.style.display = 'none';
        if (reportBtn) reportBtn.style.display = 'block';
        
        loadDashStats();

        const completedShipments = shipments.filter(s => s.status === 'delivered' || s.status === 'finalized');
        const container = document.getElementById('mission-container');
        
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
            let html = '';
            if (me.fatigue_score >= 100) {
                html += `
                    <div style="background:linear-gradient(135deg, var(--danger), #c53030); color:white; padding:15px; border-radius:12px; margin-bottom:20px; font-weight:bold; box-shadow:0 10px 25px rgba(229,62,62,0.3); text-align:center;">
                        🚨 FATIGUE LIMIT EXCEEDED (100%): All normal actions are blocked. Please navigate to a resting spot on the map, click "Mark Rest Stop Reached & Start Rest", and begin your mandatory 8-hour rest.
                    </div>
                `;
            }
            html += `<h3>${getTranslation('multi_stop_roadmap')} (${orderedStops.length} ${getTranslation('stops_label') || 'Stops'})</h3><div class="timeline">`;
            
            orderedStops.forEach((stop, idx) => {
                const isCurrent = idx === 0;
                const dotColor = stop.type === 'pickup' ? '#f6ad55' : '#48bb78';
                const actionText = stop.type === 'pickup' ? `📦 ${getTranslation('pickup')}` : `📍 ${getTranslation('drop')}`;
                const s = stop.shipment;
                
                let actionBtn = '';
                const isLocked = idx > 0;
                
                if (isCurrent) {
                    if (me.fatigue_score >= 100) {
                        actionBtn = `
                            <button class="btn-primary" style="margin-top:10px; width:100%; background:var(--danger); font-weight:800; box-shadow:0 4px 15px rgba(239, 68, 68, 0.2);" onclick="startRest()">
                                🚨 Mark Rest Stop Reached & Start Rest
                            </button>
                        `;
                    } else {
                        const isWarehouseDelivery = s.is_leg && s.status === 'in_transit';
                        const isLastMile = !s.is_leg && s.status === 'in_transit';

                        if (stop.type === 'pickup') {
                            const isIntermediateLeg = s.is_leg && s.leg_order > 1;
                            if (isIntermediateLeg) {
                                actionBtn = `
                                    <button class="btn-primary" style="margin-top:10px; width:100%; background:var(--primary);" onclick="startTransit('${s.id}')">🚚 Start Transit</button>
                                `;
                            } else {
                                actionBtn = `
                                    <button class="btn-primary" style="margin-top:10px; width:100%;" onclick="verifyPickupPrompt('${s.id}')">📦 Verify Pickup Code</button>
                                `;
                            }
                        } else if (isLastMile) {
                            actionBtn = `
                                <button class="btn-primary btn-success" style="margin-top:10px; width:100%;" onclick="completeDeliveryFlow('${s.id}')">🏁 Deliver to Customer</button>
                            `;
                        } else if (isWarehouseDelivery) {
                            actionBtn = `
                                <button class="btn-primary" disabled style="margin-top:10px; width:100%; background:var(--muted); opacity:0.6; cursor:not-allowed;">🏢 Awaiting Hub Manager Check-In</button>
                            `;
                        }
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
                
                addMapControlsAndHUD();
                
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

function handleError(err) {
    console.warn('[GPS] Location error:', err);
    
    // Show the fullscreen blocking overlay
    const overlay = document.getElementById('geolocation-block-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
    
    // In simulation/demo mode, still allow click-based location as fallback
    if (isSimulationMode && map) {
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
}

window.addMapControlsAndHUD = function() {
    if (!map) return;
    
    // Remove if already existing
    if (legendControl) map.removeControl(legendControl);
    if (hudControl) map.removeControl(hudControl);
    if (rerouteControlBtn) map.removeControl(rerouteControlBtn);
    
    // Legend
    legendControl = L.control({position: 'bottomleft'});
    legendControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'info legend');
        div.style.background = 'rgba(15, 23, 42, 0.9)';
        div.style.padding = '10px';
        div.style.borderRadius = '8px';
        div.style.border = '1px solid var(--border)';
        div.style.color = '#fff';
        div.style.fontSize = '0.75rem';
        div.style.lineHeight = '1.5';
        div.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
        div.innerHTML = `
            <h4 style="margin:0 0 6px 0; font-size:0.8rem; font-weight:bold; color:var(--primary);">🚦 Traffic Density</h4>
            <div style="display:flex; align-items:center; gap:6px;"><span style="width:12px; height:4px; background:#ff4b4b; display:inline-block; border-radius:2px;"></span> High Congestion</div>
            <div style="display:flex; align-items:center; gap:6px;"><span style="width:12px; height:4px; background:#f6ad55; display:inline-block; border-radius:2px;"></span> Moderate Traffic</div>
            <div style="display:flex; align-items:center; gap:6px;"><span style="width:12px; height:4px; background:#3182ce; display:inline-block; border-radius:2px;"></span> Free Flowing</div>
        `;
        return div;
    };
    legendControl.addTo(map);
    
    // HUD
    hudControl = L.control({position: 'topright'});
    hudControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'hud-control');
        div.style.background = 'rgba(15, 23, 42, 0.95)';
        div.style.padding = '12px 16px';
        div.style.borderRadius = '12px';
        div.style.border = '1px solid var(--border)';
        div.style.color = '#fff';
        div.style.fontSize = '0.8rem';
        div.style.boxShadow = '0 10px 20px rgba(0,0,0,0.5)';
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.gap = '6px';
        div.style.minWidth = '160px';
        
        div.innerHTML = `
            <div style="font-size:0.65rem; color:var(--text-muted); font-weight:800; text-transform:uppercase;">🛰️ Live Telemetry HUD</div>
            <div><b>Speed:</b> <span id="hud-speed" style="color:var(--success); font-weight:bold;">45 km/h</span></div>
            <div><b>ETA Status:</b> <span id="hud-eta" style="color:var(--accent); font-weight:bold;">On Time</span></div>
            <div><b>Next Waypoint:</b> <span id="hud-waypoint" style="color:var(--primary); font-weight:600; font-size:0.75rem;">Loading...</span></div>
        `;
        return div;
    };
    hudControl.addTo(map);
    
    // Reroute Button
    rerouteControlBtn = L.control({position: 'topleft'});
    rerouteControlBtn.onAdd = function () {
        const btn = L.DomUtil.create('button', 'btn-primary ai-reroute-btn');
        btn.style.padding = '8px 12px';
        btn.style.background = 'linear-gradient(135deg, #4f8cff 0%, #a855f7 100%)';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '8px';
        btn.style.fontSize = '0.75rem';
        btn.style.fontWeight = 'bold';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 4px 10px rgba(168, 85, 247, 0.4)';
        btn.style.marginTop = '10px';
        btn.innerHTML = '🔄 AI Reroute / Recalculate';
        
        btn.onclick = function(e) {
            e.stopPropagation();
            simulateAIReroute();
        };
        return btn;
    };
    rerouteControlBtn.addTo(map);
};

window.simulateAIReroute = function() {
    showNotification("🧠 AI Engine analyzing alternative pathways for congestion avoidance...", "info");
    
    setTimeout(() => {
        // Change all route polylines to blue (free flowing!)
        activeRoutePolylines.forEach(p => {
            p.setStyle({color: '#3182ce'}); 
        });
        
        // Update HUD
        const speedEl = document.getElementById('hud-speed');
        const etaEl = document.getElementById('hud-eta');
        
        if (speedEl) {
            speedEl.innerText = "65 km/h";
            speedEl.style.color = "var(--success)";
        }
        if (etaEl) {
            etaEl.innerText = "Early (+21m)";
            etaEl.style.color = "var(--success)";
        }
        
        showNotification("✅ Avoided high-congestion bottleneck. Recalculated path saved 14 minutes!", "success");
    }, 1200);
};

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
            
            // Clear old polylines if any
            activeRoutePolylines.forEach(p => map.removeLayer(p));
            activeRoutePolylines = [];
            
            const chunkSize = Math.ceil(routeCoords.length / 5);
            for(let i=0; i<routeCoords.length; i+=chunkSize) {
                const chunk = routeCoords.slice(i, i+chunkSize+1);
                const rand = Math.random();
                let color = '#3182ce'; 
                if (rand > 0.9) color = '#ff4b4b'; 
                else if (rand > 0.7) color = '#f6ad55'; 
                
                const poly = L.polyline(chunk, {color: color, weight: 6, opacity: 0.85}).addTo(map);
                activeRoutePolylines.push(poly);
            }
            
            // Update HUD
            setTimeout(() => {
                const nextStop = stops[0];
                const waypointEl = document.getElementById('hud-waypoint');
                if (waypointEl && nextStop) {
                    waypointEl.innerText = nextStop.shipment.drop.address || nextStop.shipment.drop.name || "Hub Base";
                }
                
                const speedEl = document.getElementById('hud-speed');
                const etaEl = document.getElementById('hud-eta');
                
                if (speedEl) {
                    const randSpeed = Math.floor(Math.random() * 20) + 40; 
                    speedEl.innerText = `${randSpeed} km/h`;
                }
                
                if (etaEl && nextStop && nextStop.shipment) {
                    const s = nextStop.shipment;
                    if (s.performance_stats) {
                        const ps = s.performance_stats;
                        if (ps.status === 'delayed') {
                            etaEl.innerText = `Delayed (-${ps.diff_mins}m)`;
                            etaEl.style.color = 'var(--danger)';
                        } else {
                            etaEl.innerText = `Early (+${Math.abs(ps.diff_mins)}m)`;
                            etaEl.style.color = 'var(--success)';
                        }
                    } else {
                        etaEl.innerText = "On Time";
                        etaEl.style.color = 'var(--primary)';
                    }
                }
            }, 500);
        }
    } catch(err) {}

    if (window.currentDriverObj && window.currentDriverObj.fatigue_score >= 100) {
        try {
            const currentLoc = marker ? marker.getLatLng() : stops[0];
            const restStops = await apiCall(`/driver/safety/rest-stops?lat=${currentLoc.lat}&lng=${currentLoc.lng}`);
            restStops.forEach(stop => {
                const bedIcon = L.icon({
                    iconUrl: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
                    iconSize: [32, 32],
                    iconAnchor: [16, 32]
                });
                const m = L.marker([stop.lat, stop.lng], { icon: bedIcon }).addTo(map);
                m.bindPopup(`<b>🏨 Rest Spot: ${stop.name} (${stop.rating}⭐)</b><br>Facilities: ${stop.amenities.join(', ')}<br><button onclick="window.startRest({name: '${stop.name.replace(/'/g, "\\'")}', lat: ${stop.lat}, lng: ${stop.lng}})" style="margin-top:5px; background:var(--success); color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Start Rest Here</button>`);
            });
        } catch(e) {
            console.error("Failed to map rest stops", e);
        }
    }
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
                mediaHtml = `<img src="${m.media_url}" style="max-width:100%;border-radius:10px;margin-top:6px;display:block;cursor:pointer;" onclick="window.zoomImage('${m.media_url}')" alt="photo">`;
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
    
    let avgRating = 5.0;
    if (p.rating_count && p.rating_count > 0) {
        avgRating = p.total_rating_sum / p.rating_count;
    } else if (p.rating !== undefined) {
        avgRating = p.rating;
    }
    document.getElementById('p-rating').innerText = `${avgRating.toFixed(1)} ⭐`;
    document.getElementById('p-wallet').innerText = `${p.reward_points || 0}`;
    
    // Calculate Platform Tenure in Days & Hours Worked
    const joinDate = p.join_date ? new Date(p.join_date) : new Date();
    const today = new Date();
    const diffTime = Math.abs(today - joinDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const drivingHours = (p.driving_hours || 0).toFixed(1);
    document.getElementById('p-experience').innerText = `${diffDays} Days | ${drivingHours} Hours Worked`;
    
    // Health Card Population
    const hStatus = document.getElementById('h-status');
    if (p.is_fit === false) {
        hStatus.innerText = getTranslation('status_unfit') || "UNFIT (AUDIT)";
        hStatus.style.background = "var(--danger)";
    } else if (p.health_metrics) {
        document.getElementById('h-rate').innerText = `${p.health_metrics.heart_rate} BPM`;
        document.getElementById('h-bp').innerText = p.health_metrics.blood_pressure;
        document.getElementById('h-o2').innerText = `${p.health_metrics.oxygen}%`;
        
        const hr = p.health_metrics.heart_rate || 72;
        const o2 = p.health_metrics.oxygen || 98;
        let abnormal = hr < 55 || hr > 110 || o2 < 92;
        if (p.health_metrics.blood_pressure && p.health_metrics.blood_pressure.includes('/')) {
            try {
                const parts = p.health_metrics.blood_pressure.split('/');
                const syst = parseInt(parts[0]);
                const diast = parseInt(parts[1]);
                if (syst < 90 || syst > 140 || diast < 60 || diast > 95) abnormal = true;
            } catch(e) {}
        }
        
        if (abnormal) {
            hStatus.innerText = "ABNORMAL VITALS";
            hStatus.style.background = "var(--danger)";
        } else {
            hStatus.innerText = getTranslation('fit_to_drive') || "FIT TO DRIVE";
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
        oxygen: document.getElementById('v-oxygen').value
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

async function startRest(selectedStop = null) {
    const dId = localStorage.getItem('driver_id');
    
    // If fatigue is >= 100, they must be at a rest stop
    if (window.currentDriverObj && window.currentDriverObj.fatigue_score >= 100) {
        let currentLoc = null;
        if (marker) {
            const ll = marker.getLatLng();
            currentLoc = { lat: ll.lat, lng: ll.lng };
        } else if (lastLocation) {
            currentLoc = lastLocation;
        }
        
        if (!currentLoc) {
            alert("Unable to determine current location. Please ensure GPS or simulated location is active.");
            return;
        }
        
        // Define distance helper
        const getDistance = (lat1, lon1, lat2, lon2) => {
            const R = 6371e3; // meters
            const phi1 = lat1 * Math.PI/180;
            const phi2 = lat2 * Math.PI/180;
            const deltaPhi = (lat2-lat1) * Math.PI/180;
            const deltaLambda = (lon2-lon1) * Math.PI/180;

            const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
                      Math.cos(phi1) * Math.cos(phi2) *
                      Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return R * c;
        };
        
        let targetStop = selectedStop;
        if (!targetStop) {
            // Fetch nearby rest stops
            try {
                const stopsToCheck = await apiCall(`/driver/safety/rest-stops?lat=${currentLoc.lat}&lng=${currentLoc.lng}`);
                let minDistance = Infinity;
                stopsToCheck.forEach(stop => {
                    const dist = getDistance(currentLoc.lat, currentLoc.lng, stop.lat, stop.lng);
                    if (dist < minDistance) {
                        minDistance = dist;
                        targetStop = stop;
                    }
                });
                if (targetStop) {
                    targetStop.distance = minDistance;
                }
            } catch (e) {
                console.error("Failed to fetch rest stops during validation:", e);
            }
        } else {
            targetStop.distance = getDistance(currentLoc.lat, currentLoc.lng, targetStop.lat, targetStop.lng);
        }
        
        if (!targetStop || targetStop.distance > 300) {
            const distMsg = targetStop ? `You are currently ${Math.round(targetStop.distance)}m away from the nearest rest stop.` : '';
            alert(`⚠️ You must reach a resting spot on the map (green marker) before starting your rest. ${distMsg} Please navigate closer on the map.`);
            return;
        }
        
        if (!confirm(`You have reached ${targetStop.name || 'Rest Stop'}. Do you want to mark resting spot reached and start your mandatory 8-hour rest?`)) {
            return;
        }
    } else {
        if (!confirm(getTranslation('rest_period_confirm'))) {
            return;
        }
    }
    
    await submitIncident('resting');
    alert(getTranslation('rest_period_logged'));
    loadProfileData();
    loadMissions();
}

function logout() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    localStorage.clear();
    window.location.href = '../index.html';
}

window.onload = loadMissions;
window.loadMissions = loadMissions;
window.logout = logout;
window.switchDriverTab = switchDriverTab;
window.toggleDuty = typeof toggleDuty !== 'undefined' ? toggleDuty : undefined;
window.toggleWatchSync = typeof toggleWatchSync !== 'undefined' ? toggleWatchSync : undefined;
window.startRest = startRest;

window.markDriverNotifRead = async function(notifId) {
    try {
        const dId = localStorage.getItem('driver_id');
        await apiCall(`/driver/${dId}/notifications/read`, 'POST', { notification_id: notifId });
        showNotification("Notification marked as read.", "success");
        loadDashStats(); // refresh
    } catch(e) {
        console.error("Failed to mark notification as read", e);
        showNotification("Failed to mark notification as read", "error");
    }
};


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

window.verifyPickupPrompt = async function(shipmentId) {
    const code = prompt("Enter the 6-digit Pickup Verification Code:");
    if (!code) return;
    
    showNotification("Verifying pickup code...", "info");
    try {
        const res = await apiCall(`/driver/${dId}/verify-pickup/${shipmentId}?code=${code}`, 'POST');
        showNotification("Pickup verified successfully! 📦", "success");
        loadMissions();
    } catch(e) {
        alert("Verification failed: " + (e.detail || e.message));
    }
};

window.startTransit = async function(shipmentId) {
    showNotification("Starting transit...", "info");
    try {
        const res = await apiCall(`/driver/${dId}/start-transit/${shipmentId}`, 'POST');
        showNotification("Transit started successfully! 🚚", "success");
        loadMissions();
    } catch(e) {
        alert("Failed to start transit: " + (e.detail || e.message));
    }
};

window.completeDeliveryFlow = async function(shipmentId) {
    const code = prompt("Enter the 6-digit Delivery Code (provided by receiver):");
    if (!code) return;

    alert("Please capture/select a photo as proof of delivery.");
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showNotification("Uploading evidence & completing delivery...", "info");
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

            // Complete delivery with code
            await apiCall(`/driver/${dId}/complete-delivery-code/${shipmentId}?code=${code}&image_url=${encodeURIComponent(photoUrl)}`, 'POST');
            showNotification("Delivery completed successfully! 🏁", "success");
            loadMissions();
            loadWallet();
        } catch(err) {
            alert("Error completing delivery: " + (err.detail || err.message));
        }
    };
    input.click();
};

window.confirmPickup = window.verifyPickupPrompt;
window.confirmDelivery = window.completeDeliveryFlow;

async function openVerifyModal(shipmentId, type = 'pickup') {
    if (type === 'pickup') {
        window.verifyPickupPrompt(shipmentId);
    } else {
        window.completeDeliveryFlow(shipmentId);
    }
}

async function handleScan(shipmentId, type) {
    openVerifyModal(shipmentId, type);
}

function closeVerifyModal() {
    document.getElementById('verify-modal').style.display = 'none';
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
    if (document.getElementById('h-rate')) document.getElementById('h-rate').innerText = hr + ' BPM';
    if (document.getElementById('h-o2')) document.getElementById('h-o2').innerText = o2 + '%';
    if (document.getElementById('h-bp')) document.getElementById('h-bp').innerText = bp;
    if (document.getElementById('h-sync')) document.getElementById('h-sync').innerText = 'Just now (Watch)';

    // Abnormal Check
    let bpAbnormal = false;
    try {
        const parts = bp.split('/');
        const syst = parseInt(parts[0]);
        const diast = parseInt(parts[1]);
        if (syst < 90 || syst > 140 || diast < 60 || diast > 95) bpAbnormal = true;
    } catch(e) {}
    const abnormal = hr < 55 || hr > 110 || o2 < 92 || bpAbnormal;

    if (abnormal) {
        triggerHealthEmergency(hr, o2);
    } else {
        // Normal update to backend
        apiCall(`/driver/${dId}/update-vitals`, 'POST', {
            heart_rate: hr,
            blood_pressure: bp,
            oxygen_level: o2
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
