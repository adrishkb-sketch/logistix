const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? (window.location.port === '8000' ? "/api" : "http://localhost:8000/api")
    : "/api";

async function apiCall(endpoint, method = "GET", body = null, isSilent = false) {
    // Dynamically retrieve security context (Company ID or Driver ID)
    // Dynamically retrieve security context based on the endpoint type
    let context = "";
    const managerId = localStorage.getItem('manager_id');
    const companyId = localStorage.getItem('company_id') || managerId;
    const driverId = localStorage.getItem('driver_id');
    const trackingToken = localStorage.getItem('tracking_token');

    if (endpoint.includes('/driver/')) {
        context = driverId || companyId || "";
    } else if (endpoint.includes('/manager/') || endpoint.includes('/shipments/')) {
        context = companyId || "";
    } else if (endpoint.includes('/tracking/')) {
        context = trackingToken || driverId || companyId || "";
    } else {
        context = trackingToken || companyId || driverId || "";
    }
    
    // Sanitize to prevent "null" or "undefined" strings in headers/params
    if (context === "null" || context === "undefined") context = "";
    
    if ((!context || context === "") && !endpoint.includes('/auth/')) {
        console.warn("API Call attempted without security context:", endpoint);
        // If we are on a dashboard and lose context, redirect to login
        if (window.location.pathname.includes('/pages/')) {
            window.location.href = '../index.html';
        }
        throw new Error("AUTH_REQUIRED");
    }

    const options = {
        method,
        headers: {
            "Content-Type": "application/json",
            "X-Logistix-Context": context || ""
        }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    let finalUrl = `${API_BASE}${endpoint}`;
    if (method === "GET") {
        const separator = endpoint.includes('?') ? '&' : '?';
        finalUrl = `${finalUrl}${separator}_t=${Date.now()}`;
    }

    try {
        const response = await fetch(finalUrl, options);
        
        // Handle non-JSON responses (like Internal Server Errors from server)
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || data.message || "API Error");
            }
            return data;
        } else {
            const text = await response.text();
            if (!response.ok) {
                throw new Error(text || `Server Error (${response.status})`);
            }
            return text;
        }
    } catch (error) {
        console.error(`API Call Failed [${endpoint}]:`, error);
        if (error.message !== "AUTH_REQUIRED") {
            // Provide a cleaner, more diagnostic alert
            const cleanMsg = error.message.length > 100 ? error.message.substring(0, 100) + "..." : error.message;
            if (!isSilent) alert(`🚨 API Error [${endpoint}]:\n${cleanMsg}`);
        }
        throw error;
    }
}

/**
 * Builds a premium custom audio player element.
 * Replaces the ugly native <audio controls> everywhere in the chat UI.
 * @param {string} src  — base64 or URL audio source
 * @param {string} accentColor — CSS color for the play button bg
 * @returns {HTMLElement}
 */
