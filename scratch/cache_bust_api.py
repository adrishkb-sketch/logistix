import os
import glob
import re

html_files = glob.glob('/Users/adrish/Desktop/Projects/logistix/frontend/pages/*.html')

# 1. Remove weather map injection logic from manager_weather.html
weather_file = '/Users/adrish/Desktop/Projects/logistix/frontend/pages/manager_weather.html'
with open(weather_file, 'r') as f:
    w_content = f.read()

pattern = r"    // Inject mobile header.*?syncPos\(\);\n"
w_content_new = re.sub(pattern, "", w_content, flags=re.DOTALL)
if w_content_new != w_content:
    with open(weather_file, 'w') as f:
        f.write(w_content_new)
    print("Removed redundant logic from manager_weather.html")

# 2. Bump api.js version in all HTML files
for file in html_files:
    with open(file, 'r') as f:
        content = f.read()
    
    # Simple replace
    new_content = re.sub(r'src="\.\./js/api\.js\?v=2\.[0-9]+"', 'src="../js/api.js?v=2.3"', content)
    new_content = new_content.replace('src="../js/api.js"', 'src="../js/api.js?v=2.3"')
    
    if new_content != content:
        with open(file, 'w') as f:
            f.write(new_content)

print("Bumped api.js to v=2.3 in all pages to bust cache.")
