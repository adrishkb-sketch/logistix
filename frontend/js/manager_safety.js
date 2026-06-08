// Dedicated script for manager_safety.html

async function loadSafetyCenter() {
    try {
        const mId = localStorage.getItem('manager_id');
        const [drivers, alerts, shipments] = await Promise.all([
            apiCall(`/manager/drivers?company_id=${mId}`),
            apiCall(`/tracking/alerts/active?company_id=${mId}`),
            apiCall(`/shipments/?company_id=${mId}`)
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
                        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(i.driver?.name || 'sys')}" style="width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,0.05);">
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
    const shipments = await apiCall(`/shipments/?company_id=${localStorage.getItem('manager_id')}`);
    const active = shipments.find(s => s.assigned_driver_id === driverId && s.status !== 'delivered');
    if (active) openTrackModal(active.id);
    else alert("No active shipment for this driver.");
}

async function resolveAlert(id) {
    // In a real app we'd mark it resolved in DB. For demo we'll just mock it.
    alert("Alert Resolved");
    loadInsights();
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

async function triggerAISafetyAudit() {
    const reportDiv = document.getElementById('safety-audit-report');
    const modal = document.getElementById('safety-audit-modal');
    if (!reportDiv || !modal) return;
    
    // Check key before calling API
    await ensureGeminiApiKey();
    
    reportDiv.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px 0;">🔮 Running neural fleet safety audit... Please wait.</p>';
    modal.style.display = 'block';
    
    try {
        const companyId = localStorage.getItem('manager_id');
        const res = await apiCall(`/manager/ai/safety-audit`, 'POST', { company_id: companyId });
        reportDiv.innerHTML = parseMarkdownToHtml(res.report);
    } catch(err) {
        reportDiv.innerHTML = `<p style="color:var(--danger);">Failed to generate AI Safety Report: ${err.message}</p>`;
    }
}

async function initPage() {
    loadSafetyCenter();
}

document.addEventListener('DOMContentLoaded', initPage);