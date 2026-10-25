# INTVL 2.0 // Real-World Territory Conquest Platform

A high-performance, dark-luxury multiplayer territory conquest application built natively for **Cloudflare Pages & D1** using **Next.js (App Router, React 19, TypeScript)**, **MapLibre GL JS**, **Uber H3 (Resolution 9)**, **Turf.js**, and **Strava OAuth 2.0 + Webhooks**.

---

## Architecture & Spatial Engine Overview

1. **Discrete Global Grid (`h3-js`, Resolution 9):**
   - Every hexagonal cell on Earth at H3 Resolution 9 covers approximately **$0.1053\text{ km}^2$** ($\sim 174\text{m}$ edge length).
   - Default map viewport is centered on **Auckland, New Zealand** (`[174.7633, -36.8485]`, zoom `13`).
2. **Loop Detection & Polygon Interior Capture (`src/lib/geo.ts`):**
   - Raw `[lat, lng]` GPS coordinate streams from Strava are sanitized and simplified using the **Ramer-Douglas-Peucker** algorithm (`turf.simplify`).
   - If the start and end coordinates (or any internal loop segment separated by $\ge 220\text{m}$ of path distance) close within **80 meters** (`LOOP_CLOSURE_THRESHOLD_METERS = 80`), the bounded ring is validated via `@turf/turf` (`turf.unkinkPolygon`, `turf.polygon`) and passed to `h3.polygonToCells(coords, 9, true)` to claim the **entire enclosed interior**.
3. **25m Corridor Fallback (`src/lib/geo.ts`):**
   - If no loop is formed, the trajectory is converted to a GeoJSON `LineString`, buffered by **25 meters** (`turf.buffer(line, 25, { units: 'meters' })`), and converted into H3 Resolution 9 cells via `h3.polygonToCells(corridor, 9, true)` combined with continuous `h3.gridPathCells` traversal.
4. **Multiplayer Authentication & Strava Account Linking (`src/lib/auth.ts`, `src/lib/d1.ts`):**
   - Friends register via `/register` with a unique lowercase `username`, password (hashed via Web Crypto PBKDF2-SHA256 `crypto.subtle.deriveBits`), and signature neon player color (`color_hex`).
   - After logging in (`/login`), users connect their personal Strava account via `/api/auth/strava`, binding their `strava_athlete_id`, `access_token`, and `refresh_token` to their `users` record in Cloudflare D1.
   - Incoming Strava webhooks (`POST /api/webhooks/strava`) look up the user where `strava_athlete_id = event.owner_id` and assign captured H3 cells to `user.id`.

---

## Local Development & Deployment

### 1. Install Dependencies
```bash
npm install
# or: pnpm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Update `.env.local` with your Strava API application credentials from [https://www.strava.com/settings/api](https://www.strava.com/settings/api):
```env
NEXT_PUBLIC_APP_URL="http://localhost:3000"
STRAVA_CLIENT_ID="your_strava_client_id"
STRAVA_CLIENT_SECRET="your_strava_client_secret"
STRAVA_VERIFY_TOKEN="INTVL2_WEBHOOK_SECRET_2025"
SESSION_SECRET="replace_with_32_byte_hex_secret_for_cookie_signing"
```

### 3. Initialize Cloudflare D1 Database (Local & Remote)

Create your Cloudflare D1 database:
```bash
npx wrangler d1 create intvl_2_d1
```
Copy the returned `database_id` into `wrangler.toml`.

Execute the clean production schema migration against your **local** D1 instance:
```bash
npx wrangler d1 execute intvl_2_d1 --local --file=./schema.sql
```

Execute the schema migration against your **production (remote)** D1 instance:
```bash
npx wrangler d1 execute intvl_2_d1 --remote --file=./schema.sql
```

### 4. Start the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Build for Production & Cloudflare Pages
```bash
npm run build
npm run pages:build
```

---

## Strava Webhook Registration CLI Commands

### 1. Test Webhook Verification Handshake Locally
```bash
curl -G "http://localhost:3000/api/webhooks/strava" \
  --data-urlencode "hub.mode=subscribe" \
  --data-urlencode "hub.verify_token=INTVL2_WEBHOOK_SECRET_2025" \
  --data-urlencode "hub.challenge=challenge_token_12345"
```

### 2. Register Push Subscription with Strava API v3
```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id="YOUR_STRAVA_CLIENT_ID" \
  -F client_secret="YOUR_STRAVA_CLIENT_SECRET" \
  -F callback_url="https://your-production-domain.pages.dev/api/webhooks/strava" \
  -F verify_token="INTVL2_WEBHOOK_SECRET_2025"
```
