import os

file_path = 'frontend/js/driver_dashboard.js'
with open(file_path, 'r') as f:
    content = f.read()

# 5. Geofence & Progress (only exact replacements)
content = content.replace("if (completedPolyline) map.removeLayer(completedPolyline);", "if (completedPolyline) completedPolyline.setMap(null);")
content = content.replace("if (remainingPolyline) map.removeLayer(remainingPolyline);", "if (remainingPolyline) remainingPolyline.setMap(null);")
content = content.replace("if (geofenceCircle) map.removeLayer(geofenceCircle);", "if (geofenceCircle) geofenceCircle.setMap(null);")

content = content.replace("""        completedPolyline = L.polyline(completedCoords, {
            color: '#00e5ff',
            weight: 6,
            opacity: 0.9
        }).addTo(map);""", "        completedPolyline = new google.maps.Polyline({path: completedCoords.map(c=>({lat:c[0],lng:c[1]})), strokeColor: '#00e5ff', strokeWeight: 6, strokeOpacity: 0.9, map: map});")

content = content.replace("""        remainingPolyline = L.polyline(remainingCoords, {
            color: '#888888',
            weight: 6,
            opacity: 0.5,
            dashArray: '10, 10'
        }).addTo(map);""", "        remainingPolyline = new google.maps.Polyline({path: remainingCoords.map(c=>({lat:c[0],lng:c[1]})), strokeColor: '#888888', strokeWeight: 6, strokeOpacity: 0.5, map: map});")

content = content.replace("""        geofenceCircle = L.circle([nextStop.lat, nextStop.lng], {
            color: isInsideGeofence ? '#00e5ff' : '#f6ad55',
            fillColor: isInsideGeofence ? '#00e5ff' : '#f6ad55',
            fillOpacity: 0.2,
            radius: 100 // 100 meters
        }).addTo(map);""", "        geofenceCircle = new google.maps.Circle({center: {lat: nextStop.lat, lng: nextStop.lng}, radius: 100, strokeColor: isInsideGeofence ? '#00e5ff' : '#f6ad55', fillOpacity: 0.2, map: map});")

# 6. Traffic Heatmap
content = content.replace("if (trafficHeatmapLayer) map.removeLayer(trafficHeatmapLayer);", "if (trafficHeatmapLayer) trafficHeatmapLayer.setMap(null);")
content = content.replace("""    if (typeof L.heatLayer === 'function') {
        trafficHeatmapLayer = L.heatLayer(heatPoints, {
            radius: 20,
            blur: 15,
            maxZoom: 15,
            gradient: { 0.4: 'green', 0.6: 'yellow', 0.8: 'orange', 1.0: 'red' }
        }).addTo(map);
    } else {
        console.warn("L.heatLayer is not loaded.");
    }""", """    trafficHeatmapLayer = new google.maps.visualization.HeatmapLayer({
        data: heatPoints.map(p=>({location: new google.maps.LatLng(p[0],p[1]), weight: p[2]})),
        radius: 20,
        gradient: ['rgba(0,0,255,0)', 'green', 'yellow', 'orange', 'red'],
        map: map
    });""")

# 7. PolyRerouted
content = content.replace("if (window.currentReroutePolyline) map.removeLayer(window.currentReroutePolyline);", "if (window.currentReroutePolyline) window.currentReroutePolyline.setMap(null);")
content = content.replace("const polyRerouted = L.polyline(reroutedCoords, {color: '#a855f7', weight: 8, opacity: 0.9}).addTo(map);", "const polyRerouted = new google.maps.Polyline({path: reroutedCoords.map(c=>({lat:c[0],lng:c[1]})), strokeColor: '#a855f7', strokeWeight: 8, strokeOpacity: 0.9, map: map});")

with open(file_path, 'w') as f:
    f.write(content)
print("Finished!")
