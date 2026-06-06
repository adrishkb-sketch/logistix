// Dedicated Drivers & Fleet Logic for Regional Manager Dashboard

let globalDrivers = [];
let globalVehicles = [];
let globalWarehouses = [];
let globalHubs = [];
let globalDrones = [];
let globalShipments = [];

let currentEditType = '';
let currentEditId = '';

// Bulk data stores
let currentBulkDrivers = [];
let currentBulkVehicles = [];
let currentBulkDrones = [];

// Smart Assistant State
let smartType = 'driver';
let smartStepIndex = -1;
let currentSmartShipment = {};
let smartQueue = [];

const smartConfig = {
    driver: [
        {
            field: 'name',
            promptKey: 'prompt_driver_name',
            validate: val => val.length >= 3,
            error: 'Driver name must be at least 3 characters long.'
        },
        {
            field: 'login_id',
            promptKey: 'prompt_driver_login',
            validate: val => {
                if (val.length < 4) {
                    smartConfig.driver[1].error = 'Login ID must be at least 4 characters long.';
                    return false;
                }
                const taken = globalDrivers.some(d => (d.login_id || '').toLowerCase() === val.toLowerCase());
                if (taken) {
                    smartConfig.driver[1].error = `Login ID "${val}" is already taken. Please enter a unique Login ID.`;
                    return false;
                }
                return true;
            },
            error: 'Login ID must be at least 4 characters long.'
        },
        {
            field: 'password',
            promptKey: 'prompt_driver_password',
            validate: val => val.length >= 1,
            error: 'Password cannot be empty.'
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
            error: 'Please select a base hub.'
        },
        {
            field: 'contact_number',
            promptKey: 'prompt_driver_contact',
            validate: val => /^\d{10}$/.test(val),
            error: 'Contact number must be exactly 10 digits.'
        },
        {
            field: 'experience_years',
            promptKey: 'prompt_driver_exp',
            validate: val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0,
            error: 'Experience must be a positive number.'
        },
        {
            field: 'past_accidents',
            promptKey: 'prompt_driver_accidents',
            validate: val => !isNaN(parseInt(val)) && parseInt(val) >= 0,
            error: 'Accidents count must be a positive integer.'
        },
        {
            field: 'traffic_violations',
            promptKey: 'prompt_driver_violations',
            validate: val => !isNaN(parseInt(val)) && parseInt(val) >= 0,
            error: 'Violations count must be a positive integer.'
        },
        {
            field: 'confirm',
            promptKey: 'prompt_driver_confirm',
            validate: val => ['save', 'reset'].includes(val.toLowerCase()),
            error: 'Type SAVE to confirm, or RESET to cancel.'
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
                if (!/^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(formatted)) {
                    smartConfig.vehicle[1].error = 'Plate must match format: e.g. MH 12 AB 1234';
                    return false;
                }
                const taken = globalVehicles.some(v => (v.number_plate || '').toUpperCase().replace(/\s/g, '') === formatted);
                if (taken) {
                    smartConfig.vehicle[1].error = `Vehicle with number plate "${val}" is already registered. Please enter a unique number plate.`;
                    return false;
                }
                return true;
            },
            error: 'Plate must match format: e.g. MH 12 AB 1234'
        },
        {
            field: 'capacity',
            promptKey: 'prompt_vehicle_capacity',
            validate: val => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
            error: 'Capacity must be a positive number.'
        },
        {
            field: 'base_hub',
            promptKey: 'prompt_vehicle_hub',
            options: 'hubs',
            validate: val => val !== "",
            error: 'Please select a base hub.'
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
            error: 'License must be at least 5 characters long.'
        },
        {
            field: 'base_warehouse_id',
            promptKey: 'prompt_drone_hub',
            options: 'hubs',
            validate: val => val !== "",
            error: 'Please select a base hub.'
        },
        {
            field: 'capacity',
            promptKey: 'prompt_drone_capacity',
            validate: val => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
            error: 'Capacity must be a positive number.'
        },
        {
            field: 'radius',
            promptKey: 'prompt_drone_radius',
            validate: val => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
            error: 'Radius must be a positive number.'
        },
        {
            field: 'confirm',
            promptKey: 'prompt_drone_confirm',
            validate: val => ['save', 'reset'].includes(val.toLowerCase())
        }
    ]
};

