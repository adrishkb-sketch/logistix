import os

JS_PATH = '/Users/adrish/Desktop/Projects/logistix/frontend/js/premium_theme.js'
CSS_PATH = '/Users/adrish/Desktop/Projects/logistix/frontend/css/premium_theme.css'

# 1. Update JS to handle spaces better for text wrapping
with open(JS_PATH, 'r') as f:
    js_content = f.read()

# Replace innerText with innerHTML and handle spaces
js_content = js_content.replace("span.innerText = char;", "span.innerHTML = char === ' ' ? '&nbsp;' : char;")
with open(JS_PATH, 'w') as f:
    f.write(js_content)

# 2. Update CSS for mobile layout, wrap fixes, and better buttons
with open(CSS_PATH, 'a') as f:
    f.write("""

/* --- GLOBAL UI FIXES --- */

/* 1. Global Font Enforce */
body, h1, h2, h3, h4, h5, p, span, div, input, button {
    font-family: 'Outfit', sans-serif !important;
}

/* 2. Text Spread Fix for split-text */
.split-text {
    display: inline-flex !important;
    flex-wrap: wrap !important;
    max-width: 100%;
}
.split-text .char {
    white-space: normal !important; /* Allow normal wrapping */
}

/* 3. Button Enhancements */
.btn-primary {
    background: linear-gradient(135deg, var(--primary), var(--accent-1)) !important;
    color: white !important;
    border: none !important;
    box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3) !important;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
}
.btn-primary:hover {
    transform: translateY(-2px) scale(1.02) !important;
    box-shadow: 0 8px 25px rgba(99, 102, 241, 0.5) !important;
}

.btn-outline, .btn-outline-v3, .btn-purple-outline {
    background: rgba(255, 255, 255, 0.05) !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    color: var(--text) !important;
    backdrop-filter: blur(10px) !important;
    transition: all 0.3s ease !important;
}
.btn-outline:hover, .btn-outline-v3:hover, .btn-purple-outline:hover {
    background: rgba(255, 255, 255, 0.1) !important;
    border-color: var(--primary) !important;
    transform: translateY(-2px) !important;
}

/* 4. Hide Modify Dashboard Consistently */
#modify-dash-btn {
    display: none !important;
}

/* 5. Mobile Layout Fixes (Stop overflow and boxes moving out) */
@media (max-width: 768px) {
    .dashboard-layout {
        overflow-x: hidden;
        width: 100vw;
    }
    
    .top-bar {
        flex-direction: column !important;
        align-items: flex-start !important;
        gap: 12px !important;
        padding: 15px !important;
    }
    
    .top-actions {
        width: 100% !important;
        flex-wrap: wrap !important;
        justify-content: flex-start !important;
        gap: 8px !important;
    }
    
    .top-actions button, .top-actions .lang-card-v3 {
        flex: 1 1 auto;
        min-width: 45%;
        text-align: center;
        justify-content: center;
    }

    /* Hide ugly mobile menubar options requested by user */
    .mobile-nav-toggle, .mobile-header-logo {
        display: none !important;
    }

    /* Fix table containers extending out of screen */
    .table-container {
        width: 100% !important;
        max-width: 100vw !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch;
        margin: 0 !important;
        border-radius: 8px !important;
    }
    
    .glass-card {
        padding: 15px !important;
        margin-bottom: 15px !important;
        width: 100% !important;
        box-sizing: border-box !important;
    }
}

/* 6. Contrast Fixes */
body.light-mode .glass-card {
    background: rgba(255, 255, 255, 0.7) !important;
    color: #1a1a2e !important;
    border: 1px solid rgba(0, 0, 0, 0.1) !important;
}
body.light-mode h1, body.light-mode h2, body.light-mode h3, body.light-mode .text-muted {
    color: #1a1a2e !important;
}
body.light-mode .text-muted {
    color: #4a5568 !important;
}
body.light-mode .btn-outline, body.light-mode .btn-outline-v3 {
    color: #1a1a2e !important;
    border-color: rgba(0, 0, 0, 0.2) !important;
}
""")
print("UI fixes applied to JS and CSS.")
