#!/usr/bin/env python3
"""Final verification: Check for any remaining unnecessary library loads across all pages."""
import os, re

PAGES_DIR = "/Users/adrish/Desktop/Projects/logistix/frontend/pages"

pages = sorted([f for f in os.listdir(PAGES_DIR) if f.endswith('.html')])

print("=== FINAL LIBRARY USAGE SUMMARY ===\n")
print(f"{'Page':<45} {'Leaflet':<10} {'LeafDraw':<10} {'Chart.js':<10} {'QRCode':<10}")
print("-" * 90)

for fname in pages:
    fpath = os.path.join(PAGES_DIR, fname)
    content = open(fpath).read()
    has_leaflet = bool(re.search(r'leaflet\.js', content, re.I))
    has_leaflet_draw = bool(re.search(r'leaflet\.draw', content, re.I))
    has_chart = bool(re.search(r'chart\.js', content, re.I))
    has_qrcode = bool(re.search(r'qrcode', content, re.I))
    
    # Check actual usage
    uses_leaflet = bool(re.search(r'L\.map\(', content))
    uses_chart = bool(re.search(r'new Chart\(', content))
    uses_qrcode = bool(re.search(r'new QRCode\(', content))
    
    def flag(has, uses):
        if has and uses: return "✅ used"
        if has and not uses: return "⚠️ unused"
        return "—"
    
    print(f"{fname:<45} {flag(has_leaflet, uses_leaflet):<15} {flag(has_leaflet_draw, uses_leaflet):<15} {flag(has_chart, uses_chart):<15} {flag(has_qrcode, uses_qrcode):<15}")

