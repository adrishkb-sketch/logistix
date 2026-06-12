// Dedicated script for manager_system.html
// ─── Gemini Key Pool Manager (Backend DB) ────────────────────────────────────

let _cachedKeys = []; // local cache of masked keys from server

async function loadGeminiKeyPool() {
    const list = document.getElementById('gemini-keys-list');
    const noMsg = document.getElementById('gemini-no-keys-msg');
    const badge = document.getElementById('ai-status-badge');

    try {
        const res = await apiCall('/manager/system/get-gemini-keys', 'GET', null, true);
        _cachedKeys = res.masked_keys || [];
        const count = _cachedKeys.length;

        // Update badge
        if (badge) {
            if (count > 0) {
                badge.textContent = `Connected 🟢 (${count} key${count > 1 ? 's' : ''})`;
                badge.style.background = 'rgba(16,185,129,0.15)';
                badge.style.color = '#34d399';
                badge.style.borderColor = 'rgba(52,211,153,0.3)';
            } else {
                badge.textContent = 'Not Configured 🔴';
                badge.style.background = 'rgba(255,70,70,0.15)';
                badge.style.color = '#f87171';
                badge.style.borderColor = 'rgba(248,113,113,0.3)';
            }
        }
        
        const aiToggle = document.getElementById('ai-engine-toggle');
        if (aiToggle) {
            aiToggle.checked = res.ai_mode === true;
        }

        if (!list) return;

        if (count === 0) {
            list.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem; text-align:center; padding:20px;" id="gemini-no-keys-msg">No API keys configured yet.</div>`;
            return;
        }

        list.innerHTML = _cachedKeys.map((masked, i) => `
            <div style="display:flex; align-items:center; gap:12px; padding:12px 16px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);">
                <span style="font-size:1rem;">🔑</span>
                <span style="flex:1; font-family:monospace; font-size:0.85rem; color:var(--text);">${masked}</span>
                <span style="font-size:0.7rem; color:var(--text-muted); background:rgba(255,255,255,0.06); padding:3px 8px; border-radius:6px;">KEY ${i + 1}</span>
                <button onclick="deleteGeminiKey(${i})" style="background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); color:#f87171; border-radius:8px; padding:6px 14px; cursor:pointer; font-size:0.8rem; font-weight:700; transition:all 0.2s;"
                    onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
                    🗑 Remove
                </button>
            </div>
        `).join('');

    } catch (e) {
        console.error('Failed to load Gemini key pool:', e);
        if (list) list.innerHTML = `<div style="color:var(--danger); font-size:0.85rem; text-align:center; padding:15px;">⚠️ Failed to load key status. Make sure you are logged in.</div>`;
    }
}

async function addGeminiKey() {
    const input = document.getElementById('gemini-new-key-input');
    const btn = document.getElementById('add-key-btn');
    const newKey = (input?.value || '').trim();

    if (!newKey || newKey.length < 10 || newKey.startsWith('YOUR_')) {
        showToast('Please enter a valid Gemini API key.', 'error');
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        // Get existing raw keys count from server and append
        // We send all keys as comma-separated; to avoid sending back masked we first fetch raw count
        // Instead, we send just the new one; backend will APPEND
        const res = await apiCall('/manager/system/save-gemini-keys', 'POST', { keys: newKey, mode: 'append' });
        showToast(res.message || 'API key added successfully!', 'success');
        if (input) input.value = '';
        await loadGeminiKeyPool();
        // Notify other tabs/pages that AI status changed
        localStorage.setItem('ai_configured_ts', Date.now().toString());
    } catch (e) {
        showToast('Failed to save key: ' + (e.message || 'Unknown error'), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '➕ Add Key'; }
    }
}

async function deleteGeminiKey(index) {
    const ok = await window.confirmAsync(`Remove Key ${index + 1} (${_cachedKeys[index]}) from the pool?`, { danger: true });
    if (!ok) return;

    try {
        const res = await apiCall('/manager/system/delete-gemini-key', 'POST', { index });
        showToast(res.message || 'Key removed.', 'success');
        await loadGeminiKeyPool();
        localStorage.setItem('ai_configured_ts', Date.now().toString());
    } catch (e) {
        showToast('Failed to delete key: ' + (e.message || 'Unknown error'), 'error');
    }
}

// ─── AI Mode Toggle ──────────────────────────────────────────────────────────
async function toggleAIEngine() {
    const aiToggle = document.getElementById('ai-engine-toggle');
    if (!aiToggle) return;
    
    try {
        const mode = aiToggle.checked;
        const res = await apiCall('/manager/system/ai-mode', 'POST', { ai_mode: mode });
        showToast(res.message || (mode ? 'Gemini AI Engine Activated' : 'Local Rule Engine Activated'), 'success');
        localStorage.setItem('ai_configured_ts', Date.now().toString());
    } catch (e) {
        aiToggle.checked = !aiToggle.checked;
        showToast('Failed to toggle AI mode: ' + (e.message || 'Unknown error'), 'error');
    }
}

