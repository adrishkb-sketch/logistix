// Dedicated script for manager_shipments.html

let currentAssignId = null;
let currentSplitId = null;
let currentPickerTarget = null;
let smartPickerCallback = null;
let pickedCoords = null;
let pickingMap = null;
let pickingMarker = null;
let smartQueue = [];
let currentSmartShipment = {};
let smartStepIndex = -1;
let smartType = 'shipment';

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
    ]
};


async function loadShipments() {
    try {
        const [shipments, drivers, vehicles] = await Promise.all([
            apiCall(`/shipments/?company_id=${localStorage.getItem('manager_id')}`),
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
                    <div style="font-size:0.7rem; color:var(--text-muted); cursor:${s.loading_blueprint ? 'pointer' : 'default'};" onclick="${s.loading_blueprint ? `viewCargoPlan('${s.id}')` : ''}">
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
                        <td>
                            <div style="font-size:0.8rem; font-weight:600; color:var(--primary);">${lDriverName}</div>
                            <div style="font-size:0.7rem; color:var(--text-muted);">${leg.assigned_driver_id === 'DRONE-SYSTEM' ? '🚁 Drone' : lPlate}</div>
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
        const shipments = await apiCall(`/shipments/?company_id=${localStorage.getItem('manager_id')}`);
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
                                    <img src="${log.photo_url}" style="width:100%; display:block; cursor:zoom-in;" onclick="window.open('${log.photo_url}')">
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

async function confirmCustomerPayment(shipmentId) {
    try {
        await apiCall(`/manager/finance/confirm-payment/${shipmentId}`, 'POST');
        alert("Payment confirmed. Shipping lifecycle now cleared for delivery.");
        initFintechOracle();
        loadInsights();
    } catch (e) { alert("Failed to confirm payment."); }
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
}

window.closeSmartAssistant = function() {
    document.getElementById('smart-assistant-modal').style.display = 'none';
}

window.startNewSmartEntry = function() {
    currentSmartShipment = {};
    smartStepIndex = 0;
    const area = document.getElementById('smart-chat-area');
    area.innerHTML = '';
    const welcomeText = getTranslation(`smart_welcome_${smartType}`, 'en');
    addAiMessage(`👋 ${welcomeText}`);
    askNextSmartStep();
}

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
            const enableSmartInputForMore = () => {
                const input = document.getElementById('smart-command-input');
                if (input) {
                    input.disabled = false;
                    input.placeholder = "Type 'More' to add another...";
                    input.style.opacity = "1";
                    input.focus();
                }
            };
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
                    enableSmartInputForMore();
                }).catch(() => {
                    addAiMessage(getTranslation('error_drone_failed', 'en'));
                    smartStepIndex = 99;
                    enableSmartInputForMore();
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
                    enableSmartInputForMore();
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
}

function processCloningQueue() {
    // Find first shipment in queue that is missing unique fields
    const nextIdx = smartQueue.findIndex(s => s.is_clone && (s.drop === null || s.receiver_name === null));
    
    if (nextIdx === -1) {
        addAiMessage("✅ <b>All clones completed!</b> Your queue is ready.");
        smartStepIndex = 99; // Back to choice mode
        updateSmartUI();
        const input = document.getElementById('smart-command-input');
        if (input) {
            input.disabled = false;
            input.placeholder = "Type 'More' to add another...";
            input.style.opacity = "1";
            input.focus();
        }
        return;
    }

    // Extract it to work on it
    currentSmartShipment = smartQueue[nextIdx];
    smartQueue.splice(nextIdx, 1);
    
    smartStepIndex = 0; // Restart from pickup for this specific clone
    addAiMessage(`🔧 <b>Clone ${currentSmartShipment.clone_index} of ${currentSmartShipment.clone_total}</b>:`);
    askNextSmartStep();
}

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
}

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
}

window.clearSmartQueue = function() {
    smartQueue = [];
    updateSmartUI();
    addAiMessage("🗑️ Queue cleared.");
}

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
}

window.addUserMessage = function(text) {
    const area = document.getElementById('smart-chat-area');
    if (!area) return;
    const msg = document.createElement('div');
    msg.style = 'align-self:flex-end; background:var(--primary); color:white; padding:12px 16px; border-radius:18px 18px 0 18px; font-size:0.95rem; max-width:85%; margin-bottom:12px; line-height:1.4; animation: slideUp 0.3s ease; box-shadow: 0 4px 15px rgba(0,0,0,0.2);';
    msg.innerText = text;
    area.appendChild(msg);
    area.scrollTop = area.scrollHeight;
}

window.pickSmartCoordinates = function() {
    openMapPicker(null, (coords) => {
        document.getElementById('smart-command-input').value = coords;
        // Don't auto-process, let user see it first
    });
}

async function initPage() {
    loadShipments();
}

document.addEventListener('DOMContentLoaded', initPage);