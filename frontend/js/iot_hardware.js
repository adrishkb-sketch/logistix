const iotHardwareData = {
    cold_chain: {
        title: "Cold-Chain Sensor Array",
        subtitle: "NodeMCU ESP8266 + DHT22 High-Precision Digital Sensor",
        mermaid: `
        graph TD
            ESP8266[NodeMCU ESP8266 WiFi]
            DHT22[DHT22 Temp/Humidity Sensor]
            POWER[3.3V Power Supply]
            WIFI((WiFi / Internet))
            
            POWER -->|3.3V| ESP8266
            POWER -->|3.3V| DHT22
            ESP8266 -->|GND| DHT22
            DHT22 -.->|Data Pin D4| ESP8266
            ESP8266 ==== WIFI
            WIFI -.->|POST /api/iot/event| LogistixAPI[Logistix Backend]

            classDef hardware fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#fff;
            classDef sensor fill:#1e293b,stroke:#a855f7,stroke-width:2px,color:#fff;
            class ESP8266 hardware;
            class DHT22 sensor;
        `,
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

    String payload = "{\\"device_type\\":\\"cold_chain\\", \\"data\\":{\\"temp\\":" + String(temp) + "}}";
    int httpResponseCode = http.POST(payload);
    http.end();
  }
  delay(60000); // Poll every 60s
}`,
        language: 'cpp',
        payload: { temp: 11.4 }
    },
    fatigue: {
        title: "Biometric Fatigue Monitor",
        subtitle: "ESP32 + MAX30102 Pulse Oximeter",
        mermaid: `
        graph LR
            ESP32[ESP32 Microcontroller]
            MAX30102[MAX30102 Heart Rate & SpO2]
            BATTERY[3.7V LiPo]
            
            BATTERY --> ESP32
            ESP32 -->|3.3V / GND| MAX30102
            MAX30102 -.->|I2C SDA: Pin 21| ESP32
            MAX30102 -.->|I2C SCL: Pin 22| ESP32
            
            classDef hardware fill:#0f172a,stroke:#ef4444,stroke-width:2px,color:#fff;
            class ESP32,MAX30102 hardware;
        `,
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
       String json = "{\\"device_type\\":\\"fatigue\\", \\"data\\":{\\"heart_rate\\":" + String(beatsPerMinute) + "}}";
       http.POST(json);
       http.end();
    }
  }
}`,
        language: 'cpp',
        payload: { heart_rate: 52, eye_closure_rate: 85 }
    },
    weighbridge: {
        title: "Automated Smart Weighbridge",
        subtitle: "Arduino Uno + HX711 Amplifier + 50kg Load Cells",
        mermaid: `
        graph TD
            UNO[Arduino Uno]
            HX711[HX711 24-bit ADC]
            LC1[Load Cell 1]
            LC2[Load Cell 2]
            LC3[Load Cell 3]
            LC4[Load Cell 4]
            ETHERNET[W5100 Ethernet Shield]
            
            LC1 & LC2 & LC3 & LC4 -->|Wheatstone Bridge| HX711
            HX711 -.->|DT: Pin 3| UNO
            HX711 -.->|SCK: Pin 2| UNO
            UNO --> ETHERNET
            ETHERNET ===|TCP/IP| API[Logistix Gate Server]

            classDef hw fill:#1e293b,stroke:#f59e0b,stroke-width:2px,color:#fff;
            class UNO,HX711,LC1,LC2,LC3,LC4 hw;
        `,
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
        String json = "{\\"device_type\\":\\"weighbridge\\", \\"data\\":{\\"weight\\":" + String(weight) + "}}";
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
        payload: { weight: 12450, plate: 'MH-12-TX-8899' }
    },
    drone: {
        title: "Drone Telemetry Unit",
        subtitle: "Raspberry Pi Zero W + MAVLink Pixhawk",
        mermaid: `
        graph LR
            PI[Raspberry Pi Zero W]
            PIX[Pixhawk Flight Controller]
            LTE[4G LTE USB Modem]
            
            PIX -.->|UART / MAVLink| PI
            PI -->|USB| LTE
            LTE ==== |Internet| MQTT[Logistix Telemetry Endpoint]

            classDef hw fill:#0f172a,stroke:#a855f7,stroke-width:2px,color:#fff;
            class PI,PIX hw;
        `,
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
            "device_type": "drone",
            "data": {
                "lat": msg.lat / 1e7,
                "lng": msg.lon / 1e7,
                "alt": msg.alt / 1000,
                "battery": batt.battery_remaining
            }
        }
        
        requests.post(URL, json=payload)
        time.sleep(5) # Telemetry at 0.2Hz
    except Exception as e:
        print("Error reading MAVLink stream")
