// Dedicated script for manager_analytics.html

let volumeChart, fleetChart;

async function loadInsights() {
    try {
        const company_id = localStorage.getItem('manager_id');
        const container = document.getElementById('alerts-container');
        if (!container) return;
        
        // Load data in parallel but handle errors individually
        const [alerts, stats, cascade, pl] = await Promise.all([
            apiCall(`/tracking/alerts/active?company_id=${company_id}`).catch(err => { console.error("Alerts failed:", err); return []; }),
            apiCall(`/manager/dashboard/stats?company_id=${company_id}`).catch(err => { console.error("Stats failed:", err); return null; }),
            apiCall(`/manager/analytics/cascade?company_id=${company_id}`).catch(err => { console.error("Cascade failed:", err); return { risks: [], active_risk_count: 0, total_impact_hours: 0 }; }),
            apiCall(`/manager/finance/p-and-l?company_id=${company_id}`).catch(err => { console.error("P&L failed:", err); return { net_profit: 0 }; })
        ]);
        
        // Update Stats Grid if stats loaded
        if (stats) {
            document.getElementById('stat-timely').innerText = `${stats.timely_percent || 0}%`;
            document.getElementById('stat-delay').innerText = `${stats.avg_delay_mins || 0}m`;
            document.getElementById('stat-active').innerText = stats.active_shipments || 0;
            document.getElementById('stat-drivers').innerText = stats.total_drivers || 0;
            document.getElementById('stat-warehouses').innerText = stats.total_warehouses || 0;
            document.getElementById('stat-vehicles').innerText = stats.total_vehicles || 0;
            
            // Render Charts
            renderManagerCharts(stats);
        }
        
        if (document.getElementById('stat-profits')) {
            document.getElementById('stat-profits').innerText = `₹ ${(pl.net_profit || 0).toLocaleString()}`;
        }

        // Render Charts & Cascade
        renderManagerCharts(stats);
        renderCascadePredictor(cascade);

        // Safety Badge Update
        const safetyAlerts = alerts.filter(a => (a.type === 'fatigue' || a.type === 'breakdown'));
        const badge = document.getElementById('safety-badge');
        if (badge) {
            badge.innerText = safetyAlerts.length;
            badge.style.display = safetyAlerts.length > 0 ? 'inline' : 'none';
        }

        if (alerts.length === 0) {
            container.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted);">No active system alerts.</p>`;
            return;
        }

        container.innerHTML = alerts.map(a => `
            <div style="background: rgba(255, 255, 255, 0.05); border-left: 3px solid ${a.severity==='critical'?'var(--danger)':'var(--warning)'}; padding: 10px; margin-bottom: 10px; border-radius: 8px; position:relative;">
                <button style="position:absolute; top:8px; right:8px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem;" onclick="resolveAlert('${a.id}')">✖</button>
                <p style="margin:0; padding-right:20px; font-size: 0.9rem;"><strong>${a.type.toUpperCase()}:</strong> ${a.description}<br>
                <em style="color:var(--accent)">Suggestion: ${a.suggestion}</em></p>
                <button class="btn-primary" style="padding:2px 10px; font-size:0.7rem; margin-top:8px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2);" onclick="resolveAlert('${a.id}')">Dismiss Alert</button>
            </div>
        `).join('');
    } catch(e) {}
}

function renderManagerCharts(stats) {
    const volCtx = document.getElementById('volumeChart')?.getContext('2d');
    const fleetCtx = document.getElementById('fleetChart')?.getContext('2d');
    if (!volCtx || !fleetCtx) return;

    if (volumeChart) volumeChart.destroy();
    if (fleetChart) fleetChart.destroy();

    // Global Font Settings
    const chartFont = {
        family: "'Manrope', sans-serif",
        size: 13,
        weight: '600'
    };

    volumeChart = new Chart(volCtx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Shipment Volume',
                data: stats.volume_data,
                borderColor: '#4f8cff',
                backgroundColor: 'rgba(79, 140, 255, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#4f8cff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false }
            },
            scales: { 
                y: { 
                    beginAtZero: true, 
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: { color: '#94a3b8', font: chartFont, padding: 10 }
                }, 
                x: { 
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: chartFont, padding: 10 }
                } 
            }
        }
    });

    fleetChart = new Chart(fleetCtx, {
        type: 'doughnut',
        data: {
            labels: ['In-Transit', 'Available', 'Maintenance'],
            datasets: [{
                data: [stats.fleet_dist.in_transit, stats.fleet_dist.available, stats.fleet_dist.maintenance],
                backgroundColor: ['#4f8cff', '#10b981', '#ef4444'],
                borderWidth: 0,
                hoverOffset: 15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true, // Keep it circular
            cutout: '75%',
            plugins: { 
                legend: { 
                    position: 'bottom', 
                    labels: { 
                        color: '#94a3b8', 
                        font: chartFont,
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    } 
                } 
            }
        }
    });
}

function renderCascadePredictor(data) {
    const container = document.getElementById('cascade-container');
    const totalHoursEl = document.getElementById('cascade-total-hours');
    const recDiv = document.getElementById('cascade-recommendation');
    const recText = document.getElementById('cascade-rec-text');
    
    if (!container) return;
    
    totalHoursEl.innerText = `${data.total_impact_hours} hrs`;
    
    if (data.risks.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">
            <div style="font-size:2rem; margin-bottom:10px;">🛡️</div>
            Network Stable. No cascading risks detected.
        </div>`;
        recDiv.style.display = 'none';
        return;
    }
    
    recDiv.style.display = 'block';
    recText.innerText = data.recommendation;
    
    container.innerHTML = data.risks.map(r => `
        <div class="glass-card" style="padding:24px; border-left: 4px solid ${r.severity==='high'?'var(--danger)':'var(--warning)'}; background:rgba(255,255,255,0.02); margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                <span style="font-size:0.75rem; color:var(--muted); font-weight:bold; letter-spacing:0.05em;">SOURCE: ${r.source_shipment_id.slice(0,8)}</span>
                <span class="status-pill" style="background:${r.severity==='high'?'var(--danger)':'var(--warning)'}22; color:${r.severity==='high'?'var(--danger)':'var(--warning)'}; font-size:0.7rem;">${r.severity.toUpperCase()} RISK</span>
            </div>
            <h3 style="margin:8px 0; font-size:1.1rem;">${r.description}</h3>
            <p style="font-size:0.9rem; color:var(--danger); font-weight:600; margin-bottom:16px;">Current Deviation: +${r.current_delay}</p>
            
            <div style="border-top: 1px solid var(--border); padding-top:16px;">
                <small style="color:var(--muted); display:block; margin-bottom:8px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em;">Predicted Hub Impacts:</small>
                ${r.impact_hubs.map(h => `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:0.85rem;">
                        <span style="font-weight:600;">📍 ${h.location}</span>
                        <span style="color:${h.risk_level==='critical'?'var(--danger)':'var(--warning)'}">+${h.est_delay_mins}m</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

async function resolveAlert(id) {
    // In a real app we'd mark it resolved in DB. For demo we'll just mock it.
    alert("Alert Resolved");
    loadInsights();
}

async function initPage() {
    loadInsights();
}

document.addEventListener('DOMContentLoaded', initPage);