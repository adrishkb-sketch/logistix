import re

html_files = [
    'frontend/pages/driver_dashboard.html',
    'frontend/pages/driver_live.html',
    'frontend/pages/driver_tasks.html',
    'frontend/pages/driver_history.html',
    'frontend/pages/driver_wallet.html',
    'frontend/pages/driver_account.html',
    'frontend/pages/driver_chat.html',
]

js_files = [
    'frontend/js/driver_dashboard.js',
    'frontend/js/driver_live.js',
    'frontend/js/driver_tasks.js',
    'frontend/js/track.js',
]

for f in html_files:
    try:
        with open(f, 'r') as file:
            content = file.read()
            if 'leaflet.js' in content:
                print(f"Found Leaflet JS in {f}")
            if 'maps.googleapis.com' in content:
                print(f"Found Google Maps API in {f}")
    except:
        pass

for f in js_files:
    try:
        with open(f, 'r') as file:
            content = file.read()
            if 'L.map' in content:
                print(f"Found L.map in {f}")
            if 'L.marker' in content:
                print(f"Found L.marker in {f}")
    except:
        pass
