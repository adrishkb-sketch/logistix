let volumeChart, fleetChart;
let co2Chart, volTrendChart;
let weightChart, statusPieChart, hubCongestionChart, deliveryTimeChart;
let perishableChart, vehicleTypeChart, revenueByDayChart, driverPerfChart;
const _sparkCharts = {};

// ── Animated Counter ─────────────────────────────────────────
function animateCounter(el, targetRaw, format = 'number') {
    if (!el) return;
    const start = 0;
    const duration = 900;
    const startTime = performance.now();
    const target = parseFloat(targetRaw) || 0;

    function tick(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
        const current = eased * target;

        if (format === 'percent') el.innerText = `${current.toFixed(1)}%`;
        else if (format === 'money') el.innerText = `₹ ${Math.round(current).toLocaleString('en-IN')}`;
        else if (format === 'minutes') el.innerText = `${current.toFixed(1)}m`;
        else if (format === 'co2_km') el.innerText = `${current.toFixed(3)} kg`;
        else el.innerText = Math.round(current);

        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ── Micro Sparkline ──────────────────────────────────────────
function drawSparkline(canvasId, data, color = '#4f8cff', fill = true) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !data || !data.length) return;
    if (_sparkCharts[canvasId]) _sparkCharts[canvasId].destroy();

    const ctx = canvas.getContext('2d');
    _sparkCharts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map((_, i) => i),
            datasets: [{
                data,
                borderColor: color,
                backgroundColor: fill ? color.replace(')', ',0.12)').replace('rgb', 'rgba') : 'transparent',
                fill,
                tension: 0.45,
                pointRadius: 0,
                borderWidth: 2
            }]
        },
        options: {
            responsive: false,
            animation: { duration: 800 },
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false } }
        }
    });
}

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
        
        const alertsList = Array.isArray(alerts) ? alerts : [];
        const netProfit = pl?.net_profit || 0;
        
        // Update Stats Grid with animated counters if stats loaded
        if (stats) {
            animateCounter(document.getElementById('stat-timely'), stats.timely_percent || 0, 'percent');
            animateCounter(document.getElementById('stat-delay'), stats.avg_delay_mins || 0, 'minutes');
            animateCounter(document.getElementById('stat-active'), stats.active_shipments || 0);
            animateCounter(document.getElementById('stat-drivers'), stats.total_drivers || 0);
            animateCounter(document.getElementById('stat-warehouses'), stats.total_warehouses || 0);
            animateCounter(document.getElementById('stat-vehicles'), stats.total_vehicles || 0);
            animateCounter(document.getElementById('stat-co2-km'), stats.avg_co2_per_km || 0, 'co2_km');

            // Trend badges
            const vol = stats.volume_data || [0,0,0,0,0,0,0];
            const todayVol = vol[vol.length - 1] || 0;
            const ystdVol = vol[vol.length - 2] || 0;
            const volDiff = todayVol - ystdVol;
            const trendActive = document.getElementById('kpi-trend-active');
            if (trendActive) {
                trendActive.className = `kpi-trend ${volDiff >= 0 ? 'up' : 'down'}`;
                trendActive.innerText = `${volDiff >= 0 ? '↑' : '↓'} ${Math.abs(volDiff)} vs. yesterday`;
            }

            const onTimeDiff = (stats.timely_percent || 0) - 92; // compare to 92% baseline
            const trendTimely = document.getElementById('kpi-trend-timely');
            if (trendTimely) {
                trendTimely.className = `kpi-trend ${onTimeDiff >= 0 ? 'up' : 'down'}`;
                trendTimely.innerText = `${onTimeDiff >= 0 ? '↑' : '↓'} ${Math.abs(onTimeDiff).toFixed(1)}% vs baseline`;
            }

            // Draw sparklines using real backend histories
            drawSparkline('sparkline-timely', stats.perf_history || vol.map(() => stats.timely_percent || 0), '#4f8cff');
            drawSparkline('sparkline-volume', vol, '#10b981');
            drawSparkline('sparkline-delay', stats.delay_history || vol.map(() => stats.avg_delay_mins || 0), '#f59e0b');
            drawSparkline('sparkline-drivers', vol.map(() => stats.total_drivers || 0), '#a855f7');
            drawSparkline('sparkline-wh', vol.map(() => stats.total_warehouses || 0), '#4f8cff');
            drawSparkline('sparkline-veh', vol.map(() => stats.total_vehicles || 0), '#6366f1');
            drawSparkline('sparkline-revenue', stats.revenue_history || vol.map(() => netProfit), '#10b981');
            drawSparkline('sparkline-co2-km', stats.co2_trend || vol.map(() => stats.avg_co2_per_km || 0), '#10b981');

            // CO₂ Trend Chart
            const co2Data = stats.co2_trend || vol.map(() => 0);
            const totalCO2 = co2Data.reduce((a, b) => a + b, 0);
            const co2El = document.getElementById('stat-co2-total');
            if (co2El) animateCounter(co2El, totalCO2, 'number');
            if (co2El) { setTimeout(() => { co2El.innerText = `${totalCO2.toFixed(1)} kg`; }, 950); }
            renderCO2Chart(co2Data);

            // Volume / Day Trend Chart
            const volTodayEl = document.getElementById('stat-vol-today');
            if (volTodayEl) { volTodayEl.innerText = `${todayVol} today`; }
            renderVolumeTrendChart(vol);

            // Render Main Charts
            renderManagerCharts(stats);

            // Render operational deep dive charts
            if (stats.weight_distribution) renderWeightHistogram(stats.weight_distribution);
            if (stats.status_distribution) renderStatusPie(stats.status_distribution);
            if (stats.perishable_ratio) renderPerishableRatio(stats.perishable_ratio);
            if (stats.delivery_time_distribution) renderDeliveryTimeHistogram(stats.delivery_time_distribution);
            if (stats.vehicle_type_breakdown) renderVehicleTypeDist(stats.vehicle_type_breakdown);
            if (stats.revenue_by_day) renderRevenueByDay(stats.revenue_by_day);
            if (stats.driver_performance_dist) renderDriverPerfDist(stats.driver_performance_dist);
            if (stats.hub_congestion) renderHubCongestion(stats.hub_congestion);
        }
        
        if (document.getElementById('stat-profits')) {
            animateCounter(document.getElementById('stat-profits'), netProfit, 'money');
        }

        // Render Charts & Cascade
        if (stats) renderManagerCharts(stats);
        renderCascadePredictor(cascade);

        // Show/hide Cascade Predictor Section depending on active risks
        const cascadeCard = document.querySelector('[data-layout-id="analytics-cascade"]');
        if (cascadeCard) {
            cascadeCard.style.display = (cascade && cascade.risks && cascade.risks.length > 0) ? 'block' : 'none';
        }

        // Show/hide Alerts Section depending on active alerts
        const insightsCard = document.getElementById('insights-panel');
        if (insightsCard) {
            insightsCard.style.display = (alertsList.length > 0) ? 'block' : 'none';
        }

        // Safety Badge Update
        const safetyAlerts = alertsList.filter(a => (a.type === 'fatigue' || a.type === 'breakdown'));
        const badge = document.getElementById('safety-badge');
        if (badge) {
            badge.innerText = safetyAlerts.length;
            badge.style.display = safetyAlerts.length > 0 ? 'inline' : 'none';
        }

        if (alertsList.length === 0) {
            container.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted);">No active system alerts.</p>`;
            return;
        }

        container.innerHTML = alertsList.map(a => `
            <div style="background: rgba(255, 255, 255, 0.05); border-left: 3px solid ${a.severity==='critical'?'var(--danger)':'var(--warning)'}; padding: 10px; margin-bottom: 10px; border-radius: 8px; position:relative;">
                <button style="position:absolute; top:8px; right:8px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem;" onclick="resolveAlert('${a.id}')">✖</button>
                <p style="margin:0; padding-right:20px; font-size: 0.9rem;"><strong>${a.type.toUpperCase()}:</strong> ${a.description}<br>
                <em style="color:var(--accent)">Suggestion: ${a.suggestion}</em></p>
                <button class="btn-primary" style="padding:2px 10px; font-size:0.7rem; margin-top:8px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2);" onclick="resolveAlert('${a.id}')">Dismiss Alert</button>
            </div>
        `).join('');
    } catch(e) {
        console.error("Error in loadInsights:", e);
    }
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

