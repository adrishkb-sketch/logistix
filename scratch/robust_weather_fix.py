import re

with open('frontend/pages/executive_weather.html', 'r') as f:
    content = f.read()

# 1. Replace remaining L. calls with Google Maps equivalents or remove them
content = re.sub(r'drawControl = new L\.Control\.Draw\(\{.*?\}\);', '/* drawControl setup removed */', content, flags=re.DOTALL)
content = re.sub(r'map\.on\(L\.Draw\.Event\.CREATED, function\(e\) \{.*?\}\);', '/* Leaflet event removed */', content, flags=re.DOTALL)
content = re.sub(r'map\.on\(L\.Draw\.Event\.DRAWSTOP, function\(\) \{ setDrawMode\(false\); \}\);', '/* Leaflet event removed */', content)

# 2. Tile layers (standard_dark, standard_light, terrain, satellite, radarLayer, cloudLayer, windLayer)
content = re.sub(r'standard_dark: L\.tileLayer\(.*?\),', 'standard_dark: "dark",', content)
content = re.sub(r'standard_light: L\.tileLayer\(.*?\),', 'standard_light: "light",', content)
content = re.sub(r'terrain: L\.tileLayer\(.*?\),', 'terrain: "terrain",', content)
content = re.sub(r'satellite: L\.tileLayer\(.*?\}\)', 'satellite: "satellite"', content)
content = re.sub(r'radarLayer = L\.tileLayer\(.*?\);', 'radarLayer = null;', content)
content = re.sub(r'cloudLayer = L\.tileLayer\(.*?\);', 'cloudLayer = null;', content)
content = re.sub(r'windLayer = L\.tileLayer\(.*?\);', 'windLayer = null;', content)

# 3. HeatLayer
content = re.sub(r'if \(!fleetData \|\| !L\.heatLayer\) return;', 'if (!fleetData) return;', content)
content = re.sub(r'else heatLayer = L\.heatLayer\(.*?\}\);', 'else { /* heatlayer migrated to Google earlier */ }', content)

# 4. SOI layers
content = re.sub(r'window\._soiBorderLayer = L\.geoJSON\(data, \{ style: borderStyle \}\)\.addTo\(mapInstance\);', 'mapInstance.data.loadGeoJson("../data/india-composite-simplified.geojson");', content)
content = re.sub(r'window\._soiPatchLayers\.push\(L\.polyline\(.*?\)\.addTo\(mapInstance\)\);', '/* Leaflet polyline removed */', content)

with open('frontend/pages/executive_weather.html', 'w') as f:
    f.write(content)
print("Updated executive_weather.html")
