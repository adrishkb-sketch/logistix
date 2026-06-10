import os
import re

pages_dir = '/Users/adrish/Desktop/Projects/logistix/frontend/pages'
js_dir = '/Users/adrish/Desktop/Projects/logistix/frontend/js'

html_files = [f for f in os.listdir(pages_dir) if f.startswith('manager_') and f.endswith('.html')]

def get_js_file(html_file):
    base_name = html_file.replace('.html', '.js')
    js_path = os.path.join(js_dir, base_name)
    if os.path.exists(js_path):
        return js_path
    return None

results = {}

for html_file in sorted(html_files):
    html_path = os.path.join(pages_dir, html_file)
    with open(html_path, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    js_path = get_js_file(html_file)
    js_content = ""
    if js_path:
        with open(js_path, 'r', encoding='utf-8') as f:
            js_content = f.read()

    # Find the start of the modals section.
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
            
    results[html_file] = {
        "js_file": os.path.basename(js_path) if js_path else None,
        "total_modals": len(modal_ids),
        "used": used_modals,
        "unused": unused_modals
    }

output_path = '/Users/adrish/Desktop/Projects/logistix/scratch/modal_analysis.txt'
with open(output_path, 'w', encoding='utf-8') as out:
    for html_file, data in sorted(results.items()):
        out.write(f"\n==================================================\n")
        out.write(f"Page: {html_file}\n")
        out.write(f"JS Controller: {data['js_file']}\n")
        out.write(f"Total Modals: {data['total_modals']}\n")
        out.write(f"Used ({len(data['used'])}): {data['used']}\n")
        out.write(f"Unused ({len(data['unused'])}): {data['unused']}\n")

print("Done! Output written to", output_path)
