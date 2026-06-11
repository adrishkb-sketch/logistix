import os

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    original = content
    
    # The broken string is literally "mCtx.beginPath();\n                mCtx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);\n                mCtx.fill();"
    # We need to replace the literal backslash-n with an actual newline.
    broken_str = "mCtx.beginPath();\\n                mCtx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);\\n                mCtx.fill();"
    fixed_str = "mCtx.beginPath();\n            mCtx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);\n            mCtx.fill();"
    
    content = content.replace(broken_str, fixed_str)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Fixed syntax in {filepath}")

for root, _, files in os.walk("frontend"):
    for file in files:
        if file.endswith(".html") or file.endswith(".js"):
            process_file(os.path.join(root, file))

print("Done.")
