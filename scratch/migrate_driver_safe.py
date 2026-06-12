import re
with open('frontend/pages/driver_live.html', 'r') as f: content = f.read()

# Replace Leaflet scripts with Google Maps
content = re.sub(r'    <!-- Leaflet CSS -->\s*<link crossorigin="" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css".*?>', '', content)
content = re.sub(r'<!-- Scripts -->\s*<script crossorigin="" integrity=".*?" src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>\s*<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js"></script>', '<!-- Scripts -->\n<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDVPnuQKHJxNnw3kstRBfIynZbafz2llpo&libraries=places,geometry,visualization"></script>', content)

with open('frontend/pages/driver_live.html', 'w') as f: f.write(content)

with open('frontend/js/driver_dashboard.js', 'r') as f: content = f.read()

# 1. Map Init
init_old = """                map = L.map('route-map').setView([orderedStops[0].lat, orderedStops[0].lng], 13);
                const theme = localStorage.getItem('theme') || 'dark';
                let tileUrl = theme === 'dark' ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
                L.tileLayer(tileUrl, { maxZoom: 19, attribution: '© CARTO' }).addTo(map);
                
                // Add Map Controls
                fetch('../data/india-composite-simplified.geojson').then(r => r.ok ? r.json() : Promise.reject('no local')).then(data => {
                    const borderStyle = { color: '#00e5ff', weight: 2.5, fillOpacity: 0, opacity: 0.95, lineJoin: 'round', lineCap: 'round', pane: 'soiBorderPane' };
                    L.geoJSON(data, { style: borderStyle }).addTo(map);
                }).catch(() => {});"""
init_new = """                const theme = localStorage.getItem('theme') || 'dark';
                map = new google.maps.Map(document.getElementById('route-map'), {
                    center: {lat: orderedStops[0].lat, lng: orderedStops[0].lng},
                    zoom: 13,
                    styles: theme === 'dark' ? darkMapStyle : [],
                    disableDefaultUI: true
                });
                
                // Add Map Controls safely if implemented for GMaps or skip
                // applyOfficialBorders is typically L.geoJSON, we skip or use map.data"""
content = content.replace(init_old, init_new)

# 2. updateLocation Leaflet -> Google Maps Marker
loc_old = """                marker = L.marker([lat, lng], {icon: getVehicleIcon(0), draggable: isSimulationMode}).addTo(map);
                if (isSimulationMode) {
                    marker.on('dragend', function(e) {
                        const newPos = e.target.getLatLng();
                        currentLocation = {lat: newPos.lat, lng: newPos.lng};
                        checkGeofencesAndNavigation(currentLocation);
                    });
                }"""
loc_new = """                marker = new google.maps.Marker({
                    position: {lat, lng},
                    map: map,
                    icon: getVehicleIcon(0),
                    draggable: isSimulationMode
                });
                if (isSimulationMode) {
                    marker.addListener('dragend', function(e) {
                        currentLocation = {lat: e.latLng.lat(), lng: e.latLng.lng()};
                        checkGeofencesAndNavigation(currentLocation);
                    });
                }"""
content = content.replace(loc_old, loc_new)

loc_old2 = """                marker.setLatLng([lat, lng]);
                marker.setIcon(getVehicleIcon(bearing));"""
loc_new2 = """                marker.setPosition({lat, lng});
                marker.setIcon(getVehicleIcon(bearing));"""
content = content.replace(loc_old2, loc_new2)

# 3. getVehicleIcon
icon_old = """function getVehicleIcon(bearing) {
    const isCrit = window.currentWeather && window.currentWeather.multiplier >= 1.5;
    const color = isCrit ? '#ef4444' : '#00e5ff';
    return L.divIcon({
        className: 'vehicle-marker',
        html: `<div style="transform: rotate(${bearing}deg); font-size: 24px; filter: drop-shadow(0 0 10px ${color});">🚛</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
}"""
icon_new = """function getVehicleIcon(bearing) {
    const isCrit = window.currentWeather && window.currentWeather.multiplier >= 1.5;
    const color = isCrit ? '#ef4444' : '#00e5ff';
    return {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><g transform="rotate(${bearing} 20 20)"><text x="20" y="25" font-size="24" text-anchor="middle" style="filter: drop-shadow(0 0 10px ${color});">🚛</text></g></svg>`),
        scaledSize: new google.maps.Size(40,40),
        anchor: new google.maps.Point(20, 20)
    };
}"""
content = content.replace(icon_old, icon_new)

