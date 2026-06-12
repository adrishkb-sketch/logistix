import glob
import re

html_files = glob.glob('frontend/pages/*.html')

for f in html_files:
    with open(f, 'r') as file:
        content = file.read()
    
    modified = False
    
    # Restore Leaflet JS
    if 'leaflet.js' not in content:
        # inject after chart.js or in head
        content = re.sub(r'</head>', r'<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />\n    <link href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css" rel="stylesheet">\n</head>', content)
        content = re.sub(r'</body>', r'<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>\n<script src="https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>\n</body>', content)
        modified = True
        
    if modified:
        with open(f, 'w') as file:
            file.write(content)

