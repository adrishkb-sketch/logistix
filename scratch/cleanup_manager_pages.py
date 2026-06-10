import os
import re
import shutil

pages_dir = '/Users/adrish/Desktop/Projects/logistix/frontend/pages'

keep_modals = {
    'manager_analytics.html': [],
    'manager_drivers.html': ['broadcast-modal', 'bulk-driver-modal', 'bulk-drone-modal', 'bulk-vehicle-modal', 'edit-fields', 'edit-form', 'edit-modal', 'smart-assistant-modal'],
    'manager_fuel_oracle.html': [],
    'manager_hub_leaves.html': [],
    'manager_leaderboard.html': ['driver-profile-modal', 'profile-modal'],
    'manager_messages.html': [],
    'manager_oracle.html': [],
    'manager_payments.html': [],
    'manager_receivers.html': ['edit-fields', 'edit-form', 'edit-modal', 'receiver-orders-modal'],
    'manager_resilience.html': [],
    'manager_safety.html': ['logs-modal', 'safety-audit-modal'],
    'manager_shipments.html': ['assign-modal', 'bulk-upload-modal', 'cargo-plan-modal', 'edit-leg-modal', 'logs-modal', 'manual-assign-modal', 'map-picker-modal', 'merge-modal', 'message-modal', 'qr-modal', 'shipment-detail-modal', 'smart-assistant-modal', 'split-modal', 'split-modal-title', 'track-modal'],
    'manager_strategy.html': [],
    'manager_system.html': [],
    'manager_verifications.html': [],
    'manager_warehouses.html': ['congestion-modal', 'edit-modal', 'suggestion-modal', 'wh-edit-modal', 'wh-modal', 'wh-readiness-modal'],
    'manager_weather.html': [] # Already minimal/clean
}

keep_scripts = {
    'manager_analytics.html': ['chart.js'],
    'manager_drivers.html': [],
    'manager_fuel_oracle.html': ['chart.js'],
    'manager_hub_leaves.html': [],
    'manager_leaderboard.html': [],
    'manager_messages.html': [],
    'manager_oracle.html': [],
    'manager_payments.html': ['chart.js'],
    'manager_receivers.html': [],
    'manager_resilience.html': [],
    'manager_safety.html': [],
    'manager_shipments.html': ['leaflet', 'leaflet-draw', 'qrcode'],
    'manager_strategy.html': [],
    'manager_system.html': [],
    'manager_verifications.html': [],
    'manager_warehouses.html': ['chart.js', 'leaflet', 'leaflet-draw'],
    'manager_weather.html': ['chart.js', 'leaflet', 'leaflet-draw']
}

def find_div_bounds(html, start_pos):
    pos = start_pos
    div_match = re.match(r'<div', html[pos:], re.IGNORECASE)
    if not div_match:
        return None
        
    depth = 0
    tag_re = re.compile(r'</?div\b', re.IGNORECASE)
    
    for m in tag_re.finditer(html, pos):
        tag = m.group(0).lower()
        if tag.startswith('</'):
            depth -= 1
            if depth == 0:
                end_pos = m.end()
                close_bracket = html.find('>', end_pos - 2)
                if close_bracket != -1:
                    return close_bracket + 1
                return end_pos
        else:
            depth += 1
    return None

