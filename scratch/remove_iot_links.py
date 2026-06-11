import os
import re

directory = 'frontend/pages'

for filename in os.listdir(directory):
    if filename.endswith(".html"):
        filepath = os.path.join(directory, filename)
        with open(filepath, 'r') as f:
            content = f.read()

        # The link might look like:
        # <a class="nav-link" href="iot_sandbox.html" style="color: #10b981;">
        # ...
        # </a>
        
        # Or <a class="nav-link-v3" href="iot_sandbox.html" ... > ... </a>
        
        # We can just remove lines containing iot_sandbox.html and the subsequent SVG path lines if any,
        # but regex is safer for block removal:
        pattern = re.compile(r'<a[^>]*href="iot_sandbox\.html"[^>]*>.*?</a>', re.DOTALL)
        
        # Also need to remove the list item wrapper if it exists `<li><a...</a></li>`
        pattern_li = re.compile(r'<li[^>]*>\s*<a[^>]*href="iot_sandbox\.html"[^>]*>.*?</a>\s*</li>', re.DOTALL)

        new_content = pattern_li.sub('', content)
        new_content = pattern.sub('', new_content)

        if new_content != content:
            with open(filepath, 'w') as f:
                f.write(new_content)
            print(f"Removed IoT link from {filename}")
