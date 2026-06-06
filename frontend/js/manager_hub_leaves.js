// Dedicated script for manager_hub_leaves.html

window.loadHubLeaves = async function() {
    const tbody = document.getElementById('hub-leaves-body');
    if (!tbody) return;
    
    const companyId = localStorage.getItem('manager_id');
    try {
        const [reqs, warehouses] = await Promise.all([
            apiCall(`/manager/warehouses/leave-requests?company_id=${companyId}`),
            apiCall(`/manager/warehouses?company_id=${companyId}`)
        ]);
        
        const total = reqs.length;
        const pending = reqs.filter(r => (r.status || '').toLowerCase() === 'pending').length;
        const active = reqs.filter(r => (r.status || '').toLowerCase() === 'approved').length;

        if (document.getElementById('total-leave-count')) document.getElementById('total-leave-count').innerText = total;
        if (document.getElementById('pending-leave-count')) document.getElementById('pending-leave-count').innerText = pending;
        if (document.getElementById('active-leave-count')) document.getElementById('active-leave-count').innerText = active;

        if (total === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="padding:40px; text-align:center; color:var(--text-muted);">No operational leave requests found.</td></tr>';
            return;
        }
        
        tbody.innerHTML = reqs.reverse().map(r => {
            const wh = warehouses.find(w => w.id === r.warehouse_id);
            const status = (r.status || 'pending').toLowerCase();
            const statusColor = status === 'approved' ? 'var(--success)' : (status === 'rejected' ? 'var(--danger)' : 'var(--warning)');
            
            return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05); transition: background 0.3s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                    <td style="padding:20px 24px;">
                        <div style="font-weight:700; font-size:1.05rem; color:#fff;">${wh ? wh.name : 'Unknown Hub'}</div>
                        <div style="font-family:monospace; color:var(--text-muted); font-size:0.75rem; margin-top:4px;">ID: ${r.warehouse_id.substring(0,8)}</div>
                    </td>
                    <td style="padding:20px 24px;">
                        <div style="color:var(--accent); font-weight:700; font-size:0.95rem;">${r.start_date} <span style="color:var(--text-muted); font-weight:400; margin:0 4px;">→</span> ${r.end_date}</div>
                        <div style="color:var(--text-muted); font-size:0.75rem; margin-top:4px;">Registered: ${new Date(r.created_at).toLocaleDateString()}</div>
                    </td>
                    <td style="padding:20px 24px;">
                        <span class="status-pill" style="background:${statusColor}22; color:${statusColor}; font-weight:800; font-size:0.75rem; padding:6px 12px; border-radius:30px; border:1px solid ${statusColor}44; text-transform:uppercase; letter-spacing:0.5px;">
                            ${status}
                        </span>
                    </td>
                    <td style="padding:20px 24px; text-align:right;">
                        ${status === 'pending' ? `
                            <button class="btn-primary" style="background:var(--success); color:white; padding:10px 20px; margin-right:8px; border:none; border-radius:12px; cursor:pointer; font-weight:700; font-size:0.85rem; box-shadow:0 4px 15px rgba(16, 185, 129, 0.2);" onclick="updateLeaveStatus('${r.id}', 'approved')">Approve ✅</button>
                            <button class="btn-primary" style="background:var(--danger); color:white; padding:10px 20px; border:none; border-radius:12px; cursor:pointer; font-weight:700; font-size:0.85rem; box-shadow:0 4px 15px rgba(239, 68, 68, 0.2);" onclick="updateLeaveStatus('${r.id}', 'rejected')">Reject ❌</button>
                        ` : `
                            <div style="color:var(--text-muted); font-style:italic; font-size:0.85rem; background:rgba(255,255,255,0.03); display:inline-block; padding:8px 16px; border-radius:10px; border:1px solid rgba(255,255,255,0.05);">
                                Action Resolved (${status})
                            </div>
                        `}
                    </td>
                </tr>
            `;
        }).join('');
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:40px; text-align:center; color:var(--danger);">Failed to load registry.</td></tr>';
    }
}

window.updateLeaveStatus = async function(reqId, status) {
    if (!confirm(`Are you sure you want to ${status} this request?`)) return;
    try {
        const companyId = localStorage.getItem('manager_id');
        await apiCall(`/manager/warehouses/leave-requests/${reqId}/status?status=${status}&company_id=${companyId}`, 'PUT');
        showNotification(`Request ${status} successfully.`, "success");
        loadHubLeaves();
    } catch(e) {
        showNotification("Failed to update status.", "error");
    }
}

async function initPage() {
    loadHubLeaves();
}

document.addEventListener('DOMContentLoaded', initPage);