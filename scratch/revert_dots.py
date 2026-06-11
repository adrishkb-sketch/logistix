import os

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    original = content
    
    # Revert mCtx
    old_mctx = "mCtx.beginPath();\\n                    mCtx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);\\n                    mCtx.fill();"
    content = content.replace(old_mctx, "mCtx.fillRect(p.x, p.y, 2.5, 2.5);")
    
    # Revert fCtx
    old_fctx = "fCtx.beginPath();\\n                fCtx.arc(p.x, p.y, 2, 0, Math.PI * 2);\\n                fCtx.fill();"
    content = content.replace(old_fctx, "fCtx.fillRect(p.x, p.y, 4, 4);")
    
    # Revert spacing
    content = content.replace("const spacing = window.innerWidth < 768 ? 15 : 20;", "const spacing = window.innerWidth < 768 ? 35 : 30;")

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Reverted dots in {filepath}")

for root, _, files in os.walk("frontend"):
    for file in files:
        if file.endswith(".html") or file.endswith(".js"):
            process_file(os.path.join(root, file))

print("Revert complete.")
