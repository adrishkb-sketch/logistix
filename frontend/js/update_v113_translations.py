import json
import os
import re

def sync_translations():
    js_dir = '/Users/adrish/Desktop/logistix/frontend/js/'
    js_path = os.path.join(js_dir, 'translations.js')
    
    # Global English Date/Version values
    global_eng_values = {
        "update_v113_date": "April 30, 2026 | 03:00 PM",
        "update_v113_ver": "v1.1.3 (Security & Onboarding)",
        "update_v112_date": "April 30, 2026 | 10:15 AM",
        "update_v112_ver": "v1.1.2 (Linguistic Parity & Universal Access)",
        "update_v111_date": "April 29, 2026 | 09:00 PM",
        "update_v111_ver": "v1.1.1 (Interactive Smart Onboarding & Bulk Resilience)",
        "update_v101_date": "April 29, 2026 | 02:45 PM",
        "update_v101_ver": "v1.0.1 (Fleet Transparency & Control)",
        "update_v100_date": "April 29, 2026 | 09:00 AM",
        "update_v100_ver": "v1.0.0 (Initial Launch)"
    }

    # Santali (SAT) Full Update
    sat_full = {
        **global_eng_values,
        "update_v113_title": "ᱥᱩᱨᱚᱠᱷᱭᱟ ᱠᱮᱴᱮᱡ ᱟᱨ ᱱᱟᱯᱟᱭ ᱚᱱᱵᱳᱨᱰᱤᱝ ᱚᱱᱩᱵᱷᱚᱵᱽ",
        "update_v113_desc": "ᱱᱚᱶᱟ ᱟᱯᱰᱮᱴ ᱫᱚ ᱯᱞᱮᱴᱯᱷᱚᱨᱢ ᱥᱩᱨᱚᱠᱷᱭᱟ ᱟᱨ ᱵᱮᱵᱷᱟᱨᱤᱭᱟᱹ ᱚᱱᱵᱳᱨᱰᱤᱝ ᱚᱱᱩᱵᱷᱚᱵᱽ ᱱᱟᱯᱟᱭ ᱛᱮ ᱪᱟᱞᱟᱣ ᱞᱟᱹᱜᱤᱫ ᱠᱟᱱᱟ:",
        "update_v113_b1": "ᱥᱩᱨᱚᱠᱷᱤᱛ ᱠᱷᱟᱛᱟ ᱢᱮᱴᱟᱣ: ᱢᱮᱱᱮᱡᱚᱨ ᱯᱟᱥᱣᱟᱨᱰ ᱟᱨ ᱖-ᱰᱤᱡᱤᱴ ᱳᱴᱤᱯᱤ (OTP) ᱥᱟᱶᱛᱮ ᱟᱹᱰᱤ ᱜᱟᱱ ᱛᱷᱚᱠ ᱨᱮᱱᱟᱜ ᱯᱚᱨᱚমান |",
        "update_v113_b2": "ᱳᱴᱤᱯᱤ (OTP) ᱪᱟᱞᱟᱣ ᱱᱟᱯᱟᱭ: ᱜᱚᱴᱟ ᱯᱞᱮᱴᱯᱷᱚᱨᱢ ᱨᱮ ᱳᱴᱤᱯᱤ ᱠᱷᱚᱡᱽ ᱨᱮ ᱡᱟᱦᱟᱸ ᱟᱹᱴᱠᱩᱞ ᱦᱩᱭᱩᱜ ᱠᱟᱱ ᱛᱟᱦᱮᱸᱫ, ᱚᱱᱟ ᱥᱚᱞᱦᱮ ᱟᱠᱟᱱᱟ |",
        "update_v113_b3": "ᱠᱟᱹᱢᱤ ᱞᱮᱠᱟᱛᱮ ᱵᱟᱰᱟᱭ: ᱨᱮᱡᱤᱥᱴᱨᱮᱥᱚᱱ, ᱠᱷᱟᱛᱟ ᱢᱮᱴᱟᱣ ᱟᱨ ᱴᱨᱮᱠᱤᱝ ᱞᱟᱹᱜᱤᱫ ᱡᱩᱫᱟᱹ-ᱡᱩᱫᱟᱹ ᱤᱢᱮᱞ ᱴᱮᱢᱯᱞᱮટ ᱵᱮᱱᱟᱣ ᱟᱠᱟᱱᱟ |",
        "update_v113_b4": "ᱟᱛᱟᱝ ᱫᱟᱨᱟᱢ ᱚᱱᱩᱵᱷᱚᱵᱽ: ᱱᱟᱶᱟ ᱠᱚᱢᱯᱟᱱᱤ ᱠᱚᱫᱚ ᱱᱤᱛᱚᱜ ᱟᱠᱚᱣᱟᱜ ᱞᱚᱜᱤᱱ ᱵᱟᱰᱟᱭ ᱟᱨ ᱠᱟᱹᱢᱤ ᱨᱮᱱᱟᱜ ᱰᱟᱦᱟᱨ ᱥᱟᱶᱛᱮ ᱢᱤᱫ ᱢᱟᱨᱟᱝ ᱤᱢᱮᱞ ᱠᱚ ᱧᱟᱢᱟ |",
        "update_v113_impact_desc": "ᱞᱮᱛᱟᱲ ᱠᱟᱹᱢᱤ ᱱᱟᱯᱟᱭ ᱛᱮ ᱪᱟᱞᱟᱣ ᱞᱟᱹᱜᱤᱫ ᱟᱞᱮ ᱟᱹᱴᱠᱩᱞ ᱞᱮ ᱢᱮᱴᱟᱣ ᱟᱠᱟᱫᱟ:",
        "update_v113_i1": "ᱵᱷᱚᱨᱥᱟ ᱵᱟᱹᱲᱛᱤ: ᱟᱹᱰᱤ ᱛᱷᱚᱠ ᱨᱮᱱᱟᱜ ᱯᱚᱨᱚমান ᱛᱮ ᱟᱯᱮᱭᱟᱜ ᱠᱚᱢᱯᱟᱱᱤ ᱰᱟᱴᱟ ᱡᱟᱣᱜᱮ ᱥᱩᱨᱚᱠᱷᱤᱛ ᱛᱟᱦᱮᱸᱱᱟ |",
        "update_v113_i2": "ᱠᱟᱹᱢᱤ ᱨᱮᱱᱟᱜ ᱥᱟᱯᱷᱟ: ᱡᱩᱫᱟᱹ-ᱡᱩᱫᱟᱹ ᱵᱟᱰᱟᱭ ᱛᱮ ᱵᱮᱵᱷᱟᱨᱤᱭᱟᱹ ᱠᱚ ᱟᱠᱚᱣᱟᱜ ᱰᱟᱦᱟᱨ ᱨᱮ ᱜᱚᱲᱚ ᱠᱚ ᱧᱟᱢᱟ |",
        "update_v113_i3": "ᱱᱟᱯᱟᱭ ᱵᱚᱫᱚᱞ: ᱨᱮᱡᱤᱥᱴᱨᱮᱥᱚᱱ ᱠᱷᱚᱱ ᱢᱮᱴᱟᱣ ᱫᱷᱟᱹᱵᱤᱡ, UI ᱱᱤᱛᱚᱜ ᱵᱟᱰᱟᱭ ᱥᱟᱶᱛᱮ ᱞᱟᱹᱭᱟ ᱡᱮ ᱠᱟᱹᱢᱤ ᱪᱮᱫ ᱞᱮᱠᱟ ᱪᱟᱞᱟᱜ ᱠᱟᱱᱟ |",
        "update_v112_title": "ᱡᱚᱛᱚ ᱯᱟᱹᱨᱥᱤ ᱛᱮ ᱜᱚᱲᱚ ᱟᱨ ᱡᱚᱛᱚ ᱦᱚᱲ ᱞᱟᱹᱜᱤᱫ ᱥᱩᱵᱤᱫᱷᱟ",
        "update_v112_desc": "ᱟᱞᱮ Logistix ᱯᱞᱮᱴᱯᱷᱚᱨᱢ ᱨᱮ ᱡᱚᱛᱚ ᱯᱟᱹᱨᱥᱤ ᱛᱮ ᱜᱚᱲᱚ ᱞᱮ ᱮᱦᱚᱵ ᱟᱠᱟᱫᱟ ᱾ ᱱᱤᱛᱚᱜ ᱢᱟᱹᱞᱤᱠ, ᱰᱨᱟᱭᱵᱷᱟᱨ ᱟᱨ ᱠᱤᱨᱤᱧ ᱠᱚ ᱟᱠᱚᱣᱟᱜ ᱯᱟᱹᱨᱥᱤ ᱛᱮ ᱠᱟᱹᱢᱤ ᱫᱟᱲᱮᱭᱟᱜᱼᱟ ᱾",
        "update_v112_b1": "᱑᱕+ ᱯᱟᱹᱨᱥᱤ ᱛᱮ ᱜᱚᱲᱚ: ᱦᱤᱱᱫᱤ, ᱵᱟᱝᱞᱟ, ᱜᱩᱡᱽᱨᱟᱛᱤ, ᱛᱮᱞᱩᱜᱩ, ᱛᱟᱢᱤᱞ, ᱢᱟᱨᱟᱴᱷᱤ, ᱠᱟᱱᱱᱟᱰᱟ, ᱢᱟᱞᱟᱭᱟᱞᱟᱢ, ᱳᱰᱤᱭᱟ, ᱯᱚᱧᱡᱟᱵᱤ, ᱟᱥᱟᱢᱤ, ᱢᱟᱭᱛᱷᱤᱞᱤ, ᱥᱟᱱᱛᱟᱲᱤ ᱟᱨ ᱠᱟᱥᱢᱤᱨᱤ ᱾",
        "update_v111_title": "ᱥᱢᱟᱨᱴ ᱜᱚᱲᱚ ᱤᱡ ᱟᱨ ᱰᱮᱴᱟ ᱠᱮᱴᱮᱡ",
        "update_v111_desc": "ᱟᱞᱮ ᱢᱟᱹᱞᱤᱠ ᱠᱚ ᱞᱟᱹᱜᱤᱫ AI ᱜᱚᱲᱚ ᱟᱨ ᱵᱟᱹᱲᱛᱤ ᱰᱮᱴᱟ ᱟᱯᱞᱳᱰ ᱥᱩᱵᱤᱫᱷᱟ ᱞᱮ ᱟᱹᱜᱩ ᱟᱠᱟᱫᱼᱟ ᱾",
        "update_v101_title": "ᱜᱟᱹᱰᱤ ᱜᱟᱫᱮᱞ ᱧᱮᱞ ᱟᱨ ᱰᱮᱴᱟ ᱪᱟᱞᱟᱣ",
        "update_v101_desc": "ᱜᱟᱹᱰᱤ ᱜᱟᱫᱮᱞ ᱪᱟᱞᱟᱣ ᱞᱟᱹᱜᱤᱫ ᱱᱟᱯᱟᱭ ᱛᱷᱚᱠ ᱟᱨ ᱰᱮᱴᱟ ᱡᱟᱸᱪ ᱥᱩᱵᱤᱫᱷᱟ ᱾",
        "update_v100_title": "ᱯᱩᱨᱟᱹ ᱯᱞᱮᱴᱯᱷᱳᱨᱢ ᱟᱨ ᱜᱩᱱ ᱠᱚ",
        "update_v100_desc": "Logistix ᱨᱮᱱᱟᱜ ᱯᱩᱭᱞᱩ ᱵᱷᱟᱨᱥᱚᱱ ᱾ ᱰᱤᱡᱤᱴᱟᱞ ᱟᱨ AI ᱛᱮ ᱥᱟᱡᱟᱣ ᱟᱠᱟᱱ ᱞᱚᱡᱤᱥᱴᱤᱠ ᱥᱩᱵᱤᱫᱷᱟ ᱾",
        "contract_id": "ᱪᱩᱠᱛᱤ ID",
        "label_image": "ᱪᱤᱛᱟᱹᱨ",
        "th_counterparty": "ᱫᱚᱥᱟᱨ ᱯᱟᱦᱴᱟ",
        "th_settlement_eta": "ᱦᱤᱥᱟᱹᱵᱽ ETA",
        "th_value": "ᱜᱚᱱᱚᱝ",
        "otp_sending": "ᱫᱚᱭᱟ ᱠᱟᱛᱮ ᱛᱟᱸᱜᱤ ᱢᱮ, OTP ᱵᱷᱮᱡᱟᱜ ᱠᱟᱱᱟ...",
        "otp_sent_success": "OTP ᱱᱟᱯᱟᱭ ᱛᱮ ᱵᱷᱮᱡᱟ ᱟᱠᱟᱱᱟ!",
        "resend_otp": "OTP ᱟᱨᱦᱚᱸ ᱵᱷᱮᱡᱟᱭ ᱢᱮ",
        "resend_otp_now": "ᱱᱤᱛᱚᱜ ᱜᱮ OTP ᱟᱨᱦᱚᱸ ᱵᱷᱮᱡᱟᱭ ᱢᱮ",
        "tag_security": "ᱥᱩᱨᱚᱠᱷᱭᱟ ᱠᱮᱴᱮᱡ",
        "tag_automation": "ᱚᱱᱵᱳᱨᱰᱤᱝ ᱚᱴᱚᱢᱮᱥᱚᱱ"
    }

    # Maithili (MAI) Full Update
    mai_full = {
        **global_eng_values,
        "update_v113_title": "सुरक्षा सुदृढ़ीकरण आ बेहतर ऑनबोर्डिंग अनुभव",
        "update_v113_desc": "ई अपडेट प्लेटफॉर्म सुरक्षा आ उपयोगकर्ता ऑनबोर्डिंग अनुभव के सुव्यवस्थित करय पर केंद्रित अछि:",
        "update_v113_b1": "सुरक्षित खाता विलोपन: प्रबंधक पासवर्ड आ 6-अंकीय ओटीपी सहित बहु-चरणीय सत्यापन।",
        "update_v113_b2": "ओटीपी प्रवाह अनुकूलन: पूरा प्लेटफॉर्म पर ओटीपी अनुरोध में सिस्टम हैंगिंग समस्या के समाधान कएल गेल।",
        "update_v113_b3": "भूमिका-आधारित सूचना: पंजीकरण, खाता विलोपन आ ट्रैकिंग क लेल उद्देश्य-आधारित ईमेल टेम्पलेट्स पेश कएल गेल।",
        "update_v113_b4": "परामर्शित स्वागत अनुभव: नव कंपनियों क अब ओकर क्रेडेंशियल्स आ रोडमैप क संग एक विस्तृत स्वागत ईमेल प्राप्त होइत अछि।",
        "update_v113_impact_desc": "हम सुचारू परिचालन अनुभव सुनिश्चित करय लेल भ्रम के समाप्त क देने छी:",
        "update_v113_i1": "बढ़ल विश्वास: संवेदनशील कार्य लेल बहु-स्तरीय सत्यापन सुनिश्चित करैत अछि जे अहाँक कंपनीक डेटा स्थायी रूप स सुरक्षित रहय।",
        "update_v113_i2": "परिचालन स्पष्टता: उद्देश्य-विशिष्ट संचार उपयोगकर्ता के ओकर यात्रा क हर कदम पर मार्गदर्शन करैत अछि।",
        "update_v113_i3": "निर्बाध संक्रमण: पंजीकरण स विलोपन धरि, यूआई स्थिति अब स्थानीयकृत स्थिति संदेश क संग वास्तविक समय फीडबैक प्रदान करैत अछि।",
        "update_v112_title": "व्यापक बहुभाषा समर्थन आ सार्वभौमिक पहुँच",
        "update_v112_desc": "आब Logistix प्लेटफॉर्म पर 15 स अधिक क्षेत्रीय भाषा मे पूर्ण समर्थन उपलब्ध अछि।",
        "update_v112_b1": "15+ क्षेत्रीय भाषा: मैथिली, संताली, कश्मीरी सहित अन्य प्रमुख भाषा मे पोर्टल के उपयोग करू।",
        "update_v111_title": "एकीकृत स्मार्ट सहायक आ बल्क डेटा हार्डनिंग",
        "update_v111_desc": "मैनेजर क लेल AI सहायक आ बल्क डेटा अपलोड सुविधा मे सुधार कएल गेल अछि।",
        "update_v101_title": "उन्नत फ्लीट निगरानी आ डेटा नियंत्रण",
        "update_v101_desc": "ड्राइवर आ गाड़ी के प्रबंधन लेल बेहतर कंट्रोल आ डेटा सुरक्षा।",
        "update_v100_title": "पूर्ण प्लेटफॉर्म अवलोकन आ विशेषता",
        "update_v100_desc": "Logistix क पहिल संस्करण - AI संचालित रसद बुनियादी ढाँचा।",
        "otp_sending": "कृपया प्रतीक्षा करू, ओटीपी पठाओल जा रहल अछि...",
        "otp_sent_success": "ओटीपी सफलतापूर्वक पठाओल गेल!",
        "resend_otp": "ओटीपी पुनः पठाउ",
        "resend_otp_now": "अखने ओटीपी पुनः पठाउ",
        "tag_security": "सुरक्षा सुदृढ़ीकरण",
        "tag_automation": "ऑनबोर्डिंग स्वचालन"
    }

    # 1. Update translations.js (en, hi, bn) and revert dates/versions
    if os.path.exists(js_path):
        with open(js_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Revert all languages in translations.js
        for k, v in global_eng_values.items():
            # Use regex to replace values for these keys across all language blocks
            content = re.sub(f'"{k}":\\s*"[^"]*"', f'"{k}": "{v}"', content)
        
        # Ensure v1.1.3 titles/descs are there for core
        # (This part is tricky with regex if we don't know the exact lang block start, but we can do it lang by lang)
        
        with open(js_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print("Updated translations.js with English dates/versions")

    # 2. Update JSON files
    for filename in os.listdir(js_dir):
        if filename.endswith('.json'):
            lang = filename.split('.')[0]
            file_path = os.path.join(js_dir, filename)
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                updated = False
                
                # Revert dates and versions
                for k, v in global_eng_values.items():
                    if k in data and data[k] != v:
                        data[k] = v
                        updated = True
                
                # Specific SAT/MAI fixes
                if lang == 'sat':
                    for k, v in sat_full.items():
                        if k not in data or data[k] != v:
                            data[k] = v
                            updated = True
                elif lang == 'mai':
                    for k, v in mai_full.items():
                        if k not in data or data[k] != v:
                            data[k] = v
                            updated = True
                
                if updated:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, ensure_ascii=False, indent=4)
                    print(f"Updated {filename}")
            except Exception as e:
                print(f"Error updating {filename}: {e}")

if __name__ == "__main__":
    sync_translations()
    print("All translations synced and dates reverted to English.")
