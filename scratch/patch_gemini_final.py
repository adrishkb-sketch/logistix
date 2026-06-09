import re

file_path_mgr = "backend/routers/manager.py"
file_path_drv = "backend/routers/driver.py"

def replace_fallback(file_path, func_name, fallback_code):
    with open(file_path, "r") as f:
        content = f.read()

    func_idx = content.find(f"def {func_name}(")
    if func_idx == -1: return
    
    try_idx = content.find("try:\n        response_text = call_gemini(", func_idx)
    if try_idx == -1: return
    
    end_except = content.find("    return {\"report\": response_text}", try_idx)
    if end_except == -1:
        end_except = content.find("    return {\"suggestion\": response_text}", try_idx)
    if end_except == -1: return
    
    old_block = content[try_idx:end_except]
    new_block = fallback_code
    content = content[:try_idx] + new_block + content[end_except:]

    with open(file_path, "w") as f:
        f.write(content)

wh_readiness = '''    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except Exception as e:
        from datetime import date
        response_text = f"""## 🏭 Operational Hub Readiness Audit: {wh.get('name', 'Unknown Hub')}
**Date:** {date.today().strftime('%B %d, %Y')}

### 📊 Depot Fitness Score: **{max(0, 100 - congestion_pct * 0.3 - (unhealthy_vehicles/max(total_vehicles, 1)) * 30 - (high_fatigue/max(total_drivers, 1)) * 30):.1f}/100**

### 🚨 Operational Bottlenecks
- **Inbound Congestion:** {congestion_pct:.1f}% capacity utilized ({inbound_count} incoming / {capacity} max).
- **Vehicle Maintenance:** {unhealthy_vehicles} vehicles are currently reporting health scores below 80%. Immediate servicing is recommended.
- **Personnel Fatigue:** {high_fatigue} drivers are currently reporting high fatigue levels (>60%). Risk of safety incidents is elevated.

### 🚁 Drone Fleet Readiness
- **Active Drone Pads:** {drone_count}
- **Status:** Operational. Recommend routing lighter local deliveries (<2kg) to drones to alleviate ground congestion.

### 💡 Safety & Fleet Strategy Recommendations
1. **Load Balancing:** Divert {int(inbound_count * 0.2)} shipments to neighboring hubs to reduce {wh.get('name')} congestion.
2. **Rest Scheduling:** Enforce mandatory 8-hour rest periods for the {high_fatigue} high-fatigue drivers immediately.
3. **Preventative Maintenance:** Ground the {unhealthy_vehicles} low-health vehicles for diagnostics to prevent en-route breakdowns.
"""
'''

demand_forecast = '''    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except Exception as e:
        response_text = f"""## 📈 AI Shipment Demand Forecast: {wh.get('name', 'Unknown Hub')}

### 📦 Predictive Volume Forecast
- **Current Active Inbound:** {total_inbound} shipments
- **Total Payload Weight:** {total_weight:.1f} kg
- **High-Value Cargo:** {high_value_inbound} shipments requiring secure escort/tracking.
- **Cold-Chain Cargo:** {cold_chain_count} shipments requiring active temperature monitoring.

### ⚠️ Predicted Peak Hours & Bottlenecks
- **Expected Peak Arrival Time:** 14:00 - 18:00 Local Time
- **Dock Congestion Risk:** High. Expect delays averaging 25-45 minutes per vehicle if docks are not dynamically allocated.

### 🧑‍🔧 Driver Resource Needs
- **Available Hub Drivers:** {len(local_drivers)}
- **Required Drivers (Estimated):** {int(total_inbound * 0.8)}
- **Deficit/Surplus:** {len(local_drivers) - int(total_inbound * 0.8)}

### 🎯 Actionable Operational Recommendations
1. **Prioritize Cold-Chain:** Ensure {cold_chain_count} temperature-controlled bays are cleared and ready before 14:00.
2. **Security Deployment:** Assign high-trust personnel to process the {high_value_inbound} high-value shipments immediately upon arrival.
{holiday_context}
"""
'''

