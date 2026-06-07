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
let currentLookedUpReceiverId = null;

const ICON_PICKER = L.divIcon({
    html: `<div style="background:var(--accent); width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px var(--accent); font-size:12px; color:black;">📍</div>`,
    className: 'custom-marker', iconSize: [24, 24], iconAnchor: [12, 12]
});

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
        const companyId = localStorage.getItem('manager_id');
        const [shipments, drivers, vehicles, activeAlerts] = await Promise.all([
            apiCall(`/shipments/?company_id=${companyId}`),
            apiCall(`/manager/drivers?company_id=${companyId}`),
            apiCall(`/manager/vehicles?company_id=${companyId}`),
            apiCall(`/tracking/alerts/active?company_id=${companyId}`)
        ]);
        globalShipments = shipments;
        globalDrivers = drivers;
        globalVehicles = vehicles;
        window.globalActiveAlerts = activeAlerts || [];
        
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

            const affectedAlert = (window.globalActiveAlerts || []).find(al => al.shipment_id === s.id);
            let calamityBadge = '';
            if (affectedAlert) {
                calamityBadge = `
                    <div style="background:rgba(239, 68, 68, 0.15); border:1px solid var(--danger); color:var(--danger); font-size:0.7rem; font-weight:bold; padding:4px 8px; border-radius:6px; margin-top:5px; display:inline-block;">
                        ⚠️ Calamity: ${affectedAlert.type ? affectedAlert.type.toUpperCase() : 'Hazard'}
                    </div>
                `;
            } else if (s.stage && (s.stage.includes('Halted: Disaster Zone') || s.stage.includes('Diverted: Safe Hub'))) {
                calamityBadge = `
                    <div style="background:rgba(239, 68, 68, 0.15); border:1px solid var(--danger); color:var(--danger); font-size:0.7rem; font-weight:bold; padding:4px 8px; border-radius:6px; margin-top:5px; display:inline-block;">
                        ⚠️ Halted by AI
                    </div>
                `;
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
                    ${calamityBadge}
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
                    <button class="btn-primary" style="padding:6px 12px; font-size:0.7rem; width:auto; background:var(--accent); margin-bottom:4px;" onclick="openShipmentDetailModal('${s.id}')">
                        ⚡ <span data-i18n="btn_manage">Manage</span>
                    </button>
                    <button class="btn-primary" style="padding:6px 12px; font-size:0.7rem; width:auto; background:var(--primary);" onclick="checkShipmentWeather('${s.id}')">
                        🌦️ Weather Check
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

                    const legAffectedAlert = (window.globalActiveAlerts || []).find(al => al.shipment_id === leg.id);
                    let legCalamityBadge = '';
                    if (legAffectedAlert) {
                        legCalamityBadge = `
                            <div style="background:rgba(239, 68, 68, 0.15); border:1px solid var(--danger); color:var(--danger); font-size:0.65rem; font-weight:bold; padding:2px 4px; border-radius:4px; margin-top:2px;">
                                ⚠️ ${legAffectedAlert.type ? legAffectedAlert.type.toUpperCase() : 'Hazard'}
                            </div>
                        `;
                    } else if (leg.stage && (leg.stage.includes('Halted: Disaster Zone') || leg.stage.includes('Diverted: Safe Hub'))) {
                        legCalamityBadge = `
                            <div style="background:rgba(239, 68, 68, 0.15); border:1px solid var(--danger); color:var(--danger); font-size:0.65rem; font-weight:bold; padding:2px 4px; border-radius:4px; margin-top:2px;">
                                ⚠️ Halted by AI
                            </div>
                        `;
                    }

                    lTr.innerHTML = `
                        <td style="padding-left:30px; font-size:0.8rem; color:var(--text-muted);">↳ Leg ${leg.leg_order}: ${leg.description}</td>
                        <td>---</td>
                        <td>
                            <span class="status-pill status-${leg.status}" style="font-size:0.6rem;">${leg.status.toUpperCase()}</span>
                            ${legCalamityBadge}
                        </td>
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
                            <button class="btn-primary" style="padding:4px 8px; font-size:0.6rem; width:auto; background:rgba(255,255,255,0.1); margin-bottom:2px;" onclick="openShipmentDetailModal('${leg.id}')">
                                ⚡ <span data-i18n="btn_manage">Manage</span>
                            </button>
                            <button class="btn-primary" style="padding:4px 8px; font-size:0.6rem; width:auto; background:var(--primary);" onclick="checkShipmentWeather('${leg.id}')">
                                🌦️ Weather Check
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
        if (shipment.stage === 'Vehicle Breakdown' || shipment.stage === 'Halted: Calamity Zone' || shipment.stage === 'Rescue Dispatched' || shipment.stage === 'Recovering') {
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

    const setupMarker = () => {
        if (targetId) {
            const el = document.getElementById(targetId);
            const currentVal = el ? el.value : '';
            if (currentVal && currentVal.includes(',')) {
                const [lat, lng] = currentVal.split(',').map(s => parseFloat(s.trim()));
                if (!isNaN(lat) && !isNaN(lng)) {
                    const ll = L.latLng(lat, lng);
                    pickingMap.setView(ll, 12);
                    pickingMarker = L.marker(ll, { icon: ICON_PICKER }).addTo(pickingMap);
                    pickedCoords = { lat, lng };
                    document.getElementById('current-pick-display').innerText = `Current: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                }
            }
        }
    };

    if (!pickingMap) {
        pickingMap = L.map('picking-map').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png').addTo(pickingMap);
        applyOfficialBorders(pickingMap);
    }

    pickingMap.off('click');
    pickingMap.on('click', function(e) {
        const { lat, lng } = e.latlng;
        pickedCoords = { lat, lng };
        if (pickingMarker) {
            pickingMarker.setLatLng(e.latlng);
        } else {
            pickingMarker = L.marker(e.latlng, { icon: ICON_PICKER }).addTo(pickingMap);
        }
        document.getElementById('current-pick-display').innerText = `Selected: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    });

    setTimeout(() => {
        pickingMap.invalidateSize();
        if (pickingMarker) {
            pickingMap.removeLayer(pickingMarker);
            pickingMarker = null;
        }
        setupMarker();
    }, 100);
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

// Variables for Shipment Forms, Chat, and Tracking
let miniChatShipmentId = null;
let miniChatDriverId = null;
let miniChatMsgs = [];
let miniChatMediaData = null; 
let miniChatMediaRecorder = null;
let miniChatRecording = false;
let trackMap = null;
let trackMarkers = [];

// Form submission handler for manual shipment creation
document.getElementById('create-shipment-form')?.addEventListener('submit', async (e) => {
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
        showNotification("Failed to create shipment: " + (e.detail || "Server error"), "danger");
    }
});

// Receiver auto-lookup logic
window.lookupReceiverByEmail = async function(email) {
    const statusDiv = document.getElementById('receiver-lookup-status');
    const nameInput = document.getElementById('receiver-name');
    const phoneInput = document.getElementById('receiver-phone');
    
    if (!email || !email.includes('@')) {
        if (statusDiv) statusDiv.style.display = 'none';
        return;
    }

    try {
        const company_id = localStorage.getItem('manager_id');
        const receivers = await apiCall(`/manager/receivers?company_id=${company_id}`);
        const found = receivers.find(r => r.email.toLowerCase() === email.toLowerCase());

        if (found) {
            currentLookedUpReceiverId = found.id;
            if (statusDiv) {
                statusDiv.innerHTML = `<span style="color:var(--success); font-weight:700;">✅ Found: ${found.name} (${found.id})</span>`;
                statusDiv.style.display = 'block';
            }
            if (nameInput) {
                nameInput.value = found.name;
                nameInput.disabled = true;
                nameInput.style.opacity = '0.5';
            }
            if (phoneInput) {
                phoneInput.value = found.phone.replace("+91", "");
                phoneInput.disabled = true;
                phoneInput.style.opacity = '0.5';
            }
        } else {
            currentLookedUpReceiverId = null;
            if (statusDiv) {
                statusDiv.innerHTML = `<span style="color:var(--primary); font-weight:700;">🆕 New Receiver Record</span>`;
                statusDiv.style.display = 'block';
            }
            if (nameInput) {
                nameInput.disabled = false;
                nameInput.style.opacity = '1';
            }
            if (phoneInput) {
                phoneInput.disabled = false;
                phoneInput.style.opacity = '1';
            }
        }
    } catch (err) {
        console.error("Receiver lookup failed", err);
    }
};

// Open details modal
window.toggleVerificationCodesDisplay = function(btn) {
    const el = document.getElementById('sd-verification-codes');
    if (el) {
        const isHidden = el.style.display === 'none';
        el.style.display = isHidden ? 'block' : 'none';
        btn.innerText = isHidden ? '🙈 Hide Codes' : '👁️ Show Codes';
    }
};

window.toggleManualOverride = function() {
    const el = document.getElementById('manual-override-controls');
    if (el) {
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
};

window.renderEslLedger = async function(s) {
    const lockAnim = document.getElementById('escrow-lock-anim');
    const statusText = document.getElementById('escrow-status-text');
    const blocksContainer = document.getElementById('escrow-blocks');
    if (!lockAnim || !statusText || !blocksContainer) return;

    // SLA Heuristics: SLA violated if delay > 30 minutes
    const delay = s.performance_stats?.delay_mins || 0;
    const isDelayed = delay > 30;
    const isDelivered = s.status === 'delivered';
    const isSlaViolated = isDelayed;

    if (isDelivered) {
        if (isSlaViolated) {
            lockAnim.innerHTML = '🔒';
            lockAnim.style.color = 'var(--danger)';
            statusText.innerHTML = `<span style="color:var(--danger)">🚨 SLA VIOLATED (Delay: ${delay}m). Escrow Locked (Payout Frozen).</span>`;
        } else {
            lockAnim.innerHTML = '🔓';
            lockAnim.style.color = '#10b981';
            statusText.innerHTML = `<span style="color:#10b981">✅ SLA MET. Cryptographic Escrow Released (Payout Settled).</span>`;
        }
    } else {
        lockAnim.innerHTML = '🔒';
        lockAnim.style.color = '#3b82f6';
        statusText.innerHTML = `<span style="color:#3b82f6">⏳ Shipment In Transit. Escrow Funds Safely Locked.</span>`;
    }

    // Helper function for SHA-256
    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const genesisText = `GenesisBlock-${s.id}-${s.created_at || ''}`;
    const h0 = await sha256(genesisText);
    
    const dispatchText = `DispatchBlock-${s.assigned_driver_id || 'unassigned'}-${h0}`;
    const h1 = await sha256(dispatchText);

    const telemetryText = `TelemetryBlock-${s.current_location?.lat || '0'}-${s.current_location?.lng || '0'}-${h1}`;
    const h2 = await sha256(telemetryText);

    const settlementText = `SettlementBlock-${s.payment_status || 'unpaid'}-${h2}`;
    const h3 = await sha256(settlementText);

    const blocks = [
        { name: '0. Genesis', desc: 'Created & Logged', hash: h0, time: s.created_at ? new Date(s.created_at).toLocaleString() : 'N/A' },
        { name: '1. Dispatch', desc: `Assigned Driver ID: ${s.assigned_driver_id ? s.assigned_driver_id.substring(0,8) : 'None'}`, hash: h1, time: s.created_at ? new Date(s.created_at).toLocaleString() : 'N/A' },
        { name: '2. Telemetry', desc: 'Route Trajectory Checkpoint', hash: h2, time: 'Live Updates Active' }
    ];

    if (isDelivered) {
        blocks.push({
            name: '3. Settlement',
            desc: isSlaViolated ? 'Escrow Held (SLA breach)' : 'Funds Disbursed to Driver Wallet',
            hash: h3,
            time: 'Finalized'
        });
    }

    blocksContainer.innerHTML = blocks.map(b => `
        <div style="font-family:monospace; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.05); padding:8px; border-radius:6px; font-size:0.75rem; display:flex; flex-direction:column; gap:2px;">
            <div style="display:flex; justify-content:space-between; font-weight:bold;">
                <span style="color:var(--primary);">${b.name}</span>
                <span style="color:var(--text-muted); font-size:0.7rem;">${b.time}</span>
            </div>
            <div style="color:var(--text); font-size:0.75rem;">${b.desc}</div>
            <div style="color:var(--accent); font-size:0.65rem; word-break:break-all; opacity:0.8;">Hash: ${b.hash}</div>
        </div>
    `).join('');
};

// Open details modal
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

        <div id="sd-weather-alert-block" style="display:none; margin-bottom:20px;"></div>

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

    // Rescue details rendering
    if (s.rescue_details) {
        const origDrv = globalDrivers.find(d => d.id === s.rescue_details.original_driver_id);
        const origVeh = globalVehicles.find(v => v.id === s.rescue_details.original_vehicle_id);
        const rescDrv = globalDrivers.find(d => d.id === s.rescue_details.rescue_driver_id);
        const rescVeh = globalVehicles.find(v => v.id === s.rescue_details.rescue_vehicle_id);
        
        const origName = origDrv ? origDrv.name : 'Unknown Driver';
        const origPlate = origVeh ? origVeh.number_plate : 'N/A';
        const origType = origVeh ? origVeh.type : 'N/A';
        const rescName = rescDrv ? rescDrv.name : 'Unknown Rescue Driver';
        const rescPlate = rescVeh ? rescVeh.number_plate : 'N/A';
        
        contentHtml += `
            <div class="glass-card" style="padding: 15px; border: 1px dashed var(--warning); background: rgba(245, 158, 11, 0.05); border-radius: 12px; margin-bottom: 20px;">
                <h4 style="color: var(--warning); margin: 0 0 10px 0; font-size: 0.95rem; font-weight: bold; display: flex; align-items: center; gap: 8px;">
                    🚨 Vehicle Breakdown & Rescue Dispatched
                </h4>
                <div style="font-size: 0.85rem; line-height: 1.6; color: var(--text-muted);">
                    <div><b>Broken Down Vehicle:</b> ${origType} (${origPlate}) driven by ${origName}</div>
                    <div style="margin-top: 6px; color: var(--success);"><b>Alternate Rescue Assigned:</b> ${rescName} with vehicle ${rescPlate}</div>
                    <div style="margin-top: 6px;"><b>Transfer Status:</b> Completed & In-Transit</div>
                </div>
            </div>
        `;
    }

    // Verification Codes display section
    let p_code = s.pickup_code;
    let d_code = s.delivery_code;
    if (s.parent_id) {
        const parent = globalShipments.find(p => p.id === s.parent_id);
        if (parent) {
            if (!p_code) p_code = parent.pickup_code;
            if (!d_code) d_code = parent.delivery_code;
        }
    }

    // Context-aware fallback labels — never show raw "N/A"
    const _isCalamityDiverted = s.stage && (
        s.stage.includes('Diverted: Safe Hub') ||
        s.stage.includes('Halted: Calamity') ||
        s.stage.includes('Halted: Disaster')
    );
    const _isIntermediateLeg = s.is_leg && s.leg_order > 1 && s.leg_type !== 'last_mile';
    const _isDelivered = s.status === 'delivered';
    const _isReturned = s.stage && s.stage.includes('Returned:');

    function _pickupLabel(code) {
        if (code) return `<span style="font-family:monospace;font-weight:bold;color:var(--accent);font-size:1.1rem;">${code}</span>`;
        if (_isDelivered) return `<span style="color:var(--success);font-size:0.82rem;">✅ Used &amp; Verified</span>`;
        if (_isCalamityDiverted) return `<span style="color:var(--warning);font-size:0.82rem;">⚠️ Suspended — Calamity Divert / Halt</span>`;
        if (_isReturned) return `<span style="color:var(--warning);font-size:0.82rem;">📋 Suspended — Shipment Returning to Sender</span>`;
        if (_isIntermediateLeg) return `<span style="color:var(--muted);font-size:0.82rem;">🏭 Not required — Hub gate check-in used for this leg</span>`;
        return `<span style="color:var(--muted);font-size:0.82rem;">⏳ Pending — Appears after driver assignment</span>`;
    }

    function _deliveryLabel(code) {
        if (code) return `<span style="font-family:monospace;font-weight:bold;color:var(--accent);font-size:1.1rem;">${code}</span>`;
        if (_isDelivered) return `<span style="color:var(--success);font-size:0.82rem;">✅ Used &amp; Verified by Receiver</span>`;
        if (_isCalamityDiverted) return `<span style="color:var(--warning);font-size:0.82rem;">⚠️ Suspended — Calamity Divert / Halt</span>`;
        if (_isReturned) return `<span style="color:var(--warning);font-size:0.82rem;">📋 Suspended — Shipment Returning to Sender</span>`;
        if (_isIntermediateLeg) return `<span style="color:var(--muted);font-size:0.82rem;">🏭 Not required — Final leg not yet reached</span>`;
        return `<span style="color:var(--muted);font-size:0.82rem;">⏳ Pending — Shared with receiver after payment</span>`;
    }

    contentHtml += `
        <div class="intel-block" style="margin-top:20px; background:rgba(79, 140, 255, 0.05); border:1px solid rgba(79, 140, 255, 0.2); padding: 15px; border-radius: 12px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:0.75rem; color:var(--primary); font-weight:700; text-transform:uppercase;">🔑 Verification Codes</label>
                <button class="btn-action-pill" onclick="toggleVerificationCodesDisplay(this)">👁️ Show Codes</button>
            </div>
            <div id="sd-verification-codes" style="display:none; margin-top:10px; font-size:0.85rem;">
                <div><b>Pickup Code (First Point):</b> ${_pickupLabel(p_code)}</div>
                <div style="margin-top:6px;"><b>Delivery Code (Receiver):</b> ${_deliveryLabel(d_code)}</div>
            </div>
        </div>
    `;

    // Collapsable manual override controls
    contentHtml += `
        <div id="manual-override-controls" style="display:none; margin-top:20px; padding:15px; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:12px;">
            <h4 style="margin:0 0 12px 0; font-size:0.85rem; color:var(--warning); font-weight:bold;">⚙️ Edit / Manual Override Controls</h4>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button class="btn-primary" style="background:#3182ce; font-size:0.8rem; width:auto; padding:8px 16px;" onclick="openManualSplit('${s.id}')">
                    🔀 Manual Split Route
                </button>
                <button class="btn-primary" style="background:#3182ce; font-size:0.8rem; width:auto; padding:8px 16px;" onclick="openManualAssignModal('${s.id}')">
                    👤 Manual Assign Driver
                </button>
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

    // Add SLA Escrow Ledger Section
    contentHtml += `
        <div class="intel-block" style="margin-top:20px; border-top:4px solid #3b82f6; background:rgba(59, 130, 246, 0.02); padding: 15px; border-radius: 12px; border:1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <label style="font-size:0.75rem; color:var(--primary); font-weight:700; text-transform:uppercase;">🔒 SLA Cryptographic Escrow Ledger</label>
                <div id="escrow-lock-anim" style="font-size:1.5rem; filter: drop-shadow(0 0 8px currentColor);"></div>
            </div>
            
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:15px; background:rgba(255,255,255,0.03); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                <div id="escrow-status-text" style="font-size:0.85rem; font-weight:bold;">Generating Ledger blocks...</div>
            </div>
            
            <div style="display:flex; flex-direction:column; gap:8px;">
                <div style="font-size:0.7rem; color:var(--text-muted); font-weight:800; text-transform:uppercase;">Ledger Chain Blocks (Tamper-Proof SHA-256)</div>
                <div id="escrow-blocks" style="display:flex; flex-direction:column; gap:6px;">
                    <!-- Blocks injected here -->
                </div>
            </div>
        </div>
    `;

    document.getElementById('sd-content').innerHTML = contentHtml;

    setTimeout(() => {
        if (window.renderEslLedger) {
            window.renderEslLedger(s);
        }
    }, 100);

    // Check for calamity weather safety alert conditions
    const affectedAlert = (window.globalActiveAlerts || []).find(al => al.shipment_id === s.id);
    const hasCalamity = affectedAlert || (s.stage && (s.stage.includes('Halted: Disaster Zone') || s.stage.includes('Diverted: Safe Hub')));
    
    if (hasCalamity) {
        document.getElementById('sd-weather-alert-block').style.display = 'block';
        document.getElementById('sd-weather-alert-block').innerHTML = `
            <div class="glass-card" style="padding: 15px; border: 1px dashed var(--danger); background: rgba(239, 68, 68, 0.05); border-radius: 12px; margin-bottom: 20px;">
                <h4 style="color: var(--danger); margin: 0 0 10px 0; font-size: 0.95rem; font-weight: bold; display: flex; align-items: center; gap: 8px;">
                    ⚠️ Weather & Route Safety Alert
                </h4>
                <div id="sd-weather-details" style="font-size: 0.85rem; line-height: 1.6; color: var(--text-muted); text-align: left;">
                    Loading live weather conditions at shipment location...
                </div>
                <div style="margin-top: 12px; display: flex; gap: 10px; justify-content: flex-start;">
                    <button class="btn-primary" onclick="window.location.href='manager_weather.html'" style="width: auto; padding: 6px 12px; font-size: 0.75rem; background: var(--primary); border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">
                        🗺️ View Weather Map
                    </button>
                </div>
            </div>
        `;
        
        const loc = s.current_location && s.current_location.lat ? s.current_location : s.pickup;
        apiCall(`/tracking/weather-at?lat=${loc.lat}&lng=${loc.lng}&company_id=${localStorage.getItem('manager_id')}`)
            .then(res => {
                const w = res.weather || {};
                const temp = w.temp !== undefined ? `${w.temp}°C` : 'N/A';
                const aqi = w.us_aqi !== undefined ? `${w.us_aqi} AQI` : 'N/A';
                const wind = w.wind_speed !== undefined ? `${w.wind_speed} km/h` : 'N/A';
                const cond = w.condition || 'N/A';
                const icon = w.icon || '🌡️';
                
                document.getElementById('sd-weather-details').innerHTML = `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px;">
                        <div>🌡️ <b>Temp:</b> ${temp}</div>
                        <div>💨 <b>Wind:</b> ${wind}</div>
                        <div>🌫️ <b>AQI:</b> ${aqi}</div>
                        <div>${icon} <b>Cond:</b> ${cond}</div>
                    </div>
                    <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px; font-weight: bold; color: var(--danger); font-size: 0.8rem;">
                        Status: ${affectedAlert ? affectedAlert.message : (s.stage || 'Halted due to calamity warning.')}
                    </div>
                `;
            })
            .catch(err => {
                console.error("Failed to load modal weather", err);
                document.getElementById('sd-weather-details').innerHTML = `
                    <span style="color: var(--danger);">Failed to query live weather details.</span>
                    <div style="margin-top: 8px; font-weight: bold; color: var(--danger); font-size: 0.8rem;">
                        Status: ${affectedAlert ? affectedAlert.message : (s.stage || 'Halted due to calamity warning.')}
                    </div>
                `;
            });
    }

    const isMultiLegParent = !s.is_leg && (s.status === 'split' || s.route_type === 'multi-leg');
    
    let actionsHtml = `
        <button class="btn-action-details" onclick="openLogsModal('${s.id}')">
            <span class="icon">📜</span> <span data-i18n="btn_timeline">Timeline</span>
        </button>
        <button class="btn-action-details" style="background:var(--accent);" onclick="openTrackModal('${s.id}')">
            <span class="icon">📍</span> <span data-i18n="btn_track">Live Track</span>
        </button>
        <button class="btn-action-details" style="background:rgba(255,255,255,0.05);" onclick="toggleManualOverride()">
            <span class="icon">⚙️</span> <span>Edit / Manual Override</span>
        </button>
    `;

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
            `;
        } else {
            actionsHtml += `
                <button class="btn-action-details" style="opacity:0.6; cursor:not-allowed; background:var(--muted);" disabled>
                    <span class="icon">🤖</span> <span>Route Finalized</span>
                </button>
            `;
        }

        // 2. ASSIGN CONTROLS (Only visible after split)
        if (isRoutePlanned && !isAssigned) {
            actionsHtml += `
                <button class="btn-action-details" style="background:var(--success);" onclick="autoAssignShipment('${s.id}')">
                    <span class="icon">🤖</span> <span>Auto Assign (AI)</span>
                </button>
            `;
        } else if (isAssigned) {
            actionsHtml += `
                <button class="btn-action-details" style="opacity:0.6; cursor:not-allowed; background:var(--muted);" disabled>
                    <span class="icon">🤖</span> <span>Already Assigned</span>
                </button>
            `;
        } else {
            // Not yet planned
            actionsHtml += `
                <button class="btn-action-details" style="opacity:0.6; cursor:not-allowed; background:var(--muted);" disabled title="Split route first">
                    <span class="icon">🤖</span> <span>Assign (Locked)</span>
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

// Live Tracking Map Modal logic
window.openTrackModal = async function(shipmentId) {
    document.getElementById('track-shipment-id').innerText = shipmentId.substring(0,8);
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
        const mainShipment = shipments.find(s => s.id === parentId) || target;
        let legs = shipments.filter(s => s.parent_id === parentId);
        // Filter out obsolete legs not in the active child_leg_ids array
        if (mainShipment.child_leg_ids && mainShipment.child_leg_ids.length > 0) {
            legs = legs.filter(s => mainShipment.child_leg_ids.includes(s.id));
        }
        legs.sort((a,b) => a.leg_order - b.leg_order);
        
        const localIconPickup = window.ICON_PICKUP || L.divIcon({className: 'custom-marker'});
        const localIconDrop = window.ICON_DROP || L.divIcon({className: 'custom-marker'});
        const localIconWarehouse = window.ICON_WAREHOUSE || L.divIcon({className: 'custom-marker'});

        // 1. Plot Origin (of the tracked segment)
        let pName = mainShipment.pickup.address || mainShipment.pickup.name || "Initial Pickup";
        const originMarker = L.marker([mainShipment.pickup.lat, mainShipment.pickup.lng], {icon: localIconPickup})
            .addTo(trackMap).bindPopup(target.is_leg ? `<b>Leg ${target.leg_order} Pickup:</b> ${pName}` : `<b>Initial Pickup:</b> ${pName}`);
        trackMarkers.push(originMarker);

        // 2. Plot Destination (of the tracked segment)
        let dName = mainShipment.drop.address || mainShipment.drop.name || "Final Delivery Point";
        const destinationMarker = L.marker([mainShipment.drop.lat, mainShipment.drop.lng], {icon: localIconDrop})
            .addTo(trackMap).bindPopup(target.is_leg ? `<b>Leg ${target.leg_order} Drop:</b> ${dName}` : `<b>Final Delivery Point:</b> ${dName}`);
        trackMarkers.push(destinationMarker);

        // 3. Plot Intermediate Hubs (ONLY if it's the Parent view)
        if (!target.is_leg && legs.length > 1) {
            legs.forEach((leg, idx) => {
                if (idx < legs.length - 1) {
                    const hubMarker = L.marker([leg.drop.lat, leg.drop.lng], {icon: localIconWarehouse})
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
};

// Manual routing split functions
window.openManualSplit = async function(id) {
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
    } catch(e) {
        console.error("Failed to load warehouses for split:", e);
    }
};

window.goToSplitStep1 = function() {
    document.getElementById('split-step-1').style.display = 'block';
    document.getElementById('split-modal-title').innerText = "Manual Route Split";
};

window.filterSplitWarehouses = function() {
    const q = document.getElementById('split-wh-search').value.toLowerCase();
    const items = document.querySelectorAll('.wh-split-item');
    items.forEach(item => {
        const name = item.querySelector('label').innerText.toLowerCase();
        item.style.display = name.includes(q) ? 'flex' : 'none';
    });
};

window.submitManualSplit = async function() {
    const checkboxes = document.querySelectorAll('.wh-checkbox:checked');
    if (checkboxes.length === 0) {
        showNotification("Please select at least one warehouse.", "warning");
        return;
    }
    
    const warehouseIds = Array.from(checkboxes).map(cb => cb.value);
    
    try {
        const res = await apiCall(`/shipments/${currentSplitId}/split/manual`, 'POST', {
            warehouse_ids: warehouseIds,
            assignments: [],
            company_id: localStorage.getItem('manager_id')
        });
        
        showNotification(res.message, "success");
        document.getElementById('split-modal').style.display = 'none';
        closeShipmentDetailModal();
        loadShipments();
    } catch(e) {
        showNotification("Manual split failed.", "error");
    }
};

// Auto assign segment call
window.autoAssignShipment = async function(id) {
    try {
        await apiCall(`/shipments/${id}/auto-assign`, 'POST');
        showNotification("Assignment successful! 🤖", "success");
        loadShipments();
        closeShipmentDetailModal();
    } catch(e) {
        const errorMsg = e.detail || "No suitable vehicles found for this journey configuration.";
        showNotification(`Assignment Failed: ${errorMsg}`, "danger");
    }
};

// Delete shipments
window.deleteItem = async function(type, id) {
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
        if (type === 'shipments') {
            closeShipmentDetailModal();
            loadShipments();
        }
    } catch(err) {
        alert("Failed to delete.");
    }
};

// Messaging logic
window.openMessageModal = async function(shipmentId, driverId) {
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
};

window.closeMiniChat = function() {
    const popup = document.getElementById('mini-chat-popup');
    if (popup) popup.style.display = 'none';
    if (miniChatMediaRecorder && miniChatRecording) {
        miniChatMediaRecorder.stop();
    }
};

window.makeDraggable = function(el, handle) {
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
};

window.submitMessage = async function() {
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
};

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
    } catch(e) {
        showNotification(getTranslation('msg_failed', 'en'), 'error');
    }
}

window.miniChatPickPhoto = function() {
    document.getElementById('mini-chat-photo-input').click();
};

window.miniChatHandlePhoto = function(input) {
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
};

window.miniChatClearMedia = function() {
    miniChatMediaData = null;
    const preview = document.getElementById('mini-chat-media-preview');
    preview.style.display = 'none';
    preview.innerHTML = '';
};

window.miniChatToggleRecording = async function() {
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
};

window.checkShipmentWeather = async function(id) {
    const s = globalShipments.find(ship => ship.id === id);
    if (!s) return alert("Shipment not found.");
    
    const loc = s.current_location && s.current_location.lat ? s.current_location : s.pickup;
    const name = s.description || "Shipment";
    
    try {
        const res = await apiCall(`/tracking/weather-at?lat=${loc.lat}&lng=${loc.lng}&company_id=${localStorage.getItem('manager_id')}`);
        const w = res.weather || {};
        const temp = w.temp !== undefined ? `${w.temp}°C` : 'N/A';
        const aqi = w.us_aqi !== undefined ? `${w.us_aqi} AQI` : 'N/A';
        const wind = w.wind_speed !== undefined ? `${w.wind_speed} km/h` : 'N/A';
        const cond = w.condition || 'N/A';
        const icon = w.icon || '🌡️';
        const risk = w.risk_score !== undefined ? `${w.risk_score}` : '0.0';
        
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.background = 'rgba(0, 0, 0, 0.7)';
        overlay.style.backdropFilter = 'blur(10px)';
        overlay.style.zIndex = '99999';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.onclick = () => document.body.removeChild(overlay);
        
        const card = document.createElement('div');
        card.className = 'glass-card';
        card.style.padding = '30px';
        card.style.maxWidth = '450px';
        card.style.width = '95%';
        card.style.textAlign = 'center';
        card.style.border = '1px solid var(--border)';
        card.style.background = 'rgba(15, 23, 42, 0.85)';
        card.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.5)';
        card.style.borderRadius = '16px';
        card.onclick = (e) => e.stopPropagation();
        
        card.innerHTML = `
            <div style="font-size: 3.5rem; margin-bottom: 15px;">${icon}</div>
            <h3 style="margin: 0 0 10px 0; color: var(--primary); font-size: 1.4rem; font-weight: bold;">Route Weather Intel</h3>
            <p style="font-weight: bold; font-size: 0.95rem; color: var(--text); margin-bottom: 20px;">${name}</p>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; text-align: left; background: rgba(255,255,255,0.03); padding: 15px; border-radius: 12px; margin-bottom: 20px; font-size: 0.9rem;">
                <div>🌡️ <b>Temp:</b> <span style="color: var(--accent); font-weight: bold;">${temp}</span></div>
                <div>💨 <b>Wind:</b> <span style="color: var(--accent); font-weight: bold;">${wind}</span></div>
                <div>🌫️ <b>Air Quality:</b> <span style="color: var(--accent); font-weight: bold;">${aqi}</span></div>
                <div>🌥️ <b>Condition:</b> <span style="color: var(--accent); font-weight: bold;">${cond}</span></div>
                <div style="grid-column: span 2; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; font-size: 0.85rem;">
                    ⚠️ <b>Location Risk Score:</b> <span style="color: ${w.risk_score > 30 ? 'var(--danger)' : 'var(--success)'}; font-weight: bold;">${risk}/100</span>
                </div>
            </div>
            
            <button class="btn-primary" onclick="this.closest('body').removeChild(this.parentNode.parentNode)" style="width: 100%; font-weight: bold; background: var(--primary); color: #000; border: none; border-radius: 10px; padding: 12px; cursor: pointer;">
                Close Intel
            </button>
        `;
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    } catch(err) {
        console.error("Failed to check route weather", err);
        alert("Failed to retrieve live weather telemetry for this shipment route.");
    }
};

async function initPage() {
    loadShipments();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
} else {
    initPage();
}