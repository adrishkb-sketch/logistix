// Dedicated script for manager_verifications.html

async function loadDriversAndVehicles() {
    try {
        const [drivers, vehicles, warehouses, shipments, drones] = await Promise.all([
            apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/vehicles?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/manager/warehouses?company_id=${localStorage.getItem('manager_id')}`),
            apiCall(`/shipments/?company_id=${localStorage.getItem('manager_id')}`),
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

        // Only call these render functions if they exist (they live in manager_drivers.js,
        // not on this standalone verifications page)
        if (typeof renderDriversTable === 'function') renderDriversTable();
        if (typeof renderVehiclesTable === 'function') renderVehiclesTable();
        if (typeof renderDronesTable === 'function') renderDronesTable();
        if (typeof renderLinkedPairs === 'function') renderLinkedPairs();

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
                    // Old images saved as /images/... are broken — detect and warn
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

async function initPage() {
    loadDriversAndVehicles();
}

document.addEventListener('DOMContentLoaded', initPage);