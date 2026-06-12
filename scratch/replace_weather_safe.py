import re
with open('frontend/pages/executive_weather.html', 'r') as f: content = f.read()

# 1. Scripts
content = re.sub(r'    <!-- Leaflet CSS -->\s*<link crossorigin="" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css".*?>\s*<link href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css".*?/>', '', content)
content = re.sub(r'<!-- Scripts -->\s*<script crossorigin="" integrity=".*?" src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>\s*<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js"></script>\s*<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>', '<!-- Scripts -->\n<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDVPnuQKHJxNnw3kstRBfIynZbafz2llpo&libraries=drawing,visualization,places,geometry"></script>', content)

# 2. Map init
content = re.sub(r"        map = L\.map\('map', \{.*?\n        \}\);.*?map\.addLayer\(drawnItems\);", """        map = new google.maps.Map(document.getElementById("map"), {
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
        });""", content, flags=re.DOTALL)

# 3. Tiles, Layers, SOI Mask (we'll remove Leaflet layers and SOI layers)
content = re.sub(r'        // Setup panels\s+makeDraggable', '        // Setup panels\n        makeDraggable', content)
content = re.sub(r'const baseMaps = \{.*?\}', '', content, flags=re.DOTALL)

# 4. Map Themes
content = re.sub(r'    function updateMapTheme\(mapInstance\) \{.*?\n    \}', """    function updateMapTheme(mapInstance) {
        if (!mapInstance) return;
        const theme = localStorage.getItem('theme') || 'dark';
        mapInstance.setOptions({ styles: theme === 'dark' ? darkMapStyle : lightMapStyle });
    }""", content, flags=re.DOTALL)

content = re.sub(r'    function changeMapLayer\(\) \{.*?\n    \}', """    function changeMapLayer() {
        if (!map) return;
        const layerType = document.getElementById('map-layer').value;
        if (layerType === 'terrain') map.setMapTypeId('terrain');
        else if (layerType === 'satellite') map.setMapTypeId('satellite');
        else map.setMapTypeId('roadmap');
    }""", content, flags=re.DOTALL)

# 5. SOI Mask
content = re.sub(r'    function applySOIMaskPatches\(mapInstance\) \{.*?\n    \}', """    function applySOIMaskPatches(mapInstance) {
        // Handled by google maps boundary styling naturally
    }""", content, flags=re.DOTALL)

# 6. Weather overlays
content = re.sub(r'    function toggleWeatherLayer\(layerName\) \{.*?mapInstance\.addLayer\(layer\);\n            \}\n        \}\n    \}', """    function toggleWeatherLayer(layerName) {
        // Handled by REST APIs in Google
    }""", content, flags=re.DOTALL)

# 7. Heatmap
content = re.sub(r'    function updateHeatmap\(fleetData\) \{.*?heatmap\.addTo\(map\);\n        \}\n    \}', """    function updateHeatmap(fleetData) {
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
    }""", content, flags=re.DOTALL)

# 8. Drawing handles
content = re.sub(r'    function setDrawMode\(active\) \{.*?\n    \}', """    function setDrawMode(active) {
        isDrawing = active;
        const btn = document.getElementById('draw-btn');
        if (active) { 
            btn.classList.add('drawing'); btn.innerHTML = '⏹️ Cancel Draw'; 
        } else { 
            btn.classList.remove('drawing'); btn.innerHTML = '✏️ Draw on Map';
            if (drawingManager) drawingManager.setDrawingMode(null);
        }
    }""", content, flags=re.DOTALL)

content = re.sub(r'    function toggleDrawMode\(\) \{.*?\n    \}', """    function toggleDrawMode() {
        if (!map || !drawingManager) return showToast('Map not ready.', 'error');
        if (isDrawing) return setDrawMode(false);
        const type = document.getElementById('disaster-type').value;
        const circleTypes = ['cyclone', 'flood', 'heatwave', 'earthquake', 'riot', 'hail', 'storm', 'snow', 'fog', 'rain'];
        
        drawingManager.setDrawingMode(circleTypes.includes(type) ? google.maps.drawing.OverlayType.CIRCLE : google.maps.drawing.OverlayType.POLYLINE);
        setDrawMode(true);
    }""", content, flags=re.DOTALL)

content = re.sub(r'    async function handleCustomDisaster\(shapeType, layer\) \{.*?\n    \}', """    async function handleCustomDisaster(shapeType, layer) {
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
    }""", content, flags=re.DOTALL)

