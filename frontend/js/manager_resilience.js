// Dedicated script for manager_resilience.html

async function loadNetworkResilience() {
    try {
        const data = await apiCall(`/manager/analytics/cascade?company_id=${localStorage.getItem('manager_id')}`);
        
        // Update Total Risk
        document.getElementById('nr-total-risk').innerText = `${data.total_impact_hours} hrs`;
        
        // Update Mitigation Text
        document.getElementById('nr-rec-text').innerText = data.active_risk_count > 0 ? data.recommendation : "System stable. No immediate mitigation required.";
        
        // Update Matrix (Detailed cards)
        const matrix = document.getElementById('nr-matrix');
        if (data.risks.length === 0) {
            matrix.innerHTML = `<div style="text-align:center; padding-top:100px; color:var(--text-muted);">🛡️ All Network Nodes Healthy</div>`;
        } else {
            matrix.innerHTML = data.risks.map(r => `
                <div class="glass-card" style="padding:15px; border-left: 4px solid ${r.severity==='high'?'var(--danger)':'var(--warning)'}; margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between;">
                        <b>Chain ${r.source_shipment_id.slice(0,4)}</b>
                        <span style="color:var(--text-muted)">Deviation: ${r.current_delay}</span>
                    </div>
                    <div style="margin-top:10px; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                        <div style="width:${r.severity==='high'?'85%':'45%'}; height:100%; background:${r.severity==='high'?'var(--danger)':'var(--warning)'};"></div>
                    </div>
                    <small style="display:block; margin-top:5px; color:var(--text-muted);">Impact Probability: ${r.severity==='high'?'Critical':'Elevated'}</small>
                </div>
            `).join('');
        }

        // Update Table
        const tbody = document.getElementById('nr-table-body');
        globalRisks = data.risks;
        if (data.risks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="padding:40px; text-align:center; color:var(--text-muted);">No disruption chains detected.</td></tr>`;
        } else {
            const limit = window.tableLimits.nr;
            const limited = data.risks.slice(0, limit);
            tbody.innerHTML = limited.map(r => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:12px;">
                        <b>${r.description}</b><br>
                        <small style="color:var(--text-muted)">${r.source_shipment_id}</small>
                    </td>
                    <td style="padding:12px; color:var(--danger)">+${r.current_delay}</td>
                    <td style="padding:12px;">
                        ${r.impact_hubs.map(h => `<span class="badge" style="background:rgba(255,255,255,0.1); margin-right:5px;">${h.location}</span>`).join('')}
                    </td>
                    <td style="padding:12px;">
                        <span class="badge" style="background:${r.severity==='high'?'var(--danger)':'var(--warning)'}">${r.severity.toUpperCase()}</span>
                    </td>
                    <td style="padding:12px; text-align:center;">
                        <button class="btn-primary" style="width:auto; padding:4px 10px; font-size:0.75rem;" onclick="showSection('shipments')">Analyze Path</button>
                    </td>
                </tr>
            `).join('');
            renderTableControls('nr', data.risks.length, limit, 'refreshRisksTable');
        }

    } catch(e) {
        console.error("Resilience Load Error", e);
    }
}

async function initPage() {
    loadNetworkResilience();
}

document.addEventListener('DOMContentLoaded', initPage);