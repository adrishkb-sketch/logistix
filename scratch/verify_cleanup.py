import os
import re

pages_dir = '/Users/adrish/Desktop/Projects/logistix/frontend/pages'
js_dir = '/Users/adrish/Desktop/Projects/logistix/frontend/js'

html_files = [f for f in os.listdir(pages_dir) if f.startswith('manager_') and f.endswith('.html')]

# List of IDs known to be created dynamically in JS
dynamic_ids = {'manual-hub-modal', 'image-zoom-modal', 'zoom-modal-img'}

errors = 0

def find_all_ids(html_content):
    return set(re.findall(r'\bid=["\']([^"\']+)["\']', html_content, re.IGNORECASE))

for html_file in sorted(html_files):
    html_path = os.path.join(pages_dir, html_file)
    with open(html_path, 'r', encoding='utf-8') as f:
        html_content = f.read()
        
    js_name = html_file.replace('.html', '.js')
    js_path = os.path.join(js_dir, js_name)
    js_content = ""
    if os.path.exists(js_path):
        with open(js_path, 'r', encoding='utf-8') as f:
            js_content = f.read()
            
    defined_ids = find_all_ids(html_content)
    
    js_queried_ids = re.findall(r'getElementById\([\'"]([^\'"]+)[\'"]\)', js_content)
    # Refine querySelector match: extract just the ID part, handling spaces or descendent selectors
    qs_matches = re.findall(r'querySelector\([\'"]#([^\'"]+)[\'"]\)', js_content)
    for qs in qs_matches:
        # e.g., 'profile-modal h4:last-of-type' -> 'profile-modal'
        base_id = qs.split()[0]
        # remove any pseudo-classes or attributes
        base_id = re.split(r'[:.\[]', base_id)[0]
        js_queried_ids.append(base_id)
    
    inline_scripts = re.findall(r'<script[^>]*>(.*?)</script>', html_content, re.DOTALL)
    inline_queried_ids = []
    for script in inline_scripts:
        inline_queried_ids += re.findall(r'getElementById\([\'"]([^\'"]+)[\'"]\)', script)
        qs_matches = re.findall(r'querySelector\([\'"]#([^\'"]+)[\'"]\)', script)
        for qs in qs_matches:
            base_id = qs.split()[0]
            base_id = re.split(r'[:.\[]', base_id)[0]
            inline_queried_ids.append(base_id)
        
    all_queried = set(js_queried_ids + inline_queried_ids)
    
    for qid in all_queried:
        if qid in dynamic_ids:
            continue
            
        if 'modal' in qid.lower() or qid in ['wh-modal', 'wh-edit-modal']:
            if qid not in defined_ids:
                print(f"ERROR in {html_file}: JS/inline script queries '{qid}' but it is not defined in the HTML!")
                errors += 1

if errors == 0:
    print("SUCCESS: All JS controller modal DOM queries matched defined HTML elements!")
else:
    print(f"FAILED: Found {errors} unresolved modal queries.")
