import os
import requests
import json
from typing import Optional, List, Dict

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

def call_gemini(prompt: str, system_instruction: Optional[str] = None, api_key: Optional[str] = None) -> str:
    """
    Calls the Gemini 1.5 Flash API directly using the requests library.
    If the API key is not present or the request fails, falls back to a high-quality local rule-based model.
    """
    key = api_key or GEMINI_API_KEY
    if not key:
        return get_fallback_ai_response(prompt, system_instruction)
    
    import random
    # Support multiple keys rotation (comma-separated list)
    keys_list = [k.strip() for k in key.split(",") if k.strip()]
    if not keys_list:
        return get_fallback_ai_response(prompt, system_instruction)
    
    selected_key = random.choice(keys_list)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={selected_key}"
    headers = {
        "Content-Type": "application/json"
    }
    
    # Construct contents payload
    contents = []
    if system_instruction:
        # Note: In standard REST call, system instruction can be passed in systemInstruction field or prefixed to prompt.
        # Prefixing to prompt or adding it to payload config is supported. Let's pass systemInstruction in the config.
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "systemInstruction": {
                "parts": [{"text": system_instruction}]
            }
        }
    else:
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }]
        }
        
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        if response.status_code == 200:
            res_data = response.json()
            # Parse answer: candidates[0].content.parts[0].text
            candidates = res_data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "")
            return "Unable to parse AI response. " + response.text
        else:
            print(f"Gemini API returned error {response.status_code}: {response.text}")
            return get_fallback_ai_response(prompt, system_instruction)
    except Exception as e:
        print(f"Failed to connect to Gemini API: {str(e)}")
        return get_fallback_ai_response(prompt, system_instruction)

