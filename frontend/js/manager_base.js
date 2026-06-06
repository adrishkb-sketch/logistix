// Manager Dashboard Base Logic (Authentication, Sidebar, Language, Theme, Shims)

const managerId = localStorage.getItem('manager_id');
const companyId = localStorage.getItem('company_id') || managerId;

window.managerId = managerId;
window.companyId = companyId;

if (!managerId) {
    window.location.href = '../index.html';
    throw new Error("Redirecting to login...");
}

// Global data stores shared or populated by pages
window.globalHubs = [];
window.globalDrivers = [];
window.globalVehicles = [];
window.globalDrones = [];
window.globalWarehouses = [];
window.globalShipments = [];

window.tableLimits = {
    shipments: 5,
    drivers: 5,
    vehicles: 5,
    drones: 5,
    'linked-pairs': 5,
    warehouses: 100,
    nr: 5
};

window.showNotification = function(message, type = 'info') {
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

window.formatDisplayPlate = function(plate) {
    if (!plate) return '';
    const clean = plate.toUpperCase().replace(/\s/g, '');
    if (clean.length >= 9) {
        return `${clean.substring(0,2)} ${clean.substring(2,4)} ${clean.substring(4,6)} ${clean.substring(6)}`;
    }
    return clean;
};

window.togglePasswordVisibility = function(id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'password') {
        el.type = 'text';
        btn.innerText = '🙈';
    } else {
        el.type = 'password';
        btn.innerText = '👁️';
    }
};

window.logout = function() {
    localStorage.clear();
    window.location.href = '../index.html';
};

window.copyCompanyID = function() {
    const idEl = document.getElementById('display-company-id');
    if (!idEl) return;
    const id = idEl.innerText;
    navigator.clipboard.writeText(id).then(() => {
        alert("Company ID copied to clipboard! 📋");
    });
};

window.showSection = function(id) {
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
        'manager_ledger.html': 'ledger',
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
    
    // Highlight sidebar nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('onclick')?.includes(`'${id}'`) || link.getAttribute('href')?.includes(currentFilename)) {
            link.classList.add('active');
        }
    });
};

// Highlight sidebar link on load
document.addEventListener('DOMContentLoaded', () => {
    const currentFilename = window.location.pathname.split('/').pop();
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
        'manager_ledger.html': 'ledger',
        'manager_oracle.html': 'oracle',
        'manager_fuel_oracle.html': 'fuel-oracle',
        'manager_payments.html': 'paisa-fast',
        'manager_strategy.html': 'strategy-plan',
        'manager_resilience.html': 'network-resilience',
        'manager_system.html': 'system',
        'manager_hub_leaves.html': 'hub-leaves'
    };
    const section = pageToSection[currentFilename] || 'analytics';
    showSection(section);

    // Display company ID
    const compIdDisplay = document.getElementById('display-company-id');
    if (compIdDisplay && managerId) {
        compIdDisplay.innerText = managerId;
    }

    // Display manager/company name
    const mName = localStorage.getItem('manager_name') || (typeof getTranslation === 'function' ? getTranslation('manager') : 'Manager');
    const nameEl = document.getElementById('manager-name');
    if (nameEl) {
        nameEl.innerText = mName;
    }
});

// Shared simulation mode status
window.isSimulationMode = false;

window.checkSimulationStatus = async function() {
    try {
        const status = await apiCall('/simulation/mode/status', 'GET', null, true);
        window.isSimulationMode = status.active;
        const toggle = document.getElementById('global-sim-toggle');
        const container = document.getElementById('sim-mode-toggle-container');
        if (toggle) toggle.checked = window.isSimulationMode;
        if (container) {
            if (window.isSimulationMode) container.classList.add('active');
            else container.classList.remove('active');
        }
    } catch (e) {}
};

