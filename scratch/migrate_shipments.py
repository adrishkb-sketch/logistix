import re

with open('frontend/pages/executive_shipments.html', 'r') as f: content = f.read()
content = re.sub(r'    <link crossorigin="" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css".*?>\n', '', content)
content = re.sub(r'<script crossorigin="" integrity=".*?" src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>', '<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDVPnuQKHJxNnw3kstRBfIynZbafz2llpo&libraries=places,geometry"></script>', content)
with open('frontend/pages/executive_shipments.html', 'w') as f: f.write(content)

with open('frontend/js/executive_shipments.js', 'r') as f: content = f.read()

# 1. ICON_PICKER -> Google Maps SVG Icon
content = content.replace("""const ICON_PICKER = L.divIcon({
    html: `<div style="background:var(--accent); width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px var(--accent); font-size:12px; color:black;">📍</div>`,
    className: 'custom-marker', iconSize: [24, 24], iconAnchor: [12, 12]
});""", """const ICON_PICKER = {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#3b82f6" stroke="white" stroke-width="2"/></svg>'),
    scaledSize: new google.maps.Size(24, 24),
    anchor: new google.maps.Point(12, 12)
};""")

# 2. coordinate picking map
pick_old = """            if (currentVal && currentVal.includes(',')) {
                const [lat, lng] = currentVal.split(',').map(s => parseFloat(s.trim()));
                if (!isNaN(lat) && !isNaN(lng)) {
                    const ll = L.latLng(lat, lng);
                    pickingMap.setView(ll, 12);
                    pickingMarker = L.marker(ll, { icon: ICON_PICKER }).addTo(pickingMap);
                    pickedCoords = { lat, lng };
                    document.getElementById('current-pick-display').innerText = `Current: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                }
            }

            // Force refit after modal show
            setTimeout(() => { if (pickingMap) pickingMap.invalidateSize(); }, 300);
        }
    };

    if (!pickingMap) {
        pickingMap = L.map('picking-map').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png').addTo(pickingMap);
        applyOfficialBorders(pickingMap);
    }

    pickingMap.on('click', function(e) {
        const { lat, lng } = e.latlng;
        pickedCoords = { lat, lng };
        if (pickingMarker) {
            pickingMarker.setLatLng(e.latlng);
        } else {
            pickingMarker = L.marker(e.latlng, { icon: ICON_PICKER }).addTo(pickingMap);
        }"""
pick_new = """            if (currentVal && currentVal.includes(',')) {
                const [lat, lng] = currentVal.split(',').map(s => parseFloat(s.trim()));
                if (!isNaN(lat) && !isNaN(lng)) {
                    pickingMap.setCenter({lat, lng});
                    pickingMap.setZoom(12);
                    if (pickingMarker) pickingMarker.setMap(null);
                    pickingMarker = new google.maps.Marker({position: {lat, lng}, map: pickingMap, icon: ICON_PICKER});
                    pickedCoords = { lat, lng };
                    document.getElementById('current-pick-display').innerText = `Current: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                }
            }

            // Force refit after modal show
            setTimeout(() => { if (pickingMap) google.maps.event.trigger(pickingMap, 'resize'); }, 300);
        }
    };

    if (!pickingMap) {
        pickingMap = new google.maps.Map(document.getElementById('picking-map'), {
            center: { lat: 20.5937, lng: 78.9629 }, zoom: 5,
            styles: [{ elementType: "geometry", stylers: [{ color: "#242f3e" }] }, { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] }, { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] }, { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }],
            disableDefaultUI: true
        });
        applyOfficialBorders(pickingMap);
    }

    google.maps.event.addListener(pickingMap, 'click', function(e) {
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();
        pickedCoords = { lat, lng };
        if (pickingMarker) {
            pickingMarker.setPosition(e.latLng);
        } else {
            pickingMarker = new google.maps.Marker({position: e.latLng, map: pickingMap, icon: ICON_PICKER});
        }"""
content = content.replace(pick_old, pick_new)

# 3. tracking map
track_old = """    if (!trackMap) {
        trackMap = L.map('track-map').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(trackMap);
    }
    if (window.updateMapTheme) {
        window.updateMapTheme(trackMap);
    } else {
        const t = localStorage.getItem('theme') || 'dark';
        if(t==='dark') {
            trackMap.eachLayer(l => { if(l instanceof L.TileLayer) l.setUrl('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'); });
        }
    }
    
    // Clear old
    if (trackMarkers) trackMarkers.forEach(m => trackMap.removeLayer(m));
    trackMarkers = [];"""
