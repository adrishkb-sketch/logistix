// Auth Logic with Event Delegation for Modal-based forms
async function requestOTP() {
    const emailInput = document.getElementById('signup-email');
    const companyInput = document.getElementById('signup-name');
    const email = emailInput ? emailInput.value.trim() : '';
    const company_name = companyInput ? companyInput.value.trim() : '';
    const btn = document.getElementById('signup-otp-btn');

    if (!email) {
        alert(getTranslation('auth_error_email'));
        return;
    }
    
    // UI Feedback: Disable and show waiting
    if (btn) {
        btn.disabled = true;
        btn.innerText = getTranslation('otp_sending');
    }
    showToast(getTranslation('otp_sending'), 'info');

    try {
        const res = await apiCall('/auth/company/request-otp', 'POST', { email, company_name });
        
        document.getElementById('step-1').style.display = 'none';
        document.getElementById('step-2').style.display = 'block';
        if (typeof updatePageTranslations === 'function') updatePageTranslations();
        startOTPTimer('resend-link', 'timer-val', requestOTP);
        
        if (res.otp) {
            showToast(`${getTranslation('otp_sent_success') || 'OTP Sent'} (Dev Auto-fill: ${res.otp})`, 'success');
            // Auto fill 6 pin boxes
            setTimeout(() => {
                const pinBoxes = document.querySelectorAll('.signup-pin');
                if (pinBoxes.length === 6) {
                    res.otp.split('').forEach((char, idx) => {
                        pinBoxes[idx].value = char;
                    });
                }
            }, 100);
        } else {
            showToast(getTranslation('otp_sent_success'), 'success');
        }
    } catch(e) {
        // Re-enable if failed
        if (btn) {
            btn.disabled = false;
            btn.innerText = getTranslation('btn_request_otp') || 'Request OTP';
        }
    }
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

// Global Event Listener for form submissions (Delegation)
document.addEventListener('submit', async (e) => {
    const target = e.target;
    
    // Identify our forms
    const isManagerForm = target.id === 'manager-login-form';
    const isDriverForm = target.id === 'driver-login-form';
    const isSignupForm = target.id === 'signup-form';
    const isWhManagerForm = target.id === 'wh-manager-login-form';

    if (!isManagerForm && !isDriverForm && !isSignupForm && !isWhManagerForm) return;

    e.preventDefault();
    console.log("Processing form submission for:", target.id);

    const submitBtn = target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.innerText : getTranslation('submit') || 'Submit';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = getTranslation('authenticating');
    }

    try {
        // Manager Login
        if (isManagerForm) {
            const email = document.getElementById('manager-email')?.value?.trim();
            const password = document.getElementById('manager-password')?.value;
            
            if (!email || !password) throw new Error(getTranslation('auth_error_missing'));

            const res = await apiCall('/auth/company/login', 'POST', { email, password });
            console.log("Login successful, storing credentials...");
            
            localStorage.setItem('manager_id', res.company_id);
            localStorage.setItem('company_id', res.company_id);
            localStorage.setItem('manager_name', res.name);
            localStorage.setItem('company_name', res.name);
            localStorage.setItem('session_token', res.token);
            
            window.location.href = 'pages/executive_dashboard.html';
        }

        // Warehouse Manager Login
        if (target.id === 'wh-manager-login-form') {
            const email = document.getElementById('wh-manager-email')?.value?.trim();
            const password = document.getElementById('wh-manager-password')?.value;

            if (!email || !password) throw new Error(getTranslation('auth_error_missing'));

            const res = await apiCall('/auth/warehouse-manager/login', 'POST', { email, password });
            
            localStorage.setItem('warehouse_id', res.warehouse_id);
            localStorage.setItem('warehouse_name', res.warehouse_name);
            localStorage.setItem('company_id', res.company_id);
            localStorage.setItem('manager_name', res.manager_name);
            localStorage.setItem('session_token', res.token);
            
            window.location.href = 'pages/hub_manager_portal.html';
        }

        // Driver Login
        if (isDriverForm) {
            const company_id = document.getElementById('driver-company-id')?.value?.trim();
            const login_id = document.getElementById('driver-id')?.value?.trim();
            const password = document.getElementById('driver-password')?.value;
            
            if (!company_id || !login_id || !password) throw new Error(getTranslation('auth_error_missing_driver'));

            const res = await apiCall('/auth/driver/login', 'POST', { company_id, login_id, password });
            localStorage.setItem('driver_id', res.driver_id);
            localStorage.setItem('driver_name', res.name);
            localStorage.setItem('company_id', res.company_id);
            localStorage.setItem('session_token', res.token);
            
            window.location.href = 'pages/driver_dashboard.html';
        }

        // Company Signup
        if (isSignupForm) {
            // If Step 1 is active, Enter should trigger requestOTP
            const step1 = document.getElementById('step-1');
            if (step1 && step1.style.display !== 'none') {
                await requestOTP();
                return;
            }

            const name = document.getElementById('signup-name')?.value?.trim();
            const email = document.getElementById('signup-email')?.value?.trim();
            const password = document.getElementById('signup-password')?.value;
            const otp = Array.from(document.querySelectorAll('.signup-pin')).map(i => i.value?.trim() || '').join('');
            
            const btn = target.querySelector('button[type="submit"]');
            if (btn) btn.disabled = true;

            const res = await apiCall('/auth/company/verify-signup', 'POST', {
                email,
                otp,
                company_data: { name, email, password }
            });
            
            // Success! Store credentials for auto-login after welcome
            localStorage.setItem('manager_id', res.company_id);
            localStorage.setItem('company_id', res.company_id);
            localStorage.setItem('manager_name', name);
            localStorage.setItem('company_name', name);
            localStorage.setItem('session_token', res.token);

            // Show Welcome Modal
            showWelcomeModal(name);
        }    } catch (err) {
        console.error("Auth Action Failed:", err);
        // Error is already alerted in apiCall, but we handle button reset here
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = originalBtnText;
        }
    }
});

