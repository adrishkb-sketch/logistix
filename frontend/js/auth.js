// Auth Logic with Event Delegation for Modal-based forms

async function requestOTP() {
    const email = document.getElementById('signup-email').value;
    if (!email) {
        alert("Please enter an email first.");
        return;
    }
    
    try {
        await apiCall('/auth/company/request-otp', 'POST', { email });
        document.getElementById('step-1').style.display = 'none';
        document.getElementById('step-2').style.display = 'block';
    } catch(e) {
        // Error handled in api.js
    }
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
    const originalBtnText = submitBtn ? submitBtn.innerText : 'Submit';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Authenticating...';
    }

    try {
        // Manager Login
        if (isManagerForm) {
            const email = document.getElementById('manager-email')?.value;
            const password = document.getElementById('manager-password')?.value;
            
            if (!email || !password) throw new Error("Email and password are required");

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
            
            if (!login_id || !password) throw new Error("ID and password are required");

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
            alert("Signup successful! Please login as Manager.");
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