// ── On Load Initialization ──────────────────────────────────────────────────

async function init() {
    await loadDriversAndVehicles();
    setupFormListeners();
    setupSmartAssistantListeners();
}

async function loadDriversAndVehicles() {
    try {
        const [drivers, vehicles, warehouses, shipments, drones] = await Promise.all([
            apiCall(`/manager/drivers?company_id=${companyId}`),
            apiCall(`/manager/vehicles?company_id=${companyId}`),
            apiCall(`/manager/warehouses?company_id=${companyId}`),
            apiCall(`/shipments/?company_id=${companyId}`),
            apiCall(`/manager/drones?company_id=${companyId}`).catch(() => [])
        ]);

        globalDrivers = drivers || [];
        globalVehicles = vehicles || [];
        globalWarehouses = warehouses || [];
        globalHubs = warehouses || [];
        globalDrones = drones || [];
        globalShipments = shipments || [];
        
        // Populate Hub Filters and Add-Form Hub dropdowns
        const dHubFilter = document.getElementById('driver-filter-hub');
        const vHubFilter = document.getElementById('vehicle-filter-hub');
        const dHubSelect = document.getElementById('d-hub');
        const vHubSelect = document.getElementById('v-hub');
        const drHubSelect = document.getElementById('drone-base-hub');

        const hubsHtml = '<option value="">All Hubs</option>' + globalWarehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
        const baseHubsHtml = '<option value="">Select Base Hub</option>' + globalWarehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
        
        if (dHubFilter) dHubFilter.innerHTML = hubsHtml;
        if (vHubFilter) vHubFilter.innerHTML = hubsHtml;
        if (dHubSelect) dHubSelect.innerHTML = baseHubsHtml;
        if (vHubSelect) vHubSelect.innerHTML = baseHubsHtml;
        if (drHubSelect) drHubSelect.innerHTML = baseHubsHtml;

        renderDriversTable();
        renderVehiclesTable();
        renderDronesTable();
        renderLinkedPairs();
    } catch(e) {
        console.error("Failed to load dashboard data:", e);
    }
}

// ── Rendering Functions ──────────────────────────────────────────────────────

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
        const matchesSearch = (d.name || '').toLowerCase().includes(searchTerm) || (d.system_id || '').toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || d.license_type === typeFilter;
        const matchesHub = !hubFilter || d.base_warehouse_id === hubFilter;
        return matchesSearch && matchesType && matchesHub;
    });

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
            <td><b>${d.name}</b><br><small style="color:var(--accent); font-family:monospace;">${d.system_id || 'ID: ' + d.id.substring(0,8)}</small></td>
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
            dSelect.innerHTML += `<option value="${d.id}">${d.name} (${d.system_id || d.id.substring(0,8)}) - ${baseWh ? baseWh.name : 'No Hub'}</option>`;
        }
    });

    renderTableControls('drivers', filtered.length, window.tableLimits.drivers, 'renderDriversTable');
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
    const statusFilter = document.getElementById('vehicle-filter-status')?.value || '';
    const sortMode = document.getElementById('vehicle-sort')?.value || 'type';

    let filtered = globalVehicles.filter(v => {
        const matchesSearch = (v.number_plate || '').toLowerCase().includes(searchTerm) || (v.system_id || '').toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || v.type === typeFilter;
        const matchesHub = !hubFilter || v.base_warehouse_id === hubFilter;
        const matchesStatus = !statusFilter || v.status === statusFilter;
        return matchesSearch && matchesType && matchesHub && matchesStatus;
    });

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
        const linkedDriver = globalDrivers.find(d => d.assigned_vehicle_id === v.id);
        let healthColor = v.vehicle_health_score > 80 ? 'var(--success)' : (v.vehicle_health_score > 60 ? 'var(--warning)' : 'var(--danger)');
        
        let statusBadge = '';
        if (activeShipment) {
            statusBadge = `<span class="badge" style="background:var(--primary)22; color:var(--primary);">ON MISSION</span>`;
        } else if (v.is_operational === false) {
            statusBadge = `<span class="badge" style="background:var(--danger)22; color:var(--danger);">BREAKDOWN</span>`;
        } else {
            statusBadge = `<span class="badge" style="background:var(--success)22; color:var(--success);">READY</span>`;
        }

        vtbody.innerHTML += `<tr>
            <td><b>${v.type}</b><br><small style="color:var(--accent); font-family:monospace;">${v.system_id || 'ID: ' + v.id.substring(0,8)}</small></td>
            <td><b style="font-family:monospace; letter-spacing:1px;">${formatDisplayPlate(v.number_plate)}</b></td>
            <td><span style="color:${healthColor}; font-weight:bold;">${v.vehicle_health_score || 100}%</span></td>
            <td><b>${v.capacity || 0} kg</b><br><small>Eff: ${v.fuel_efficiency || 15} km/l</small></td>
            <td><small>${baseWh ? baseWh.name : 'N/A'}</small></td>
            <td><span style="color:var(--text-muted);">Stationary</span></td>
            <td>${statusBadge}</td>
            <td>${linkedDriver ? `<b>${linkedDriver.name}</b>` : '<span style="opacity:0.4;">Unlinked</span>'}</td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="btn-primary btn-accent" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="openEditModal('vehicles', '${v.id}')" title="Edit">✏️</button>
                    <button class="btn-primary btn-danger" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="deleteItem('vehicles', '${v.id}')" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>`;

        if (vSelect && !linkedDriver) {
            vSelect.innerHTML += `<option value="${v.id}">${v.type} (${formatDisplayPlate(v.number_plate)}) - ${baseWh ? baseWh.name : 'No Hub'}</option>`;
        }
    });

    renderTableControls('vehicles', filtered.length, window.tableLimits.vehicles, 'renderVehiclesTable');
};

