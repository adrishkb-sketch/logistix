// Dedicated script for manager_leaderboard.html

async function loadLeaderboard() {
    const category = document.getElementById('leader-type').value;
    const sortSelect = document.getElementById('leader-sort');
    
    // Update sort options based on category
    if (category === 'vehicle' && !sortSelect.dataset.isVehicle) {
        sortSelect.innerHTML = `
            <option value="overall">${getTranslation('gen_ranking')}</option>
            <option value="vehicle_health_score">${getTranslation('health_score')}</option>
            <option value="fuel_efficiency">${getTranslation('fuel_efficiency')}</option>
            <option value="distance">${getTranslation('dist_covered')}</option>
            <option value="deliveries">${getTranslation('deliveries_made')}</option>
        `;
        sortSelect.dataset.isVehicle = "true";
    } else if (category === 'driver' && sortSelect.dataset.isVehicle) {
        sortSelect.innerHTML = `
            <option value="overall">${getTranslation('gen_ranking')}</option>
            <option value="safety_index">${getTranslation('safety_index_label')}</option>
            <option value="punctuality_rate">${getTranslation('punctuality_label')}</option>
            <option value="rating">${getTranslation('rating_label')}</option>
            <option value="deliveries">${getTranslation('deliveries_completed_label')}</option>
        `;
        sortSelect.removeAttribute('data-is-vehicle');
    }
    
    const sortBy = sortSelect.value;
    
    try {
        const data = await apiCall(`/manager/leaderboard?category=${category}&sort_by=${sortBy}&company_id=${localStorage.getItem('manager_id')}`);
        const tbody = document.getElementById('leaderboard-body');
        
        tbody.innerHTML = data.map((item, index) => {
            let scoreVal = 0;
            if (category === 'driver') {
                scoreVal = sortBy === 'overall' ? (item.overall_score || 100) : (item[sortBy] !== undefined ? item[sortBy] : 100);
            } else {
                scoreVal = sortBy === 'overall' ? (item.efficiency_score || 100) : (item[sortBy] !== undefined ? item[sortBy] : 100);
            }
            // Format score correctly
            const displayScore = typeof scoreVal === 'number' ? scoreVal.toFixed(1) : scoreVal;

            return `
            <tr>
                <td>#${index + 1}</td>
                <td>
                    <div style="display:flex; gap:10px; align-items:center; cursor:pointer;" onclick="viewFullProfile('${category}', '${item.id}')">
                        <img src="${item.profile_pic || `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.name || item.number_plate}`}" style="width:30px; height:30px; border-radius:50%;">
                        <div>
                            <strong>${item.name || item.number_plate}</strong>
                            ${category === 'driver' ? `<br><small style="color:var(--text-muted)">${getTranslation('stat_deliveries') || 'Deliveries'}: ${item.deliveries_completed || 0}</small>` : ''}
                        </div>
                    </div>
                </td>
                <td><span style="color:var(--accent); font-weight:bold;">${displayScore}</span></td>
                <td>${item.operational_days || 0}</td>
                <td><span class="status-pill" style="font-size:0.7rem;">${item.status}</span></td>
                <td><button class="btn-primary" style="padding:4px 8px; font-size:0.7rem;" onclick="viewFullProfile('${category}', '${item.id}')">${getTranslation('view_profile_btn')}</button></td>
            </tr>
            `;
        }).join('');
    } catch(e) {
        console.error("Leaderboard error:", e);
    }
}

