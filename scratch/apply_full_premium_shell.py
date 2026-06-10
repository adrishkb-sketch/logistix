import os
import re
import glob

# 1. Load Premium Templates from manager_analytics.html
with open('frontend/pages/manager_analytics.html', 'r') as f:
    analytics_html = f.read()

manager_sidebar_match = re.search(r'<aside class="sidebar">.*?</aside>', analytics_html, re.DOTALL)
manager_sidebar = manager_sidebar_match.group(0)

top_bar_match = re.search(r'<header class="top-bar">.*?</header>', analytics_html, re.DOTALL)
premium_top_bar = top_bar_match.group(0)

# Build a generic Sidebar shell template (without links)
sidebar_shell = """<aside class="sidebar">
        <div class="sidebar-header">
            <h2><span>Logistix</span></h2>
            <button class="sidebar-close-btn" onclick="toggleMobileSidebar(false)">
                <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>

        <div class="nav-links-wrapper" data-layout-container="sidebar-nav">
            <!-- REPLACEME_LINKS -->
        </div>

        <div class="sidebar-footer">
            <a class="nav-link" href="#" onclick="logout()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                <span data-i18n="sign_out">Logout</span>
            </a>
        </div>
    </aside>"""

# We need the old warehouse manager links
with open('frontend/pages/warehouse_manager.html', 'r') as f:
    wh_html = f.read()
    wh_nav_match = re.search(r'<nav class="nav-links">(.*?)</nav>', wh_html, re.DOTALL)
    if wh_nav_match:
        wh_nav_links = wh_nav_match.group(1).strip()
    else:
        wh_nav_match = re.search(r'<div class="nav-links-wrapper".*?>(.*?)</div>\s*<div class="sidebar-footer">', wh_html, re.DOTALL)
        wh_nav_links = wh_nav_match.group(1).strip()

warehouse_sidebar = sidebar_shell.replace('<!-- REPLACEME_LINKS -->', wh_nav_links)

# Get all files
manager_files = glob.glob('frontend/pages/manager*.html')
wh_manager_files = glob.glob('frontend/pages/warehouse_manager*.html')
all_files = manager_files + wh_manager_files

skip_files = ['frontend/pages/manager_analytics.html', 'frontend/pages/manager_warehouses.html', 'frontend/pages/manager_shipments.html', 'frontend/pages/manager_weather.html']

bg_blobs = """<div class="background-animation"></div>
<div class="bg-blobs">
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="blob blob-3"></div>
</div>
<div class="sidebar-overlay" onclick="toggleMobileSidebar(false)"></div>"""

for filepath in all_files:
    if filepath in skip_files:
        continue
    print(f"Processing {filepath}")
    with open(filepath, 'r') as f:
        html = f.read()

    # 1. CSS & Fonts
    if 'premium_theme.css' not in html:
        html = html.replace('</head>', '    <link href="../css/premium_theme.css" rel="stylesheet"/>\n</head>')
    
    # Optional: ensure Outfit font is included
    if 'family=Outfit' not in html:
        html = html.replace('</title>', '</title>\n<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">')

    # 2. Add Background Blobs
    if 'class="bg-blobs"' not in html:
        if '<div class="dashboard-layout">' in html:
            html = html.replace('<div class="dashboard-layout">', bg_blobs + '\n<div class="dashboard-layout">')
        elif '<body>' in html:
            html = html.replace('<body>', '<body>\n' + bg_blobs)

    # 3. Replace Sidebar
    if filepath.startswith('frontend/pages/manager_'):
        html = re.sub(r'<aside class="sidebar">.*?</aside>', manager_sidebar, html, flags=re.DOTALL)
    else:
        html = re.sub(r'<aside class="sidebar">.*?</aside>', warehouse_sidebar, html, flags=re.DOTALL)

    # 4. Replace Top-Bar
    # Find the title to preserve it
    title_match = re.search(r'<div class="top-bar".*?>\s*<h1.*?>.*?<span id="nav-[^"]*"(?:[^>]*)?>(.*?)</span>', html, re.DOTALL | re.IGNORECASE)
    if not title_match:
        title_match = re.search(r'<div class="top-bar".*?>\s*<h1.*?>.*?Dashboard — <span.*?>(.*?)</span>', html, re.DOTALL | re.IGNORECASE)
    
    # Some older files just have plain text inside H1
    if not title_match:
        title_match = re.search(r'<div class="top-bar".*?>\s*<h1.*?>(.*?)</h1>', html, re.DOTALL | re.IGNORECASE)
    
    page_title = "Dashboard"
    if title_match:
        # Clean tags from extracted title
        page_title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip()
        if "Dashboard —" in page_title:
            page_title = page_title.replace("Dashboard —", "").strip()
        if "Dashboard -" in page_title:
            page_title = page_title.replace("Dashboard -", "").strip()

    if "---" in page_title or page_title == "":
        # Guess from file name
        base = os.path.basename(filepath).replace(".html", "").replace("_", " ").title()
        page_title = base

    # Customize top-bar title
    new_top_bar = re.sub(r'<span class="split-text text-shine-hover" id="nav-dash".*?>.*?</span>', 
                         f'<span class="split-text text-shine-hover" id="nav-custom">{page_title}</span>', 
                         premium_top_bar)
    
    # Replace existing top-bar (can be <div class="top-bar"> or <header class="top-bar">)
    if '<div class="top-bar"' in html:
        # Regex to match <div class="top-bar"> up to matching closing div, but that's hard with regex.
        # usually ends before <div class="toolbar-sep"> or <div class="stats-grid">
        html = re.sub(r'<div class="top-bar".*?</div>\s*<div class="toolbar-sep"></div>', new_top_bar, html, flags=re.DOTALL)
        # Fallback if toolbar-sep is missing
        if '<header class="top-bar">' not in html:
            html = re.sub(r'<div class="top-bar".*?</div>\s*<!--', new_top_bar + '\n<!--', html, flags=re.DOTALL, count=1)
    
    # 5. Add Premium JS
    if 'premium_theme.js' not in html:
        html = html.replace('</body>', '<script src="../js/premium_theme.js"></script>\n</body>')

    with open(filepath, 'w') as f:
        f.write(html)

print("Done phase 1!")
