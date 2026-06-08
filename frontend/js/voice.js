/**
 * LOGISTIX AUTOMATED CONTROL ENGINE
 * Supports EN and all 21 Indian regional languages with role-based command sets,
 * dynamic keyword matching, smartwatch/duty hooks, and regional TTS fallbacks.
 */

class AutomatedControl {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.currentLang = localStorage.getItem('app_lang') || 'en';
        this.isSpeakingInstructions = false;
        
        // Internal Command Registry with Role Mapping and Action
        this.registry = {
            "report_issue": { 
                role: "all", 
                desc: "report", 
                action: () => this.triggerClick('report-issue-btn') 
            },
            "open_map": { 
                role: "all", 
                desc: "map", 
                action: () => {
                    const role = this.getCurrentRole();
                    if (role === 'driver') this.switchDriverTab('active');
                    else this.showSection('weather');
                } 
            },
            "check_wallet": { 
                role: "all", 
                desc: "wallet", 
                action: () => {
                    const role = this.getCurrentRole();
                    if (role === 'driver') this.switchDriverTab('wallet');
                    else this.showSection('paisa-fast');
                } 
            },
            "go_to_dashboard": { 
                role: "all", 
                desc: "dash", 
                action: () => {
                    const role = this.getCurrentRole();
                    if (role === 'driver') this.switchDriverTab('dash');
                    else if (role === 'warehouse_manager') this.switchWarehouseTab('dash');
                    else this.showSection('analytics');
                } 
            },
            "confirm_pickup": { 
                role: "driver", 
                desc: "pickup", 
                action: () => this.triggerClick('confirm-pickup-btn') 
            },
            "complete_delivery": { 
                role: "driver", 
                desc: "delivery", 
                action: () => this.triggerClick('complete-delivery-btn') 
            },
            "open_shipments": { 
                role: "manager", 
                desc: "shipments", 
                action: () => this.showSection('shipments') 
            },
            "open_analytics": { 
                role: "manager", 
                desc: "analytics", 
                action: () => this.showSection('analytics') 
            },
            "open_finance": { 
                role: "manager", 
                desc: "finance", 
                action: () => this.showSection('paisa-fast') 
            },
            "open_safety": { 
                role: "manager", 
                desc: "safety", 
                action: () => this.showSection('safety') 
            },
            "open_infrastructure": { 
                role: "all", 
                desc: "infrastructure", 
                action: () => {
                    const role = this.getCurrentRole();
                    if (role === 'warehouse_manager') this.switchWarehouseTab('fleet');
                    else this.showSection('warehouses');
                } 
            },
            "open_receivers": { 
                role: "manager", 
                desc: "receivers", 
                action: () => this.showSection('receivers') 
            },
            "open_drivers": { 
                role: "manager", 
                desc: "drivers", 
                action: () => this.showSection('drivers') 
            },
            "open_weather": { 
                role: "manager", 
                desc: "weather", 
                action: () => this.showSection('weather') 
            },
            "open_leaderboard": { 
                role: "all", 
                desc: "leaderboard", 
                action: () => {
                    const role = this.getCurrentRole();
                    if (role === 'warehouse_manager') this.switchWarehouseTab('leaderboard');
                    else this.showSection('leaderboard');
                } 
            },
            "open_messages": { 
                role: "manager", 
                desc: "messages", 
                action: () => this.showSection('messages') 
            },
            "open_verifications": { 
                role: "all", 
                desc: "verifications", 
                action: () => {
                    const role = this.getCurrentRole();
                    if (role === 'warehouse_manager') this.switchWarehouseTab('verifications');
                    else this.showSection('verifications');
                } 
            },
            "open_contracts": { 
                role: "all", 
                desc: "contracts", 
                action: () => {
                    const role = this.getCurrentRole();
                    if (role === 'driver') this.switchDriverTab('contracts');
                    else this.showSection('ledger');
                } 
            },
            "open_strategy_oracle": { 
                role: "manager", 
                desc: "oracle", 
                action: () => this.showSection('oracle') 
            },
            "open_fuel_oracle": { 
                role: "manager", 
                desc: "fuel_oracle", 
                action: () => this.showSection('fuel-oracle') 
            },
            "open_operational_strategy": { 
                role: "manager", 
                desc: "strategy", 
                action: () => this.showSection('strategy-plan') 
            },
            "open_network_resilience": { 
                role: "manager", 
                desc: "resilience", 
                action: () => this.showSection('network-resilience') 
            },
            "open_system_settings": { 
                role: "all", 
                desc: "settings", 
                action: () => {
                    const role = this.getCurrentRole();
                    if (role === 'warehouse_manager') this.switchWarehouseTab('settings');
                    else this.showSection('system');
                } 
            },
            "open_hub_leaves": { 
                role: "manager", 
                desc: "leaves", 
                action: () => this.showSection('hub-leaves') 
            },
            "stop_listening": { 
                role: "all", 
                desc: "stop", 
                action: () => this.stop() 
            },
            "toggle_duty": {
                role: "driver",
                desc: "toggle_duty",
                action: () => { if (typeof toggleDuty === 'function') toggleDuty(); }
            },
            "sync_watch": {
                role: "driver",
                desc: "sync_watch",
                action: () => { if (typeof toggleWatchSync === 'function') toggleWatchSync(); }
            },
            "status_check": {
                role: "driver",
                desc: "status_check",
                action: () => this.announceDriverStatus()
            },
            "food_check": {
                role: "driver",
                desc: "food_check",
                action: () => this.triggerDhabaSearch()
            },
            "generate_report": {
                role: "manager",
                desc: "generate_report",
                action: () => {
                    // Open the last viewed shipment's report, or nudge the user
                    if (typeof window.lastViewedShipmentId !== 'undefined' && window.lastViewedShipmentId) {
                        if (typeof window.generateShipmentReport === 'function') {
                            window.generateShipmentReport(window.lastViewedShipmentId);
                        }
                    } else {
                        this.showSection('shipments');
                    }
                }
            },
            "assign_driver": {
                role: "manager",
                desc: "assign_driver",
                action: () => {
                    if (typeof window.lastViewedShipmentId !== 'undefined' && window.lastViewedShipmentId) {
                        if (typeof window.openManualAssignModal === 'function') {
                            window.openManualAssignModal(window.lastViewedShipmentId);
                        }
                    } else {
                        this.showSection('shipments');
                    }
                }
            },
            "verify_shipment": {
                role: "manager",
                desc: "verify_shipment",
                action: () => {
                    if (typeof window.lastViewedShipmentId !== 'undefined' && window.lastViewedShipmentId) {
                        if (typeof window.managerManualVerify === 'function') {
                            window.managerManualVerify(window.lastViewedShipmentId);
                        }
                    } else {
                        this.showSection('verifications');
                    }
                }
            },
            "show_certificate": {
                role: "manager",
                desc: "show_certificate",
                action: () => {
                    if (typeof window.lastViewedShipmentId !== 'undefined' && window.lastViewedShipmentId) {
                        if (typeof window.downloadShipmentEsgCertificate === 'function') {
                            window.downloadShipmentEsgCertificate(window.lastViewedShipmentId);
                        }
                    } else {
                        this.showSection('shipments');
                    }
                }
            }
        };

