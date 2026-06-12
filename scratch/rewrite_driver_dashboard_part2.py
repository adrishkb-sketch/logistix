import os

file_path = '/Users/adrish/Desktop/Projects/logistix/frontend/js/driver_dashboard.js'
with open(file_path, 'r') as f:
    content = f.read()

# 1. applyOfficialBorders
content = content.replace("""    fetch('../data/india-composite-simplified.geojson').then(r => r.ok ? r.json() : Promise.reject('no local')).then(data => {
        L.geoJSON(data, {
            style: borderStyle
        }).addTo(mapInstance);
        mapInstance.fitBounds(L.geoJSON(data).getBounds(), { padding: [15, 15] });
    }).catch(() => {
        const fallbackBorder = { color: '#00e5ff', weight: 2.5, fillOpacity: 0, opacity: 0.95, lineJoin: 'round', lineCap: 'round', pane: 'soiBorderPane' };
        const northernClaimLine = [[33.70, 73.50], [34.00, 71.90], [34.55, 72.35], [34.70, 73.00], [35.00, 74.00], [35.20, 75.00], [35.50, 76.10], [35.80, 76.40], [36.15, 77.00], [36.85, 76.60], [37.10, 75.80], [37.06, 74.57], [36.60, 74.55], [36.20, 78.00], [36.00, 79.00], [35.60, 79.80], [35.10, 80.00], [34.80, 79.50], [34.20, 78.50], [34.00, 77.80]];
        window._soiPatchLayers.push(L.polyline(northernClaimLine, fallbackBorder).addTo(mapInstance));
    });""", """    // Google Maps data layer
    mapInstance.data.loadGeoJson('../data/india-composite-simplified.geojson');
    mapInstance.data.setStyle({
        fillColor: 'transparent',
        strokeWeight: 2.5,
        strokeColor: '#00e5ff'
    });""")

# 2. Controls
content = content.replace("legendControl = L.control({position: 'bottomleft'});", "// legendControl setup skipped for Google Maps custom controls")
content = content.replace("legendControl.onAdd = function() {", "function buildLegendControl() {")
content = content.replace("const div = L.DomUtil.create('div', 'info legend');", "const div = document.createElement('div'); div.className = 'info legend';")
content = content.replace("return div;\n    };", "return div;\n    }")
content = content.replace("legendControl.addTo(map);", "if(map) { const lg = buildLegendControl(); map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(lg); }")

content = content.replace("hudControl = L.control({position: 'topright'});", "// hudControl setup")
content = content.replace("hudControl.onAdd = function() {", "function buildHudControl() {")
content = content.replace("const div = L.DomUtil.create('div', 'hud-control');", "const div = document.createElement('div'); div.className = 'hud-control';")
content = content.replace("return div;\n    };", "return div;\n    }")
content = content.replace("hudControl.addTo(map);", "if(map) { const hc = buildHudControl(); map.controls[google.maps.ControlPosition.TOP_RIGHT].push(hc); }")

content = content.replace("rerouteControlBtn = L.control({position: 'topleft'});", "// rerouteControlBtn setup")
content = content.replace("rerouteControlBtn.onAdd = function() {", "function buildRerouteControl() {")
content = content.replace("const btn = L.DomUtil.create('button', 'btn-primary ai-reroute-btn');", "const btn = document.createElement('button'); btn.className = 'btn-primary ai-reroute-btn';")
content = content.replace("return btn;\n    };", "return btn;\n    }")
content = content.replace("rerouteControlBtn.addTo(map);", "if(map) { const rc = buildRerouteControl(); map.controls[google.maps.ControlPosition.TOP_LEFT].push(rc); }")

# 3. changeMapLayer
content = content.replace("""function changeMapLayer() {
    if (!map) return;
    const layerType = document.getElementById('map-layer').value;
    
    // Remove current base layers
    map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) {
            map.removeLayer(layer);
        }
    });

    const theme = localStorage.getItem('theme') || 'dark';
    let tileUrl = theme === 'dark' 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
        
    if (layerType === 'terrain') {
        tileUrl = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
    } else if (layerType === 'satellite') {
        tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    }

    L.tileLayer(tileUrl, { attribution: '&copy; CARTO' }).addTo(map);
}""", """function changeMapLayer() {
    if (!map) return;
    const layerType = document.getElementById('map-layer').value;
    if (layerType === 'terrain') map.setMapTypeId('terrain');
    else if (layerType === 'satellite') map.setMapTypeId('satellite');
    else map.setMapTypeId('roadmap');
}""")

# 4. POI layer groups
poi_old = """const poiLayers = {
    fuel: L.layerGroup(),
    food: L.layerGroup(),
    mechanic: L.layerGroup(),
    rest: L.layerGroup()
};"""
poi_new = """const poiLayers = {
    fuel: [], food: [], mechanic: [], rest: []
};"""
content = content.replace(poi_old, poi_new)

