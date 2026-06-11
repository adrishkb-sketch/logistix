import re
import os

html_to_inject = """
<!-- ── CYBER-PHYSICAL IoT HARDWARE ──────────────────────────────────────────── -->
<section id="iot-hardware" class="reveal">
    <div style="text-align: center; margin-bottom: 60px;">
        <div class="ai-header-badge" style="margin-bottom: 16px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
            <span>Developer Hardware Portal</span>
        </div>
        <h2 class="split-text" style="display:block; margin-bottom: 12px;">Cyber-Physical IoT</h2>
        <p style="color:var(--text-main); opacity:0.9; max-width:650px; font-size:1.1rem; line-height:1.7; margin: 0 auto;">
            Explore the exact circuit blueprints and firmware code needed to connect real-world hardware sensors to the Logistix API.
        </p>
    </div>
    <div class="features-grid">
        <!-- 1. Cold-Chain Sensor -->
        <div class="card" onclick="openIoTModal('cold_chain')">
            <div class="icon-box">
                <span style="font-size: 2rem;">🥶</span>
            </div>
            <h3 class="text-shine-hover">Cold-Chain Sensor</h3>
            <p>NodeMCU ESP8266 + DHT22<br><span style="font-size: 0.85rem; color: var(--accent-1);">View Blueprint & Code -></span></p>
        </div>
        <!-- 2. Biometric Fatigue Monitor -->
        <div class="card" onclick="openIoTModal('fatigue')">
            <div class="icon-box">
                <span style="font-size: 2rem;">👁️</span>
            </div>
            <h3 class="text-shine-hover">Biometric Monitor</h3>
            <p>ESP32 + MAX30102 Oximeter<br><span style="font-size: 0.85rem; color: var(--accent-1);">View Blueprint & Code -></span></p>
        </div>
        <!-- 3. Smart Weighbridge -->
        <div class="card" onclick="openIoTModal('weighbridge')">
            <div class="icon-box">
                <span style="font-size: 2rem;">⚖️</span>
            </div>
            <h3 class="text-shine-hover">Smart Weighbridge</h3>
            <p>Arduino Uno + HX711 Load Cell<br><span style="font-size: 0.85rem; color: var(--accent-1);">View Blueprint & Code -></span></p>
        </div>
        <!-- 4. Drone Telemetry -->
        <div class="card" onclick="openIoTModal('drone')">
            <div class="icon-box">
                <span style="font-size: 2rem;">🚁</span>
            </div>
            <h3 class="text-shine-hover">Drone Telemetry</h3>
            <p>Raspberry Pi Zero W + Pixhawk<br><span style="font-size: 0.85rem; color: var(--accent-1);">View Blueprint & Code -></span></p>
        </div>
        <!-- 5. RFID Conveyor -->
        <div class="card" onclick="openIoTModal('rfid')">
            <div class="icon-box">
                <span style="font-size: 2rem;">📦</span>
            </div>
            <h3 class="text-shine-hover">RFID Conveyor</h3>
            <p>ESP8266 + RC522 Reader<br><span style="font-size: 0.85rem; color: var(--accent-1);">View Blueprint & Code -></span></p>
        </div>
        <!-- 6. Shock/Drop Sensor -->
        <div class="card" onclick="openIoTModal('shock')">
            <div class="icon-box">
                <span style="font-size: 2rem;">💥</span>
            </div>
            <h3 class="text-shine-hover">Shock/Drop Sensor</h3>
            <p>ESP32 + MPU6050 Accelerometer<br><span style="font-size: 0.85rem; color: var(--accent-1);">View Blueprint & Code -></span></p>
        </div>
    </div>
</section>

<!-- IoT Hardware Modal UI -->
<div id="iotModal" class="modal-overlay" style="display:none; position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.8); backdrop-filter:blur(10px); align-items:center; justify-content:center; padding: 20px;">
    <div class="modal-content" style="background:var(--bg-base); border:1px solid var(--border-highlight); border-radius:24px; width:100%; max-width:900px; max-height:90vh; display:flex; flex-direction:column; overflow:hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
        
        <!-- Header -->
        <div style="padding: 24px; border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center; background:var(--surface);">
            <div>
                <h2 id="iotModalTitle" style="margin:0; font-size:1.6rem; color:var(--text-main);">Hardware Blueprint</h2>
                <p id="iotModalSubtitle" style="margin:4px 0 0 0; color:var(--accent-1); font-family:monospace; font-size:0.9rem;">Loading hardware specs...</p>
            </div>
            <button onclick="document.getElementById('iotModal').style.display='none'" style="background:none; border:none; color:var(--text-main); font-size:2rem; cursor:pointer; padding:0; line-height:1;">&times;</button>
        </div>
        
        <!-- Tab Navigation -->
        <div style="display:flex; border-bottom: 1px solid var(--border); background:rgba(0,0,0,0.2);">
            <button class="iot-tab-btn active" onclick="switchIoTTab('schematic')" style="flex:1; padding:16px; background:transparent; border:none; color:var(--text-main); font-weight:700; cursor:pointer; border-bottom:3px solid var(--accent-1); transition:all 0.3s;">⚙️ Circuit Schematic</button>
            <button class="iot-tab-btn" onclick="switchIoTTab('firmware')" style="flex:1; padding:16px; background:transparent; border:none; color:var(--text-muted); font-weight:700; cursor:pointer; border-bottom:3px solid transparent; transition:all 0.3s;">💻 Firmware Code</button>
            <button class="iot-tab-btn" onclick="switchIoTTab('testing')" style="flex:1; padding:16px; background:transparent; border:none; color:var(--text-muted); font-weight:700; cursor:pointer; border-bottom:3px solid transparent; transition:all 0.3s;">🚀 Live Testing</button>
        </div>

        <!-- Scrollable Content Area -->
        <div style="flex:1; overflow-y:auto; padding: 24px; background:rgba(0,0,0,0.1); min-height: 400px; position:relative;">
            
            <!-- Tab 1: Schematic -->
            <div id="tab-schematic" class="iot-tab-content" style="display:block; text-align:center;">
                <p style="color:var(--text-muted); margin-bottom: 20px;">Rendered Hardware Wiring Diagram</p>
                <div id="mermaid-container" style="background:var(--surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border); overflow-x: auto;">
                    <!-- Mermaid diagram will be injected here -->
                </div>
            </div>

            <!-- Tab 2: Firmware Code -->
            <div id="tab-firmware" class="iot-tab-content" style="display:none;">
                <div style="display:flex; justify-content:space-between; margin-bottom: 12px;">
                    <span style="color:var(--accent-1); font-family:monospace; font-size:0.9rem;" id="code-filename">main.ino</span>
                    <button onclick="copyIoTCode()" style="background:var(--surface); border:1px solid var(--border); color:var(--text-main); border-radius:8px; padding:4px 12px; cursor:pointer; font-size:0.8rem;">Copy Code</button>
                </div>
                <pre style="margin:0; border-radius:12px; background:#0f172a; padding:20px; overflow-x:auto; border:1px solid #1e293b; box-shadow:inset 0 2px 10px rgba(0,0,0,0.5);"><code id="code-block" class="language-cpp" style="font-family:'Courier New', Courier, monospace; font-size:0.9rem; color:#e2e8f0; line-height:1.5;"></code></pre>
            </div>

            <!-- Tab 3: Live Testing -->
            <div id="tab-testing" class="iot-tab-content" style="display:none; height:100%; display:flex; flex-direction:column;">
                <div style="margin-bottom:20px; background:var(--surface); padding:20px; border-radius:12px; border:1px solid var(--border);">
                    <h3 style="margin:0 0 10px 0; font-size:1.1rem;">Isolated Mock Database Engine</h3>
                    <p style="margin:0 0 16px 0; color:var(--text-muted); font-size:0.9rem;">Triggering this sensor will instantiate a secure sandbox environment on the backend to prevent polluting live Logistix data.</p>
                    <button id="iot-trigger-btn" class="btn btn-primary" onclick="executeIoTSimulation()" style="width:100%;">📡 Transmit Mock Payload</button>
                </div>

                <div class="terminal-container" style="background:#0f172a; border-radius:12px; border:1px solid #1e293b; flex:1; display:flex; flex-direction:column; min-height: 250px;">
                    <div style="background:#1e293b; padding:8px 16px; border-bottom:1px solid #334155; display:flex; align-items:center; gap:8px;">
                        <div style="width:10px; height:10px; border-radius:50%; background:#ef4444;"></div>
                        <div style="width:10px; height:10px; border-radius:50%; background:#f59e0b;"></div>
                        <div style="width:10px; height:10px; border-radius:50%; background:#10b981;"></div>
                        <span style="font-family:monospace; color:#94a3b8; font-size:0.8rem; margin-left:10px;">bash - backend_listener</span>
                    </div>
                    <div id="iot-term-body" style="padding:16px; font-family:monospace; font-size:0.85rem; color:#e2e8f0; overflow-y:auto; flex:1; line-height:1.6;">
                        <span style="color:#10b981;">[System] Port 8000 Listening...</span><br>
                    </div>
                </div>
            </div>

        </div>
    </div>
</div>
"""

filepath = 'frontend/index.html'

with open(filepath, 'r') as f:
    content = f.read()

# Insert the HTML block after </section> of ai-features
target_string = '</section>\n\n<!-- ── PLATFORM ──────────────────────────────────────────── -->'
if target_string in content:
    content = content.replace(target_string, '</section>\n\n' + html_to_inject + '\n\n<!-- ── PLATFORM ──────────────────────────────────────────── -->')
    print("Injected HTML successfully.")
else:
    print("Could not find injection point.")

# Add Mermaid.js and JS logic before </body>
js_to_inject = """
<!-- PrismJS for code highlighting -->
<link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-c.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-cpp.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-python.min.js"></script>
<!-- Mermaid.js for Diagrams -->
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script>
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
</script>
<script src="js/iot_hardware.js"></script>
"""

target_body = '</body>'
if target_body in content and 'iot_hardware.js' not in content:
    content = content.replace(target_body, js_to_inject + '\n' + target_body)
    print("Injected JS successfully.")

with open(filepath, 'w') as f:
    f.write(content)
