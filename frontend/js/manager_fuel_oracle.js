// Dedicated script for manager_fuel_oracle.html

let fuelTrendChart = null;

async function loadFuelPrices() {
    try {
        const prices = await apiCall('/fuel/prices');
        const list = document.getElementById('fuel-price-list');
        list.innerHTML = '';
        
        Object.keys(prices).forEach(state => {
            const data = prices[state];
            const div = document.createElement('div');
            div.className = 'glass-card';
            div.style.padding = '15px';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.background = 'rgba(255,255,255,0.03)';
            
            // Color based on price
            const isHigh = data.diesel > 90;
            const priceColor = isHigh ? 'var(--danger)' : 'var(--success)';
            
            div.innerHTML = `
                <div>
                    <h4 style="margin:0;">${state}</h4>
                    <small style="color:var(--text-muted)">Petrol: ₹${data.petrol}</small>
                </div>
                <div style="text-align:right;">
                    <div style="color:${priceColor}; font-weight:bold;">₹${data.diesel}</div>
                    <small style="color:var(--text-muted)">Diesel</small>
                </div>
            `;
            list.appendChild(div);
        });
    } catch (e) {
        console.error("Failed to load fuel prices", e);
    }
}

async function runFuelOptimization() {
    const statesInput = document.getElementById('route-states-input').value;
    if (!statesInput) return alert("Please enter states in your route.");
    
    const states = statesInput.split(',').map(s => s.trim());
    
    try {
        const result = await apiCall('/fuel/optimize', 'POST', { states });
        const resDiv = document.getElementById('fuel-optimization-result');
        resDiv.style.display = 'block';
        
        document.getElementById('opt-best-state').innerText = `Optimal Stop: ${result.best_state}`;
        document.getElementById('opt-suggestion').innerText = result.suggestion;
        document.getElementById('opt-savings').innerText = result.potential_savings_per_liter;
        
        // Also update total savings mock
        document.getElementById('fuel-savings-total').innerText = `₹${(result.potential_savings_per_liter * 500).toLocaleString()}`;
    } catch (e) {
        alert("Optimization failed.");
    }
}

function initFuelTrendChart() {
    const ctx = document.getElementById('fuelTrendChart').getContext('2d');
    if (fuelTrendChart) fuelTrendChart.destroy();
    
    const days = Array.from({length: 30}, (_, i) => `Day ${i+1}`);
    const data = Array.from({length: 30}, () => 85 + Math.random() * 10);
    
    fuelTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Avg Diesel Price (India)',
                data: data,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9aa4b2' } },
                x: { grid: { display: false }, ticks: { display: false } }
            }
        }
    });
}

async function initPage() {
    loadFuelPrices();
}

document.addEventListener('DOMContentLoaded', initPage);