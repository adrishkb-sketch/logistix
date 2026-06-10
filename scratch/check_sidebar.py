import os
from bs4 import BeautifulSoup

def print_sidebar_links(filepath):
    print(f"\n--- {os.path.basename(filepath)} ---")
    with open(filepath, 'r') as f:
        html = f.read()
    soup = BeautifulSoup(html, 'html.parser')
    sidebar = soup.find('aside', class_='sidebar')
    if sidebar:
        links = sidebar.find_all('a', class_='nav-link')
        for link in links:
            text = link.get_text(strip=True)
            print(text)

print_sidebar_links('/Users/adrish/Desktop/Projects/logistix/frontend/pages/manager_shipments.html')
print_sidebar_links('/Users/adrish/Desktop/Projects/logistix/frontend/pages/warehouse_manager.html')
print_sidebar_links('/Users/adrish/Desktop/Projects/logistix/frontend/pages/driver.html')
