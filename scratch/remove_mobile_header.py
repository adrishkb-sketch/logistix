import re

file_path = '/Users/adrish/Desktop/Projects/logistix/frontend/js/api.js'

with open(file_path, 'r') as f:
    content = f.read()

# Use regex to remove the mobile header injection block
pattern = r"// 1\. Inject Mobile Header.*?window\.addEventListener\('resize', syncThemeBtnPosition\);\n    \}"
new_content = re.sub(pattern, "", content, flags=re.DOTALL)

with open(file_path, 'w') as f:
    f.write(new_content)

print("Removed mobile header injection from api.js")
