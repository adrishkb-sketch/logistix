import os
import re

PAGES_DIR = 'frontend/pages'

iot_manager_link = """
            <a class="nav-link" href="iot_sandbox.html" style="color: #10b981;">
                <svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
                <span style="margin-left: 12px;">IoT Hardware Sandbox</span>
            </a>"""

iot_wh_link = """
            <a class="nav-link-v3" href="iot_sandbox.html" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981;">
                <svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
                <span>IoT Hardware Sandbox</span>
            </a>"""

for filename in os.listdir(PAGES_DIR):
    filepath = os.path.join(PAGES_DIR, filename)
    if not filepath.endswith('.html'): continue

    with open(filepath, 'r') as f:
        content = f.read()

    changed = False

    if filename.startswith('manager_') and filename != 'manager_dashboard.html':
        # Find the end of the Network Resilience link
        match = re.search(r'(<span data-i18n="nav_resilience">.*?</span>\s*</a>)', content)
        if match and "IoT Hardware Sandbox" not in content:
            content = content[:match.end()] + iot_manager_link + content[match.end():]
            changed = True

    elif filename.startswith('warehouse_manager_') and filename != 'warehouse_manager.html':
        match = re.search(r'(<span>Drone Hub</span>\s*</a>)', content)
        if match and "IoT Hardware Sandbox" not in content:
            content = content[:match.end()] + iot_wh_link + content[match.end():]
            changed = True

    if changed:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Updated {filename}")
