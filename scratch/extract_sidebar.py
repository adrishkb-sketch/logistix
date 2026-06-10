from bs4 import BeautifulSoup
with open('/Users/adrish/Desktop/Projects/logistix/frontend/pages/manager_analytics.html', 'r') as f:
    soup = BeautifulSoup(f, 'html.parser')
print(str(soup.find('aside', class_='sidebar')))
