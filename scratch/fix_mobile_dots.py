import os

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    original = content
    
    # 1. Fix mCtx to use small circles instead of rects
    old_mctx = "mCtx.fillRect(p.x, p.y, 2.5, 2.5);"
    new_mctx = "mCtx.beginPath();\\n                mCtx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);\\n                mCtx.fill();"
    content = content.replace(old_mctx, new_mctx)
    
    # 2. Increase dot density (closer spacing)
    old_spacing = "const spacing = window.innerWidth < 768 ? 35 : 30;"
    new_spacing = "const spacing = window.innerWidth < 768 ? 16 : 24;"
    content = content.replace(old_spacing, new_spacing)
    
    # 3. Disable duplicate loop in premium_theme.js
    if "premium_theme.js" in filepath:
        content = content.replace("initGrids(); animateGrids();", "// initGrids(); animateGrids(); // Disabled to prevent duplicate loop fighting")

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Updated {filepath}")

for root, _, files in os.walk("frontend"):
    for file in files:
        if file.endswith(".html") or file.endswith(".js"):
            process_file(os.path.join(root, file))

print("Fix complete.")