window.toggleGlobalSimulationMode = async function(active) {
    const container = document.getElementById('sim-mode-toggle-container');
    try {
        const endpoint = active ? '/simulation/mode/start' : '/simulation/mode/stop';
        const res = await apiCall(endpoint, 'POST');
        window.isSimulationMode = active;
        
        if (active) {
            container?.classList.add('active');
            alert("🚀 Simulation Mode ACTIVE. The platform is now in a Sandbox state. State snapshot created.");
        } else {
            container?.classList.remove('active');
            alert("🛑 Simulation Mode DEACTIVATED. System has been reverted to the previous normal state.");
        }
        
        // Full refresh of page components if available
        if (typeof window.loadShipments === 'function') window.loadShipments();
        if (typeof window.loadInsights === 'function') window.loadInsights();
        if (typeof window.loadMapData === 'function') window.loadMapData();
        if (typeof window.renderDriverPointsSummary === 'function') window.renderDriverPointsSummary();
        if (typeof window.loadDriversAndVehicles === 'function') window.loadDriversAndVehicles();
        
    } catch (e) {
        console.error("Simulation toggle failed:", e);
        const toggle = document.getElementById('global-sim-toggle');
        if (toggle) toggle.checked = !active;
        alert("Failed to toggle Simulation Mode. Ensure the backend is running.");
    }
};

// Call simulation status shortly after load
setTimeout(window.checkSimulationStatus, 1000);

// Global background intervals for message notifications
let lastMsgCount = parseInt(localStorage.getItem('last_seen_msg_count') || '-1');

setInterval(async () => {
    const activeSection = document.querySelector('.section-content:not([style*="display: none"])');
    // If we have page specific refreshes
    if (typeof window.loadShipments === 'function') {
        window.loadShipments();
    }
    window.checkSimulationStatus();
    
    // Background message check for notifications
    try {
        const mId = localStorage.getItem('manager_id');
        if (!mId || mId === "null") return;
        const msgs = await apiCall(`/tracking/messages/${mId}?company_id=${mId}`, 'GET', null, true);
        
        const currentFilename = window.location.pathname.split('/').pop();
        if (msgs.length > lastMsgCount) {
            if (currentFilename !== 'manager_messages.html') {
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
                lastMsgCount = msgs.length;
                localStorage.setItem('last_seen_msg_count', lastMsgCount);
                if (typeof window.loadMessages === 'function') window.loadMessages();
            }
        }
    } catch(e) {}
}, 5000);

// Poll for pending driver fund requests -> update Paisa-Fast badge
setInterval(async () => {
    try {
        const companyId = localStorage.getItem('manager_id');
        if (!companyId || companyId === "null") return;
        const fundRequests = await apiCall(`/manager/finance/fund-requests?company_id=${companyId}`);
        const badge = document.getElementById('paisa-badge');
        const link = document.getElementById('nav-link-paisa-fast');
        const currentFilename = window.location.pathname.split('/').pop();
        
        if (fundRequests.length > 0 && currentFilename !== 'manager_payments.html') {
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
}, 8000);

// Leaflet Theme helper
window.updateMapTheme = function(mapInstance) {
    if (!mapInstance) return;
    const theme = localStorage.getItem('theme') || 'dark';
    const tileUrl = theme === 'dark' 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
    
    // Find and remove existing tile layer
    mapInstance.eachLayer(layer => {
        if (layer instanceof L.TileLayer && !layer.options.isOverlay) {
            mapInstance.removeLayer(layer);
        }
    });

    L.tileLayer(tileUrl, {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(mapInstance);
};

// Global map icons if Leaflet is loaded
if (typeof L !== 'undefined') {
    window.ICON_PICKUP = L.divIcon({
        html: `<div style="background:#3b82f6; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px rgba(59,130,246,0.6); font-size:18px; color:white;">📍</div>`,
        className: 'custom-marker', iconSize: [34, 34], iconAnchor: [17, 17]
    });

    window.ICON_DROP = L.divIcon({
        html: `<div style="background:#10b981; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px rgba(16,185,129,0.6); font-size:18px; color:white;">🏁</div>`,
        className: 'custom-marker', iconSize: [34, 34], iconAnchor: [17, 17]
    });

    window.ICON_WAREHOUSE = L.divIcon({
        html: `<div style="background:#8b5cf6; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px rgba(139,92,246,0.6); font-size:18px; color:white;">🏘️</div>`,
        className: 'custom-marker', iconSize: [34, 34], iconAnchor: [17, 17]
    });

    window.ICON_WAREHOUSE_LEAVE = L.divIcon({
        html: `<div style="background:#ef4444; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px rgba(239,68,68,0.6); font-size:18px; color:white;">💤</div>`,
        className: 'custom-marker', iconSize: [34, 34], iconAnchor: [17, 17]
    });

    window.applyOfficialBorders = async function(mapInstance) {
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
    };
}

