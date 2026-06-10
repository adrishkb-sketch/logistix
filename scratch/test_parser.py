import re

html_path = '/Users/adrish/Desktop/Projects/logistix/frontend/pages/manager_warehouses.html'
with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

def find_div_bounds(html, start_pos):
    pos = start_pos
    div_match = re.match(r'<div', html[pos:], re.IGNORECASE)
    if not div_match:
        return None
        
    depth = 0
    tag_re = re.compile(r'</?div\b', re.IGNORECASE)
    
    # We must scan starting from pos
    for m in tag_re.finditer(html, pos):
        tag = m.group(0).lower()
        if tag.startswith('</'):
            depth -= 1
            if depth == 0:
                return m.end() + 1 # Include the trailing '>'
        else:
            depth += 1
    return None

# Search for all modals in manager_warehouses.html
modal_div_re = re.compile(r'<div[^>]*\bid=["\']([^"\']+)["\']', re.IGNORECASE)

modals = []
for m in modal_div_re.finditer(content):
    mid = m.group(1)
    if 'modal' in mid.lower() or mid in ['wh-modal', 'wh-edit-modal']:
        start_idx = m.start()
        end_idx = find_div_bounds(content, start_idx)
        if end_idx:
            # Check if there is a trailing '>' since the regex doesn't match it
            # The regex matched </?div. So m.end() is right after 'v' in 'div'.
            # We want to find the '>' character.
            close_bracket = content.find('>', end_idx - 2)
            if close_bracket != -1:
                end_idx = close_bracket + 1
            modals.append((mid, start_idx, end_idx))
            print(f"Found modal: {mid} from {start_idx} to {end_idx} (len={end_idx-start_idx})")
        else:
            print(f"Failed to find end for modal: {mid}")
