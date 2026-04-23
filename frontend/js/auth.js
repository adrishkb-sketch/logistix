function switchTab(tabId) {
    // Update buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update forms
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
    if (tabId === 'manager') document.getElementById('manager-login-form').classList.add('active');
    if (tabId === 'driver') document.getElementById('driver-login-form').classList.add('active');
    if (tabId === 'signup') document.getElementById('signup-form').classList.add('active');
}

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

// Signup Submission
document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const otp = document.getElementById('signup-otp').value;
    
    try {
        const res = await apiCall('/auth/company/verify-signup', 'POST', {
            email,
            otp,
            company_data: { name, email, password }
        });
        alert("Signup successful! Please login.");
        switchTab('manager');
    } catch(e) {}
});

// Manager Login
document.getElementById('manager-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('manager-email').value;
    const password = document.getElementById('manager-password').value;
    
    try {
        const res = await apiCall('/auth/company/login', 'POST', { email, password });
        localStorage.setItem('manager_id', res.company_id);
        localStorage.setItem('manager_name', res.name);
        window.location.href = 'pages/manager.html';
    } catch(e) {}
});

// Driver Login
document.getElementById('driver-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const login_id = document.getElementById('driver-id').value;
    const password = document.getElementById('driver-password').value;
    
    try {
        const res = await apiCall('/auth/driver/login', 'POST', { login_id, password });
        localStorage.setItem('driver_id', res.driver_id);
        localStorage.setItem('driver_name', res.name);
        window.location.href = 'pages/driver.html';
    } catch(e) {}
});
