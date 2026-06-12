import os
import re

file_path = '/Users/adrish/Desktop/Projects/logistix/frontend/js/driver_dashboard.js'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Replace Icons
icons_old = """const ICON_PICKUP = L.divIcon({
    html: `<div style="background:#f6ad55; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px rgba(246,173,85,0.8), 0 0 30px rgba(246,173,85,0.4); font-size:18px;">🏢</div>`,
    className: 'custom-marker', iconSize: [36, 36], iconAnchor: [18, 18]
});

const ICON_DROP = L.divIcon({
    html: `<div style="background:#48bb78; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 15px rgba(72,187,120,0.8), 0 0 30px rgba(72,187,120,0.4); font-size:18px;">🏁</div>`,
    className: 'custom-marker', iconSize: [36, 36], iconAnchor: [18, 18]
});

function getVehicleIcon(bearing = 0) {
    return L.divIcon({
        html: `<div style="transform:rotate(${bearing}deg); font-size:26px; transition: transform 0.5s ease; filter: drop-shadow(0 0 10px rgba(0,229,255,0.8)); text-align:center;">🚛</div>`,
        className: 'vehicle-marker', iconSize: [30, 30], iconAnchor: [15, 15]
    });
}"""

icons_new = """const ICON_PICKUP = { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><circle cx="18" cy="18" r="16" fill="#f6ad55" stroke="white" stroke-width="2"/><text x="18" y="24" font-size="18" text-anchor="middle">🏢</text></svg>'), scaledSize: new google.maps.Size(36,36) };
const ICON_DROP = { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><circle cx="18" cy="18" r="16" fill="#48bb78" stroke="white" stroke-width="2"/><text x="18" y="24" font-size="18" text-anchor="middle">🏁</text></svg>'), scaledSize: new google.maps.Size(36,36) };

function getVehicleIcon(bearing = 0) {
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><g transform="rotate(${bearing} 20 20)"><text x="20" y="26" font-size="26" text-anchor="middle">🚛</text></g></svg>`), scaledSize: new google.maps.Size(40,40) };
}"""
content = content.replace(icons_old, icons_new)

# 2. Replace updateLocation
updateLocation_old = """async function updateLocation(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    
    if (!marker) {
        marker = L.marker([lat, lng], {icon: getVehicleIcon(0), draggable: isSimulationMode}).addTo(map);
        attachSimulationDrag(marker);
    } else {
        marker.setLatLng([lat, lng]);
    }
    
    if (!hasSetInitialView) {
        map.setView([lat, lng], 15);
        hasSetInitialView = true;
    }"""
updateLocation_new = """async function updateLocation(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    
    if (!marker) {
        marker = new google.maps.Marker({ position: {lat, lng}, map: map, icon: getVehicleIcon(0), draggable: isSimulationMode });
        if (isSimulationMode) {
            google.maps.event.addListener(marker, 'dragend', async function(e) {
                await apiCall(`/driver/${localStorage.getItem('driver_id')}/location`, 'POST', { lat: e.latLng.lat(), lng: e.latLng.lng() });
                showNotification(getTranslation('sim_movement_synced'), "success");
            });
        }
    } else {
        marker.setPosition({lat, lng});
    }
    
    if (!hasSetInitialView && map) {
        map.setCenter({lat, lng});
        map.setZoom(15);
        hasSetInitialView = true;
    }"""
content = content.replace(updateLocation_old, updateLocation_new)

# 3. Replace map initialization in loadMissions
map_init_old = """            if (!map) {
                map = L.map('route-map').setView([orderedStops[0].lat, orderedStops[0].lng], 13);
                const theme = localStorage.getItem('theme') || 'dark';
                const tileUrl = theme === 'dark' 
                    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
                L.tileLayer(tileUrl, { attribution: '&copy; CARTO' }).addTo(map);
                applyOfficialBorders(map);
                
                addMapControlsAndHUD();
                
                if (navigator.geolocation) {
                    watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {enableHighAccuracy: true});
                } else {
                    handleError();
                }
            } else {
                map.eachLayer((layer) => {
                    if (layer instanceof L.Polyline || layer instanceof L.Marker || layer instanceof L.CircleMarker) {
                        map.removeLayer(layer);
                    }
                });
            }"""
