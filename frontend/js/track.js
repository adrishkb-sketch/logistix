document.getElementById('track-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('shipment-id').value.trim();
    const resultDiv = document.getElementById('result');
    
    try {
        resultDiv.style.display = 'none';
        const data = await apiCall(`/tracking/${id}`);
        const s = data.shipment;
        
        let alertsHtml = '';
        if (data.alerts && data.alerts.length > 0) {
            alertsHtml = `<div style="background:rgba(255,75,75,0.2); padding:10px; border-radius:8px; margin-top:15px; border-left:4px solid var(--danger);">
                <small style="color:var(--danger)"><b>Live Alert:</b> ${data.alerts[0].description}</small>
            </div>`;
        }

        const expectedFormat = s.expected_delivery ? new Date(s.expected_delivery).toLocaleString() : 'TBD';

        resultDiv.innerHTML = `
            <h3 style="margin-bottom:10px;">Status: <span class="badge ${s.status}">${s.status.toUpperCase()}</span></h3>
            <p style="color:var(--text-muted); margin-bottom:10px;">${s.description}</p>
            <hr style="border-color:var(--card-border); margin: 15px 0;">
            <p><b>Expected Delivery:</b> ${expectedFormat}</p>
            
            <div class="timeline">
                <div class="timeline-item">
                    <p><b>Order Created</b></p>
                    <small style="color:var(--text-muted)">We received your order details.</small>
                </div>
                ${s.status !== 'pending' ? `
                <div class="timeline-item">
                    <p><b>Dispatched</b></p>
                    <small style="color:var(--text-muted)">Assigned to route.</small>
                </div>` : ''}
                ${s.status === 'in_transit' || s.status === 'delivered' ? `
                <div class="timeline-item">
                    <p><b>In Transit</b></p>
                    <small style="color:var(--text-muted)">On the way to destination.</small>
                </div>` : ''}
                ${s.status === 'delivered' ? `
                <div class="timeline-item">
                    <p><b>Delivered</b></p>
                    <small style="color:var(--success)">Successfully delivered.</small>
                </div>` : ''}
            </div>
            
            ${alertsHtml}
        `;
        resultDiv.style.display = 'block';
    } catch(err) {
        // apiCall handles alert for 404
        resultDiv.style.display = 'none';
    }
});
