import os

file_path = '/Users/adrish/Desktop/Projects/logistix/frontend/pages/executive_weather.html'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Replace Scripts and CSS
css_old = """    <!-- Leaflet CSS -->
    <link crossorigin="" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css" rel="stylesheet"/>"""
css_new = "    <!-- Google Maps dynamically injects CSS -->"
content = content.replace(css_old, css_new)

scripts_old = """<!-- Scripts -->
<script crossorigin="" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>"""
scripts_new = """<!-- Scripts -->
<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDVPnuQKHJxNnw3kstRBfIynZbafz2llpo&libraries=drawing,visualization,places,geometry"></script>"""
content = content.replace(scripts_old, scripts_new)

# 2. Replace initWeatherMap
init_old = """    function initWeatherMap() {
        if (map) return;
        const theme = localStorage.getItem('theme') || 'dark';
        
        map = L.map('map', {
            center: [20.5937, 78.9629],
            zoom: 5,
            zoomControl: false,
            attributionControl: false
        });
        window._weatherMap = map;

        const tileUrl = theme === 'dark' 
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
            
        L.tileLayer(tileUrl, { attribution: '&copy; CARTO' }).addTo(map);

        // Map borders overlay (SoI compliance)
        fetch('../data/india-composite-simplified.geojson').then(r => r.ok ? r.json() : Promise.reject('no local')).then(data => {
            const borderStyle = { color: '#00e5ff', weight: 2.5, fillOpacity: 0, opacity: 0.95, lineJoin: 'round', lineCap: 'round' };
            L.geoJSON(data, { style: borderStyle }).addTo(map);
        }).catch(() => {});

        // Setup Drawing Manager
        const drawControl = new L.Control.Draw({
            draw: {
                polygon: false, marker: false, circlemarker: false, rectangle: false,
                circle: { shapeOptions: { color: '#ff9900', weight: 2, fillOpacity: 0.2 } },
                polyline: { shapeOptions: { color: '#ff3b30', weight: 4 } }
            },
            edit: false
        });
        map.addControl(drawControl);

        map.on(L.Draw.Event.CREATED, function (e) {
            const layer = e.layer;
            drawnItems.addLayer(layer);
            handleCustomDisaster(e.layerType, layer);
            setDrawMode(false);
        });

        drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);"""

init_new = """    function initWeatherMap() {
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
        });"""
content = content.replace(init_old, init_new)

# 3. Replace updateMapTheme and changeMapLayer
theme_old = """    function updateMapTheme(mapInstance) {
        if (!mapInstance) return;
        const theme = localStorage.getItem('theme') || 'dark';
        let tileUrl = theme === 'dark' 
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
            
        mapInstance.eachLayer((layer) => {
            if (layer instanceof L.TileLayer && !layer.options.id) {
                layer.setUrl(tileUrl);
            }
        });
    }

    function changeMapLayer() {
        if (!map) return;
        const layerType = document.getElementById('map-layer').value;
        const theme = localStorage.getItem('theme') || 'dark';
        let tileUrl = theme === 'dark' 
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
            
        if (layerType === 'terrain') tileUrl = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
        else if (layerType === 'satellite') tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

        map.eachLayer((layer) => {
            if (layer instanceof L.TileLayer) map.removeLayer(layer);
        });
        L.tileLayer(tileUrl, { attribution: '&copy; CARTO' }).addTo(map);
    }"""
theme_new = """    function updateMapTheme(mapInstance) {
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
    }"""
content = content.replace(theme_old, theme_new)

# 4. Replace Heatmap
heat_old = """    function updateHeatmap(fleetData) {
        if (!fleetData) return;
        const points = fleetData.map(v => [v.lat, v.lng, (v.fatigue || 0) / 100 + 0.5]);
        if (heatmap) map.removeLayer(heatmap);
        
        heatmap = L.heatLayer(points, {
            radius: 25,
            blur: 15,
            maxZoom: 17,
            gradient: { 0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1.0: 'red' }
        });
        
        if (document.getElementById('toggle-heatmap')?.classList.contains('active')) {
            heatmap.addTo(map);
        }
    }"""
heat_new = """    function updateHeatmap(fleetData) {
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
    }"""
content = content.replace(heat_old, heat_new)

