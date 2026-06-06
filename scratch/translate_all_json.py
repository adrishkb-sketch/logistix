import os
import json
import urllib.parse
import requests
import time

# 1. Define the English voice keys and descriptions
en_voice_keys = {
    "voice_instr_analytics": "Open the performance and automated analytics dashboard",
    "voice_instr_contracts": "Open smart contracts and digital escrow listings",
    "voice_instr_dash": "Return to the main overview screen",
    "voice_instr_delivery": "Finalize the drop-off using the customer's OTP",
    "voice_instr_drivers": "Open the verified fleet and driver registry",
    "voice_instr_finance": "Access payments for fund requests and financial reports",
    "voice_instr_fuel_oracle": "Access the Bharat-Fuel and interstate toll price oracle",
    "voice_instr_infrastructure": "Manage your regional warehouses and infrastructure",
    "voice_instr_lang": "Switch between languages",
    "voice_instr_leaderboard": "Open the driver and vehicle performance leaderboards",
    "voice_instr_leaves": "View the centralized leaves and maintenance registry",
    "voice_instr_map": "View live route",
    "voice_instr_messages": "Open the messages panel to chat with fleet personnel",
    "voice_instr_oracle": "Access the strategic planning digital twin oracle",
    "voice_instr_pickup": "Confirm that you have successfully loaded the cargo",
    "voice_instr_receivers": "Open the receivers directory and status board",
    "voice_instr_report": "Report breakdown",
    "voice_instr_resilience": "Run network cascade simulations and health diagnostics",
    "voice_instr_safety": "Monitor driver safety scores and emergency alerts",
    "voice_instr_settings": "Manage database settings and system parameters",
    "voice_instr_shipments": "View the master list of all current and pending shipments",
    "voice_instr_stop": "Turn off voice control",
    "voice_instr_stop_sim": "Stop simulation movement",
    "voice_instr_strategy": "Track current operational strategy implementation",
    "voice_instr_sync_watch": "Synchronize health metrics from wearable smartwatch",
    "voice_instr_toggle_duty": "Change your duty status between Active and Off-Duty",
    "voice_instr_verifications": "Open the ML verification hub for manual reviews",
    "voice_instr_wallet": "Check earnings",
    "voice_instr_weather": "Open the real-time weather and route intelligence map"
}

# 2. Define the Google Translate language map
LANG_MAP = {
    'en':  'en',
    'hi':  'hi',
    'bn':  'bn',
    'te':  'te',
    'mr':  'mr',
    'ta':  'ta',
    'gu':  'gu',
    'kn':  'kn',
    'or':  'or',
    'ml':  'ml',
    'pa':  'pa',
    'as':  'as',
    'mai': 'mai',
    'sat': 'sat',
    'ks':  'ur',    # Kashmiri — closest Google supports
    'ur':  'ur',
    'ne':  'ne',
    'sa':  'sa',
    'sd':  'sd',
    'gom': 'gom',
    'doi': 'doi',
    'mni': 'mni-Mtei'
}

js_dir = "/Users/adrish/Desktop/Projects/logistix/frontend/js"

def translate(text, target_lang):
    if target_lang == 'en':
        return text
    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={target_lang}&dt=t&q={urllib.parse.quote(text)}"
    attempts = 3
    for attempt in range(attempts):
        try:
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            if r.status_code == 200:
                result = r.json()
                return result[0][0][0]
            else:
                print(f"Error {r.status_code} translating '{text}' to {target_lang}, retrying...")
        except Exception as e:
            print(f"Exception translating '{text}' to {target_lang}: {e}, retrying...")
        time.sleep(1)
    return None

# Process each JSON file
for filename in os.listdir(js_dir):
    if filename.endswith(".json") and filename != "en.json":
        lang_code = filename[:-5]
        target_gt_lang = LANG_MAP.get(lang_code, lang_code)
        
        filepath = os.path.join(js_dir, filename)
        print(f"\nProcessing {filename} (target language: {target_gt_lang})...")
        
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        modified = False
        for key, eng_val in en_voice_keys.items():
            existing_val = data.get(key, "").strip()
            
            # Check if key needs translation:
            # - Key not in JSON, or
            # - Key value is equal to English value (which means it's untranslated)
            if not existing_val or existing_val.lower() == eng_val.lower():
                print(f"  Translating key '{key}'...")
                translated = translate(eng_val, target_gt_lang)
                if translated:
                    data[key] = translated
                    modified = True
                    # Small sleep to be nice to Google API
                    time.sleep(0.1)
                else:
                    print(f"  FAILED to translate '{key}'")
            else:
                # Existing value is already translated or modified, keep it
                pass
                
        if modified:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            print(f"Saved changes to {filename}")
        else:
            print(f"No changes needed for {filename}")

print("\nAll files processed successfully!")