        // Comprehensive Voice Command Keyword Maps for EN + 21 Regional Languages
        this.commands = {
            en: {
                "report": "report_issue",
                "incident": "report_issue",
                "map": "open_map",
                "route": "open_map",
                "wallet": "check_wallet",
                "earning": "check_wallet",
                "paisa": "check_wallet",
                "dashboard": "go_to_dashboard",
                "task": "go_to_dashboard",
                "pickup": "confirm_pickup",
                "delivery": "complete_delivery",
                "deliver": "complete_delivery",
                "shipment": "open_shipments",
                "order": "open_shipments",
                "analytics": "open_analytics",
                "finance": "open_finance",
                "payment": "open_finance",
                "safety": "open_safety",
                "security": "open_safety",
                "infrastructure": "open_infrastructure",
                "hub": "open_infrastructure",
                "warehouse": "open_infrastructure",
                "receiver": "open_receivers",
                "driver": "open_drivers",
                "fleet": "open_drivers",
                "weather": "open_weather",
                "leaderboard": "open_leaderboard",
                "rank": "open_leaderboard",
                "message": "open_messages",
                "chat": "open_messages",
                "verification": "open_verifications",
                "contract": "open_contracts",
                "ledger": "open_contracts",
                "strategy": "open_operational_strategy",
                "oracle": "open_strategy_oracle",
                "fuel": "open_fuel_oracle",
                "resilience": "open_network_resilience",
                "setting": "open_system_settings",
                "leave": "open_hub_leaves",
                "holiday": "open_hub_leaves",
                "stop": "stop_listening",
                "halt": "stop_listening",
                "duty": "toggle_duty",
                "watch": "sync_watch",
                "report status": "status_check",
                "status report": "status_check",
                "telemetry status": "status_check",
                "find dhabas": "food_check",
                "find food": "food_check",
                "food points": "food_check",
                "generate report": "generate_report",
                "full report": "generate_report",
                "shipment report": "generate_report",
                "assign driver": "assign_driver",
                "driver assign": "assign_driver",
                "ai assign": "assign_driver",
                "verify shipment": "verify_shipment",
                "manual verify": "verify_shipment",
                "otp override": "verify_shipment",
                "show certificate": "show_certificate",
                "green certificate": "show_certificate",
                "esg certificate": "show_certificate"

            },
            hi: {
                "समस्या": "report_issue",
                "नक्शा": "open_map",
                "मैप": "open_map",
                "रूट": "open_map",
                "वॉलेट": "check_wallet",
                "कमाई": "check_wallet",
                "पैसा": "check_wallet",
                "डैशबोर्ड": "go_to_dashboard",
                "काम": "go_to_dashboard",
                "कार्य": "go_to_dashboard",
                "पिकअप": "confirm_pickup",
                "डिलीवरी": "complete_delivery",
                "पहुंचा": "complete_delivery",
                "शिपमेंट": "open_shipments",
                "ऑर्डर": "open_shipments",
                "एनालिटिक्स": "open_analytics",
                "फाइनेंस": "open_finance",
                "भुगतान": "open_finance",
                "पेमेंट": "open_finance",
                "सुरक्षा": "open_safety",
                "सेफ्टी": "open_safety",
                "वेयरहाउस": "open_infrastructure",
                "हब": "open_infrastructure",
                "इन्फ्रा": "open_infrastructure",
                "रिसीवर": "open_receivers",
                "ग्राहक": "open_receivers",
                "ड्राइवर": "open_drivers",
                "बेड़े": "open_drivers",
                "फ्लीट": "open_drivers",
                "मौसम": "open_weather",
                "लीडरबोर्ड": "open_leaderboard",
                "रैंक": "open_leaderboard",
                "मैसेज": "open_messages",
                "संदेश": "open_messages",
                "चैट": "open_messages",
                "वेरिफिकेशन": "open_verifications",
                "सत्यापन": "open_verifications",
                "अनुबंध": "open_contracts",
                "स्मार्ट कॉन्ट्रैक्ट": "open_contracts",
                "लेजर": "open_contracts",
                "रणनीति": "open_operational_strategy",
                "ओरेकल": "open_strategy_oracle",
                "ईंधन": "open_fuel_oracle",
                "तेल": "open_fuel_oracle",
                "लचीलापन": "open_network_resilience",
                "सेटिंग": "open_system_settings",
                "सिस्टम": "open_system_settings",
                "छुट्टी": "open_hub_leaves",
                "लीव": "open_hub_leaves",
                "रुक": "stop_listening",
                "ड्यूटी": "toggle_duty",
                "घड़ी": "sync_watch",
                "सिंक": "sync_watch",
                "स्थिति रिपोर्ट": "status_check",
                "स्थिति कैसी है": "status_check",
                "रिपोर्ट बताओ": "status_check",
                "ढाबा खोजें": "food_check",
                "खाना कहां है": "food_check",
                "भोजन गृह": "food_check"
            },
            bn: {
                "সমস্যা": "report_issue",
                "ম্যাপ": "open_map",
                "মানচিত্র": "open_map",
                "রুট": "open_map",
                "ওয়ালেট": "check_wallet",
                "উপার্জন": "check_wallet",
                "টাকা": "check_wallet",
                "ড্যাশবোর্ড": "go_to_dashboard",
                "কাজ": "go_to_dashboard",
                "পিকআপ": "confirm_pickup",
                "ডেলিভারি": "complete_delivery",
                "শিপমেন্ট": "open_shipments",
                "অর্ডার": "open_shipments",
                "অ্যানালিটিক্স": "open_analytics",
                "ফাইন্যান্স": "open_finance",
                "পেমেন্ট": "open_finance",
                "সেফটি": "open_safety",
                "নিরাপত্তা": "open_safety",
                "গুদাম": "open_infrastructure",
                "হাব": "open_infrastructure",
                "ইনফ্রা": "open_infrastructure",
                "রিসিভার": "open_receivers",
                "ড্রাইভার": "open_drivers",
                "ফ্লিট": "open_drivers",
                "আবহাওয়া": "open_weather",
                "লিডারবোর্ড": "open_leaderboard",
                "র‍্যাংক": "open_leaderboard",
                "মেসেজ": "open_messages",
                "বার্তা": "open_messages",
                "চ্যাট": "open_messages",
                "যাচাইকরণ": "open_verifications",
                "ভেরিফিকেশন": "open_verifications",
                "চুক্তি": "open_contracts",
                "লেজার": "open_contracts",
                "কৌশল": "open_operational_strategy",
                "ওরাকল": "open_strategy_oracle",
                "জ্বালানি": "open_fuel_oracle",
                "তেল": "open_fuel_oracle",
                "স্থিতিস্থাপকতা": "open_network_resilience",
                "সেটিংস": "open_system_settings",
                "ছুটি": "open_hub_leaves",
                "থাম": "stop_listening",
                "ডিউটি": "toggle_duty",
                "ঘড়ি": "sync_watch",
                "সিঙ্ক": "sync_watch",
                "অবস্থা কেমন": "status_check",
                "স্ট্যাটাস রিপোর্ট": "status_check",
                "রিপোর্ট করো": "status_check",
                "খাবার জায়গা": "food_check",
                "খাবার কোথায়": "food_check"
            },
            ur: {
                "مسئلہ": "report_issue",
                "نقشہ": "open_map",
                "میپ": "open_map",
                "روٹ": "open_map",
                "والٹ": "check_wallet",
                "کمائی": "check_wallet",
                "پیسہ": "check_wallet",
                "ڈیش بورڈ": "go_to_dashboard",
                "کام": "go_to_dashboard",
                "پک": "confirm_pickup",
                "ڈیلیوری": "complete_delivery",
                "پہنچا": "complete_delivery",
                "شپمنٹ": "open_shipments",
                "آرڈر": "open_shipments",
                "اینالیٹکس": "open_analytics",
                "مالیات": "open_finance",
                "ادائیگی": "open_finance",
                "پیمنٹ": "open_finance",
                "حفاظت": "open_safety",
                "سیفٹی": "open_safety",
                "گودام": "open_infrastructure",
                "ہب": "open_infrastructure",
                "انفرا": "open_infrastructure",
                "ریسیور": "open_receivers",
                "گاہک": "open_receivers",
                "ڈرائیور": "open_drivers",
                "فلیٹ": "open_drivers",
                "موسم": "open_weather",
                "لیڈر بورڈ": "open_leaderboard",
                "رینک": "open_leaderboard",
                "پیغام": "open_messages",
                "میسیج": "open_messages",
                "چیٹ": "open_messages",
                "تصدیق": "open_verifications",
                "ویریفیکیشن": "open_verifications",
                "معاہدہ": "open_contracts",
                "کانٹریکٹ": "open_contracts",
                "لیجر": "open_contracts",
                "حکمت": "open_operational_strategy",
                "اوریکل": "open_strategy_oracle",
                "فیول": "open_fuel_oracle",
                "پٹرول": "open_fuel_oracle",
                "لچک": "open_network_resilience",
                "ترتیبات": "open_system_settings",
                "سیٹنگز": "open_system_settings",
                "چھٹی": "open_hub_leaves",
                "لیو": "open_hub_leaves",
                "رک": "stop_listening",
                "ڈیوٹی": "toggle_duty",
                "گھڑی": "sync_watch",
                "سنک": "sync_watch"
            },
            ne: {
                "समस्या": "report_issue",
                "नक्सा": "open_map",
                "म्याप": "open_map",
                "रूट": "open_map",
                "वालेट": "check_wallet",
                "कमाई": "check_wallet",
                "पैसा": "check_wallet",
                "डैशबोर्ड": "go_to_dashboard",
                "कार्य": "go_to_dashboard",
                "पिकअप": "confirm_pickup",
                "डेलिभरी": "complete_delivery",
                "शिपमेन्ट": "open_shipments",
                "ऑर्डर": "open_shipments",
                "एनालिटिक्स": "open_analytics",
                "पेमेन्ट": "open_finance",
                "सुरक्षा": "open_safety",
                "सेफ्टी": "open_safety",
                "हब": "open_infrastructure",
                "वेयरहाउस": "open_infrastructure",
                "प्राप्तकर्ता": "open_receivers",
                "रिसीभर": "open_receivers",
                "चालक": "open_drivers",
                "फ्लीट": "open_drivers",
                "मौसम": "open_weather",
                "लीडरबोर्ड": "open_leaderboard",
                "मैसेज": "open_messages",
                "च्याट": "open_messages",
                "प्रमाणिकरण": "open_verifications",
                "वेरिफिकेशन": "open_verifications",
                "सम्झौता": "open_contracts",
                "रणनीति": "open_operational_strategy",
                "ओरेकल": "open_strategy_oracle",
                "ईन्धन": "open_fuel_oracle",
                "लचिलोपन": "open_network_resilience",
                "सेटिंग्स": "open_system_settings",
                "बिदा": "open_hub_leaves",
                "रोकिनुहोस्": "stop_listening",
                "ड्यूटी": "toggle_duty",
                "घडी": "sync_watch"
            },
            te: {
                "సమస్య": "report_issue",
                "మ్యాప్": "open_map",
                "మార్గం": "open_map",
                "వాలెట్": "check_wallet",
                "సంపాదన": "check_wallet",
                "డబ్బు": "check_wallet",
                "డ్యాష్‌బోర్డ్": "go_to_dashboard",
                "పని": "go_to_dashboard",
                "पिकअप": "confirm_pickup",
                "పికప్": "confirm_pickup",
                "డెలివరీ": "complete_delivery",
                "షిప్‌మెంట్": "open_shipments",
                "ఆర్డర్": "open_shipments",
                "అనలిటిక్స్": "open_analytics",
                "ఫైనాన్స్": "open_finance",
                "చెల్లింపు": "open_finance",
                "భద్రత": "open_safety",
                "సేఫ్టీ": "open_safety",
                "హబ్": "open_infrastructure",
                "వేర్‌हाउस": "open_infrastructure",
                "రిसीవర్": "open_receivers",
                "డ్రైవర్": "open_drivers",
                "ఫ్లీట్": "open_drivers",
                "వాతావరణం": "open_weather",
                "లీడర్‌బోర్ด์": "open_leaderboard",
                "సందేశం": "open_messages",
                "చాట్": "open_messages",
                "ధృవీకరణ": "open_verifications",
                "ఒప్పందం": "open_contracts",
                "వ్యూహం": "open_operational_strategy",
                "ఒరాకిల్": "open_strategy_oracle",
                "ఇంధనం": "open_fuel_oracle",
                "పెట్రోల్": "open_fuel_oracle",
                "స్థిరత్వం": "open_network_resilience",
                "సెట్టింగులు": "open_system_settings",
                "సెలవు": "open_hub_leaves",
                "ఆపు": "stop_listening",
                "డ్యూটি": "toggle_duty",
                "సింక్": "sync_watch"
            },
            mr: {
                "समस्या": "report_issue",
                "नकाशा": "open_map",
                "मॅप": "open_map",
                "मार्ग": "open_map",
                "वॉलेट": "check_wallet",
                "कमाई": "check_wallet",
                "पैसे": "check_wallet",
                "डॅशबोर्ड": "go_to_dashboard",
                "काम": "go_to_dashboard",
                "पिकअप": "confirm_pickup",
                "वितरण": "complete_delivery",
                "डिलिव्हरी": "complete_delivery",
                "शिपमेंट": "open_shipments",
                "ऑर्डर": "open_shipments",
                "विश्लेषण": "open_analytics",
                "अॅनालिटिक्स": "open_analytics",
                "वित्त": "open_finance",
                "पेमेंट": "open_finance",
                "सुरक्षा": "open_safety",
                "सेफ्टी": "open_safety",
                "गोधाम": "open_infrastructure",
                "हब": "open_infrastructure",
                "प्राप्तकर्ता": "open_receivers",
                "चालक": "open_drivers",
                "फ्लीट": "open_drivers",
                "हवामान": "open_weather",
                "लीडरबोर्ड": "open_leaderboard",
                "संदेश": "open_messages",
                "चॅट": "open_messages",
                "पडताळणी": "open_verifications",
                "करार": "open_contracts",
                "व्यूहरचना": "open_operational_strategy",
                "ओरॅकल": "open_strategy_oracle",
                "इंधन": "open_fuel_oracle",
                "लवचिकता": "open_network_resilience",
                "सेटिंग्ज": "open_system_settings",
                "सुट्टी": "open_hub_leaves",
                "थांबा": "stop_listening",
                "ड्यूटी": "toggle_duty",
                "सिंक": "sync_watch"
            },
            ta: {
                "பிரச்சனை": "report_issue",
                "சம்பவம்": "report_issue",
                "வரைபடம்": "open_map",
                "பாதை": "open_map",
                "வாலட்": "check_wallet",
                "வருமானம்": "check_wallet",
                "பணம்": "check_wallet",
                "டாஷ்போர்டு": "go_to_dashboard",
                "வேலை": "go_to_dashboard",
                "பிக்கப்": "confirm_pickup",
                "டெலிவரி": "complete_delivery",
                "சரக்கு": "open_shipments",
                "ஆர்டர்": "open_shipments",
                "பகுப்பாய்வு": "open_analytics",
                "அனலிட்டிக்ஸ்": "open_analytics",
                "நிதி": "open_finance",
                "பணம் செலுத்துதல்": "open_finance",
                "பாதுகாப்பு": "open_safety",
                "கிடங்கு": "open_infrastructure",
                "ஹப்": "open_infrastructure",
                "பெறுநர்": "open_receivers",
                "ஓட்டுநர்": "open_drivers",
                "டிரைவர்": "open_drivers",
                "வானிலை": "open_weather",
                "லீடர்போர்டு": "open_leaderboard",
                "செய்தி": "open_messages",
                "அரட்டை": "open_messages",
                "சரிபார்ப்பு": "open_verifications",
                "ஒப்பந்தம்": "open_contracts",
                "வியூகம்": "open_operational_strategy",
                "ஆரக்கிள்": "open_strategy_oracle",
                "எரிபொருள்": "open_fuel_oracle",
                "மீள்தன்மை": "open_network_resilience",
                "அமைப்புகள்": "open_system_settings",
                "விடுப்பு": "open_hub_leaves",
                "நிறுத்து": "stop_listening",
                "பணி": "toggle_duty",
                "ஒத்திசைவு": "sync_watch"
            },
            gu: {
                "સમસ્યા": "report_issue",
                "નકશો": "open_map",
                "મૅપ": "open_map",
                "રૂટ": "open_map",
                "વોલેટ": "check_wallet",
                "કમાણી": "check_wallet",
                "પૈસા": "check_wallet",
                "ડેશબોર્ડ": "go_to_dashboard",
                "કામ": "go_to_dashboard",
                "પિકઅપ": "confirm_pickup",
                "ડિલિવરી": "complete_delivery",
                "વિતરણ": "complete_delivery",
                "શિપમેન્ટ": "open_shipments",
                "ઓર્ડર": "open_shipments",
                "એનાલિટિક્સ": "open_analytics",
                "ફાઇનાન્સ": "open_finance",
                "ચુકવણી": "open_finance",
                "સેફ્ટી": "open_safety",
                "સુરક્ષા": "open_safety",
                "ગોદામ": "open_infrastructure",
                "હબ": "open_infrastructure",
                "મેળવનાર": "open_receivers",
                "ડ્રાઇવર": "open_drivers",
                "કાફલો": "open_drivers",
                "હવામાન": "open_weather",
                "લીડરબોર્ડ": "open_leaderboard",
                "મેસેજ": "open_messages",
                "ચેટ": "open_messages",
                "ચકાસણી": "open_verifications",
                "કરાર": "open_contracts",
                "વ્યૂહરચના": "open_operational_strategy",
                "ઓરેકલ": "open_strategy_oracle",
                "બળતણ": "open_fuel_oracle",
                "તેલ": "open_fuel_oracle",
                "સ્થિતિસ્થાપકતા": "open_network_resilience",
                "સેટિંગ્સ": "open_system_settings",
                "રજા": "open_hub_leaves",
                "થોભો": "stop_listening",
                "ડ્યુટી": "toggle_duty",
                "સિન્ક": "sync_watch"
            },
            kn: {
                "ಸಮಸ್ಯೆ": "report_issue",
                "ನಕ್ಷೆ": "open_map",
                "ಮ್ಯಾಪ್": "open_map",
                "ಮಾರ್ಗ": "open_map",
                "ವಾಲೆಟ್": "check_wallet",
                "ಗಳಿಕೆ": "check_wallet",
                "ಹಣ": "check_wallet",
                "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್": "go_to_dashboard",
                "ಕೆಲಸ": "go_to_dashboard",
                "ಪಿಕಪ್": "confirm_pickup",
                "ಡೆಲಿವರಿ": "complete_delivery",
                "ಸಾಗಣೆ": "open_shipments",
                "ಆರ್ಡರ್": "open_shipments",
                "ಅನಾಲಿಟಿಕ್ಸ್": "open_analytics",
                "ಹಣಕಾಸು": "open_finance",
                "ಪಾವತಿ": "open_finance",
                "ಸುರಕ್ಷತೆ": "open_safety",
                "ಗೋದಾಮು": "open_infrastructure",
                "ಹಬ್": "open_infrastructure",
                "ಸ್ವೀಕರಿಸುವವರು": "open_receivers",
                "ಚಾಲಕ": "open_drivers",
                "ಫ್ಲೀಟ್": "open_drivers",
                "ಹವಾಮಾನ": "open_weather",
                "ಲೀಡರ್‌ಬೋರ್ಡ್": "open_leaderboard",
                "ಸಂದೇಶ": "open_messages",
                "ಚಾಟ್": "open_messages",
                "ಪರಿಶೀಲನೆ": "open_verifications",
                "ಒಪ್ಪಂದ": "open_contracts",
                "ಕಾರ್ಯತಂತ್ರ": "open_operational_strategy",
                "ಒರಾಕಲ್": "open_strategy_oracle",
                "ಇಂಧನ": "open_fuel_oracle",
                "ತೈಲ": "open_fuel_oracle",
                "ಸ್ಥಿತಿಸ್ಥಾಪಕತ್ವ": "open_network_resilience",
                "ಸೆಟ್ಟಿಂಗ್‌ಗಳು": "open_system_settings",
                "ರಜೆ": "open_hub_leaves",
                "ನಿಲ್ಲಿಸಿ": "stop_listening",
                "ಡ್ಯೂಟಿ": "toggle_duty",
                "ಸಿಂಕ್": "sync_watch"
            },
            or: {
                "ସମସ୍ୟା": "report_issue",
                "ମାନଚିତ୍ର": "open_map",
                "ମ୍ୟାପ୍": "open_map",
                "ରୁଟ୍": "open_map",
                "ୱାଲେଟ୍": "check_wallet",
                "ଉପାର୍ଜନ": "check_wallet",
                "ଟଙ୍କା": "check_wallet",
                "ଡ୍ୟାସବୋର୍ଡ": "go_to_dashboard",
                "କାମ": "go_to_dashboard",
                "ପିକଅପ୍": "confirm_pickup",
                "ବିତରଣ": "complete_delivery",
                "ଡେଲିଭରି": "complete_delivery",
                "ପଠାଣ": "open_shipments",
                "ଅର୍ଡର": "open_shipments",
                "ବିଶ୍ଳେଷଣ": "open_analytics",
                "ଅର୍ଥ": "open_finance",
                "ସୁରକ୍ଷା": "open_safety",
                "ଗୋଦାମ": "open_infrastructure",
                "ହବ୍": "open_infrastructure",
                "ଗ୍ରହଣକାରୀ": "open_receivers",
                "ଚାଳକ": "open_drivers",
                "ଫ୍ଲିଟ୍": "open_drivers",
                "ପାଣିପାଗ": "open_weather",
                "ଲିଡରବୋର୍ଡ": "open_leaderboard",
                "ବାର୍ତ୍ତା": "open_messages",
                "ଚାଟ୍": "open_messages",
                "ଯାଞ୍ଚ": "open_verifications",
                "ଚୁକ୍ତି": "open_contracts",
                "କୌଶଳ": "open_operational_strategy",
                "ଓରାକଲ୍": "open_strategy_oracle",
                "ଇନ୍ଧନ": "open_fuel_oracle",
                "ସ୍ଥିତିସ୍ଥାପକତା": "open_network_resilience",
                "ସେଟିଙ୍ଗ୍ସ": "open_system_settings",
                "ଛຸଟି": "open_hub_leaves",
                "ଅଟକନ୍ତୁ": "stop_listening",
                "ଡ୍ୟୁଟି": "toggle_duty",
                "ସିଙ୍କ": "sync_watch"
            },
            ml: {
                "പ്രശ്നം": "report_issue",
                "മാപ്പ്": "open_map",
                "വഴി": "open_map",
                "വാലറ്റ്": "check_wallet",
                "വരുമാനം": "check_wallet",
                "പണം": "check_wallet",
                "ഡാഷ്ബോർഡ്": "go_to_dashboard",
                "ജോലി": "go_to_dashboard",
                "പിക്ക്അപ്പ്": "confirm_pickup",
                "ഡെലിവറി": "complete_delivery",
                "ഷിപ്പ്മെന്റ്": "open_shipments",
                "ഓർഡർ": "open_shipments",
                "അനലിറ്റിക്സ്": "open_analytics",
                "ഫിനാൻസ്": "open_finance",
                "പേയ്മെന്റ്": "open_finance",
                "സുരക്ഷ": "open_safety",
                "സേഫ്റ്റി": "open_safety",
                "ഗോഡൗൺ": "open_infrastructure",
                "ഹബ്": "open_infrastructure",
                "സ്വീകർത്താവ്": "open_receivers",
                "ഡ്രൈവർ": "open_drivers",
                "ഫ്ലീറ്റ്": "open_drivers",
                "കാലാവസ്ഥ": "open_weather",
                "ലീഡർബോർഡ്": "open_leaderboard",
                "സന്ദേശം": "open_messages",
                "ചാറ്റ്": "open_messages",
                "പരിശോധന": "open_verifications",
                "കരാർ": "open_contracts",
                "തന്ത്രം": "open_operational_strategy",
                "ഒറാക്കിൾ": "open_strategy_oracle",
                "ഇന്ധനം": "open_fuel_oracle",
                "പ്രതിരോധശേഷി": "open_network_resilience",
                "ക്രമീകരണങ്ങൾ": "open_system_settings",
                "അവധി": "open_hub_leaves",
                "നിർത്തുക": "stop_listening",
                "ഡ്യൂട്ടി": "toggle_duty",
                "സിങ്ക്": "sync_watch"
            },
            pa: {
                "ਸਮੱਸਿਆ": "report_issue",
                "ਨਕਸ਼ਾ": "open_map",
                "ਮੈਪ": "open_map",
                "ਰੂਟ": "open_map",
                "ਵਾਲਿਟ": "check_wallet",
                "ਕਮਾਈ": "check_wallet",
                "ਪੈਸੇ": "check_wallet",
                "ਡੈਸ਼ਬੋਰਡ": "go_to_dashboard",
                "ਕੰਮ": "go_to_dashboard",
                "ਪਿਕਅੱਪ": "confirm_pickup",
                "ਡਿਲੀਵਰੀ": "complete_delivery",
                "ਸ਼ਿਪਮੈਂਟ": "open_shipments",
                "ਆਰਡਰ": "open_shipments",
                "ਵਿਸ਼ਲੇਸ਼ਣ": "open_analytics",
                "ਵਿੱਤ": "open_finance",
                "ਭੁਗਤਾਨ": "open_finance",
                "ਸੁਰੱਖਿਆ": "open_safety",
                "ਸੇਫਟੀ": "open_safety",
                "ਗੁਦਾਮ": "open_infrastructure",
                "ਹੱਬ": "open_infrastructure",
                "ਪ੍ਰਾਪਤਕਰਤਾ": "open_receivers",
                "ਡਰਾਈਵਰ": "open_drivers",
                "ਬੇੜਾ": "open_drivers",
                "ਮੌਸਮ": "open_weather",
                "ਲੀਡਰਬੋਰਡ": "open_leaderboard",
                "ਸੁਨੇਹਾ": "open_messages",
                "ਚੈਟ": "open_messages",
                "ਪੜਤਾਲ": "open_verifications",
                "ਇਕਰਾਰਨਾਮਾ": "open_contracts",
                "ਰਣਨੀਤੀ": "open_operational_strategy",
                "ਓਰੇਕਲ": "open_strategy_oracle",
                "ਬਾਲਣ": "open_fuel_oracle",
                "ਲਚਕਤਾ": "open_network_resilience",
                "ਸੈਟਿੰਗਾਂ": "open_system_settings",
                "ਛੁੱਟੀ": "open_hub_leaves",
                "ਰੁਕੋ": "stop_listening",
                "ਡਿਊਟੀ": "toggle_duty",
                "ਸਿੰਕ": "sync_watch"
            },
            as: {
                "সমস্যা": "report_issue",
                "মানচিত্ৰ": "open_map",
                "ম্যাপ": "open_map",
                "ৰুট": "open_map",
                "ৱালেট": "check_wallet",
                "উপাৰ্জন": "check_wallet",
                "টকা": "check_wallet",
                "ডেশ্ববৰ্ড": "go_to_dashboard",
                "কাম": "go_to_dashboard",
                "পিকআপ": "confirm_pickup",
                "ডেলিভাৰী": "complete_delivery",
                "চালানি": "open_shipments",
                "অৰ্ডাৰ": "open_shipments",
                "বিশ্লেষণ": "open_analytics",
                "বিত্ত": "open_finance",
                "পেমেন্ট": "open_finance",
                "সুৰক্ষা": "open_safety",
                "সেফটি": "open_safety",
                "গুদাম": "open_infrastructure",
                "হাব": "open_infrastructure",
                "গ্ৰাহক": "open_receivers",
                "চালক": "open_drivers",
                "ফ্লিট": "open_drivers",
                "বতৰ": "open_weather",
                "লীডাৰবোৰ্ড": "open_leaderboard",
                "বাৰ্তা": "open_messages",
                "চ্যাট": "open_messages",
                "যাচাইকৰণ": "open_verifications",
                "চুক্তি": "open_contracts",
                "কৌশল": "open_operational_strategy",
                "ওৰাকল": "open_strategy_oracle",
                "ইন্ধন": "open_fuel_oracle",
                "তেল": "open_fuel_oracle",
                "স্থিতিস্থাপকতা": "open_network_resilience",
                "ছেটিংছ": "open_system_settings",
                "ছুটী": "open_hub_leaves",
                "বন্ধ": "stop_listening",
                "ডিউটি": "toggle_duty",
                "চিঙ্ক": "sync_watch"
            },
            mai: {
                "समस्या": "report_issue",
                "नक्शा": "open_map",
                "मैप": "open_map",
                "रूट": "open_map",
                "वॉलेट": "check_wallet",
                "कमाई": "check_wallet",
                "पैसा": "check_wallet",
                "डैशबोर्ड": "go_to_dashboard",
                "काम": "go_to_dashboard",
                "पिकअप": "confirm_pickup",
                "डिलीवरी": "complete_delivery",
                "शिपमेंट": "open_shipments",
                "ऑर्डर": "open_shipments",
                "एनालिटिक्स": "open_analytics",
                "फाइनेंस": "open_finance",
                "भुगतान": "open_finance",
                "सुरक्षा": "open_safety",
                "सेफ्टी": "open_safety",
                "गोदाम": "open_infrastructure",
                "हब": "open_infrastructure",
                "रिसीवर": "open_receivers",
                "ड्राइवर": "open_drivers",
                "फ्लीट": "open_drivers",
                "मौसम": "open_weather",
                "लीडरबोर्ड": "open_leaderboard",
                "मैसेज": "open_messages",
                "चैट": "open_messages",
                "सत्यापन": "open_verifications",
                "अनुबंध": "open_contracts",
                "रणनीति": "open_operational_strategy",
                "ओरेकल": "open_strategy_oracle",
                "ईंधन": "open_fuel_oracle",
                "लचीलापन": "open_network_resilience",
                "सेटिंग्स": "open_system_settings",
                "छुट्टी": "open_hub_leaves",
                "रुकू": "stop_listening",
                "ड्यूटी": "toggle_duty",
                "सिंक": "sync_watch"
            },
            sat: {
                "ᱮᱴᱠᱮᱴᱚᱬᱮ": "report_issue",
                "ᱱᱚᱠᱥᱟ": "open_map",
                "ᱢᱮᱯ": "open_map",
                "ᱣᱟᱞᱮᱴ": "check_wallet",
                "ᱴᱟᱠᱟ": "check_wallet",
                "ᱰᱮᱥᱵᱳᱨᱰ": "go_to_dashboard",
                "ᱠᱟᱹᱢᱤ": "go_to_dashboard",
                "ᱯᱤᱠᱟᱹᱯ": "confirm_pickup",
                "ᱰᱮᱞᱤᱵᱷᱟᱨᱤ": "complete_delivery",
                "ᱥᱤᱯᱢᱮᱱᱴ": "open_shipments",
                "অর্ডার": "open_shipments",
                "ᱞᱮᱠᱷᱟ": "open_analytics",
                "ᱴᱟᱠᱟ": "open_finance",
                "ᱡᱚᱛᱷᱟᱛ": "open_safety",
                "ᱜᱚᱫᱟᱢ": "open_infrastructure",
                "ᱦᱚᱵ": "open_infrastructure",
                "ᱜᱨᱟᱦᱚᱠ": "open_receivers",
                "ᱰᱨᱟᱭᱵᱷᱚᱨ": "open_drivers",
                "ᱯᱷᱞᱤᱴ": "open_drivers",
                "ᱦᱚᱭ": "open_weather",
                "ᱞᱤᱰᱚᱨᱵᱚᱨᱰ": "open_leaderboard",
                "ᱠᱷᱚᱵᱚᱨ": "open_messages",
                "ᱪᱮᱴ": "open_messages",
                "যাচাই": "open_verifications",
                "চুক্তি": "open_contracts",
                "কৌশল": "open_operational_strategy",
                "ওরাকল": "open_strategy_oracle",
                "সুনুম": "open_fuel_oracle",
                "লচক": "open_network_resilience",
                "ছেটিংছ": "open_system_settings",
                "ছুটী": "open_hub_leaves",
                "ᱛᱤᱸᱜᱩᱱ": "stop_listening",
                "ডিউটি": "toggle_duty",
                "घड़ी": "sync_watch"
            },
            ks: {
                "مسئلہ": "report_issue",
                "نقشہ": "open_map",
                "میپ": "open_map",
                "روٹ": "open_map",
                "والٹ": "check_wallet",
                "کمائی": "check_wallet",
                "پیسہ": "check_wallet",
                "ڈیش بورڈ": "go_to_dashboard",
                "کام": "go_to_dashboard",
                "پک": "confirm_pickup",
                "ڈیلیوری": "complete_delivery",
                "شپمنٹ": "open_shipments",
                "اینالیٹکس": "open_analytics",
                "مالیات": "open_finance",
                "ادائیگی": "open_finance",
                "حفاظت": "open_safety",
                "گودام": "open_infrastructure",
                "ہب": "open_infrastructure",
                "ریسیور": "open_receivers",
                "ڈرائیور": "open_drivers",
                "فلیٹ": "open_drivers",
                "موسم": "open_weather",
                "لیڈر بورڈ": "open_leaderboard",
                "پیغام": "open_messages",
                "چیٹ": "open_messages",
                "تصدیق": "open_verifications",
                "معاہدہ": "open_contracts",
                "حکمت": "open_operational_strategy",
                "اوریکل": "open_strategy_oracle",
                "فیول": "open_fuel_oracle",
                "تیل": "open_fuel_oracle",
                "لچک": "open_network_resilience",
                "ترتیبات": "open_system_settings",
                "چھٹی": "open_hub_leaves",
                "رک": "stop_listening",
                "ڈیوٹی": "toggle_duty",
                "گھڑی": "sync_watch"
            },
            sa: {
                "समस्या": "report_issue",
                "आपत्तिः": "report_issue",
                "मानचित्रम्": "open_map",
                "मार्गः": "open_map",
                "कोषः": "check_wallet",
                "धनम्": "check_wallet",
                "पट्टिका": "go_to_dashboard",
                "कार्यम्": "go_to_dashboard",
                "स्वीकारः": "confirm_pickup",
                "पिकअप": "confirm_pickup",
                "प्रदानम्": "complete_delivery",
                "डिलिवरी": "complete_delivery",
                "प्रेषणम्": "open_shipments",
                "आदेशः": "open_shipments",
                "विश्लेषणम्": "open_analytics",
                "वित्तम्": "open_finance",
                "भुगतानम्": "open_finance",
                "सुरक्षा": "open_safety",
                "भाण्डागारम्": "open_infrastructure",
                "केन्द्रम्": "open_infrastructure",
                "ग्राहकः": "open_receivers",
                "चालकः": "open_drivers",
                "वाहनसमूहः": "open_drivers",
                "ऋतुः": "open_weather",
                "वातावरणम्": "open_weather",
                "कीर्तिपट्टिका": "open_leaderboard",
                "सन्देशः": "open_messages",
                "वार्तालापः": "open_messages",
                "प्रमाणीकरणम्": "open_verifications",
                "अनुबन्धः": "open_contracts",
                "नीतिः": "open_operational_strategy",
                "ओरेकल": "open_strategy_oracle",
                "इन्धनम्": "open_fuel_oracle",
                "तैलम्": "open_fuel_oracle",
                "परिवर्तनशीलता": "open_network_resilience",
                "व्यवस्था": "open_system_settings",
                "अवकाशः": "open_hub_leaves",
                "तिष्ठ": "stop_listening",
                "विरम": "stop_listening",
                "कर्तव्यम्": "toggle_duty",
                "होरा": "sync_watch",
                "घटी": "sync_watch"
            },
            sd: {
                "مسئلو": "report_issue",
                "نقشو": "open_map",
                "میپ": "open_map",
                "روٽ": "open_map",
                "والٽ": "check_wallet",
                "कमाई": "check_wallet",
                "پیسہ": "check_wallet",
                "ڊيش بورڊ": "go_to_dashboard",
                "ڪم": "go_to_dashboard",
                "پک اپ": "confirm_pickup",
                "ڊليوري": "complete_delivery",
                "شپمينٽ": "open_shipments",
                "آرڊر": "open_shipments",
                "ايناليٽكس": "open_analytics",
                "ماليات": "open_finance",
                "پيمنٽ": "open_finance",
                "حفاظت": "open_safety",
                "گودام": "open_infrastructure",
                "هب": "open_infrastructure",
                "ريسيور": "open_receivers",
                "ڊرائيور": "open_drivers",
                "فليٹ": "open_drivers",
                "موسم": "open_weather",
                "ليڊر بورڊ": "open_leaderboard",
                "ميسيج": "open_messages",
                "چيٽ": "open_messages",
                "تصديق": "open_verifications",
                "معاهدو": "open_contracts",
                "حڪمت": "open_operational_strategy",
                "اوريڪل": "open_strategy_oracle",
                "فيل": "open_fuel_oracle",
                "تيل": "open_fuel_oracle",
                "لچڪ": "open_network_resilience",
                "ترتيبون": "open_system_settings",
                "موڪل": "open_hub_leaves",
                "ترسو": "stop_listening",
                "ڊيوٽي": "toggle_duty",
                "سنڪ": "sync_watch"
            },
            gom: {
                "आडखळ": "report_issue",
                "समस्या": "report_issue",
                "नकाशा": "open_map",
                "मार्ग": "open_map",
                "वॉलेट": "check_wallet",
                "कमाय": "check_wallet",
                "दुडू": "check_wallet",
                "डॅशबोर्ड": "go_to_dashboard",
                "काम": "go_to_dashboard",
                "पिकअप": "confirm_pickup",
                "डिलिव्हरी": "complete_delivery",
                "पावणे": "complete_delivery",
                "शिपमेंट": "open_shipments",
                "ऑर्डर": "open_shipments",
                "अॅनालिटिक्स": "open_analytics",
                "पैसे": "open_finance",
                "पेमेंट": "open_finance",
                "सुरक्षा": "open_safety",
                "कोठार": "open_infrastructure",
                "हब": "open_infrastructure",
                "मेळवपी": "open_receivers",
                "ड्रायव्हर": "open_drivers",
                "फ्लीट": "open_drivers",
                "हवामान": "open_weather",
                "लीडरबोर्ड": "open_leaderboard",
                "मैसेज": "open_messages",
                "चॅट": "open_messages",
                "तपासणी": "open_verifications",
                "करार": "open_contracts",
                "धोरण": "open_operational_strategy",
                "ओरेकल": "open_strategy_oracle",
                "इंधन": "open_fuel_oracle",
                "तेल": "open_fuel_oracle",
                "नेटवर्क": "open_network_resilience",
                "मांडणी": "open_system_settings",
                "सेटिंग्ज": "open_system_settings",
                "सुटी": "open_hub_leaves",
                "राबा": "stop_listening",
                "ड्यूटी": "toggle_duty",
                "घड्याळ": "sync_watch"
            },
            doi: {
                "मसला": "report_issue",
                "मुश्किल": "report_issue",
                "नक्शा": "open_map",
                "रूट": "open_map",
                "बटुआ": "check_wallet",
                "कमाई": "check_wallet",
                "पैसे": "check_wallet",
                "डैशबोर्ड": "go_to_dashboard",
                "काम": "go_to_dashboard",
                "चुकना": "confirm_pickup",
                "पिकअप": "confirm_pickup",
                "डिलिवरी": "complete_delivery",
                "शिपमेंट": "open_shipments",
                "ऑर्डर": "open_shipments",
                "एनालिटिक्स": "open_analytics",
                "वित्त": "open_finance",
                "पेमेंट": "open_finance",
                "सुरक्षा": "open_safety",
                "सेफ्टी": "open_safety",
                "गोदाम": "open_infrastructure",
                "हब": "open_infrastructure",
                "लेनेवाला": "open_receivers",
                "ड्राइवर": "open_drivers",
                "फ्लीट": "open_drivers",
                "मौसम": "open_weather",
                "लीडरबोर्ड": "open_leaderboard",
                "सुनेहा": "open_messages",
                "चैट": "open_messages",
                "जांच": "open_verifications",
                "समझौता": "open_contracts",
                "रणनीति": "open_operational_strategy",
                "ओरेकल": "open_strategy_oracle",
                "तेल": "open_fuel_oracle",
                "पेट्रोल": "open_fuel_oracle",
                "लचीलापन": "open_network_resilience",
                "सेटिंग्स": "open_system_settings",
                "छुट्टी": "open_hub_leaves",
                "खलो": "stop_listening",
                "ड्यूटी": "toggle_duty",
                "घड़ी": "sync_watch"
            },
            mni: {
                "অৱা": "report_issue",
                "অসুবা": "report_issue",
                "ম্যাপ": "open_map",
                "লম্বী": "open_map",
                "ৱালেট": "check_wallet",
                "শেন": "check_wallet",
                "ড্যাশবোর্ড": "go_to_dashboard",
                "থবক": "go_to_dashboard",
                "পিকআপ": "confirm_pickup",
                "ডেলিভারী": "complete_delivery",
                "শিপমেন্ট": "open_shipments",
                "অর্ডার": "open_shipments",
                "অ্যানালিটিক্স": "open_analytics",
                "পেমেন্ট": "open_finance",
                "সেফটি": "open_safety",
                "ঙাকশেল": "open_safety",
                "হাব": "open_infrastructure",
                "সংলোন": "open_infrastructure",
                "রিসিভার": "open_receivers",
                "ড্রাইভার": "open_drivers",
                "ফ্লিট": "open_drivers",
                "নোং-তাং": "open_weather",
                "লিডারবোর্ড": "open_leaderboard",
                "পাউ": "open_messages",
                "চ্যাট": "open_messages",
                "যাচাই": "open_verifications",
                "চুক্তি": "open_contracts",
                "খৌরাং": "open_operational_strategy",
                "ওরাকল": "open_strategy_oracle",
                "থাউ": "open_fuel_oracle",
                "নেটওয়ার্ক": "open_network_resilience",
                "সেটিংস": "open_system_settings",
                "ছুটি": "open_hub_leaves",
                "লেপন": "stop_listening",
                "ডিউটি": "toggle_duty",
                "পূং": "sync_watch"
            }
        };

