import os

js_code = """const iotHardwareData = {
    cold_chain: {
        title: "Cold-Chain Sensor Array",
        subtitle: "NodeMCU ESP8266 + DHT22 High-Precision Digital Sensor",
        description: "Monitors the ambient temperature of perishable shipments (e.g. Vaccines) in real-time. If the temperature breaches the safe threshold (8°C), it triggers an automated reroute to the nearest cold-storage facility and alerts the driver. This ensures compliance with FDA/pharma regulations.",
        mermaid: `graph TD
    ESP8266[NodeMCU ESP8266 WiFi]
    DHT22[DHT22 Temp/Humidity Sensor]
    POWER[3.3V Power Supply]
    WIFI((WiFi / Internet))
    
    POWER -->|3.3V| ESP8266
    POWER -->|3.3V| DHT22
    ESP8266 -->|GND| DHT22
    DHT22 -.->|Data Pin D4| ESP8266
    ESP8266 ==== WIFI
    WIFI -.->|POST api/iot/event| LogistixAPI[Logistix Backend]

    classDef hardware fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef sensor fill:#1e293b,stroke:#a855f7,stroke-width:2px,color:#fff;
    class ESP8266 hardware;
    class DHT22 sensor;`,
        code: `
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <DHT.h>

#define DHTPIN D4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

const char* ssid = "WIFI_SSID";
const char* password = "WIFI_PASSWORD";
const char* serverURL = "http://logistix-api.local/api/iot/event";

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); }
}

void loop() {
  float temp = dht.readTemperature();
  if (temp > 8.0) { // Threshold breached
    WiFiClient client;
    HTTPClient http;
    http.begin(client, serverURL);
    http.addHeader("Content-Type", "application/json");

    String payload = "{\\"company_id\\":\\"demo\\",\\"device_type\\":\\"cold_chain\\", \\"data\\":{\\"temp\\":" + String(temp) + "},\\"is_mock\\":true}";
    int httpResponseCode = http.POST(payload);
    http.end();
  }
  delay(60000); // Poll every 60s
}`,
        language: 'cpp',
        payload: { temp: 11.4 },
        randomize: () => ({ temp: (Math.random() * 20 - 5).toFixed(1) }) // -5 to 15
    },
    fatigue: {
        title: "Biometric Fatigue Monitor",
        subtitle: "ESP32 + MAX30102 Pulse Oximeter",
        description: "Worn by truck drivers, this sensor monitors heart rate variability and micro-sleeps. If severe fatigue (low HR, high eye closure) is detected, the AI orchestrator forces an emergency 15-minute rest stop, preventing catastrophic accidents.",
        mermaid: `graph LR
    ESP32[ESP32 Microcontroller]
    MAX30102[MAX30102 Heart Rate & SpO2]
    BATTERY[3.7V LiPo]
    
    BATTERY --> ESP32
    ESP32 -->|3.3V / GND| MAX30102
    MAX30102 -.->|I2C SDA Pin 21| ESP32
    MAX30102 -.->|I2C SCL Pin 22| ESP32
    
    classDef hardware fill:#0f172a,stroke:#ef4444,stroke-width:2px,color:#fff;
    class ESP32,MAX30102 hardware;`,
        code: `
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
#include <WiFi.h>
#include <HTTPClient.h>

MAX30105 particleSensor;
const char* serverURL = "http://logistix-api.local/api/iot/event";

void setup() {
  Serial.begin(115200);
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not found");
    while (1);
  }
  particleSensor.setup(); 
  particleSensor.setPulseAmplitudeRed(0x0A);
}

void loop() {
  long irValue = particleSensor.getIR();
  if (checkForBeat(irValue) == true) {
    long delta = millis() - lastBeat;
    lastBeat = millis();
    beatsPerMinute = 60 / (delta / 1000.0);
    
    if (beatsPerMinute < 55) { // Fatigue Warning
       HTTPClient http;
       http.begin(serverURL);
       http.addHeader("Content-Type", "application/json");
       String json = "{\\"company_id\\":\\"demo\\",\\"device_type\\":\\"fatigue\\", \\"data\\":{\\"heart_rate\\":" + String(beatsPerMinute) + ", \\"eye_closure_rate\\": 85},\\"is_mock\\":true}";
       http.POST(json);
       http.end();
    }
  }
}`,
        language: 'cpp',
        payload: { heart_rate: 52, eye_closure_rate: 85 },
        randomize: () => ({ 
            heart_rate: Math.floor(Math.random() * 40) + 45, // 45 to 85
            eye_closure_rate: Math.floor(Math.random() * 60) + 40 // 40 to 100
        })
    },
    weighbridge: {
        title: "Automated Smart Weighbridge",
        subtitle: "Arduino Uno + HX711 Amplifier + 50kg Load Cells",
        description: "Automatically records the payload weight of trucks passing through the hub gates. The AI cross-references this measured weight with the digital cargo manifest to detect theft, smuggling, or misdeclarations instantly without human intervention.",
        mermaid: `graph TD
    UNO[Arduino Uno]
    HX711[HX711 24-bit ADC]
    LC1[Load Cell 1]
    LC2[Load Cell 2]
    LC3[Load Cell 3]
    LC4[Load Cell 4]
    ETHERNET[W5100 Ethernet Shield]
    
    LC1 & LC2 & LC3 & LC4 -->|Wheatstone Bridge| HX711
    HX711 -.->|DT Pin 3| UNO
    HX711 -.->|SCK Pin 2| UNO
    UNO --> ETHERNET
    ETHERNET ===|TCP IP| API[Logistix Gate Server]

    classDef hw fill:#1e293b,stroke:#f59e0b,stroke-width:2px,color:#fff;
    class UNO,HX711,LC1,LC2,LC3,LC4 hw;`,
        code: `
#include "HX711.h"
#include <SPI.h>
#include <Ethernet.h>

const int LOADCELL_DOUT_PIN = 3;
const int LOADCELL_SCK_PIN = 2;
HX711 scale;

byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };
IPAddress server(192, 168, 1, 100);
EthernetClient client;

void setup() {
  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  scale.set_scale(2280.f); 
  scale.tare();
  Ethernet.begin(mac);
}

void loop() {
  if (scale.wait_ready_timeout(1000)) {
    float weight = scale.get_units(10);
    if (weight > 5000.0) { // Truck detected
      if (client.connect(server, 8000)) {
        String json = "{\\"company_id\\":\\"demo\\",\\"device_type\\":\\"weighbridge\\", \\"data\\":{\\"weight\\":" + String(weight) + ", \\"plate\\": \\"MH-12-TX-8899\\"},\\"is_mock\\":true}";
        client.println("POST /api/iot/event HTTP/1.1");
        client.println("Content-Type: application/json");
        client.println("Content-Length: " + String(json.length()));
        client.println();
        client.println(json);
      }
      delay(30000); // Wait for truck to clear
    }
  }
}`,
        language: 'cpp',
        payload: { weight: 12450, plate: 'MH-12-TX-8899' },
        randomize: () => {
            const plates = ['MH-12-TX-8899', 'KA-01-AB-1234', 'DL-4C-AW-9090', 'TN-09-CQ-4545'];
            return {
                weight: Math.floor(Math.random() * 20000) + 2000,
                plate: plates[Math.floor(Math.random() * plates.length)]
            };
        }
    },
    drone: {
        title: "Drone Telemetry Unit",
        subtitle: "Raspberry Pi Zero W + MAVLink Pixhawk",
        description: "A companion computer that interfaces with a delivery drone's flight controller. It streams live altitude, GPS, and battery telemetry to the Logistix AI orchestrator. If the battery is critically low, the AI automatically recalculates a safe descent path to the nearest landing pad.",
        mermaid: `graph LR
    PI[Raspberry Pi Zero W]
    PIX[Pixhawk Flight Controller]
    LTE[4G LTE USB Modem]
    
    PIX -.->|UART MAVLink| PI
    PI -->|USB| LTE
    LTE ==== |Internet| MQTT[Logistix Telemetry Endpoint]

    classDef hw fill:#0f172a,stroke:#a855f7,stroke-width:2px,color:#fff;
    class PI,PIX hw;`,
        code: `
from pymavlink import mavutil
import requests
import time

# Connect to Pixhawk via UART
master = mavutil.mavlink_connection('/dev/serial0', baud=57600)
master.wait_heartbeat()
print("Heartbeat from system (system %u component %u)" % (master.target_system, master.target_component))

URL = "http://logistix-api.local/api/iot/event"

while True:
    try:
        msg = master.recv_match(type='GLOBAL_POSITION_INT', blocking=True)
        batt = master.recv_match(type='SYS_STATUS', blocking=True)
        
        payload = {
            "company_id": "demo",
            "device_type": "drone",
            "data": {
                "lat": msg.lat / 1e7,
                "lng": msg.lon / 1e7,
                "alt": msg.alt / 1000,
                "battery": batt.battery_remaining
            },
            "is_mock": True
        }
        
        requests.post(URL, json=payload)
        time.sleep(5) # Telemetry at 0.2Hz
    except Exception as e:
        print("Error reading MAVLink stream")
`,
        language: 'python',
        payload: { lat: 19.123, lng: 72.881, battery: 12, alt: 120 },
        randomize: () => ({
            lat: (19.0 + Math.random() * 0.2).toFixed(4),
            lng: (72.8 + Math.random() * 0.2).toFixed(4),
            battery: Math.floor(Math.random() * 100),
            alt: Math.floor(Math.random() * 300) + 10
        })
    },
    rfid: {
        title: "RFID Conveyor Scanner",
        subtitle: "ESP8266 + MFRC522 High-Speed Reader",
        description: "Scans packages as they move down a high-speed warehouse conveyor belt. By analyzing the scan rate (packages per second), the AI orchestrator can predict downstream bottlenecks and instantly divert packages to alternative sorting docks before a jam occurs.",
        mermaid: `graph TD
    ESP[ESP8266]
    RFID[MFRC522 RFID Reader]
    CONV[Conveyor Belt Motor Controller]
    
    RFID -.->|SPI MISO MOSI SCK CS| ESP
    ESP -.->|PWM Control| CONV
    ESP ==== |WiFi| API[Logistix Sorting Node]

    classDef hw fill:#1e293b,stroke:#10b981,stroke-width:2px,color:#fff;
    class ESP,RFID hw;`,
        code: `
#include <SPI.h>
#include <MFRC522.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>

#define RST_PIN         D3
#define SS_PIN          D8
MFRC522 mfrc522(SS_PIN, RST_PIN);

void setup() {
  Serial.begin(115200);
  SPI.begin();
  mfrc522.PCD_Init();
  WiFi.begin("SSID", "PASS");
}

void loop() {
  if ( ! mfrc522.PICC_IsNewCardPresent() || ! mfrc522.PICC_ReadCardSerial() ) {
    return;
  }
  
  String uid = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    uid += String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : "");
    uid += String(mfrc522.uid.uidByte[i], HEX);
  }
  
  // Package Detected
  WiFiClient client;
  HTTPClient http;
  http.begin(client, "http://logistix-api.local/api/iot/event");
  http.addHeader("Content-Type", "application/json");
  http.POST("{\\"company_id\\":\\"demo\\",\\"device_type\\":\\"rfid\\", \\"data\\":{\\"scan_rate\\": 145, \\"uid\\": \\"" + uid + "\\"},\\"is_mock\\":true}");
  http.end();
  
  mfrc522.PICC_HaltA();
}`,
        language: 'cpp',
        payload: { scan_rate: 145, uid: 'A4:F2:C9:8B' },
        randomize: () => {
            const hex = () => Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, '0');
            return {
                scan_rate: Math.floor(Math.random() * 300) + 10,
                uid: \`\${hex()}:\${hex()}:\${hex()}:\${hex()}\`
            };
        }
    },
    shock: {
        title: "Shock & Drop Sensor",
        subtitle: "ESP32 + MPU6050 6-Axis Accelerometer",
        description: "Measures extreme G-forces experienced by fragile packages (like electronics). If a package is dropped, it registers the exact impact axis and force, instantly triggering an automated damage assessment and pre-authorizing replacement shipments.",
        mermaid: `graph LR
    ESP[ESP32 Deep Sleep Node]
    MPU[MPU6050 Accel Gyro]
    BATT[18650 Battery]
    
    BATT --> ESP
    ESP -->|3.3V| MPU
    MPU -.->|I2C SDA 21| ESP
    MPU -.->|I2C SCL 22| ESP
    MPU -.->|Interrupt INT| ESP

    classDef hw fill:#0f172a,stroke:#f43f5e,stroke-width:2px,color:#fff;
    class ESP,MPU hw;`,
        code: `
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <WiFi.h>
#include <HTTPClient.h>

Adafruit_MPU6050 mpu;

void setup() {
  Serial.begin(115200);
  if (!mpu.begin()) {
    while (1) delay(10);
  }
  
  // Set High-G Interrupt
  mpu.setHighPassFilter(MPU6050_HIGHPASS_0_63_HZ);
  mpu.setMotionDetectionThreshold(5); // 5G threshold
  mpu.setMotionDetectionDuration(20);
  mpu.setInterruptPinLatch(true);
  mpu.setInterruptPinPolarity(true);
  mpu.setMotionInterrupt(true);
}

void loop() {
  if (mpu.getMotionInterruptStatus()) {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    
    // Calculate vector magnitude
    float gForce = sqrt(pow(a.acceleration.x, 2) + pow(a.acceleration.y, 2) + pow(a.acceleration.z, 2)) / 9.81;
    
    HTTPClient http;
    http.begin("http://logistix-api.local/api/iot/event");
    http.addHeader("Content-Type", "application/json");
    http.POST("{\\"company_id\\":\\"demo\\",\\"device_type\\":\\"shock\\", \\"data\\":{\\"g_force\\":" + String(gForce) + ", \\"axis\\":\\"Z\\"},\\"is_mock\\":true}");
    http.end();
  }
  delay(100);
}`,
        language: 'cpp',
        payload: { g_force: 8.2, axis: 'Z' },
        randomize: () => {
            const axes = ['X', 'Y', 'Z'];
            return {
                g_force: (Math.random() * 15 + 2).toFixed(1), // 2 to 17 G
                axis: axes[Math.floor(Math.random() * axes.length)]
            };
        }
    }
};

let currentActiveIoT = null;
let currentMockPayload = {};

async function openIoTModal(deviceKey) {
    const data = iotHardwareData[deviceKey];
    if (!data) return;
    
    currentActiveIoT = deviceKey;
    currentMockPayload = { ...data.payload }; // deep copy initial
    
    document.getElementById('iotModalTitle').innerText = data.title;
    document.getElementById('iotModalSubtitle').innerText = data.subtitle;
    
    // Add Description
    let descElem = document.getElementById('iotModalDesc');
    if(!descElem) {
        descElem = document.createElement('p');
        descElem.id = 'iotModalDesc';
        descElem.style.margin = '10px 0 0 0';
        descElem.style.color = 'var(--text-main)';
        descElem.style.fontSize = '0.95rem';
        descElem.style.lineHeight = '1.5';
        descElem.style.opacity = '0.9';
        const headerDiv = document.getElementById('iotModalSubtitle').parentElement;
        headerDiv.appendChild(descElem);
    }
    descElem.innerText = data.description;
    
    // Render Mermaid robustly using mermaid.render
    const mermaidContainer = document.getElementById('mermaid-container');
    const id = 'mermaidSvgId_' + Math.random().toString(36).substr(2, 9);
    try {
        if(window.mermaid) {
            const { svg } = await mermaid.render(id, data.mermaid);
            mermaidContainer.innerHTML = svg;
        } else {
            mermaidContainer.innerHTML = '<span style="color:red;">Mermaid library failed to load</span>';
        }
    } catch(e) { 
        console.error('Mermaid render error', e); 
        mermaidContainer.innerHTML = '<span style="color:red;">Error rendering diagram: ' + e.message + '</span>';
    }

    // Render Code
    document.getElementById('code-filename').innerText = data.language === 'cpp' ? 'main.ino' : 'main.py';
    const codeBlock = document.getElementById('code-block');
    codeBlock.className = 'language-' + data.language;
    codeBlock.textContent = data.code.trim();
    
    if(window.Prism) {
        Prism.highlightElement(codeBlock);
    }

    // Render Payload Editor
    renderPayloadEditor();

    // Reset Terminal
    const term = document.getElementById('iot-term-body');
    term.innerHTML = '<span style="color:#10b981;">[System] Secure connection established to Mock Engine.</span><br>';

    switchIoTTab('schematic');
    document.getElementById('iotModal').style.display = 'flex';
}

function renderPayloadEditor() {
    let editorContainer = document.getElementById('payload-editor');
    if(!editorContainer) {
        const testSection = document.getElementById('tab-testing');
        const triggerDiv = testSection.children[0];
        
        editorContainer = document.createElement('div');
        editorContainer.id = 'payload-editor';
        editorContainer.style.marginTop = '15px';
        editorContainer.style.background = 'var(--bg-base)';
        editorContainer.style.padding = '12px';
        editorContainer.style.borderRadius = '8px';
        editorContainer.style.border = '1px solid var(--border-highlight)';
        
        triggerDiv.insertBefore(editorContainer, document.getElementById('iot-trigger-btn'));
        
        const controls = document.createElement('div');
        controls.innerHTML = '<button class="btn btn-outline" onclick="randomizePayload()" style="width:100%; margin-bottom:15px; padding:8px; font-size:0.85rem;">🎲 Randomize Values</button>';
        triggerDiv.insertBefore(controls, editorContainer);
    }
    
    editorContainer.innerHTML = '<h4 style="margin:0 0 10px 0; font-size:0.9rem; color:var(--text-muted);">Edit JSON Payload Data</h4>';
    
    Object.keys(currentMockPayload).forEach(key => {
        const val = currentMockPayload[key];
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.marginBottom = '8px';
        
        row.innerHTML = \`
            <label style="flex:1; font-family:monospace; font-size:0.85rem; color:var(--text-main);">"\${key}":</label>
            <input type="text" onchange="updatePayloadValue('\${key}', this.value)" value="\${val}" style="flex:2; padding:6px; border-radius:4px; border:1px solid var(--border); background:var(--surface); color:var(--text-main); font-family:monospace; outline:none;">
        \`;
        editorContainer.appendChild(row);
    });
}

function updatePayloadValue(key, value) {
    // Try to parse as number if it looks like one
    if(!isNaN(value) && value.trim() !== '') {
        currentMockPayload[key] = Number(value);
    } else {
        currentMockPayload[key] = value;
    }
}

function randomizePayload() {
    if (!currentActiveIoT) return;
    const randomizeFunc = iotHardwareData[currentActiveIoT].randomize;
    if(randomizeFunc) {
        currentMockPayload = randomizeFunc();
        renderPayloadEditor();
    }
}

function switchIoTTab(tabName) {
    const tabs = ['schematic', 'firmware', 'testing'];
    tabs.forEach(t => {
        document.getElementById('tab-' + t).style.display = (t === tabName) ? 'block' : 'none';
    });
    
    const btns = document.querySelectorAll('.iot-tab-btn');
    btns.forEach(btn => {
        btn.style.color = 'var(--text-muted)';
        btn.style.borderBottomColor = 'transparent';
    });
    
    const activeBtn = Array.from(btns).find(b => b.innerText.toLowerCase().includes(tabName === 'testing' ? 'live' : tabName.substring(0, 4)));
    if (activeBtn) {
        activeBtn.style.color = 'var(--text-main)';
        activeBtn.style.borderBottomColor = 'var(--accent-1)';
    }

    if (tabName === 'testing') {
        document.getElementById('tab-testing').style.display = 'flex'; // override for flex
    }
}

function copyIoTCode() {
    if(!currentActiveIoT) return;
    const code = iotHardwareData[currentActiveIoT].code.trim();
    navigator.clipboard.writeText(code).then(() => {
        alert("Firmware code copied to clipboard!");
    });
}

async function executeIoTSimulation() {
    if (!currentActiveIoT) return;
    
    const btn = document.getElementById('iot-trigger-btn');
    const term = document.getElementById('iot-term-body');
    
    btn.innerHTML = '⏳ Transmitting...';
    btn.disabled = true;

    const reqBody = {
        company_id: 'mock-environment', // Use mock ID to isolate logic
        device_type: currentActiveIoT,
        data: currentMockPayload,
        is_mock: true // Tell backend to not touch real db
    };

    appendTermLog('Attempting to send payload to /api/iot/event: \\n' + JSON.stringify(reqBody, null, 2), '#64748b');

    try {
        const response = await fetch('/api/iot/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody)
        });
        
        const res = await response.json();
        
        if (res && res.logs) {
            const time = new Date().toLocaleTimeString();
            let html = '<div style="margin-top:10px; padding-bottom:10px; border-bottom:1px dashed #334155;">' +
                '<span style="color:#64748b; font-size:0.8rem;">[' + time + ']</span><br>' +
                '<span style="color:#38bdf8; font-weight:bold;">>> ' + res.logs[0] + '</span>';
            
            if (res.logs[1]) {
                html += '<div style="color:#a855f7; font-weight:bold; margin-top:8px; padding:8px; background:rgba(168, 85, 247, 0.1); border-radius:8px; border-left:3px solid #a855f7;">✨ ' + res.logs[1] + '</div>';
            }
            html += '</div>';
            
            term.insertAdjacentHTML('beforeend', html);
            term.scrollTop = term.scrollHeight;
        }
    } catch (err) {
        appendTermLog('ERROR: ' + err.message, '#ef4444');
    } finally {
        btn.innerHTML = '📡 Transmit Mock Payload';
        btn.disabled = false;
    }
}

function appendTermLog(text, color) {
    const term = document.getElementById('iot-term-body');
    const time = new Date().toLocaleTimeString();
    const html = '<div style="margin-top:10px; padding-bottom:10px; border-bottom:1px dashed #334155;">' +
        '<span style="color:#64748b; font-size:0.8rem;">[' + time + ']</span><br>' +
        '<span style="color:' + color + '; white-space:pre-wrap;">' + text + '</span>' +
    '</div>';
    term.insertAdjacentHTML('beforeend', html);
    term.scrollTop = term.scrollHeight;
}
"""

with open('frontend/js/iot_hardware.js', 'w') as f:
    f.write(js_code)

print("Rewrote iot_hardware.js successfully.")