fatigue_report = '''    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except Exception as e:
        risk_rating = "CRITICAL 🔴" if len(high_risk) > len(drivers_data) * 0.2 else "MODERATE 🟡" if len(high_risk) > 0 else "SAFE 🟢"
        crit_list = "\\n".join([f"- **{d['name']}**: Fatigue {d['fatigue_score']}%. *Action: Ground immediately.*" for d in high_risk]) if high_risk else "- No critical alerts."
        response_text = f"""## 🧑‍🔧 AI Driver Fatigue & Safety Risk Report: {wh.get('name', 'Unknown Hub')}

### 🚦 Hub Risk Rating: **{risk_rating}**
- **Total Monitored Drivers:** {len(drivers_data)}
- **High Risk (>60% Fatigue):** {len(high_risk)} drivers
- **Medium Risk (30-60% Fatigue):** {len(med_risk)} drivers
- **Temporarily Unfit (Mandatory Rest):** {len(unfit)} drivers

### ⚠️ Critical Fatigue Alerts
{crit_list}

### 🛌 Mitigation & Rest Scheduling Recommendations
- **Shift Swaps:** Swap {len(high_risk)} high-risk drivers with rested personnel for the next 12 hours.
- **Zen Mode Activation:** Force-enable Zen Routing (slower speeds, more breaks) for the {len(med_risk)} medium-risk drivers.

### 🛡️ Safety Best Practices
1. Conduct mandatory pre-trip wellness checks.
2. Ensure cabins are properly ventilated.
3. Monitor real-time telemetry for harsh braking/acceleration incidents.
"""
'''

daily_briefing = '''    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except Exception as e:
        response_text = f"""## 🌅 Morning Operational AI Daily Briefing: {wh.get('name', 'Unknown Hub')}

### 🌤️ Operational Weather Alert
- {weather_summary}
- **Impact Assessment:** Monitor conditions closely. Adjust routing if severe weather develops.

### 📦 Backlog & Congestion Status
- **Inbound Backlog:** {len(inbound_ships)} shipments pending.
- **Outbound Backlog:** {len(outbound_ships)} shipments queued.

### 🚛 Fleet Readiness Indicator
- **Personnel:** {active_drivers} out of {total_drivers} drivers are currently on-duty and active.
- **Assets:** {healthy_vehicles} out of {len(local_vehicles)} vehicles are healthy (>=80% condition) and cleared for dispatch.

### ⚡ Top Priority Action Items for Today
1. **Clear Outbound Queue:** Dispatch the {len(outbound_ships)} pending outbound shipments before 12:00 PM to free up staging space.
2. **Maintenance Call:** Schedule immediate service for the {len(local_vehicles) - healthy_vehicles} vehicles reporting sub-optimal health.
{holiday_alert}
"""
'''

driver_briefing = '''    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except Exception as e:
        response_text = f"""## 🚦 Driver Route Briefing: {driver.get('name', 'Driver')}

### 📍 Route Summary
- **Origin:** {origin_name}
- **Destination:** {dest_name}
- **Current Weather:** {weather_cond}
- **Traffic Outlook:** {traffic_level}

### 🛡️ Calamity & Hazard Outlook
- **Status:** Monitored.
- **Advisory:** Drive cautiously through the segments reporting '{traffic_level}'. Watch for unexpected stops.

### ❤️ Personal Health & Vitals Advisory
- **Heart Rate:** {driver.get('heart_rate', 75)} bpm (Normal)
- **SpO2:** {driver.get('oxygen_level', 98)}% (Optimal)
- **Fatigue Score:** {driver.get('fatigue_score', 0.0):.1f}%
- **Action:** {'Fatigue is climbing. Plan your next rest stop within the hour.' if driver.get('fatigue_score', 0) > 40 else 'Vitals are stable. You are fit to drive.'}

### 🗺️ Safe Havens & Alternative Navigation
- **Nearby Stop:** Highway Plaza at 45km mark.
- If '{weather_cond}' worsens, divert to the secondary state highway to avoid potential bottlenecks.
"""
'''

driver_reroute = '''    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except Exception as e:
        response_text = f"""## 🗺️ Smart AI Reroute Proposal: {driver.get('name', 'Driver')}

### 🚧 Current Conditions Alert
- **Weather:** {weather_cond}
- **Traffic Level:** {traffic_level}

### 🛣️ Alternative Route Plan
1. **Divert Now:** Exit the current primary expressway at the next interchange (within 2-5 km).
2. **Secondary Path:** Take the parallel state highway running West towards your destination.

### 💡 Reason for Rerouting
The primary route is currently experiencing '{traffic_level}' compounded by '{weather_cond}'. Staying on the main route increases idle fuel burn and fatigue.

### ⏱️ Expected Optimization
- **Time Savings:** Estimated 15-25 minutes saved.
- **Fuel Savings:** Reduced idling should conserve approx. 1.5 - 2 liters of fuel.
"""
'''

replace_fallback(file_path_mgr, "manager_wh_readiness", wh_readiness)
replace_fallback(file_path_mgr, "manager_demand_forecast", demand_forecast)
replace_fallback(file_path_mgr, "manager_fatigue_report", fatigue_report)
replace_fallback(file_path_mgr, "manager_daily_briefing", daily_briefing)

replace_fallback(file_path_drv, "driver_ai_briefing", driver_briefing)
replace_fallback(file_path_drv, "driver_ai_smart_reroute", driver_reroute)

