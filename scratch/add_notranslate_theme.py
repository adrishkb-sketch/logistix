import os
import re

frontend_dir = "/Users/adrish/Desktop/Projects/logistix/frontend"

# Walk through all HTML files
for root, dirs, files in os.walk(frontend_dir):
    for file in files:
        if file.endswith(".html"):
            file_path = os.path.join(root, file)
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            original_content = content
            
            # Pattern 1: Elements with class and id="theme-toggle"
            # e.g., <div class="theme-switch" id="theme-toggle" ...> or <button class="theme-switch" id="theme-toggle" ...>
            # We want to insert "notranslate" into the class attribute.
            
            # Let's use a regex that matches the opening tag of any element with id="theme-toggle"
            # and extracts its class attribute if present.
            
            def add_notranslate(match):
                tag_content = match.group(0)
                # Check if it already has notranslate
                if "notranslate" in tag_content:
                    return tag_content
                
                # Check if class attribute exists
                class_match = re.search(r'class=["\']([^"\']+)["\']', tag_content)
                if class_match:
                    # Append notranslate to existing classes
                    old_class = class_match.group(1)
                    new_class = f"{old_class} notranslate"
                    # Replace only the class attribute part
                    return tag_content.replace(class_match.group(0), f'class="{new_class}"')
                else:
                    # Insert class="notranslate" before the first closing angle bracket or after the tag name
                    # Let's insert it before id="theme-toggle" or just at the end of tag attributes
                    # For simplicity, insert it right before the closing > or />
                    if tag_content.endswith("/>"):
                        return tag_content[:-2] + ' class="notranslate"/>'
                    elif tag_content.endswith(">"):
                        return tag_content[:-1] + ' class="notranslate">'
                return tag_content

            # Match any HTML opening tag containing id="theme-toggle" or id='theme-toggle'
            # e.g., <div ... id="theme-toggle" ...>
            # We use an regex that matches '<' followed by tag name, then any attributes, id="theme-toggle", any attributes, and then '>'
            pattern = re.compile(r'<[a-zA-Z0-9]+(?:\s+[^>]*?id=["\']theme-toggle["\'][^>]*?)(?:/?>|>)')
            
            updated_content = pattern.sub(add_notranslate, content)
            
            if updated_content != original_content:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(updated_content)
                print(f"Updated: {file_path}")

print("Done scanning and updating HTML files.")
