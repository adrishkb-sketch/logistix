import os
import re

FRONTEND_DIR = "/Users/adrish/Desktop/Projects/logistix/frontend"

# 1. Delete files
files_to_delete = [
    os.path.join(FRONTEND_DIR, "pages/manager_ledger.html"),
    os.path.join(FRONTEND_DIR, "pages/driver_contracts.html"),
    os.path.join(FRONTEND_DIR, "js/manager_ledger.js")
]

for f in files_to_delete:
    if os.path.exists(f):
        os.remove(f)
        print(f"Deleted {f}")

# 2. Process HTML files in pages/
pages_dir = os.path.join(FRONTEND_DIR, "pages")
for filename in os.listdir(pages_dir):
    if not filename.endswith(".html"):
        continue
    filepath = os.path.join(pages_dir, filename)
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    original = content

    # Remove sidebar link for manager ledger: manager_ledger.html or showSection('ledger')
    # Examples:
    # <a class="nav-link" data-layout-id="nav-ledger" href="manager_ledger.html">⛓️<span data-i18n="nav_ledger">Smart Contracts</span></a>
    # <a href="#" class="nav-link" onclick="showSection('ledger')" data-layout-id="nav-ledger">⛓️ <span data-i18n="nav_ledger">Smart Contracts</span></a>
    # <a class="nav-link active" data-layout-id="nav-ledger" href="manager_ledger.html">⛓️<span data-i18n="nav_ledger">Smart Contracts</span></a>
    # <a class="nav-link" href="manager_ledger.html">⛓️ <span>Smart Contracts</span></a>
    content = re.sub(r'<a[^>]*href=["\']manager_ledger\.html["\'][^>]*>.*?</a>\s*', '', content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r'<a[^>]*onclick=["\']showSection\(\'ledger\'\)["\'][^>]*>.*?</a>\s*', '', content, flags=re.DOTALL | re.IGNORECASE)

    # Remove driver tab buttons:
    # <button class="tab-btn" id="btn-tab-contracts" onclick="switchDriverTab('contracts')" style="">⛓️ <span data-i18n="tab_contracts">Contracts</span></button>
    content = re.sub(r'<button[^>]*id=["\']btn-tab-contracts["\'][^>]*>.*?</button>\s*', '', content, flags=re.DOTALL | re.IGNORECASE)

    # Remove driver contracts tab content in driver.html
    # From <div id="contracts-tab" to the closing div before <div id="dash-tab"
    if 'id="contracts-tab"' in content:
        # Let's find index of contracts-tab and find matching close tag or use strict block replacement
        pattern = r'\s*<div[^>]*id="contracts-tab".*?</div>\s*(?=\s*<div[^>]*id="dash-tab")'
        content = re.sub(pattern, '\n', content, flags=re.DOTALL)

    # Remove paisa-b2b-escrow from manager.html and manager_payments.html
    # <div data-layout-id="paisa-b2b-escrow" ...> ... </div>
    # Let's match from <div data-layout-id="paisa-b2b-escrow" to the closing </div> preceding the next data-layout-id or style
    if 'data-layout-id="paisa-b2b-escrow"' in content:
        # Match <div data-layout-id="paisa-b2b-escrow" ... </div> preceding <div data-layout-id="paisa-fund-requests-main"
        pattern = r'\s*<div[^>]*data-layout-id="paisa-b2b-escrow".*?</div>\s*(?=\s*<div[^>]*data-layout-id="paisa-fund-requests-main")'
        content = re.sub(pattern, '\n', content, flags=re.DOTALL)

    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Updated HTML file: {filename}")

# 3. Process JS files
js_files = [
    os.path.join(FRONTEND_DIR, "js/manager_base.js"),
    os.path.join(FRONTEND_DIR, "js/manager.js"),
    os.path.join(FRONTEND_DIR, "js/driver.js"),
    os.path.join(FRONTEND_DIR, "js/voice.js")
]

for filepath in js_files:
    if not os.path.exists(filepath):
        continue
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    original = content

    # Remove mappings or references
    # manager_base.js/manager.js mappings
    content = content.replace("'manager_ledger.html': 'ledger',", "")
    content = content.replace('"manager_ledger.html": "ledger",', "")
    content = content.replace("'manager_ledger.html': 'ledger'", "")
    
    # driver.js / voice.js mappings
    content = content.replace("'contracts': 'driver_contracts.html',", "")
    content = content.replace('"contracts": "driver_contracts.html",', "")
    
    # Let's remove the escrow table loading in manager.js
    # window.loadPayments / fintech-escrow-table
    # eTable.innerHTML = ... line
    # We can leave manager.js function stubs if they don't break but let's clean any direct references
    
    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Updated JS file: {os.path.basename(filepath)}")

print("Smart Contract UI clean up completed.")
