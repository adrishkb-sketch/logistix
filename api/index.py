import sys
import os

# Add the current directory to sys.path so we can import 'backend'
path = os.path.dirname(os.path.abspath(__file__))
parent = os.path.dirname(path)
if parent not in sys.path:
    sys.path.insert(0, parent)

from backend.main import app