// ── CO₂ 7-Day Trend Chart ────────────────────────────────────
function renderCO2Chart(data) {
    const ctx = document.getElementById('co2TrendChart')?.getContext('2d');
    if (!ctx) return;
    if (co2Chart) co2Chart.destroy();
    const labels = ['D-6','D-5','D-4','D-3','D-2','D-1','Today'];
    co2Chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: data.map((v, i) => i === 6 ? 'rgba(16,185,129,0.8)' : 'rgba(16,185,129,0.35)'),
                borderColor: '#10b981',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 1000 },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.raw.toFixed(1)} kg CO₂` } } },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                y: { display: false, beginAtZero: true }
            }
        }
    });
}

// ── Shipments/Day Trend Chart ────────────────────────────────
function renderVolumeTrendChart(data) {
    const ctx = document.getElementById('volumeTrendChart')?.getContext('2d');
    if (!ctx) return;
    if (volTrendChart) volTrendChart.destroy();
    const labels = ['D-6','D-5','D-4','D-3','D-2','D-1','Today'];
    volTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data,
                borderColor: '#4f8cff',
                backgroundColor: 'rgba(79,140,255,0.12)',
                fill: true,
                tension: 0.4,
                pointRadius: data.map((_, i) => i === 6 ? 5 : 2),
                pointBackgroundColor: data.map((_, i) => i === 6 ? '#4f8cff' : 'rgba(79,140,255,0.5)'),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 1000 },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.raw} shipments` } } },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                y: { display: false, beginAtZero: true }
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
    
    if (totalHoursEl) {
        totalHoursEl.innerText = `${data.total_impact_hours || 0} hrs`;
    }
    
    if (!data.risks || data.risks.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">
            <div style="font-size:2rem; margin-bottom:10px;">🛡️</div>
            Network Stable. No cascading risks detected.
        </div>`;
        if (recDiv) recDiv.style.display = 'none';
        return;
    }
    
    if (recDiv) recDiv.style.display = 'block';
    if (recText) recText.innerText = data.recommendation || '';
    
    container.innerHTML = data.risks.map(r => `
        <div class="glass-card" style="padding:24px; border-left: 4px solid ${r.severity==='high'?'var(--danger)':'var(--warning)'}; background:rgba(255,255,255,0.02); margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                <span style="font-size:0.75rem; color:var(--muted); font-weight:bold; letter-spacing:0.05em;">SOURCE: ${r.source_shipment_id ? r.source_shipment_id.slice(0,8) : 'UNKNOWN'}</span>
                <span class="status-pill" style="background:${r.severity==='high'?'var(--danger)':'var(--warning)'}22; color:${r.severity==='high'?'var(--danger)':'var(--warning)'}; font-size:0.7rem;">${(r.severity || 'UNKNOWN').toUpperCase()} RISK</span>
            </div>
            <h3 style="margin:8px 0; font-size:1.1rem;">${r.description || ''}</h3>
            <p style="font-size:0.9rem; color:var(--danger); font-weight:600; margin-bottom:16px;">Current Deviation: +${r.current_delay || 0}</p>
            
            <div style="border-top: 1px solid var(--border); padding-top:16px;">
                <small style="color:var(--muted); display:block; margin-bottom:8px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em;">Predicted Hub Impacts:</small>
                ${(r.impact_hubs || []).map(h => `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:0.85rem;">
                        <span style="font-weight:600;">📍 ${h.location || ''}</span>
                        <span style="color:${h.risk_level==='critical'?'var(--danger)':'var(--warning)'}">+${h.est_delay_mins || 0}m</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

async function resolveAlert(id) {
    showToast('Alert resolved successfully', 'success');
    loadInsights();
}

let esgDataGlobal = null;

async function loadEsgData() {
    try {
        const companyId = localStorage.getItem('manager_id');
        const data = await apiCall(`/manager/analytics/esg?company_id=${companyId}`);
        esgDataGlobal = data;

        // Update elements
        const offsetWeightEl = document.getElementById('esg-offset-weight');
        const fuelSavedEl = document.getElementById('esg-fuel-saved');
        const greenPctEl = document.getElementById('esg-green-pct');

        if (offsetWeightEl) offsetWeightEl.innerText = `${(data.offsets_accumulated_kg || 0).toLocaleString()} kg`;
        if (fuelSavedEl) fuelSavedEl.innerText = `${(data.fuel_saved_liters || 0).toLocaleString()} L`;
        if (greenPctEl) greenPctEl.innerText = `${(data.green_fleet_pct || 0)}%`;
    } catch(err) {
        console.error("ESG Load failed:", err);
    }
}

function downloadGreenCertificate() {
    if (!esgDataGlobal) {
        showToast('ESG data not loaded yet — please wait a moment.', 'error');
        return;
    }

    const companyName = localStorage.getItem('company_name') || localStorage.getItem('manager_name') || "Logistix Partner";
    const integrityHash = esgDataGlobal.cryptographic_hash;
    const offsetWeight = esgDataGlobal.offsets_accumulated_kg;
    const fuelSaved = esgDataGlobal.fuel_saved_liters;
    const greenPct = esgDataGlobal.green_fleet_pct;
    const printDate = new Date().toLocaleDateString('en-IN', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    const certWindow = window.open('', '_blank', 'width=800,height=600');
    certWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Green Logistics Certificate - ${companyName}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap');
                body {
                    font-family: 'Outfit', sans-serif;
                    background: #090d16;
                    color: #e2e8f0;
                    margin: 0;
                    padding: 40px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                }
                .certificate {
                    background: radial-gradient(circle at 50% 50%, #111827, #030712);
                    border: 8px double #10b981;
                    border-radius: 24px;
                    padding: 50px;
                    max-width: 700px;
                    width: 100%;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    text-align: center;
                    position: relative;
                }
                .header {
                    font-size: 2.5rem;
                    font-weight: 800;
                    color: #10b981;
                    margin-bottom: 5px;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                }
                .subtitle {
                    font-size: 1.1rem;
                    color: #94a3b8;
                    margin-bottom: 30px;
                    letter-spacing: 1px;
                }
                .recipient-title {
                    font-size: 1rem;
                    color: #64748b;
                    text-transform: uppercase;
                    margin-bottom: 5px;
                }
                .recipient-name {
                    font-size: 1.8rem;
                    font-weight: 600;
                    color: #ffffff;
                    margin-bottom: 30px;
                    border-bottom: 2px solid rgba(16, 185, 129, 0.2);
                    display: inline-block;
                    padding-bottom: 10px;
                    min-width: 300px;
                }
                .description {
                    font-size: 1.05rem;
                    line-height: 1.8;
                    color: #cbd5e1;
                    margin-bottom: 40px;
                    max-width: 550px;
                    margin-left: auto;
                    margin-right: auto;
                }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 20px;
                    margin-bottom: 40px;
                }
                .stat-box {
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(16, 185, 129, 0.2);
                    border-radius: 16px;
                    padding: 15px;
                }
                .stat-val {
                    font-size: 1.4rem;
                    font-weight: 800;
                    color: #10b981;
                }
                .stat-lbl {
                    font-size: 0.75rem;
                    color: #94a3b8;
                    margin-top: 5px;
                    text-transform: uppercase;
                }
                .footer {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                    margin-top: 50px;
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                    padding-top: 20px;
                    font-size: 0.8rem;
                    color: #64748b;
                }
                .signature {
                    text-align: left;
                }
                .hash-box {
                    font-family: monospace;
                    background: rgba(0, 0, 0, 0.4);
                    padding: 6px 12px;
                    border-radius: 6px;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    max-width: 250px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 0.7rem;
                }
                @media print {
                    body {
                        background: #ffffff;
                        color: #000000;
                    }
                    .certificate {
                        background: #ffffff;
                        border-color: #047857;
                        color: #000000;
                        box-shadow: none;
                    }
                    .recipient-name {
                        color: #000000;
                        border-bottom-color: #047857;
                    }
                    .stat-box {
                        background: #f0fdf4;
                        border-color: #a7f3d0;
                    }
                    .stat-val {
                        color: #047857;
                    }
                    .stat-lbl {
                        color: #374151;
                    }
                    .description {
                        color: #1f2937;
                    }
                    .hash-box {
                        background: #f3f4f6;
                        color: #4b5563;
                        border-color: #e5e7eb;
                    }
                }
            </style>
        </head>
        <body>
            <div class="certificate">
                <div style="font-size: 3rem; margin-bottom: 15px;">🌳</div>
                <div class="header">Eco-Offset Certificate</div>
                <div class="subtitle">Green Logistics Verification Ledger</div>
                
                <div class="recipient-title">Honoring</div>
                <div class="recipient-name">${companyName}</div>
                
                <div class="description">
                    This document verifies that standard logistical freight lanes have been optimized using 
                    <b>Logistix Green Routing Heuristics</b> to bypass high-congestion, steep-gradient, and high-idle sectors, 
                    resulting in measurable reduction of atmospheric greenhouse gas emissions.
                </div>
                
                <div class="stats-grid">
                    <div class="stat-box">
                        <div class="stat-val">${offsetWeight} kg</div>
                        <div class="stat-lbl">CO2 Offset</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-val">${fuelSaved} L</div>
                        <div class="stat-lbl">Fuel Saved</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-val">${greenPct}%</div>
                        <div class="stat-lbl">Eco Route Share</div>
                    </div>
                </div>
                
                <div class="footer">
                    <div class="signature">
                        <b>LOGISTIX GREEN AUDIT</b><br>
                        Verification Date: ${printDate}
                    </div>
                    <div>
                        <div style="margin-bottom: 5px; text-transform:uppercase; font-size: 0.65rem;">Cryptographic Ledger Hash</div>
                        <div class="hash-box" title="${integrityHash}">${integrityHash}</div>
                    </div>
                </div>
            </div>
            <script>
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                    }, 500);
                }
            </script>
        </body>
        </html>
    `);
    certWindow.document.close();
}
const PALETTE = {
    blue:    ['#4f8cff','rgba(79,140,255,0.12)'],
    green:   ['#10b981','rgba(16,185,129,0.12)'],
    purple:  ['#a855f7','rgba(168,85,247,0.12)'],
    orange:  ['#f59e0b','rgba(245,158,11,0.12)'],
    red:     ['#ef4444','rgba(239,68,68,0.12)'],
    cyan:    ['#06b6d4','rgba(6,182,212,0.12)'],
    indigo:  ['#6366f1','rgba(99,102,241,0.12)'],
    emerald: ['#34d399','rgba(52,211,153,0.12)'],
};
const MULTI_COLORS = ['#4f8cff','#10b981','#a855f7','#f59e0b','#ef4444','#06b6d4','#6366f1','#f472b6'];
const MULTI_BG = MULTI_COLORS.map(c => c + '33');

const BASE_CHART_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: "'Manrope', sans-serif", size: 11, weight: '600' }, padding: 14, usePointStyle: true } }
    },
    scales: {
        y: {
            grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
            ticks: { color: '#94a3b8', font: { size: 11 }, padding: 8 }
        },
        x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { size: 11 }, padding: 8 }
        }
    }
};