track_new = """    if (!trackMap) {
        trackMap = new google.maps.Map(document.getElementById('track-map'), {
            center: { lat: 20.5937, lng: 78.9629 }, zoom: 5,
            styles: localStorage.getItem('theme') === 'dark' ? [
                { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
            ] : []
        });
    }
    
    // Clear old
    if (trackMarkers) trackMarkers.forEach(m => m.setMap(null));
    trackMarkers = [];"""
content = content.replace(track_old, track_new)

# 4. tracking map markers
marker_old2 = """        const localIconPickup = window.ICON_PICKUP || L.divIcon({className: 'custom-marker'});
        const localIconDrop = window.ICON_DROP || L.divIcon({className: 'custom-marker'});
        const localIconWarehouse = window.ICON_WAREHOUSE || L.divIcon({className: 'custom-marker'});

        // 1. Plot Origin (of the tracked segment)
        let pName = mainShipment.pickup.address || mainShipment.pickup.name || "Initial Pickup";
        const originMarker = L.marker([mainShipment.pickup.lat, mainShipment.pickup.lng], {icon: localIconPickup})
            .addTo(trackMap).bindPopup(target.is_leg ? `<b>Leg ${target.leg_order} Pickup:</b> ${pName}` : `<b>Initial Pickup:</b> ${pName}`);
        trackMarkers.push(originMarker);

        // 2. Plot Destination (of the tracked segment)
        let dName = mainShipment.drop.address || mainShipment.drop.name || "Final Delivery Point";
        const destinationMarker = L.marker([mainShipment.drop.lat, mainShipment.drop.lng], {icon: localIconDrop})
            .addTo(trackMap).bindPopup(target.is_leg ? `<b>Leg ${target.leg_order} Drop:</b> ${dName}` : `<b>Final Delivery Point:</b> ${dName}`);
        trackMarkers.push(destinationMarker);

        // 3. Plot Hubs (if it's a full shipment with multiple legs)
        if (!target.is_leg && legs.length > 1) {
            legs.forEach((leg, idx) => {
                if (idx < legs.length - 1) {
                    const hubMarker = L.marker([leg.drop.lat, leg.drop.lng], {icon: localIconWarehouse})
                        .addTo(trackMap).bindPopup(`<b>Hub ${idx + 1}:</b> ${leg.drop.address || leg.drop.name || 'Network Hub'}`);
                    trackMarkers.push(hubMarker);
                }
            });
        }

        // 4. Plot Current Location
        let activeLeg = target.is_leg ? target : (legs.find(l => l.status === 'in_transit' || l.status === 'assigned') || legs[legs.length - 1] || target);
        
        if (activeLeg.current_location) {
            const mC = L.circleMarker([activeLeg.current_location.lat, activeLeg.current_location.lng], {
                color: '#fff', fillColor: '#3b82f6', weight: 3, radius: 10, fillOpacity: 1
            }).addTo(trackMap).bindPopup("Current Unit Location");
            trackMarkers.push(mC);
        }"""
