import re
with open('frontend/pages/executive_warehouses.html', 'r') as f: content = f.read()

content = re.sub(r'    <link crossorigin="" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css".*?>\n    <link href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css".*?/>\n', '', content)
content = re.sub(r'<script crossorigin="" integrity=".*?" src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>', '<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDVPnuQKHJxNnw3kstRBfIynZbafz2llpo&libraries=places,geometry,visualization"></script>', content)

with open('frontend/pages/executive_warehouses.html', 'w') as f: f.write(content)

with open('frontend/js/executive_warehouses.js', 'r') as f: content = f.read()

# 1. Map init
init_old = """    map = L.map('map').setView([20.5937, 78.9629], 5);
    const theme = localStorage.getItem('theme') || 'dark';
    let tileUrl = theme === 'dark' ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    L.tileLayer(tileUrl, { maxZoom: 19, attribution: '&copy; CARTO' }).addTo(map);

    // Apply SOI Border
    fetch('../data/india-composite-simplified.geojson').then(r => r.ok ? r.json() : Promise.reject('no local')).then(data => {
        const borderStyle = { color: '#00e5ff', weight: 2.5, fillOpacity: 0, opacity: 0.95, lineJoin: 'round', lineCap: 'round' };
        L.geoJSON(data, { style: borderStyle }).addTo(map);
    }).catch(() => {});"""
init_new = """    const theme = localStorage.getItem('theme') || 'dark';
    const darkMapStyle = [
        { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
        { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
        { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
        { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] }
    ];
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 20.5937, lng: 78.9629 },
        zoom: 5,
        styles: theme === 'dark' ? darkMapStyle : [],
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
    });

    map.data.loadGeoJson('../data/india-composite-simplified.geojson');
    map.data.setStyle({
        fillColor: 'transparent',
        strokeWeight: 2.5,
        strokeColor: '#00e5ff'
    });"""
content = content.replace(init_old, init_new)

# 2. Markers
marker_old = """    mapMarkers.forEach(m => map.removeLayer(m)); mapMarkers = [];

    data.forEach(wh => {
        const markerHtml = `<div style="background:rgba(0, 255, 115, 0.15); border:2px solid var(--success); box-shadow:0 0 12px rgba(0, 255, 115, 0.5); border-radius:8px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-size:14px;">🏢</div>`;
        const icon = L.divIcon({ className: '', html: markerHtml, iconSize: [28, 28], iconAnchor: [14, 14] });
        const m = L.marker([wh.lat, wh.lng], { icon }).addTo(map);
        
        m.bindPopup(`
            <div style="min-width:200px; font-family:Space Grotesk,sans-serif; line-height:1.6; color:var(--text-main);">
                <b style="color:var(--success); font-size:1.1rem;">🏭 ${wh.name}</b><br>
                <small style="color:var(--text-muted);">📍 ${wh.address||'N/A'}</small><br><br>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                    <span><b>Capacity:</b> ${wh.capacity}</span>
                    <span><b>Occupied:</b> ${wh.occupied_capacity}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-top:4px;">
                    <span><b>Status:</b> <span style="color:${wh.status==='active'?'#10b981':'#ef4444'}">${wh.status.toUpperCase()}</span></span>
                    <span><b>Score:</b> <span style="color:#00e5ff">${wh.resilience_score}/100</span></span>
                </div>
            </div>
        `);
        mapMarkers.push(m);
    });"""
marker_new = """    mapMarkers.forEach(m => m.setMap(null)); mapMarkers = [];

    data.forEach(wh => {
        const m = new google.maps.Marker({
            position: {lat: wh.lat, lng: wh.lng},
            map: map,
            title: wh.name,
            icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="rgba(0, 255, 115, 0.15)" stroke="#00ff73" stroke-width="2"/></svg>'), scaledSize: new google.maps.Size(28,28) }
        });
        
        const info = new google.maps.InfoWindow({ content: `
            <div style="min-width:200px; font-family:Space Grotesk,sans-serif; line-height:1.6; color:black;">
                <b style="color:#10b981; font-size:1.1rem;">🏭 ${wh.name}</b><br>
                <small style="color:#64748b;">📍 ${wh.address||'N/A'}</small><br><br>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                    <span><b>Capacity:</b> ${wh.capacity}</span>
                    <span><b>Occupied:</b> ${wh.occupied_capacity}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-top:4px;">
                    <span><b>Status:</b> <span style="color:${wh.status==='active'?'#10b981':'#ef4444'}">${wh.status.toUpperCase()}</span></span>
                    <span><b>Score:</b> <span style="color:#00e5ff">${wh.resilience_score}/100</span></span>
                </div>
            </div>
        `});
        m.addListener('click', () => info.open(map, m));
        mapMarkers.push(m);
    });"""
content = content.replace(marker_old, marker_new)

with open('frontend/js/executive_warehouses.js', 'w') as f: f.write(content)
print("Finished infra phase")
