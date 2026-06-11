import re

with open('frontend/index.html', 'r') as f:
    content = f.read()

# Emojis to SVGs mapping
replacements = {
    '<span style="font-size: 2rem;">🥶</span>': '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5l-5 5M17 19l-5-5M7 5l5 5M7 19l5-5M2 12h20"></path></svg>',
    '<span style="font-size: 2rem;">👁️</span>': '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    '<span style="font-size: 2rem;">⚖️</span>': '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"></path><rect x="3" y="11" width="18" height="2" rx="1"></rect><path d="M6 13v4a2 2 0 0 0 4 0v-4"></path><path d="M14 13v4a2 2 0 0 0 4 0v-4"></path></svg>',
    '<span style="font-size: 2rem;">🚁</span>': '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M2 7h20M7 7l-2 5h14l-2-5M12 12v3M9 15h6M9 15l-1 5M15 15l1 5M5 20h14"></path></svg>',
    '<span style="font-size: 2rem;">📦</span>': '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z"></path><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"></path></svg>',
    '<span style="font-size: 2rem;">💥</span>': '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>'
}

for old, new in replacements.items():
    content = content.replace(old, new)

with open('frontend/index.html', 'w') as f:
    f.write(content)

print("Replaced emojis with SVGs.")
