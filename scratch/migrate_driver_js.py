import re

with open('frontend/js/driver_dashboard.js', 'r') as f:
    content = f.read()

# 1. Map Init
content = re.sub(
    r'map\s*=\s*L\.map\([^\)]+\)\.setView\(\[(.*?),\s*(.*?)\][^\)]+\);.*?L\.tileLayer\([^\)]+\)\.addTo\(map\);',
    r'''
    const theme = localStorage.getItem('theme') || 'dark';
    map = new google.maps.Map(document.getElementById('route-map'), {
        center: { lat: \1, lng: \2 },
        zoom: 13,
        styles: theme === 'dark' ? [
            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
        ] : [],
        disableDefaultUI: true
    });
    ''',
    content, flags=re.DOTALL
)

# 2. Origin Marker
content = re.sub(
    r'L\.marker\(\[orderedStops\[0\]\.lat,\s*orderedStops\[0\]\.lng\],\s*\{icon:\s*L\.divIcon\(\{.*?\}\)\}\)\.addTo\(map\)\.bindPopup\("Route Start"\);',
    r'''
    new google.maps.Marker({
        position: { lat: orderedStops[0].lat, lng: orderedStops[0].lng },
        map: map, title: "Route Start",
        icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="#3b82f6" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(28, 28) }
    });
    ''',
    content, flags=re.DOTALL
)

# 3. Intermediate Stops Loop
content = re.sub(
    r'L\.marker\(\[stop\.lat,\s*stop\.lng\],\s*\{icon:\s*L\.divIcon\(\{.*?\}\)\}\)\.addTo\(map\)\.bindPopup\(.*?stop\.action.*?\);',
    r'''
    const sm = new google.maps.Marker({
        position: { lat: stop.lat, lng: stop.lng },
        map: map, title: `Stop ${index}: ${stop.action.toUpperCase()}`,
        icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#f59e0b" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(24, 24) }
    });
    const sInfo = new google.maps.InfoWindow({content: `Stop ${index}: ${stop.action.toUpperCase()}`});
    sm.addListener('click', () => sInfo.open(map, sm));
    ''',
    content, flags=re.DOTALL
)

# 4. Final Stop
content = re.sub(
    r'const finalIdx\s*=\s*orderedStops\.length\s*-\s*1;\s*L\.marker\(\[orderedStops\[finalIdx\]\.lat,\s*orderedStops\[finalIdx\]\.lng\],\s*\{icon:\s*L\.divIcon\(\{.*?\}\)\}\)\.addTo\(map\)\.bindPopup\("Route End"\);',
    r'''
    const finalIdx = orderedStops.length - 1;
    new google.maps.Marker({
        position: { lat: orderedStops[finalIdx].lat, lng: orderedStops[finalIdx].lng },
        map: map, title: "Route End",
        icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="#10b981" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(28, 28) }
    });
    ''',
    content, flags=re.DOTALL
)

# 5. OSRM Polyline
content = re.sub(
    r'const pline\s*=\s*L\.polyline\(coords,\s*\{color:\s*\'#3b82f6\',\s*weight:\s*5,\s*opacity:\s*0\.8\}\)\.addTo\(map\);',
    r'''
    const pline = new google.maps.Polyline({
        path: coords.map(c => ({lat: c[0], lng: c[1]})),
        strokeColor: '#3b82f6', strokeWeight: 5, strokeOpacity: 0.8, map: map
    });
    ''',
    content
)
content = re.sub(
    r'map\.fitBounds\(pline\.getBounds\(\)\);',
    r'''
    const bounds = new google.maps.LatLngBounds();
    coords.forEach(c => bounds.extend({lat: c[0], lng: c[1]}));
    map.fitBounds(bounds);
    ''',
    content
)

# 6. invalidateSize
content = re.sub(r'map\.invalidateSize\(\);', r'google.maps.event.trigger(map, "resize");', content)


with open('frontend/js/driver_dashboard.js', 'w') as f:
    f.write(content)
print("Finished rewriting driver_dashboard.js")
