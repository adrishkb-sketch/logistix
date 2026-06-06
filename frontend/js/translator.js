/**
 * Logistix Real-Time Translator
 * 
 * Replaces the 14,000-line manual translations.js with Google Translate's
 * free browser widget. Translates the entire DOM in real-time.
 * 
 * - No API key required
 * - Supports 100+ languages
 * - Automatically handles dynamically injected content via observer
 * - Preserves Automated Controls / Voice section via .notranslate class
 */

(function () {
    'use strict';

    // Load English translations dictionary for getTranslation shim
    let enTranslations = {};
    const isRootFolder = !window.location.pathname.includes('/pages/');
    const pathPrefix = isRootFolder ? '' : '../';
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', `${pathPrefix}js/en.json`, false);
        xhr.send(null);
        if (xhr.status === 200) {
            enTranslations = JSON.parse(xhr.responseText);
        }
    } catch (e) {
        console.warn("Failed to load en.json synchronously, falling back to async fetch", e);
    }
    if (Object.keys(enTranslations).length === 0) {
        fetch(`${pathPrefix}js/en.json`)
            .then(res => res.json())
            .then(data => { enTranslations = data; })
            .catch(err => console.error("Async load of en.json failed", err));
    }

    // ── Google Translate language code map ──────────────────────────────────
    // Maps our internal app_lang codes to Google Translate codes
    const LANG_MAP = {
        'en':  'en',
        'hi':  'hi',
        'bn':  'bn',
        'te':  'te',
        'mr':  'mr',
        'ta':  'ta',
        'gu':  'gu',
        'kn':  'kn',
        'or':  'or',
        'ml':  'ml',
        'pa':  'pa',
        'as':  'as',
        'mai': 'mai',
        'sat': 'sat',
        'ks':  'ur',    // Kashmiri — closest Google supports
        'ur':  'ur',
        'ne':  'ne',
        'sa':  'sa',
        'sd':  'sd',
        'gom': 'gom',
        'doi': 'doi',
        'mni': 'mni-Mtei',
        'fr':  'fr',
        'de':  'de',
        'es':  'es',
        'zh':  'zh-CN',
        'ar':  'ar',
        'ja':  'ja',
        'ko':  'ko',
        'ru':  'ru',
        'pt':  'pt',
    };

    // ── Inject Google Translate widget script ───────────────────────────────
    window.googleTranslateElementInit = function () {
        new window.google.translate.TranslateElement(
            {
                pageLanguage: 'en',
                autoDisplay: false,       // we control display ourselves
                includedLanguages: Object.values(LANG_MAP).join(','),
            },
            'google_translate_element'
        );
        // Restore saved language after widget initialises
        const saved = localStorage.getItem('app_lang') || 'en';
        if (saved && saved !== 'en') {
            setTimeout(() => _applyGoogleTranslate(saved), 800);
        }
    };

    function _loadGoogleScript() {
        if (document.getElementById('gt-script')) return;
        const s = document.createElement('script');
        s.id  = 'gt-script';
        s.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
        s.async = true;
        document.head.appendChild(s);
    }

    // ── Inject hidden container for the widget ──────────────────────────────
    function _ensureContainer() {
        if (document.getElementById('google_translate_element')) return;
        const d = document.createElement('div');
        d.id = 'google_translate_element';
        d.style.cssText = 'position:absolute;top:-9999px;left:-9999px;visibility:hidden;';
        document.body.appendChild(d);
    }

    // ── Apply translation by programmatically selecting from the widget ──────
    function _applyGoogleTranslate(appLang) {
        const gtCode = LANG_MAP[appLang] || appLang;
        if (gtCode === 'en') {
            // Restore to English: clear the Google Translate cookie
            _restoreEnglish();
            return;
        }
        // Poll until the select element is ready
        let attempts = 0;
        const poll = setInterval(() => {
            const sel = document.querySelector('.goog-te-combo');
            if (sel) {
                clearInterval(poll);
                sel.value = gtCode;
                sel.dispatchEvent(new Event('change'));
            } else if (++attempts > 30) {
                clearInterval(poll);
            }
        }, 200);
    }

    function _restoreEnglish() {
        // Remove the Google Translate cookie to revert to source language
        document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=' + location.hostname;
        const iframe = document.getElementById(':1.container');
        if (iframe) {
            try {
                const restore = iframe.contentWindow.document.querySelector('.goog-close-link');
                if (restore) restore.click();
            } catch (e) {}
        }
        // Fallback: reload page without the translation overlay
        location.reload();
    }

    // ── Hide Google Translate toolbar (keep translation, hide the bar) ───────
    function _hideToolbar() {
        if (document.getElementById('gt-hide-style')) return;
        const style = document.createElement('style');
        style.id = 'gt-hide-style';
        style.textContent = `
            /* Hide Google Translate toolbar */
            .goog-te-banner-frame, #goog-gt-tt,
            .skiptranslate { display: none !important; }
            body { top: 0 !important; }
            /* Ensure notranslate elements are truly skipped */
            .notranslate { translate: no; }
        `;
        document.head.appendChild(style);
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * setLanguage — called by the existing language picker <select> elements.
     * Saves preference to localStorage and applies Google Translate.
     */
    window.setLanguage = function (lang) {
        localStorage.setItem('app_lang', lang);
        _applyGoogleTranslate(lang);
        // Sync voice engine language if active
        if (window.logistixVoice && typeof window.logistixVoice.updateLanguage === 'function') {
            window.logistixVoice.updateLanguage();
        }
        // Refresh data if applicable (preserve existing behaviour)
        if (typeof loadShipments  === 'function') loadShipments();
        if (typeof loadMissions   === 'function') loadMissions();
    };
    window.changeLanguage = window.setLanguage;

    /**
     * getTranslation — compatibility shim so any remaining JS calls don't break.
     * Returns the English key text as-is; Google Translate handles rendering.
     */
    window.getTranslation = function (key) {
        return enTranslations[key] || key;
    };

    /**
     * updatePageTranslations — compatibility shim (was called after language change).
     * With Google Translate this is a no-op; the widget handles everything.
     */
    window.updatePageTranslations = function () {};

    // ── Branding logo injection (preserved from old translations.js) ─────────
    window.injectBrandingLogo = function () {
        const isRoot = !window.location.pathname.includes('/pages/');
        const p = isRoot ? '' : '../';

        if (!document.getElementById('dynamic-branding-style')) {
            const style = document.createElement('style');
            style.id = 'dynamic-branding-style';
            style.textContent = `
                .brand-logo {
                    display: inline-block;
                    background-image: url('${p}logo_dark.png') !important;
                    background-size: contain;
                    background-position: left center;
                    background-repeat: no-repeat;
                    width: 100%; height: 100%;
                    transition: background-image 0.3s cubic-bezier(0.4,0,0.2,1);
                }
                body.light-mode .brand-logo {
                    background-image: url('${p}logo_light.png') !important;
                }
            `;
            document.head.appendChild(style);
        }

        // Favicon
        let fav = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
        if (!fav) {
            fav = document.createElement('link');
            fav.rel = 'icon'; fav.type = 'image/png';
            document.head.appendChild(fav);
        }
        fav.href = `${p}favicon.png`;

        // Sidebar header (manager pages)
        document.querySelectorAll('.sidebar-header').forEach(h => {
            h.innerHTML = `<div class="brand-logo" onclick="location.href='${p}index.html'" style="cursor:pointer;width:100%;height:50px;max-width:200px;margin:0 auto;display:block;"></div>`;
        });

        // Sidebar logo (warehouse manager)
        document.querySelectorAll('.sidebar-logo').forEach(logo => {
            logo.innerHTML = '';
            logo.className = 'sidebar-logo-container';
            logo.style.padding = '20px 0';
            const d = document.createElement('div');
            d.className = 'brand-logo';
            d.style.cssText = 'width:100%;height:45px;max-width:180px;margin:0 auto;display:block;cursor:pointer;';
            d.onclick = () => { location.href = `${p}index.html`; };
            logo.appendChild(d);
        });

        // Driver top bar
        document.querySelectorAll('.driver-layout .top-bar h2').forEach(h2 => {
            h2.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
            h2.innerHTML = `
                <div class="brand-logo" onclick="location.href='${p}index.html'" style="cursor:pointer;width:100px;height:26px;"></div>
                <span style="font-size:0.9rem;color:var(--muted);font-weight:700;">| Driver App</span>: <span id="driver-name" style="font-size:0.9rem;font-weight:700;">Driver</span>
            `;
        });

        // Track page
        const authPanel = document.getElementById('auth-panel');
        if (authPanel && !document.getElementById('track-logo-container')) {
            const c = document.createElement('div');
            c.id = 'track-logo-container';
            c.style.cssText = 'display:flex;justify-content:center;margin-bottom:24px;';
            c.innerHTML = `<div class="brand-logo" style="width:180px;height:45px;"></div>`;
            authPanel.insertBefore(c, authPanel.firstChild);
        }

        // Landing page
        const isIndex = !window.location.pathname.includes('/pages/');
        if (isIndex && !document.getElementById('landing-brand-container')) {
            const c = document.createElement('div');
            c.id = 'landing-brand-container';
            c.style.cssText = 'position:fixed;top:20px;left:20px;z-index:10002;display:flex;align-items:center;';
            c.innerHTML = `<div class="brand-logo" style="width:150px;height:38px;cursor:pointer;" onclick="location.reload()"></div>`;
            document.body.appendChild(c);
        }

        // Updates page
        const updatesHeader = document.querySelector('.container header');
        if (updatesHeader && !document.getElementById('updates-logo-container')) {
            const c = document.createElement('div');
            c.id = 'updates-logo-container';
            c.style.cssText = 'display:flex;justify-content:center;margin-bottom:20px;';
            c.innerHTML = `<div class="brand-logo" style="width:160px;height:40px;"></div>`;
            updatesHeader.insertBefore(c, updatesHeader.firstChild);
        }
    };

    // ── Boot ────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        _hideToolbar();
        _ensureContainer();
        _loadGoogleScript();
        window.injectBrandingLogo();

        // Sync existing language selector value
        const saved = localStorage.getItem('app_lang') || 'en';
        document.querySelectorAll('select[onchange="setLanguage(this.value)"]').forEach(sel => {
            sel.value = saved;
        });
    });

})();
