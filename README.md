<div align="center">
  <img src="frontend/favicon.svg" alt="Logistix Logo" width="150" />
  <h1>🌌 Logistix</h1>
  <p><strong>Next-Generation AI-Powered Logistics & Supply Chain Platform</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Python-3.9+-blue.svg" alt="Python Version">
    <img src="https://img.shields.io/badge/FastAPI-0.95+-009688.svg?logo=fastapi" alt="FastAPI">
    <img src="https://img.shields.io/badge/Frontend-Vanilla_JS_%2B_Glassmorphism-f7df1e.svg" alt="Frontend">
    <img src="https://img.shields.io/badge/AI-Google_Gemini-4285F4.svg?logo=google" alt="Google Gemini">
    <img src="https://img.shields.io/badge/Status-Active_Development-success.svg" alt="Status">
  </p>
</div>

<br>

**Logistix** is an enterprise-grade, hyper-scale logistics and fleet management platform engineered for the modern supply chain. By bridging the gap between heavy infrastructure and cutting-edge software architecture, Logistix provides real-time visibility, automated AI-driven decision-making, and seamless coordination across every node of your logistical network.

---

## 🚀 The Logistix Advantage

Logistix abandons the monolithic, "one-size-fits-all" dashboard approach. Instead, it decentralizes supply chain management into highly specialized, purpose-built portals for every persona in the logistics ecosystem.

It is powered by a robust **Python FastAPI backend** capable of routing massive telemetry datasets, backed by **Google's Gemini AI** for unparalleled predictive analytics, and presented through a stunning, bespoke **Bioluminescent Glassmorphism Design System**.

---

## ✨ Comprehensive Feature Ecosystem

### 🏢 1. Executive / Regional Manager Portal
The ultimate command center for regional oversight, giving C-suite and regional managers a god's-eye view of their logistics network.
- **AI Strategy Oracle:** Directly consults the integrated Gemini LLM to generate network-wide resilience strategies and predictive analytics based on live data.
- **Weather Fleet Map:** Real-time geospatial mapping (`Leaflet.js`) of the entire active fleet, overlaying live weather disruptions, storm warnings, and traffic bottlenecks.
- **Bharat-Fuel Oracle:** AI-driven fuel pricing analysis connected to national fuel index APIs to dynamically calculate route costs and optimize fleet expenditures based on vehicle class (LCV, HCV, EV).
- **Network Resilience Simulator:** Simulates catastrophic failure scenarios (e.g., hub closures, driver strikes, natural disasters) and generates instant AI-powered recovery and rerouting plans.
- **Global Leaderboards:** Gamified driver and hub performance metrics to encourage operational excellence.

### 🏭 2. Warehouse Hub Manager Portal
The high-performance, localized control interface for individual warehouse operations.
- **Gate Check-In & Dock Scheduling:** Digitally manages the influx of inbound and outbound freight, assigning loading bays dynamically to minimize truck idle times.
- **Automated ML Verifications:** Employs computer vision and Machine Learning to automatically scan, OCR, and verify driver license plates and manifest documents upon arrival.
- **Daily Fleet & Driver Audit:** A centralized system to track the physical fitness, readiness, and maintenance logs of assets tied to the local hub.
- **Drone Hub Management:** Oversees dispatching, battery levels, and telemetry for autonomous drones handling last-mile deliveries in congested urban zones.

### 🚚 3. Driver & Fleet Companion App
A mobile-first, highly accessible progressive web application designed specifically for the operators on the ground.
- **Live Navigation & Task Management:** Step-by-step optimized routing, digital delivery checklists, and secure proof-of-delivery (PoD) uploads via camera.
- **Integrated Digital Wallet:** Real-time tracking of driver earnings, toll reimbursements, and automated milestone bonuses (e.g., "Safe Driver of the Month").
- **Voice-Activated Smart Chat:** Direct, hands-free communication with the Hub Manager and automated AI dispatch bots to report delays or vehicle issues without taking hands off the wheel.
- **On-the-fly Linguistic Translation:** Supports 22+ regional languages allowing drivers to operate the app in their native tongue.

### 📦 4. Customer Tracking Portal
The transparent, end-user facing delivery tracking experience.
- **Live GPS Plotting:** Real-time visual tracking of the delivery vehicle on a premium dark-mode map.
- **Dynamic ETA Engine:** Highly accurate arrival times calculated using current traffic heuristics and weather data.
- **Secure Handoffs:** Cryptographically secure OTP (One-Time Password) generation for high-value deliveries.

