import os

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    original = content
    
    # 1. Fix mCtx.fillRect
    content = content.replace("mCtx.fillRect(p.x, p.y, 2.5, 2.5);", "mCtx.beginPath();\\n                    mCtx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);\\n                    mCtx.fill();")
    
    # 2. Fix fCtx.fillRect
    content = content.replace("fCtx.fillRect(p.x, p.y, 4, 4);", "fCtx.beginPath();\\n                fCtx.arc(p.x, p.y, 2, 0, Math.PI * 2);\\n                fCtx.fill();")
    
    # 3. Increase dot density
    content = content.replace("const spacing = window.innerWidth < 768 ? 35 : 30;", "const spacing = window.innerWidth < 768 ? 15 : 20;")

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Updated {filepath}")

for root, _, files in os.walk("frontend"):
    for file in files:
        if file.endswith(".html") or file.endswith(".js"):
            process_file(os.path.join(root, file))

print("Done.")
