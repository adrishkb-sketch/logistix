// Dedicated script for manager_ledger.html

async function loadLedger() {
    const tbody = document.getElementById('ledger-table-body');
    const pbody = document.getElementById('driver-points-body');
    if (!tbody || !pbody) return;
    
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">${getTranslation('loading_ledger')}</td></tr>`;
    
    try {
        // Fetch Ledger
        const txs = await apiCall('/manager/ledger?company_id=' + localStorage.getItem('manager_id'));
        
        // Fetch Drivers for Summary
        if (!globalDrivers.length) {
            globalDrivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`);
        }

        renderDriverPointsSummary();

        if (txs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">${getTranslation('no_contracts')}</td></tr>`;
            return;
        }
        
        txs.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        tbody.innerHTML = txs.map(tx => {
            const isBoost = tx.shipment_id === 'GLOBAL_BOOST';
            const driver = globalDrivers.find(d => d.id === tx.to_address);
            const driverLabel = driver ? driver.name : (tx.to_address || 'N/A').substring(0, 8) + '...';
            const shipLabel = isBoost
                ? `<span style="color:var(--warning); font-size:0.75rem;">⚡ GLOBAL BOOST</span>`
                : (tx.shipment_id || '').substring(0, 8);
            return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05); ${isBoost ? 'background:rgba(246,173,85,0.04);' : ''}">
                <td style="padding:10px; color:#00f2fe; font-family:monospace; font-size:0.8rem;">${(tx.tx_hash || '—').substring(0,18)}...</td>
                <td style="padding:10px; font-size:0.8rem;">${new Date(tx.timestamp).toLocaleString()}</td>
                <td style="padding:10px;">${shipLabel}</td>
                <td style="padding:10px;">${driverLabel}</td>
                <td style="padding:10px; color:var(--success); font-weight:bold;">🏆 ${tx.points_awarded}</td>
            </tr>`;
        }).join('');
    } catch(err) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--danger);">Error loading ledger.</td></tr>';
    }
}

window.renderDriverPointsSummary = async function() {
    const pbody = document.getElementById('driver-points-body');
    if (!pbody) return;

    const companyId = localStorage.getItem('manager_id');

    // Always ensure all three data sets are loaded before sorting
    if (!globalDrivers.length) {
        globalDrivers = await apiCall(`/manager/drivers?company_id=${companyId}`);
    }
    if (!globalVehicles.length) {
        globalVehicles = await apiCall(`/manager/vehicles?company_id=${companyId}`);
    }
    if (!globalWarehouses.length) {
        globalWarehouses = await apiCall(`/manager/warehouses?company_id=${companyId}`);
    }

    const sortMode = document.getElementById('ledger-driver-sort')?.value || 'points';

    let sorted = [...globalDrivers];
    sorted.sort((a, b) => {
        if (sortMode === 'points') return (b.reward_points || 0) - (a.reward_points || 0);
        if (sortMode === 'warehouse') {
            const wA = globalWarehouses.find(w => w.id === a.base_warehouse_id)?.name || '';
            const wB = globalWarehouses.find(w => w.id === b.base_warehouse_id)?.name || '';
            return wA.localeCompare(wB);
        }
        if (sortMode === 'vehicle') {
            const vA = globalVehicles.find(v => v.id === a.assigned_vehicle_id)?.type || 'Unlinked';
            const vB = globalVehicles.find(v => v.id === b.assigned_vehicle_id)?.type || 'Unlinked';
            return vA.localeCompare(vB);
        }
        return 0;
    });

    if (!sorted.length) {
        pbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">No drivers found.</td></tr>';
        return;
    }

    pbody.innerHTML = sorted.map(d => {
        const vehicle = globalVehicles.find(v => v.id === d.assigned_vehicle_id);
        const hub = globalWarehouses.find(w => w.id === d.base_warehouse_id);
        return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:10px;"><b>${d.name}</b><br><small style="color:var(--text-muted)">${d.system_id}</small></td>
                <td style="padding:10px;">${vehicle ? `<b>${vehicle.type}</b><br><small>${vehicle.number_plate}</small>` : `<small style="color:var(--text-muted)">${getTranslation('unlinked')}</small>`}</td>
                <td style="padding:10px;"><small>${hub ? hub.name : 'N/A'}</small></td>
                <td style="padding:10px; color:var(--accent); font-weight:bold; font-size:1.1rem;">${Math.floor(d.reward_points || 0)}</td>
            </tr>
        `;
    }).join('');
}

async function boostDriverPoints() {
    const percent = parseFloat(document.getElementById('boost-percent').value);
    if (!percent || percent <= 0) {
        alert('Please enter a valid percentage greater than 0.');
        return;
    }
    if (!confirm(`Apply a ${percent}% points boost to ALL drivers in your fleet?`)) return;
    try {
        const res = await apiCall('/manager/ledger/boost', 'POST', {
            company_id: localStorage.getItem('manager_id'),
            percentage: percent
        });
        alert(res.message);
        // Force-refresh global drivers cache so wallet summary reflects new totals
        globalDrivers = await apiCall(`/manager/drivers?company_id=${localStorage.getItem('manager_id')}`);
        renderDriverPointsSummary();
        loadLedger();
    } catch(err) {
        alert('Failed to apply boost: ' + (err.message || err));
    }
}

async function initPage() {
    loadLedger(); renderDriverPointsSummary();
}

document.addEventListener('DOMContentLoaded', initPage);