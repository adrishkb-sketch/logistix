import os
import re

file_path = '/Users/adrish/Desktop/Projects/logistix/frontend/pages/executive_weather.html'
with open(file_path, 'r') as f:
    content = f.read()

# Replace CSS
content = content.replace(
    '<!-- Leaflet & Draw CSS -->\n    <link crossorigin="" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" rel="stylesheet">\n    <link href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css" rel="stylesheet"/>',
    '<!-- Google Maps API uses dynamically injected CSS -->'
)

# Replace Scripts
scripts_old = """<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script crossorigin="" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>"""

scripts_new = """<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDVPnuQKHJxNnw3kstRBfIynZbafz2llpo&libraries=drawing,visualization,places,geometry"></script>"""

content = content.replace(scripts_old, scripts_new)

# Now for the massive JS logic rewrite.
# We need to replace everything from `let map = null, baseLayers = {}` to the end of `refreshWeather()` function.

# Let's extract the exact text block we want to replace.
start_marker = "    // ── GLOBALS & MAP LOGIC ──"
end_marker = "    // ── UTILITIES ──"

if start_marker in content and end_marker in content:
    js_prefix = content[:content.find(start_marker)]
    js_suffix = content[content.find(end_marker):]

    new_js = """    // ── GLOBALS & MAP LOGIC ──
    let map = null, heatmap = null, drawingManager = null, currentDrawHandler = null;
    let weatherMarkers = [], warehouseMarkers = [], drawnItems = [];
    let isDrawing = false, simulationPanelClosedByUser = false, refreshInterval = null;
    let darkMapStyle = [
        { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
        { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
        { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
        { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] }
    ];
    let lightMapStyle = []; // Default Google style

    function initWeatherMap() {
        if (map) return;
        const theme = localStorage.getItem('theme') || 'dark';
        
        map = new google.maps.Map(document.getElementById("map"), {
            center: { lat: 20.5937, lng: 78.9629 },
            zoom: 5,
            styles: theme === 'dark' ? darkMapStyle : lightMapStyle,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        });
        window._weatherMap = map;

        drawingManager = new google.maps.drawing.DrawingManager({
            drawingMode: null,
            drawingControl: false,
            circleOptions: { fillColor: '#ff9900', fillOpacity: 0.2, strokeWeight: 2, strokeColor: '#ff9900', clickable: true, editable: false, zIndex: 1 },
            polylineOptions: { strokeColor: '#ff3b30', strokeWeight: 4, strokeOpacity: 0.8 }
        });
        drawingManager.setMap(map);

        google.maps.event.addListener(drawingManager, 'overlaycomplete', function(e) {
            drawnItems.push(e.overlay);
            let shapeType = e.type === 'polyline' ? 'polyline' : 'circle';
            handleCustomDisaster(shapeType, e.overlay);
            setDrawMode(false);
        });

        // Setup panels
        makeDraggable(document.getElementById('sim-panel'), document.getElementById('sim-panel-handle'));
        makeDraggable(document.getElementById('results-panel'), document.getElementById('results-panel-handle'));

        initCharts();
        loadWeatherFleetData();
        refreshInterval = setInterval(loadWeatherFleetData, 15000);
        
        // India boundary
        map.data.loadGeoJson('../data/india-composite-simplified.geojson');
        map.data.setStyle({
            fillColor: 'transparent',
            strokeWeight: 2.5,
            strokeColor: '#00e5ff'
        });
    }

    function updateMapTheme(mapInstance) {
        if (!mapInstance) return;
        const theme = localStorage.getItem('theme') || 'dark';
        mapInstance.setOptions({ styles: theme === 'dark' ? darkMapStyle : lightMapStyle });
    }

    function changeMapLayer() {
        if (!map) return;
        const layerType = document.getElementById('map-layer').value;
        if (layerType === 'terrain') map.setMapTypeId('terrain');
        else if (layerType === 'satellite') map.setMapTypeId('satellite');
        else map.setMapTypeId('roadmap');
    }

    // Google Weather & Air Quality APIs can be integrated via REST. We will simulate the visual layers via data points or simple custom styling if needed.
    function loadRadarLayer() {
        // With Google Maps, you usually use a tile overlay. For simplicity, we skip RainViewer if replacing entirely with Google.
    }
    function loadCloudLayer() {}
    function loadWindLayer() {}

    function updateHeatmap(fleetData) {
        if (!fleetData) return;
        const points = fleetData.map(v => {
            return {
                location: new google.maps.LatLng(v.lat, v.lng),
                weight: (v.fatigue || 0) / 100 + 0.5
            };
        });
        
        if (heatmap) {
            heatmap.setData(points);
        } else {
            heatmap = new google.maps.visualization.HeatmapLayer({
                data: points,
                radius: 25,
                gradient: ['rgba(0,0,255,0)', 'blue', 'cyan', 'lime', 'yellow', 'red']
            });
        }

        if (document.getElementById('toggle-heatmap')?.classList.contains('active')) {
            heatmap.setMap(map);
        } else {
            heatmap.setMap(null);
        }
    }

    // ── DRAWING LOGIC ──
    function setDrawMode(active) {
        isDrawing = active;
        const btn = document.getElementById('draw-btn');
        if (active) { 
            btn.classList.add('drawing'); btn.innerHTML = '⏹️ Cancel Draw'; 
        } else { 
            btn.classList.remove('drawing'); btn.innerHTML = '✏️ Draw on Map';
            if (drawingManager) drawingManager.setDrawingMode(null);
        }
    }

    function toggleDrawMode() {
        if (!map || !drawingManager) return showToast('Map not ready.', 'error');
        if (isDrawing) return setDrawMode(false);
        const type = document.getElementById('disaster-type').value;
        const circleTypes = ['cyclone', 'flood', 'heatwave', 'earthquake', 'riot', 'hail', 'storm', 'snow', 'fog', 'rain'];
        
        drawingManager.setDrawingMode(circleTypes.includes(type) ? google.maps.drawing.OverlayType.CIRCLE : google.maps.drawing.OverlayType.POLYLINE);
        setDrawMode(true);
    }

    async function handleCustomDisaster(shapeType, layer) {
        const type = document.getElementById('disaster-type').value;
        let payload = { company_id: localStorage.getItem('manager_id'), type, shapeType };
        if (shapeType === 'circle') { 
            payload.lat = layer.getCenter().lat(); 
            payload.lng = layer.getCenter().lng(); 
            payload.radius = layer.getRadius() / 1000; 
        } else if (shapeType === 'polyline') { 
            payload.coordinates = layer.getPath().getArray().map(ll => ({ lat: ll.lat(), lng: ll.lng() })); 
        }

        try {
            await apiCall('/simulation/disaster/custom', 'POST', payload);
            simulationPanelClosedByUser = false;
            showToast(`${type.toUpperCase()} zone created!`, 'success');
            layer.setMap(null); // Remove from drawnItems visually, let reload fetch it
            loadWeatherFleetData();
        } catch(err) {
            layer.setMap(null);
            showToast('Failed to create zone.', 'error');
        }
    }

    async function clearDisasters() {
        if (!confirm('Clear all zones?')) return;
        try {
            await apiCall('/simulation/disaster/clear', 'POST', { company_id: localStorage.getItem('manager_id') });
            drawnItems.forEach(i => i.setMap(null)); drawnItems = [];
            document.getElementById('results-panel').style.display = 'none';
            showToast('Simulation zones cleared.', 'success');
            loadWeatherFleetData();
        } catch(err) { showToast('Failed to clear.', 'error'); }
    }

    async function stopSimulation(simId) {
        try { await apiCall(`/simulation/disaster/${simId}?company_id=${localStorage.getItem('manager_id')}`, 'DELETE'); showToast('Stopped.', 'success'); loadWeatherFleetData(); }
        catch(err) { showToast('Failed to stop.', 'error'); }
    }

    function closeResultsPanel() { document.getElementById('results-panel').style.display = 'none'; simulationPanelClosedByUser = true; }

    async function executeAIAction(shipmentId, alertId) {
        if (!alertId || alertId === "null" || alertId === "none") return showToast(`AI diversion active for ${shipmentId.substring(0,8)}.`, 'info');
        try { await apiCall(`/manager/alerts/${alertId}/resolve`, 'POST'); showToast(`Contingency verified.`, 'success'); loadWeatherFleetData(); }
        catch(err) { showToast('Failed to resolve.', 'error'); }
    }

    window.togglePastActions = function() {
        const list = document.getElementById('past-actions-list');
        if (list.style.display === 'none') {
            list.style.display = 'block';
            loadPastActions();
        } else {
            list.style.display = 'none';
        }
    };

    async function loadPastActions() {
        try {
            const past = await apiCall('/tracking/alerts/past?company_id=' + localStorage.getItem('manager_id'), 'GET', null, true);
            const countEl = document.getElementById('past-actions-count');
            if (countEl) countEl.innerText = past.length;
            
            const list = document.getElementById('past-actions-list');
            if (list) {
                if (past.length === 0) {
                    list.innerHTML = `<div style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding:10px;">No past AI actions taken.</div>`;
                } else {
                    list.innerHTML = past.map(a => `
                        <div style="font-size:0.75rem; padding:8px 10px; background:rgba(255,255,255,0.02); border-left:3px solid var(--success); border-radius:6px; margin-bottom:6px; border-top: 1px solid rgba(255,255,255,0.02); border-right: 1px solid rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.02);">
                            <div style="font-weight:bold; color:var(--text-main); display:flex; justify-content:space-between;">
                                <span>Shipment: ${a.shipment_id ? a.shipment_id.substring(0,8) : 'N/A'}</span>
                                <span style="color:var(--text-muted); font-size:0.65rem;">${new Date(a.resolved_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                            </div>
                            <div style="margin-top:4px; color:var(--text-muted); line-height:1.3;">${a.description || 'Action verified.'}</div>
                        </div>
                    `).join('');
                }
            }
        } catch(e) { console.error("Failed to load past actions", e); }
    }

    async function applySimulationFixes() {
        showToast('Executing AI contingency protocols…', 'info');
        let count = 0;
        for (const item of document.querySelectorAll('.affected-item')) {
            const alertId = item.getAttribute('data-alert-id');
            if (alertId && alertId !== "null" && alertId !== "none") {
                try { await apiCall(`/manager/alerts/${alertId}/resolve`, 'POST'); count++; } catch(e) {}
            }
        }
        showToast(count > 0 ? `Verified reroutes for ${count} shipments.` : 'No pending alerts.', count > 0 ? 'success' : 'info');
        loadWeatherFleetData();
    }

    async function manualDivert(shipmentId) {
        try {
            const warehouses = await apiCall('/manager/warehouses?company_id=' + localStorage.getItem('manager_id'), 'GET', null, true);
            if (!warehouses || warehouses.length === 0) return showToast('No warehouses found.', 'error');
            let promptText = "Choose a safe warehouse:\\n";
            warehouses.forEach((wh, idx) => { promptText += `${idx + 1}. ${wh.name} (${wh.address || ''})\\n`; });
            const sel = parseInt(prompt(promptText + "\\nEnter number:"), 10) - 1;
            if (isNaN(sel) || sel < 0 || sel >= warehouses.length) return showToast('Invalid selection.', 'error');
            const wh = warehouses[sel];
            if (!prompt('Enter reason:')) return;

            await apiCall(`/shipments/${shipmentId}`, 'PUT', { drop: { lat: wh.lat, lng: wh.lng, address: wh.name }, drop_warehouse_id: wh.id, stage: `Manually Diverted: ${wh.name}`, status: "assigned" });
            showToast(`Diverted to ${wh.name}`, 'success');

            for (const item of document.querySelectorAll('.affected-item')) {
                if (item.getAttribute('data-shipment-id') === shipmentId) {
                    const aId = item.getAttribute('data-alert-id');
                    if (aId && aId !== "null" && aId !== "none") await apiCall(`/manager/alerts/${aId}/resolve`, 'POST');
                }
            }
            loadWeatherFleetData();
        } catch(err) { showToast('Failed to manual divert.', 'error'); }
    }

    // ── CHARTS ──
    let riskRadarChartObj = null, highRiskHubsChartObj = null, fleetExposureChartObj = null, weatherTrendsChartObj = null;
    let weatherTableData = [], weatherSearchQuery = "", currentTablePage = 1, itemsPerTablePage = 8;
    let clickInfoWindow = null;

    function initCharts() {
        const txtColor = document.body.classList.contains('light-mode') ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)';
        const gridColor = document.body.classList.contains('light-mode') ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)';

        // Radar
        riskRadarChartObj = new Chart(document.getElementById('riskRadarChart').getContext('2d'), {
            type: 'radar',
            data: { labels: ['Temp', 'Wind', 'Rain', 'AQI', 'Heat Stress'], datasets: [{ label: 'Risk Profile', data: [0,0,0,0,0], backgroundColor: 'rgba(0, 229, 255, 0.2)', borderColor: '#00e5ff', pointBackgroundColor: '#00e5ff', borderWidth: 2 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { r: { grid: { color: gridColor }, angleLines: { color: gridColor }, pointLabels: { color: txtColor, font: { family: 'Space Grotesk', size: 11 } }, ticks: { display: false } } }, plugins: { legend: { display: false } } }
        });

        // Horizontal Bar
        highRiskHubsChartObj = new Chart(document.getElementById('highRiskHubsChart').getContext('2d'), {
            type: 'bar',
            data: { labels: [], datasets: [{ label: 'Risk Score', data: [], backgroundColor: 'rgba(255, 59, 48, 0.75)', borderColor: '#ff3b30', borderWidth: 1.5, borderRadius: 6 }] },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { grid: { color: gridColor }, ticks: { color: txtColor } }, y: { grid: { display: false }, ticks: { color: txtColor, font: { family: 'Space Grotesk' } } } }, plugins: { legend: { display: false } } }
        });

        // Doughnut
        fleetExposureChartObj = new Chart(document.getElementById('fleetExposureChart').getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['Safe', 'Caution', 'Critical'], datasets: [{ data: [0, 0, 0], backgroundColor: ['#00ff73', '#ff9900', '#ff3b30'], borderWidth: 0, hoverOffset: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: txtColor, font: { family: 'Space Grotesk', size: 12 } } } }, cutout: '70%' }
        });

        // Line
        weatherTrendsChartObj = new Chart(document.getElementById('weatherTrendsChart').getContext('2d'), {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'Temp (°C)', data: [], borderColor: '#ff9900', backgroundColor: 'transparent', yAxisID: 'yTemp', tension: 0.3 }, { label: 'AQI', data: [], borderColor: '#00e5ff', backgroundColor: 'transparent', yAxisID: 'yAQI', tension: 0.3 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, ticks: { color: txtColor, font: { family: 'Space Grotesk', size: 10 } } }, yTemp: { position: 'left', grid: { color: gridColor }, ticks: { color: txtColor } }, yAQI: { position: 'right', grid: { display: false }, ticks: { color: txtColor } } }, plugins: { legend: { labels: { color: txtColor, font: { family: 'Space Grotesk' } } } } }
        });

        // Map Click for Google Maps
        if (map) {
            clickInfoWindow = new google.maps.InfoWindow();
            map.addListener('click', async function(e) {
                const lat = e.latLng.lat();
                const lng = e.latLng.lng();
                clickInfoWindow.setContent('<div style="font-family:Space Grotesk,sans-serif;font-size:0.85rem;padding:6px;color:#000;">⏳ Fetching intel…</div>');
                clickInfoWindow.setPosition(e.latLng);
                clickInfoWindow.open(map);
                
                try {
                    const res = await apiCall(`/tracking/weather-at?lat=${lat}&lng=${lng}&company_id=${localStorage.getItem('manager_id')}`);
                    const w = res.weather, ships = res.shipments;
                    let shipsHtml = ships.length > 0 ? `<div style="border-top:1px solid rgba(0,0,0,0.1);margin-top:10px;padding-top:8px;max-height:120px;overflow-y:auto;"><b style="color:#f59e0b;font-size:0.8rem;">📦 Nearby Ships (${ships.length})</b>` + ships.map(s => `<div style="font-size:0.75rem;margin-top:4px;"><b>${s.description}</b> (${s.distance_to_click_km}km)<br>Driver: ${s.driver_name} · ${s.status}</div>`).join('') + '</div>' : `<div style="border-top:1px solid rgba(0,0,0,0.1);margin-top:10px;padding-top:8px;font-size:0.75rem;color:#64748b;">No active shipments within 50km.</div>`;
                    clickInfoWindow.setContent(`<div style="min-width:220px; font-family:Space Grotesk,sans-serif; line-height:1.6; color:#0f172a;"><b style="font-size:1.1rem;color:#0ea5e9;">📍 ${lat.toFixed(3)}, ${lng.toFixed(3)}</b><br><small><b>${w.icon} ${w.condition}</b> (Risk: <b>${w.risk_score}/100</b>)</small><br><small>🌡️ Temp: <b>${w.temp}°C</b></small><br><small>💨 Wind: <b>${w.wind_speed} km/h</b></small><br><small>😷 AQI: <b>${w.us_aqi}</b></small>${shipsHtml}</div>`);
                } catch(err) { clickInfoWindow.setContent('<div style="color:var(--danger);font-family:Space Grotesk,sans-serif;font-size:0.85rem;">❌ Failed to fetch intel.</div>'); }
            });
        }
    }

    // ── TABLE LOGIC ──
    function renderWeatherTable() {
        const tbody = document.getElementById('weather-table-body');
        if (!tbody) return;
        const filtered = weatherTableData.filter(t => t.name.toLowerCase().includes(weatherSearchQuery.toLowerCase()));
        const totalPages = Math.ceil(filtered.length / itemsPerTablePage) || 1;
        if (currentTablePage > totalPages) currentTablePage = totalPages;
        const start = (currentTablePage - 1) * itemsPerTablePage;

        tbody.innerHTML = filtered.slice(start, start + itemsPerTablePage).map(t => {
            const aqiColor = t.us_aqi > 150 ? 'var(--danger)' : t.us_aqi > 100 ? 'var(--warning)' : 'var(--success)';
            const riskColor = t.risk_score > 40 ? 'var(--danger)' : t.risk_score > 15 ? 'var(--warning)' : 'var(--success)';
            return `<tr>
                <td style="font-weight:700; color:var(--text-main);">${t.name}</td>
                <td>${t.temp != null ? t.temp.toFixed(1) : '—'}</td>
                <td>${t.wind_speed != null ? t.wind_speed.toFixed(1) + ' km/h' : '—'}</td>
                <td>${t.precipitation != null ? t.precipitation.toFixed(1) + ' mm' : '—'}</td>
                <td><span style="color: ${aqiColor}; font-weight:800;">${t.us_aqi || '—'}</span></td>
                <td>${t.visibility != null ? t.visibility.toFixed(0) + ' m' : '—'}</td>
                <td>${t.surface_pressure != null ? t.surface_pressure.toFixed(0) + ' hPa' : '—'}</td>
                <td>${t.uv_index != null ? t.uv_index.toFixed(1) : '—'}</td>
                <td style="font-weight:800; color:${riskColor}">${t.risk_score}/100</td>
            </tr>`;
        }).join('');
        document.getElementById('table-page-info').innerText = `Showing page ${currentTablePage} of ${totalPages} (${filtered.length} locations)`;
    }

    function filterWeatherTable() { weatherSearchQuery = document.getElementById('weather-search').value; currentTablePage = 1; renderWeatherTable(); }
    function prevTablePage() { if (currentTablePage > 1) { currentTablePage--; renderWeatherTable(); } }
    function nextTablePage() { if (currentTablePage < Math.ceil(weatherTableData.filter(t => t.name.toLowerCase().includes(weatherSearchQuery.toLowerCase())).length / itemsPerTablePage)) { currentTablePage++; renderWeatherTable(); } }

    function renderDynamicAdvisories(tel) {
        const advList = document.getElementById('weather-advisory-list');
        const advisories = tel.filter(t => t.risk_score > 40 || t.us_aqi > 150).map(t => {
            if (t.risk_score > 40) return { severity: 'critical', title: `${t.name}: Severe Weather`, text: `${t.temp >= 45 ? `Heatwave (${t.temp}°C)` : t.precipitation >= 15 ? `Flooding (${t.precipitation}mm)` : t.wind_speed >= 60 ? `Cyclone (${t.wind_speed} km/h)` : `High Risk`}. Handoffs halted, auto-diverts active.` };
            return { severity: 'warning', title: `${t.name}: Poor AQI`, text: `AQI ${t.us_aqi}. Filters advised.` };
        });

        advList.innerHTML = advisories.length === 0
            ? `<div style="background:rgba(0, 255, 115, 0.08); border-left:3px solid var(--success); padding:12px; border-radius:8px; font-size:0.85rem;"><strong style="color:var(--success);">✅ All Systems Normal</strong>: No severe weather alerts active.</div>`
            : advisories.map(a => `<div style="background:${a.severity==='critical'?'rgba(255, 59, 48, 0.08)':'rgba(255, 153, 0, 0.08)'}; border-left:3px solid ${a.severity==='critical'?'var(--danger)':'var(--warning)'}; padding:12px; border-radius:8px; margin-bottom:10px; font-size:0.85rem;"><strong style="color:${a.severity==='critical'?'var(--danger)':'var(--warning)'};">${a.title}</strong>: ${a.text}</div>`).join('');
    }

    // ── MAIN DATA LOADER ──
    async function loadWeatherFleetData() {
        const spinner = document.getElementById('refresh-spinner');
        if (spinner) spinner.style.display = 'block';

        try {
            const data = await apiCall('/tracking/fleet/weather?company_id=' + localStorage.getItem('manager_id'), 'GET', null, true);
            weatherMarkers.forEach(m => m.setMap(null)); weatherMarkers = [];
            warehouseMarkers.forEach(m => m.setMap(null)); warehouseMarkers = [];

            try {
                const warehouses = await apiCall('/manager/warehouses?company_id=' + localStorage.getItem('manager_id'), 'GET', null, true);
                warehouses.forEach(wh => {
                    const el = document.createElement('div');
                    el.innerHTML = `<div style="background:rgba(0, 255, 115, 0.15); border:2px solid var(--success); box-shadow:0 0 12px rgba(0, 255, 115, 0.5); border-radius:8px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-size:14px;">🏢</div>`;
                    
                    const m = new google.maps.Marker({
                        position: {lat: wh.lat, lng: wh.lng},
                        map: map,
                        title: wh.name,
                        icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="rgba(0, 255, 115, 0.15)" stroke="#00ff73" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(28,28) }
                    });
                    
                    const info = new google.maps.InfoWindow({ content: `<div style="min-width:180px; font-family:Space Grotesk,sans-serif; line-height:1.6; color:#0f172a;"><b style="color:#10b981; font-size:1.1rem;">🏭 ${wh.name}</b><br><small style="color:#64748b;">📍 ${wh.address||'N/A'}</small></div>` });
                    m.addListener('click', () => info.open(map, m));
                    warehouseMarkers.push(m);
                });
            } catch(e) {}

            document.getElementById('stat-fleet').innerText = data.fleet.length;
            document.getElementById('stat-affected').innerText = data.affected_count;
            document.getElementById('stat-cells').innerText = data.cells.filter(c => !c.is_simulation).length;
            document.getElementById('stat-sims').innerText = data.cells.filter(c => c.is_simulation).length;

            const activeSims = data.cells.filter(c => c.is_simulation);
            const simsTable = document.getElementById('sims-table'), simsBody = document.getElementById('sims-body'), emptyMsg = document.getElementById('sims-empty-msg');
            if (activeSims.length > 0) { simsTable.style.display = 'table'; emptyMsg.style.display = 'none'; simsBody.innerHTML = activeSims.map(c => `<tr><td style="font-weight:800; color:var(--text-main);">${c.type.toUpperCase()}</td><td style="color:var(--text-muted);">${c.shapeType || 'circle'}</td><td style="text-align:right;"><button class="tool-btn tool-btn-danger" style="padding:6px 12px; font-size:0.75rem;" onclick="stopSimulation('${c.id}')">STOP</button></td></tr>`).join(''); }
            else { simsTable.style.display = 'none'; emptyMsg.style.display = 'block'; }

            data.cells.forEach(cell => {
                if (cell.shapeType === 'polyline') {
                    const poly = new google.maps.Polyline({
                        path: cell.coordinates,
                        geodesic: true, strokeColor: cell.color || '#ff9900', strokeOpacity: 0.85, strokeWeight: 6, map: map
                    });
                    weatherMarkers.push(poly);
                } else {
                    const bc = cell.is_simulation ? '#ff9900' : (cell.color || '#00e5ff');
                    const circ = new google.maps.Circle({
                        strokeColor: bc, strokeOpacity: cell.is_simulation?0.8:0.4, strokeWeight: cell.is_simulation?2:1.5, fillColor: bc, fillOpacity: cell.is_simulation?0.18:0.12, map: map, center: {lat: cell.lat, lng: cell.lng}, radius: (cell.radius||80)*1000
                    });
                    weatherMarkers.push(circ);
                    
                    const m = new google.maps.Marker({
                        position: {lat: cell.lat, lng: cell.lng}, map: map, title: cell.type,
                        icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><text x="15" y="20" font-size="20" text-anchor="middle">${cell.icon||'🌦️'}</text></svg>`), scaledSize: new google.maps.Size(30,30) }
                    });
                    const info = new google.maps.InfoWindow({ content: `<div style="min-width:180px; font-family:Space Grotesk,sans-serif; color:#000;"><b style="font-size:1.1rem;">${cell.icon||'🌩️'} ${cell.condition||cell.type}</b></div>` });
                    m.addListener('click', () => info.open(map, m));
                    weatherMarkers.push(m);
                }
            });

            data.fleet.forEach(v => {
                const m = new google.maps.Marker({
                    position: {lat: v.lat, lng: v.lng}, map: map, title: v.driver,
                    icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#00e5ff" stroke="white" stroke-width="2"/></svg>`), scaledSize: new google.maps.Size(20,20) }
                });
                const info = new google.maps.InfoWindow({ content: `<div style="min-width:150px; font-family:Space Grotesk,sans-serif; color:#000;"><b style="color:#0ea5e9;">🚛 ${v.driver}</b><br><small>${v.weather?.icon||'☀️'} ${v.weather?.condition||'Clear'}</small></div>` });
                m.addListener('click', () => info.open(map, m));
                weatherMarkers.push(m);
            });
            updateHeatmap(data.fleet);

            const resultsPanel = document.getElementById('results-panel');
            let pastCount = 0;
            try {
                const past = await apiCall('/tracking/alerts/past?company_id=' + localStorage.getItem('manager_id'), 'GET', null, true);
                pastCount = past.length;
                const countEl = document.getElementById('past-actions-count');
                if (countEl) countEl.innerText = pastCount;
                const listEl = document.getElementById('past-actions-list');
                if (listEl) {
                    if (pastCount === 0) {
                        listEl.innerHTML = `<div style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding:10px;">No past AI actions taken.</div>`;
                    } else {
                        listEl.innerHTML = past.map(a => `
                            <div style="font-size:0.75rem; padding:8px 10px; background:rgba(255,255,255,0.02); border-left:3px solid var(--success); border-radius:6px; margin-bottom:6px; border-top: 1px solid rgba(255,255,255,0.02); border-right: 1px solid rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.02);">
                                <div style="font-weight:bold; color:var(--text-main); display:flex; justify-content:space-between;">
                                    <span>Shipment: ${a.shipment_id ? a.shipment_id.substring(0,8) : 'N/A'}</span>
                                    <span style="color:var(--text-muted); font-size:0.65rem;">${new Date(a.resolved_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                </div>
                                <div style="margin-top:4px; color:var(--text-muted); line-height:1.3;">${a.description || 'Action verified.'}</div>
                            </div>
                        `).join('');
                    }
                }
            } catch(err) {
                console.error("Failed to load past actions count", err);
            }

            if (data.affected_count > 0 || pastCount > 0) {
                document.getElementById('res-affected-count').innerText = data.affected_count;
                document.getElementById('res-recommendation').innerText = data.recommendation || '—';
                document.getElementById('res-affected-list').innerHTML = (data.affected_list || []).map(s => {
                    const aiHandled = ['diverted:', 'halted:', 'returned:'].some(k => (s.stage||'').toLowerCase().includes(k));
                    const badge = aiHandled ? `<div style="margin-top:8px; display:inline-block; background:rgba(0, 255, 115, 0.15); border:1px solid var(--success); border-radius:12px; padding:6px 12px; font-size:0.75rem; color:var(--success); font-weight:800;">✅ AI Handled: ${s.stage}</div>` : '';
                    return `<div class="affected-item" data-alert-id="${s.alert_id}" data-shipment-id="${s.id}"><div class="a-title">${s.description}</div><div class="a-sub">Driver: ${s.driver_name}</div><div class="a-action">💡 ${s.ai_action}</div>${badge}${!aiHandled ? `<div class="a-btns"><button class="a-btn-ai" onclick="executeAIAction('${s.id}', '${s.alert_id}')">Verify</button><button class="a-btn-manual" onclick="manualDivert('${s.id}')">Manual</button></div>` : ''}</div>`;
                }).join('');
                
                const execBtn = resultsPanel.querySelector('.tool-btn-primary');
                if (execBtn) {
                    execBtn.style.display = data.affected_count > 0 ? 'inline-flex' : 'none';
                }
                
                if (!simulationPanelClosedByUser) resultsPanel.style.display = 'block';
            } else {
                resultsPanel.style.display = 'none';
            }

            const tel = data.telemetry || [];
            if (tel.length > 0 && riskRadarChartObj) {
                let rVals = [0,0,0,0,0];
                tel.forEach(t => { rVals[0]+=Math.min(100, Math.max(0, (t.temp||25)/45*100)); rVals[1]+=Math.min(100, Math.max(0, (t.wind_speed||10)/60*100)); rVals[2]+=Math.min(100, Math.max(0, (t.precipitation||0)/15*100)); rVals[3]+=Math.min(100, Math.max(0, (t.us_aqi||50)/300*100)); rVals[4]+=Math.min(100, Math.max(0, ((t.temp||25) > 27 ? ((t.temp||25) + ((t.humidity||50)/100 * ((t.temp||25)-25))) : (t.temp||25)) / 45 * 100)); });
                riskRadarChartObj.data.datasets[0].data = rVals.map(v => Math.round(v/tel.length));
                riskRadarChartObj.update();
            }

            const top5 = [...tel].sort((a,b)=>(b.risk_score||0)-(a.risk_score||0)).slice(0,5);
            if (highRiskHubsChartObj) { highRiskHubsChartObj.data.labels = top5.map(t=>t.name); highRiskHubsChartObj.data.datasets[0].data = top5.map(t=>t.risk_score); highRiskHubsChartObj.update(); }

            let safe=0, caut=0, crit=0;
            data.fleet.forEach(v => { const m=v.weather?.multiplier||1.0; if(m>=1.5) crit++; else if(m>1.0) caut++; else safe++; });
            if (fleetExposureChartObj) { fleetExposureChartObj.data.datasets[0].data = [safe, caut, crit]; fleetExposureChartObj.update(); }

            const keyCities = ['Mumbai', 'Delhi', 'Kolkata', 'Bengaluru', 'Chennai'];
            const cityData = keyCities.map(c => tel.find(t => t.name === c) || { name: c, temp: 25, us_aqi: 50 });
            if (weatherTrendsChartObj) { weatherTrendsChartObj.data.labels = keyCities; weatherTrendsChartObj.data.datasets[0].data = cityData.map(c => c.temp); weatherTrendsChartObj.data.datasets[1].data = cityData.map(c => c.us_aqi); weatherTrendsChartObj.update(); }

            weatherTableData = tel; renderWeatherTable(); renderDynamicAdvisories(tel);
        } catch(e) {} finally { if (spinner) spinner.style.display = 'none'; }
    }

    function refreshWeather() { loadWeatherFleetData(); showToast('Refreshing live weather data…', 'info'); }

    // ── UTILITIES ──"""

    content = content[:content.find(start_marker)] + new_js + content[content.find(end_marker):]

with open(file_path, 'w') as f:
    f.write(content)
print("Successfully rewrote executive_weather.html!")
