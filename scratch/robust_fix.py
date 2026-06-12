import re

# Fix executive_warehouses.js
with open('frontend/js/executive_warehouses.js', 'r') as f:
    wh_content = f.read()

# 1. Map init
wh_content = re.sub(
    r'map\s*=\s*L\.map\([^\)]+\)\.setView\([^\)]+\);.*?L\.tileLayer\([^\)]+\)\.addTo\(map\);',
    r'''
    const theme = localStorage.getItem('theme') || 'dark';
    const darkMapStyle = [
        { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
    ];
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 20.5937, lng: 78.9629 },
        zoom: 5,
        styles: theme === 'dark' ? darkMapStyle : [],
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false
    });
    ''',
    wh_content, flags=re.DOTALL
)

# 2. Temp Marker
wh_content = re.sub(
    r'window\.tempMarker\s*=\s*L\.marker\([^\)]+\)\.addTo\(map\)',
    r'window.tempMarker = new google.maps.Marker({position: {lat, lng}, map, draggable: true})',
    wh_content
)

# 3. GeoJSON
wh_content = re.sub(
    r'L\.geoJSON\(data,\s*\{.*?\}\)\.addTo\(map\);',
    r'''
    map.data.addGeoJson(data);
    map.data.setStyle({ fillColor: "transparent", strokeWeight: 2.5, strokeColor: "#00e5ff" });
    ''',
    wh_content, flags=re.DOTALL
)

# 4. Markers creation (L.marker)
wh_content = re.sub(
    r'const m\s*=\s*L\.marker\(\[w\.lat,\s*w\.lng\],\s*\{icon:\s*icon,\s*title:\s*w\.name\}\)\.addTo\(map\)',
    r'''
    const m = new google.maps.Marker({
        position: {lat: w.lat, lng: w.lng}, map: map, title: w.name,
        icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="rgba(0,255,115,0.15)" stroke="#00ff73" stroke-width="2"/></svg>'),
            scaledSize: new google.maps.Size(28,28)
        }
    })
    ''',
    wh_content
)

# 5. L.circle for highlight
wh_content = re.sub(
    r'highlightCircle\s*=\s*L\.circle\(.*?\)\.addTo\(map\);',
    r'highlightCircle = new google.maps.Circle({ map, center: {lat: w.lat, lng: w.lng}, radius: 250000, fillColor: "transparent", strokeColor: "#00e5ff", strokeWeight: 2 });',
    wh_content, flags=re.DOTALL
)

# 6. L.polyline in cluster rendering
wh_content = re.sub(
    r'const pline\s*=\s*L\.polyline\(chunk,\s*\{color.*?\}\)\.addTo\(map\);',
    r'const pline = new google.maps.Polyline({path: chunk.map(c => ({lat: c[0], lng: c[1]})), strokeColor: color, strokeWeight: 5, strokeOpacity: 0.7, map});',
    wh_content
)

with open('frontend/js/executive_warehouses.js', 'w') as f:
    f.write(wh_content)


# Fix executive_shipments.js
with open('frontend/js/executive_shipments.js', 'r') as f:
    ship_content = f.read()

# 1. ICON_PICKER definition
ship_content = re.sub(
    r'const ICON_PICKER\s*=\s*L\.divIcon\(\{.*?\}\);',
    r'''const ICON_PICKER = { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#3b82f6" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) };''',
    ship_content, flags=re.DOTALL
)

# 2. Picking Map setup
ship_content = re.sub(
    r'pickingMap\s*=\s*L\.map\([^;]+;.*?L\.tileLayer\([^;]+;',
    r'''
    pickingMap = new google.maps.Map(document.getElementById('picking-map'), {
        center: { lat: 20.5937, lng: 78.9629 }, zoom: 5,
        styles: [{ elementType: "geometry", stylers: [{ color: "#242f3e" }] }, { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] }, { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] }, { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }],
        disableDefaultUI: true
    });
    ''',
    ship_content, flags=re.DOTALL
)

