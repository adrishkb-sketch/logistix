/**
 * manager_weather.js
 * Comprehensive Weather Fleet Map & Simulation Sandbox Engine
 * Uses Leaflet, Turf.js, Chart.js, and Open-Meteo Free API.
 */

document.addEventListener('DOMContentLoaded', async () => {
    
    // 1. Map Initialization & Layers
    const map = L.map('weather-map').setView([22.9, 78.9], 5); // Centered on India

    // Tile Layers
    const layers = {
        dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© CartoDB' }),
        light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© CartoDB' }),
        satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' }),
        terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap' }),
        street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' })
    };

    // Default layer
    layers.dark.addTo(map);

    // Map Style Switcher
    document.getElementById('map-style-select').addEventListener('change', (e) => {
        const selected = e.target.value;
        // Remove all
        Object.values(layers).forEach(layer => map.removeLayer(layer));
        // Add selected
        layers[selected].addTo(map);
    });

    // Custom Glowing SVG Icon for Hubs
    const hubIcon = L.divIcon({
        className: 'custom-hub-icon',
        html: `
            <div style="
                width: 16px; height: 16px; background: #00e5ff; border-radius: 50%;
                box-shadow: 0 0 15px #00e5ff, 0 0 30px #00e5ff; border: 2px solid #fff;
            "></div>
        `,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });

    const hubs = [
        { name: 'Mumbai Hub', coords: [19.0760, 72.8777], baseShipments: 12500 },
        { name: 'Delhi Hub', coords: [28.7041, 77.1025], baseShipments: 18200 },
        { name: 'Bangalore Hub', coords: [12.9716, 77.5946], baseShipments: 15400 },
        { name: 'Chennai Hub', coords: [13.0827, 80.2707], baseShipments: 11000 },
        { name: 'Kolkata Hub', coords: [22.5726, 88.3639], baseShipments: 9500 }
    ];

    // Layer groups for markers and weather markings
    const markersLayer = L.layerGroup().addTo(map);
    const weatherMarkingsLayer = L.layerGroup().addTo(map);

    // 2. Fetch Live Weather Data from Open-Meteo
    async function fetchWeatherData() {
        weatherMarkingsLayer.clearLayers();
        markersLayer.clearLayers();
        
        const weatherDataArray = [];
        document.getElementById('ai-suggestion-content').innerHTML = "Fetching live meteorological data...";

        for (const hub of hubs) {
            // Add marker
            L.marker(hub.coords, { icon: hubIcon }).bindPopup(`<b>${hub.name}</b><br>Base Capacity: ${hub.baseShipments} shipments/day`).addTo(markersLayer);

            try {
                // Free API fetch
                const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${hub.coords[0]}&longitude=${hub.coords[1]}&current=temperature_2m,precipitation,wind_speed_10m`);
                const data = await res.json();
                
                const temp = data.current.temperature_2m;
                const precip = data.current.precipitation;
                const wind = data.current.wind_speed_10m;

                let condition = "Clear";
                let severity = "Normal";
                let color = "#0ea5e9";
                let disruptedPct = 0;
                
                // Advanced Cyclone vs Rain logic
                if (wind > 50 || precip > 15) {
                    condition = "Severe Cyclone Risk";
                    severity = "Danger";
                    color = "#ef4444"; // Red
                    disruptedPct = 0.85; // 85% shipments stopped
                } else if (precip > 2) {
                    condition = "Heavy Rain";
                    severity = "Warning";
                    color = "#f59e0b"; // Orange/Yellow
                    disruptedPct = 0.30;
                } else if (precip > 0.1) {
                    condition = "Light Rain";
                    severity = "Normal";
                    color = "#0ea5e9"; // Blue
                    disruptedPct = 0.05;
                }

                // Plot Round Markings (Weather Circles)
                if (precip > 0.1 || wind > 30) {
                    L.circle(hub.coords, {
                        color: color,
                        fillColor: color,
                        fillOpacity: 0.3,
                        radius: 80000 + (wind * 1000) // Radius based on wind speed
                    }).bindPopup(`<b>${condition}</b><br>Precip: ${precip}mm<br>Wind: ${wind}km/h`).addTo(weatherMarkingsLayer);
                }

                weatherDataArray.push({
                    name: hub.name,
                    temp: temp,
                    precip: precip,
                    wind: wind,
                    condition: condition,
                    severity: severity,
                    color: color,
                    disrupted: Math.floor(hub.baseShipments * disruptedPct)
                });

            } catch(e) {
                console.error("Weather fetch failed for " + hub.name, e);
            }
        }

        updateDashboardElements(weatherDataArray);
    }

    // RainViewer Radar Integration (Real Weather Cloud/Rain Data)
    let radarLayer = null;
    async function fetchRainViewer() {
        try {
            const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
            const data = await response.json();
            const latestPast = data.radar.past[data.radar.past.length - 1];
            const timestamp = latestPast.time;
            const tileUrl = `https://tilecache.rainviewer.com/v2/radar/${timestamp}/256/{z}/{x}/{y}/2/1_1.png`;
            
            if(radarLayer) map.removeLayer(radarLayer);
            radarLayer = L.tileLayer(tileUrl, {
                opacity: 0.8,
                zIndex: 1000,
                attribution: 'Radar Data © RainViewer'
            });
            radarLayer.addTo(map);
        } catch(e) {
            console.error("RainViewer API failed", e);
        }
    }

    // 3. Update AI Panel, Chart, and Table
    let impactChart = null;

    function updateDashboardElements(data) {
        // AI Panel
        let severeCount = data.filter(d => d.severity === 'Danger').length;
        let rainCount = data.filter(d => d.severity === 'Warning').length;
        let totalDisrupted = data.reduce((sum, d) => sum + d.disrupted, 0);

        let aiText = `<strong style="color:var(--text-main);">Live Network Scan Complete.</strong><br><br>`;
        if (severeCount > 0) {
            aiText += `<span style="color:var(--danger); font-weight:bold;">🚨 CYCLONE ALERT:</span> ${severeCount} major hubs face severe disaster risk. Automated rerouting protocols activated. Expected disruption: ${totalDisrupted.toLocaleString()} shipments.<br><br>`;
        } else if (rainCount > 0) {
            aiText += `<span style="color:var(--warning); font-weight:bold;">⚠️ WEATHER WARNING:</span> Heavy rains detected at ${rainCount} hubs. Slight delays expected in last-mile delivery.`;
        } else {
            aiText += `<span style="color:var(--success); font-weight:bold;">✅ ALL CLEAR:</span> Optimal weather conditions across all major nodes. Network operating at 100% capacity.`;
        }
        document.getElementById('ai-suggestion-content').innerHTML = aiText;

        // Populate Table
        const tbody = document.getElementById('disruption-table-body');
        tbody.innerHTML = '';
        data.forEach(d => {
            let action = d.severity === 'Danger' ? '<span style="color:#ef4444; background:rgba(239,68,68,0.1); padding:4px 8px; border-radius:4px;">Halt Operations</span>' : 
                         d.severity === 'Warning' ? '<span style="color:#f59e0b; background:rgba(245,158,11,0.1); padding:4px 8px; border-radius:4px;">Delay Dispatch</span>' : 
                         '<span style="color:#10b981; background:rgba(16,185,129,0.1); padding:4px 8px; border-radius:4px;">Proceed</span>';
            
            let row = `<tr>
                <td style="font-weight:bold;">${d.name}</td>
                <td style="color:${d.color};">${d.condition}</td>
                <td>${d.severity}</td>
                <td style="font-weight:bold;">${d.disrupted.toLocaleString()}</td>
                <td>${action}</td>
            </tr>`;
            tbody.innerHTML += row;
        });

        // Update Chart
        const ctx = document.getElementById('weatherImpactChart').getContext('2d');
        if(impactChart) impactChart.destroy();
        
        impactChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.name.replace(' Hub','')),
                datasets: [
                    {
                        label: 'Wind Speed (km/h)',
                        data: data.map(d => d.wind),
                        backgroundColor: 'rgba(14, 165, 233, 0.6)',
                        borderColor: '#0ea5e9',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Precipitation (mm)',
                        data: data.map(d => d.precip),
                        type: 'line',
                        borderColor: '#10b981',
                        backgroundColor: '#10b981',
                        borderWidth: 3,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                color: '#fff',
                scales: {
                    y: { type: 'linear', display: true, position: 'left', title: {display:true, text:'Wind km/h', color:'#fff'} },
                    y1: { type: 'linear', display: true, position: 'right', grid:{drawOnChartArea:false}, title: {display:true, text:'Precip mm', color:'#fff'} },
                    x: { ticks: { color: '#fff' } }
                },
                plugins: { legend: { labels: { color: '#fff' } } }
            }
        });
    }

    // Initial Fetch
    fetchWeatherData();
    fetchRainViewer();
    document.getElementById('refresh-weather-btn').addEventListener('click', () => {
        fetchWeatherData();
        fetchRainViewer();
    });

    // 4. Simulation Sandbox (Leaflet.draw) & Turf.js Spatial Analysis
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
        edit: { featureGroup: drawnItems },
        draw: {
            polygon: { shapeOptions: { color: '#a855f7', fillColor: '#a855f7', fillOpacity: 0.4 } },
            circle: { shapeOptions: { color: '#a855f7', fillColor: '#a855f7', fillOpacity: 0.4 } },
            rectangle: { shapeOptions: { color: '#a855f7', fillColor: '#a855f7', fillOpacity: 0.4 } },
            polyline: false, marker: false, circlemarker: false
        }
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, function (event) {
        const layer = event.layer;
        drawnItems.addLayer(layer);

        // Convert drawing to GeoJSON for Turf
        const drawnGeoJSON = layer.toGeoJSON();
        
        // Convert Hubs to Turf Points
        const turfPoints = turf.featureCollection(hubs.map(h => turf.point([h.coords[1], h.coords[0]], { name: h.name, shipments: h.baseShipments })));

        // Spatial Math: Which hubs are inside the drawn shape?
        let ptsWithin;
        if (layer instanceof L.Circle) {
            // Turf doesn't have circle polygon natively easily, so we buffer the center point
            const center = [layer.getLatLng().lng, layer.getLatLng().lat];
            const radiusKm = layer.getRadius() / 1000;
            const turfCircle = turf.circle(center, radiusKm);
            ptsWithin = turf.pointsWithinPolygon(turfPoints, turfCircle);
        } else {
            ptsWithin = turf.pointsWithinPolygon(turfPoints, drawnGeoJSON);
        }

        const affectedHubs = ptsWithin.features;
        const totalAffectedShipments = affectedHubs.reduce((sum, f) => sum + f.properties.shipments, 0);
        
        // Show Custom Sandbox Alert
        let sandboxAlert = `<div style="padding:15px; border-radius:8px; background:rgba(168, 85, 247, 0.2); border:1px solid #a855f7; margin-top:15px;">
            <h4 style="color:#a855f7; margin:0 0 8px 0;">🔮 Sandbox Simulation Results</h4>`;
        
        if (affectedHubs.length > 0) {
            sandboxAlert += `<p style="margin:0; font-size:0.9rem;">Drawn event engulfed <b>${affectedHubs.length}</b> hubs: ${affectedHubs.map(h=>h.properties.name).join(', ')}.</p>
            <p style="margin:8px 0 0 0; font-weight:bold; font-size:1.1rem;">📉 Projected Impact: ${totalAffectedShipments.toLocaleString()} shipments disrupted.</p>`;
        } else {
            sandboxAlert += `<p style="margin:0;">Simulated event bypassed all major hubs. Zero impact.</p>`;
        }
        sandboxAlert += `</div>`;

        document.getElementById('ai-suggestion-content').innerHTML += sandboxAlert;
    });

    // Handle "Clear" simulation button
    document.getElementById('reset-sim-btn').addEventListener('click', () => {
        drawnItems.clearLayers();
        fetchWeatherData(); // resets AI panel
    });

});