function renderWeightHistogram(data) {
    const ctx = document.getElementById('weightHistChart')?.getContext('2d');
    if (!ctx) return;
    if (weightChart) weightChart.destroy();
    const labels = Object.keys(data);
    const values = Object.values(data);
    weightChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Shipments',
                data: values,
                backgroundColor: [PALETTE.blue[0], PALETTE.purple[0], PALETTE.orange[0], PALETTE.red[0]],
                borderRadius: 8, borderSkipped: false
            }]
        },
        options: {
            ...BASE_CHART_OPTIONS,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.raw} shipments` } } }
        }
    });
}

function renderStatusPie(data) {
    const ctx = document.getElementById('statusPieChart')?.getContext('2d');
    if (!ctx) return;
    if (statusPieChart) statusPieChart.destroy();
    const labels = Object.keys(data);
    const values = Object.values(data);
    statusPieChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels,
            datasets: [{ data: values, backgroundColor: MULTI_COLORS.slice(0, labels.length), borderWidth: 0, hoverOffset: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: "'Manrope', sans-serif", size: 11 }, padding: 12, usePointStyle: true } } }
        }
    });
}

function renderPerishableRatio(data) {
    const ctx = document.getElementById('perishableChart')?.getContext('2d');
    if (!ctx) return;
    if (perishableChart) perishableChart.destroy();
    perishableChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(data),
            datasets: [{ data: Object.values(data), backgroundColor: ['#f59e0b','#6366f1'], borderWidth: 0, hoverOffset: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '70%',
            plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, padding: 12, usePointStyle: true } } }
        }
    });
}

function renderDeliveryTimeHistogram(data) {
    const ctx = document.getElementById('deliveryTimeChart')?.getContext('2d');
    if (!ctx) return;
    if (deliveryTimeChart) deliveryTimeChart.destroy();
    const labels = Object.keys(data);
    const values = Object.values(data);
    const total = values.reduce((a, b) => a + b, 0) || 1;
    deliveryTimeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Deliveries',
                data: values,
                backgroundColor: ['#10b981','#34d399','#f59e0b','#f97316','#ef4444'],
                borderRadius: 8, borderSkipped: false
            }]
        },
        options: {
            ...BASE_CHART_OPTIONS,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${ctx.raw} (${((ctx.raw / total) * 100).toFixed(1)}%)` } }
            }
        }
    });
}

