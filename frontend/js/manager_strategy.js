// Dedicated script for manager_strategy.html

async function loadActiveStrategy() {
    const mId = localStorage.getItem('manager_id');
    const msg = document.getElementById('no-strategy-msg');
    const content = document.getElementById('active-strategy-content');
    if (!msg || !content) return;

    try {
        const plan = await apiCall(`/simulation/strategy/active?company_id=${mId}`);
        if (!plan) {
            msg.style.display = 'block';
            content.style.display = 'none';
            return;
        }

        msg.style.display = 'none';
        content.style.display = 'block';

        // 1. Render Forecast Summary
        document.getElementById('sf-predicted').innerText = `₹${(plan.summary.net_profit / 100000).toFixed(1)}L`;
        document.getElementById('sf-confidence').innerText = `${plan.summary.efficiency_score.toFixed(0)}% Efficiency Target`;
        document.getElementById('sf-risk').innerText = `Horizon: ${plan.params.months} Months | Risk: ${plan.risk_level}`;

        // 2. Fetch Current Stats to calculate Achievement
        const current = await apiCall(`/manager/system/baseline-stats?company_id=${mId}`);
        const base = plan.baselines;

        const targets = [
            { 
                label: "Warehouse Expansion", 
                current: current.warehouse_count - base.warehouse_count, 
                target: plan.params.wh,
                unit: "Hubs" 
            },
            { 
                label: "Fleet Increase", 
                current: current.vehicle_count - base.vehicle_count, 
                target: Math.round(base.vehicle_count * (plan.params.fleet / 100)),
                unit: "Vehicles" 
            },
            { 
                label: "EV Conversion", 
                current: current.ev_count, 
                target: Math.round(current.vehicle_count * (plan.params.green / 100)),
                unit: "EVs" 
            }
        ];

        // 3. Render Progress Bars
        const container = document.getElementById('progress-bars-container');
        container.innerHTML = targets.map(t => {
            const progress = t.target > 0 ? Math.min(100, Math.max(0, (t.current / t.target) * 100)) : (t.current >= 0 ? 100 : 0);
            return `
                <div style="margin-bottom:20px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <span style="font-weight:700;">${t.label}</span>
                        <span style="color:var(--text-muted); font-size:0.85rem;">${t.current} / ${t.target} ${t.unit}</span>
                    </div>
                    <div style="height:12px; background:rgba(255,255,255,0.05); border-radius:6px; overflow:hidden; border:1px solid rgba(255,255,255,0.1);">
                        <div style="width:${progress}%; height:100%; background:linear-gradient(90deg, var(--primary), var(--accent)); transition: width 1s ease-in-out;"></div>
                    </div>
                    <div style="text-align:right; font-size:0.7rem; color:var(--accent); font-weight:bold; margin-top:4px;">${progress.toFixed(1)}% ACHIEVED</div>
                </div>
            `;
        }).join('');

        // 4. Recommendation & Risk
        document.getElementById('benchmark-data').innerHTML = `
            <div style="padding:15px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                <div style="color:var(--accent); font-weight:bold; font-size:0.8rem; margin-bottom:5px;">AI GUIDANCE</div>
                <p style="margin:0; font-size:0.9rem; line-height:1.4;">${plan.ai_recommendation}</p>
                <div style="margin-top:15px; font-size:0.75rem; color:var(--text-muted);">
                    Activated: ${new Date(plan.timestamp).toLocaleDateString()}
                </div>
            </div>
        `;

    } catch (e) {
        console.error("Strategy load error:", e);
    }
}

async function clearActiveStrategy() {
    if (!confirm("Are you sure you want to clear your current strategy plan? This will stop all active target tracking.")) return;
    try {
        await apiCall('/simulation/strategy/active?company_id=' + localStorage.getItem('manager_id'), 'DELETE');
        alert("Strategy plan cleared.");
        loadStrategyPlan();
    } catch(e) {
        alert("Failed to clear strategy.");
    }
}

async function initPage() {
    loadActiveStrategy();
}

document.addEventListener('DOMContentLoaded', initPage);