# 5. Drawing handlers
draw_old = """    function setDrawMode(active) {
        isDrawing = active;
        const btn = document.getElementById('draw-btn');
        if (active) { 
            btn.classList.add('drawing'); btn.innerHTML = '⏹️ Cancel Draw'; 
        } else { 
            btn.classList.remove('drawing'); btn.innerHTML = '✏️ Draw on Map';
            if (currentDrawHandler) { currentDrawHandler.disable(); currentDrawHandler = null; }
        }
    }

    function toggleDrawMode() {
        if (!map) return showToast('Map not ready.', 'error');
        if (isDrawing) return setDrawMode(false);
        const type = document.getElementById('disaster-type').value;
        const circleTypes = ['cyclone', 'flood', 'heatwave', 'earthquake', 'riot', 'hail', 'storm', 'snow', 'fog', 'rain'];
        
        if (circleTypes.includes(type)) currentDrawHandler = new L.Draw.Circle(map, { shapeOptions: { color: '#ff9900', weight: 2, fillOpacity: 0.2 } });
        else currentDrawHandler = new L.Draw.Polyline(map, { shapeOptions: { color: '#ff3b30', weight: 4 } });
        
        currentDrawHandler.enable();
        setDrawMode(true);
    }

    async function handleCustomDisaster(shapeType, layer) {
        const type = document.getElementById('disaster-type').value;
        let payload = { company_id: localStorage.getItem('manager_id'), type, shapeType };
        if (shapeType === 'circle') { payload.lat = layer.getLatLng().lat; payload.lng = layer.getLatLng().lng; payload.radius = layer.getRadius() / 1000; }
        else if (shapeType === 'polyline') { payload.coordinates = layer.getLatLngs().map(ll => ({ lat: ll.lat, lng: ll.lng })); }

        try {
            await apiCall('/simulation/disaster/custom', 'POST', payload);
            simulationPanelClosedByUser = false;
            showToast(`${type.toUpperCase()} zone created!`, 'success');
            if (drawnItems && layer) drawnItems.removeLayer(layer);
            loadWeatherFleetData();
        } catch(err) {
            if (drawnItems && layer) drawnItems.removeLayer(layer);
            showToast('Failed to create zone.', 'error');
        }
    }

    async function clearDisasters() {
        if (!confirm('Clear all zones?')) return;
        try {
            await apiCall('/simulation/disaster/clear', 'POST', { company_id: localStorage.getItem('manager_id') });
            drawnItems.clearLayers();"""
draw_new = """    function setDrawMode(active) {
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
            drawnItems.forEach(i => i.setMap(null)); drawnItems = [];"""
content = content.replace(draw_old, draw_new)

# 6. fleet plotting
fleet_old = """            weatherMarkers.forEach(m => map.removeLayer(m)); weatherMarkers = [];
            warehouseMarkers.forEach(m => map.removeLayer(m)); warehouseMarkers = [];

            try {
                const warehouses = await apiCall('/manager/warehouses?company_id=' + localStorage.getItem('manager_id'), 'GET', null, true);
                warehouses.forEach(wh => {
                    const icon = L.divIcon({ className: 'wh-marker', html: `<div style="background:rgba(0, 255, 115, 0.15); border:2px solid var(--success); box-shadow:0 0 12px rgba(0, 255, 115, 0.5); border-radius:8px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-size:14px;">🏢</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
                    const m = L.marker([wh.lat, wh.lng], {icon}).addTo(map);
                    m.bindPopup(`<div style="min-width:180px; font-family:Space Grotesk,sans-serif; line-height:1.6; color:#0f172a;"><b style="color:#10b981; font-size:1.1rem;">🏭 ${wh.name}</b><br><small style="color:#64748b;">📍 ${wh.address||'N/A'}</small></div>`);
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
                    const poly = L.polyline(cell.coordinates, { color: cell.color || '#ff9900', weight: 6, opacity: 0.85 }).addTo(map);
                    weatherMarkers.push(poly);
                } else {
                    const bc = cell.is_simulation ? '#ff9900' : (cell.color || '#00e5ff');
                    const circ = L.circle([cell.lat, cell.lng], { color: bc, fillColor: bc, fillOpacity: cell.is_simulation?0.18:0.12, radius: (cell.radius||80)*1000, weight: cell.is_simulation?2:1.5 }).addTo(map);
                    weatherMarkers.push(circ);
                }
            });

            data.fleet.forEach(v => {
                const isCrit = v.weather && v.weather.multiplier >= 1.5;
                const markerHtml = `<div style="transform:rotate(${v.bearing||0}deg); font-size:20px; filter:drop-shadow(0 0 10px ${isCrit?'rgba(255,59,48,0.8)':'rgba(0,229,255,0.8)'});">🚛</div>`;
                const icon = L.divIcon({ className: 'fleet-marker', html: markerHtml, iconSize: [24,24], iconAnchor: [12,12] });
                const m = L.marker([v.lat, v.lng], {icon}).addTo(map);
                m.bindPopup(`<b style="color:#0f172a;">Driver: ${v.driver_name||'Unknown'}</b><br><span style="color:#64748b;">Vehicle: ${v.id}</span><br><span style="color:${isCrit?'#ef4444':'#10b981'}; font-weight:bold;">Status: ${isCrit?'Critical Weather':'Safe'}</span>`);
                weatherMarkers.push(m);
            });"""
fleet_new = """            weatherMarkers.forEach(m => m.setMap(null)); weatherMarkers = [];
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
                }
            });

            data.fleet.forEach(v => {
                const isCrit = v.weather && v.weather.multiplier >= 1.5;
                const m = new google.maps.Marker({
                    position: {lat: v.lat, lng: v.lng},
                    map: map,
                    icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><g transform="rotate(${v.bearing||0} 15 15)"><text x="15" y="20" font-size="20" text-anchor="middle">🚛</text></g></svg>`), scaledSize: new google.maps.Size(30,30) }
                });
                const info = new google.maps.InfoWindow({ content: `<div style="color:black;"><b style="color:#0f172a;">Driver: ${v.driver_name||'Unknown'}</b><br><span style="color:#64748b;">Vehicle: ${v.id}</span><br><span style="color:${isCrit?'#ef4444':'#10b981'}; font-weight:bold;">Status: ${isCrit?'Critical Weather':'Safe'}</span></div>` });
                m.addListener('click', () => info.open(map, m));
                weatherMarkers.push(m);
            });"""
content = content.replace(fleet_old, fleet_new)

with open(file_path, 'w') as f:
    f.write(content)
print("Successfully migrated executive_weather.html!")
