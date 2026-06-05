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
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        
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
            hour12: true 
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
});
