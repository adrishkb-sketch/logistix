// Auth Logic with Event Delegation for Modal-based forms

async function requestOTP() {
    const email = document.getElementById('signup-email').value;
    if (!email) {
        alert(getTranslation('auth_error_email'));
        return;
    }
    
    try {
        const res = await apiCall('/auth/company/request-otp', 'POST', { email });
        alert(res.message); // Inform user to check email
        document.getElementById('step-1').style.display = 'none';
        document.getElementById('step-2').style.display = 'block';
        startOTPTimer('resend-link', 'timer-val', requestOTP);
    } catch(e) {
        // Error handled in api.js
    }
}

function startOTPTimer(linkId, valId, retryFn) {
    let timeLeft = 10;
    const link = document.getElementById(linkId);
    const val = document.getElementById(valId);
    
    if (!link || !val) return;

    link.style.opacity = '0.5';
    link.style.pointerEvents = 'none';
    link.innerHTML = `Resend OTP (<span id="${valId}">${timeLeft}</span>s)`;
    
    const timer = setInterval(() => {
        timeLeft--;
        const v = document.getElementById(valId);
        if (v) v.innerText = timeLeft;
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            link.style.opacity = '1';
            link.style.pointerEvents = 'auto';
            link.innerHTML = `Resend OTP Now`;
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

    if (!isManagerForm && !isDriverForm && !isSignupForm) return;

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
            const email = document.getElementById('manager-email')?.value;
            const password = document.getElementById('manager-password')?.value;
            
            if (!email || !password) throw new Error(getTranslation('auth_error_missing'));

            const res = await apiCall('/auth/company/login', 'POST', { email, password });
            console.log("Login successful, storing credentials...");
            
            localStorage.setItem('manager_id', res.company_id);
            localStorage.setItem('company_id', res.company_id);
            localStorage.setItem('manager_name', res.name);
            
            window.location.href = 'pages/manager.html';
        }

        // Driver Login
        if (isDriverForm) {
            const login_id = document.getElementById('driver-id')?.value;
            const password = document.getElementById('driver-password')?.value;
            
            if (!login_id || !password) throw new Error(getTranslation('auth_error_missing_driver'));

            const res = await apiCall('/auth/driver/login', 'POST', { login_id, password });
            localStorage.setItem('driver_id', res.driver_id);
            localStorage.setItem('driver_name', res.name);
            localStorage.setItem('company_id', res.company_id);
            
            window.location.href = 'pages/driver.html';
        }

        // Company Signup
        if (isSignupForm) {
            const name = document.getElementById('signup-name')?.value;
            const email = document.getElementById('signup-email')?.value;
            const password = document.getElementById('signup-password')?.value;
            const otp = document.getElementById('signup-otp')?.value;
            
            await apiCall('/auth/company/verify-signup', 'POST', {
                email,
                otp,
                company_data: { name, email, password }
            });
            alert(getTranslation('auth_success_signup'));
            if (window.closeModal) window.closeModal();
            else {
                const m = document.getElementById('modal');
                if (m) m.style.display = 'none';
            }
        }
    } catch (err) {
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
    if (!email || !email.includes('@')) {
        if (warning) warning.style.display = 'none';
        return;
    }
    try {
        const res = await apiCall(`/auth/check-email?email=${encodeURIComponent(email)}`, 'GET');
        if (warning) {
            warning.style.display = res.exists ? 'block' : 'none';
        }
    } catch (e) {
        console.error("Email check failed:", e);
    }
}
window.validateSignupEmail = validateSignupEmail;