map_init_new = """            if (!map) {
                const darkMapStyle = [
                    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
                ];
                const theme = localStorage.getItem('theme') || 'dark';
                map = new google.maps.Map(document.getElementById('route-map'), {
                    center: { lat: orderedStops[0].lat, lng: orderedStops[0].lng },
                    zoom: 13,
                    styles: theme === 'dark' ? darkMapStyle : [],
                    disableDefaultUI: true
                });
                
                // Add Map Controls safely if implemented for GMaps or skip
                // applyOfficialBorders is typically L.geoJSON, we skip or use map.data
                
                if (navigator.geolocation) {
                    watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {enableHighAccuracy: true});
                } else {
                    handleError();
                }
            } else {
                if (window.routeMarkers) window.routeMarkers.forEach(m => m.setMap(null));
                if (window.directionsRenderer) window.directionsRenderer.setMap(null);
            }
            window.routeMarkers = window.routeMarkers || [];"""
content = content.replace(map_init_old, map_init_new)

# 4. Replace drawMultiStopRoute
draw_route_old = """async function drawMultiStopRoute(stops) {
    if (stops.length === 0) return;
    
    if (marker) {
        marker.addTo(map);
    }
    
    // Fit bounds to stops and marker initially
    const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lng]));
    if (marker) bounds.extend(marker.getLatLng());
    map.fitBounds(bounds, { padding: [50, 50] });
    
    stops.forEach((stop, idx) => {
        const isCurrent = idx === 0;
        const icon = stop.type === 'pickup' ? ICON_PICKUP : ICON_DROP;
        const m = L.marker([stop.lat, stop.lng], {icon: icon}).addTo(map);
        
        let popupHtml = `<b>${stop.type === 'pickup' ? getTranslation('pickup') : getTranslation('drop')}</b><br>${stop.shipment.description}`;
        if (isCurrent) {
            if (stop.type === 'pickup') {
                 popupHtml += `<br><button style="margin-top:5px; background:var(--primary); color:white; border:none; padding:5px; border-radius:4px; cursor:pointer;" onclick="confirmPickup('${stop.shipment.id}')">${getTranslation('confirm_pickup')}</button>`;
            } else {
                 popupHtml += `<br><button style="margin-top:5px; background:var(--success); color:white; border:none; padding:5px; border-radius:4px; cursor:pointer;" onclick="confirmDelivery('${stop.shipment.id}', '${stop.shipment.delivery_otp}')">${getTranslation('confirm_drop_otp')}</button>`;
            }
        }
        m.bindPopup(popupHtml);
        if (isCurrent) m.openPopup();
    });
    
    let coordsString = stops.map(s => `${s.lng},${s.lat}`).join(';');
    if (marker) {
        coordsString = `${marker.getLatLng().lng},${marker.getLatLng().lat};` + coordsString;
    }
    try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=true`);
        const data = await res.json();
        if (data.routes && data.routes[0]) {
            routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            if (routeCoords.length > 0) {
                map.fitBounds(L.polyline(routeCoords).getBounds(), { padding: [50, 50] });
            }
            
            activeRoutePolylines.forEach(p => map.removeLayer(p));
            activeRoutePolylines = [];
            
            // Initially render route progress
            const mLoc = marker ? marker.getLatLng() : null;
            if (mLoc) {
                updateRouteProgress(mLoc.lat, mLoc.lng);
            }
            
            let driverPos = marker ? [marker.getLatLng().lat, marker.getLatLng().lng] : [stops[0].lat, stops[0].lng];
            if(window.lastLat && window.lastLng) driverPos = [window.lastLat, window.lastLng];
            if(!window.globalCoveredCoords) window.globalCoveredCoords = [];
            
            // Add current pos to covered path
            if (window.globalCoveredCoords.length === 0 || window.getDistanceKm(window.globalCoveredCoords[window.globalCoveredCoords.length-1], driverPos) > 0.05) {
                window.globalCoveredCoords.push(driverPos);
            }
            
            let remainingDist = 0;
            for(let i=0; i<routeCoords.length - 1; i++) {
                remainingDist += window.getDistanceKm(routeCoords[i], routeCoords[i+1]);
            }
            window.currentRemainingKm = remainingDist;
            
            if(window.globalCoveredCoords.length > 1) {
                const polyCovered = L.polyline(window.globalCoveredCoords, {color: '#888888', weight: 6, opacity: 0.6, dashArray: '10, 10'}).addTo(map);
                activeRoutePolylines.push(polyCovered);
            }
            
            const chunkSize = Math.ceil(routeCoords.length / 5);
            for(let i=0; i<routeCoords.length; i+=chunkSize) {
                const chunk = routeCoords.slice(i, i+chunkSize+1);
                if(chunk.length < 2) continue;
                const rand = Math.random();
                let color = '#3182ce'; 
                if (rand > 0.9) color = '#ff4b4b'; 
                else if (rand > 0.7) color = '#f6ad55'; 
                
                const poly = L.polyline(chunk, {color: color, weight: 6, opacity: 0.85}).addTo(map);
                activeRoutePolylines.push(poly);
            }
            
            // Call Turn-by-Turn Panel
            if (data.routes[0].legs) {
                renderTurnByTurnPanel(data.routes[0].legs);
            }
            
            // Update ETA & Fuel Calculator Strip
            const durationMins = Math.round(data.routes[0].duration / 60);
            const distKm = parseFloat((data.routes[0].distance / 1000).toFixed(1));
            const eff = (window.driverStats && window.driverStats.fuel_efficiency) || 15.0;
            const fuelLiters = (distKm / eff).toFixed(1);
            const fuelCost = Math.round(fuelLiters * 95);
            
            const durationEl = document.getElementById('calc-duration');
            const distanceEl = document.getElementById('calc-distance');
            const fuelEl = document.getElementById('calc-fuel');
            const stripEl = document.getElementById('eta-fuel-strip');
            
            if (durationEl) durationEl.innerText = `${durationMins} mins`;
            if (distanceEl) distanceEl.innerText = `${distKm} km`;
            if (fuelEl) fuelEl.innerText = `${fuelLiters} L (₹${fuelCost})`;
            if (stripEl) stripEl.style.display = 'flex';
            
            // Weather Strip Update
            updateWeatherStrip(stops);
            
            // Start HUD live telemetry ticker
            startHUDTicker(stops);
            
            // Update HUD
            setTimeout(() => {
                const nextStop = stops[0];
                const waypointEl = document.getElementById('hud-waypoint');
                if (waypointEl && nextStop) {
                    waypointEl.innerText = nextStop.shipment.drop.address || nextStop.shipment.drop.name || "Hub Base";
                }
            }, 500);
        }
    } catch(err) {
        console.error("OSRM drawing error:", err);
    }

    if (window.currentDriverObj && window.currentDriverObj.fatigue_score >= 100) {
        try {
            const currentLoc = marker ? marker.getLatLng() : stops[0];
            const restStops = await apiCall(`/driver/safety/rest-stops?lat=${currentLoc.lat}&lng=${currentLoc.lng}`);
            restStops.forEach(stop => {
                const bedIcon = L.icon({
                    iconUrl: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
                    iconSize: [32, 32],
                    iconAnchor: [16, 32]
                });
                const m = L.marker([stop.lat, stop.lng], { icon: bedIcon }).addTo(map);
                m.bindPopup(`<b>🏨 Rest Spot: ${stop.name} (${stop.rating}⭐)</b><br>Facilities: ${stop.amenities.join(', ')}<br><button onclick="window.startRest({name: '${stop.name.replace(/'/g, "\\'")}', lat: ${stop.lat}, lng: ${stop.lng}})" style="margin-top:5px; background:var(--success); color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Start Rest Here</button>`);
            });
        } catch(e) {
            console.error("Failed to map rest stops", e);
        }
    }
}"""
draw_route_new = """async function drawMultiStopRoute(stops) {
    if (stops.length === 0 || !map) return;
    
    if (window.routeMarkers) window.routeMarkers.forEach(m => m.setMap(null));
    window.routeMarkers = [];
    
    const bounds = new google.maps.LatLngBounds();
    if (marker) bounds.extend(marker.getPosition());
    
    stops.forEach((stop, idx) => {
        const isCurrent = idx === 0;
        const icon = stop.type === 'pickup' ? ICON_PICKUP : ICON_DROP;
        const m = new google.maps.Marker({ position: {lat: stop.lat, lng: stop.lng}, map: map, icon: icon });
        bounds.extend(m.getPosition());
        
        let popupHtml = `<div style="color:black;"><b>${stop.type === 'pickup' ? getTranslation('pickup') : getTranslation('drop')}</b><br>${stop.shipment.description}`;
        if (isCurrent) {
            if (stop.type === 'pickup') {
                 popupHtml += `<br><button style="margin-top:5px; background:var(--primary); color:white; border:none; padding:5px; border-radius:4px; cursor:pointer;" onclick="confirmPickup('${stop.shipment.id}')">${getTranslation('confirm_pickup')}</button>`;
            } else {
                 popupHtml += `<br><button style="margin-top:5px; background:var(--success); color:white; border:none; padding:5px; border-radius:4px; cursor:pointer;" onclick="confirmDelivery('${stop.shipment.id}', '${stop.shipment.delivery_otp}')">${getTranslation('confirm_drop_otp')}</button>`;
            }
        }
        popupHtml += `</div>`;
        const info = new google.maps.InfoWindow({ content: popupHtml });
        m.addListener('click', () => info.open(map, m));
        if (isCurrent) info.open(map, m);
        window.routeMarkers.push(m);
    });
    
    map.fitBounds(bounds);
    
    // Google Maps Directions API
    if (!window.directionsService) window.directionsService = new google.maps.DirectionsService();
    if (!window.directionsRenderer) window.directionsRenderer = new google.maps.DirectionsRenderer({ suppressMarkers: true, polylineOptions: { strokeColor: '#0ea5e9', strokeWeight: 6, strokeOpacity: 0.8 } });
    
    window.directionsRenderer.setMap(map);
    
    const waypoints = stops.slice(0, -1).map(s => ({ location: {lat: s.lat, lng: s.lng}, stopover: true }));
    const origin = marker ? marker.getPosition() : {lat: stops[0].lat, lng: stops[0].lng};
    const destination = {lat: stops[stops.length-1].lat, lng: stops[stops.length-1].lng};
    
    try {
        const req = { origin, destination, waypoints, travelMode: 'DRIVING', drivingOptions: { departureTime: new Date() } };
        window.directionsService.route(req, (response, status) => {
            if (status === 'OK') {
                window.directionsRenderer.setDirections(response);
                
                const route = response.routes[0];
                let totalDist = 0, totalDur = 0;
                route.legs.forEach(leg => { totalDist += leg.distance.value; totalDur += leg.duration.value; });
                
                const durationMins = Math.round(totalDur / 60);
                const distKm = parseFloat((totalDist / 1000).toFixed(1));
                const eff = (window.driverStats && window.driverStats.fuel_efficiency) || 15.0;
                const fuelLiters = (distKm / eff).toFixed(1);
                const fuelCost = Math.round(fuelLiters * 95);
                
                const durationEl = document.getElementById('calc-duration');
                const distanceEl = document.getElementById('calc-distance');
                const fuelEl = document.getElementById('calc-fuel');
                const stripEl = document.getElementById('eta-fuel-strip');
                
                if (durationEl) durationEl.innerText = `${durationMins} mins`;
                if (distanceEl) distanceEl.innerText = `${distKm} km`;
                if (fuelEl) fuelEl.innerText = `${fuelLiters} L (₹${fuelCost})`;
                if (stripEl) stripEl.style.display = 'flex';
                
                // Voice Navigation Integration
                if (route.legs[0] && route.legs[0].steps && route.legs[0].steps.length > 0) {
                    const firstStep = route.legs[0].steps[0].instructions.replace(/<[^>]*>?/gm, ''); // strip HTML
                    if ('speechSynthesis' in window) {
                        // Debounce voice
                        if (!window.lastVoiceTime || (Date.now() - window.lastVoiceTime) > 60000) {
                            const msg = new SpeechSynthesisUtterance("Navigation started. " + firstStep);
                            msg.rate = 0.9;
                            window.speechSynthesis.speak(msg);
                            window.lastVoiceTime = Date.now();
                        }
                    }
                }
            }
        });
        
        updateWeatherStrip(stops);
        startHUDTicker(stops);
        
        setTimeout(() => {
            const nextStop = stops[0];
            const waypointEl = document.getElementById('hud-waypoint');
            if (waypointEl && nextStop) {
                waypointEl.innerText = nextStop.shipment.drop.address || nextStop.shipment.drop.name || "Hub Base";
            }
        }, 500);
        
    } catch(err) { console.error("Google Maps Route error:", err); }
}"""
content = content.replace(draw_route_old, draw_route_new)

with open(file_path, 'w') as f:
    f.write(content)
print("Successfully rewrote driver_dashboard.js!")
