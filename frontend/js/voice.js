/**
 * LOGISTIX AUTOMATED CONTROL ENGINE
 * Supports EN, HI, BN with role-based command sets and high-fidelity regional TTS.
 */

class AutomatedControl {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.currentLang = localStorage.getItem('app_lang') || 'en';
        this.isSpeakingInstructions = false;
        
        // Internal Command Registry with Role Mapping
        this.registry = {
            "report issue": { id: "report-issue-btn", role: "driver", desc: "report" },
            "open map": { id: "btn-tab-active", role: "driver", desc: "map" },
            "check wallet": { id: "btn-tab-wallet", role: "driver", desc: "wallet" },
            "go to dashboard": { id: "btn-tab-dash", role: "driver", desc: "dash" },
            "confirm pickup": { id: "confirm-pickup-btn", role: "driver", desc: "pickup" },
            "complete delivery": { id: "complete-delivery-btn", role: "driver", desc: "delivery" },
            "open shipments": { id: "btn-nav-shipments", role: "manager", desc: "shipments" },
            "open analytics": { id: "btn-nav-analytics", role: "manager", desc: "analytics" },
            "open finance": { id: "btn-nav-finance", role: "manager", desc: "finance" },
            "open safety": { id: "btn-nav-safety", role: "manager", desc: "safety" },
            "stop listening": { id: "stop", role: "all", desc: "stop" }
        };

