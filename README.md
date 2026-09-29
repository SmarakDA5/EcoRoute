# ER-13 · Fuel-Saving Eco-Route Engine — Dashboard Frontend

A dashboard-style frontend for the **Fuel-Saving Eco-Route Engine** idea (SDG 13).
Visual language: **Teenage Engineering × Nothing** — paper-grey panels, hairline
borders, monospace micro-labels, red accents, dot-matrix textures, LED status lights.

Pure **HTML + CSS + vanilla JS**. No build step, no framework, no npm install.
Every file is short and heavily commented so it stays debuggable for beginners.

---

## ▶ How to run

**Option A (recommended):** serve the folder with any static server, then open
`http://localhost:8000` in your browser:

```bash
cd eco-route-dashboard
python3 -m http.server 8000
```

**Option B:** just double-click `index.html`. Everything works from `file://`
too — the OSRM and Open-Meteo APIs both allow cross-origin requests.

> You need internet for the map tiles, real routing (OSRM) and real elevation
> (Open-Meteo). **Without internet the app degrades gracefully**: it switches
> to clearly-labelled *DEMO DATA* routes so you can still explore the whole UI.

---

## 🗺 What it does

1. **Map panel (SEC.03)** — click the map to set **Start [A]**, **Destination [B]**
   and any number of **Checkpoints [C1…Cn]**. There's also a *Locate me* button.
   Press `ESC` to cancel a placement mode.
2. **CALCULATE** — fetches 2–3 alternative driving routes from the free
   **OSRM demo server**, samples the elevation profile of each route from
   **Open-Meteo**, and scores every candidate with the fuel model.
3. **Route candidates (SEC.04)** — cards ranked by your **priority slider**
   (fuel-saver ←→ fastest). Each card shows distance, time, predicted fuel,
   cost, an eco score, and caveat chips: `HEAVY TRAFFIC`, `STEEP CLIMBS`,
   `STOP-AND-GO`, `+X MIN`, `ECO PICK`, `FASTEST`, `SHORTEST`…
   The **green** line is the best-fuel route, the **red** line the thirstiest.
   Click any card *or map line* to inspect it.
4. **Route analysis (SEC.05)** — full report for the selected route: fuel,
   CO₂, cost, elevation profile sparkline, a *"where the fuel goes"* breakdown
   (baseline vs hills vs stops vs traffic), savings versus the fastest/worst
   candidate, and a plain-language caveats list.
5. **Live re-scoring** — change vehicle, fuel price, currency or priority and
   everything re-computes instantly from cached data (no refetch).
6. **System log (SEC.06)** — every API call and model run is logged on-screen,
   mirrored to the browser console. The full app state is inspectable as
   `window.state`.

---

## 📁 File map (read in this order)

```
eco-route-dashboard/
├── index.html        ← page structure (all panels & IDs)
├── css/style.css     ← the whole TE/Nothing look; edit :root vars to re-skin
└── js/
    ├── config.js     ← ALL settings: API urls, defaults, vehicles, model
    │                   coefficients, colors. Start here when tweaking.
    ├── api.js        ← OSRM + Open-Meteo fetchers, elevation sampling,
    │                   offline demo-route generator
    ├── fuel-model.js ← the fuel predictor (transparent stand-in for XGBoost),
    │                   eco score, ranking & tagging logic
    └── app.js        ← UI glue: map, buttons, rendering, state
```

Data flow: `app.js → api.js (routes + elevation) → fuel-model.js (score/rank) → app.js (render)`.

---

## 🧠 The fuel model (and how to replace it with real ML)

`fuel-model.js` ships a **readable linear model** with the same four features
from the project brief (`distance`, `speed`, `elevation change`, `stops/km`,
plus a congestion fraction):

```
fuel_L = km · (L_per_100 / 100) · (1 + 0.35·hills + 0.25·stops + 0.30·traffic)
```

When you've trained your `XGBRegressor` and wrapped it in FastAPI, replace the
body of `predictFuel()` with a POST to your endpoint (sketch is in the comment
at the top of `fuel-model.js`):

```js
const res = await fetch("https://your-api/predict", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    distance_km: route.distanceKm,
    speed_kmh: route.fuel.speedKmh,
    elevation_change_m: route.elevation.gainM,
    stops_per_km: route.fuel.stopsPerKm,
  }),
});
route.fuel.fuelLiters = (await res.json()).fuel_liters;
```

Nothing else in the app needs to change.

---

## 🐞 Debugging tips

- **Open the SYSTEM LOG panel** (bottom right) first — it tells you which API
  step failed and why. The same lines appear in the browser console (F12).
- Type `state` in the console to see start/end/checkpoints/routes live.
- OSRM returns **1 route only** on some corridors — that's normal; `alternatives=true`
  returns up to 3 when genuinely different paths exist.
- OSRM rejects points in water / outside the road network — pick points near roads.
- The demo server is rate-limited; if you get errors, wait a few seconds and retry.
- Elevation falls back to a *simulated* profile if Open-Meteo fails (the
  `ELEVATION PROFILE` panel shows the source tag: `OPEN-METEO` vs `SIMULATED`).

## ⚠️ Honest caveats

- OSRM demo server ≠ live traffic. Congestion here is **estimated from segment
  speeds** in the routing data, not real-time feeds.
- Fuel numbers are model estimates for a concept demo, not measurements.
- For production: host your own OSRM instance, use a traffic API
  (e.g. TomTom/HERE free tiers), and serve the trained XGBoost model via FastAPI.

## 📄 Data & attribution

- Routing: [OSRM](http://project-osrm.org/) over [OpenStreetMap](https://www.openstreetmap.org/copyright) data
- Map tiles: [CARTO](https://carto.com/attributions) basemap
- Elevation: [Open-Meteo](https://open-meteo.com/) (free, no key)
- Map library: [Leaflet](https://leafletjs.com/)
