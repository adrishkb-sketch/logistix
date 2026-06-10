# 🌌 Logistix: Next-Generation AI-Powered Logistics Platform

<div align="center">
  <img src="frontend/favicon.svg" alt="Logistix Logo" width="120" />
</div>
<br>

**Logistix** is a premium, enterprise-grade logistics and fleet management platform powered by Artificial Intelligence. Designed to bridge the gap between heavy infrastructure logistics and cutting-edge software architecture, Logistix provides real-time visibility, automated decision-making, and seamless coordination across the entire supply chain.

---

## 🚀 Project Overview

Logistix reimagines supply chain management by decentralizing operations into specific roles and portals. Instead of a monolithic dashboard, the platform offers tailored, real-time, high-performance interfaces for Regional Managers, Warehouse Hub Managers, Fleet Drivers, and Customers. 

Built with a stunning **Bioluminescent Glassmorphism Design System**, the platform looks as futuristic as the technology powering it. Behind the scenes, a robust Python FastAPI backend handles massive data routing, while Google's Gemini AI provides predictive analysis and strategic insights.

---

## ✨ Core Features & Ecosystem

The platform is divided into several highly specialized environments:

### 🏢 1. Executive/Regional Manager Portal (`manager.html`)
The command center for regional oversight. 
- **AI Strategy Oracle:** Consults the Gemini AI for network-wide resilience strategies and predictive analytics.
- **Weather Fleet Map:** Real-time geospatial mapping of the entire fleet, overlaying weather disruptions and traffic bottlenecks.
- **Bharat-Fuel Oracle:** AI-driven fuel pricing analysis and consumption tracking to optimize fleet expenditures.
- **Network Resilience:** Simulates failure scenarios (e.g., hub closures, driver strikes) and generates AI-powered recovery plans.

### 🏭 2. Warehouse Hub Manager Portal (`warehouse_manager.html`)
The local control interface for specific warehouse hubs.
- **Gate Check-In & Dock Scheduling:** Manages the influx of inbound and outbound freight.
- **Automated ML Verifications:** Uses Machine Learning to automatically scan and verify driver number plates upon arrival.
- **Daily Fleet & Driver Audit:** Tracks the fitness, readiness, and maintenance logs of assets tied to the local hub.
- **Drone Hub:** Manages autonomous drone dispatch for last-mile delivery.

### 🚚 3. Driver & Fleet App (`driver.html`)
A mobile-first companion app for the operators on the ground.
- **Live Navigation & Tasks:** Step-by-step routing, delivery checklists, and proof-of-delivery (PoD) uploads.
- **Digital Wallet:** Tracks earnings, reimbursements, and milestone bonuses.
- **Smart Chat:** Direct line to the Hub Manager and automated dispatch bots.

### 📦 4. Customer Tracking Portal (`receiver_portal.html` & `track.html`)
The end-user facing tracking experience.
- Real-time GPS plotting of the delivery vehicle.
- Dynamic ETA calculations.

---

## 🧠 AI & Machine Learning Integration

Logistix isn't just a tracking tool; it's an intelligent orchestrator. It deeply integrates **Google Gemini AI** and local ML models to automate complex logistics tasks:

* **Smart Plate Recognition:** Automates gate access by visually verifying truck license plates.
* **Predictive Bottleneck Analysis:** Monitors historical and live flow data to warn managers of impending dock overcrowding.
* **Operational Strategy Generation:** The AI processes raw supply chain data to suggest actionable operational improvements (e.g., "Shift 20% of fleet to Hub B due to incoming storm").
* **Smart Assistant:** Natural language parsing allows managers to "talk" to the database to assign drivers, dispatch vehicles, or query inventory.

---

## 🎨 Premium UI/UX Design System

The frontend architecture abandons bloated CSS frameworks in favor of a bespoke, ultra-optimized **Bioluminescent UI**.

* **Interactive Physics Background:** A responsive 2D canvas grid dynamically reacts to mouse and touch inputs, simulating magnetic force fields.
* **Glassmorphism Components:** Dashboards utilize `backdrop-filter` blurring, translucent borders, and deep shadows (`.modal-glass`, `.glass-card`) for a premium 3D depth effect.
* **Dynamic Wave Typography:** Headings and titles employ a customized character-split script (`.split-text`) that creates a responsive "lifting wave" effect when hovered.
* **Multi-language Support:** On-the-fly translation bridging linguistic gaps for drivers and localized hub managers.

---

## 🛠 Tech Stack

### Backend (API & Services)
- **Framework:** FastAPI (Python)
- **AI/LLM Integration:** Google Gemini (`gemini_service.py`)
- **Data Layer:** SQLite / Key-Value Store (`kv_store.py`)
- **Server:** Uvicorn

### Frontend (Client-side)
- **Core:** HTML5, Vanilla JavaScript, Native CSS3
- **Mapping:** Leaflet.js (Interactive Geospatial Maps)
- **Charting:** Chart.js (Real-time analytics and flow graphs)

---

## 📂 Folder Structure

```text
logistix/
├── backend/
│   ├── main.py                 # FastAPI Application entry point
│   ├── models.py               # Pydantic data models
│   ├── database.py             # Database connection and queries
│   ├── routers/                # API Endpoints (auth, driver, manager, etc.)
│   └── services/               # Core business logic & Gemini AI integration
├── frontend/
│   ├── index.html              # Landing Page
│   ├── css/
│   │   └── premium_theme.css   # Centralized Global Design System
│   ├── js/
│   │   └── premium_theme.js    # Physics & UI Animation Engine
│   └── pages/                  # Specific Portal Dashboards (Manager, Hub, Driver)
└── scratch/                    # Developer scripts and automation tools
```

---

## ⚙️ Setup & Installation

### Prerequisites
- Python 3.9+
- Node.js (Optional, for tooling)
- A Google Gemini API Key (for AI features)

### 1. Clone the repository
```bash
git clone https://github.com/adrishkb-sketch/logistix.git
cd logistix
```

### 2. Backend Setup
```bash
cd backend
pip install -r requirements.txt
```

Set your environment variables in a `.env` file:
```env
GEMINI_API_KEY=your_google_gemini_key_here
```

### 3. Run the Server
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Launch the Frontend
Simply open `frontend/index.html` in any modern web browser or serve it using a local development server:
```bash
# In the frontend directory
npx serve .
# OR
python -m http.server 3000
```

---

<div align="center">
  <b>Built with ❤️ for the future of Logistics.</b>
</div>
