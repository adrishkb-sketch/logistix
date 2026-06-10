import os
import re

js_dir = '/Users/adrish/Desktop/Projects/logistix/frontend/js'
pages_dir = '/Users/adrish/Desktop/Projects/logistix/frontend/pages'

js_files = [f for f in os.listdir(js_dir) if f.startswith('manager_') and f.endswith('.js')]
html_files = [f for f in os.listdir(pages_dir) if f.startswith('manager_') and f.endswith('.html')]

# We will check each JS file for references to Leaflet (L.), Chart.js (new Chart), and QRCode (new QRCode)
# We will also check inline scripts in the HTML files.
def analyze_content(js_content, html_content):
    uses_leaflet = 'L.' in js_content or 'L.map' in js_content or 'L.' in html_content or 'L.map' in html_content
    uses_leaflet_draw = 'leaflet.draw' in js_content.lower() or 'draw' in js_content.lower() or 'leaflet.draw' in html_content.lower() or 'drawcontrol' in html_content.lower() or 'drawcontrol' in js_content.lower()
    uses_qrcode = 'qrcode' in js_content.lower() or 'qrcode' in html_content.lower()
    uses_chart = 'new chart(' in js_content.lower() or 'chart.js' in js_content.lower() or 'new chart(' in html_content.lower()
    
    return {
        "leaflet": uses_leaflet,
        "leaflet_draw": uses_leaflet_draw,
        "qrcode": uses_qrcode,
        "chart": uses_chart
    }

print("Library Usage Analysis:")
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
            
    analysis = analyze_content(js_content, html_content)
    print(f"{html_file}: JS exists={os.path.exists(js_path)}, {analysis}")
