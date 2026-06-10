from bs4 import BeautifulSoup

html_file = '/Users/adrish/Desktop/Projects/logistix/frontend/pages/manager_analytics.html'

with open(html_file, 'r') as f:
    soup = BeautifulSoup(f, 'html.parser')

bg_blobs = soup.find('div', class_='bg-blobs')
print("--- BG BLOBS ---")
print(str(bg_blobs))

top_bar = soup.find('header', class_='top-bar')
print("\n--- TOP BAR ---")
print(str(top_bar))

