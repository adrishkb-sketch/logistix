import json
import re

def extract_translations(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Simple regex to extract the translations object
    # This is hacky but should work for this specific file structure
    matches = re.findall(r'"(en|hi|bn)":\s*\{([^}]+)\}', content, re.DOTALL)
    
    trans_dict = {}
    for lang, keys_content in matches:
        keys = {}
        for line in keys_content.split('\n'):
            line = line.strip()
            if line and ':' in line:
                key_match = re.search(r'"([^"]+)":\s*"([^"]*)"', line)
                if key_match:
                    key, val = key_match.groups()
                    keys[key] = val
        trans_dict[lang] = keys
    return trans_dict

trans = extract_translations('/Users/adrish/Desktop/logistix/frontend/js/translations.js')

en_keys = set(trans['en'].keys())
hi_keys = set(trans['hi'].keys())
bn_keys = set(trans['bn'].keys())

print(f"EN keys: {len(en_keys)}")
print(f"HI keys: {len(hi_keys)}")
print(f"BN keys: {len(bn_keys)}")

print("\nMissing in HI:")
for k in sorted(en_keys - hi_keys):
    print(f'"{k}": "{trans["en"][k]}",')

print("\nMissing in BN:")
for k in sorted(en_keys - bn_keys):
    print(f'"{k}": "{trans["en"][k]}",')
