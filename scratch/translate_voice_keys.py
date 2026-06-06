import json
import os

hi_path = "/Users/adrish/Desktop/Projects/logistix/frontend/js/hi.json"
bn_path = "/Users/adrish/Desktop/Projects/logistix/frontend/js/bn.json"

hi_translations = {
    "voice_instr_dash": "मुख्य अवलोकन स्क्रीन पर वापस जाएं",
    "voice_instr_pickup": "पुष्टि करें कि आपने कार्गो को सफलतापूर्वक लोड कर लिया है",
    "voice_instr_delivery": "ग्राहक के ओटीपी का उपयोग करके ड्रॉप-ऑफ को अंतिम रूप दें",
    "voice_instr_shipments": "सभी वर्तमान और लंबित शिपमेंट की मास्टर सूची देखें",
    "voice_instr_analytics": "प्रदर्शन और स्वचालित विश्लेषणात्मक डैशबोर्ड खोलें",
    "voice_instr_finance": "फंड अनुरोधों और वित्तीय रिपोर्टों के लिए भुगतान तक पहुंचें",
    "voice_instr_safety": "ड्राइवर सुरक्षा स्कोर और आपातकालीन अलर्ट की निगरानी करें",
    "voice_instr_stop": "वॉयस कंट्रोल बंद करें",
    "voice_instr_infrastructure": "अपने क्षेत्रीय गोदामों और बुनियादी ढांचे का प्रबंधन करें",
    "voice_instr_receivers": "प्राप्तकर्ता निर्देशिका और स्थिति बोर्ड खोलें",
    "voice_instr_drivers": "सत्यापित बेड़े और ड्राइवर रजिस्ट्री खोलें",
    "voice_instr_weather": "वास्तविक समय मौसम और मार्ग खुफिया मानचित्र खोलें",
    "voice_instr_leaderboard": "ड्राइवर और वाहन प्रदर्शन लीडरबोर्ड खोलें",
    "voice_instr_messages": "बेड़े के कर्मचारियों के साथ चैट करने के लिए संदेश पैनल खोलें",
    "voice_instr_verifications": "मैन्युअल समीक्षाओं के लिए एमएल सत्यापन हब खोलें",
    "voice_instr_contracts": "स्मार्ट अनुबंध और डिजिटल एस्क्रो लिस्टिंग खोलें",
    "voice_instr_oracle": "रणनीतिक योजना डिजिटल ट्विन ओरेकल तक पहुंचें",
    "voice_instr_fuel_oracle": "भारत-ईंधन और अंतरराज्यीय टोल मूल्य ओरेकल तक पहुंचें",
    "voice_instr_strategy": "वर्तमान परिचालन रणनीति कार्यान्वयन को ट्रैक करें",
    "voice_instr_resilience": "नेटवर्क कैस्केड सिमुलेशन और स्वास्थ्य निदान चलाएं",
    "voice_instr_settings": "डेटाबेस सेटिंग्स और सिस्टम पैरामीटर प्रबंधित करें",
    "voice_instr_leaves": "केंद्रीकृत छुट्टी और रखरखाव रजिस्ट्री देखें",
    "voice_instr_toggle_duty": "सक्रिय और कर्तव्य-मुक्त के बीच अपनी कर्तव्य स्थिति बदलें",
    "voice_instr_sync_watch": "पहनने योग्य स्मार्टवॉच से स्वास्थ्य मेट्रिक्स सिंक करें"
}

bn_translations = {
    "voice_instr_dash": "প্রধান ওভারভিউ স্ক্রিনে ফিরে যান",
    "voice_instr_pickup": "আপনি সফলভাবে পণ্য লোড করেছেন তা নিশ্চিত করুন",
    "voice_instr_delivery": "গ্রাহকের ওটিপি ব্যবহার করে ডেলিভারি চূড়ান্ত করুন",
    "voice_instr_shipments": "সমস্ত বর্তমান এবং মুলতুবি শিপমেন্টের তালিকা দেখুন",
    "voice_instr_analytics": "পারফরম্যান্স এবং স্বয়ংক্রিয় অ্যানালিটিক্স ড্যাশবোর্ড খুলুন",
    "voice_instr_finance": "তহবিল অনুরোধ এবং আর্থিক প্রতিবেদনের জন্য পেমেন্ট অ্যাক্সেস করুন",
    "voice_instr_safety": "ড্রাইভারের নিরাপত্তা স্কোর এবং জরুরি সতর্কতা পর্যবেক্ষণ করুন",
    "voice_instr_stop": "ভয়েস কন্ট্রোল বন্ধ করুন",
    "voice_instr_infrastructure": "আপনার গুদাম এবং অবকাঠামো পরিচালনা করুন",
    "voice_instr_receivers": "গ্রাহক ডিরেক্টরি এবং স্ট্যাটাস বোর্ড খুলুন",
    "voice_instr_drivers": "সত্যাপন করা ফ্লিট এবং ড্রাইভার রেজিস্ট্রি খুলুন",
    "voice_instr_weather": "রিয়েল-টাইম আবহাওয়া এবং রুট ইন্টেলিজেন্স ম্যাপ খুলুন",
    "voice_instr_leaderboard": "ড্রাইভার এবং যানবাহনের পারফরম্যান্স লিডারবোর্ড খুলুন",
    "voice_instr_messages": "মেসেজ প্যানেল খুলুন",
    "voice_instr_verifications": "ম্যানুয়াল পর্যালোচনার জন্য এমএল ভেরিফিকেশন হাব খুলুন",
    "voice_instr_contracts": "স্মার্ট চুক্তি এবং ডিজিটাল এসক্রো তালিকা খুলুন",
    "voice_instr_oracle": "কৌশলগত পরিকল্পনা ওরাকল অ্যাক্সেস করুন",
    "voice_instr_fuel_oracle": "ভারত-ফুয়েল এবং আন্তঃরাজ্য টোল ওরাকল অ্যাক্সেস করুন",
    "voice_instr_strategy": "বর্তমান অপারেশনাল কৌশল বাস্তবায়ন ট্র্যাক করুন",
    "voice_instr_resilience": "নেটওয়ার্ক ক্যাসকেড সিমুলেশন এবং স্বাস্থ্য ডায়াগনস্টিকস চালান",
    "voice_instr_settings": "ডাটাবেস সেটিংস এবং সিস্টেম প্যারামিটার পরিচালনা করুন",
    "voice_instr_leaves": "কেন্দ্রীভূত ছুটি এবং রক্ষণাবেক্ষণ রেজিস্ট্রি দেখুন",
    "voice_instr_toggle_duty": "সক্রিয় এবং অফ-ডিউটির মধ্যে আপনার ডিউটি স্ট্যাটাস পরিবর্তন করুন",
    "voice_instr_sync_watch": "স্মার্টওয়াচ থেকে স্বাস্থ্য মেট্রিক্স সিঙ্ক করুন"
}

def update_json(filepath, translations):
    if not os.path.exists(filepath):
        print(f"Skipping (not found): {filepath}")
        return
    
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    # Update translations
    for k, v in translations.items():
        data[k] = v
        
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print(f"Updated translations in: {filepath}")

update_json(hi_path, hi_translations)
update_json(bn_path, bn_translations)
