// Dedicated script for manager_analytics.html

let volumeChart, fleetChart;
let co2Chart, volTrendChart;
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

            // Draw sparklines
            drawSparkline('sparkline-timely', stats.perf_history || vol.map(() => stats.timely_percent || 90), '#4f8cff');
            drawSparkline('sparkline-volume', vol, '#10b981');
            drawSparkline('sparkline-delay', vol.map(v => Math.max(0, 30 - v * 2)), '#f59e0b');
            drawSparkline('sparkline-drivers', vol.map(() => stats.total_drivers || 0), '#a855f7');
            drawSparkline('sparkline-wh', vol.map(() => stats.total_warehouses || 0), '#4f8cff');
            drawSparkline('sparkline-veh', vol.map(() => stats.total_vehicles || 0), '#6366f1');
            drawSparkline('sparkline-revenue', vol.map((v, i) => (pl.net_profit || 0) * (0.8 + i * 0.04)), '#10b981');
            drawSparkline('sparkline-co2-km', vol.map((v, i) => (stats.avg_co2_per_km || 0.18) * (1 - i * 0.02)), '#10b981');

            // CO₂ Trend Chart
            const co2Data = stats.co2_trend || vol.map(v => v * 12.4);
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
        }
        
        if (document.getElementById('stat-profits')) {
            animateCounter(document.getElementById('stat-profits'), pl.net_profit || 0, 'money');
        }

        // Render Charts & Cascade
        if (stats) renderManagerCharts(stats);
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
    showToast('Alert resolved successfully', 'success');
    loadInsights();
}

let esgMapInstance = null;
let esgDataGlobal = null;

async function loadEsgData() {
    try {
        const companyId = localStorage.getItem('manager_id');
        const data = await apiCall(`/manager/analytics/esg?company_id=${companyId}`);
        esgDataGlobal = data;

        // Update elements
        document.getElementById('esg-offset-weight').innerText = `${data.offsets_accumulated_kg.toLocaleString()} kg`;
        document.getElementById('esg-fuel-saved').innerText = `${data.fuel_saved_liters.toLocaleString()} L`;
        document.getElementById('esg-green-pct').innerText = `${data.green_fleet_pct}%`;

        // Render ESG Map
        if (document.getElementById('esg-map')) {
            if (!esgMapInstance) {
                esgMapInstance = L.map('esg-map', { zoomControl: false }).setView([22.59, 88.40], 12);
                updateMapTheme(esgMapInstance);
            } else {
                esgMapInstance.eachLayer(layer => {
                    if (layer instanceof L.Polyline) {
                        esgMapInstance.removeLayer(layer);
                    }
                });
            }

            // Draw standard route (solid orange)
            const standardPoly = L.polyline(data.standard_route, {
                color: '#ff9a00',
                weight: 5,
                opacity: 0.85
            }).addTo(esgMapInstance);

            // Draw eco-optimized route (glowing green line)
            const ecoPoly = L.polyline(data.eco_route, {
                color: '#10b981',
                weight: 6,
                opacity: 0.95,
                dashArray: '10, 10'
            }).addTo(esgMapInstance);

            // Fit map boundaries
            const group = new L.featureGroup([standardPoly, ecoPoly]);
            esgMapInstance.fitBounds(group.getBounds(), { padding: [20, 20] });
        }
    } catch(err) {
        console.error("ESG Load failed:", err);
    }
}

function downloadGreenCertificate() {
    if (!esgDataGlobal) {
        showToast('ESG data not loaded yet — please wait a moment.', 'error');
        return;
    }

    const companyName = localStorage.getItem('company_name') || "Logistix Partner";
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
window.downloadGreenCertificate = downloadGreenCertificate;
window.loadEsgData = loadEsgData;

async function initPage() {
    loadInsights();
    loadEsgData();
}

document.addEventListener('DOMContentLoaded', initPage);