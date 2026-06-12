from bs4 import BeautifulSoup
import sys

try:
    with open('frontend/pages/executive_weather.html', 'r') as f:
        html = f.read()
    soup = BeautifulSoup(html, 'html.parser')
    with open('scratch/temp.js', 'w') as f:
        for script in soup.find_all('script'):
            if not script.get('src'):
                f.write(script.string + '\n')
except Exception as e:
    print(e)