async function viewFullProfile(type, id) {
    try {
        const data = await apiCall(`/manager/${type}s/${id}/profile?company_id=${localStorage.getItem('manager_id')}`);
        const p = data.profile;
        const shipments = data.recent_shipments;
        
        const modal = document.getElementById('profile-modal');
        document.getElementById('prof-image').src = p.profile_pic || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.name || p.number_plate}`;
        document.getElementById('prof-name').innerText = p.name || p.number_plate;
        document.getElementById('prof-sub').innerText = type === 'driver' ? `@${p.login_id || 'user'} | ${(p.license_type || 'regular').toUpperCase()} ${getTranslation('license_label')}` : `${(p.type || 'vehicle').toUpperCase()} | ${getTranslation('health_label')}: ${p.vehicle_health_score || 100}%`;
        
        if (type === 'driver') {
            document.getElementById('prof-stat-1').innerText = `${(p.safety_index || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-2').innerText = `${(p.punctuality_rate || 100).toFixed(1)}%`;
            
            let expMonths = 0;
            if (p.join_date) {
                expMonths = Math.floor((new Date() - new Date(p.join_date)) / (1000 * 60 * 60 * 24 * 30));
            }
            document.getElementById('prof-stat-3').innerText = `${expMonths || 0} ${getTranslation('months_label')}`;
            document.getElementById('prof-stat-4').innerText = `${p.deliveries_completed || 0}`;
            
            let avgRating = 5.0;
            if (p.rating_count && p.rating_count > 0) {
                avgRating = p.total_rating_sum / p.rating_count;
            } else if (p.safety_rating !== undefined) {
                avgRating = p.safety_rating;
            }
            document.getElementById('prof-stat-5').innerText = `${avgRating.toFixed(1)}⭐`;
            document.getElementById('prof-stat-5').style.display = 'block';
            document.getElementById('prof-stat-6').innerText = `₹${p.wallet_balance || 0} / ${p.reward_points || 0} pts`;
            
            document.getElementById('prof-meter-label').innerText = `${getTranslation('fatigue_level_label')}: ${(p.fatigue_score || 0).toFixed(0)}%`;
            const meter = document.getElementById('prof-meter-bar');
            meter.style.width = `${p.fatigue_score || 0}%`;
            meter.style.background = (p.fatigue_score || 0) > 80 ? 'var(--danger)' : 'var(--primary)';

            // Driving Status Logic
            const statusEl = document.getElementById('prof-driving-status');
            const hasActiveShipment = shipments.some(s => s.status === 'in_transit');
            const isResting = p.fatigue_score > 80;
            const hasVehicle = p.vehicle_id !== null;

            if (hasActiveShipment) {
                statusEl.innerText = getTranslation('status_on_road');
                statusEl.style.background = "rgba(16, 185, 129, 0.15)";
                statusEl.style.color = "var(--success)";
            } else if (isResting) {
                statusEl.innerText = getTranslation('status_resting');
                statusEl.style.background = "rgba(79, 140, 255, 0.15)";
                statusEl.style.color = "var(--primary)";
            } else if (hasVehicle) {
                statusEl.innerText = getTranslation('status_ready');
                statusEl.style.background = "rgba(245, 158, 11, 0.15)";
                statusEl.style.color = "var(--warning)";
            } else {
                statusEl.innerText = getTranslation('status_unavailable');
                statusEl.style.background = "rgba(255, 255, 255, 0.05)";
                statusEl.style.color = "var(--text-muted)";
            }
        } else {
            document.getElementById('prof-stat-1').innerText = `${(p.efficiency_score || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-2').innerText = `${p.vehicle_health_score || 100}%`;
            document.getElementById('prof-stat-3').innerText = `${(p.kilometers_covered || 0).toFixed(0)} km`;
            document.getElementById('prof-stat-4').innerText = `${p.deliveries_completed || 0}`;
            document.getElementById('prof-stat-5').innerText = ''; 
            document.getElementById('prof-stat-6').innerText = '';
            
            document.getElementById('prof-meter-label').innerText = getTranslation('fuel_eff_index_label');
            document.getElementById('prof-meter-bar').style.width = '85%';
        }
        
        const tripsBody = document.getElementById('prof-trips-body');
        tripsBody.innerHTML = shipments.map(s => `
            <tr>
                <td>${s.id.substring(0,8)}</td>
                <td>${s.pickup.address.split(',')[0]} → ${s.drop.address.split(',')[0]}</td>
                <td>${new Date(s.created_at).toLocaleDateString()}</td>
                <td><span class="status-pill" style="font-size:0.7rem;">${s.status}</span></td>
            </tr>
        `).join('');
        
        modal.style.display = 'block';
    } catch(e) {
        console.error("Profile view error:", e);
        alert("Could not load full profile data.");
    }
}

async function openDriverProfile(id) {
    const d = globalDrivers.find(item => item.id === id);
    if (!d) return;

    document.getElementById('dp-name').innerText = d.name;
    document.getElementById('dp-id').innerText = `ID: ${d.system_id || d.id.slice(0,8)}`;
    document.getElementById('dp-img').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${d.name}`;
    
    // Status & Duty
    const dutyBadge = document.getElementById('dp-duty-badge');
    const isOnDuty = d.is_on_duty !== false;
    dutyBadge.innerText = isOnDuty ? '🟢 ON DUTY' : '🔴 NOT WORKING';
    dutyBadge.style.background = isOnDuty ? 'var(--success)22' : 'var(--danger)22';
    dutyBadge.style.color = isOnDuty ? 'var(--success)' : 'var(--danger)';

    // Metrics
    document.getElementById('dp-punctuality').innerText = `${d.punctuality_rate || 98}%`;
    document.getElementById('dp-breaks').innerText = d.breaks_taken || 0;
    document.getElementById('dp-rating').innerText = `${d.safety_rating || 5.0} ⭐`;
    document.getElementById('dp-points').innerText = d.reward_points || 0;

    // Fatigue
    const fatigue = d.fatigue_level || 15;
    document.getElementById('dp-fatigue-bar').style.width = `${fatigue}%`;
    document.getElementById('dp-fatigue-bar').style.background = fatigue > 70 ? 'var(--danger)' : (fatigue > 40 ? 'var(--warning)' : 'var(--success)');

    // Vitals
    const health = d.health_metrics || {};
    document.getElementById('dp-heart').innerText = health.heart_rate ? `${health.heart_rate} BPM` : '--';
    document.getElementById('dp-o2').innerText = health.oxygen_level ? `${health.oxygen_level}%` : '--';
    document.getElementById('dp-stress').innerText = health.stress_index || '--';

    document.getElementById('driver-profile-modal').style.display = 'block';
}

async function initPage() {
    loadLeaderboard();
}

document.addEventListener('DOMContentLoaded', initPage);