function buildAudioPlayer(src, accentColor = 'rgba(255,255,255,0.18)') {
    const BAR_COUNT = 18;
    const wrap = document.createElement('div');
    wrap.className = 'custom-audio-player';

    const audio = document.createElement('audio');
    audio.src = src;
    audio.preload = 'metadata';
    wrap.appendChild(audio);

    const playBtn = document.createElement('button');
    playBtn.className = 'audio-play-btn';
    playBtn.style.background = accentColor;
    playBtn.innerHTML = '&#9654;';
    wrap.appendChild(playBtn);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'audio-progress-wrap';

    const waveform = document.createElement('div');
    waveform.className = 'audio-waveform';
    const heights = [8,12,6,16,10,14,7,18,9,13,5,17,11,15,8,12,10,14];
    for (let i = 0; i < BAR_COUNT; i++) {
        const bar = document.createElement('div');
        bar.className = 'audio-bar';
        bar.style.height = (heights[i % heights.length]) + 'px';
        waveform.appendChild(bar);
    }
    progressWrap.appendChild(waveform);

    const track = document.createElement('div');
    track.className = 'audio-progress-track';
    const fill = document.createElement('div');
    fill.className = 'audio-progress-fill';
    fill.style.width = '0%';
    track.appendChild(fill);
    progressWrap.appendChild(track);

    wrap.appendChild(progressWrap);

    const dur = document.createElement('span');
    dur.className = 'audio-duration';
    dur.innerText = '0:00';
    wrap.appendChild(dur);

    function fmt(s) {
        if (!s || isNaN(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + sec.toString().padStart(2, '0');
    }

    function updateBars(pct) {
        const bars = waveform.querySelectorAll('.audio-bar');
        const played = Math.round(pct * BAR_COUNT);
        bars.forEach((b, i) => b.classList.toggle('played', i < played));
    }

    audio.addEventListener('loadedmetadata', () => { dur.innerText = fmt(audio.duration); });

    audio.addEventListener('timeupdate', () => {
        const pct = audio.duration ? audio.currentTime / audio.duration : 0;
        fill.style.width = (pct * 100) + '%';
        dur.innerText = fmt(audio.currentTime);
        updateBars(pct);
    });

    audio.addEventListener('ended', () => {
        playBtn.innerHTML = '&#9654;';
        wrap.classList.remove('playing');
        fill.style.width = '0%';
        updateBars(0);
        dur.innerText = fmt(audio.duration);
    });

    playBtn.addEventListener('click', () => {
        if (audio.paused) {
            document.querySelectorAll('.custom-audio-player audio').forEach(a => {
                if (a !== audio) {
                    a.pause();
                    const pb = a.parentElement.querySelector('.audio-play-btn');
                    if (pb) pb.innerHTML = '&#9654;';
                    a.parentElement.classList.remove('playing');
                }
            });
            audio.play();
            playBtn.innerHTML = '&#9646;&#9646;';
            wrap.classList.add('playing');
        } else {
            audio.pause();
            playBtn.innerHTML = '&#9654;';
            wrap.classList.remove('playing');
        }
    });

    track.addEventListener('click', (e) => {
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (audio.duration) audio.currentTime = pct * audio.duration;
    });

    return wrap;
}

/* ── GLOBAL UI / RESPONSIVE LOGIC ───────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Inject Mobile Header if on a dashboard page and it's missing (Mobile Only)
    const layout = document.querySelector('.dashboard-layout');
    if (layout && !document.querySelector('.mobile-header')) {
        const header = document.createElement('div');
        header.className = 'mobile-header';
        const isRoot = !window.location.pathname.includes('/pages/');
        const logoPathPrefix = isRoot ? '' : '../';
        header.innerHTML = `
            <button class="menu-toggle" id="global-menu-toggle">☰</button>
            <div class="brand-logo" style="width: 100px; height: 30px; cursor: pointer;" onclick="location.href='${logoPathPrefix}index.html'"></div>
            <div id="header-theme-placeholder"></div>
        `;
        document.body.prepend(header);

        // Move theme toggle only on small screens
        const themeBtn = document.getElementById('theme-toggle');
        const placeholder = document.getElementById('header-theme-placeholder');
        
        const syncThemeBtnPosition = () => {
            if (window.innerWidth <= 1024) {
                if (themeBtn && placeholder && themeBtn.parentElement !== placeholder) {
                    placeholder.appendChild(themeBtn);
                }
            } else {
                const topBar = document.querySelector('.top-bar');
                if (themeBtn && topBar && themeBtn.parentElement !== topBar) {
                    topBar.appendChild(themeBtn);
                }
            }
        };

        syncThemeBtnPosition();
        window.addEventListener('resize', syncThemeBtnPosition);
    }

    // 2. Sidebar Toggle Logic
    const toggleBtn = document.getElementById('global-menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    
    if (toggleBtn && sidebar) {
        // Create overlay if not exists
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            document.body.appendChild(overlay);
        }

        const toggleSidebar = () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
            document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
        };

        toggleBtn.addEventListener('click', toggleSidebar);
        overlay.addEventListener('click', toggleSidebar);

        // Close sidebar when clicking links on mobile
        sidebar.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 1024) toggleSidebar();
            });
        });
    }

    // 3. Global Reveal Animation Initializer
    if (typeof revealOnScroll === 'undefined') {
        const reveals = document.querySelectorAll('.reveal');
        const runReveal = () => {
            reveals.forEach(el => {
                const top = el.getBoundingClientRect().top;
                if (top < window.innerHeight - 80) el.classList.add('active');
            });
        };
        window.addEventListener('scroll', runReveal);
        runReveal();
    }
});

/**
 * Standardized Date Formatter for the entire platform.
 * Enforces a consistent 12h format (e.g., 28 APR 2:52 PM).
 */
function formatDate(isoStr) {
    if (!isoStr) return "N/A";
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return "Invalid Date";
        return d.toLocaleString('en-IN', { 
            day: '2-digit', 
            month: 'short', 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true,
            timeZone: 'Asia/Kolkata'
        }).toUpperCase();
    } catch(e) {
        return "Format Error";
    }
}

/**
 * Premium Toast Notification System
 * Displays a non-intrusive message at the bottom of the screen.
 */
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const bg = type === 'error' ? 'rgba(229, 62, 62, 0.9)' : (type === 'success' ? 'rgba(79, 255, 79, 0.9)' : 'rgba(79, 140, 255, 0.9)');
    
    toast.style.cssText = `
        background: ${bg};
        color: #fff;
        padding: 12px 24px;
        border-radius: 50px;
        font-size: 0.9rem;
        font-weight: 700;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,0.1);
        animation: toast-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 10px;
    `;
    
    const icon = type === 'error' ? '🚨' : (type === 'success' ? '✅' : '⏳');
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);

    // Auto-remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'toast-out 0.4s forwards';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// Add CSS for toast animations if not present