        this.commands = {
            en: {
                "report issue": () => this.triggerClick('report-issue-btn'),
                "open map": () => this.triggerClick('btn-tab-active'),
                "check wallet": () => this.triggerClick('btn-tab-wallet'),
                "go to dashboard": () => this.triggerClick('btn-tab-dash'),
                "confirm pickup": () => this.triggerClick('confirm-pickup-btn'),
                "complete delivery": () => this.triggerClick('complete-delivery-btn'),
                "open shipments": () => this.triggerClick('btn-nav-shipments'),
                "open analytics": () => this.triggerClick('btn-nav-analytics'),
                "open finance": () => this.triggerClick('btn-nav-finance'),
                "open safety": () => this.triggerClick('btn-nav-safety'),
                "stop listening": () => this.stop()
            },
            bn: {
                "সমস্যা রিপোর্ট করুন": () => this.triggerClick('report-issue-btn'),
                "ম্যাপ খুলুন": () => this.triggerClick('btn-tab-active'),
                "ওয়ালেট দেখুন": () => this.triggerClick('btn-tab-wallet'),
                "ড্যাশবোর্ডে যান": () => this.triggerClick('btn-tab-dash'),
                "পিকআপ নিশ্চিত করুন": () => this.triggerClick('confirm-pickup-btn'),
                "ডেলিভারি সম্পন্ন করুন": () => this.triggerClick('complete-delivery-btn'),
                "শিপমেন্ট দেখুন": () => this.triggerClick('btn-nav-shipments'),
                "অ্যানালিটিক্স দেখুন": () => this.triggerClick('btn-nav-analytics'),
                "ফাইন্যান্স দেখুন": () => this.triggerClick('btn-nav-finance'),
                "সেফটি সেন্টার দেখুন": () => this.triggerClick('btn-nav-safety'),
                "থামুন": () => this.stop()
            },
            hi: {
                "समस्या रिपोर्ट करें": () => this.triggerClick('report-issue-btn'),
                "मैप खोलें": () => this.triggerClick('btn-tab-active'),
                "वॉलेट देखें": () => this.triggerClick('btn-tab-wallet'),
                "डैशबोर्ड पर जाएं": () => this.triggerClick('btn-tab-dash'),
                "पिकअप की पुष्टि करें": () => this.triggerClick('confirm-pickup-btn'),
                "डिलीवरी पूरी करें": () => this.triggerClick('complete-delivery-btn'),
                "शिपमेंट खोलें": () => this.triggerClick('btn-nav-shipments'),
                "एनालिटिक्स खोलें": () => this.triggerClick('btn-nav-analytics'),
                "फाइनेंस खोलें": () => this.triggerClick('btn-nav-finance'),
                "सेफ्टी सेंटर खोलें": () => this.triggerClick('btn-nav-safety'),
                "रुकिए": () => this.stop()
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

    updateLanguage() {
        this.currentLang = localStorage.getItem('app_lang') || 'en';
        const langMap = { 
            'en': 'en-US', 'bn': 'bn-IN', 'hi': 'hi-IN'
        };
        if (this.recognition) this.recognition.lang = langMap[this.currentLang] || 'en-US';
    }

    getCurrentRole() {
        if (window.location.pathname.includes('driver')) return 'driver';
        if (window.location.pathname.includes('manager')) return 'manager';
        return 'all';
    }

    handleCommand(text) {
        const role = this.getCurrentRole();
        const langCommands = this.commands[this.currentLang] || this.commands.en;
        const enCommands = Object.keys(this.commands.en);
        const localizedCommands = Object.keys(langCommands);

        for (let i = 0; i < localizedCommands.length; i++) {
            const cmd = localizedCommands[i].toLowerCase().trim();
            const enKey = enCommands[i];
            const regEntry = this.registry[enKey];

            if (text.includes(cmd)) {
                if (regEntry.role === 'all' || regEntry.role === role) {
                    langCommands[cmd]();
                    this.provideFeedback(true);
                    return;
                }
            }
        }
        this.provideFeedback(false);
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
        showNotification("Automated Control Active 🎙️", "success");
    }

    stop() {
        if (this.recognition) this.recognition.stop();
        this.isListening = false;
        this.updateUI();
        showNotification("Automated Control Deactivated", "info");
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
        const enCmds = Object.keys(this.commands.en);
        const langCommands = this.commands[lang] || this.commands.en;
        const langCmds = Object.keys(langCommands);
        
        let html = `
            <div id="voice-help-modal" class="glass-card" style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); z-index:10001; width:500px; max-width:90vw; padding:30px; box-shadow:0 20px 50px rgba(0,0,0,0.5); border:1px solid var(--primary);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h2 style="margin:0;">${getTranslation('voice_help_title')}</h2>
                    <button onclick="window.logistixVoice.closeInstructions()" style="background:none; border:none; color:white; font-size:1.5rem; cursor:pointer;">✕</button>
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

        for (let i = 0; i < enCmds.length; i++) {
            const enKey = enCmds[i];
            const localizedCmd = langCmds[i] || enKey; 
            const regEntry = this.registry[enKey];

            if (regEntry && (regEntry.role === 'all' || regEntry.role === role)) {
                const descKey = `voice_instr_${regEntry.desc}`;
                html += `
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                        <td style="padding:12px; font-weight:bold; color:var(--primary);">"${localizedCmd}"</td>
                        <td style="padding:12px; font-size:0.85rem; color:var(--text-muted);">${getTranslation(descKey)}</td>
                    </tr>
                `;
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
        const langMap = { 'en': 'en-US', 'bn': 'bn-IN', 'hi': 'hi-IN' };
        const voiceLang = langMap[lang] || 'en-US';
        
        const enCmds = Object.keys(this.commands.en);
        const langCommands = this.commands[lang] || this.commands.en;
        const langCmds = Object.keys(langCommands);
        
        const sayPrefix = getTranslation('voice_say_prefix');
        let instructions = [];
        instructions.push(getTranslation('voice_help_title'));
        
        for (let i = 0; i < enCmds.length; i++) {
            const enKey = enCmds[i];
            const localizedCmd = langCmds[i];
            const regEntry = this.registry[enKey];

            if (regEntry && (regEntry.role === 'all' || regEntry.role === role) && localizedCmd) {
                const descKey = `voice_instr_${regEntry.desc}`;
                const desc = getTranslation(descKey);
                if (desc && desc !== descKey) {
                    instructions.push(`${desc}. ${sayPrefix} ${localizedCmd}.`);
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
            msg.rate = 0.9; // Slightly faster for better natural flow
            
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
            window.speechSynthesis.onvoiceschanged = null; // Important: Clear the listener
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
