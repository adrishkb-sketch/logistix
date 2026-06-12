import glob
import os

for path in glob.glob('frontend/js/hub_manager_*.js'):
    with open(path, 'r') as f:
        content = f.read()
    
    # Replace warehouse_manager_ with hub_manager_
    content = content.replace("'warehouse_manager_", "'hub_manager_")
    
    # Replace hub_manager_dash with hub_manager_dashboard
    content = content.replace("'hub_manager_dash'", "'hub_manager_dashboard'")
    
    with open(path, 'w') as f:
        f.write(content)
print("Fixed JS files.")
