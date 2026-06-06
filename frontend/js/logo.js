/**
 * Logistix Shared Logo System
 * Renders the animated brand logo everywhere on the platform.
 */

(function () {
  const LOGO_SVG = `
<svg class="lx-logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40" fill="none" aria-hidden="true" style="width:100%; height:100%; display:block;">
  <!-- Rounded Square with Gradient -->
  <rect x="2" y="2" width="36" height="36" rx="9" fill="url(#lx-grad-square)" filter="url(#lx-shadow)"/>
  
  <!-- Truck Icon Group (Animated) -->
  <g class="lx-svg-truck">
    <!-- Cabin -->
    <path d="M25 15H29.5C30.3284 15 31 15.6716 31 16.5V23.5C31 24.0523 30.5523 24.5 30 24.5H24V16C24 15.4477 24.4477 15 25 15Z" fill="#ffffff"/>
    <!-- Windshield -->
    <rect x="26.5" y="16.5" width="3" height="4" rx="0.5" fill="rgba(180, 220, 255, 0.45)"/>
    <!-- Truck body / cargo box -->
    <rect x="8" y="11" width="15" height="13.5" rx="2" fill="#ffffff"/>
    <!-- Package logo line on cargo box -->
    <path d="M11 17.5H20M15.5 13V22" stroke="url(#lx-grad-square)" stroke-width="1.2" stroke-linecap="round" opacity="0.8"/>
    <!-- Wheels -->
    <circle cx="13" cy="25.5" r="3" fill="#1e293b" stroke="#ffffff" stroke-width="1"/>
    <circle cx="13" cy="25.5" r="1" fill="#ffffff"/>
    <circle cx="26" cy="25.5" r="3" fill="#1e293b" stroke="#ffffff" stroke-width="1"/>
    <circle cx="26" cy="25.5" r="1" fill="#ffffff"/>
    <!-- Headlight -->
    <circle cx="31.5" cy="20" r="1" fill="#fde68a"/>
  </g>

  <!-- Wordmark TEXT -->
  <text class="lx-svg-text notranslate" x="48" y="27" font-family="'Space Grotesk', sans-serif" font-weight="800" font-size="18.5" letter-spacing="0.04em">LOGISTIX</text>

  <defs>
    <!-- Shadow for the rounded square icon -->
    <filter id="lx-shadow" x="0" y="0" width="40" height="40" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-opacity="0.15"/>
    </filter>
    <!-- Gradient for square -->
    <linearGradient id="lx-grad-square" x1="2" y1="2" x2="38" y2="38" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#4f8cff"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <!-- Gradient for wordmark text (Dark Mode) -->
    <linearGradient id="lx-grad-text-dark" x1="48" y1="0" x2="160" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#c4d9ff"/>
    </linearGradient>
    <!-- Gradient for wordmark text (Light Mode) -->
    <linearGradient id="lx-grad-text-light" x1="48" y1="0" x2="160" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
</svg>`;

  function injectBrandLogo() {
    // 1. Target brand-logo elements (injected by translator.js or hardcoded)
    document.querySelectorAll('.brand-logo').forEach(el => {
      if (el.querySelector('.lx-logo-svg')) return;
      el.innerHTML = LOGO_SVG;
      el.style.backgroundImage = 'none';
      el.style.setProperty('background-image', 'none', 'important');
    });

    // 2. Fallback for sidebar headers on manager pages if translator hasn't run yet
    document.querySelectorAll('.sidebar-header h2').forEach(el => {
      if (el.querySelector('.lx-logo-svg') || el.closest('.brand-logo')) return;
      el.innerHTML = LOGO_SVG;
      el.style.cssText += '; padding-left:0; overflow:visible;';
    });

    // 3. Fallback for warehouse manager pages if translator hasn't run yet
    document.querySelectorAll('.sidebar-logo').forEach(el => {
      if (el.querySelector('.lx-logo-svg') || el.classList.contains('sidebar-logo-container')) return;
      el.innerHTML = LOGO_SVG;
    });
  }

  function init() {
    injectBrandLogo();
    // Use MutationObserver to catch dynamic content replacements (like those from translator.js)
    const observer = new MutationObserver(injectBrandLogo);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.logistixLogo = { init };
})();
