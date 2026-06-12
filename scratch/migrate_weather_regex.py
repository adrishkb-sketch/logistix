import re

file_path = '/Users/adrish/Desktop/Projects/logistix/frontend/pages/executive_weather.html'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Scripts
content = re.sub(r'<link crossorigin="" href="https://cdnjs\.cloudflare\.com/ajax/libs/leaflet/.*?rel="stylesheet".*?/>', '<!-- Leaflet CSS removed -->', content, flags=re.DOTALL)
content = re.sub(r'<script crossorigin="" integrity=".*?" src="https://cdnjs\.cloudflare\.com/ajax/libs/leaflet/.*?></script>', '<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDVPnuQKHJxNnw3kstRBfIynZbafz2llpo&libraries=drawing,visualization,places,geometry"></script>', content, flags=re.DOTALL)
content = re.sub(r'<script src="https://cdnjs\.cloudflare\.com/ajax/libs/leaflet\.heat/.*?></script>', '', content)
content = re.sub(r'<script src="https://cdnjs\.cloudflare\.com/ajax/libs/leaflet\.draw/.*?></script>', '', content)

# 2. Map init
init_pattern = re.compile(r'function initWeatherMap\(\) \{.*?drawnItems = new L\.FeatureGroup\(\);\s*map\.addLayer\(drawnItems\);', re.DOTALL)
init_repl = """function initWeatherMap() {
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
content = init_pattern.sub(init_repl, content)

# 3. Theme
theme_pattern = re.compile(r'function updateMapTheme\(mapInstance\) \{.*?function changeMapLayer\(\) \{.*?addTo\(map\);\n    \}', re.DOTALL)
theme_repl = """function updateMapTheme(mapInstance) {
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
content = theme_pattern.sub(theme_repl, content)

# 4. Heatmap
heat_pattern = re.compile(r'function updateHeatmap\(fleetData\) \{.*?heatmap\.addTo\(map\);\n        \}\n    \}', re.DOTALL)
heat_repl = """function updateHeatmap(fleetData) {
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
content = heat_pattern.sub(heat_repl, content)

# 5. Drawing handlers
draw_pattern = re.compile(r'function setDrawMode\(active\) \{.*?drawnItems\.clearLayers\(\);', re.DOTALL)
draw_repl = """function setDrawMode(active) {
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
content = draw_pattern.sub(draw_repl, content)

# 6. fleet plotting
fleet_pattern = re.compile(r'weatherMarkers\.forEach.*?weatherMarkers\.push\(m\);\n            \}\);', re.DOTALL)
fleet_repl = """weatherMarkers.forEach(m => m.setMap(null)); weatherMarkers = [];
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
content = fleet_pattern.sub(fleet_repl, content)

with open(file_path, 'w') as f:
    f.write(content)
print("Finished python script")
