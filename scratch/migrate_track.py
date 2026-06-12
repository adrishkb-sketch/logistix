import re

# 1. Migrate track.js
try:
    with open('frontend/js/track.js', 'r') as f:
        track = f.read()
    
    # Init map
    track = re.sub(
        r'trackMap\s*=\s*L\.map\([^\)]+\)\.setView\(\[(.*?),\s*(.*?)\][^\)]+\);.*?L\.tileLayer\([^\)]+\)\.addTo\(trackMap\);',
        r'''
        const theme = localStorage.getItem('theme') || 'dark';
        trackMap = new google.maps.Map(document.getElementById('track-map'), {
            center: { lat: \1, lng: \2 }, zoom: 13,
            styles: theme === 'dark' ? [
                { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
            ] : []
        });
        ''', track, flags=re.DOTALL
    )
    
    # Origin Marker
    track = re.sub(
        r'const originMarker\s*=\s*L\.marker\(\[(.*?),\s*(.*?)\],\s*\{icon:\s*localIconPickup\}\)\.addTo\(trackMap\)\.bindPopup\((.*?)\);',
        r'''
        const originMarker = new google.maps.Marker({position: {lat: \1, lng: \2}, map: trackMap, icon: {url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#10b981" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(24,24)}});
        const oInfo = new google.maps.InfoWindow({content: \3});
        originMarker.addListener('click', () => oInfo.open(trackMap, originMarker));
        ''', track
    )

    # Destination Marker
    track = re.sub(
        r'const destinationMarker\s*=\s*L\.marker\(\[(.*?),\s*(.*?)\],\s*\{icon:\s*localIconDrop\}\)\.addTo\(trackMap\)\.bindPopup\((.*?)\);',
        r'''
        const destinationMarker = new google.maps.Marker({position: {lat: \1, lng: \2}, map: trackMap, icon: {url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#ef4444" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(24,24)}});
        const dInfo = new google.maps.InfoWindow({content: \3});
        destinationMarker.addListener('click', () => dInfo.open(trackMap, destinationMarker));
        ''', track
    )

    # Hub Marker
    track = re.sub(
        r'const hubMarker\s*=\s*L\.marker\(\[(.*?),\s*(.*?)\],\s*\{icon:\s*localIconWarehouse\}\)\.addTo\(trackMap\)\.bindPopup\((.*?)\);',
        r'''
        const hubMarker = new google.maps.Marker({position: {lat: \1, lng: \2}, map: trackMap, icon: {url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#f59e0b" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(24,24)}});
        const hInfo = new google.maps.InfoWindow({content: \3});
        hubMarker.addListener('click', () => hInfo.open(trackMap, hubMarker));
        ''', track
    )

    # Current Location CircleMarker
    track = re.sub(
        r'const mC\s*=\s*L\.circleMarker\(\[(.*?),\s*(.*?)\],\s*\{color:.*?\b\}\)\.addTo\(trackMap\)\.bindPopup\("Current Unit Location"\);',
        r'''
        const mC = new google.maps.Marker({
            position: {lat: \1, lng: \2}, map: trackMap, title: "Current Unit Location",
            icon: {url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#3b82f6" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(20,20)}
        });
        const cInfo = new google.maps.InfoWindow({content: "Current Unit Location"});
        mC.addListener('click', () => cInfo.open(trackMap, mC));
        ''', track, flags=re.DOTALL
    )

    # Track Map SetView
    track = re.sub(r'trackMap\.setView\(\[(.*?),\s*(.*?)\][^\)]+\);', r'trackMap.setCenter({lat: \1, lng: \2});', track)

    # Drone Polyline
    track = re.sub(
        r'const dronePath\s*=\s*L\.polyline\(\[\[(.*?),\s*(.*?)\],\s*\[(.*?),\s*(.*?)\]\],\s*\{color:\s*\'#f6ad55\'[^\)]+\}\)\.addTo\(trackMap\);',
        r'const dronePath = new google.maps.Polyline({path: [{lat: \1, lng: \2}, {lat: \3, lng: \4}], strokeColor: "#f6ad55", strokeWeight: 3, map: trackMap});', track
    )

    # OSRM Polyline
    track = re.sub(
        r'const pline\s*=\s*L\.polyline\(coords,\s*\{color,\s*weight:\s*6,\s*opacity:\s*0\.85\}\)\.addTo\(trackMap\);',
        r'const pline = new google.maps.Polyline({path: coords.map(c => ({lat: c[0], lng: c[1]})), strokeColor: color, strokeWeight: 6, strokeOpacity: 0.85, map: trackMap});', track
    )

    with open('frontend/js/track.js', 'w') as f:
        f.write(track)
except: pass

# 2. Migrate hub_manager_drones.js
try:
    with open('frontend/js/hub_manager_drones.js', 'r') as f:
        drones = f.read()

    # Init Map
    drones = re.sub(
        r'map\s*=\s*L\.map\(\'drone-tracking-map\',\s*\{.*?\}\);.*?L\.tileLayer\([^\)]+\)\.addTo\(map\);',
        r'''
        const theme = localStorage.getItem('theme') || 'dark';
        map = new google.maps.Map(document.getElementById('drone-tracking-map'), {
            center: { lat: 20.5937, lng: 78.9629 }, zoom: 5,
            styles: theme === 'dark' ? [
                { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
            ] : []
        });
        ''', drones, flags=re.DOTALL
    )

    # Drone Icon Maker
    drones = re.sub(
        r'const icon\s*=\s*L\.divIcon\(\{.*?html:\s*`(.*?)`.*?\}\);',
        r'''
        const icon = {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="14" fill="#1e293b" stroke="' + (statusColor === 'var(--success)' ? '#10b981' : (statusColor === 'var(--warning)' ? '#f59e0b' : '#3b82f6')) + '" stroke-width="2"/><text x="15" y="20" font-size="16" text-anchor="middle" fill="white">🚁</text></svg>'),
            scaledSize: new google.maps.Size(30, 30), anchor: new google.maps.Point(15, 15)
        };
        ''', drones, flags=re.DOTALL
    )

    # Drone Marker
    drones = re.sub(
        r'const marker\s*=\s*L\.marker\(\[d\.location\.lat,\s*d\.location\.lng\],\s*\{icon\}\)\.addTo\(map\);.*?marker\.bindPopup\(`(.*?)`\);',
        r'''
        const marker = new google.maps.Marker({
            position: {lat: d.location.lat, lng: d.location.lng}, map: map, icon: icon
        });
        const info = new google.maps.InfoWindow({content: `\1`});
        marker.addListener('click', () => info.open(map, marker));
        ''', drones, flags=re.DOTALL
    )

    # Marker Removal
    drones = re.sub(r'droneMarkers\.forEach\(m\s*=>\s*map\.removeLayer\(m\)\);', r'droneMarkers.forEach(m => m.setMap(null));', drones)

    with open('frontend/js/hub_manager_drones.js', 'w') as f:
        f.write(drones)
except: pass

print("Finished track and drones")
