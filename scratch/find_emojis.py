import os
import re
import collections

FRONTEND_DIR = '/Users/adrish/Desktop/Projects/logistix/frontend'

def is_emoji(char):
    # Basic emoji ranges
    code = ord(char)
    if 0x1F300 <= code <= 0x1FAFF: return True
    if 0x2600 <= code <= 0x27BF: return True
    return False

emoji_counts = collections.defaultdict(list)

for root, _, files in os.walk(FRONTEND_DIR):
    for file in files:
        if file.endswith('.html'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            for char in content:
                if is_emoji(char):
                    if file not in emoji_counts[char]:
                        emoji_counts[char].append(file)

for emoji, files in emoji_counts.items():
    print(f"Emoji {emoji} found in: {', '.join(files)}")
