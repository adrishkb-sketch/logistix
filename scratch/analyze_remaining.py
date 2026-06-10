import os
import re

frontend_dir = '/Users/adrish/Desktop/Projects/logistix/frontend'
pages_dir = os.path.join(frontend_dir, 'pages')
js_dir = os.path.join(frontend_dir, 'js')

all_htmls = []
all_htmls.append(os.path.join(frontend_dir, 'index.html'))

for f in os.listdir(pages_dir):
    if f.endswith('.html') and not f.startswith('manager_'):
        all_htmls.append(os.path.join(pages_dir, f))

def get_associated_js(html_path):
    filename = os.path.basename(html_path)
    if filename == 'index.html':
        return [os.path.join(js_dir, 'auth.js')]
    
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Allow version query parameters after .js (e.g. ?v=2.2)
    js_refs = re.findall(r'<script[^>]*src=["\']\.\./js/([^"\']+\.js)(?:\?[^"\']*)?["\']', content)
    js_refs += re.findall(r'<script[^>]*src=["\']js/([^"\']+\.js)(?:\?[^"\']*)?["\']', content)
    
    paths = []
    for ref in js_refs:
        p = os.path.join(js_dir, ref)
        if os.path.exists(p):
            paths.append(p)
            
    # Also check matching file name as fallback
    js_name = filename.replace('.html', '.js')
    js_path = os.path.join(js_dir, js_name)
    if os.path.exists(js_path) and js_path not in paths:
        paths.append(js_path)
        
    return list(set(paths))

results = {}

for html_path in sorted(all_htmls):
    html_file = os.path.basename(html_path)
    with open(html_path, 'r', encoding='utf-8') as f:
        html_content = f.read()
        
    associated_js = get_associated_js(html_path)
    js_content = ""
    for js_p in associated_js:
        with open(js_p, 'r', encoding='utf-8') as f:
            js_content += f.read() + "\n"
            
    modal_start_idx = len(html_content)
    
    id_matches = re.finditer(r'<div[^>]*\bid=["\']([^"\']*modal[^"\']*)["\']', html_content, re.IGNORECASE)
    for m in id_matches:
        if m.start() < modal_start_idx:
            modal_start_idx = m.start()
            
    class_matches = re.finditer(r'<div[^>]*class=["\']([^"\']*\bmodal\b[^"\']*)["\'][^>]*\bid=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
    for m in class_matches:
        if m.start() < modal_start_idx:
            modal_start_idx = m.start()
            
    class_matches2 = re.finditer(r'<div[^>]*\bid=["\']([^"\']+)["\'][^>]*class=["\']([^"\']*\bmodal\b[^"\']*)["\']', html_content, re.IGNORECASE)
    for m in class_matches2:
        if m.start() < modal_start_idx:
            modal_start_idx = m.start()

    main_content = html_content[:modal_start_idx]
    modals_content = html_content[modal_start_idx:]
    
    modal_ids = []
    mid_matches = re.findall(r'\bid=["\']([^"\']+)["\']', modals_content)
    for mid in mid_matches:
        if 'modal' in mid.lower() or mid in ['wh-edit-modal', 'wh-modal', 'edit-fields', 'edit-form']:
            if mid not in modal_ids:
                modal_ids.append(mid)
                
    modal_ids = sorted(list(set(modal_ids)))
    
    used_modals = []
    unused_modals = []
    
    for mid in modal_ids:
        used_in_js = False
        if js_content:
            if re.search(r'\b' + re.escape(mid) + r'\b', js_content):
                used_in_js = True
                
        used_in_main_html = False
        if re.search(r'\b' + re.escape(mid) + r'\b', main_content):
            used_in_main_html = True
            
        used_in_script_tags = False
        script_blocks = re.findall(r'<script[^>]*>(.*?)</script>', modals_content, re.DOTALL)
        for block in script_blocks:
            if re.search(r'\b' + re.escape(mid) + r'\b', block):
                used_in_script_tags = True
                break
        
        if used_in_js or used_in_main_html or used_in_script_tags:
            used_modals.append(mid)
        else:
            unused_modals.append(mid)
            
    # Check library usages
    uses_leaflet = 'L.' in js_content or 'L.map' in js_content or 'L.' in html_content or 'L.map' in html_content
    uses_leaflet_draw = 'leaflet.draw' in js_content.lower() or 'drawcontrol' in js_content.lower() or 'leaflet.draw' in html_content.lower() or 'drawcontrol' in html_content.lower()
    uses_qrcode = 'new qrcode' in js_content.lower() or 'new qrcode' in html_content.lower()
    uses_chart = 'new chart(' in js_content.lower() or 'new chart(' in html_content.lower()
            
    results[html_file] = {
        "js_files": [os.path.basename(p) for p in associated_js],
        "total_modals": len(modal_ids),
        "used": used_modals,
        "unused": unused_modals,
        "libraries": {
            "leaflet": uses_leaflet,
            "leaflet_draw": uses_leaflet_draw,
            "qrcode": uses_qrcode,
            "chart": uses_chart
        }
    }

output_path = '/Users/adrish/Desktop/Projects/logistix/scratch/remaining_pages_analysis.txt'
with open(output_path, 'w', encoding='utf-8') as out:
    for html_file, data in sorted(results.items()):
        out.write(f"\n==================================================\n")
        out.write(f"Page: {html_file}\n")
        out.write(f"JS Controllers: {data['js_files']}\n")
        out.write(f"Total Modals: {data['total_modals']}\n")
        out.write(f"Used ({len(data['used'])}): {data['used']}\n")
        out.write(f"Unused ({len(data['unused'])}): {data['unused']}\n")
        out.write(f"Library usage: {data['libraries']}\n")

print("Analysis done! Written to", output_path)
