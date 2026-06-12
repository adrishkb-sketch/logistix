
    // ── ANIMATION & LAYOUT INIT ──
    document.addEventListener('DOMContentLoaded', () => {

        // Setup Mobile Sidebar
        window.toggleMobileSidebar = function(state) {
            const sidebar = document.querySelector('.sidebar');
            const overlay = document.querySelector('.sidebar-overlay');
            if(sidebar) {
                if(state) {
                    sidebar.classList.add('open');
                    overlay.classList.add('active');
                } else {
                    sidebar.classList.remove('open');
                    overlay.classList.remove('active');
                }
            }
        };

        // Initialize Map Flow
        initWeatherMap();
    });

    // ── THEME SWITCH SYSTEM ──
    function setTheme(mode) {
        const svgIcon = mode === 'light'
            ? '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>'
            : '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

        if (mode === 'light') {
            document.body.classList.add('light-mode');
        } else {
            document.body.classList.remove('light-mode');
        }

        document.querySelectorAll('.mobile-theme-toggle, .desktop-theme-toggle').forEach(el => {
            el.innerHTML = svgIcon;
        });

        localStorage.setItem('theme', mode);
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { mode } }));

        if (window._weatherMap) {
            updateMapTheme(window._weatherMap);
            if (window._soiPatchLayers && window._soiPatchLayers.length) {
                window._soiPatchLayers.forEach(l => { try { window._weatherMap.removeLayer(l); } catch(e){} });
                window._soiPatchLayers = [];
            }
            applySOIMaskPatches(window._weatherMap);

            // Re-render chart colors
            if (window.riskRadarChartObj) {
                window.riskRadarChartObj.options.scales.r.grid.color = mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)';
                window.riskRadarChartObj.options.scales.r.angleLines.color = mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)';
                window.riskRadarChartObj.options.scales.r.pointLabels.color = mode === 'light' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)';
                window.riskRadarChartObj.update();
            }
        }
    }

    window.toggleTheme = function() {
        const isLight = document.body.classList.contains('light-mode');
        setTheme(isLight ? 'dark' : 'light');
    };
    setTheme(localStorage.getItem('theme') || 'dark');

    // ── AUTH ──
    if (!localStorage.getItem('manager_id')) window.location.href = '../index.html';
    function logout() { localStorage.clear(); window.location.href = '../index.html'; }

    // ── GLOBALS & MAP LOGIC ──
    let map = null, baseLayers = {}, radarLayer = null, cloudLayer = null, windLayer = null, heatLayer = null;
    let drawControl = null, drawnItems = null, currentDrawHandler = null;
    let weatherMarkers = [], warehouseMarkers = [];
    let isDrawing = false, simulationPanelClosedByUser = false, refreshInterval = null;
    window._soiPatchLayers = [];

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

        // India boundary
        map.data.loadGeoJson('../data/india-composite-simplified.geojson');
        map.data.setStyle({
            fillColor: 'transparent',
            strokeWeight: 2.5,
            strokeColor: '#00e5ff'
        });

        drawControl = new L.Control.Draw({
            edit: { featureGroup: drawnItems },
            draw: {
                polygon: false, rectangle: false, marker: false, circlemarker: false,
                circle: { shapeOptions: { color: '#ff9900', fillColor: '#ff9900', fillOpacity: 0.2, weight: 2 } },
                polyline: { shapeOptions: { color: '#ff3b30', weight: 4, opacity: 0.8 } }
            }
        });
        map.addControl(drawControl);

        map.on(L.Draw.Event.CREATED, function(e) {
            drawnItems.addLayer(e.layer);
            handleCustomDisaster(e.layerType, e.layer);
            setDrawMode(false);
        });
        map.on(L.Draw.Event.DRAWSTOP, function() { setDrawMode(false); });

        makeDraggable(document.getElementById('sim-panel'), document.getElementById('sim-panel-handle'));
        makeDraggable(document.getElementById('results-panel'), document.getElementById('results-panel-handle'));

        setTimeout(() => { if (map) map.invalidateSize(true); }, 200);

        initCharts();
        loadWeatherFleetData();
        refreshInterval = setInterval(loadWeatherFleetData, 15000);
    }

    function buildBaseLayers() {
        baseLayers = {
            standard_dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 19 }),
            standard_light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 19 }),
            terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '© OpenTopoMap', maxZoom: 17 }),
            satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri', maxZoom: 19 })
        };
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

    function loadRadarLayer() {
        fetch('https://api.rainviewer.com/public/weather-maps.json').then(r => r.json()).then(data => {
            const past = data.radar?.past;
            if (past && past.length > 0) {
                const latest = past[past.length - 1].time;
                radarLayer = L.tileLayer(`https://tilecache.rainviewer.com/v2/radar/${latest}/256/{z}/{x}/{y}/4/1_1.png`, { opacity: 0.65, zIndex: 10, isOverlay: true });
                if (document.getElementById('toggle-radar').classList.contains('active')) radarLayer.addTo(map);
            }
        }).catch(e => console.log('Radar not loaded:', e));
    }

    function loadCloudLayer() {
        cloudLayer = L.tileLayer('https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=439d4b804bc8187953eb36d2a8c26a02', { opacity: 0.5, zIndex: 9, isOverlay: true });
        if (document.getElementById('toggle-cloud').classList.contains('active')) cloudLayer.addTo(map);
    }

    function loadWindLayer() {
        windLayer = L.tileLayer('https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=439d4b804bc8187953eb36d2a8c26a02', { opacity: 0.5, zIndex: 8, isOverlay: true });
        if (document.getElementById('toggle-wind').classList.contains('active')) windLayer.addTo(map);
    }

    function toggleRadarOverlay(btn) { btn.classList.toggle('active'); if (radarLayer) btn.classList.contains('active') ? radarLayer.addTo(map) : map.removeLayer(radarLayer); }
    function toggleCloudOverlay(btn) { btn.classList.toggle('active'); if (cloudLayer) btn.classList.contains('active') ? cloudLayer.addTo(map) : map.removeLayer(cloudLayer); }
    function toggleWindOverlay(btn) { btn.classList.toggle('active'); if (windLayer) btn.classList.contains('active') ? windLayer.addTo(map) : map.removeLayer(windLayer); }
    function toggleHeatmapOverlay(btn) { btn.classList.toggle('active'); if (heatLayer) btn.classList.contains('active') ? heatLayer.addTo(map) : map.removeLayer(heatLayer); }

    function updateHeatmap(fleetData) {
        if (!fleetData || !L.heatLayer) return;
        const points = fleetData.map(v => [(v.fatigue || 0) / 100 + 0.5, v.lat, v.lng]);
        if (heatLayer) heatLayer.setLatLngs(points);
        else heatLayer = L.heatLayer(points, { radius: 25, blur: 15, maxZoom: 10, gradient: { 0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1.0: 'red' } });
        if (document.getElementById('toggle-heatmap')?.classList.contains('active')) heatLayer.addTo(map);
        else if (map && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
    }

    // ── INDIA SOI MASKING ──
    function applyOfficialBorders(mapInstance) {
        if (!mapInstance.getPane('soiMaskPane')) { const mp = mapInstance.createPane('soiMaskPane'); mp.style.zIndex = 350; }
        if (!mapInstance.getPane('soiBorderPane')) { const bp = mapInstance.createPane('soiBorderPane'); bp.style.zIndex = 360; }
        const borderStyle = { color: '#00e5ff', weight: 2.5, fillOpacity: 0, opacity: 0.95, lineJoin: 'round', lineCap: 'round', pane: 'soiBorderPane' };
        applySOIMaskPatches(mapInstance);
        fetch('../data/india-composite-simplified.geojson').then(r => r.ok ? r.json() : Promise.reject('no local')).then(data => {
            if (window._soiBorderLayer) try { mapInstance.removeLayer(window._soiBorderLayer); } catch(e){}
            window._soiBorderLayer = L.geoJSON(data, { style: borderStyle }).addTo(mapInstance);
            mapInstance.fitBounds(window._soiBorderLayer.getBounds(), { padding: [15, 15] });
        }).catch(() => {
            const fallbackBorder = { color: '#00e5ff', weight: 2.5, fillOpacity: 0, opacity: 0.95, lineJoin: 'round', lineCap: 'round', pane: 'soiBorderPane' };
            const northernClaimLine = [[33.70, 73.50], [34.00, 71.90], [34.55, 72.35], [34.70, 73.00], [35.00, 74.00], [35.20, 75.00], [35.50, 76.10], [35.80, 76.40], [36.15, 77.00], [36.85, 76.60], [37.10, 75.80], [37.06, 74.57], [36.60, 74.55], [36.20, 78.00], [36.00, 79.00], [35.60, 79.80], [35.10, 80.00], [34.80, 79.50], [34.20, 78.50], [34.00, 77.80]];
            window._soiPatchLayers.push(L.polyline(northernClaimLine, fallbackBorder).addTo(mapInstance));
        });
    }

    function applySOIMaskPatches(mapInstance) {
        // Handled by google maps boundary styling naturally
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
        } catch(e) {
            console.error("Failed to load past actions", e);
        }
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
            let promptText = "Choose a safe warehouse:\n";
            warehouses.forEach((wh, idx) => { promptText += `${idx + 1}. ${wh.name} (${wh.address || ''})\n`; });
            const sel = parseInt(prompt(promptText + "\nEnter number:"), 10) - 1;
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

        // Map Click
        if (map) {
            map.on('click', async function(e) {
                const { lat, lng } = e.latlng;
                const info = new google.maps.InfoWindow({ position: {lat: e.latLng.lat(), lng: e.latLng.lng()}, content: '<div style="font-family:Space Grotesk,sans-serif;font-size:0.85rem;padding:6px;color:black;">⏳ Fetching intel…</div>' }); info.open(map);
                try {
                    const res = await apiCall(`/tracking/weather-at?lat=${lat}&lng=${lng}&company_id=${localStorage.getItem('manager_id')}`);
                    const w = res.weather, ships = res.shipments;
                    let shipsHtml = ships.length > 0 ? `<div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:10px;padding-top:8px;max-height:120px;overflow-y:auto;"><b style="color:var(--accent-2);font-size:0.8rem;">📦 Nearby Ships (${ships.length})</b>` + ships.map(s => `<div style="font-size:0.75rem;margin-top:4px;"><b>${s.description}</b> (${s.distance_to_click_km}km)<br>Driver: ${s.driver_name} · ${s.status}</div>`).join('') + '</div>' : `<div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:10px;padding-top:8px;font-size:0.75rem;color:var(--text-muted);">No active shipments within 50km.</div>`;
                    popup.setContent(`<div style="min-width:220px; font-family:Space Grotesk,sans-serif; line-height:1.6; color:var(--text-main);"><b style="font-size:1.1rem;color:var(--accent-1);">📍 ${lat.toFixed(3)}, ${lng.toFixed(3)}</b><br><small><b>${w.icon} ${w.condition}</b> (Risk: <b>${w.risk_score}/100</b>)</small><br><small>🌡️ Temp: <b>${w.temp}°C</b></small><br><small>💨 Wind: <b>${w.wind_speed} km/h</b></small><br><small>😷 AQI: <b>${w.us_aqi}</b></small>${shipsHtml}</div>`);
                } catch(err) { popup.setContent('<div style="color:var(--danger);font-family:Space Grotesk,sans-serif;font-size:0.85rem;">❌ Failed to fetch intel.</div>'); }
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
            weatherMarkers.forEach(m => { try { map.removeLayer(m); } catch(e) {} }); weatherMarkers = [];
            warehouseMarkers.forEach(m => { try { map.removeLayer(m); } catch(e) {} }); warehouseMarkers = [];

            try {
                const warehouses = await apiCall('/manager/warehouses?company_id=' + localStorage.getItem('manager_id'), 'GET', null, true);
                warehouses.forEach(wh => {
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
                let animClass = cell.type.toLowerCase() === 'cyclone' ? 'anim-cyclone' : cell.type.toLowerCase() === 'flood' ? 'anim-flood' : 'anim-rain';
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
                }
            });

            data.fleet.forEach(v => {
                const m = new google.maps.Marker({
                    position: {lat: v.lat, lng: v.lng},
                    map: map,
                    icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><g transform="rotate(${v.bearing||0} 15 15)"><text x="15" y="20" font-size="20" text-anchor="middle">🚛</text></g></svg>`), scaledSize: new google.maps.Size(30,30) }
                });
                const info = new google.maps.InfoWindow({ content: `<div style="color:black;min-width:150px; font-family:Space Grotesk,sans-serif;"><b style="color:#6366f1;">🚛 ${v.driver}</b><br><small>${v.weather?.icon||'☀️'} ${v.weather?.condition||'Clear'}</small></div>` });
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

    // ── UTILITIES ──
    function makeDraggable(el, handle) {
        if (!el) return;
        let p1=0, p2=0, p3=0, p4=0;
        (handle || el).onmousedown = function(e) {
            e.preventDefault(); p3 = e.clientX; p4 = e.clientY;
            document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
            document.onmousemove = function(e) {
                p1 = p3 - e.clientX; p2 = p4 - e.clientY; p3 = e.clientX; p4 = e.clientY;
                el.style.top = (el.offsetTop - p2) + 'px'; el.style.left = (el.offsetLeft - p1) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
            };
        };
    }

    function showToast(msg, type='info') {
        let c = document.getElementById('toast-container');
        if (!c) { c = document.createElement('div'); c.id = 'toast-container'; c.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;'; document.body.appendChild(c); }
        const t = document.createElement('div');
        const bg = type==='error' ? 'var(--danger)' : type==='success' ? 'var(--success)' : 'var(--accent-1)';
        t.style.cssText = `background:${bg};color:#000;padding:12px 24px;border-radius:14px;font-size:0.9rem;font-weight:800;box-shadow:var(--glow-shadow);display:flex;align-items:center;gap:10px;animation:toastIn 0.3s ease forwards;pointer-events:auto; font-family:'Space Grotesk', sans-serif;`;
        t.innerHTML = `<span>${type==='error'?'🚨':type==='success'?'✅':'⏳'}</span><span>${msg}</span>`;
        if (!document.getElementById('toast-keyframes')) { const s = document.createElement('style'); s.id='toast-keyframes'; s.textContent='@keyframes toastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}'; document.head.appendChild(s); }
        c.appendChild(t); setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(()=>t.remove(), 300); }, 3500);
    }
    window.showToast = showToast;
    window.showNotification = showToast;

