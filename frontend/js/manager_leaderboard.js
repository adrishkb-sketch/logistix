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
        
        // Handle non-human vehicle profile pic
        let profilePic = p.profile_pic;
        if (type === 'vehicle') {
            const vType = (p.type || 'van').toLowerCase();
            let emoji = '🚐';
            let color = '#4f8cff';
            if (vType.includes('truck')) {
                emoji = '🚚';
                color = '#f59e0b';
            } else if (vType.includes('bike') || vType.includes('scooty') || vType.includes('scooter')) {
                emoji = '🏍️';
                color = '#10b981';
            } else if (vType.includes('drone')) {
                emoji = '🛸';
                color = '#8b5cf6';
            }
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
                <defs>
                    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="${color}" stop-opacity="0.2"/>
                        <stop offset="100%" stop-color="${color}" stop-opacity="0.05"/>
                    </linearGradient>
                </defs>
                <rect width="100" height="100" rx="50" fill="url(#g)" stroke="${color}" stroke-width="2"/>
                <text x="50%" y="62%" font-size="45" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
            </svg>`;
            profilePic = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        } else {
            profilePic = p.profile_pic || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.name}`;
        }
        
        document.getElementById('prof-image').src = profilePic;
        document.getElementById('prof-name').innerText = p.name || p.number_plate;
        document.getElementById('prof-sub').innerText = type === 'driver' ? `@${p.login_id || 'user'} | ${(p.license_type || 'regular').toUpperCase()} ${getTranslation('license_label')}` : `${(p.type || 'vehicle').toUpperCase()} | ${getTranslation('health_label')}: ${p.vehicle_health_score || 100}%`;
        
        if (type === 'driver') {
            // Restore Trips / Hours tab if hidden
            const tabContainer = document.getElementById('prof-tab-container');
            if (tabContainer) tabContainer.style.display = 'block';
            
            document.getElementById('prof-stat-1').innerText = `${(p.safety_index || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-2').innerText = `${(p.punctuality_rate || 100).toFixed(1)}%`;
            
            // Show manually entered years of experience
            document.getElementById('prof-stat-3').innerText = `${p.years_experience || 0} Years`;
            document.getElementById('prof-stat-4').innerText = `${p.total_trips || p.deliveries_completed || 0}`;
            
            let avgRating = 5.0;
            if (p.rating_count && p.rating_count > 0) {
                avgRating = p.total_rating_sum / p.rating_count;
            } else if (p.rating !== undefined) {
                avgRating = p.rating;
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

            if (p.is_on_duty === false) {
                statusEl.innerText = "NOT WORKING";
                statusEl.style.background = "rgba(239, 68, 68, 0.15)";
                statusEl.style.color = "var(--danger)";
            } else if (hasActiveShipment) {
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
            
            // Dynamic Medical Health Card injection and update
            let hCard = document.getElementById('prof-health-card');
            if (!hCard) {
                hCard = document.createElement('div');
                hCard.id = 'prof-health-card';
                hCard.className = 'glass-card';
                hCard.style.cssText = 'padding:15px; background:linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(0, 0, 0, 0)); border: 1px solid rgba(239, 68, 68, 0.2); margin-top: 15px; margin-bottom: 20px; text-align: left;';
                hCard.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <h4 style="margin:0; color:var(--danger);">❤️ Driver Vitals (Smartwatch Live)</h4>
                        <span id="prof-health-status" class="badge" style="background:var(--success); font-size:0.7rem;">FIT TO DRIVE</span>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px;">
                        <div style="text-align:center;">
                            <div style="font-size:0.7rem; color:var(--text-muted);">HEART RATE</div>
                            <div id="prof-health-rate" style="font-size:1.1rem; font-weight:bold; color:var(--danger);">-- BPM</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:0.7rem; color:var(--text-muted);">BLOOD PRESSURE</div>
                            <div id="prof-health-bp" style="font-size:1.1rem; font-weight:bold; color:white;">--/--</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:0.7rem; color:var(--text-muted);">OXYGEN (SpO2)</div>
                            <div id="prof-health-o2" style="font-size:1.1rem; font-weight:bold; color:var(--accent);">--%</div>
                        </div>
                    </div>
                `;
                const targetHeader = document.querySelector('#profile-modal h4:last-of-type') || document.getElementById('prof-trips-body')?.closest('.table-container');
                if (targetHeader) {
                    targetHeader.parentNode.insertBefore(hCard, targetHeader);
                } else {
                    document.getElementById('profile-modal').appendChild(hCard);
                }
            }
            
            if (p.health_metrics) {
                hCard.style.display = 'block';
                document.getElementById('prof-health-rate').innerText = `${p.health_metrics.heart_rate || '--'} BPM`;
                document.getElementById('prof-health-bp').innerText = p.health_metrics.blood_pressure || '--/--';
                document.getElementById('prof-health-o2').innerText = `${p.health_metrics.oxygen || '--'}%`;
                
                const statusBadge = document.getElementById('prof-health-status');
                if (p.is_fit === false) {
                    statusBadge.innerText = "UNFIT (AUDIT)";
                    statusBadge.style.background = "var(--danger)";
                } else {
                    const hr = p.health_metrics.heart_rate;
                    const o2 = p.health_metrics.oxygen;
                    let abnormal = hr < 55 || hr > 110 || o2 < 92;
                    if (p.health_metrics.blood_pressure && p.health_metrics.blood_pressure.includes('/')) {
                        const parts = p.health_metrics.blood_pressure.split('/');
                        const syst = parseInt(parts[0]);
                        const diast = parseInt(parts[1]);
                        if (syst < 90 || syst > 140 || diast < 60 || diast > 95) {
                            abnormal = true;
                        }
                    }
                    if (abnormal) {
                        statusBadge.innerText = "ABNORMAL VITALS";
                        statusBadge.style.background = "var(--danger)";
                    } else {
                        statusBadge.innerText = "FIT TO DRIVE";
                        statusBadge.style.background = "var(--success)";
                    }
                }
            } else {
                hCard.style.display = 'none';
            }
            
            // Dynamic Driving Hours Tab injection
            let tabContainer = document.getElementById('prof-tab-container');
            if (!tabContainer) {
                const oldHeading = document.querySelector('#profile-modal h4:last-of-type');
                if (oldHeading) oldHeading.style.display = 'none';
                
                tabContainer = document.createElement('div');
                tabContainer.id = 'prof-tab-container';
                tabContainer.style.cssText = 'margin-top: 15px; margin-bottom: 15px; text-align: left;';
                tabContainer.innerHTML = `
                    <div style="display:flex; gap:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; margin-bottom:12px;">
                        <span id="prof-btn-trips" style="cursor:pointer; font-weight:bold; color:var(--primary); font-size:1rem; border-bottom:2px solid var(--primary); padding-bottom:6px;" onclick="window.switchProfTab('trips')">Recent Trip History</span>
                        <span id="prof-btn-hours" style="cursor:pointer; font-weight:bold; color:var(--text-muted); font-size:1rem; padding-bottom:6px;" onclick="window.switchProfTab('hours')">Driving Hours</span>
                    </div>
                    <div id="prof-tab-hours-table" class="table-container" style="display:none;">
                        <table style="font-size:0.85rem; width:100%; border-collapse:collapse;">
                            <thead>
                                <tr style="text-align:left; border-bottom:1px solid var(--border);">
                                    <th style="padding:8px;">Trip ID</th>
                                    <th style="padding:8px;">Route</th>
                                    <th style="padding:8px;">Distance</th>
                                    <th style="padding:8px;">Hours Worked</th>
                                </tr>
                            </thead>
                            <tbody id="prof-hours-body"></tbody>
                        </table>
                    </div>
                `;
                const tripsTableContainer = document.getElementById('prof-trips-body').closest('.table-container');
                tripsTableContainer.parentNode.insertBefore(tabContainer, tripsTableContainer);
                tripsTableContainer.id = 'prof-tab-trips-table';
                
                window.switchProfTab = function(tab) {
                    const tripsTable = document.getElementById('prof-tab-trips-table');
                    const hoursTable = document.getElementById('prof-tab-hours-table');
                    const btnTrips = document.getElementById('prof-btn-trips');
                    const btnHours = document.getElementById('prof-btn-hours');
                    if (tab === 'trips') {
                        tripsTable.style.display = 'block';
                        hoursTable.style.display = 'none';
                        btnTrips.style.color = 'var(--primary)';
                        btnTrips.style.borderBottom = '2px solid var(--primary)';
                        btnHours.style.color = 'var(--text-muted)';
                        btnHours.style.borderBottom = 'none';
                    } else {
                        tripsTable.style.display = 'none';
                        hoursTable.style.display = 'block';
                        btnTrips.style.color = 'var(--text-muted)';
                        btnTrips.style.borderBottom = 'none';
                        btnHours.style.color = 'var(--primary)';
                        btnHours.style.borderBottom = '2px solid var(--primary)';
                    }
                };
            }
            
            const tripsTable = document.getElementById('prof-tab-trips-table');
            if (tripsTable) tripsTable.style.display = 'block';
            
            const hoursBody = document.getElementById('prof-hours-body');
            if (hoursBody) {
                const getHaversine = (lat1, lon1, lat2, lon2) => {
                    const R = 6371;
                    const dLat = (lat2-lat1) * Math.PI / 180;
                    const dLon = (lon2-lon1) * Math.PI / 180;
                    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                              Math.sin(dLon/2) * Math.sin(dLon/2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                    return R * c;
                };
                hoursBody.innerHTML = shipments.map(s => {
                    const distVal = getHaversine(s.pickup.lat, s.pickup.lng, s.drop.lat, s.drop.lng);
                    const dist = distVal.toFixed(1) + ' km';
                    const hrs = (s.driving_hours || (distVal / 45.0)).toFixed(1) + ' hrs';
                    const route = `${s.pickup.address || 'Pickup'} → ${s.drop.address || 'Drop'}`;
                    return `
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                            <td style="padding:8px; font-family:monospace;">${s.id.substring(0,8)}</td>
                            <td style="padding:8px;">${route}</td>
                            <td style="padding:8px;">${dist}</td>
                            <td style="padding:8px; font-weight:bold; color:var(--primary);">${hrs}</td>
                        </tr>
                    `;
                }).join('');
            }
            if (window.switchProfTab) window.switchProfTab('trips');
            
        } else {
            // Hide health card and tab container for vehicles
            const hCard = document.getElementById('prof-health-card');
            if (hCard) hCard.style.display = 'none';
            const tabContainer = document.getElementById('prof-tab-container');
            if (tabContainer) tabContainer.style.display = 'none';
            const tripsTable = document.getElementById('prof-tab-trips-table');
            if (tripsTable) tripsTable.style.display = 'block';
            
            document.getElementById('prof-stat-1').innerText = `${(p.efficiency_score || 100).toFixed(1)}%`;
            document.getElementById('prof-stat-2').innerText = `${p.vehicle_health_score || 100}%`;
            document.getElementById('prof-stat-3').innerText = `${(p.total_distance_km || p.kilometers_covered || 0).toFixed(0)} km`;
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