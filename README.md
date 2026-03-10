<p align="center">
  <img src="screenshots/banner.png" alt="Irrigo" width="400" />
</p>

<h3 align="center">Smart Irrigation Guard System</h3>

<p align="center">
  An IoT-powered lawn monitoring solution that automatically protects your irrigation system<br/>
  by reading water pressure, rain, and soil sensors in real time.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Arduino-UNO_R4_WiFi-00979D?logo=arduino&logoColor=white" alt="Arduino" />
  <img src="https://img.shields.io/badge/Express-TypeScript-3178C6?logo=typescript&logoColor=white" alt="Express + TS" />
  <img src="https://img.shields.io/badge/React-Vite-646CFF?logo=vite&logoColor=white" alt="React + Vite" />
  <img src="https://img.shields.io/badge/MongoDB-7.0-47A248?logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" alt="Docker" />
</p>

---

## Overview

**Irrigo** is a full-stack smart irrigation guard that monitors water pressure, rain, and soil moisture through physical sensors connected to an Arduino UNO R4 WiFi. When conditions indicate the lawn doesn't need watering — low pressure in the line, active rain, or saturated soil — a relay automatically signals the irrigation controller to skip the watering cycle.

All sensor data flows to a cloud backend where it's stored in MongoDB, enriched with local weather forecasts, and pushed in real time to a mobile-first React dashboard via WebSocket.

---

## Dashboard

<p align="center">
  <img src="screenshots/dashboard-main.png" alt="Dashboard — Main view" width="230" />
  &nbsp;&nbsp;
  <img src="screenshots/dashboard-history.png" alt="Dashboard — History and analytics" width="230" />
  &nbsp;&nbsp;
  <img src="screenshots/dashboard-records.png" alt="Dashboard — Heartbeat records" width="230" />
</p>

<p align="center">
  <sub>Main status view &nbsp;·&nbsp; Pressure history &amp; guard analytics &nbsp;·&nbsp; Heartbeat records</sub>
</p>

---

## Hardware

<p align="center">
  <img src="screenshots/hardware-enclosure-closed.jpeg" alt="Enclosure — closed" width="360" />
  &nbsp;&nbsp;&nbsp;
  <img src="screenshots/hardware-enclosure-open.jpeg" alt="Enclosure — open" width="360" />
</p>

<p align="center">
  <sub>Weatherproof enclosure (closed) &nbsp;·&nbsp; Internal components (open)</sub>
</p>

The IoT device is built around an **Arduino UNO R4 WiFi** housed in a weatherproof enclosure with:

| Component | Role |
|-----------|------|
| **Pressure transducer** (analog, 0–100 PSI) | Detects irrigation line pressure |
| **Rain sensor** (digital) | Detects active rainfall |
| **Soil moisture sensor** (digital) | Detects ground saturation |
| **5 V relay module** | Cuts power to the irrigation controller |
| **Modulino Pixels** | 8-LED bar showing live PSI level |
| **Modulino Knob** | Adjusts pressure baseline threshold |
| **Modulino Thermo** | Reads ambient temperature & humidity |
| **Modulino Buttons** | Force sample, toggle rain/soil sensors |
| **LED Matrix** (12 × 8) | Displays PSI value and sensor indicators |

---

## Architecture

```mermaid
graph TB
  subgraph iot["🔌 IoT Device — Arduino UNO R4 WiFi"]
    direction TB
    sensors["🔧 Sensors<br/><i>Pressure · Rain · Soil</i>"]
    modulinos["📟 Modulino Peripherals<br/><i>Pixels · Knob · Thermo · Buttons</i>"]
    relay["⚡ Relay Module<br/><i>Controls irrigation power</i>"]
    matrix["💡 LED Matrix<br/><i>Live PSI display</i>"]
  end

  subgraph server["🖥️ Backend Server — Express + TypeScript"]
    direction TB
    api["🌐 REST API<br/><i>Heartbeats · Status · Config</i>"]
    ws["📡 WebSocket Server<br/><i>Real-time event broadcast</i>"]
    db[("🗄️ MongoDB<br/><i>Heartbeats · Config<br/>Weather · Irrigation</i>")]
    weather["🌦️ Weather Service<br/><i>NWS Forecast API</i>"]
    guardRelay["🏠 Guard Relay<br/><i>HomeKit integration</i>"]
  end

  subgraph client["📱 Web Dashboard — React + Vite"]
    direction TB
    ui["🎨 Mobile-First UI<br/><i>Status · Charts · History</i>"]
    wsClient["📡 WebSocket Client<br/><i>Live updates</i>"]
    charts["📊 Recharts<br/><i>Pressure trends · Analytics</i>"]
  end

  subgraph external["☁️ External Services"]
    nws["🌤️ NWS Weather API"]
    homekit["🏠 HomeKit Relay"]
  end

  iot -- "HTTP POST /api/heartbeats<br/><i>Sensor readings every 60s</i>" --> server
  iot -- "GET /api/device/config<br/><i>Poll every 30s</i>" --> server
  server -- "WebSocket events<br/><i>heartbeat:new · status:updated</i>" --> client
  client -- "REST API calls<br/><i>History · Config · Weather</i>" --> server
  api --- db
  weather -- "Hourly refresh" --> nws
  guardRelay -- "State relay" --> homekit

  style iot fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20
  style server fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1
  style client fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:#bf360c
  style external fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px,color:#4a148c
```

---

## Real-Time Synchronization