`,
        language: 'python',
        payload: { lat: 19.123, lng: 72.881, battery: 12, alt: 120 }
    },
    rfid: {
        title: "RFID Conveyor Scanner",
        subtitle: "ESP8266 + MFRC522 High-Speed Reader",
        mermaid: `
        graph TD
            ESP[ESP8266]
            RFID[MFRC522 RFID Reader]
            CONV[Conveyor Belt Motor Controller]
            
            RFID -.->|SPI (MISO/MOSI/SCK/CS)| ESP
            ESP -.->|PWM Control| CONV
            ESP ==== |WiFi| API[Logistix Sorting Node]

            classDef hw fill:#1e293b,stroke:#10b981,stroke-width:2px,color:#fff;
            class ESP,RFID hw;
        `,
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
  http.POST("{\\"device_type\\":\\"rfid\\", \\"data\\":{\\"scan_rate\\": 145, \\"uid\\": \\"" + uid + "\\"}}");
  http.end();
  
  mfrc522.PICC_HaltA();
}`,
        language: 'cpp',
        payload: { scan_rate: 145, uid: 'A4:F2:C9:8B' }
    },
    shock: {
        title: "Shock & Drop Sensor",
        subtitle: "ESP32 + MPU6050 6-Axis Accelerometer",
        mermaid: `
        graph LR
            ESP[ESP32 Deep Sleep Node]
            MPU[MPU6050 Accel/Gyro]
            BATT[18650 Battery]
            
            BATT --> ESP
            ESP -->|3.3V| MPU
            MPU -.->|I2C SDA: 21| ESP
            MPU -.->|I2C SCL: 22| ESP
            MPU -.->|Interrupt INT| ESP

            classDef hw fill:#0f172a,stroke:#f43f5e,stroke-width:2px,color:#fff;
            class ESP,MPU hw;
        `,
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
    http.POST("{\\"device_type\\":\\"shock\\", \\"data\\":{\\"g_force\\":" + String(gForce) + ", \\"axis\\":\\"Z\\"}}");
    http.end();
  }
  delay(100);
}`,
        language: 'cpp',
        payload: { g_force: 8.2, axis: 'Z' }
    }
};

let currentActiveIoT = null;

async function openIoTModal(deviceKey) {
    const data = iotHardwareData[deviceKey];
    if (!data) return;
    
    currentActiveIoT = deviceKey;
    document.getElementById('iotModalTitle').innerText = data.title;
    document.getElementById('iotModalSubtitle').innerText = data.subtitle;
    
    // Render Mermaid
    const mermaidContainer = document.getElementById('mermaid-container');
    mermaidContainer.innerHTML = `<div class="mermaid">${data.mermaid}</div>`;
    
    // We must try to render mermaid if it's already loaded
    try {
        if(window.mermaid) {
            await mermaid.run({
                querySelector: '.mermaid'
            });
        }
    } catch(e) { console.error('Mermaid render error', e); }

    // Render Code
    document.getElementById('code-filename').innerText = data.language === 'cpp' ? 'main.ino' : 'main.py';
    const codeBlock = document.getElementById('code-block');
    codeBlock.className = `language-${data.language}`;
    codeBlock.textContent = data.code.trim();
    
    if(window.Prism) {
        Prism.highlightElement(codeBlock);
    }

    // Reset Terminal
    const term = document.getElementById('iot-term-body');
    term.innerHTML = '<span style="color:#10b981;">[System] Secure connection established to Mock Engine.</span><br>';

    switchIoTTab('schematic');
    document.getElementById('iotModal').style.display = 'flex';
}

function switchIoTTab(tabName) {
    const tabs = ['schematic', 'firmware', 'testing'];
    tabs.forEach(t => {
        document.getElementById(`tab-${t}`).style.display = (t === tabName) ? 'block' : 'none';
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
    const data = iotHardwareData[currentActiveIoT];
    
    btn.innerHTML = '⏳ Transmitting...';
    btn.disabled = true;

    const reqBody = {
        company_id: 'mock-environment', // Use mock ID to isolate logic
        device_type: currentActiveIoT,
        data: data.payload,
        is_mock: true // Tell backend to not touch real db
    };

    appendTermLog(`Attempting to send payload to /api/iot/event: \n${JSON.stringify(reqBody, null, 2)}`, '#64748b');

    try {
        const response = await fetch('/api/iot/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody)
        });
        
        const res = await response.json();
        
        if (res && res.logs) {
            const time = new Date().toLocaleTimeString();
            let html = `<div style="margin-top:10px; padding-bottom:10px; border-bottom:1px dashed #334155;">
                <span style="color:#64748b; font-size:0.8rem;">[${time}]</span><br>
                <span style="color:#38bdf8; font-weight:bold;">>> ${res.logs[0]}</span>`;
            
            if (res.logs[1]) {
                html += `<div style="color:#a855f7; font-weight:bold; margin-top:8px; padding:8px; background:rgba(168, 85, 247, 0.1); border-radius:8px; border-left:3px solid #a855f7;">✨ ${res.logs[1]}</div>`;
            }
            html += `</div>`;
            
            term.insertAdjacentHTML('beforeend', html);
            term.scrollTop = term.scrollHeight;
        }
    } catch (err) {
        appendTermLog(`ERROR: ${err.message}`, '#ef4444');
    } finally {
        btn.innerHTML = '📡 Transmit Mock Payload';
        btn.disabled = false;
    }
}

function appendTermLog(text, color) {
    const term = document.getElementById('iot-term-body');
    const time = new Date().toLocaleTimeString();
    const html = `<div style="margin-top:10px; padding-bottom:10px; border-bottom:1px dashed #334155;">
        <span style="color:#64748b; font-size:0.8rem;">[${time}]</span><br>
        <span style="color:${color}; white-space:pre-wrap;">${text}</span>
    </div>`;
    term.insertAdjacentHTML('beforeend', html);
    term.scrollTop = term.scrollHeight;
}
