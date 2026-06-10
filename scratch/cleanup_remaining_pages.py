#!/usr/bin/env python3
"""
Cleanup script for remaining (non-manager) pages.
Removes unused CDN library imports based on actual usage analysis.
"""

import re
import os

PAGES_DIR = "/Users/adrish/Desktop/Projects/logistix/frontend/pages"

# Chart.js CDN patterns to remove
CHARTJS_PATTERNS = [
    r'\s*<script src="https://cdn\.jsdelivr\.net/npm/chart\.js"[^>]*></script>\n?',
    r"\s*<script src='https://cdn\.jsdelivr\.net/npm/chart\.js'[^>]*></script>\n?",
]

# Leaflet CSS and JS patterns
LEAFLET_CSS_PATTERN = r'\s*<link[^>]*leaflet[^>]*\.css[^>]*/>\n?'
LEAFLET_JS_PATTERN = r'\s*<script[^>]*leaflet[^>]*\.js[^>]*></script>\n?'

def remove_pattern(content, pattern):
    return re.sub(pattern, '\n', content)

def clean_page(filepath, remove_chart=False, remove_leaflet=False):
    with open(filepath, 'r', encoding='utf-8') as f:
        original = f.read()
    
    content = original
    changes = []

    if remove_chart:
        for p in CHARTJS_PATTERNS:
            new_content = re.sub(p, '\n', content)
            if new_content != content:
                changes.append("Removed Chart.js script")
                content = new_content
                break

    if remove_leaflet:
        new_content = re.sub(LEAFLET_CSS_PATTERN, '\n', content)
        if new_content != content:
            changes.append("Removed Leaflet CSS")
            content = new_content
        
        new_content = re.sub(LEAFLET_JS_PATTERN, '\n', content)
        if new_content != content:
            changes.append("Removed Leaflet JS")
            content = new_content

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  ✅ {os.path.basename(filepath)}: {', '.join(changes)}")
    else:
        print(f"  ℹ️  {os.path.basename(filepath)}: No changes needed")

    return changes

def main():
    print("=== Cleaning up remaining pages ===\n")

    # Warehouse manager pages that load Chart.js but have no <canvas> elements
    # (warehouse_manager.html and warehouse_manager_dash.html DO use Chart.js - skip them)
    # warehouse_manager_drones.html uses Leaflet but not Chart.js
    warehouse_no_chart = [
        "warehouse_manager_audit.html",
        "warehouse_manager_drones.html",    # Has Leaflet but no Chart.js canvas
        "warehouse_manager_fleet.html",
        "warehouse_manager_gate.html",
        "warehouse_manager_leaderboard.html",
        "warehouse_manager_payments.html",
        "warehouse_manager_settings.html",
        "warehouse_manager_shipments.html",
        "warehouse_manager_verifications.html",
    ]

    print("Warehouse manager pages (removing unused Chart.js):")
    for fname in warehouse_no_chart:
        fpath = os.path.join(PAGES_DIR, fname)
        if os.path.exists(fpath):
            clean_page(fpath, remove_chart=True)
        else:
            print(f"  ⚠️  {fname}: File not found")

    print("\nSummary: Cleanup complete!")

if __name__ == "__main__":
    main()
