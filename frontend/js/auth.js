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

    // Manager Login
    if (target.id === 'manager-login-form' || target.closest('#manager-login-form-template') || target.querySelector('#manager-email')) {
        // Since we are injecting innerHTML, IDs are duplicated in DOM if template exists.
        // We find the active one in the modal.
        const modal = document.getElementById('auth-modal');
        if (modal.style.display === 'flex') {
            e.preventDefault();
            const email = modal.querySelector('#manager-email').value;
            const password = modal.querySelector('#manager-password').value;
            
            try {
                const res = await apiCall('/auth/company/login', 'POST', { email, password });
                localStorage.setItem('manager_id', res.company_id);
                localStorage.setItem('company_id', res.company_id);
                localStorage.setItem('manager_name', res.name);
                window.location.href = 'pages/manager.html';
            } catch(e) {}
        }
    }

    // Driver Login
    if (target.querySelector('#driver-id')) {
        const modal = document.getElementById('auth-modal');
        if (modal.style.display === 'flex') {
            e.preventDefault();
            const login_id = modal.querySelector('#driver-id').value;
            const password = modal.querySelector('#driver-password').value;
            
            try {
                const res = await apiCall('/auth/driver/login', 'POST', { login_id, password });
                localStorage.setItem('driver_id', res.driver_id);
                localStorage.setItem('driver_name', res.name);
                localStorage.setItem('company_id', res.company_id);
                window.location.href = 'pages/driver.html';
            } catch(e) {}
        }
    }

    // Company Signup
    if (target.querySelector('#signup-otp')) {
        const modal = document.getElementById('auth-modal');
        if (modal.style.display === 'flex') {
            e.preventDefault();
            const name = modal.querySelector('#signup-name').value;
            const email = modal.querySelector('#signup-email').value;
            const password = modal.querySelector('#signup-password').value;
            const otp = modal.querySelector('#signup-otp').value;
            
            try {
                await apiCall('/auth/company/verify-signup', 'POST', {
                    email,
                    otp,
                    company_data: { name, email, password }
                });
                alert("Signup successful! Please login as Manager.");
                closeModal();
            } catch(e) {}
        }
    }
});