if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.innerHTML = `
        @keyframes toast-in {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes toast-out {
            from { opacity: 1; transform: translateY(0); }
            to { opacity: 0; transform: translateY(-20px); }
        }
    `;
    document.head.appendChild(style);
}

window.showToast = showToast;
window.showNotification = showToast;

// ─── Global alert() override — route all bare alert() to branded toasts ───────
(function() {
    const _nativeAlert = window.alert.bind(window);
    window.alert = function(msg) {
        if (typeof showToast === 'function') {
            // Detect severity from message content
            const lower = String(msg).toLowerCase();
            const type = (lower.includes('error') || lower.includes('fail') || lower.includes('invalid') || lower.includes('🚨'))
                ? 'error'
                : (lower.includes('success') || lower.includes('✅') || lower.includes('done') || lower.includes('verified'))
                ? 'success'
                : 'info';
            showToast(String(msg), type);
        } else {
            _nativeAlert(msg);
        }
    };
})();

// ─── Global confirm() override — branded modal with promise ──────────────────
(function() {
    const _nativeConfirm = window.confirm.bind(window);
    window.confirm = function(msg) {
        // If we're in a synchronous context we fall back (rare), else use branded modal
        // For async usage the caller should use window.confirmAsync()
        return _nativeConfirm(msg);
    };

    window.confirmAsync = function(msg, { danger = false } = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(10px);z-index:99998;display:flex;align-items:center;justify-content:center;animation:toast-in 0.25s ease;';
            const accentColor = danger ? '#ef4444' : 'var(--primary)';
            overlay.innerHTML = `
                <div style="background:var(--bg);border:1px solid var(--border);border-top:4px solid ${accentColor};border-radius:20px;padding:28px 32px;max-width:420px;width:94%;box-shadow:0 30px 60px rgba(0,0,0,0.5);animation:modalIn 0.3s cubic-bezier(0.34,1.56,0.64,1);">
                    <div style="font-size:1rem;font-weight:600;color:var(--text);margin-bottom:24px;line-height:1.6;">${msg}</div>
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button id="_confirm-cancel" style="padding:10px 20px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,0.05);color:var(--text);font-weight:700;cursor:pointer;font-size:0.85rem;">Cancel</button>
                        <button id="_confirm-ok" style="padding:10px 22px;border-radius:10px;border:none;background:${accentColor};color:white;font-weight:800;cursor:pointer;font-size:0.85rem;">Confirm</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('#_confirm-ok').onclick = () => { overlay.remove(); resolve(true); };
            overlay.querySelector('#_confirm-cancel').onclick = () => { overlay.remove(); resolve(false); };
            overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        });
    };
})();

/**
 * Global PIN Box Logic
 * Handles auto-focus, backspace, and pasting for .pin-box elements.
 */
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('pin-box')) {
        const val = e.target.value;
        if (val.length >= 1) {
            e.target.value = val.substring(0, 1);
            const next = e.target.nextElementSibling;
            if (next && next.classList.contains('pin-box')) {
                next.focus();
            }
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('pin-box')) {
        if (e.key === 'Backspace' && !e.target.value) {
            const prev = e.target.previousElementSibling;
            if (prev && prev.classList.contains('pin-box')) {
                prev.focus();
            }
        }
    }
});

// Handle pasting into the first PIN box
document.addEventListener('paste', (e) => {
    if (e.target.classList.contains('pin-box')) {
        const pasteData = (e.clipboardData || window.clipboardData).getData('text');
        if (pasteData.length === 6 && /^\d+$/.test(pasteData)) {
            const row = e.target.parentElement;
            const inputs = row.querySelectorAll('.pin-box');
            if (inputs.length === 6) {
                inputs.forEach((input, i) => {
                    input.value = pasteData[i];
                });
                inputs[5].focus();
                e.preventDefault();
            }
        }
    }
})


// ─── Gemini AI Status & Button Gating (Global) ───────────────────────────────

/**
 * Global AI status cache. Populated on first call and refreshed periodically.
 * { configured: bool, status: str, key_count: int }
 */
window._aiStatus = { configured: false, status: 'Not Configured 🔴', key_count: 0 };
window._aiStatusChecked = false;

/**
 * Fetch AI status from the backend (manager or driver endpoint).
 * Returns the status object.
 */
async function fetchAIStatus() {
    try {
        // Determine which endpoint to use based on page type
        const pathname = window.location.pathname;
        let endpoint = '/manager/ai/status';
        if (pathname.includes('/driver') && !pathname.includes('/manager')) {
            endpoint = '/driver/ai/status';
        } else if (pathname.includes('/warehouse_manager')) {
            endpoint = '/manager/ai/status'; // WH managers share company config
        }
        const res = await apiCall(endpoint, 'GET', null, true);
        window._aiStatus = res;
        window._aiStatusChecked = true;
        return res;
    } catch (e) {
        console.warn('[AI Status] Could not fetch AI status:', e.message);
        window._aiStatus = { configured: false, status: 'Not Configured 🔴', key_count: 0 };
        window._aiStatusChecked = true;
        return window._aiStatus;
    }
}

/**
 * Apply blur + disabled state to all elements with class .ai-gated-btn
 * based on current AI status. Call after page load and after status changes.
 */
function enforceAIButtonState(configured) {
    const btns = document.querySelectorAll('.ai-gated-btn');
    btns.forEach(btn => {
        if (configured) {
            btn.disabled = false;
            btn.style.filter = 'none';
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            btn.style.cursor = 'pointer';
            btn.title = '';
        } else {
            btn.disabled = true;
            btn.style.filter = 'blur(2px) grayscale(0.8)';
            btn.style.opacity = '0.45';
            btn.style.pointerEvents = 'none';
            btn.style.cursor = 'not-allowed';
            btn.title = '⚠️ Add Gemini API keys in System Settings to enable AI features';
        }
    });
}

/**
 * Inject a small AI status pill into the top-bar area (only on manager/driver pages).
 */
function injectAIStatusWidget(status) {
    // Don't inject on system settings page (redundant)
    if (window.location.pathname.includes('manager_system')) return;

    let pill = document.getElementById('ai-status-pill');
    if (!pill) {
        pill = document.createElement('span');
        pill.id = 'ai-status-pill';
        pill.style.cssText = `
            font-size: 0.7rem; font-weight: 800; padding: 4px 12px; border-radius: 20px;
            cursor: default; white-space: nowrap; transition: all 0.3s ease;
            display: inline-flex; align-items: center; gap: 5px;
        `;
        // Try injecting into top-bar
        const topBar = document.querySelector('.top-bar');
        if (topBar) {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display:flex; align-items:center; gap:6px;';
            wrapper.appendChild(pill);
            // Insert before theme-toggle or at end
            const themeToggle = topBar.querySelector('#theme-toggle');
            if (themeToggle) {
                topBar.insertBefore(wrapper, themeToggle);
            } else {
                topBar.appendChild(wrapper);
            }
        }
    }

    if (status.configured) {
        pill.textContent = `🟢 AI (${status.key_count})`;
        pill.style.background = 'rgba(16,185,129,0.15)';
        pill.style.color = '#34d399';
        pill.style.border = '1px solid rgba(52,211,153,0.3)';
        pill.title = `Gemini AI: ${status.key_count} key(s) active`;
    } else {
        pill.textContent = '🔴 AI Inactive';
        pill.style.background = 'rgba(255,70,70,0.1)';
        pill.style.color = '#f87171';
        pill.style.border = '1px solid rgba(248,113,113,0.3)';
        pill.title = 'No Gemini API keys configured. Go to System Settings to add.';
        pill.onclick = () => {
            const href = window.location.pathname.includes('/pages/')
                ? 'manager_system.html'
                : 'pages/manager_system.html';
            window.location.href = href;
        };
        pill.style.cursor = 'pointer';
    }
}

/**
 * Main initializer. Call this from each page's initPage() to enforce AI state.
 */
async function initAIGating() {
    const status = await fetchAIStatus();
    enforceAIButtonState(status.configured);
    injectAIStatusWidget(status);

    // Poll for changes (e.g., if the manager opens settings in another tab)
    setInterval(async () => {
        const ts = localStorage.getItem('ai_configured_ts');
        if (ts !== window._lastAITs) {
            window._lastAITs = ts;
            const fresh = await fetchAIStatus();
            enforceAIButtonState(fresh.configured);
            injectAIStatusWidget(fresh);
        }
    }, 5000);

    return status;
}

/**
 * Legacy stub kept for backwards compatibility.
 * Old code called ensureGeminiApiKey() before AI calls.
 */
function ensureGeminiApiKey() {
    return Promise.resolve(window._aiStatus?.configured ? 'configured' : '');
}

window.ensureGeminiApiKey = ensureGeminiApiKey;
window.initAIGating = initAIGating;
window.enforceAIButtonState = enforceAIButtonState;
window.fetchAIStatus = fetchAIStatus;
window.parseMarkdownToHtml = parseMarkdownToHtml;


function parseMarkdownToHtml(text) {
    if (!text) return '';
    let formatted = text.trim();

    // Escape raw HTML tags to prevent injections (except emojis and tags we generate)
    formatted = formatted
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Replace headers: ### text -> <h4 style="...">text</h4>
    formatted = formatted.replace(/^###\s(.*)/gm, '<h4 style="color:var(--accent); margin: 18px 0 8px 0; font-weight:800; font-size:1.05rem;">$1</h4>');
    formatted = formatted.replace(/^##\s(.*)/gm, '<h3 style="color:var(--primary); margin: 24px 0 12px 0; font-weight:800; font-size:1.2rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 6px;">$1</h3>');
    formatted = formatted.replace(/^#\s(.*)/gm, '<h2 style="color:var(--text); margin: 28px 0 16px 0; font-weight:800; font-size:1.4rem;">$1</h2>');

    // Replace bold text **text** -> <strong>text</strong>
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong style="color:white; font-weight:800;">$1</strong>');

    // Replace bullet points: * text or - text -> <li style="...">text</li>
    formatted = formatted.replace(/^\s*[\*\-]\s(.*)/gm, '<li style="margin-left: 15px; margin-bottom: 6px; list-style-type: disc; color:var(--text);">$1</li>');

    // Convert newlines to breaks
    formatted = formatted.replace(/\n/g, '<br>');

    // Clean up consecutive breaks around lists and headers
    formatted = formatted.replace(/(<br>\s*)+<li/g, '<li');
    formatted = formatted.replace(/<\/li>\s*(<br>\s*)+/g, '</li>');
    formatted = formatted.replace(/(<br>\s*)+<h/g, '<h');
    formatted = formatted.replace(/<\/h4>\s*(<br>\s*)+/g, '</h4>');
    formatted = formatted.replace(/<\/h3>\s*(<br>\s*)+/g, '</h3>');
    
    return formatted;
}

window.ensureGeminiApiKey = ensureGeminiApiKey;
window.parseMarkdownToHtml = parseMarkdownToHtml;