content = re.sub(r'drawnItems\.clearLayers\(\);', 'drawnItems.forEach(i => i.setMap(null)); drawnItems = [];', content)

# 9. Markers parsing
content = re.sub(r'            weatherMarkers\.forEach\(m => map\.removeLayer\(m\)\); weatherMarkers = \[\];\n            warehouseMarkers\.forEach\(m => map\.removeLayer\(m\)\); warehouseMarkers = \[\];', """            weatherMarkers.forEach(m => m.setMap(null)); weatherMarkers = [];
            warehouseMarkers.forEach(m => m.setMap(null)); warehouseMarkers = [];""", content)

content = re.sub(r'                const popup = L\.popup\(\)\.setLatLng\(e\.latlng\)\.setContent.*?\.openOn\(map\);', """                const info = new google.maps.InfoWindow({ position: {lat: e.latLng.lat(), lng: e.latLng.lng()}, content: '<div style="font-family:Space Grotesk,sans-serif;font-size:0.85rem;padding:6px;color:black;">⏳ Fetching intel…</div>' }); info.open(map);""", content, flags=re.DOTALL)

content = re.sub(r'                    const icon = L\.divIcon\(\{ html.*?\.bindPopup\(.*?`\);', """                    const m = new google.maps.Marker({
                        position: {lat: wh.lat, lng: wh.lng},
                        map: map,
                        title: wh.name,
                        icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="rgba(0, 255, 115, 0.15)" stroke="#00ff73" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(28,28) }
                    });
                    const info = new google.maps.InfoWindow({ content: `<div style="min-width:180px; font-family:Space Grotesk,sans-serif; line-height:1.6; color:#0f172a;"><b style="color:#10b981; font-size:1.1rem;">🏭 ${wh.name}</b><br><small style="color:#64748b;">📍 ${wh.address||'N/A'}</small></div>` });
                    m.addListener('click', () => info.open(map, m));""", content, flags=re.DOTALL)

content = re.sub(r'                    weatherMarkers\.push\(L\.polyline\(cell\.coordinates, \{.*?\n', """                    const poly = new google.maps.Polyline({
                        path: cell.coordinates,
                        geodesic: true, strokeColor: cell.color || '#ff9900', strokeOpacity: 0.85, strokeWeight: 6, map: map
                    });
                    weatherMarkers.push(poly);\n""", content, flags=re.DOTALL)

content = re.sub(r'                    weatherMarkers\.push\(L\.circle\(\[cell\.lat, cell\.lng\].*?\n', """                    const bc = cell.is_simulation ? '#ff9900' : (cell.color || '#00e5ff');
                    const circ = new google.maps.Circle({
                        strokeColor: bc, strokeOpacity: cell.is_simulation?0.8:0.4, strokeWeight: cell.is_simulation?2:1.5, fillColor: bc, fillOpacity: cell.is_simulation?0.18:0.12, map: map, center: {lat: cell.lat, lng: cell.lng}, radius: (cell.radius||80)*1000
                    });
                    weatherMarkers.push(circ);\n""", content, flags=re.DOTALL)

content = re.sub(r'                    weatherMarkers\.push\(L\.marker\(\[cell\.lat, cell\.lng\].*?\n', '', content, flags=re.DOTALL)

content = re.sub(r'                const icon = L\.divIcon\(\{ html:.*?\.bindPopup\(.*?`\)\);', """                const m = new google.maps.Marker({
                    position: {lat: v.lat, lng: v.lng},
                    map: map,
                    icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><g transform="rotate(${v.bearing||0} 15 15)"><text x="15" y="20" font-size="20" text-anchor="middle">🚛</text></g></svg>`), scaledSize: new google.maps.Size(30,30) }
                });
                const info = new google.maps.InfoWindow({ content: `<div style="color:black;min-width:150px; font-family:Space Grotesk,sans-serif;"><b style="color:#6366f1;">🚛 ${v.driver}</b><br><small>${v.weather?.icon||'☀️'} ${v.weather?.condition||'Clear'}</small></div>` });
                m.addListener('click', () => info.open(map, m));
                weatherMarkers.push(m);""", content, flags=re.DOTALL)

with open('frontend/pages/executive_weather.html', 'w') as f: f.write(content)
print("Finished!")
