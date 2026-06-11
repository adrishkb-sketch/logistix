// Dedicated Driver & Fleet Script for Warehouse Manager
const whId = localStorage.getItem('warehouse_id');
const companyId = localStorage.getItem('company_id');

if (!whId || !companyId) {
    window.location.href = '../index.html';
}

window.switchTab = function(tab) {
    const tabToPage = {
        'dash': 'warehouse_manager_dash.html',
        'verifications': 'warehouse_manager_verifications.html',
        'fleet': 'warehouse_manager_fleet.html',
        'gate': 'warehouse_manager_gate.html',
        'audit': 'warehouse_manager_audit.html',
        'leaderboard': 'warehouse_manager_leaderboard.html',
        'settings': 'warehouse_manager_settings.html',
        'shipments': 'warehouse_manager_shipments.html',
        'payments': 'warehouse_manager_payments.html',
        'drones': 'warehouse_manager_drones.html'
    };
    const currentFilename = window.location.pathname.split('/').pop();
    const expectedPage = tabToPage[tab];
    if (expectedPage && expectedPage !== currentFilename) {
        window.location.href = expectedPage;
    }
};

// Global data stores
let globalDrivers = [];
let globalVehicles = [];
let globalDrones = [];
let globalWarehouses = [];

// Bulk uploads state
let currentBulkDrivers = [];
let currentBulkVehicles = [];
let currentBulkDrones = [];

// Smart Assistant State
let smartType = 'driver';
let smartStepIndex = -1;
let currentSmartData = {};

// Table limits
window.tableLimits = {
    shipments: 10,
    drivers: 10,
    vehicles: 10,
    drones: 10,
    'linked-pairs': 10,
    warehouses: 100,
    nr: 10
};

const smartConfig = {
    driver: [
        { field: 'name', prompt: "What is the driver's full name?" },
        { field: 'login_id', prompt: "Enter a unique login ID:" },
        { field: 'password', prompt: "Set a security password:" },
        { field: 'license_type', prompt: "Select license class:", options: ['Truck (Small)', 'Truck (Heavy)', 'Delivery Van', 'Bike/Scooty', 'EV-Cargo'] },
        { field: 'experience_years', prompt: "Years of professional experience?" },
        { field: 'contact_number', prompt: "Enter 10-digit contact number:" },
        { field: 'past_accidents', prompt: "Number of past accidents (if any)?" },
        { field: 'traffic_violations', prompt: "Any traffic violations/challans?" },
        { field: 'confirm', prompt: "Review: {summary}. Type 'SAVE' to register." }
    ],
    vehicle: [
        { field: 'type', prompt: "Select vehicle type:", options: ['Truck (Small)', 'Truck (Heavy)', 'Delivery Van', 'Bike/Scooty', 'EV-Cargo'] },
        { field: 'number_plate', prompt: "Enter the number plate (e.g., MH 12 AB 1234):" },
        { field: 'capacity', prompt: "What is the load capacity in kg?" },
        { field: 'fuel_efficiency', prompt: "Enter fuel efficiency (km/l):" },
        { field: 'confirm', prompt: "Review: {summary}. Type 'SAVE' to register." }
    ],
    drone: [
        { field: 'license_number', prompt: "Enter drone license number:" },
        { field: 'capacity', prompt: "Maximum payload capacity (kg)?" },
        { field: 'radius', prompt: "Flight coverage radius (km)?" },
        { field: 'confirm', prompt: "Review: {summary}. Type 'SAVE' to register." }
    ]
};

// Initialization
async function init() {
    injectProfileModal();
    initTheme();
    await loadWarehouseData();
    await loadDriversAndVehicles();
    setupFormListeners();
    setupSmartAssistantListeners();

    // Sync language selector
    const savedLang = localStorage.getItem('app_lang') || 'en';
    const langSelect = document.getElementById('lang-select');
    if (langSelect) langSelect.value = savedLang;
}

function initTheme() {
    const themeBtn = document.getElementById('theme-toggle');
    const icon = document.getElementById('theme-icon');

    const updateUI = (isLight) => {
        if (isLight) {
            document.body.classList.add('light-mode');
            if (icon) icon.innerText = '☀️';
        } else {
            document.body.classList.remove('light-mode');
            if (icon) icon.innerText = '🌙';
        }
    };

    updateUI(localStorage.getItem('theme') === 'light');

    themeBtn?.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        updateUI(isLight);
    });
}

async function loadWarehouseData() {
    try {
        const wh = await apiCall(`/manager/warehouses?company_id=${companyId}&id=${whId}`, 'GET');
        globalWarehouses = Array.isArray(wh) ? wh : [wh];
        const myWh = globalWarehouses.find(w => w && w.id === whId);
        if (myWh) {
            const shortLabel = document.getElementById('wh-location-label-short');
            if (shortLabel) shortLabel.innerText = myWh.name.toUpperCase();
            
            // Pre-fill hub dropdowns and disable them
            ['d-hub', 'v-hub', 'drone-base-hub'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.innerHTML = `<option value="${myWh.id}" selected>${myWh.name}</option>`;
                    el.disabled = true;
                }
            });
        }
    } catch(e) {
        console.error("Failed to load warehouse info", e);
        const shortLabel = document.getElementById('wh-location-label-short');
        if (shortLabel) shortLabel.innerText = "LOGISTIX HUB";
    }
}

async function loadDriversAndVehicles() {
    try {
        const [drivers, vehicles, drones, warehouses] = await Promise.all([
            apiCall(`/manager/drivers?company_id=${companyId}`),
            apiCall(`/manager/vehicles?company_id=${companyId}`),
            apiCall(`/manager/drones?company_id=${companyId}`),
            apiCall(`/manager/warehouses?company_id=${companyId}`)
        ]);

        globalDrivers = drivers || [];
        globalVehicles = vehicles || [];
        globalDrones = drones || [];
        globalWarehouses = warehouses || [];

        renderDriversTable();
        renderVehiclesTable();
        renderDronesTable();
    } catch(e) {
        console.error("Failed to load driver/fleet data", e);
    }
}