        this.init();
    }

    init() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.updateLanguage();

        this.recognition.onresult = (event) => {
            const last = event.results.length - 1;
            const text = event.results[last][0].transcript.toLowerCase().trim();
            this.handleCommand(text);
        };

        this.recognition.onend = () => { if (this.isListening) this.recognition.start(); };
        this.recognition.onerror = () => { this.isListening = false; this.updateUI(); };
    }

    speak(enText, hiText, bnText) {
        window.speechSynthesis.cancel();
        const lang = this.currentLang;
        let text = enText;
        if (lang === 'hi') text = hiText;
        else if (lang === 'bn') text = bnText;

        const langMap = { 'en': 'en-IN', 'hi': 'hi-IN', 'bn': 'bn-IN' };
        const voiceLang = langMap[lang] || 'en-US';

        const msg = new SpeechSynthesisUtterance(text);
        msg.lang = voiceLang;
        msg.rate = 0.95;

        let voices = window.speechSynthesis.getVoices();
        let bestVoice = voices.find(v => v.lang === voiceLang);
        if (bestVoice) msg.voice = bestVoice;

        window.speechSynthesis.speak(msg);
    }

    announceDriverStatus() {
        const driver = window.currentDriverObj;
        const vehicle = window.currentVehicleObj;
        
        if (!driver) {
            this.speak("Driver profile not loaded yet.", "ड्राइवर प्रोफाइल लोड नहीं हुआ है।", "ड्राइवर প্রোফাইল লোড হয়নি।");
            return;
        }
        
        const fatigue = Math.round(driver.fatigue_score || 0);
        const safety = Math.round(driver.safety_rating || 5);
        const health = vehicle ? Math.round(vehicle.vehicle_health_score || 100) : 100;
        
        const enText = `Driver status report: Your fatigue score is ${fatigue} percent. Safety rating is ${safety} stars. Vehicle health is ${health} percent.`;
        const hiText = `ड्राइवर स्थिति रिपोर्ट: आपकी थकान का स्कोर ${fatigue} प्रतिशत है। सुरक्षा रेटिंग ${safety} स्टार है। वाहन का स्वास्थ्य ${health} प्रतिशत है।`;
        const bnText = `ড্রাইভার স্ট্যাটাস রিপোর্ট: আপনার ক্লান্তি স্কোর ${fatigue} শতাংশ। নিরাপত্তা রেটিং ${safety} স্টার। গাড়ির স্বাস্থ্য ${health} শতাংশ।`;
        
        this.speak(enText, hiText, bnText);
    }

    triggerDhabaSearch() {
        const btn = document.getElementById('poi-btn-food');
        if (btn) {
            if (typeof togglePOILayer === 'function') {
                togglePOILayer('food');
                const isFoodActive = activePoiTypes.has('food');
                const enText = isFoodActive ? "Dhabas and food points are now highlighted on your map." : "Food layer hidden.";
                const hiText = isFoodActive ? "ढाबा और भोजन स्थान आपके नक्शे पर चिह्नित कर दिए गए हैं।" : "भोजन स्तर हटा दिया गया है।";
                const bnText = isFoodActive ? "খাবারের জায়গা এবং ধাবাগুলো ম্যাপে চিহ্নিত করা হয়েছে।" : "খাবারের লেয়ার লুকানো হয়েছে।";
                this.speak(enText, hiText, bnText);
            }
        } else {
            this.speak("Food search controls are not available on this screen.", "इस स्क्रीन पर भोजन खोज नियंत्रण उपलब्ध नहीं हैं।", "এই স্ক্রিনে খাবারের জায়গা খোঁজার বোতাম পাওয়া যায়নি।");
        }
    }

    updateLanguage() {
        this.currentLang = localStorage.getItem('app_lang') || 'en';
        const langMap = { 
            'en': 'en-IN', 'bn': 'bn-IN', 'hi': 'hi-IN', 'te': 'te-IN', 'mr': 'mr-IN',
            'ta': 'ta-IN', 'gu': 'gu-IN', 'kn': 'kn-IN', 'or': 'or-IN', 'ml': 'ml-IN',
            'pa': 'pa-IN', 'as': 'as-IN', 'mai': 'hi-IN', 'sat': 'hi-IN', 'ks': 'hi-IN',
            'ur': 'ur-IN', 'ne': 'ne-NP', 'sa': 'sa-IN', 'sd': 'sd-IN', 'gom': 'kok-IN', 'doi': 'doi-IN', 'mni': 'mni-IN'
        };
        if (this.recognition) this.recognition.lang = langMap[this.currentLang] || 'en-US';
    }

    getCurrentRole() {
        const path = window.location.pathname;
        if (path.includes('warehouse_manager')) return 'warehouse_manager';
        if (path.includes('manager')) return 'manager';
        if (path.includes('driver')) return 'driver';
        return 'all';
    }

    handleCommand(text) {
        const role = this.getCurrentRole();
        const langCmds = this.commands[this.currentLang] || this.commands.en;

        // Sort keys by length descending to match longer phrases first
        const keywords = Object.keys(langCmds).sort((a, b) => b.length - a.length);

        for (const kw of keywords) {
            if (text.includes(kw)) {
                const regKey = langCmds[kw];
                const regEntry = this.registry[regKey];
                if (regEntry && (regEntry.role === 'all' || regEntry.role === role || (regEntry.role === 'manager' && role === 'warehouse_manager'))) {
                    regEntry.action();
                    this.provideFeedback(true);
                    return;
                }
            }
        }

        // Also check English commands as a fallback if not English
        if (this.currentLang !== 'en') {
            const enCmds = this.commands.en;
            const enKeywords = Object.keys(enCmds).sort((a, b) => b.length - a.length);
            for (const kw of enKeywords) {
                if (text.includes(kw)) {
                    const regKey = enCmds[kw];
                    const regEntry = this.registry[regKey];
                    if (regEntry && (regEntry.role === 'all' || regEntry.role === role || (regEntry.role === 'manager' && role === 'warehouse_manager'))) {
                        regEntry.action();
                        this.provideFeedback(true);
                        return;
                    }
                }
            }
        }

        this.provideFeedback(false);
    }

    switchDriverTab(tab) {
        if (typeof switchDriverTab === 'function') {
            switchDriverTab(tab);
        } else {
            const tabToPage = {
                'dash': 'driver_tasks.html',
                'active': 'driver_live.html',
                'chat': 'driver_chat.html',
                'completed': 'driver_history.html',
                
                'wallet': 'driver_wallet.html',
                'profile': 'driver_account.html'
            };
            const targetPage = tabToPage[tab];
            if (targetPage) {
                const isRoot = !window.location.pathname.includes('/pages/');
                window.location.href = isRoot ? `pages/${targetPage}` : targetPage;
            }
        }
    }

    showSection(id) {
        if (typeof showSection === 'function') {
            showSection(id);
        } else {
            const pageToSection = {
                'manager_analytics.html': 'analytics',
                'manager_warehouses.html': 'warehouses',
                'manager_shipments.html': 'shipments',
                'manager_receivers.html': 'receivers',
                'manager_drivers.html': 'drivers',
                'manager_weather.html': 'weather',
                'manager_messages.html': 'messages',
                'manager_leaderboard.html': 'leaderboard',
                'manager_verifications.html': 'verifications',
                'manager_safety.html': 'safety',
                
                'manager_oracle.html': 'oracle',
                'manager_fuel_oracle.html': 'fuel-oracle',
                'manager_payments.html': 'paisa-fast',
                'manager_strategy.html': 'strategy-plan',
                'manager_resilience.html': 'network-resilience',
                'manager_system.html': 'system',
                'manager_hub_leaves.html': 'hub-leaves'
            };
            const targetPage = Object.keys(pageToSection).find(key => pageToSection[key] === id);
            if (targetPage) {
                const isRoot = !window.location.pathname.includes('/pages/');
                window.location.href = isRoot ? `pages/${targetPage}` : targetPage;
            }
        }
    }

    switchWarehouseTab(tab) {
        if (typeof switchTab === 'function') {
            switchTab(tab);
        } else {
            const tabToPage = {
                'dash': 'warehouse_manager_dash.html',
                'verifications': 'warehouse_manager_verifications.html',
                'fleet': 'warehouse_manager_fleet.html',
                'gate': 'warehouse_manager_gate.html',
                'audit': 'warehouse_manager_audit.html',
                'leaderboard': 'warehouse_manager_leaderboard.html',
                'settings': 'warehouse_manager_settings.html'
            };
            const targetPage = tabToPage[tab];
            if (targetPage) {
                const isRoot = !window.location.pathname.includes('/pages/');
                window.location.href = isRoot ? `pages/${targetPage}` : targetPage;
            }
        }
    }

    triggerClick(id) {
        let el = document.getElementById(id);
        if (!el) {
            if (id === 'confirm-pickup-btn') el = document.querySelector('[id^="pickup-btn-"]');
            else if (id === 'complete-delivery-btn') el = document.querySelector('button[onclick*="confirmDelivery"]');
            else if (id === 'btn-nav-finance') el = document.getElementById('nav-link-paisa-fast');
        }
        if (el) el.click();
        else if (id.startsWith('btn-nav-') && typeof showSection === 'function') {
            showSection(id.replace('btn-nav-', ''));
        }
    }

    provideFeedback(success) {
        const mic = document.getElementById('voice-trigger');
        if (mic) {
            mic.style.background = success ? 'var(--success)' : 'orange';
            setTimeout(() => { mic.style.background = this.isListening ? 'var(--danger)' : 'var(--card)'; }, 600);
        }
    }

    toggle() { this.isListening ? this.stop() : this.start(); }

    start() {
        if (!this.recognition) return alert("Speech recognition not supported.");
        this.updateLanguage();
        this.recognition.start();
        this.isListening = true;
        this.updateUI();
        if (typeof showNotification === 'function') {
            showNotification("Automated Control Active 🎙️", "success");
        }
    }

    stop() {
        if (this.recognition) this.recognition.stop();
        this.isListening = false;
        this.updateUI();
        if (typeof showNotification === 'function') {
            showNotification("Automated Control Deactivated", "info");
        }
    }

    updateUI() {
        const mic = document.getElementById('voice-trigger');
        if (mic) {
            mic.innerHTML = this.isListening ? '🛑 Stop' : '🎙️ Automated Control';
            mic.style.background = this.isListening ? 'var(--danger)' : 'var(--card)';
            mic.style.color = this.isListening ? 'white' : 'var(--text)';
        }
    }

    showInstructions() {
        const lang = this.currentLang;
        const role = this.getCurrentRole();
        const registryKeys = Object.keys(this.registry);
        
        let html = `
            <div id="voice-help-modal" class="glass-card" style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); z-index:10001; width:500px; max-width:95vw; padding:32px; box-shadow:0 25px 60px rgba(0,0,0,0.25); border:1px solid var(--primary); background:var(--card); color:var(--text);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                    <h2 style="margin:0; font-weight:800; color:var(--text);">${getTranslation('voice_help_title')}</h2>
                    <button onclick="window.logistixVoice.closeInstructions()" style="background:none; border:none; color:var(--text); font-size:1.5rem; cursor:pointer; opacity:0.6;">✕</button>
                </div>
                
                <div style="display:flex; gap:10px; margin-bottom:20px;">
                    <button onclick="window.logistixVoice.playVoiceInstructions()" class="btn-primary" style="flex:1; background:var(--accent);">🔊 ${getTranslation('voice_listen_btn')}</button>
                    <button onclick="window.logistixVoice.stopInstructions()" class="btn-primary" style="flex:1; background:var(--danger); border:1px solid rgba(255,255,255,0.1);">${getTranslation('voice_stop_instr_btn')}</button>
                </div>

                <div style="max-height:300px; overflow-y:auto;">
                    <table style="width:100%; border-collapse:collapse; text-align:left;">
                        <thead>
                            <tr style="border-bottom:1px solid var(--border);">
                                <th style="padding:10px;">${getTranslation('voice_command_header')}</th>
                                <th style="padding:10px;">${getTranslation('voice_action_header')}</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        for (let i = 0; i < registryKeys.length; i++) {
            const regKey = registryKeys[i];
            const regEntry = this.registry[regKey];

            if (regEntry && (regEntry.role === 'all' || regEntry.role === role || (regEntry.role === 'manager' && role === 'warehouse_manager'))) {
                // Find all keywords for this registry key in target language
                const langCmds = this.commands[lang] || this.commands.en;
                const kwList = [];
                for (const kw in langCmds) {
                    if (langCmds[kw] === regKey) {
                        kwList.push(`"${kw}"`);
                    }
                }
                
                if (kwList.length > 0) {
                    const descKey = `voice_instr_${regEntry.desc}`;
                    html += `
                        <tr style="border-bottom:1px solid var(--border);">
                            <td class="notranslate" style="padding:12px; font-weight:bold; color:var(--primary); font-family:inherit;">${kwList.join(' / ')}</td>
                            <td style="padding:12px; font-size:0.85rem; color:var(--muted);">${getTranslation(descKey)}</td>
                        </tr>
                    `;
                }
            }
        }

        html += `</tbody></table></div></div>`;
        const existing = document.getElementById('voice-help-modal');
        if (existing) existing.remove();
        document.body.insertAdjacentHTML('beforeend', html);
    }

    stopInstructions() {
        this.isSpeakingInstructions = false;
        window.speechSynthesis.cancel();
    }

    closeInstructions() {
        const modal = document.getElementById('voice-help-modal');
        if (modal) modal.remove();
        this.stopInstructions();
    }

    playVoiceInstructions() {
        if (this.isSpeakingInstructions) return; // Prevent multiple clicks
        
        window.speechSynthesis.cancel();
        this.isSpeakingInstructions = true;
        
        const lang = this.currentLang;
        const role = this.getCurrentRole();
        const langMap = { 
            'en': 'en-IN', 'bn': 'bn-IN', 'hi': 'hi-IN', 'te': 'te-IN', 'mr': 'mr-IN',
            'ta': 'ta-IN', 'gu': 'gu-IN', 'kn': 'kn-IN', 'or': 'or-IN', 'ml': 'ml-IN',
            'pa': 'pa-IN', 'as': 'as-IN', 'mai': 'hi-IN', 'sat': 'hi-IN', 'ks': 'hi-IN',
            'ur': 'ur-IN', 'ne': 'ne-NP', 'sa': 'sa-IN', 'sd': 'sd-IN', 'gom': 'kok-IN', 'doi': 'doi-IN', 'mni': 'mni-IN'
        };
        const voiceLang = langMap[lang] || 'en-US';
        
        const registryKeys = Object.keys(this.registry);
        const sayPrefix = getTranslation('voice_say_prefix');
        let instructions = [];
        instructions.push(getTranslation('voice_help_title'));
        
        for (let i = 0; i < registryKeys.length; i++) {
            const regKey = registryKeys[i];
            const regEntry = this.registry[regKey];

            if (regEntry && (regEntry.role === 'all' || regEntry.role === role || (regEntry.role === 'manager' && role === 'warehouse_manager'))) {
                const langCmds = this.commands[lang] || this.commands.en;
                const kwList = [];
                for (const kw in langCmds) {
                    if (langCmds[kw] === regKey) {
                        kwList.push(kw);
                    }
                }
                if (kwList.length > 0) {
                    const descKey = `voice_instr_${regEntry.desc}`;
                    const desc = getTranslation(descKey);
                    if (desc && desc !== descKey) {
                        instructions.push(`${desc}. ${sayPrefix} ${kwList[0]}.`);
                    }
                }
            }
        }

        const speakNext = (index) => {
            if (!this.isSpeakingInstructions || index >= instructions.length) {
                this.isSpeakingInstructions = false;
                return;
            }
            
            const text = instructions[index].replace(/undefined/g, '').trim();
            if (!text) return speakNext(index + 1);

            const msg = new SpeechSynthesisUtterance(text);
            msg.lang = voiceLang;
            msg.rate = 0.9;
            
            let voices = window.speechSynthesis.getVoices();
            let bestVoice = voices.find(v => v.lang === voiceLang);
            
            if (!bestVoice) {
                // Regional fallbacks for Indian languages
                const regionalFallback = ['hi-IN', 'en-IN'];
                for (const fallbackLang of regionalFallback) {
                    bestVoice = voices.find(v => v.lang === fallbackLang);
                    if (bestVoice) break;
                }
            }
            
            if (bestVoice) msg.voice = bestVoice;
            
            msg.onend = () => speakNext(index + 1);
            msg.onerror = () => speakNext(index + 1);
            
            window.speechSynthesis.speak(msg);
        };

        const startChain = () => {
            window.speechSynthesis.onvoiceschanged = null;
            speakNext(0);
        };

        if (window.speechSynthesis.getVoices().length === 0) {
            window.speechSynthesis.onvoiceschanged = startChain;
        } else {
            startChain();
        }
    }
}

window.logistixVoice = new AutomatedControl();
