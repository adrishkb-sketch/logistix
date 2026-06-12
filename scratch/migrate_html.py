import glob
import re

html_files = glob.glob('frontend/pages/*.html')
api_key = "AIzaSyDVPnuQKHJxNnw3kstRBfIynZbafz2llpo"
google_script = f'<script src="https://maps.googleapis.com/maps/api/js?key={api_key}&libraries=places,geometry,drawing,visualization"></script>'

for f in html_files:
    with open(f, 'r') as file:
        content = file.read()
    
    modified = False
    
    # Remove Leaflet CSS
    if 'leaflet.css' in content or 'leaflet.draw.css' in content:
        content = re.sub(r'<link[^>]*leaflet\.css[^>]*>', '', content)
        content = re.sub(r'<link[^>]*leaflet\.draw\.css[^>]*>', '', content)
        modified = True
        
    # Remove Leaflet JS and inject Google Maps
    if 'leaflet.js' in content:
        content = re.sub(r'<script[^>]*leaflet\.js[^>]*></script>', google_script, content)
        modified = True
        
    if 'leaflet.draw.js' in content:
        content = re.sub(r'<script[^>]*leaflet\.draw\.js[^>]*></script>', '', content)
        modified = True
        
    if 'leaflet-heat.js' in content:
        content = re.sub(r'<script[^>]*leaflet-heat\.js[^>]*></script>', '', content)
        modified = True
        
    if modified:
        with open(f, 'w') as file:
            file.write(content)
        print(f"Migrated {f}")
