// Dedicated script for manager_receivers.html

window.loadReceivers = async function() {
    try {
        const company_id = localStorage.getItem('manager_id');
        const receivers = await apiCall(`/manager/receivers?company_id=${company_id}`);
        renderReceiversTable(receivers);
    } catch (err) {
        console.error("Failed to load receivers:", err);
    }
}

function renderReceiversTable(receivers) {
    const tbody = document.getElementById('receivers-table-body');
    if (!tbody) return;

    if (!receivers || receivers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:60px; color:var(--text-muted);"><div style="font-size:3rem; margin-bottom:15px; opacity:0.3;">👥</div><span data-i18n="no_data">No receiver data available.</span></td></tr>`;
        return;
    }

    tbody.innerHTML = receivers.map(r => `
        <tr>
            <td style="font-family:monospace; color:var(--primary); font-weight:700;">${r.id}</td>
            <td style="font-weight:600;">${r.name}</td>
            <td style="color:var(--muted);">${r.email}</td>
            <td style="color:var(--muted); font-weight:700;">${r.phone}</td>
            <td>
                <div style="display:flex; gap:8px;">
                    <button class="btn-primary" style="width:auto; padding:6px 12px; font-size:0.75rem; background:rgba(255,255,255,0.05); border:1px solid var(--border);" onclick="viewReceiverOrders('${r.id}')">📦 Orders</button>
                    <button class="btn-primary" style="width:auto; padding:6px 12px; font-size:0.75rem; background:rgba(79, 140, 255, 0.1); color:var(--primary); border:1px solid var(--primary);" onclick="editReceiver('${r.id}')">✏️ Edit</button>
                    <button class="btn-primary" style="width:auto; padding:6px 12px; font-size:0.75rem; background:rgba(255, 75, 75, 0.1); color:#ff4b4b; border:1px solid #ff4b4b;" onclick="deleteReceiver('${r.id}')">🗑️ Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

window.lookupReceiverByEmail = async function(email) {
    const statusDiv = document.getElementById('receiver-lookup-status');
    const nameInput = document.getElementById('receiver-name');
    const phoneInput = document.getElementById('receiver-phone');
    
    if (!email || !email.includes('@')) {
        statusDiv.style.display = 'none';
        return;
    }

    try {
        const company_id = localStorage.getItem('manager_id');
        const receivers = await apiCall(`/manager/receivers?company_id=${company_id}`);
        const found = receivers.find(r => r.email.toLowerCase() === email.toLowerCase());

        if (found) {
            currentLookedUpReceiverId = found.id;
            statusDiv.innerHTML = `<span style="color:var(--success); font-weight:700;">✅ Found: ${found.name} (${found.id})</span>`;
            statusDiv.style.display = 'block';
            
            nameInput.value = found.name;
            phoneInput.value = found.phone.replace("+91", "");
            
            nameInput.disabled = true;
            phoneInput.disabled = true;
            nameInput.style.opacity = '0.5';
            phoneInput.style.opacity = '0.5';
        } else {
            currentLookedUpReceiverId = null;
            statusDiv.innerHTML = `<span style="color:var(--primary); font-weight:700;">🆕 New Receiver Record</span>`;
            statusDiv.style.display = 'block';
            
            nameInput.disabled = false;
            phoneInput.disabled = false;
            nameInput.style.opacity = '1';
            phoneInput.style.opacity = '1';
        }
    } catch (err) {
        console.error("Receiver lookup failed", err);
    }
}

window.viewReceiverOrders = async function(id) {
    try {
        const company_id = localStorage.getItem('manager_id');
        const shipments = await apiCall(`/shipments/?company_id=${company_id}`);
        const receiverOrders = shipments.filter(s => s.receiver_id === id);

        const modal = document.getElementById('receiver-orders-modal');
        const list = document.getElementById('receiver-orders-list');
        list.innerHTML = '';

        if (receiverOrders.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted);text-align:center;">No orders found for this receiver.</p>';
        } else {
            receiverOrders.forEach(order => {
                list.innerHTML += `
                    <div style="background:rgba(255,255,255,0.05); padding:15px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">
                        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                            <span style="font-weight:bold; color:var(--primary);">${order.description || 'Shipment'}</span>
                            <span class="status-pill status-${order.status}" style="font-size:0.7rem;">${order.status.toUpperCase()}</span>
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;">ID: ${order.id}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted);">Updates: ${order.stage || 'No recent updates'}</div>
                    </div>
                `;
            });
        }
        modal.style.display = 'block';
    } catch (err) {
        showNotification("Failed to load orders", "error");
    }
}

window.editReceiver = async function(id) {
    try {
        const company_id = localStorage.getItem('manager_id');
        const receivers = await apiCall(`/manager/receivers?company_id=${company_id}`);
        const r = receivers.find(rec => rec.id === id);
        if (!r) return;

        const modal = document.getElementById('edit-modal');
        document.getElementById('edit-type').innerText = "Receiver";
        const fields = document.getElementById('edit-fields');
        fields.innerHTML = `
            <div class="input-group">
                <label>Name</label>
                <input type="text" id="edit-rec-name" value="${r.name}" style="width:100%; padding:10px; border-radius:8px; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border);">
            </div>
            <div class="input-group">
                <label>Phone</label>
                <input type="text" id="edit-rec-phone" value="${r.phone}" style="width:100%; padding:10px; border-radius:8px; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border);">
            </div>
            <div class="input-group">
                <label>Email</label>
                <input type="email" id="edit-rec-email" value="${r.email}" style="width:100%; padding:10px; border-radius:8px; background:rgba(0,0,0,0.3); color:white; border:1px solid var(--card-border);">
            </div>
        `;
        
        const form = document.getElementById('edit-form');
        form.onsubmit = async (e) => {
            e.preventDefault();
            const newName = document.getElementById('edit-rec-name').value;
            const newPhone = document.getElementById('edit-rec-phone').value;
            const newEmail = document.getElementById('edit-rec-email').value;
            
            if (newName && newPhone && newEmail) {
                await apiCall('/manager/receivers/upsert', 'POST', {
                    ...r,
                    name: newName,
                    phone: newPhone,
                    email: newEmail
                });
                showNotification("Receiver updated successfully!");
                modal.style.display = 'none';
                loadReceivers();
            }
        };
        
        modal.style.display = 'block';
    } catch (err) {
        showNotification("Failed to open edit dialog", "error");
    }
}

window.deleteReceiver = async function(id) {
    if (!confirm("Are you sure you want to delete this receiver? This will NOT delete their shipments but will remove them from your contacts.")) return;
    
    try {
        const company_id = localStorage.getItem('manager_id');
        await apiCall(`/manager/receivers/${id}?company_id=${company_id}`, 'DELETE');
        showNotification("Receiver deleted successfully!");
        loadReceivers();
    } catch (err) {
        showNotification("Failed to delete receiver", "error");
    }
}

async function initPage() {
    loadReceivers();
}

document.addEventListener('DOMContentLoaded', initPage);