ship_content = re.sub(
    r'pickingMarker\s*=\s*L\.marker\(ll,\s*\{ icon:\s*ICON_PICKER \}\)\.addTo\(pickingMap\);',
    r'pickingMarker = new google.maps.Marker({position: ll, map: pickingMap, icon: ICON_PICKER});',
    ship_content
)

ship_content = re.sub(
    r'const ll\s*=\s*L\.latLng\(lat,\s*lng\);',
    r'const ll = {lat, lng};',
    ship_content
)

ship_content = re.sub(
    r'pickingMap\.setView\(ll,\s*12\);',
    r'pickingMap.setCenter(ll); pickingMap.setZoom(12);',
    ship_content
)

ship_content = re.sub(
    r'pickingMap\.on\(\'click\', function\(e\)\s*\{\s*const \{ lat, lng \} = e\.latlng;',
    r'google.maps.event.addListener(pickingMap, "click", function(e) { const lat = e.latLng.lat(); const lng = e.latLng.lng();',
    ship_content
)

ship_content = re.sub(
    r'pickingMarker\.setLatLng\(e\.latlng\);',
    r'pickingMarker.setPosition(e.latLng);',
    ship_content
)

ship_content = re.sub(
    r'pickingMarker\s*=\s*L\.marker\(e\.latlng,\s*\{ icon: ICON_PICKER \}\)\.addTo\(pickingMap\);',
    r'pickingMarker = new google.maps.Marker({position: e.latLng, map: pickingMap, icon: ICON_PICKER});',
    ship_content
)

ship_content = re.sub(
    r'pickingMap\.invalidateSize\(\);',
    r'google.maps.event.trigger(pickingMap, "resize");',
    ship_content
)

# 3. Track Map setup
ship_content = re.sub(
    r'trackMap\s*=\s*L\.map\(\'track-map\'\)\.setView\(\[20\.5937,\s*78\.9629\],\s*5\);\s*L\.tileLayer\([^\)]+\)\.addTo\(trackMap\);',
    r'''
    trackMap = new google.maps.Map(document.getElementById('track-map'), {
        center: { lat: 20.5937, lng: 78.9629 }, zoom: 5,
        styles: localStorage.getItem('theme') === 'dark' ? [
            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
        ] : []
    });
    ''',
    ship_content, flags=re.DOTALL
)

ship_content = re.sub(
    r'trackMap\.eachLayer\(l =>\s*\{\s*if\(l\s*instanceof\s*L\.TileLayer\)\s*l\.setUrl\([^\)]+\);\s*\}\);',
    r'/* theme managed by initialization */',
    ship_content
)

ship_content = re.sub(
    r'if\s*\(trackMarkers\)\s*trackMarkers\.forEach\(m\s*=>\s*trackMap\.removeLayer\(m\)\);',
    r'if (trackMarkers) trackMarkers.forEach(m => m.setMap(null));',
    ship_content
)

# Icons
ship_content = re.sub(
    r'const localIconPickup.*?L\.divIcon\(\{className:\s*\'custom-marker\'\}\);',
    r'const localIconPickup = { url: \'data:image/svg+xml;charset=UTF-8,\' + encodeURIComponent(\'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#10b981" stroke="white" stroke-width="2"/></svg>\'), scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) };',
    ship_content
)
ship_content = re.sub(
    r'const localIconDrop.*?L\.divIcon\(\{className:\s*\'custom-marker\'\}\);',
    r'const localIconDrop = { url: \'data:image/svg+xml;charset=UTF-8,\' + encodeURIComponent(\'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#ef4444" stroke="white" stroke-width="2"/></svg>\'), scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) };',
    ship_content
)
ship_content = re.sub(
    r'const localIconWarehouse.*?L\.divIcon\(\{className:\s*\'custom-marker\'\}\);',
    r'const localIconWarehouse = { url: \'data:image/svg+xml;charset=UTF-8,\' + encodeURIComponent(\'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#f59e0b" stroke="white" stroke-width="2"/></svg>\'), scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) };',
    ship_content
)


