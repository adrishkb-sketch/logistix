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
    console.log("Form submitted:", target.id);

    // Identify our forms
    const isManagerForm = target.id === 'manager-login-form';
    const isDriverForm = target.id === 'driver-login-form';
    const isSignupForm = target.id === 'signup-form';

    if (isManagerForm || isDriverForm || isSignupForm) {
        e.preventDefault();
        console.log("Prevented default submission for:", target.id);
    } else {
        return; // Not our form
    }

    // Find active modal container
    const activeModal = document.getElementById('auth-modal') || document.getElementById('modal');
    if (!activeModal) {
        console.error("No active modal found for submission");
        return;
    }

    // Manager Login
    if (isManagerForm) {
        const email = activeModal.querySelector('#manager-email').value;
        const password = activeModal.querySelector('#manager-password').value;
        console.log("Attempting Manager login for:", email);
        
        try {
            const res = await apiCall('/auth/company/login', 'POST', { email, password });
            console.log("Login successful, redirecting...");
            localStorage.setItem('manager_id', res.company_id);
            localStorage.setItem('company_id', res.company_id);
            localStorage.setItem('manager_name', res.name);
            window.location.href = 'pages/manager.html';
        } catch(err) {
            console.error("Manager login failed:", err);
        }
    }

    // Driver Login
    if (isDriverForm) {
        const login_id = activeModal.querySelector('#driver-id').value;
        const password = activeModal.querySelector('#driver-password').value;
        console.log("Attempting Driver login for:", login_id);
        
        try {
            const res = await apiCall('/auth/driver/login', 'POST', { login_id, password });
            console.log("Login successful, redirecting...");
            localStorage.setItem('driver_id', res.driver_id);
            localStorage.setItem('driver_name', res.name);
            localStorage.setItem('company_id', res.company_id);
            window.location.href = 'pages/driver.html';
        } catch(err) {
            console.error("Driver login failed:", err);
        }
    }

    // Company Signup
    if (isSignupForm) {
        const name = activeModal.querySelector('#signup-name').value;
        const email = activeModal.querySelector('#signup-email').value;
        const password = activeModal.querySelector('#signup-password').value;
        const otp = activeModal.querySelector('#signup-otp').value;
        
        try {
            await apiCall('/auth/company/verify-signup', 'POST', {
                email,
                otp,
                company_data: { name, email, password }
            });
            alert("Signup successful! Please login as Manager.");
            if (window.closeModal) window.closeModal();
            else activeModal.style.display = 'none';
        } catch(err) {
            console.error("Signup failed:", err);
        }
    }
});
