with open('frontend/pages/driver_live.html', 'r') as f:
    content = f.read()
    import re
    scripts = re.findall(r'<script.*?src=["\'](.*?)["\'].*?>', content)
    print("driver_live.html scripts:", scripts)

with open('frontend/pages/driver_dashboard.html', 'r') as f:
    content = f.read()
    scripts = re.findall(r'<script.*?src=["\'](.*?)["\'].*?>', content)
    print("driver_dashboard.html scripts:", scripts)
