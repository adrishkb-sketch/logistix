import os
import re

file_path = '/Users/adrish/Desktop/Projects/logistix/frontend/pages/driver_live.html'
with open(file_path, 'r') as f:
    content = f.read()

# Replace CSS
content = content.replace(
    '<!-- Leaflet CSS -->\n    <link crossorigin="" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" rel="stylesheet">',
    '<!-- Google Maps dynamically injects CSS -->'
)

# Replace Scripts
scripts_old = """<!-- Scripts -->
<script crossorigin="" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>"""

scripts_new = """<!-- Scripts -->
<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDVPnuQKHJxNnw3kstRBfIynZbafz2llpo&libraries=places,geometry,visualization"></script>"""

content = content.replace(scripts_old, scripts_new)

with open(file_path, 'w') as f:
    f.write(content)
print("Successfully rewrote driver_live.html!")
