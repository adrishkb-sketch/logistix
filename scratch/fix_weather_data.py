import re

with open('backend/routers/tracking.py', 'r') as f:
    backend_code = f.read()

# Fix Open-Meteo timeout by capping points to 25 instead of 100
backend_code = backend_code.replace('points = points[:100]', 'points = points[:25]')
with open('backend/routers/tracking.py', 'w') as f:
    f.write(backend_code)

with open('frontend/pages/manager_weather.html', 'r') as f:
    html_code = f.read()

# Fix RainViewer API integration
html_code = html_code.replace('const latest = past[past.length - 1].path;', 'const latest = past[past.length - 1].time;')
html_code = html_code.replace('`https://tilecache.rainviewer.com${latest}/256/{z}/{x}/{y}/4/1_1.png`', '`https://tilecache.rainviewer.com/v2/radar/${latest}/256/{z}/{x}/{y}/4/1_1.png`')

with open('frontend/pages/manager_weather.html', 'w') as f:
    f.write(html_code)

print("Fixes applied successfully.")