// ─── System Resets ────────────────────────────────────────────────────────────

async function systemReset(type) {
    if (!await window.confirmAsync(`CRITICAL: Delete all ${type} data? This is permanent.`, { danger: true })) {
        return;
    }

    const password = prompt("Enter MANAGER PASSWORD to authorize this destructive action:");
    if (!password) return;
    
    try {
        const res = await apiCall(`/manager/system/reset-${type}`, 'POST', { manager_password: password });
        alert(res.message);
        loadShipments?.();
        loadMapData?.();
        loadInsights?.();
        initFintechOracle?.();
        if (type === 'drivers' || type === 'vehicles' || type === 'operations') {
            loadDriversAndVehicles?.();
            loadLeaderboard?.();
        }
    } catch(err) {
        showToast(`Failed to reset ${type}.`, 'error');
    }
}

// ─── Account Deletion ─────────────────────────────────────────────────────────

async function requestDeleteAccount() {
    const password = prompt("To authorize account deletion, please enter your Manager Password:");
    if (!password) return;

    const btn = document.getElementById('request-del-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerText = getTranslation('otp_sending') || "Sending OTP...";
    }
    showToast(getTranslation('otp_sending') || "Sending OTP...", 'info');

    try {
        const companyId = localStorage.getItem('manager_id');
        const res = await apiCall(`/manager/system/delete-account-request`, 'POST', { 
            company_id: companyId,
            manager_password: password
        });
        
        showToast(getTranslation('otp_sent_success'), 'success');
        document.getElementById('delete-account-step1').style.display = 'none';
        document.getElementById('delete-account-step2').style.display = 'block';
        
        initDeletePinListeners();
        
        if (typeof updatePageTranslations === 'function') updatePageTranslations();
        startOTPTimer('resend-link-del', 'timer-val-del', requestDeleteAccount);
    } catch(err) {
        if (btn) {
            btn.disabled = false;
            btn.innerText = getTranslation('btn_delete_account') || 'Delete Company Account';
        }
    }
}

async function confirmDeleteAccount() {
    const otp = Array.from(document.querySelectorAll('.delete-pin')).map(i => i.value).join('');
    if (!otp || otp.length < 6) {
        showToast("Please enter a valid 6-digit OTP.", "error");
        return;
    }
    
    const btn = document.getElementById('confirm-del-btn');
    if (btn) btn.disabled = true;

    try {
        const companyId = localStorage.getItem('manager_id');
        const res = await apiCall(`/manager/system/delete-account-confirm?company_id=${companyId}&otp=${otp}`, 'POST');
        showToast(res.message, 'success');
        setTimeout(() => logout(), 2000);
    } catch(err) {
        if (btn) btn.disabled = false;
        showToast("Incorrect OTP or account already deleted.", "error");
    }
}

function initDeletePinListeners() {
    const pins = document.querySelectorAll('.delete-pin');
    pins.forEach((pin, idx) => {
        pin.oninput = (e) => {
            if (pin.value && idx < pins.length - 1) {
                pins[idx + 1].focus();
            }
        };
        pin.onkeydown = (e) => {
            if (e.key === 'Backspace' && !pin.value && idx > 0) {
                pins[idx - 1].focus();
            }
            if (e.key === 'Enter') {
                confirmDeleteAccount();
            }
        };
    });
}

function startOTPTimer(linkId, valId, retryFn) {
    let timeLeft = 10;
    const link = document.getElementById(linkId);
    const val = document.getElementById(valId);
    
    if (!link || !val) return;

    link.style.opacity = '0.5';
    link.style.pointerEvents = 'none';
    link.innerHTML = `${getTranslation('resend_otp')} (<span id="${valId}">${timeLeft}</span>s)`;
    
    const timer = setInterval(() => {
        timeLeft--;
        const v = document.getElementById(valId);
        if (v) v.innerText = timeLeft;
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            link.style.opacity = '1';
            link.style.pointerEvents = 'auto';
            link.innerHTML = getTranslation('resend_otp_now') || `Resend OTP Now`;
            link.onclick = (e) => {
                e.preventDefault();
                retryFn();
            };
        }
    }, 1000);
}

// ─── Legacy stubs (kept so old references don't break) ───────────────────────
function saveGeminiApiKey() { addGeminiKey(); }
function clearGeminiApiKey() { showToast('Use the Remove button next to each key.', 'info'); }
function loadGeminiApiKey() { loadGeminiKeyPool(); }

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initPage() {
    initDeletePinListeners();
    await loadGeminiKeyPool();
}

document.addEventListener('DOMContentLoaded', initPage);