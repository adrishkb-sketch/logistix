// Dedicated script for executive_warehouses.html

let map, fleetMap;
let markers = [];
let currentMarkers = [];
let warehouses = [];
let pendingWhLoc = null;
let suggestedWhLoc = null;
let highlightCircle = null;

function initMap() {
    if (!document.getElementById('map')) return;
    if (map) return; // Prevent double initialization
    
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
    updateMapTheme(map);

    // Apply Official Indian Boundaries (SOI Compliant Overlay)
    applyOfficialBorders(map);

    const isWeatherPage = window.location.pathname.includes('executive_weather.html') || (typeof currentActiveSection !== 'undefined' && currentActiveSection === 'weather');
    if (isWeatherPage) {
        initWeatherMapOnMap(map);
        return;
    }

    // Map click to add warehouse
    map.on('click', e => processLocationDeployment(e.latlng.lat, e.latlng.lng));
    
    loadMapData();
}

async function processLocationDeployment(lat, lng) {
    // 1. Center Map & Add Temporary Marker
    map.setView([lat, lng], 13);
    
    // Smooth scroll to map
    document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (window.tempMarker) map.removeLayer(window.tempMarker);
    window.tempMarker = new google.maps.Marker({position: {lat, lng}, map, draggable: true})
        .bindPopup("Selected Deployment Site").openPopup();
    
    window.tempMarker.on('dragend', function(e) {
        const newPos = e.target.getLatLng();
        processLocationDeployment(newPos.lat, newPos.lng);
    });

    // 2. WATER CHECK: Hardened detection for Oceans and Seas with timeout
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'LogistixLogisticsApp/1.0 (contact@logistix.com)'
            }
        });
        clearTimeout(timeoutId);
        
        const terrain = await response.json();
        
        if (terrain && !terrain.error) {
            const dName = (terrain.display_name || "").toLowerCase();
            const type = (terrain.type || "").toLowerCase();
            const category = (terrain.category || "").toLowerCase();
            
            const isWater = type === 'water' || 
                            type === 'river' ||
                            category === 'natural' || 
                            dName.includes('ocean') || 
                            dName.includes('sea') || 
                            dName.includes('bay') ||
                            dName.includes('river') ||
                            dName.includes('canal') ||
                            dName.includes('waterway');

            if (isWater) {
                return alert("🚨 Invalid Deployment Zone: Warehouse cannot be created in the middle of a water body.");
            }
        }
    } catch(e) {
        console.warn("Terrain check skipped due to API timeout or error:", e);
    }

    pendingWhLoc = { lat, lng };
    
    // 3. AI Check
    try {
        const res = await apiCall(`/manager/warehouses/suggest`, 'POST', {
            lat, lng, 
            company_id: localStorage.getItem('manager_id')
        });
        if (res.strategic_improvement || res.distance_km) {
            suggestedWhLoc = { lat: res.suggested_lat, lng: res.suggested_lng };
            document.getElementById('sug-dist').innerText = `${res.distance_km} km`;
            
            const reasonEl = document.getElementById('sug-reason');
            if (res.reason) {
                reasonEl.innerText = getTranslation(res.reason) || res.reason;
            }
            
            document.getElementById('suggestion-modal').style.display = 'block';
            if (window.updatePageTranslations) updatePageTranslations();
        } else {
            openWhModal(lat, lng);
        }
    } catch(err) {
        if (err.message && err.message.toLowerCase().includes("water body")) {
            if (window.tempMarker) map.removeLayer(window.tempMarker);
            return alert("🚨 " + err.message);
        }
        openWhModal(lat, lng);
    }
}