```mermaid
sequenceDiagram
  participant A as 🔌 Arduino
  participant S as 🖥️ Server
  participant DB as 🗄️ MongoDB
  participant WS as 📡 WebSocket
  participant D as 📱 Dashboard

  Note over A,D: Periodic Heartbeat Flow
  A->>A: Sample sensors (every 60s)
  A->>S: POST /api/heartbeats
  S->>S: Validate payload (Zod)
  S->>DB: Store heartbeat
  S->>DB: Update status snapshot
  S->>WS: Broadcast heartbeat:new
  WS-->>D: heartbeat:new event
  D->>D: Update UI in real time

  Note over A,D: Force Refresh Flow
  D->>S: PUT /api/device/config {forceHeartbeat: true}
  S->>DB: Update config
  S->>WS: Broadcast deviceConfig:updated
  A->>S: GET /api/device/config (poll)
  S-->>A: Config with forceHeartbeat: true
  A->>A: Trigger immediate sample
  A->>S: POST /api/heartbeats
  S->>DB: Store heartbeat
  S->>WS: Broadcast heartbeat:new
  WS-->>D: heartbeat:new event
  D->>D: Refresh complete

  Note over A,D: Remote Config Update
  D->>S: PUT /api/device/config {baselinePsi, intervals…}
  S->>DB: Store updated config
  S->>WS: Broadcast deviceConfig:updated
  WS-->>D: Confirm config saved
  A->>S: GET /api/device/config (next poll)
  S-->>A: Updated config
  A->>A: Apply new settings
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **IoT** | Arduino UNO R4 WiFi · C++ · Modulino peripherals |
| **Backend** | Node.js · Express · TypeScript · Zod validation |
| **Database** | MongoDB 7.0 · Mongoose ODM · TTL indexes |
| **Real-time** | WebSocket (`ws`) · Event-driven broadcast |
| **Frontend** | React 18 · Vite · TypeScript · Recharts |
| **Weather** | NWS Forecast API · Hourly auto-refresh |
| **Infrastructure** | Docker Compose · Nginx reverse proxy |
| **Smart Home** | Optional HomeKit guard relay integration |

---

## Project Structure

```
irrigo/
├── iot/
│   └── sensor_program.cpp        # Arduino firmware (C++)
├── backend/
│   └── src/
│       ├── index.ts               # Server entry point
│       ├── app.ts                 # Express app configuration
│       ├── config/                # Database, weather, persistence config
│       ├── controllers/           # Route handlers
│       ├── models/                # Mongoose schemas
│       ├── routes/                # API route definitions
│       ├── schemas/               # Zod validation schemas
│       └── services/              # Realtime, weather, guard relay, analytics
├── frontend/
│   └── src/
│       ├── App.tsx                # Main application
│       ├── api.ts                 # API client
│       ├── types.ts               # TypeScript definitions
│       ├── hooks/                 # useRealtimeChannel (WebSocket)
│       ├── components/            # UI widgets and sections
│       └── assets/                # SVG icons and illustrations
├── screenshots/                   # App screenshots and hardware photos
├── docker-compose.yml             # Multi-container orchestration
└── README.md
```

---

## Getting Started

### Requirements

- **Node.js** 20+
- **Docker** & Docker Compose (for containerized workflow)
- **Arduino IDE** (for firmware development)

### Environment Configuration

Each workspace uses dedicated environment files:

- **Backend** — copy `backend/.env.example` → `backend/.env.development` and configure `MONGO_URI`, weather gridpoint, and optional guard relay settings.
- **Frontend** — copy the desired template (`frontend/.env.staging.example`, etc.) to `.env.<env>` and set `VITE_API_BASE_URL`.
- **Docker Compose** — the root `.env` controls stack-level toggles (`APP_ENV`, `BACKEND_PORT`, `FRONTEND_PORT`).

### Running with Docker (recommended)

```bash
# Development with bundled MongoDB
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# Production
docker compose up --build -d
```

| Service | URL |
|---------|-----|
| Frontend | `http://localhost:${FRONTEND_PORT:-8080}` |
| Backend API | `http://localhost:${BACKEND_PORT:-4000}/api` |
| MongoDB | `localhost:${MONGO_PORT:-27017}` (local profile only) |

### Running with Node

```bash
# Backend
cd backend && npm install
APP_ENV=development npm run dev

# Frontend
cd frontend && npm install
npm run dev -- --mode development
```

### Optional: Guard Relay

Enable the backend to relay guard state changes to a HomeKit-compatible switch:

| Variable | Description |
|----------|-------------|
| `GUARD_RELAY_ENABLED` | Set to `true` to enable |
| `GUARD_RELAY_ENDPOINT` | URL to receive state updates |
| `GUARD_RELAY_ID` | Identifier included in the payload |

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/heartbeats` | Accept device heartbeat payload |
| `GET` | `/api/heartbeats` | Paginated heartbeat history |
| `GET` | `/api/heartbeats/series` | Lightweight PSI time-series |
| `GET` | `/api/heartbeats/overview` | Aggregate guard/sensor statistics |
| `GET` | `/api/status` | Latest heartbeat + summary metadata |
| `GET` | `/api/weather/forecast` | Cached weather forecast + precipitation |
| `GET` | `/api/device/config/:ip` | Device config by IP (Arduino) |
| `PUT` | `/api/device/config/:ip` | Arduino pushes its config |
| `GET` | `/api/device/config` | Fetch latest device config (Dashboard) |
| `PUT` | `/api/device/config` | Update device config (Dashboard) |
| `GET` | `/api/irrigation` | Paginated irrigation events |
| `WS` | `/ws` | Real-time event stream |

Heartbeats older than **90 days** are automatically purged via a MongoDB TTL index.

---

<p align="center">
  <sub>Built with 💧 by Manuel & Claude</sub>
</p>
