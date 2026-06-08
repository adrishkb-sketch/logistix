// Dedicated script for manager_system.html

async function systemReset(type) {
    if (!confirm(`CRITICAL WARNING: Are you sure you want to delete all ${type} data? This action is permanent and cannot be reversed.`)) {
        return;
    }

    const password = prompt("Enter MANAGER PASSWORD to authorize this destructive action:");
    if (!password) return;
    
    try {
        const res = await apiCall(`/manager/system/reset-${type}`, 'POST', { manager_password: password });
        alert(res.message);
        // Reload the UI
        loadShipments();
        loadMapData();
        loadInsights();
        initFintechOracle();
        if (type === 'drivers' || type === 'vehicles' || type === 'operations') {
            loadDriversAndVehicles();
            loadLeaderboard();
        }
    } catch(err) {
        alert(`Failed to reset ${type}.`);
    }
}

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
        
        // Initialize PIN auto-focus listeners if not already done
        initDeletePinListeners();
        
        if (typeof updatePageTranslations === 'function') updatePageTranslations();
        startOTPTimer('resend-link-del', 'timer-val-del', requestDeleteAccount);
    } catch(err) {
        if (btn) {
            btn.disabled = false;
            btn.innerText = getTranslation('btn_delete_account') || 'Delete Company Account';
        }
        // apiCall already shows an alert for the error (e.g. "Incorrect password")
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
        // Auto-focus next box
        pin.oninput = (e) => {
            if (pin.value && idx < pins.length - 1) {
                pins[idx + 1].focus();
            }
        };
        // Backspace support
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

function saveGeminiApiKey() {
    const key = document.getElementById('gemini-api-key-input').value.trim();
    if (!key) {
        showToast("Please enter a valid Gemini API Key", "error");
        return;
    }
    localStorage.setItem('gemini_api_key', key);
    showToast("Gemini API Key saved successfully!", "success");
}

function clearGeminiApiKey() {
    localStorage.removeItem('gemini_api_key');
    document.getElementById('gemini-api-key-input').value = '';
    showToast("Gemini API Key cleared", "info");
}

function loadGeminiApiKey() {
    const key = localStorage.getItem('gemini_api_key');
    const input = document.getElementById('gemini-api-key-input');
    if (input && key) {
        input.value = key;
    }
}

async function initPage() {
    initDeletePinListeners();
    loadGeminiApiKey();
}

document.addEventListener('DOMContentLoaded', initPage);