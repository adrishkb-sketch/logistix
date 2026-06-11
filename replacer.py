import os

files = [
    r"d:\logistix\frontend\pages\driver_tasks.html",
    r"d:\logistix\frontend\pages\driver_live.html",
    r"d:\logistix\frontend\pages\driver_account.html",
    r"d:\logistix\frontend\pages\driver_chat.html",
    r"d:\logistix\frontend\pages\driver_wallet.html"
]

target_str = '''            <button class="icon-btn" data-i18n="btn_voice_control" id="voice-trigger" onclick="window.logistixVoice.toggle()" title="Voice Control">
                <svg class="icon-md" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </button>'''

replace_str = '''            <button class="icon-btn" data-i18n="btn_voice_control" id="voice-trigger" onclick="window.logistixVoice.toggle()" title="Voice Control">
                <svg class="icon-md" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </button>
            <button class="icon-btn" onclick="if(window.logistixVoice){window.logistixVoice.showInstructions();}" title="Voice Help" style="font-weight:900; font-size:1.4rem;">
                ?
            </button>'''

for f in files:
    try:
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
        if target_str in content and '? ' not in content:
            content = content.replace(target_str, replace_str)
            with open(f, 'w', encoding='utf-8') as file:
                file.write(content)
            print(f"Updated {f}")
        else:
            print(f"Target string not found or already updated in {f}")
    except Exception as e:
        print(f"Error processing {f}: {e}")
