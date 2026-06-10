import re

with open('frontend/pages/manager_analytics.html', 'r') as f:
    analytics_html = f.read()

sidebar_match = re.search(r'<aside class="sidebar">.*?</aside>', analytics_html, re.DOTALL)
manager_sidebar = sidebar_match.group(0)

top_bar_match = re.search(r'<header class="top-bar">.*?</header>', analytics_html, re.DOTALL)
top_bar = top_bar_match.group(0)
# Change the title
top_bar = re.sub(r'<span id="nav-dash".*?>Executive Analytics</span>', r'<span class="split-text text-shine-hover" id="nav-weather">Weather Fleet Map</span>', top_bar)

with open('frontend/pages/manager_weather.html', 'r') as f:
    weather_html = f.read()

# 1. Replace aside
weather_html = re.sub(r'<aside class="sidebar">.*?</aside>', manager_sidebar, weather_html, flags=re.DOTALL)

# 2. Replace top-bar div
weather_html = re.sub(r'<div class="top-bar" style="margin-bottom:24px;">.*?</div>\s*<!-- Weather Fleet Map Section -->', top_bar + '\n    <!-- Weather Fleet Map Section -->', weather_html, flags=re.DOTALL)

# 3. Add premium css
if 'premium_theme.css' not in weather_html:
    weather_html = weather_html.replace('</head>', '    <link href="../css/premium_theme.css" rel="stylesheet"/>\n</head>')

# 4. Add bg-blobs
if 'class="bg-blobs"' not in weather_html:
    blobs = """<div class="bg-blobs">
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="blob blob-3"></div>
</div>
<div class="sidebar-overlay" onclick="toggleMobileSidebar(false)"></div>"""
    weather_html = weather_html.replace('<div class="dashboard-layout">', blobs + '\n<div class="dashboard-layout">')

# 5. Add premium js
if 'premium_theme.js' not in weather_html:
    weather_html = weather_html.replace('</body>', '<script src="../js/premium_theme.js"></script>\n</body>')

with open('frontend/pages/manager_weather.html', 'w') as f:
    f.write(weather_html)

print("Fixed weather html")