window.renderDronesTable = function() {
    const dtbody = document.getElementById('drones-table-body');
    if (!dtbody) return;

    dtbody.innerHTML = '';
    const searchTerm = (document.getElementById('drone-search')?.value || '').toLowerCase();
    const limit = window.tableLimits.drones;

    let filtered = globalDrones.filter(d => {
        return (d.license_number || '').toLowerCase().includes(searchTerm) || (d.system_id || '').toLowerCase().includes(searchTerm);
    });

    const limited = filtered.slice(0, limit);

    limited.forEach(d => {
        const wh = globalWarehouses.find(w => w.id === d.base_warehouse_id);
        const statusBadge = `<span class="badge" style="background:var(--success)22; color:var(--success);">READY</span>`;
        
        dtbody.innerHTML += `<tr>
            <td><b style="font-family:monospace;">${d.license_number}</b><br><small style="color:var(--accent);">${d.system_id || 'ID: ' + d.id.substring(0,8)}</small></td>
            <td><b>${d.capacity} kg</b></td>
            <td><b>${d.radius} km</b></td>
            <td><small>${wh ? wh.name : 'N/A'}</small></td>
            <td>${statusBadge}</td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="btn-primary btn-accent" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="openEditModal('drones', '${d.id}', '${d.license_number}', '${d.base_warehouse_id}', '${d.capacity}', '${d.radius}')" title="Edit">✏️</button>
                    <button class="btn-primary btn-danger" style="padding:6px; border-radius:6px; width:30px; height:30px;" onclick="deleteItem('drones', '${d.id}')" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>`;
    });

    renderTableControls('drones', filtered.length, limit, 'renderDronesTable');
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
            <td><b>${d.name}</b><br><small>${d.system_id || d.id.substring(0,8)}</small></td>
            <td><b>${vehicle ? vehicle.type : 'Unknown'}</b><br><small>${vehicle ? formatDisplayPlate(vehicle.number_plate) : 'N/A'}</small></td>
            <td><small>${hub ? hub.name : 'N/A'}</small></td>
            <td style="text-align: center;">
                <button class="btn-primary btn-danger" style="padding:6px 16px; font-size:0.75rem;" onclick="unlinkVehicle('${d.id}')">Unlink</button>
            </td>
        </tr>`;
    });
    renderTableControls('linked-pairs', filtered.length, limit, 'renderLinkedPairs');
};

window.unlinkVehicle = async function(driverId) {
    if (!confirm("Are you sure you want to unlink this vehicle and driver?")) return;
    try {
        await apiCall(`/manager/unlink-vehicle?driver_id=${driverId}`, 'POST');
        showNotification("Successfully unlinked driver and vehicle", "success");
        loadDriversAndVehicles();
    } catch(e) {
        alert("Failed to unlink.");
    }
};

window.handlePlateInput = function(input) {
    let val = input.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (val.length > 10) val = val.substring(0, 10);
    
    let formatted = "";
    for (let i = 0; i < val.length; i++) {
        if (i === 2 || i === 4 || i === 6) formatted += " ";
        formatted += val[i];
    }
    input.value = formatted;
    
    // Warning checking
    const clean = val.replace(/\s/g, '');
    const warning = document.getElementById('plate-warning');
    if (warning) {
        const duplicate = globalVehicles.some(v => v.number_plate.toUpperCase().replace(/\s/g, '') === clean);
        warning.style.display = duplicate ? 'block' : 'none';
    }
};

window.autoAssignFleet = async function() {
    if (!confirm("Are you sure you want to automatically link all unassigned drivers and vehicles? This will match them based on base hub and vehicle type.")) return;
    try {
        const res = await apiCall(`/manager/auto-assign-fleet?company_id=${companyId}`, 'POST');
        alert(res.message);
        loadDriversAndVehicles();
    } catch (e) {
        console.error("Auto-assign failed:", e);
    }
};

// ── CRUD Listeners ──────────────────────────────────────────────────────────

function setupFormListeners() {
    // Add Driver
    document.getElementById('add-driver-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const exp = parseFloat(document.getElementById('d-exp').value || 0);
            const accidents = parseInt(document.getElementById('d-accidents').value || 0);
            const challans = parseInt(document.getElementById('d-challans').value || 0);

            // Algorithmic Safety Rating Logic
            let safetyRating = 5.0;
            safetyRating -= (accidents * 1.0); 
            safetyRating -= (challans * 0.2);   
            safetyRating += (exp * 0.1);       
            safetyRating = Math.max(1.0, Math.min(5.0, safetyRating)); 

            const contactVal = document.getElementById('d-contact').value;
            const formattedContact = contactVal.length === 10 ? "+91" + contactVal : contactVal;

            const driverData = {
                company_id: companyId,
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
                contact_number: formattedContact
            };
            await apiCall('/manager/drivers', 'POST', driverData);
            document.getElementById('add-driver-form').reset();
            showNotification("Driver registered successfully!", "success");
            loadDriversAndVehicles();
        } catch(e) {
            console.error(e);
            showNotification("Failed to register driver: " + e.message, "error");
        }
    });

    // Add Vehicle
    document.getElementById('add-vehicle-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const vehicleData = {
                company_id: companyId,
                type: document.getElementById('v-type').value,
                number_plate: document.getElementById('v-plate').value.replace(/\s/g, '').toUpperCase(),
                capacity: parseFloat(document.getElementById('v-cap').value),
                base_warehouse_id: document.getElementById('v-hub').value,
                fuel_efficiency: parseFloat(document.getElementById('v-eff').value || 15),
                status: 'available',
                vehicle_health_score: 100.0
            };
            await apiCall('/manager/vehicles', 'POST', vehicleData);
            document.getElementById('add-vehicle-form').reset();
            showNotification("Vehicle registered successfully!", "success");
            loadDriversAndVehicles();
        } catch(e) {
            console.error(e);
            showNotification("Failed to register vehicle: " + e.message, "error");
        }
    });

    // Add Drone
    document.getElementById('add-drone-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const droneData = {
                license_number: document.getElementById('drone-license').value,
                base_warehouse_id: document.getElementById('drone-base-hub').value,
                capacity: parseFloat(document.getElementById('drone-capacity').value),
                radius: parseFloat(document.getElementById('drone-radius').value),
                company_id: companyId,
                status: 'available'
            };
            await apiCall('/manager/drones', 'POST', droneData);
            document.getElementById('add-drone-form').reset();
            showNotification("Drone registered successfully!", "success");
            loadDriversAndVehicles();
        } catch(e) {
            console.error(e);
            showNotification("Failed to register drone: " + e.message, "error");
        }
    });

    // Link Pairing
    document.getElementById('link-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const dId = document.getElementById('link-driver').value;
            const vId = document.getElementById('link-vehicle').value;
            await apiCall('/manager/link-vehicle', 'POST', { driver_id: dId, vehicle_id: vId });
            showNotification("Successfully linked driver and vehicle!", "success");
            loadDriversAndVehicles();
        } catch (e) {
            showNotification("Failed to link pairing: " + e.message, "error");
        }
    });

    // Edit Modal Form
    document.getElementById('edit-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        let payload = { company_id: companyId };
        let endpoint = `/${currentEditType}/${currentEditId}`;
        
        if (currentEditType === 'drivers') {
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
                number_plate: document.getElementById('edit-v-plate').value.replace(/\s/g, '').toUpperCase(),
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
            loadDriversAndVehicles();
        } catch(err) {
            showNotification("Failed to update: " + err.message, "error");
        }
    });
}

window.deleteItem = async function(type, id) {
    if (!confirm(`Delete this ${type.slice(0,-1)}?`)) return;
    try {
        await apiCall(`/manager/${type}/${id}?company_id=${companyId}`, 'DELETE');
        showNotification("Item deleted", "success");
        loadDriversAndVehicles();
    } catch(e) { alert("Delete failed."); }
};

window.openEditModal = function(type, id, val1, val2, val3, val4) {
    currentEditType = type;
    currentEditId = id;
    document.getElementById('edit-type').innerText = type.charAt(0).toUpperCase() + type.slice(1);
    
    let html = '';
    const fieldStyle = `style="width:100%; padding:0.8rem; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border); border-radius:10px; font-family:inherit; font-size:0.95rem; margin-top:5px;"`;
    const labelStyle = `style="font-size:0.8rem; color:var(--primary); margin-top:10px; display:block;"`;
    const types = ['bike', 'scooty', 'van', 'truck', '3 wheeled (battery)'];

    if (type === 'drones') {
        const hubOptions = (globalWarehouses || []).map(w => `<option value="${w.id}" ${w.id === val2 ? 'selected' : ''}>${w.name}</option>`).join('');
        html = `<div style="display:flex;flex-direction:column;gap:5px;">
                    <label ${labelStyle}>License Number</label>
                    <input type="text" id="edit-dr-license" value="${val1 || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Base Warehouse</label>
                    <select id="edit-dr-hub" ${fieldStyle}>
                        ${hubOptions}
                    </select>
                    <label ${labelStyle}>Capacity (kg)</label>
                    <input type="number" id="edit-dr-cap" value="${val3 || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Flight Radius (km)</label>
                    <input type="number" id="edit-dr-rad" value="${val4 || ''}" ${fieldStyle}>
                </div>`;
    } else if (type === 'drivers') {
        const d = globalDrivers.find(item => item.id === id);
        html = `<div style="display:flex;flex-direction:column;gap:5px;">
                    <label ${labelStyle}>Full Name</label>
                    <input type="text" id="edit-d-name" value="${d.name || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Login ID</label>
                    <input type="text" id="edit-d-login" value="${d.login_id || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Password</label>
                    <input type="text" id="edit-d-pass" value="${d.password || ''}" ${fieldStyle}>
                    <label ${labelStyle}>License Type</label>
                    <select id="edit-d-license" ${fieldStyle}>
                        ${types.map(t => `<option value="${t}" ${t === d.license_type ? 'selected' : ''}>${t.toUpperCase()}</option>`).join('')}
                    </select>
                    <label ${labelStyle}>Years of Experience</label>
                    <input type="number" id="edit-d-exp" value="${d.years_experience || 0}" ${fieldStyle}>
                    <label ${labelStyle}>Contact Number</label>
                    <input type="text" id="edit-d-contact" value="${d.contact_number || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Base Hub</label>
                    <select id="edit-d-hub" ${fieldStyle}>
                        ${globalWarehouses.map(w => `<option value="${w.id}" ${w.id === d.base_warehouse_id ? 'selected' : ''}>${w.name}</option>`).join('')}
                    </select>
                </div>`;
    } else if (type === 'vehicles') {
        const v = globalVehicles.find(item => item.id === id);
        html = `<div style="display:flex;flex-direction:column;gap:5px;">
                    <label ${labelStyle}>Number Plate</label>
                    <input type="text" id="edit-v-plate" value="${v.number_plate || ''}" ${fieldStyle}>
                    <label ${labelStyle}>Vehicle Type</label>
                    <select id="edit-v-type" ${fieldStyle}>
                        ${types.map(t => `<option value="${t}" ${t === v.type ? 'selected' : ''}>${t.toUpperCase()}</option>`).join('')}
                    </select>
                    <label ${labelStyle}>Capacity (kg)</label>
                    <input type="number" id="edit-v-cap" value="${v.capacity || 0}" ${fieldStyle}>
                    <label ${labelStyle}>Fuel Efficiency (km/l)</label>
                    <input type="number" id="edit-v-eff" value="${v.fuel_efficiency || 0}" ${fieldStyle}>
                    <label ${labelStyle}>Base Hub</label>
                    <select id="edit-v-hub" ${fieldStyle}>
                        ${globalWarehouses.map(w => `<option value="${w.id}" ${w.id === v.base_warehouse_id ? 'selected' : ''}>${w.name}</option>`).join('')}
                    </select>
                </div>`;
    }
    document.getElementById('edit-fields').innerHTML = html;
    document.getElementById('edit-modal').style.display = 'block';
};

// ── Bulk Upload Managers ──────────────────────────────────────────────────────

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
    const drivers = data.drivers || [];
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

window.confirmDriverBulk = async function() {
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
    const vehicles = data.vehicles || [];
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

window.confirmVehicleBulk = async function() {
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
    const drones = data.drones || [];
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

window.confirmDroneBulk = async function() {
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
};

// ── Smart Assistant Logic ───────────────────────────────────────────────────

window.openSmartAssistant = function(type = 'driver') {
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

    if (typeof updatePageTranslations === 'function') {
        updatePageTranslations();
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
    if (area) area.innerHTML = '';
    const welcomeText = getTranslation(`smart_welcome_${smartType}`, 'en');
    addAiMessage(`👋 ${welcomeText}`);
    askNextSmartStep();
};

function askNextSmartStep() {
    const steps = smartConfig[smartType];
    let step = steps[smartStepIndex];
    if (!step) return;

    let prompt = getTranslation(step.promptKey, 'en');
    
    if (step.field === 'confirm') {
        const s = currentSmartShipment;
        let summary = "";
        if (smartType === 'driver') {
            summary = `• ${getTranslation('label_name', 'en')}: ${s.name}<br>• ${getTranslation('label_id', 'en')}: ${s.login_id}<br>• ${getTranslation('label_type', 'en')}: ${s.license_type}<br>• ${getTranslation('label_hub', 'en')}: ${s.base_hub}<br>• ${getTranslation('label_exp', 'en')}: ${s.experience_years}y | ${getTranslation('label_acc', 'en')}: ${s.past_accidents} | ${getTranslation('label_viol', 'en')}: ${s.traffic_violations}`;
        } else if (smartType === 'vehicle') {
            summary = `• ${getTranslation('label_type', 'en')}: ${s.type}<br>• ${getTranslation('label_plate', 'en')}: ${s.number_plate}<br>• ${getTranslation('label_cap', 'en')}: ${s.capacity}kg<br>• ${getTranslation('label_hub', 'en')}: ${s.base_hub}`;
        } else if (smartType === 'drone') {
            summary = `• ${getTranslation('label_license', 'en')}: ${s.license_number}<br>• ${getTranslation('label_hub', 'en')}: ${s.base_warehouse_id}<br>• ${getTranslation('label_cap', 'en')}: ${s.capacity}kg<br>• ${getTranslation('label_radius', 'en')}: ${s.radius}km`;
        }
        prompt = prompt.replace('{summary}', summary);
        
        // Show selection options for confirm (SAVE or Cancel)
        const area = document.getElementById('smart-chat-area');
        addAiMessage(prompt);
        
        const optDiv = document.createElement('div');
        optDiv.style = 'display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;';
        
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-primary';
        saveBtn.style = 'width:auto; padding:6px 12px; font-size:0.75rem; background:var(--success);';
        saveBtn.innerText = "SAVE";
        saveBtn.onclick = () => {
            document.getElementById('smart-command-input').value = "SAVE";
            processSmartCommand();
        };
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-primary';
        cancelBtn.style = 'width:auto; padding:6px 12px; font-size:0.75rem; background:rgba(239, 68, 68, 0.15); border:1px solid rgba(239, 68, 68, 0.3); color:var(--danger);';
        cancelBtn.innerText = "Cancel";
        cancelBtn.onclick = () => {
            document.getElementById('smart-command-input').value = "RESET";
            processSmartCommand();
        };

        optDiv.appendChild(saveBtn);
        optDiv.appendChild(cancelBtn);
        area.appendChild(optDiv);
        area.scrollTop = area.scrollHeight;
        
        const input = document.getElementById('smart-command-input');
        if (input) {
            input.disabled = true;
            input.placeholder = "Please select from the options above...";
            input.style.opacity = "0.5";
        }
        return;
    }
    
    addAiMessage(prompt);
    
    // Dropdown/Option Handling
    const input = document.getElementById('smart-command-input');
    if (step.options) {
        const area = document.getElementById('smart-chat-area');
        const select = document.createElement('select');
        select.className = 'polished-glass-input';
        select.style = 'margin-bottom:10px; width:auto; min-width:240px; max-width:100%; padding: 4px 10px !important; height: 36px !important; font-size: 0.85rem !important; animation: slideUp 0.3s ease; flex: none !important;';
        
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
        if (input) {
            input.disabled = false;
            input.placeholder = "Type response...";
            input.style.opacity = "1";
        }
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

    if (smartStepIndex === 99) {
        if (text.toLowerCase().includes('more') || text.toLowerCase().includes('new')) {
            startNewSmartEntry();
        } else {
            addAiMessage(getTranslation('msg_type_more', 'en'));
        }
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
        const err = step.error ? step.error : getTranslation('err_invalid_input', 'en');
        addAiMessage(`❌ ${err}`);
        return;
    }

    if (step.field === 'confirm') {
        if (text.toLowerCase() === 'save') {
            if (smartType === 'drone') {
                const dronePayload = {
                    license_number: currentSmartShipment.license_number,
                    base_warehouse_id: globalWarehouses.find(w => w.name === currentSmartShipment.base_warehouse_id || w.name === currentSmartShipment.base_hub)?.id || currentSmartShipment.base_warehouse_id || currentSmartShipment.base_hub,
                    capacity: parseFloat(currentSmartShipment.capacity),
                    radius: parseFloat(currentSmartShipment.radius),
                    company_id: companyId,
                    status: 'available'
                };
                apiCall('/manager/drones', 'POST', dronePayload).then(() => {
                    addAiMessage(getTranslation('msg_drone_registered', 'en'));
                    loadDriversAndVehicles();
                    addAiMessage(getTranslation('msg_type_more', 'en'));
                    smartStepIndex = 99; 
                }).catch(() => {
                    addAiMessage(getTranslation('error_drone_failed', 'en'));
                    smartStepIndex = 99;
                });
            } else {
                smartQueue.push({ ...currentSmartShipment });
                updateSmartUI();
                
                addAiMessage(getTranslation('msg_added_to_queue', 'en'));
                addAiMessage(getTranslation('msg_type_more', 'en'));
                smartStepIndex = 99; 
            }
        } else {
            startNewSmartEntry();
        }
        return;
    }

    currentSmartShipment[step.field] = text;
    smartStepIndex++;
    askNextSmartStep();
};

window.confirmSmartQueue = async function() {
    if (smartQueue.length === 0) return;
    const count = smartQueue.length;
    addAiMessage(`🚀 Syncing ${count} entries with server...`);
    
    try {
        for (const s of smartQueue) {
            let endpoint = '';
            let data = {};
            
            if (smartType === 'driver') {
                endpoint = '/manager/drivers';
                const hub = globalHubs.find(h => h.name === s.base_hub);
                data = {
                    name: s.name,
                    login_id: s.login_id,
                    password: s.password,
                    license_type: s.license_type,
                    base_warehouse_id: hub ? hub.id : null,
                    years_experience: parseFloat(s.experience_years),
                    past_accidents: parseInt(s.past_accidents),
                    traffic_violations: parseInt(s.traffic_violations),
                    challan_count: parseInt(s.traffic_violations),
                    driving_score: 100.0,
                    safety_rating: (5.0 - (parseInt(s.past_accidents) * 1.0) - (parseInt(s.traffic_violations) * 0.2) + (parseFloat(s.experience_years) * 0.1)).toFixed(1),
                    on_time_rate: 100,
                    contact_number: s.contact_number.startsWith('+91') ? s.contact_number : "+91" + s.contact_number,
                    company_id: companyId
                };
            } else if (smartType === 'vehicle') {
                endpoint = '/manager/vehicles';
                const hub = globalHubs.find(h => h.name === s.base_hub);
                data = {
                    type: s.type,
                    number_plate: s.number_plate.toUpperCase().replace(/\s/g, ''),
                    capacity: parseFloat(s.capacity),
                    fuel_efficiency: 15,
                    base_warehouse_id: hub ? hub.id : null,
                    company_id: companyId,
                    status: 'available',
                    vehicle_health_score: 100.0
                };
            }
            
            await apiCall(endpoint, 'POST', data);
        }
        showNotification(`Successfully created ${count} ${smartType}s!`, "success");
        clearSmartQueue();
        loadDriversAndVehicles();
    } catch (e) {
        addAiMessage(`❌ Error creating ${smartType}. Check console.`);
        console.error(e);
    }
};

window.updateSmartUI = function() {
    const count = smartQueue.length;
    const countEl = document.getElementById('smart-queue-count');
    if (countEl) countEl.innerText = count;
    
    const label = document.getElementById('smart-queue-text');
    if (label) {
        if (smartType === 'driver') label.innerText = count === 1 ? 'Driver' : 'Drivers';
        else if (smartType === 'vehicle') label.innerText = count === 1 ? 'Vehicle' : 'Vehicles';
        else label.innerText = count === 1 ? 'Shipment' : 'Shipments';
    }
    
    const preview = document.getElementById('smart-queue-preview');
    if (preview) preview.style.display = count > 0 ? 'block' : 'none';
};

window.clearSmartQueue = function() {
    smartQueue = [];
    updateSmartUI();
    addAiMessage("🗑️ Queue cleared.");
};

window.addAiMessage = function(text) {
    const area = document.getElementById('smart-chat-area');
    if (!area) return;

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
    msg.className = 'user-msg';
    msg.style = 'align-self:flex-end; background:var(--primary); color:white; padding:12px 16px; border-radius:18px 18px 0 18px; font-size:0.95rem; max-width:85%; margin-bottom:12px; line-height:1.4; animation: slideUp 0.3s ease;';
    msg.innerText = text;
    area.appendChild(msg);
    area.scrollTop = area.scrollHeight;
};

function setupSmartAssistantListeners() {
    document.getElementById('smart-command-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            processSmartCommand();
        }
    });
}

// ── Broadcaster ─────────────────────────────────────────────────────────────

window.openBroadcastModal = function() {
    const modal = document.getElementById('broadcast-modal');
    const input = document.getElementById('broadcast-input');
    if (modal) modal.style.display = 'block';
    if (input) {
        input.value = '';
        input.focus();
    }
};

window.closeBroadcastModal = function() {
    const modal = document.getElementById('broadcast-modal');
    if (modal) modal.style.display = 'none';
};

window.sendBroadcast = async function() {
    const input = document.getElementById('broadcast-input');
    const btn = document.getElementById('broadcast-confirm-btn');
    const text = input ? input.value.trim() : "";
    
    if (!text) return alert("Please type a message to broadcast.");
    
    const originalText = btn.innerText;
    
    try {
        btn.disabled = true;
        btn.innerText = "Sending... ⏳";
        
        await apiCall('/tracking/broadcast', 'POST', {
            company_id: companyId,
            message: text
        });
        showNotification("Announcement broadcasted successfully to all drivers!", "success");
        closeBroadcastModal();
    } catch (e) {
        alert("Broadcast failed: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
};

// ── DOM Initializer ─────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
