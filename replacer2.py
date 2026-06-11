import os
import re

files = [
    r"d:\logistix\frontend\pages\driver_tasks.html",
    r"d:\logistix\frontend\pages\driver_live.html",
    r"d:\logistix\frontend\pages\driver_account.html",
    r"d:\logistix\frontend\pages\driver_chat.html",
    r"d:\logistix\frontend\pages\driver_wallet.html"
]

help_btn = '''
            <button class="icon-btn" onclick="if(window.logistixVoice){window.logistixVoice.showInstructions();}" title="Voice Help" style="font-weight:900; font-size:1.4rem;">
                ?
            </button>'''

pattern = re.compile(r'(<button class="icon-btn" data-i18n="btn_voice_control" id="voice-trigger".*?</button>)', re.DOTALL)

for f in files:
    try:
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
        
        if 'Voice Help' in content and '?' in content:
            print(f"Already updated {f}")
            continue
            
        new_content, count = pattern.subn(r'\1' + help_btn, content)
        
        if count > 0:
            with open(f, 'w', encoding='utf-8') as file:
                file.write(new_content)
            print(f"Updated {f} ({count} replacements)")
        else:
            print(f"Pattern not found in {f}")
    except Exception as e:
        print(f"Error processing {f}: {e}")