marker_new2 = """        const gPickup = { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#10b981" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) };
        const gDrop = { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#ef4444" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) };
        const gHub = { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#f59e0b" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) };

        // 1. Plot Origin
        let pName = mainShipment.pickup.address || mainShipment.pickup.name || "Initial Pickup";
        const originMarker = new google.maps.Marker({position: {lat: mainShipment.pickup.lat, lng: mainShipment.pickup.lng}, map: trackMap, icon: gPickup});
        const oInfo = new google.maps.InfoWindow({content: target.is_leg ? `<b>Leg ${target.leg_order} Pickup:</b> ${pName}` : `<b>Initial Pickup:</b> ${pName}`});
        originMarker.addListener('click', () => oInfo.open(trackMap, originMarker));
        trackMarkers.push(originMarker);

        // 2. Plot Destination
        let dName = mainShipment.drop.address || mainShipment.drop.name || "Final Delivery Point";
        const destinationMarker = new google.maps.Marker({position: {lat: mainShipment.drop.lat, lng: mainShipment.drop.lng}, map: trackMap, icon: gDrop});
        const dInfo = new google.maps.InfoWindow({content: target.is_leg ? `<b>Leg ${target.leg_order} Drop:</b> ${dName}` : `<b>Final Delivery Point:</b> ${dName}`});
        destinationMarker.addListener('click', () => dInfo.open(trackMap, destinationMarker));
        trackMarkers.push(destinationMarker);

        // 3. Plot Hubs
        if (!target.is_leg && legs.length > 1) {
            legs.forEach((leg, idx) => {
                if (idx < legs.length - 1) {
                    const hubMarker = new google.maps.Marker({position: {lat: leg.drop.lat, lng: leg.drop.lng}, map: trackMap, icon: gHub});
                    const hInfo = new google.maps.InfoWindow({content: `<b>Hub ${idx + 1}:</b> ${leg.drop.address || leg.drop.name || 'Network Hub'}`});
                    hubMarker.addListener('click', () => hInfo.open(trackMap, hubMarker));
                    trackMarkers.push(hubMarker);
                }
            });
        }

        // 4. Plot Current Location
        let activeLeg = target.is_leg ? target : (legs.find(l => l.status === 'in_transit' || l.status === 'assigned') || legs[legs.length - 1] || target);
        
        if (activeLeg.current_location) {
            const mC = new google.maps.Marker({
                position: {lat: activeLeg.current_location.lat, lng: activeLeg.current_location.lng},
                map: trackMap,
                icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#3b82f6" stroke="white" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(20, 20), anchor: new google.maps.Point(10, 10) }
            });
            const cInfo = new google.maps.InfoWindow({content: "Current Unit Location"});
            mC.addListener('click', () => cInfo.open(trackMap, mC));
            trackMarkers.push(mC);
        }"""
content = content.replace(marker_old2, marker_new2)

# 5. Route polylines
route_old2 = """        const segments = legs.length > 0 ? legs : [target];
        for (const seg of segments) {
            if (seg.route_type === 'drone-leg') {
                const dronePath = L.polyline([[seg.pickup.lat, seg.pickup.lng], [seg.drop.lat, seg.drop.lng]], {color: '#f6ad55', weight: 3, dashArray: '5, 10'}).addTo(trackMap);
                trackMarkers.push(dronePath);
            } else {
                try {
                    const rRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${seg.pickup.lng},${seg.pickup.lat};${seg.drop.lng},${seg.drop.lat}?overview=full&geometries=geojson`);
                    const rData = await rRes.json();
                    if(rData.routes && rData.routes[0]) {
                        const coords = rData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                        const color = seg.status === 'delivered' ? '#a0aec0' : '#3182ce';
                        const pline = L.polyline(coords, {color, weight: 6, opacity: 0.85}).addTo(trackMap);
                        trackMarkers.push(pline);
                    }
                } catch(e) {}
            }
        }
        
        setTimeout(() => { if (trackMap) trackMap.invalidateSize(); }, 300);"""
route_new2 = """        if (!window.directionsService) window.directionsService = new google.maps.DirectionsService();
        const segments = legs.length > 0 ? legs : [target];
        for (const seg of segments) {
            if (seg.route_type === 'drone-leg') {
                const dronePath = new google.maps.Polyline({path: [{lat: seg.pickup.lat, lng: seg.pickup.lng}, {lat: seg.drop.lat, lng: seg.drop.lng}], strokeColor: '#f6ad55', strokeWeight: 3, map: trackMap});
                trackMarkers.push(dronePath);
            } else {
                try {
                    const color = seg.status === 'delivered' ? '#a0aec0' : '#3182ce';
                    window.directionsService.route({
                        origin: new google.maps.LatLng(seg.pickup.lat, seg.pickup.lng),
                        destination: new google.maps.LatLng(seg.drop.lat, seg.drop.lng),
                        travelMode: google.maps.TravelMode.DRIVING
                    }, (response, status) => {
                        if (status === 'OK') {
                            const pline = new google.maps.Polyline({
                                path: response.routes[0].overview_path,
                                strokeColor: color, strokeWeight: 6, strokeOpacity: 0.85, map: trackMap
                            });
                            trackMarkers.push(pline);
                        }
                    });
                } catch(e) {}
            }
        }
        
        setTimeout(() => { if (trackMap) google.maps.event.trigger(trackMap, 'resize'); }, 300);"""
content = content.replace(route_old2, route_new2)

with open('frontend/js/executive_shipments.js', 'w') as f: f.write(content)
print("Finished shipments phase")
