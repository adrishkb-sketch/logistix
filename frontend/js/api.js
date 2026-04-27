const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? (window.location.port === '8000' ? "/api" : "http://localhost:8000/api")
    : "/api";

async function apiCall(endpoint, method = "GET", body = null) {
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
        context = companyId || driverId || trackingToken || "";
    }
    
    if ((!context || context === "null") && !endpoint.includes('/auth/')) {
        console.warn("API Call attempted without security context:", endpoint);
        // If we are on a dashboard and lose context, redirect to login
        if (window.location.pathname.includes('/pages/')) {
            window.location.href = '../index.html';
        }
        throw new Error("AUTH_REQUIRED");
    }
    
    // Final sanitization to prevent "null" strings in headers/params
    if (context === "null") context = "";

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
            alert(`🚨 API Error [${endpoint}]:\n${cleanMsg}`);
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
        header.innerHTML = `
            <button class="menu-toggle" id="global-menu-toggle">☰</button>
            <div style="font-weight:800; font-size:1.1rem;">Logistix</div>
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