---

## 🧠 Deep AI & Machine Learning Integration

Logistix isn't just a passive tracking tool; it is an intelligent, active orchestrator.

* **Automated Voice Control Engine (VCE):** Managers can control the dashboard entirely hands-free. Using natural language parsing, users can say *"Show me delayed shipments in Hub B"* or *"Switch to dark mode"*, and the UI reacts instantly.
* **Smart Plate Recognition (ALPR):** Automates gate access by visually verifying truck license plates against the database, cutting check-in times by 80%.
* **Predictive Bottleneck Analysis:** Continuously monitors historical and live flow data to warn hub managers of impending dock overcrowding before it happens.
* **Dynamic Green Routing Heuristics:** The system actively reroutes trucks to bypass high-congestion, steep-gradient, and high-idle sectors, minimizing the overall carbon footprint.

---

## 🌍 Native Multilingual Support (L10N)

Logistix is built for scale across diverse linguistic demographics. The platform features an incredibly fast, client-side translation engine supporting **22+ Languages** instantly without page reloads. Supported languages include:
* English, Hindi (हिंदी), Bengali (বাংলা), Tamil (தமிழ்), Telugu (తెలుగు), Marathi (मराठी), Gujarati (ગુજરાતી), Kannada (ಕನ್ನಡ), Malayalam (മലയാളം), Punjabi (ਪੰਜਾਬੀ), and many more.

---

## 🎨 Bioluminescent UI/UX Design System

The frontend architecture entirely abandons bloated CSS frameworks (like Bootstrap or Tailwind) in favor of a highly bespoke, ultra-optimized **Bioluminescent UI**.

* **Interactive Physics Background:** A responsive 2D canvas grid dynamically reacts to mouse and touch inputs, simulating magnetic force fields and fluid dynamics.
* **Glassmorphism Components:** Dashboards utilize deep `backdrop-filter` blurring, translucent borders, and multi-layered shadows (`.modal-glass`, `.glass-card`) for a premium 3D depth effect.
* **Dynamic Wave Typography:** Headings employ a customized character-split script (`.split-text`) that creates a responsive, physics-based "lifting wave" effect when hovered.
* **Sub-millisecond State Transitions:** All buttons, modals, and data grids are tied to hardware-accelerated CSS animations for a buttery smooth 60fps experience.

---

## 🛠 Tech Stack

### Backend (API & Microservices)
- **Core Framework:** FastAPI (Python)
- **AI/LLM Integration:** Google Gemini (`gemini_service.py`)
- **Data Persistence:** SQLite (Development) / Abstracted Key-Value Store (`kv_store.py`)
- **Server Gateway:** Uvicorn (ASGI)

### Frontend (Client-side)
- **Architecture:** HTML5, Vanilla JavaScript (ES6+), Native CSS3
- **Geospatial Mapping:** Leaflet.js
- **Data Visualization:** Chart.js (Real-time analytics and financial graphs)
- **Icons:** SVG Path Animation System

---

## ⚙️ Setup & Installation Guide

### Prerequisites
- **Python 3.9+**
- **Node.js** (Optional, for serving the frontend)
- **Google Gemini API Key** (Required for the Strategy Oracle and AI routing features)

### 1. Clone the repository
```bash
git clone https://github.com/adrishkb-sketch/logistix.git
cd logistix
```

### 2. Backend Initialization
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Environment Configuration
Create a `.env` file in the `backend/` directory:
```env
GEMINI_API_KEY=your_google_gemini_key_here
LOGISTIX_ENV=development
```

### 4. Database Seeding (Optional but recommended)
To populate the platform with mock data (drivers, warehouses, shipments):
```bash
# From the root directory
python scratch/seed_fleet.py
```

### 5. Launch the Services
**Start the Backend API:**
```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Serve the Frontend:**
Open a new terminal window in the `frontend` directory:
```bash
cd frontend
npx serve .
# OR using Python
python -m http.server 3000
```

Navigate to `http://localhost:3000/index.html` in your browser.

---

## 🤝 Contribution Guidelines

We welcome contributions to make Logistix even better! 
1. Fork the repository.
2. Create a new feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add some amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

<div align="center">
  <b>Built with ❤️ for the future of intelligent Logistics.</b><br>
  <i>Logistix Systems Inc.</i>
</div>