async function validateSignupEmail(email) {
    const warning = document.getElementById('email-warning');
    const input = document.getElementById('signup-email');
    if (!email || !email.includes('@')) {
        if (warning) warning.style.display = 'none';
        if (input) input.style.borderColor = 'rgba(255,255,255,0.1)';
        return;
    }
    try {
        const res = await apiCall(`/auth/check-email?email=${encodeURIComponent(email)}`, 'GET');
        if (warning) {
            warning.style.display = res.exists ? 'block' : 'none';
        }
        if (input) {
            input.style.borderColor = res.exists ? '#ff4f4f' : '#4fff4f';
            input.style.boxShadow = res.exists ? '0 0 10px rgba(255,79,79,0.2)' : '0 0 10px rgba(79,255,79,0.2)';
        }
    } catch (e) {
        console.error("Email check failed:", e);
    }
}
window.validateSignupEmail = validateSignupEmail;

/**
 * Shows a beautiful welcome modal for newly registered companies.
 * @param {string} companyName 
 */
function showWelcomeModal(companyName) {
    const modal = document.getElementById('modal');
    const content = document.getElementById('modal-content');
    if (!modal || !content) return;

    // Use absolute URL for the image or relative to root
    const imageSrc = window.location.origin + '/welcome.png';

    content.innerHTML = `
        <div style="text-align: center; padding: 10px;">
            <div style="width: 100%; height: 220px; background: url('${imageSrc}') no-repeat center/cover; border-radius: 15px; margin-bottom: 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);"></div>
            
            <h2 style="font-size: 1.8rem; font-weight: 800; background: linear-gradient(90deg, #fff, #4f8cff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 10px;">
                Welcome, ${companyName}!
            </h2>
            <p style="color: var(--muted); font-size: 0.95rem; margin-bottom: 25px; line-height: 1.6;">
                Your logistics journey just got smarter. Here's what <b>Logistix</b> empowers you with:
            </p>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; text-align: left; margin-bottom: 30px;">
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
                    <div style="font-size: 1.2rem; margin-bottom: 5px;">🚚</div>
                    <div style="font-weight: 700; font-size: 0.85rem;">Smart Dispatch</div>
                    <div style="font-size: 0.75rem; color: var(--muted);">AI-driven driver matching</div>
                </div>
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
                    <div style="font-size: 1.2rem; margin-bottom: 5px;">❄️</div>
                    <div style="font-weight: 700; font-size: 0.85rem;">Cold Chain</div>
                    <div style="font-size: 0.75rem; color: var(--muted);">Spoilage prediction sensor</div>
                </div>
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
                    <div style="font-size: 1.2rem; margin-bottom: 5px;">📊</div>
                    <div style="font-weight: 700; font-size: 0.85rem;">Real-time Fleet</div>
                    <div style="font-size: 0.75rem; color: var(--muted);">Live GPS & status tracking</div>
                </div>
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
                    <div style="font-size: 1.2rem; margin-bottom: 5px;">🔐</div>
                    <div style="font-weight: 700; font-size: 0.85rem;">Secure Escrow</div>
                    <div style="font-size: 0.75rem; color: var(--muted);">Cashless transaction safety</div>
                </div>
            </div>

            <button class="btn btn-primary" style="width: 100%; padding: 16px; font-size: 1.1rem;" onclick="window.location.href='pages/executive_dashboard.html'">
                Go to Dashboard →
            </button>
        </div>
    `;

    modal.style.display = 'flex';
}
window.showWelcomeModal = showWelcomeModal;