// ── Rendering Tables ──────────────────────────────────────────────────────────

window.renderDriversTable = function() {
    const tbody = document.getElementById('drivers-table-body');
    if (!tbody) return;

    const searchTerm = (document.getElementById('driver-search')?.value || '').toLowerCase();
    const localDrivers = globalDrivers.filter(d => d.base_warehouse_id === whId);
    
    let filtered = localDrivers.filter(d => {
        return (d.name || '').toLowerCase().includes(searchTerm) || (d.system_id || '').toLowerCase().includes(searchTerm);
    });

    const limit = window.tableLimits.drivers;
    const limited = filtered.slice(0, limit);

    tbody.innerHTML = limited.map(d => {
        const v = globalVehicles.find(veh => veh.id === d.assigned_vehicle_id);
        const safetyRating = d.safety_rating || 5.0;
        const fitnessBadge = d.is_fit !== false ? '<span class="badge status-active" style="font-size:0.6rem;">FIT</span>' : '<span class="badge status-danger" style="font-size:0.6rem;">UNFIT</span>';
        
        return `
            <tr>
                <td style="cursor:pointer;" onclick="viewFullProfile('driver', '${d.id}')"><b>${d.name}</b> ${fitnessBadge}<br><small style="color:var(--primary); font-family:monospace;">${d.system_id || d.id.slice(0,8)}</small></td>
                <td><small style="font-family:monospace;">${d.login_id || 'N/A'}</small></td>
                <td><span class="status-pill" style="background:rgba(255,255,255,0.1)">${d.license_type || 'CLASS A'}</span></td>
                <td><b>${d.years_experience || 0}y Exp</b></td>
                <td>${(d.driving_score || 100).toFixed(1)}/100<br><small>${safetyRating} ⭐</small></td>
                <td><span style="color:${d.past_accidents > 0 ? 'var(--danger)' : 'var(--success)'}">${d.past_accidents || 0}</span></td>
                <td><span style="color:${d.challan_count > 0 ? 'var(--danger)' : 'var(--success)'}">${d.challan_count || 0}</span></td>
                <td><strong style="color:var(--accent)">${d.reward_points || 0}</strong></td>
                <td>${v ? '<b>' + formatDisplayPlate(v.number_plate) + '</b>' : '<small style="opacity:0.4;">Unlinked</small>'}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button class="btn-primary btn-accent" style="padding:8px; border-radius:8px; width:32px; height:32px;" onclick="openEditModal('drivers', '${d.id}')">✏️</button>
                        <button class="btn-primary btn-danger" style="padding:8px; border-radius:8px; width:32px; height:32px;" onclick="deleteItem('drivers', '${d.id}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    renderTableControls('drivers', filtered.length, limit, 'renderDriversTable');
};

window.renderVehiclesTable = function() {
    const tbody = document.getElementById('vehicles-table-body');
    if (!tbody) return;

    const searchTerm = (document.getElementById('vehicle-search')?.value || '').toLowerCase();
    const localVehicles = globalVehicles.filter(v => v.base_warehouse_id === whId);

    let filtered = localVehicles.filter(v => {
        return (v.number_plate || '').toLowerCase().includes(searchTerm) || (v.system_id || '').toLowerCase().includes(searchTerm);
    });

    const limit = window.tableLimits.vehicles;
    const limited = filtered.slice(0, limit);

    tbody.innerHTML = limited.map(v => {
        const linkedDriver = globalDrivers.find(d => d.assigned_vehicle_id === v.id);
        const healthColor = v.vehicle_health_score > 80 ? 'var(--success)' : (v.vehicle_health_score > 60 ? 'var(--warning)' : 'var(--danger)');
        const opBadge = v.is_operational !== false ? '<span class="status-pill" style="background:var(--success)22; color:var(--success); font-size:0.6rem;">OPERATIONAL</span>' : '<span class="status-pill" style="background:var(--danger)22; color:var(--danger); font-size:0.6rem;">BREAKDOWN</span>';
        
        let checkupBtn = '';
        if (v.checkup_status === 'pending') {
            checkupBtn = `<button class="btn-primary" style="padding:4px 8px; font-size:0.7rem; background:var(--success); color:black; font-weight:bold; border-radius:6px;" onclick="approveCheckup('${v.id}')">Approve Checkup</button>`;
        }

        return `
            <tr>
                <td style="cursor:pointer;" onclick="viewFullProfile('vehicle', '${v.id}')"><b>${v.type}</b><br><small style="color:var(--accent); font-family:monospace;">${v.system_id || v.id.slice(0,8)}</small></td>
                <td><b style="font-family:monospace; letter-spacing:1px;">${formatDisplayPlate(v.number_plate)}</b></td>
                <td><span style="color:${healthColor}; font-weight:bold;">${v.vehicle_health_score || 100}%</span></td>
                <td>${v.capacity}kg<br><small>Eff: ${v.fuel_efficiency}km/l</small></td>
                <td><span style="color:var(--text-muted)">Stationary</span></td>
                <td>${opBadge}</td>
                <td>${linkedDriver ? `<b>${linkedDriver.name}</b>` : '<span style="opacity:0.4;">Unlinked</span>'}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${checkupBtn}
                        <button class="btn-primary btn-accent" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="openEditModal('vehicles', '${v.id}')">✏️</button>
                        <button class="btn-primary btn-danger" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="deleteItem('vehicles', '${v.id}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    renderTableControls('vehicles', filtered.length, limit, 'renderVehiclesTable');
};

window.renderDronesTable = function() {
    const tbody = document.getElementById('drones-table-body');
    if (!tbody) return;

    const searchTerm = (document.getElementById('drone-search')?.value || '').toLowerCase();
    const localDrones = globalDrones.filter(d => d.base_warehouse_id === whId);

    let filtered = localDrones.filter(d => {
        return (d.license_number || '').toLowerCase().includes(searchTerm) || (d.system_id || '').toLowerCase().includes(searchTerm);
    });

    const limit = window.tableLimits.drones;
    const limited = filtered.slice(0, limit);

    tbody.innerHTML = limited.map(d => {
        return `
            <tr>
                <td><b style="font-family:monospace;">${d.license_number}</b><br><small style="color:var(--accent);">${d.system_id || d.id.substring(0,8)}</small></td>
                <td><b>${d.capacity}</b> kg</td>
                <td><b>${d.radius}</b> km</td>
                <td><span class="status-pill" style="background:var(--success)22; color:var(--success); font-size:0.6rem;">READY</span></td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button class="btn-primary btn-accent" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="openEditModal('drones', '${d.id}')">✏️</button>
                        <button class="btn-primary btn-danger" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="deleteItem('drones', '${d.id}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    renderTableControls('drones', filtered.length, limit, 'renderDronesTable');
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

window.handlePlateInput = function(input) {
    const val = input.value.toUpperCase().replace(/\s/g, '');
    const warning = document.getElementById('plate-warning');
    if (!warning) return;
    
    const duplicate = globalVehicles.some(v => v.number_plate.toUpperCase().replace(/\s/g, '') === val);
    if (duplicate) {
        warning.style.display = 'block';
    } else {
        warning.style.display = 'none';
    }
};

// ── CRUD Operations ──────────────────────────────────────────────────────────

function setupFormListeners() {
    document.getElementById('add-driver-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const exp = parseFloat(document.getElementById('d-exp').value || 0);
            const accidents = parseInt(document.getElementById('d-accidents').value || 0);
            const challans = parseInt(document.getElementById('d-challans').value || 0);

            const driverData = {
                company_id: companyId,
                name: document.getElementById('d-name').value,
                login_id: document.getElementById('d-login').value,
                password: document.getElementById('d-pass').value,
                license_type: document.getElementById('d-license').value,
                base_warehouse_id: whId,
                years_experience: exp,
                past_accidents: accidents,
                traffic_violations: challans,
                challan_count: challans,
                driving_score: 100.0,
                safety_rating: (5.0 - (accidents * 1.0) - (challans * 0.2) + (exp * 0.1)).toFixed(1),
                on_time_rate: 100,
                contact_number: document.getElementById('d-contact').value
            };
            await apiCall('/manager/drivers', 'POST', driverData);
            document.getElementById('add-driver-form').reset();
            alert("Driver registered successfully!");
            loadDriversAndVehicles();
        } catch(e) { 
            console.error(e);
            alert("Failed to register driver: " + e.message); 
        }
    });

    document.getElementById('add-vehicle-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const vehicleData = {
                company_id: companyId,
                type: document.getElementById('v-type').value,
                number_plate: document.getElementById('v-plate').value.replace(/\s/g, '').toUpperCase(),
                capacity: parseFloat(document.getElementById('v-cap').value),
                fuel_efficiency: parseFloat(document.getElementById('v-eff').value),
                base_warehouse_id: whId,
                vehicle_health_score: 100
            };
            await apiCall('/manager/vehicles', 'POST', vehicleData);
            document.getElementById('add-vehicle-form').reset();
            alert("Vehicle registered successfully!");
            loadDriversAndVehicles();
        } catch(e) { 
            console.error(e);
            alert("Failed to register vehicle: " + e.message); 
        }
    });

    document.getElementById('add-drone-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await apiCall('/manager/drones', 'POST', {
                license_number: document.getElementById('drone-license').value,
                base_warehouse_id: whId,
                capacity: parseFloat(document.getElementById('drone-capacity').value),
                radius: parseFloat(document.getElementById('drone-radius').value),
                company_id: companyId
            });
            document.getElementById('add-drone-form').reset();
            alert("Drone registered successfully!");
            loadDriversAndVehicles();
        } catch(e) { 
            console.error(e);
            alert("Failed to register drone: " + e.message); 
        }
    });

    // Edit Modal submission handler
    document.getElementById('edit-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            let payload = {};
            if (currentEditType === 'drivers') {
                payload = {
                    name: document.getElementById('edit-d-name').value,
                    license_type: document.getElementById('edit-d-license').value,
                    contact_number: document.getElementById('edit-d-contact').value,
                    years_experience: parseFloat(document.getElementById('edit-d-exp').value || 0),
                    past_accidents: parseInt(document.getElementById('edit-d-accidents').value || 0),
                    traffic_violations: parseInt(document.getElementById('edit-d-challans').value || 0),
                    challan_count: parseInt(document.getElementById('edit-d-challans').value || 0)
                };
            } else if (currentEditType === 'vehicles') {
                payload = {
                    type: document.getElementById('edit-v-type').value,
                    number_plate: document.getElementById('edit-v-plate').value.replace(/\s/g, '').toUpperCase(),
                    capacity: parseFloat(document.getElementById('edit-v-cap').value || 0),
                    fuel_efficiency: parseFloat(document.getElementById('edit-v-eff').value || 0),
                    vehicle_health_score: parseFloat(document.getElementById('edit-v-health').value || 100)
                };
            } else if (currentEditType === 'drones') {
                payload = {
                    license_number: document.getElementById('edit-dr-license').value,
                    capacity: parseFloat(document.getElementById('edit-dr-cap').value || 0),
                    radius: parseFloat(document.getElementById('edit-dr-radius').value || 0)
                };
            }

            await apiCall(`/manager/${currentEditType}/${currentEditId}`, 'PUT', payload);
            document.getElementById('edit-modal').style.display = 'none';
            alert("Item updated successfully!");
            loadDriversAndVehicles();
        } catch(err) {
            console.error(err);
            alert("Failed to update item: " + err.message);
        }
    });
}

window.deleteItem = async function(type, id) {
    if (!confirm(`Delete this ${type.slice(0,-1)}?`)) return;
    try {
        await apiCall(`/manager/${type}/${id}?company_id=${companyId}`, 'DELETE');
        loadDriversAndVehicles();
    } catch(e) { alert("Delete failed."); }
};

let currentEditType = '';
let currentEditId = '';

window.openEditModal = function(type, id) {
    currentEditType = type;
    currentEditId = id;
    document.getElementById('edit-type').innerText = type.charAt(0).toUpperCase() + type.slice(1,-1);
    
    let html = '';
    const fieldStyle = `style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--border); border-radius:10px; font-family:inherit; font-size:0.95rem; margin-top:5px;"`;
    const labelStyle = `style="font-size:0.75rem; color:var(--primary); margin-top:12px; display:block;"`;
    const types = ['Truck (Small)', 'Truck (Heavy)', 'Delivery Van', 'Bike/Scooty', 'EV-Cargo'];

    if (type === 'drones') {
        const d = globalDrones.find(item => item.id === id);
        html = `<div style="display:flex;flex-direction:column;gap:5px;">
                    <label ${labelStyle}>License Number</label>
                    <input type="text" id="edit-dr-license" value="${d.license_number || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Base Warehouse (Locked)</label>
                    <select id="edit-dr-hub" ${fieldStyle} disabled>
                        <option value="${whId}" selected>${(globalWarehouses.find(w => w.id === whId) || {name: 'Current Hub'}).name}</option>
                    </select>
                    <label ${labelStyle}>Capacity (kg)</label>
                    <input type="number" step="0.1" id="edit-dr-cap" value="${d.capacity || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Coverage Radius (km)</label>
                    <input type="number" step="1" id="edit-dr-radius" value="${d.radius || ''}" ${fieldStyle}>
                </div>`;
    } else if (type === 'vehicles') {
        const v = globalVehicles.find(item => item.id === id);
        html = `<div style="display:flex;flex-direction:column;gap:5px;">
                    <label ${labelStyle}>Vehicle Type</label>
                    <select id="edit-v-type" ${fieldStyle}>
                        ${types.map(t => `<option value="${t}" ${v.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                    <label ${labelStyle}>Number Plate</label>
                    <input type="text" id="edit-v-plate" value="${v.number_plate || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Health Score (%)</label>
                    <input type="number" min="0" max="100" id="edit-v-health" value="${v.vehicle_health_score || 100}" ${fieldStyle}>
                    <label ${labelStyle}>Capacity (kg)</label>
                    <input type="number" id="edit-v-cap" value="${v.capacity || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Fuel Efficiency (km/l)</label>
                    <input type="number" id="edit-v-eff" value="${v.fuel_efficiency || ''}" ${fieldStyle}>
                </div>`;
    } else if (type === 'drivers') {
        const d = globalDrivers.find(item => item.id === id);
        html = `<div style="display:flex;flex-direction:column;gap:5px;">
                    <label ${labelStyle}>Full Name</label>
                    <input type="text" id="edit-d-name" value="${d.name || ''}" ${fieldStyle}>
                    <label ${labelStyle}>License Class</label>
                    <select id="edit-d-license" ${fieldStyle}>
                        ${types.map(t => `<option value="${t}" ${d.license_type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                    <label ${labelStyle}>Contact Number</label>
                    <input type="text" id="edit-d-contact" value="${d.contact_number || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Years of Experience</label>
                    <input type="number" step="0.5" id="edit-d-exp" value="${d.years_experience || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Accidents</label>
                    <input type="number" id="edit-d-accidents" value="${d.past_accidents || 0}" ${fieldStyle}>
                    <label ${labelStyle}>Traffic Violations (Challans)</label>
                    <input type="number" id="edit-d-challans" value="${d.challan_count || 0}" ${fieldStyle}>
                </div>`;
    }

    document.getElementById('edit-fields').innerHTML = html;
    document.getElementById('edit-modal').style.display = 'block';
};

// ── Bulk Upload Logic (Scoped to this Hub) ──────────────────────────────────

window.openDriverBulkModal = function() {
    document.getElementById('bulk-driver-modal').style.display = 'block';
    document.getElementById('driver-preview-section').style.display = 'none';
};
window.closeDriverBulkModal = function() { document.getElementById('bulk-driver-modal').style.display = 'none'; };

window.handleDriverBulkFile = async function(e) {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
        const res = await fetch(`${API_BASE}/manager/drivers/bulk-parse?company_id=${companyId}`, { 
            method:'POST', 
            body:fd,
            headers: {
                "X-Logistix-Context": companyId || ""
            }
        });
        const data = await res.json(); renderDriverBulkPreview(data);
    } catch(err) { alert("Failed to parse drivers."); }
};

window.previewDriverSheets = async function() {
    const url = document.getElementById('driver-sheets-url').value;
    try {
        const res = await apiCall(`/manager/drivers/bulk-parse?company_id=${companyId}&url_req=${encodeURIComponent(url)}`, 'POST');
        renderDriverBulkPreview(res);
    } catch(err) { alert("Failed to fetch driver data."); }
};

function renderDriverBulkPreview(data) {
    currentBulkDrivers = (data.drivers || []).map(d => ({ ...d, base_warehouse_id: whId }));
    document.getElementById('driver-bulk-count').innerText = currentBulkDrivers.length;
    document.getElementById('driver-preview-section').style.display = 'block';
    
    const errorDiv = document.getElementById('driver-bulk-errors');
    if (errorDiv && data.errors && data.errors.length > 0) {
        errorDiv.innerHTML = `<div class="glass-card" style="border-color:var(--danger); background:rgba(239,68,68,0.05); padding:10px; margin-bottom:15px;">
            <h4 style="color:var(--danger); margin-top:0;">⚠️ Parsing Errors (${data.errors.length} rows skipped)</h4>
            <ul style="font-size:0.8rem; color:var(--text-muted); margin:0; padding-left:20px;">
                ${data.errors.slice(0, 5).map(e => `<li>${e}</li>`).join('')}
            </ul>
        </div>`;
        errorDiv.style.display = 'block';
    } else if (errorDiv) {
        errorDiv.style.display = 'none';
    }

    document.getElementById('driver-preview-body').innerHTML = currentBulkDrivers.map(d => {
        return `<tr><td>${d.name}</td><td>${d.license_type}</td><td>${d.contact_number}</td></tr>`;
    }).join('');
}

window.confirmDriverBulk = async function() {
    try {
        const res = await apiCall('/manager/drivers/bulk-confirm', 'POST', currentBulkDrivers);
        alert(res.message); 
        closeDriverBulkModal(); 
        loadDriversAndVehicles();
    } catch(err) { alert("Bulk upload failed."); }
};

window.openVehicleBulkModal = function() {
    document.getElementById('bulk-vehicle-modal').style.display = 'block';
    document.getElementById('vehicle-preview-section').style.display = 'none';
};
window.closeVehicleBulkModal = function() { document.getElementById('bulk-vehicle-modal').style.display = 'none'; };

window.handleVehicleBulkFile = async function(e) {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
        const res = await fetch(`${API_BASE}/manager/vehicles/bulk-parse?company_id=${companyId}`, { 
            method:'POST', 
            body:fd,
            headers: {
                "X-Logistix-Context": companyId || ""
            }
        });
        const data = await res.json(); renderVehicleBulkPreview(data);
    } catch(err) { alert("Failed to parse vehicles."); }
};

window.previewVehicleSheets = async function() {
    const url = document.getElementById('vehicle-sheets-url').value;
    try {
        const res = await apiCall(`/manager/vehicles/bulk-parse?company_id=${companyId}&url_req=${encodeURIComponent(url)}`, 'POST');
        renderVehicleBulkPreview(res);
    } catch(err) { alert("Failed to fetch vehicle data."); }
};

function renderVehicleBulkPreview(data) {
    currentBulkVehicles = (data.vehicles || []).map(v => ({ ...v, base_warehouse_id: whId }));
    document.getElementById('vehicle-bulk-count').innerText = currentBulkVehicles.length;
    document.getElementById('vehicle-preview-section').style.display = 'block';

    const errorDiv = document.getElementById('vehicle-bulk-errors');
    if (errorDiv && data.errors && data.errors.length > 0) {
        errorDiv.innerHTML = `<div class="glass-card" style="border-color:var(--danger); background:rgba(239,68,68,0.05); padding:10px; margin-bottom:15px;">
            <h4 style="color:var(--danger); margin-top:0;">⚠️ Parsing Errors (${data.errors.length} rows skipped)</h4>
            <ul style="font-size:0.8rem; color:var(--text-muted); margin:0; padding-left:20px;">
                ${data.errors.slice(0, 5).map(e => `<li>${e}</li>`).join('')}
            </ul>
        </div>`;
        errorDiv.style.display = 'block';
    } else if (errorDiv) {
        errorDiv.style.display = 'none';
    }

    document.getElementById('vehicle-preview-body').innerHTML = currentBulkVehicles.map(v => {
        return `<tr><td>${v.type}</td><td>${v.number_plate}</td><td>${v.capacity}kg</td></tr>`;
    }).join('');
}

window.confirmVehicleBulk = async function() {
    try {
        const res = await apiCall('/manager/vehicles/bulk-confirm', 'POST', currentBulkVehicles);
        alert(res.message || "Vehicles uploaded successfully!");
        closeVehicleBulkModal();
        loadDriversAndVehicles();
    } catch(err) { alert("Bulk upload failed."); }
};

window.openDroneBulkModal = function() {
    document.getElementById('bulk-drone-modal').style.display = 'block';
    document.getElementById('drone-preview-section').style.display = 'none';
};
window.closeDroneBulkModal = function() { document.getElementById('bulk-drone-modal').style.display = 'none'; };

window.handleDroneBulkFile = async function(e) {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
        const res = await fetch(`${API_BASE}/manager/drones/bulk-parse?company_id=${companyId}`, { 
            method:'POST', 
            body:fd,
            headers: {
                "X-Logistix-Context": companyId || ""
            }
        });
        const data = await res.json(); renderDroneBulkPreview(data);
    } catch(err) { alert("Failed to parse drones."); }
};

window.previewDroneSheets = async function() {
    const url = document.getElementById('drone-sheets-url').value;
    try {
        const res = await apiCall(`/manager/drones/bulk-parse?company_id=${companyId}&url_req=${encodeURIComponent(url)}`, 'POST');
        renderDroneBulkPreview(res);
    } catch(err) { alert("Failed to fetch drone data."); }
};

function renderDroneBulkPreview(data) {
    currentBulkDrones = (data.drones || []).map(d => ({ ...d, base_warehouse_id: whId }));
    document.getElementById('drone-bulk-count').innerText = currentBulkDrones.length;
    document.getElementById('drone-preview-section').style.display = 'block';

    const errorDiv = document.getElementById('drone-bulk-errors');
    if (errorDiv && data.errors && data.errors.length > 0) {
        errorDiv.innerHTML = `<div class="glass-card" style="border-color:var(--danger); background:rgba(239,68,68,0.05); padding:10px; margin-bottom:15px;">
            <h4 style="color:var(--danger); margin-top:0;">⚠️ Parsing Errors (${data.errors.length} rows skipped)</h4>
            <ul style="font-size:0.8rem; color:var(--text-muted); margin:0; padding-left:20px;">
                ${data.errors.slice(0, 5).map(e => `<li>${e}</li>`).join('')}
            </ul>
        </div>`;
        errorDiv.style.display = 'block';
    } else if (errorDiv) {
        errorDiv.style.display = 'none';
    }

    document.getElementById('drone-preview-body').innerHTML = currentBulkDrones.map(d => {
        return `<tr><td>${d.license_number}</td><td>${d.capacity}kg</td><td>${d.radius}km</td></tr>`;
    }).join('');
}

window.confirmDroneBulk = async function() {
    try {
        await apiCall('/manager/drones/bulk-confirm', 'POST', currentBulkDrones);
        alert("Drones uploaded successfully!"); 
        closeDroneBulkModal(); 
        loadDriversAndVehicles();
    } catch(err) { alert("Bulk upload failed."); }
};

// ── Smart Assistant Logic ───────────────────────────────────────────────────

window.openSmartAssistant = function(type) {
    smartType = type;
    smartStepIndex = 0;
    currentSmartData = { base_hub: whId };
    
    document.getElementById('smart-assistant-modal').style.display = 'flex';
    document.getElementById('assistant-chat-container').innerHTML = '';
    document.getElementById('assistant-title').innerText = `✨ Smart ${type.charAt(0).toUpperCase() + type.slice(1)} Onboarding`;
    
    addAiMessage(`👋 Hello! I'll help you register a new ${type} to your hub.`);
    askNextStep();
};

window.closeSmartAssistant = function() {
    document.getElementById('smart-assistant-modal').style.display = 'none';
};

function addAiMessage(text) {
    const container = document.getElementById('assistant-chat-container');
    if (!container) return;
    const msg = document.createElement('div');
    msg.style = 'background:rgba(99, 102, 241, 0.1); padding:12px; border-radius:12px; align-self:flex-start; max-width:80%; color:white; border-left:4px solid var(--primary); margin-bottom:10px; animation: fadeIn 0.3s ease;';
    msg.innerHTML = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function addUserMessage(text) {
    const container = document.getElementById('assistant-chat-container');
    if (!container) return;
    const msg = document.createElement('div');
    msg.style = 'background:rgba(255,255,255,0.05); padding:12px; border-radius:12px; align-self:flex-end; max-width:80%; color:var(--primary); font-weight:600; margin-bottom:10px; animation: fadeIn 0.3s ease;';
    msg.innerText = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function askNextStep() {
    const steps = smartConfig[smartType];
    const step = steps[smartStepIndex];
    if (!step) return;

    if (step.field === 'confirm') {
        let summary = "";
        if (smartType === 'driver') summary = `${currentSmartData.name} (${currentSmartData.license_type}) - ${currentSmartData.experience_years}y Exp`;
        else if (smartType === 'vehicle') summary = `${currentSmartData.type} - ${currentSmartData.number_plate}`;
        else if (smartType === 'drone') summary = `Drone ${currentSmartData.license_number}`;
        
        addAiMessage(step.prompt.replace('{summary}', summary));
        
        // Show select options for confirmation (SAVE or Cancel)
        const container = document.getElementById('assistant-chat-container');
        const optDiv = document.createElement('div');
        optDiv.style = 'display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;';
        
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-primary';
        saveBtn.style = 'width:auto; padding:6px 12px; font-size:0.75rem; background:var(--success);';
        saveBtn.innerText = "SAVE";
        saveBtn.onclick = () => {
            document.getElementById('assistant-input').value = "SAVE";
            sendAssistantMessage();
        };
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-primary';
        cancelBtn.style = 'width:auto; padding:6px 12px; font-size:0.75rem; background:rgba(239, 68, 68, 0.15); border:1px solid rgba(239, 68, 68, 0.3); color:var(--danger);';
        cancelBtn.innerText = "Cancel";
        cancelBtn.onclick = () => {
            document.getElementById('assistant-input').value = "CANCEL";
            sendAssistantMessage();
        };

        optDiv.appendChild(saveBtn);
        optDiv.appendChild(cancelBtn);
        container.appendChild(optDiv);
        container.scrollTop = container.scrollHeight;
    } else {
        addAiMessage(step.prompt);
        if (step.options) {
            const container = document.getElementById('assistant-chat-container');
            const optDiv = document.createElement('div');
            optDiv.style = 'display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;';
            step.options.forEach(opt => {
                const btn = document.createElement('button');
                btn.className = 'btn-primary';
                btn.style = 'width:auto; padding:6px 12px; font-size:0.75rem; background:rgba(255,255,255,0.1); border:1px solid var(--border);';
                btn.innerText = opt;
                btn.onclick = () => {
                    document.getElementById('assistant-input').value = opt;
                    sendAssistantMessage();
                };
                optDiv.appendChild(btn);
            });
            container.appendChild(optDiv);
            container.scrollTop = container.scrollHeight;
        }
    }
    document.getElementById('assistant-input').focus();
}

window.sendAssistantMessage = async function() {
    const input = document.getElementById('assistant-input');
    let text = input.value.trim();
    if (!text) return;

    addUserMessage(text);
    input.value = '';

    const steps = smartConfig[smartType];
    const step = steps[smartStepIndex];

    if (step.field === 'confirm') {
        if (text.toLowerCase().includes('save')) {
            await finalizeSmartOnboarding();
        } else {
            addAiMessage("Registration cancelled. You can start over.");
            smartStepIndex = -1;
        }
        return;
    }

    if (step.field === 'number_plate') text = text.toUpperCase().replace(/\s/g, '');
    currentSmartData[step.field] = text;
    smartStepIndex++;

    if (smartStepIndex < steps.length) askNextStep();
};

async function finalizeSmartOnboarding() {
    try {
        let endpoint = `/manager/${smartType}s`;
        let payload = { ...currentSmartData, company_id: companyId, base_warehouse_id: whId };
        
        if (smartType === 'driver') {
            payload.years_experience = parseFloat(payload.experience_years);
            payload.past_accidents = parseInt(payload.past_accidents || 0);
            payload.traffic_violations = parseInt(payload.traffic_violations || 0);
            payload.challan_count = payload.traffic_violations;
            payload.driving_score = 100;
            payload.safety_rating = (5.0 - (payload.past_accidents * 1.0) - (payload.traffic_violations * 0.2) + (payload.years_experience * 0.1)).toFixed(1);
        } else if (smartType === 'vehicle') {
            payload.capacity = parseFloat(payload.capacity);
            payload.fuel_efficiency = parseFloat(payload.fuel_efficiency || 40);
        }

        await apiCall(endpoint, 'POST', payload);
        addAiMessage("✅ Registration Complete! Data synced with database.");
        loadDriversAndVehicles();
        setTimeout(closeSmartAssistant, 2000);
    } catch(e) {
        addAiMessage("❌ Error during registration. Please check inputs.");
    }
}

function setupSmartAssistantListeners() {
    document.getElementById('assistant-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendAssistantMessage();
    });
}

// Hook into DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function injectProfileModal() {
    if (document.getElementById('profile-modal')) return;
    const modal = document.createElement('div');
    modal.className = 'glass-card modal-glass';
    modal.id = 'profile-modal';
    modal.style.cssText = 'display:none; position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); z-index:11000; width:700px; max-width:95vw; max-height:90vh; overflow-y:auto; box-shadow: 0 40px 80px rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); padding: 32px; background: rgba(15, 23, 42, 0.98); backdrop-filter: blur(20px);';
    modal.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px;">
            <div style="display:flex; gap:20px; align-items:center;">
                <img id="prof-image" src="" style="width:80px; height:80px; border-radius:50%; border:3px solid var(--primary); object-fit:cover;"/>
                <div>
                    <h2 id="prof-name" style="margin:0;"></h2>
                    <p id="prof-sub" style="color:var(--text-muted); margin:0;"></p>
                    <div id="prof-driving-status" style="margin-top:8px; font-size:0.8rem; display:inline-block; padding:4px 10px; border-radius:12px; font-weight:700;"></div>
                </div>
            </div>
            <button onclick="document.getElementById('profile-modal').style.display='none'" style="background:none; border:none; color:white; font-size:1.5rem; cursor:pointer;">✖</button>
        </div>
        <div style="display:grid; grid-template-columns: repeat(6, 1fr); gap:10px; margin-bottom:25px;">
            <div class="glass-card" style="padding:10px; text-align:center; background:rgba(255,255,255,0.05)">
                <small style="color:var(--text-muted)">Safety Index</small>
                <h3 id="prof-stat-1" style="font-size:1.1rem; margin-top:5px; margin-bottom:0;"></h3>
            </div>
            <div class="glass-card" style="padding:10px; text-align:center; background:rgba(255,255,255,0.05)">
                <small style="color:var(--text-muted)">Punctuality</small>
                <h3 id="prof-stat-2" style="font-size:1.1rem; margin-top:5px; margin-bottom:0;"></h3>
            </div>
            <div class="glass-card" style="padding:10px; text-align:center; background:rgba(255,255,255,0.05)">
                <small style="color:var(--text-muted)">Experience</small>
                <h3 id="prof-stat-3" style="font-size:1.1rem; margin-top:5px; margin-bottom:0;"></h3>
            </div>
            <div class="glass-card" style="padding:10px; text-align:center; background:rgba(255,255,255,0.05)">
                <small style="color:var(--text-muted)">Rating</small>
                <h3 id="prof-stat-5" style="font-size:1.1rem; margin-top:5px; margin-bottom:0; color:var(--warning);"></h3>
            </div>
            <div class="glass-card" style="padding:10px; text-align:center; background:rgba(255,255,255,0.05)">
                <small style="color:var(--text-muted)">Trips</small>
                <h3 id="prof-stat-4" style="font-size:1.1rem; margin-top:5px; margin-bottom:0;"></h3>
            </div>
            <div class="glass-card" style="padding:10px; text-align:center; background:rgba(255,255,255,0.05)">
                <small style="color:var(--text-muted)">Earnings</small>
                <h3 id="prof-stat-6" style="font-size:1.1rem; margin-top:5px; margin-bottom:0; color:var(--accent);"></h3>
            </div>
        </div>
        <h4>Performance Insights</h4>
        <div style="margin-bottom:20px;">
            <label id="prof-meter-label" style="font-size:0.85rem; color:var(--text-muted)"></label>
            <div style="width:100%; height:8px; background:rgba(255,255,255,0.1); border-radius:4px; margin-top:5px; overflow:hidden;">
                <div id="prof-meter-bar" style="width:0%; height:100%; background:var(--primary); transition:width 1s ease;"></div>
            </div>
        </div>
        <div id="prof-tab-container">
            <div style="display:flex; gap:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; margin-bottom:12px;">
                <span id="prof-btn-trips" style="cursor:pointer; font-weight:bold; color:var(--primary); font-size:1rem; border-bottom:2px solid var(--primary); padding-bottom:6px;" onclick="window.switchProfTab('trips')">Recent Trip History</span>
                <span id="prof-btn-hours" style="cursor:pointer; font-weight:bold; color:var(--text-muted); font-size:1rem; padding-bottom:6px;" onclick="window.switchProfTab('hours')">Driving Hours</span>
            </div>
            <div id="prof-tab-trips-table" class="table-container">
                <table style="font-size:0.85rem; width:100%;">
                    <thead><tr><th>ID</th><th>Route</th><th>Date</th><th>Status</th></tr></thead>
                    <tbody id="prof-trips-body"></tbody>
                </table>
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
        </div>
    `;
    document.body.appendChild(modal);

    window.switchProfTab = function(tab) {
        const tripsTable = document.getElementById('prof-tab-trips-table');
        const hoursTable = document.getElementById('prof-tab-hours-table');
        const btnTrips = document.getElementById('prof-btn-trips');
        const btnHours = document.getElementById('prof-btn-hours');
        if (tab === 'trips') {
            if (tripsTable) tripsTable.style.display = 'block';
            if (hoursTable) hoursTable.style.display = 'none';
            if (btnTrips) {
                btnTrips.style.color = 'var(--primary)';
                btnTrips.style.borderBottom = '2px solid var(--primary)';
            }
            if (btnHours) {
                btnHours.style.color = 'var(--text-muted)';
                btnHours.style.borderBottom = 'none';
            }
        } else {
            if (tripsTable) tripsTable.style.display = 'none';
            if (hoursTable) hoursTable.style.display = 'block';
            if (btnTrips) {
                btnTrips.style.color = 'var(--text-muted)';
                btnTrips.style.borderBottom = 'none';
            }
            if (btnHours) {
                btnHours.style.color = 'var(--primary)';
                btnHours.style.borderBottom = '2px solid var(--primary)';
            }
        }
    };
}

async function viewFullProfile(type, id) {
    try {
        const data = await apiCall(`/manager/${type}s/${id}/profile?company_id=${companyId}`);
        const p = data.profile;
        const shipments = data.recent_shipments;
        
        const modal = document.getElementById('profile-modal');
        
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
            profilePic = p.profile_pic || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(p.name)}`;
        }
        
        document.getElementById('prof-image').src = profilePic;
        document.getElementById('prof-name').innerText = p.name || p.number_plate;
        document.getElementById('prof-sub').innerText = type === 'driver' ? `@${p.login_id || 'user'} | ${(p.license_type || 'regular').toUpperCase()} LICENSE` : `${(p.type || 'vehicle').toUpperCase()} | HEALTH: ${p.vehicle_health_score || 100}%`;
        
        if (type === 'driver') {
            const tabContainer = document.getElementById('prof-tab-container');
            if (tabContainer) tabContainer.style.display = 'block';
            
            document.getElementById('prof-stat-1').innerText = `${(p.safety_index || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-2').innerText = `${(p.punctuality_rate || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-3').innerText = `${p.years_experience || 0} Years`;
            document.getElementById('prof-stat-4').innerText = `${p.total_trips || p.deliveries_completed || 0}`;
            
            let avgRating = 5.0;
            if (p.rating_count && p.rating_count > 0) {
                avgRating = p.total_rating_sum / p.rating_count;
            } else if (p.rating !== undefined) {
                avgRating = p.rating;
            }
            document.getElementById('prof-stat-5').innerText = `${avgRating.toFixed(1)}⭐`;
            document.getElementById('prof-stat-6').innerText = `₹${p.wallet_balance || 0} / ${p.reward_points || 0} pts`;
            
            document.getElementById('prof-meter-label').innerText = `Fatigue Level: ${(p.fatigue_score || 0).toFixed(0)}%`;
            const meter = document.getElementById('prof-meter-bar');
            meter.style.width = `${p.fatigue_score || 0}%`;
            meter.style.background = (p.fatigue_score || 0) > 80 ? 'var(--danger)' : 'var(--primary)';

            const statusEl = document.getElementById('prof-driving-status');
            const hasActiveShipment = shipments.some(s => s.status === 'in_transit');
            const isResting = p.fatigue_score > 80;
            const hasVehicle = p.vehicle_id !== null;

            if (p.is_on_duty === false) {
                statusEl.innerText = "NOT WORKING";
                statusEl.style.background = "rgba(239, 68, 68, 0.15)";
                statusEl.style.color = "var(--danger)";
            } else if (hasActiveShipment) {
                statusEl.innerText = "ON ROAD";
                statusEl.style.background = "rgba(16, 185, 129, 0.15)";
                statusEl.style.color = "var(--success)";
            } else if (isResting) {
                statusEl.innerText = "RESTING";
                statusEl.style.background = "rgba(79, 140, 255, 0.15)";
                statusEl.style.color = "var(--primary)";
            } else if (hasVehicle) {
                statusEl.innerText = "READY";
                statusEl.style.background = "rgba(245, 158, 11, 0.15)";
                statusEl.style.color = "var(--warning)";
            } else {
                statusEl.innerText = "UNAVAILABLE";
                statusEl.style.background = "rgba(255, 255, 255, 0.05)";
                statusEl.style.color = "var(--text-muted)";
            }
            
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
            const hCard = document.getElementById('prof-health-card');
            if (hCard) hCard.style.display = 'none';
            const tabContainer = document.getElementById('prof-tab-container');
            if (tabContainer) tabContainer.style.display = 'none';
            
            document.getElementById('prof-stat-1').innerText = `${(p.efficiency_score || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-2').innerText = `${p.vehicle_health_score || 100}%`;
            document.getElementById('prof-stat-3').innerText = `${(p.total_distance_km || p.kilometers_covered || 0).toFixed(0)} km`;
            document.getElementById('prof-stat-4').innerText = `${p.deliveries_completed || 0}`;
            document.getElementById('prof-stat-5').innerText = ''; 
            document.getElementById('prof-stat-6').innerText = '';
            
            document.getElementById('prof-meter-label').innerText = 'Fuel Efficiency Index';
            document.getElementById('prof-meter-bar').style.width = '85%';
        }
        
        const tripsBody = document.getElementById('prof-trips-body');
        if (tripsBody) {
            tripsBody.innerHTML = shipments.map(s => `
                <tr>
                    <td>${s.id.substring(0,8)}</td>
                    <td>${s.pickup.address.split(',')[0]} → ${s.drop.address.split(',')[0]}</td>
                    <td>${new Date(s.created_at).toLocaleDateString()}</td>
                    <td><span class="status-pill" style="font-size:0.7rem;">${s.status}</span></td>
                </tr>
            `).join('');
        }
        
        modal.style.display = 'block';
    } catch(e) {
        console.error("Profile view error:", e);
        alert("Could not load full profile data.");
    }
}

async function approveCheckup(vehicleId) {
    if(!confirm("Approve vehicle checkup and restore health to 100%?")) return;
    try {
        const res = await apiCall(`/manager/vehicles/${vehicleId}/approve-checkup`, 'POST');
        alert("✅ checkup approved: " + res.message);
        loadDriversAndVehicles();
    } catch(e) {
        alert("Failed to approve checkup: " + (e.message || "Error"));
    }
}

window.viewFullProfile = viewFullProfile;
window.approveCheckup = approveCheckup;
window.injectProfileModal = injectProfileModal;