# 4. Routing via OSRM to Google Directions API
route_old = """    const coords = stops.map(s => `${s.lng},${s.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.code === 'Ok') {
            const routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            window.globalRouteCoords = routeCoords;
            window.globalCoveredCoords = [routeCoords[0]];
            
            // Plot complete route in dull color first
            if (window.routeMarkers) window.routeMarkers.forEach(m => map.removeLayer(m));
            window.routeMarkers = [];

            // Add Stop Markers
            stops.forEach((stop, index) => {
                const isStart = index === 0;
                const isEnd = index === stops.length - 1;
                const iconHtml = `<div style="background:${isStart?'#10b981':isEnd?'#ef4444':'#f59e0b'}; color:black; font-weight:bold; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid white; box-shadow:0 0 10px ${isStart?'#10b981':isEnd?'#ef4444':'#f59e0b'};">${index+1}</div>`;
                const icon = L.divIcon({ className: '', html: iconHtml, iconSize: [24, 24], iconAnchor: [12, 12] });
                const m = L.marker([stop.lat, stop.lng], {icon: icon}).addTo(map);
                m.bindPopup(`<b>${stop.address}</b><br>Type: ${stop.type}`);
                window.routeMarkers.push(m);
            });

            // Start Navigation Tracking Engine (simplified)
            initializeNavigationEngine(routeCoords, data.routes[0].legs);
            
            // Initial Plot
            updateRouteDisplay();
            
            // Fit bounds
            if (routeCoords.length > 0) {
                map.fitBounds(L.polyline(routeCoords).getBounds(), { padding: [50, 50] });
            }
        } else {
            console.warn("OSRM Route failed, using straight lines.");
            drawStraightLines(stops);
        }
    } catch (e) {
        console.error(e);
        drawStraightLines(stops);
    }"""
route_new = """    if (!window.directionsService) window.directionsService = new google.maps.DirectionsService();
    if (!window.directionsRenderer) window.directionsRenderer = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: true, polylineOptions: { strokeColor: '#888888', strokeWeight: 6, strokeOpacity: 0.5 } });

    const origin = new google.maps.LatLng(stops[0].lat, stops[0].lng);
    const destination = new google.maps.LatLng(stops[stops.length - 1].lat, stops[stops.length - 1].lng);
    const waypoints = stops.slice(1, -1).map(s => ({ location: new google.maps.LatLng(s.lat, s.lng), stopover: true }));

    window.directionsService.route({ origin, destination, waypoints, travelMode: google.maps.TravelMode.DRIVING }, (response, status) => {
        if (status === 'OK') {
            window.directionsRenderer.setDirections(response);
            const route = response.routes[0];
            const routeCoords = route.overview_path.map(p => [p.lat(), p.lng()]);
            window.globalRouteCoords = routeCoords;
            window.globalCoveredCoords = [routeCoords[0]];
            
            if (window.routeMarkers) window.routeMarkers.forEach(m => m.setMap(null));
            window.routeMarkers = [];

            stops.forEach((stop, index) => {
                const isStart = index === 0;
                const isEnd = index === stops.length - 1;
                const color = isStart?'#10b981':isEnd?'#ef4444':'#f59e0b';
                const m = new google.maps.Marker({
                    position: {lat: stop.lat, lng: stop.lng},
                    map: map,
                    icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/><text x="12" y="16" font-size="12" font-weight="bold" fill="black" text-anchor="middle">${index+1}</text></svg>`), scaledSize: new google.maps.Size(24,24), anchor: new google.maps.Point(12,12) }
                });
                const info = new google.maps.InfoWindow({ content: `<div style="color:black;"><b>${stop.address}</b><br>Type: ${stop.type}</div>` });
                m.addListener('click', () => info.open(map, m));
                window.routeMarkers.push(m);
            });

            // Voice navigation extraction from first step
            if (route.legs.length > 0 && route.legs[0].steps.length > 0) {
                let firstInstruction = route.legs[0].steps[0].instructions.replace(/<[^>]*>?/gm, '');
                speakVoiceInstruction("Navigation started. " + firstInstruction);
            }

            // Start Navigation Tracking Engine (simplified)
            initializeNavigationEngine(routeCoords, route.legs);
            updateRouteDisplay();
            
        } else {
            console.warn("Directions request failed due to " + status);
            drawStraightLines(stops);
        }
    });"""
content = content.replace(route_old, route_new)

# 5. Add speech synthesis
content = content.replace("function initializeNavigationEngine(routeCoords, legs) {", """function speakVoiceInstruction(text) {
    if ('speechSynthesis' in window) {
        let utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
    }
}

function initializeNavigationEngine(routeCoords, legs) {""")

# 6. darkMapStyle inside driver_dashboard.js
content = content.replace("""    if (!map) {
        const theme = localStorage.getItem('theme') || 'dark';
        map = new google.maps.Map(document.getElementById('route-map'), {""", """    if (!map) {
        const darkMapStyle = [
            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
            { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
            { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] }
        ];
        const theme = localStorage.getItem('theme') || 'dark';
        map = new google.maps.Map(document.getElementById('route-map'), {""")

# Remove remaining L.polyline / L.circle manually below if needed, but first apply these exact replacements.
with open('frontend/js/driver_dashboard.js', 'w') as f: f.write(content)
print("Finished driving dashboard phase 1")
