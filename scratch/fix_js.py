import os

file_path = "frontend/js/manager_shipments.js"
with open(file_path, "r") as f:
    content = f.read()

# Fix the escaped backticks and dollar signs from the previous script injection
content = content.replace("\\`", "`")
content = content.replace("\\$", "$")

with open(file_path, "w") as f:
    f.write(content)
