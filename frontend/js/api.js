const API_BASE = "http://localhost:8000/api";

async function apiCall(endpoint, method = "GET", body = null) {
    const options = {
        method,
        headers: {
            "Content-Type": "application/json"
        }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || data.message || "API Error");
        }
        return data;
    } catch (error) {
        console.error("API Call Failed:", error);
        alert(error.message);
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
