# My Lawn Monitor

Two-container scaffold for a lawn monitoring application. The project splits into:

- `frontend/`: React + Vite web client.
- `backend/`: Express REST API with MongoDB persistence.

## Requirements

- Node.js 20+
- Docker & Docker Compose (for containerized workflow)

## Local Development

Each workspace ships with its own Node toolchain. Install dependencies and run scripts inside the respective directories:

### Running with Node

- **Backend**  
  ```bash
  cd backend
  npm install
  APP_ENV=development npm run dev   # or staging / production
  ```
  The server loads `backend/.env.<env>` and `backend/.env.<env>.local` automatically.

- **Frontend (Vite)**  
  ```bash
  cd frontend
  npm install
  npm run dev -- --mode development   # swap to staging / production as needed
  ```
  Vite pulls vars from `frontend/.env.<mode>` and `.env.<mode>.local`.

### Environment configuration

Each workspace supports dedicated environment files:

- Backend: copy `backend/.env.example` to `backend/.env.development` for local Node usage, then duplicate it as `backend/.env.staging` or `backend/.env.production` when preparing remote deployments. The server auto-loads the file that matches `APP_ENV`/`NODE_ENV`.
- Frontend: copy the desired template (`frontend/.env.staging.example`, `frontend/.env.production.example`) to `.env.<env>` and adjust `VITE_API_BASE_URL` plus `VITE_DEV_API_PROXY`.
- Docker Compose: the root `.env` file now only controls stack-level toggles such as `APP_ENV` and host port overrides (e.g. `BACKEND_PORT`, `FRONTEND_PORT`). Copy `.env.example` if you need to change those values, but service-specific configuration should live in `backend/.env.<env>` and `frontend/.env.<env>`. Compose automatically loads the matching files via `APP_ENV` and also pipes `BACKEND_PORT` into the backend container as `PORT`, keeping the host and container ports in sync.

### Optional Guard Relay

Configure the backend to relay guard state changes to an external service:

- `GUARD_RELAY_ENABLED` — set to `true` to enable the relay.
- `GUARD_RELAY_ENDPOINT` — URL to receive guard state updates.
- `GUARD_RELAY_ID` — identifier included in the relay payload.

When enabled, each heartbeat triggers a `GET` request to the endpoint with query parameters:

```
http://your-endpoint?accessoryId=<ID>&state=<STATE>
```

`state` is the negation of the guard state (e.g. guard `true` → `state=false`).

## Container Workflow

1. (Optional) Copy `.env.example` to `.env` when you need to override `APP_ENV`, `BACKEND_PORT`, or `FRONTEND_PORT` for the stack. Any value you assign to `BACKEND_PORT` is used for both the host mapping and the backend process because Compose forwards it as `PORT` inside the container.
2. Ensure the desired workspace configuration exists (e.g. `backend/.env.production`, `frontend/.env.production`). Compose will load `backend/.env.<APP_ENV>` and `frontend/.env.<APP_ENV>` automatically—set `APP_ENV=<env>` (via the shell or root `.env`) to switch environments.
3. Build and run the stack:

   ```bash
   # Local development with bundled MongoDB
   docker compose up --build
   # If you created a root .env file for overrides:
   # docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml up --build

   # Staging/production without the local MongoDB container
   docker compose up --build -d
   # ...or specify a different env file:
   # docker compose --env-file .env.staging up --build -d
   ```

Services exposed from the standard configuration:

- Frontend: http://localhost:${FRONTEND_PORT:-8080}
- Backend API: http://localhost:${BACKEND_PORT:-4000}/api
- MongoDB (local profile only): `localhost:${MONGO_PORT:-27017}`

The frontend build embeds `VITE_API_BASE_URL` (default `/api`) so the Nginx container proxies requests to the backend service. Override this value in `frontend/.env.<env>` when pointing at a remote API.

### Quick reference

- Backend: `APP_ENV=<env> npm run dev` (loads `backend/.env.<env>`). When running under Docker, set `BACKEND_PORT` in the root `.env` or shell to change both the container and host port simultaneously.
- Frontend: `npm run dev -- --mode <env>` (loads `frontend/.env.<env>`).
- Compose local stack: `docker compose -f docker-compose.yml -f docker-compose.local.yml up --build` (add `--env-file .env` if you created one).
- Compose staging/production: `docker compose up --build -d` (add `--env-file .env.staging` when using a root env file; omit `docker-compose.local.yml` when MongoDB is managed elsewhere).

## Backend API Snapshot

- `POST /api/heartbeats` → accepts device heartbeat payloads from the IoT board.
- `GET /api/heartbeats?start=&end=&limit=` → returns historical heartbeats (filters optional).
- `GET /api/status` → returns the latest heartbeat plus summary metadata (guard state, device status, counts, recent change timestamps).
- `GET /api/weather/forecast?start=&end=` → serves cached weather forecast data and precipitation history for the configured gridpoint. Data refreshes hourly.

Heartbeats older than 90 days are automatically purged via a MongoDB TTL index on the `timestamp` field.

Heartbeat payloads are validated with a Zod schema; requests failing validation return HTTP 400 with field-level errors.

Sample heartbeat payload:

```json
{
  "guard": true,
  "sensors": {
    "waterPsi": 45.2,
    "rain": false,
    "soil": true
  },
  "device": {
    "ip": "192.168.1.42",
    "tempF": 75.4,
    "humidity": 48,
    "baselinePsi": 52,
    "connectedSensors": ["PRESSURE", "RAIN", "SOIL"]
  },
  "timestamp": "2024-05-01T12:34:56.000Z"
}
```

## Project Structure

```
backend/
  src/
    app.ts
    index.ts
    config/
    controllers/
    models/
    routes/
frontend/
  src/
    App.tsx
    main.tsx
docker-compose.yml
```

Extend the scaffold by adding domain-specific routes, database schemas, and UI components as you evolve the monitoring solution.
