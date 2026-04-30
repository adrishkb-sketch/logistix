import json
import os
import re

def get_en_translations(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Extract the 'en' block using regex
    match = re.search(r'"en":\s*\{([^}]+)\}', content, re.DOTALL)
    if not match:
        return {}
    
    keys_content = match.group(1)
    en_dict = {}
    for line in keys_content.split('\n'):
        line = line.strip()
        if line and ':' in line:
            # Match key-value pair, handle potential escaped quotes
            kv_match = re.search(r'"([^"]+)":\s*"((?:[^"\\]|\\.)*)"', line)
            if kv_match:
                key, val = kv_match.groups()
                # Unescape some common things if needed
                en_dict[key] = val
    return en_dict

def sync_json_files(base_dir, en_translations):
    json_files = [f for f in os.listdir(base_dir) if f.endswith('.json')]
    
    for filename in json_files:
        file_path = os.path.join(base_dir, filename)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"Error reading {filename}: {e}")
            continue
        
        updated = False
        for key, val in en_translations.items():
            if key not in data:
                data[key] = val
                updated = True
        
        if updated:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            print(f"Updated {filename}")
        else:
            print(f"No updates needed for {filename}")

if __name__ == "__main__":
    translations_js = '/Users/adrish/Desktop/logistix/frontend/js/translations.js'
    js_dir = '/Users/adrish/Desktop/logistix/frontend/js/'
    
    en_trans = get_en_translations(translations_js)
    print(f"Found {len(en_trans)} English translation keys.")
    
    if en_trans:
        sync_json_files(js_dir, en_trans)
    else:
        print("Failed to extract English translations.")
