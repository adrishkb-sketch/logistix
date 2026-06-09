window.haversine = function(lat1, lon1, lat2, lon2) {
    const r = 6371; 
    const p = Math.PI / 180;
    const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 + 
              Math.cos(lat1 * p) * Math.cos(lat2 * p) * 
              (1 - Math.cos((lon2 - lon1) * p)) / 2;
    return 2 * r * Math.asin(Math.sqrt(a));
};

window.resplitRemainingRoute = async function(shipmentId) {
    try {
        const shipment = globalShipments.find(s => s.id === shipmentId) || await apiCall(`/shipments/${shipmentId}`, 'GET');
        const legs = globalShipments.filter(l => l.parent_id === shipmentId).sort((a,b) => a.leg_order - b.leg_order);
        
        let activeLeg = [...legs].reverse().find(l => ['in_transit', 'delivered'].includes(l.status));
        let unstartedLegs = activeLeg ? legs.slice(legs.indexOf(activeLeg) + 1) : legs;
        
        if (unstartedLegs.length === 0 && legs.length > 0) {
            return showNotification("All legs are already active or completed.", "warning");
        }
        
        let startLoc = activeLeg ? activeLeg.drop : shipment.pickup;
        let finalLoc = shipment.drop;
        
        // Calculate original ETA (sum of distances of unstarted legs)
        let origDist = 0;
        for (const l of unstartedLegs) {
            origDist += haversine(l.pickup.lat, l.pickup.lng, l.drop.lat, l.drop.lng);
        }
        let origEtaHours = origDist / 60.0;
        
        const warehouses = await apiCall('/manager/warehouses', 'GET');
        
        let html = `
        <div id="manual-hub-modal" style="position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:10000; display:flex; justify-content:center; align-items:center;">
            <div style="background:var(--surface); width:600px; max-width:90%; border-radius:16px; padding:24px; box-shadow:0 10px 40px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <h3 style="margin:0; font-size:1.4rem;">📍 Select Intermediate Hub</h3>
                    <button style="background:none; border:none; color:white; font-size:1.5rem; cursor:pointer;" onclick="document.getElementById('manual-hub-modal').remove()">&times;</button>
                </div>
                <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:16px;">
                    Select a warehouse to route through, or choose Direct. The time difference is compared against the original AI route.
                </p>
                <div style="max-height:400px; overflow-y:auto; display:flex; flex-direction:column; gap:10px;">
        `;
        
        // Direct option
        let directDist = haversine(startLoc.lat, startLoc.lng, finalLoc.lat, finalLoc.lng);
        let directEta = directDist / 60.0;
        let diffDirect = directEta - origEtaHours;
        let diffDirectStr = diffDirect > 0 
            ? \`<span style="color:var(--danger); font-size:0.75rem; font-weight:bold;">Slower by \${diffDirect.toFixed(1)} hrs</span>\`
            : \`<span style="color:var(--success); font-size:0.75rem; font-weight:bold;">Faster by \${Math.abs(diffDirect).toFixed(1)} hrs</span>\`;
            
        html += \`
            <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong style="font-size:1rem;">🚀 Direct to Destination</strong>
                    <div style="color:var(--text-muted); font-size:0.8rem; margin-top:4px;">No intermediate hubs. \${Math.round(directDist)} km</div>
                </div>
                <div style="text-align:right;">
                    <div>\${diffDirectStr}</div>
                    <button class="btn-primary" style="margin-top:8px; padding:6px 12px; font-size:0.8rem;" onclick="submitManualHub('\${shipmentId}', null)">Select Direct</button>
                </div>
            </div>
        \`;
        
        for (const wh of warehouses) {
            let distA = haversine(startLoc.lat, startLoc.lng, wh.lat, wh.lng);
            let distB = haversine(wh.lat, wh.lng, finalLoc.lat, finalLoc.lng);
            let whEta = (distA + distB) / 60.0;
            let diff = whEta - origEtaHours;
            
            let diffStr = diff > 0 
                ? \`<span style="color:var(--danger); font-size:0.75rem; font-weight:bold;">Slower by \${diff.toFixed(1)} hrs</span>\`
                : \`<span style="color:var(--success); font-size:0.75rem; font-weight:bold;">Faster by \${Math.abs(diff).toFixed(1)} hrs</span>\`;
                
            html += \`
                <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="font-size:1rem;">🏢 \${wh.name}</strong>
                        <div style="color:var(--text-muted); font-size:0.8rem; margin-top:4px;">Via \${wh.location.city} · \${Math.round(distA + distB)} km total</div>
                    </div>
                    <div style="text-align:right;">
                        <div>\${diffStr}</div>
                        <button class="btn-primary" style="margin-top:8px; padding:6px 12px; font-size:0.8rem;" onclick="submitManualHub('\${shipmentId}', '\${wh.id}')">Route Via Hub</button>
                    </div>
                </div>
            \`;
        }
        
        html += \`</div></div></div>\`;
        document.body.insertAdjacentHTML('beforeend', html);
        
    } catch(e) {
        console.error(e);
        showNotification('Error preparing hub selection', 'error');
    }
}

window.submitManualHub = async function(shipmentId, warehouseId) {
    try {
        document.getElementById('manual-hub-modal').remove();
        showNotification('Configuring manual route...', 'success');
        
        await apiCall(\`/shipments/\${shipmentId}/manual-resplit\`, 'POST', {
            warehouse_id: warehouseId
        });
        
        showNotification('Route updated! Please assign fleet to the new legs.', 'success');
        await loadShipments();
        openManualAssignModal(shipmentId);
    } catch(e) {
        showNotification(e.detail || 'Failed to update route', 'error');
    }
}