def clean_page(filename):
    html_path = os.path.join(pages_dir, filename)
    if not os.path.exists(html_path):
        print(f"File not found: {filename}")
        return

    # Backup file
    bak_path = html_path + '.bak'
    shutil.copyfile(html_path, bak_path)
    
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()

    # Find modals
    # We find all <div that have id="..."
    # and either contain 'modal' in the id, or id is wh-modal/wh-edit-modal
    modal_div_re = re.compile(r'<div[^>]*\bid=["\']([^"\']+)["\']', re.IGNORECASE)
    
    modals = []
    for m in modal_div_re.finditer(html):
        mid = m.group(1)
        if 'modal' in mid.lower() or mid in ['wh-modal', 'wh-edit-modal']:
            start_idx = m.start()
            end_idx = find_div_bounds(html, start_idx)
            if end_idx:
                modals.append((mid, start_idx, end_idx))

    # Sort modals in descending order of start index to avoid index shifts during replacement
    modals.sort(key=lambda x: x[1], reverse=True)
    
    allowed_modals = keep_modals.get(filename, [])
    allowed_scripts = keep_scripts.get(filename, [])
    
    removed_modals = []
    kept_modals = []
    
    for mid, start_idx, end_idx in modals:
        # Check if we should keep it
        should_keep = False
        for allowed in allowed_modals:
            if allowed == mid:
                should_keep = True
                break
        
        # Also check if it's a child element of an allowed modal (e.g. edit-fields is inside edit-modal)
        # In our sorted traversal, if edit-modal is kept, it keeps its content.
        # But wait! If we delete a child modal before its parent, it will modify the parent.
        # However, because we sorted descending, the child (which occurs later or inside parent)
        # is processed FIRST.
        # If we delete the child, the parent will lose it.
        # To avoid deleting elements inside kept modals, we check if start_idx is inside any kept modal bounds.
        # Actually, let's look at modal IDs. If a modal ID is 'edit-fields', it is inside 'edit-modal'.
        # Since 'edit-fields' is in the allowed_modals list for receivers, we want to keep it.
        # What if it's not in the allowed list but its parent is?
        # Let's check if the modal is nested.
        is_nested = False
        for parent_mid, p_start, p_end in modals:
            if p_start < start_idx and end_idx < p_end:
                # This modal is nested inside another modal!
                is_nested = True
                break
        
        if is_nested:
            # Skip nested modals since they will be handled by the parent!
            continue
            
        if should_keep:
            kept_modals.append(mid)
        else:
            removed_modals.append(mid)
            # Remove from HTML
            # Check if there is some whitespace/newline before the div we can clean up
            slice_start = start_idx
            while slice_start > 0 and html[slice_start-1] in [' ', '\t', '\r', '\n']:
                slice_start -= 1
            # Check if there are comments before the modal that match the modal name
            # e.g., <!-- Manual Assignment Modal -->
            comment_re = re.compile(rf'<!--\s*(?:[^-]*{mid.split("-")[0]}[^-]*)\s*-->\s*$', re.IGNORECASE)
            comment_match = comment_re.search(html[:slice_start])
            if comment_match:
                slice_start = comment_match.start()
                
            html = html[:slice_start] + html[end_idx:]

    # Remove Stylesheets
    if 'leaflet' not in allowed_scripts:
        leaflet_css_re = re.compile(r'<link[^>]*leaflet(?:\.draw)?\.css[^>]*>\s*', re.IGNORECASE)
        html = leaflet_css_re.sub('', html)

    # Remove Scripts
    if 'leaflet' not in allowed_scripts:
        leaflet_js_re = re.compile(r'<script[^>]*leaflet\.js[^>]*>\s*</script>\s*', re.IGNORECASE)
        html = leaflet_js_re.sub('', html)
        
    if 'leaflet-draw' not in allowed_scripts:
        leaflet_draw_js_re = re.compile(r'<script[^>]*leaflet\.draw\.js[^>]*>\s*</script>\s*', re.IGNORECASE)
        html = leaflet_draw_js_re.sub('', html)
        
    if 'qrcode' not in allowed_scripts:
        qrcode_js_re = re.compile(r'<script[^>]*qrcode(?:\.min)?\.js[^>]*>\s*</script>\s*', re.IGNORECASE)
        html = qrcode_js_re.sub('', html)
        
    if 'chart.js' not in allowed_scripts:
        chart_js_re = re.compile(r'<script[^>]*chart(?:\.js|\.min\.js)[^>]*>\s*</script>\s*', re.IGNORECASE)
        html = chart_js_re.sub('', html)

    # Write back to file
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html)
        
    print(f"Page {filename}:")
    print(f"  Kept Modals: {kept_modals}")
    print(f"  Removed Modals: {removed_modals}")
    print(f"  Kept Scripts: {allowed_scripts}")

# Clean all manager pages
for filename in sorted(keep_modals.keys()):
    clean_page(filename)
