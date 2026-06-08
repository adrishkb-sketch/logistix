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
    shipments: 10,
    drivers: 10,
    vehicles: 10,
    drones: 10,
    'linked-pairs': 10,
    warehouses: 100,
    nr: 10
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
        
        // Fix: Insert the controls after the wrapper so it doesn't scroll horizontally with the table
        const tableWrapper = table.closest('.table-container') || table;
        
        container = document.createElement('div');
        container.id = containerId;
        container.className = 'table-controls-container';
        container.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:12px; background:rgba(255,255,255,0.03); border-radius:0 0 12px 12px; border-top:1px solid var(--border); margin-top:-1px;';
        tableWrapper.parentNode.insertBefore(container, tableWrapper.nextSibling);
    }

    if (dataLength <= 10 && currentLimit <= 10) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';
    
    const selectId = `${tableKey}-show-more-select`;
    // Preserve the current selected value if it exists
    let currentSelectVal = '10';
    const existingSelect = document.getElementById(selectId);
    if (existingSelect) {
        currentSelectVal = existingSelect.value;
    }

    container.innerHTML = `
        <div style="font-size:0.75rem; color:var(--text-muted);">
            Showing ${Math.min(currentLimit, dataLength)} of ${dataLength}
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
            ${currentLimit > 10 ? `<button class="btn-primary" style="padding:6px 14px; font-size:0.75rem; background:rgba(var(--primary-rgb), 0.1); color:var(--primary); border:1px solid rgba(var(--primary-rgb), 0.4); font-weight:600; border-radius:6px; cursor:pointer;" onclick="tableLimits['${tableKey}'] = 10; ${updateFn}()">${getTranslation('btn_show_less') || 'Show Less'}</button>` : ''}
            ${currentLimit < dataLength ? `
                <select id="${selectId}" style="padding:6px; font-size:0.75rem; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:6px; outline:none; cursor:pointer;">
                    <option value="10" ${currentSelectVal === '10' ? 'selected' : ''}>10</option>
                    <option value="25" ${currentSelectVal === '25' ? 'selected' : ''}>25</option>
                    <option value="50" ${currentSelectVal === '50' ? 'selected' : ''}>50</option>
                    <option value="100" ${currentSelectVal === '100' ? 'selected' : ''}>100</option>
                </select>
                <button class="btn-primary" style="padding:6px 14px; font-size:0.75rem; background:linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%); color:white; border:none; font-weight:600; border-radius:6px; cursor:pointer; box-shadow:0 4px 12px rgba(var(--primary-rgb),0.3);" onclick="tableLimits['${tableKey}'] += parseInt(document.getElementById('${selectId}').value, 10); ${updateFn}()">${getTranslation('btn_show_more') || 'Show More'}</button>
            ` : ''}
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

function initBase() {
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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBase);
} else {
    initBase();
}

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

// Initialize lastMsgCount if not set to prevent showing old messages as new
if (lastMsgCount === -1) {
    (async () => {
        try {
            const mId = localStorage.getItem('manager_id');
            if (mId && mId !== "null") {
                const msgs = await apiCall(`/tracking/messages/${mId}?company_id=${mId}`, 'GET', null, true);
                lastMsgCount = msgs.length;
                localStorage.setItem('last_seen_msg_count', lastMsgCount);
            }
        } catch (e) {}
    })();
}

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
        if (currentFilename === 'manager_messages.html') {
            // Always keep cleared on the messages page
            lastMsgCount = msgs.length;
            localStorage.setItem('last_seen_msg_count', lastMsgCount);
            const badge = document.getElementById('msg-badge');
            if (badge) badge.style.display = 'none';
            const link = document.getElementById('nav-link-messages');
            if (link) {
                link.classList.remove('has-notif');
                link.style.fontWeight = '';
                link.style.color = '';
            }
            if (typeof window.loadMessages === 'function') window.loadMessages();
        } else if (msgs.length > lastMsgCount) {
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
                link.classList.add('has-notif');
                link.style.fontWeight = 'bold';
                link.style.color = 'var(--text)';
            }
        } else {
            // Hide if no new messages
            const badge = document.getElementById('msg-badge');
            const link = document.getElementById('nav-link-messages');
            if (badge && msgs.length <= lastMsgCount) {
                badge.style.display = 'none';
            }
            if (link && msgs.length <= lastMsgCount) {
                link.classList.remove('has-notif');
                link.style.fontWeight = '';
                link.style.color = '';
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

window.fintechChart = null;

window.initFintechOracle = async function() {
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
                            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(d.name)}" style="width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.05);">
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
        if (chartEl && typeof Chart !== 'undefined') {
            const ctx = chartEl.getContext('2d');
            if (window.fintechChart) window.fintechChart.destroy();
            window.fintechChart = new Chart(ctx, {
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
};

window.initFintechOracle = window.initFintechOracle;
const initFintechOracle = window.initFintechOracle;