# Markers
ship_content = re.sub(
    r'const originMarker\s*=\s*L\.marker\(\[(.*?),\s*(.*?)\],\s*\{icon:\s*localIconPickup\}\)\s*\.addTo\(trackMap\)\.bindPopup\((.*?)\);',
    r'''
    const originMarker = new google.maps.Marker({position: {lat: \1, lng: \2}, map: trackMap, icon: localIconPickup});
    const oInfo = new google.maps.InfoWindow({content: \3});
    originMarker.addListener('click', () => oInfo.open(trackMap, originMarker));
    ''',
    ship_content
)

ship_content = re.sub(
    r'const destinationMarker\s*=\s*L\.marker\(\[(.*?),\s*(.*?)\],\s*\{icon:\s*localIconDrop\}\)\s*\.addTo\(trackMap\)\.bindPopup\((.*?)\);',
    r'''
    const destinationMarker = new google.maps.Marker({position: {lat: \1, lng: \2}, map: trackMap, icon: localIconDrop});
    const dInfo = new google.maps.InfoWindow({content: \3});
    destinationMarker.addListener('click', () => dInfo.open(trackMap, destinationMarker));
    ''',
    ship_content
)

ship_content = re.sub(
    r'const hubMarker\s*=\s*L\.marker\(\[(.*?),\s*(.*?)\],\s*\{icon:\s*localIconWarehouse\}\)\s*\.addTo\(trackMap\)\.bindPopup\((.*?)\);',
    r'''
    const hubMarker = new google.maps.Marker({position: {lat: \1, lng: \2}, map: trackMap, icon: localIconWarehouse});
    const hInfo = new google.maps.InfoWindow({content: \3});
    hubMarker.addListener('click', () => hInfo.open(trackMap, hubMarker));
    ''',
    ship_content
)

ship_content = re.sub(
    r'const mC\s*=\s*L\.circleMarker\(\[(.*?),\s*(.*?)\],\s*\{.*?\b\}\)\.addTo\(trackMap\)\.bindPopup\((.*?)\);',
    r'''
    const mC = new google.maps.Marker({
        position: {lat: \1, lng: \2}, map: trackMap,
        icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#3b82f6" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(20, 20), anchor: new google.maps.Point(10, 10) }
    });
    const cInfo = new google.maps.InfoWindow({content: \3});
    mC.addListener('click', () => cInfo.open(trackMap, mC));
    ''',
    ship_content, flags=re.DOTALL
)

# Route polylines
ship_content = re.sub(
    r'const dronePath\s*=\s*L\.polyline\(\[\[(.*?),\s*(.*?)\],\s*\[(.*?),\s*(.*?)\]\],\s*\{.*?\}\)\.addTo\(trackMap\);',
    r'const dronePath = new google.maps.Polyline({path: [{lat: \1, lng: \2}, {lat: \3, lng: \4}], strokeColor: "#f6ad55", strokeWeight: 3, map: trackMap});',
    ship_content
)

ship_content = re.sub(
    r'const pline\s*=\s*L\.polyline\(coords,\s*\{color,\s*weight:\s*6,\s*opacity:\s*0\.85\}\)\.addTo\(trackMap\);',
    r'const pline = new google.maps.Polyline({path: coords.map(c => ({lat: c[0], lng: c[1]})), strokeColor: color, strokeWeight: 6, strokeOpacity: 0.85, map: trackMap});',
    ship_content
)

ship_content = re.sub(
    r'trackMap\.invalidateSize\(\);',
    r'google.maps.event.trigger(trackMap, "resize");',
    ship_content
)


with open('frontend/js/executive_shipments.js', 'w') as f:
    f.write(ship_content)

print("Finished fixing warehouses and shipments")