async function deployByPincode() {
    const pin = document.getElementById('search-pincode').value;
    if (!pin) return alert("Please enter a valid pincode");
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&postalcode=${pin}&country=India`, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'LogistixLogisticsApp/1.0 (contact@logistix.com)'
            }
        });
        clearTimeout(timeoutId);
        
        const res = await response.json();
        if (res && res.length > 0) {
            const { lat, lon } = res[0];
            processLocationDeployment(parseFloat(lat), parseFloat(lon));
        } else {
            alert("Pincode not found. Please try manual coordinates.");
        }
    } catch(e) {
        console.warn("Pincode search failed or timed out:", e);
        alert("Search failed or timed out. Check your connection.");
    }
}

async function deployByCoords() {
    const lat = parseFloat(document.getElementById('search-lat').value);
    const lng = parseFloat(document.getElementById('search-lng').value);
    
    if (isNaN(lat) || isNaN(lng)) return alert("Please enter valid Latitude and Longitude");
    processLocationDeployment(lat, lng);
}

async function applyOfficialBorders(mapInstance) {
    const boundaryUrl = 'https://raw.githubusercontent.com/datameet/maps/master/Country/india-osm.geojson';
    try {
        const response = await fetch(boundaryUrl);
        const data = await response.json();
        
        map.data.addGeoJson(data);
        map.data.setStyle({ fillColor: "transparent", strokeWeight: 2.5, strokeColor: "#00e5ff" });
        
        setTimeout(() => { if (highlightCircle) highlightCircle.setMap(null); }, 5000);
    } catch(e) {
        console.warn("Boundary overlay failed to load", e);
    }
}

async function openEditWarehouse(id) {
    try {
        const whs = await apiCall(`/manager/warehouses?company_id=${localStorage.getItem('manager_id')}`);
        const w = whs.find(item => item.id === id);
        if (!w) return;

        document.getElementById('edit-wh-id').value = w.id;
        document.getElementById('edit-wh-name').value = w.name;
        document.getElementById('edit-wh-manager').value = w.manager_name;
        document.getElementById('edit-wh-contact').value = w.contact_number;
        document.getElementById('edit-wh-email').value = w.manager_email || '';
        document.getElementById('edit-wh-password').value = w.manager_password || '';
        document.getElementById('edit-wh-capacity').value = w.capacity || 5;

        document.getElementById('wh-edit-modal').style.display = 'block';
    } catch(e) {}
}

async function submitEditWarehouse() {
    const id = document.getElementById('edit-wh-id').value;
    const name = document.getElementById('edit-wh-name').value;
    const manager = document.getElementById('edit-wh-manager').value;
    const contact = document.getElementById('edit-wh-contact').value;
    const email = document.getElementById('edit-wh-email').value;
    const password = document.getElementById('edit-wh-password').value;
    const capacity = parseInt(document.getElementById('edit-wh-capacity').value) || 5;

    if (!name || !manager || !contact || !email || !password) return alert("All fields are required.");

    try {
        await apiCall(`/manager/warehouses/${id}?company_id=${localStorage.getItem('manager_id')}`, 'PUT', {
            name, 
            manager_name: manager, 
            contact_number: contact,
            manager_email: email,
            manager_password: password,
            capacity: capacity
        });
        document.getElementById('wh-edit-modal').style.display = 'none';
        loadMapData();
        if (typeof loadDriversAndVehicles === 'function') loadDriversAndVehicles();
    } catch(e) {
        alert("Failed to update warehouse.");
    }
}

async function decommissionWarehouse() {
    const id = document.getElementById('edit-wh-id').value;
    if (!id) return;
    
    if (!confirm("⚠️ WARNING: Location coordinates are permanent. Once decommissioned, this hub and its operational history will be archived. Continue?")) return;
    
    try {
        await apiCall(`/manager/warehouses/${id}?company_id=${localStorage.getItem('manager_id')}`, 'DELETE');
        document.getElementById('wh-edit-modal').style.display = 'none';
        loadMapData();
        if (typeof loadDriversAndVehicles === 'function') loadDriversAndVehicles();
    } catch(e) {
        alert("Failed to decommission warehouse.");
    }
}

function openWhModal(lat, lng) {
    pendingWhLoc = {lat, lng};
    document.getElementById('display-lat').innerText = lat.toFixed(6);
    document.getElementById('display-lng').innerText = lng.toFixed(6);
    document.getElementById('wh-modal').style.display = 'block';
}

async function submitNewWarehouse() {
    const name = document.getElementById('wh-name-input').value;
    const manager = document.getElementById('wh-manager-input').value;
    const contact = document.getElementById('wh-contact-input').value;
    const email = document.getElementById('wh-email-input').value;
    const password = document.getElementById('wh-password-input').value;
    const capacity = parseInt(document.getElementById('wh-capacity-input').value) || 5;
    
    if (!pendingWhLoc || isNaN(pendingWhLoc.lat) || isNaN(pendingWhLoc.lng)) {
        return alert("Error: No location selected on the map. Please click the map first.");
    }
    
    if (!name || !manager || !contact || !email || !password) {
        return alert("Error: Warehouse Name, Manager Name, Contact, Email and Password are all required.");
    }
    
    const success = await createWarehouse(name, pendingWhLoc.lat, pendingWhLoc.lng, manager, contact, email, password, capacity);
    if (success) {
        document.getElementById('wh-modal').style.display = 'none';
        document.getElementById('wh-name-input').value = '';
        document.getElementById('wh-manager-input').value = '';
        document.getElementById('wh-contact-input').value = '';
        document.getElementById('wh-email-input').value = '';
        document.getElementById('wh-password-input').value = '';
        document.getElementById('wh-capacity-input').value = '5';
    }
}

async function createWarehouse(name, lat, lng, manager = '', contact = '', email = '', password = '', capacity = 5) {
    try {
        await apiCall('/manager/warehouses', 'POST', {
            company_id: localStorage.getItem('manager_id'),
            name, lat, lng,
            manager_name: manager, 
            contact_number: contact,
            manager_email: email,
            manager_password: password,
            capacity: capacity
        });
        loadMapData();
        if (typeof loadDriversAndVehicles === 'function') loadDriversAndVehicles();
        return true;
    } catch(e) {
        console.error("Create warehouse failed:", e);
        return false;
    }
}

async function adoptStrategicLocation() {
    const manager = document.getElementById('sug-manager').value;
    const contact = document.getElementById('sug-contact').value;
    const email = document.getElementById('sug-email').value;
    const password = document.getElementById('sug-password').value;

    if (!manager || !contact || !email || !password) {
        return alert("Error: Manager Name, Contact, Email and Password are required for AI-suggested hubs.");
    }
    const name = prompt("Enter Warehouse Name for Strategic Hub:");
    const capacity = parseInt(document.getElementById('sug-capacity').value) || 5;
    if (name) {
        const success = await createWarehouse(name, suggestedWhLoc.lat, suggestedWhLoc.lng, manager, contact, email, password, capacity);
        if (success) {
            document.getElementById('suggestion-modal').style.display = 'none';
            document.getElementById('sug-manager').value = '';
            document.getElementById('sug-contact').value = '';
            document.getElementById('sug-email').value = '';
            document.getElementById('sug-password').value = '';
            document.getElementById('sug-capacity').value = '5';
        }
    }
}

async function stayWithManualLocation() {
    const manager = document.getElementById('sug-manager').value;
    const contact = document.getElementById('sug-contact').value;
    const email = document.getElementById('sug-email').value;
    const password = document.getElementById('sug-password').value;

    if (!manager || !contact || !email || !password) {
        return alert("Error: Manager Name, Contact, Email and Password are required.");
    }

    const name = prompt("Enter Warehouse Name for Manual Hub:");
    const capacity = parseInt(document.getElementById('sug-capacity').value) || 5;
    if (name) {
        const success = await createWarehouse(name, pendingWhLoc.lat, pendingWhLoc.lng, manager, contact, email, password, capacity);
        if (success) {
            document.getElementById('suggestion-modal').style.display = 'none';
            document.getElementById('sug-manager').value = '';
            document.getElementById('sug-contact').value = '';
            document.getElementById('sug-email').value = '';
            document.getElementById('sug-password').value = '';
            document.getElementById('sug-capacity').value = '5';
        }
    }
}

async function drawRouteWithTraffic(start, end) {
    try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
        const data = await res.json();
        if(data.routes && data.routes[0]) {
            const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); // Leaflet uses Lat,Lng
            
            // Chunk the coordinates to simulate traffic segments
            const chunkSize = Math.ceil(coords.length / 5);
            for(let i=0; i<coords.length; i+=chunkSize) {
                const chunk = coords.slice(i, i+chunkSize+1);
                // Randomly assign traffic color: 70% Green, 20% Orange, 10% Red
                const rand = Math.random();
                let color = '#48bb78'; // Green
                if (rand > 0.9) color = '#ff4b4b'; // Red
                else if (rand > 0.7) color = '#f6ad55'; // Orange
                
                const pline = new google.maps.Polyline({path: chunk.map(c => ({lat: c[0], lng: c[1]})), strokeColor: color, strokeWeight: 5, strokeOpacity: 0.7, map});
            markers.push(pline); // Push to markers array so it gets cleared on refresh
            }
        }
    } catch(err) {
        console.error("OSRM Route Failed", err);
    }
}

function showInfoTip(el) {
    const tip = el.getAttribute('data-tip');
    if (!tip) return;
    // Remove existing tips to avoid stacking
    const existing = document.querySelectorAll('.oracle-tip-toast');
    existing.forEach(t => t.remove());

    const div = document.createElement('div');
    div.className = 'oracle-tip-toast';
    div.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.9);
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(20px);
        color: white;
        padding: 30px;
        border-radius: 24px;
        z-index: 100000;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        border: 1px solid var(--primary);
        max-width: 400px;
        width: 90%;
        text-align: center;
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    `;
    
    div.innerHTML = `
        <div style="font-size: 2.5rem; margin-bottom: 15px;">💡</div>
        <h3 style="margin: 0 0 10px 0; color: var(--primary);">Intelligence Insight</h3>
        <p style="margin: 0; font-size: 1rem; line-height: 1.6; opacity: 0.9;">${tip}</p>
        <button class="btn-primary" style="margin-top: 25px; width: auto; padding: 10px 30px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);" onclick="this.parentElement.remove()">Got it</button>
    `;
    
    document.body.appendChild(div);
    
    // Trigger animation
    setTimeout(() => {
        div.style.opacity = '1';
        div.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 10);

    // Auto-close on outside click
    const closer = (e) => {
        if (!div.contains(e.target) && e.target !== el) {
            div.remove();
            document.removeEventListener('click', closer);
        }
    };
    setTimeout(() => document.addEventListener('click', closer), 100);
}

async function initPage() {
    initMap(); loadMapData();
}

document.addEventListener('DOMContentLoaded', initPage);

window.addEventListener('themeChanged', () => {
    if (map) {
        updateMapTheme(map);
    }
});

// Expose functions to global window scope for inline HTML event handlers
window.loadMapData = loadMapData;
window.deployByPincode = deployByPincode;
window.deployByCoords = deployByCoords;
window.triggerManualAICheck = triggerManualAICheck;
window.locateWarehouse = locateWarehouse;
window.openEditWarehouse = openEditWarehouse;
window.submitEditWarehouse = submitEditWarehouse;
window.decommissionWarehouse = decommissionWarehouse;
window.submitNewWarehouse = submitNewWarehouse;
window.adoptStrategicLocation = adoptStrategicLocation;
window.stayWithManualLocation = stayWithManualLocation;
window.toggleWhPass = function(id) {
    const input = document.getElementById(`wh-pass-${id}`);
    if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
    }
};
window.refreshWarehousesTable = function() {
    loadWarehousesList(globalWarehouses || globalHubs || []);
};

async function triggerRegionalAIWarehouseReadiness(whId) {
    const reportDiv = document.getElementById('wh-readiness-report');
    const modal = document.getElementById('wh-readiness-modal');
    if (!reportDiv || !modal) return;
    
    // Check key before calling API
    await ensureGeminiApiKey();
    
    reportDiv.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px 0;">🔮 Running AI hub readiness & resource check... Please wait.</p>';
    modal.style.display = 'block';
    
    try {
        const companyId = localStorage.getItem('manager_id');
        const res = await apiCall(`/manager/ai/wh-readiness`, 'POST', { 
            company_id: companyId,
            warehouse_id: whId
        });
        reportDiv.innerHTML = parseMarkdownToHtml(res.report);
    } catch(err) {
        reportDiv.innerHTML = `<p style="color:var(--danger);">Failed to generate AI Hub Readiness report: ${err.message}</p>`;
    }
}
window.triggerRegionalAIWarehouseReadiness = triggerRegionalAIWarehouseReadiness;