function renderRevenueByDay(data) {
    const ctx = document.getElementById('revenueByDayChart')?.getContext('2d');
    if (!ctx) return;
    if (revenueByDayChart) revenueByDayChart.destroy();
    const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    revenueByDayChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Revenue (₹)',
                data: data,
                backgroundColor: '#10b981',
                borderRadius: 8, borderSkipped: false
            }]
        },
        options: {
            ...BASE_CHART_OPTIONS,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `₹ ${(ctx.raw || 0).toLocaleString('en-IN')}` } } }
        }
    });
}

function renderDriverPerfDist(data) {
    const ctx = document.getElementById('driverPerfChart')?.getContext('2d');
    if (!ctx) return;
    if (driverPerfChart) driverPerfChart.destroy();
    const labels = Object.keys(data);
    const values = Object.values(data);
    driverPerfChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data: values, backgroundColor: ['#10b981','#4f8cff','#f59e0b','#ef4444'], borderWidth: 0, hoverOffset: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, padding: 10, usePointStyle: true } } }
        }
    });
}

function renderVehicleTypeDist(data) {
    const ctx = document.getElementById('vehicleTypeChart')?.getContext('2d');
    if (!ctx) return;
    if (vehicleTypeChart) vehicleTypeChart.destroy();
    const labels = Object.keys(data);
    vehicleTypeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Count',
                data: Object.values(data),
                backgroundColor: MULTI_COLORS.slice(0, labels.length),
                borderRadius: 8, borderSkipped: false
            }]
        },
        options: { ...BASE_CHART_OPTIONS, plugins: { legend: { display: false } } }
    });
}

function renderHubCongestion(hubs) {
    const ctx = document.getElementById('hubCongestionChart')?.getContext('2d');
    if (!ctx || !hubs || !hubs.length) return;
    if (hubCongestionChart) hubCongestionChart.destroy();
    const colors = hubs.map(h => h.utilization_pct > 80 ? '#ef4444' : h.utilization_pct > 50 ? '#f59e0b' : '#10b981');
    hubCongestionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: hubs.map(h => h.name),
            datasets: [{
                label: 'Utilization %',
                data: hubs.map(h => h.utilization_pct),
                backgroundColor: colors,
                borderRadius: 6, borderSkipped: false
            }, {
                label: 'Capacity',
                data: hubs.map(h => h.capacity),
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 1, borderRadius: 6, borderSkipped: false
            }]
        },
        options: {
            ...BASE_CHART_OPTIONS,
            indexAxis: 'y',
            plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { size: 10 }, padding: 10 } } },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8' } },
                y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } }
            }
        }
    });
}

window.downloadGreenCertificate = downloadGreenCertificate;
window.loadEsgData = loadEsgData;

async function initPage() {
    loadInsights();
    loadEsgData();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
} else {
    initPage();
}