content = content.replace("poiLayers[type].clearLayers();", "poiLayers[type].forEach(m => m.setMap(null)); poiLayers[type] = [];")
content = content.replace("poiLayers[type].addTo(map);", "poiLayers[type].forEach(m => m.setMap(map));")

content = content.replace("const m = L.marker([poi.lat, poi.lng], {icon: customIcon});", "const m = new google.maps.Marker({ position: {lat: poi.lat, lng: poi.lng}, icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(customIcon.options.html), scaledSize: new google.maps.Size(32,32) }});")
content = content.replace("m.bindPopup(", "const info = new google.maps.InfoWindow({content: ")
content = content.replace("`<b>${poi.name}</b><br>${getTranslation('rating_label')}: ${poi.rating}⭐`", "`<div style='color:black;'><b>${poi.name}</b><br>${getTranslation('rating_label')}: ${poi.rating}⭐</div>`")
content = content.replace(");", "}); m.addListener('click', () => info.open(map, m));")
content = content.replace("poiLayers[type].addLayer(m);", "poiLayers[type].push(m);")
content = content.replace("if (map.hasLayer(poiLayers[type])) {", "if (document.getElementById(`toggle-${type}`)?.classList.contains('active')) {")
content = content.replace("map.removeLayer(poiLayers[type]);", "poiLayers[type].forEach(m => m.setMap(null));")

# 5. Geofence & Progress
content = content.replace("if (completedPolyline) map.removeLayer(completedPolyline);", "if (completedPolyline) completedPolyline.setMap(null);")
content = content.replace("if (remainingPolyline) map.removeLayer(remainingPolyline);", "if (remainingPolyline) remainingPolyline.setMap(null);")
content = content.replace("if (geofenceCircle) map.removeLayer(geofenceCircle);", "if (geofenceCircle) geofenceCircle.setMap(null);")

content = content.replace("""        completedPolyline = L.polyline(completedCoords, {
            color: '#00e5ff',
            weight: 6,
            opacity: 0.9
        }).addTo(map);""", "completedPolyline = new google.maps.Polyline({path: completedCoords.map(c=>({lat:c[0],lng:c[1]})), strokeColor: '#00e5ff', strokeWeight: 6, strokeOpacity: 0.9, map: map});")

content = content.replace("""        remainingPolyline = L.polyline(remainingCoords, {
            color: '#888888',
            weight: 6,
            opacity: 0.5,
            dashArray: '10, 10'
        }).addTo(map);""", "remainingPolyline = new google.maps.Polyline({path: remainingCoords.map(c=>({lat:c[0],lng:c[1]})), strokeColor: '#888888', strokeWeight: 6, strokeOpacity: 0.5, map: map});")

content = content.replace("""        geofenceCircle = L.circle([nextStop.lat, nextStop.lng], {
            color: isInsideGeofence ? '#00e5ff' : '#f6ad55',
            fillColor: isInsideGeofence ? '#00e5ff' : '#f6ad55',
            fillOpacity: 0.2,
            radius: 100 // 100 meters
        }).addTo(map);""", "geofenceCircle = new google.maps.Circle({center: {lat: nextStop.lat, lng: nextStop.lng}, radius: 100, strokeColor: isInsideGeofence ? '#00e5ff' : '#f6ad55', fillOpacity: 0.2, map: map});")

# 6. Traffic Heatmap
content = content.replace("if (trafficHeatmapLayer) map.removeLayer(trafficHeatmapLayer);", "if (trafficHeatmapLayer) trafficHeatmapLayer.setMap(null);")
content = content.replace("trafficHeatmapLayer = L.heatLayer(heatPoints, {", "trafficHeatmapLayer = new google.maps.visualization.HeatmapLayer({ data: heatPoints.map(p=>({location: new google.maps.LatLng(p[0],p[1]), weight: p[2]})),")
content = content.replace("radius: 20,", "radius: 20,")
content = content.replace("blur: 15,", "")
content = content.replace("maxZoom: 15", "")
content = content.replace("gradient: { 0.4: 'green', 0.6: 'yellow', 0.8: 'orange', 1.0: 'red' }", "gradient: ['rgba(0,0,255,0)', 'green', 'yellow', 'orange', 'red']")
content = content.replace("}).addTo(map);", "}); trafficHeatmapLayer.setMap(map);")

# 7. PolyRerouted
content = content.replace("if (window.currentReroutePolyline) map.removeLayer(window.currentReroutePolyline);", "if (window.currentReroutePolyline) window.currentReroutePolyline.setMap(null);")
content = content.replace("const polyRerouted = L.polyline(reroutedCoords, {color: '#a855f7', weight: 8, opacity: 0.9}).addTo(map);", "const polyRerouted = new google.maps.Polyline({path: reroutedCoords.map(c=>({lat:c[0],lng:c[1]})), strokeColor: '#a855f7', strokeWeight: 8, strokeOpacity: 0.9, map: map});")

with open(file_path, 'w') as f:
    f.write(content)
print("Successfully rewrote remaining Leaflet logic in driver_dashboard.js!")