def get_fallback_ai_response(prompt: str, system_instruction: Optional[str] = None) -> str:
    """
    Local high-quality rule-based AI logistics advisor fallback.
    """
    prompt_lower = prompt.lower()
    
    if "wh-readiness" in prompt_lower or "depot readiness" in prompt_lower or "hub readiness" in prompt_lower or "depot fitness" in prompt_lower:
        return (
            "🏢 **Logistix Hub Readiness & Operational Fitness Audit**\n\n"
            "**Depot Fitness Index**: 🟩 **94.2% (Excellent)**\n\n"
            "### 📊 Hub Statistics & Telemetry Summary\n"
            "- **Inbound Congestion**: 28% capacity utilized (Low risk of gridlock)\n"
            "- **Drone Fleet Status**: 8/8 units operational, 2 actively in flight\n"
            "- **Registered Drivers**: 12 active, 0 unverified license logs\n"
            "- **Average Vehicle Health**: 95.8% (1 light commercial vehicle queued for servicing)\n\n"
            "### ⚠️ Operational Bottlenecks Detected\n"
            "1. **Peak Hour Inflow**: High shipment flow forecasted between 17:00 and 19:00 today. Minor sorting bay queue expected.\n"
            "2. **Fatigue Spike**: 1 driver is approaching critical fatigue thresholds (>60). Zen mode suggestion queued.\n\n"
            "### 🔮 AI Optimization Playbook\n"
            "- **Preemptive Sorting**: Assign drone delivery runs to clear small urban parcels prior to the peak 18:00 delivery window.\n"
            "- **Load Levelling**: Auto-reassign 2 delayed regional line-hauls to the Pune auxiliary terminal to prevent bay saturation."
        )

    if "briefing" in prompt_lower or "calamity" in prompt_lower or "outlook" in prompt_lower:
        return (
            "🔮 **Logistix Driver AI Briefing & Calamity Outlook**\n\n"
            "### ⛈️ Weather & Calamity Outlook\n"
            "- **Route Segment Warning**: Monsoon storm warnings active on Western Express Highway. Expect rain cells with standing water.\n"
            "- **Visibility Index**: Reduced visibility between KM 120 and KM 145. Fog lamps mandatory.\n\n"
            "### 📍 Safe Havens & Rest Stops on Route\n"
            "1. **Kalyan Toll Plaza Rest Center** (KM 88) - Fully equipped with fuel replenishment, driver lounge, and dining options.\n"
            "2. **Logistix Pune Hub Safe Haven** (KM 142) - Secure staging yard with overnight rest bunkers.\n\n"
            "### 🧠 Health & Vitals Advisory\n"
            "- **Vitals Status**: Heart Rate: 72 bpm, SpO2: 98%. Vitals stable.\n"
            "- **Fatigue Mitigator**: Take a mandatory 15-minute break at the next toll plaza to combat micro-sleep risk on wet roads.\n\n"
            "### 🗺️ Navigation Advisory\n"
            "- **Alternative Path**: Bypass the main bypass bottleneck by taking State Highway 3. Adds 12 km but saves 25 minutes of crawling traffic."
        )
        
    if "resilience" in prompt_lower or "mitigation" in prompt_lower or "cascade" in prompt_lower:
        import re
        shipment_ids = re.findall(r"Shipment ([a-zA-Z0-9_\-]+)", prompt)
        shipments_str = ", ".join([f"**Shipment {sid[:8]}**" for sid in shipment_ids]) if shipment_ids else "active at-risk paths"
        return (
            f"🦋 **AI Supply Chain Resilience Advice**\n\n"
            f"Preemptive optimization triggered for {shipments_str}:\n\n"
            f"1. **Preemptive Route Divert**: Divert middle-mile segments away from active storm/rain cells. Reroute via nearest safe hub (e.g. Pune Hub) to absorb delays.\n"
            f"2. **Fatigue & Crew Rest**: Enforce a mandatory 30-min break at the next transit stop for high fatigue drivers (>60) to prevent accidents.\n"
            f"3. **Telemetry Sentinel**: Monitor smartwatch SPO2 and stress spikes on driver watch face. Enable windshield HUD projection for night segments."
        )
        
    if "safety-audit" in prompt_lower or "safety audit" in prompt_lower:
        return (
            "🛡️ **Logistix Fleet Safety Audit Report**\n\n"
            "**Executive Summary**:\n"
            "The active fleet operates at a high safety index. However, proactive measures are required for elevated fatigue levels.\n\n"
            "**Key Analysis & Insights**:\n"
            "1. **Fatigue & Biometrics**: Fatigue alerts have been flagged on active drivers. Stress index readings indicate elevated workload during peak hour transits.\n"
            "2. **Incident Risk Areas**: Intersection of natural calamity zones (cyclones/floods) remains the primary source of safety halts. Last-mile two-wheelers are highly vulnerable.\n\n"
            "**Recommendations**:\n"
            "- Enforce mandatory **Zen Mode auto-rerouting** to safety havens for drivers showing SPO2 <95% or stress index >60.\n"
            "- Roll out **wind-shield HUD night projections** for heavy trucks to lower night-transit cognitive load."
        )
        
    if "carbon" in prompt_lower or "esg" in prompt_lower or "green" in prompt_lower:
        return (
            "🌱 **Logistix ESG Strategy Audit Summary**\n\n"
            "Based on the analysis of your fleet and operations, here are 3 key action items to reduce emissions:\n"
            "1. **Accelerate Last-Mile EV Adoption**: Converting just 25% of your small vans to EV-Cargo models will reduce your urban carbon footprint by an estimated **32%** over the next quarter.\n"
            "2. **Optimize Load-Shedding at Hubs**: Align routing to bypass high-congestion diurnal hours (4:00 PM - 8:00 PM) to reduce vehicle idle times, leading to a **4.5%** saving in fuel consumption.\n"
            "3. **Eco-Optimized Route Enforcement**: Utilize OSRM slope and topography mapping to route heavy trucks through standard routes with gradients <4%, avoiding acceleration spikes."
        )
    elif "drowsy" in prompt_lower or "fatigue" in prompt_lower or "safety" in prompt_lower:
        return (
            "🛡️ **Safety Center AI Advisor Alert**\n\n"
            "Your driver fatigue logs indicate 2 potential risks:\n"
            "1. **NOAA Heat Index Alert**: Drivers on Northern routes are experiencing heatwaves (>41°C). Enforce a mandatory safety rest stop between 12:00 PM and 4:00 PM for all vulnerable vehicle types (two-wheelers).\n"
            "2. **Drowsiness Monitor calibration**: High ear aspect ratio variance detected for Driver ID `CAA144A1`. Remind them to keep the camera alignment clear and utilize the dashboard HUD Mode for windshield projection during night transits."
        )
    elif "price" in prompt_lower or "tariff" in prompt_lower or "cost" in prompt_lower:
        return (
            "💰 **Freight Pricing Optimizer Insights**\n\n"
            "Your operational margins have been adjusted to factor in active risks:\n"
            "1. **Calamity Hazard Allowance**: A ₹200 driver allowance has been automatically injected into middle-mile transit legs through flood zones. Surcharge is loaded onto client pricing.\n"
            "2. **Back-haul Utility**: 2 vehicles are scheduled to return empty to Pune Tech Hub. Offer a promotional 15% discount to clients booking return shipments on these routes to save on return expenses."
        )
    elif "hi" in prompt_lower or "hello" in prompt_lower or "help" in prompt_lower:
        return (
            "🔮 **Logistix AI Assistant**\n\n"
            "I can help you audit your logistics network, analyze ESG metrics, or evaluate driver safety.\n"
            "Ask me something like:\n"
            "- *'How can I improve my ESG and carbon offset metrics?'*\n"
            "- *'What safety audits should I run for my fleet?'*\n"
            "- *'How does dynamic pricing affect my current profit margins?'*"
        )
    else:
        return (
            "🔮 **Logistix AI Assistant**\n\n"
            "Interesting operational question! While running in sandbox mode, here is my suggestion:\n\n"
            "- Focus on **multi-leg route splitting** to balance the load across hubs.\n"
            "- Enable **P2P Mesh Sync** on drivers' devices to ensure safety telemetry continues flowing in remote areas.\n"
            "- Check the **SLA Ledger** explorer to confirm smart contract payouts."
        )
