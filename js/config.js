/* =========================================================
   CONFIG.JS  —  all the settings live here
   Change defaults (city, fuel price, vehicles, colors)
   without touching any other file.
   ========================================================= */

const CONFIG = {

  /* ---------- Product identity ---------- */
  PRODUCT_CODE: "ER-13",              // ER-13 = Eco-Route, SDG 13 (Climate Action)
  PRODUCT_NAME: "FUEL-SAVING ECO-ROUTE ENGINE",

  /* ---------- Free public APIs (no keys needed) ---------- */
  // OSRM demo server: returns 1-3 alternative driving routes.
  OSRM_URL: "https://router.project-osrm.org/route/v1/driving/",
  // Open-Meteo elevation: free, reliable, CORS-friendly.
  // (The classic "Open-Elevation API" is very flaky, so we use this instead.
  //  Swap ELEVATION_URL below if you prefer open-elevation.com.)
  ELEVATION_URL: "https://api.open-meteo.com/v1/elevation",

  // Max points sent per elevation request (Open-Meteo limit is 100).
  ELEVATION_SAMPLES: 80,
  // Request timeouts in milliseconds.
  OSRM_TIMEOUT_MS: 12000,
  ELEVATION_TIMEOUT_MS: 8000,

  /* ---------- Map defaults (Kolkata, from the project brief) ---------- */
  // Default corridor = Airport → Esplanade: chosen because OSRM reliably
  // returns 2 distinct alternatives for it, showing off the comparison UI.
  DEFAULT_CENTER: [22.6100, 88.4000],  // [lat, lon] for Leaflet
  DEFAULT_ZOOM: 12,
  DEFAULT_START: [22.6548, 88.4467],   // [lat, lon] — Netaji Airport area
  DEFAULT_END:   [22.5626, 88.3511],   // [lat, lon] — Esplanade area

  // Minimal black & white map tiles (matches the Nothing/TE aesthetic).
  // Attribution is required and is shown by Leaflet automatically.
  TILE_URL: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  TILE_ATTRIBUTION:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a> · ' +
    'Routing: <a href="http://project-osrm.org/">OSRM</a> · Elevation: Open-Meteo',

  /* ---------- Vehicle presets: baseline liters per 100 km ----------
     (flat road, free-flow traffic — the model adds penalties on top)  */
  VEHICLES: [
    { id: "hatchback", label: "PETROL HATCHBACK", lPer100: 7.0, fuel: "petrol" },
    { id: "sedan",     label: "PETROL SEDAN",     lPer100: 8.2, fuel: "petrol" },
    { id: "suv",       label: "SUV / MUV",        lPer100: 11.5, fuel: "petrol" },
    { id: "diesel",    label: "DIESEL CAR",       lPer100: 6.5, fuel: "diesel" },
    { id: "hybrid",    label: "HYBRID",           lPer100: 4.8, fuel: "petrol" },
    { id: "bike",      label: "MOTORBIKE",        lPer100: 2.6, fuel: "petrol" },
  ],

  /* ---------- Fuel model constants ----------
     These simple, readable coefficients imitate what a trained
     XGBoost regressor would output. See fuel-model.js for the formula.
     Replace with a call to your FastAPI /predict endpoint later.      */
  MODEL: {
    // kg of CO2 per liter burned.
    CO2_PETROL: 2.31,
    CO2_DIESEL: 2.68,
    // Penalty weights (fraction added to baseline consumption).
    ELEV_WEIGHT: 0.35,    // climbing hills
    STOP_WEIGHT: 0.25,    // intersections / stop-and-go
    TRAFFIC_WEIGHT: 0.30, // congested (slow) segments
    // Normalisation references used by the penalties:
    HILLY_M_PER_KM: 40,   // 40 m of climb per km counts as "very hilly"
    HEAVY_STOPS_PER_KM: 6,// 6 stops per km counts as "very stop-and-go"
    // Speed (km/h) below which a road segment counts as congested.
    CONGESTION_SPEED: 25,
    // Eco score mapping: liters-per-km considered "excellent" vs "terrible".
    SCORE_BEST_L_PER_KM: 0.030,
    SCORE_WORST_L_PER_KM: 0.150,
  },

  /* ---------- Route line colors on the map ---------- */
  COLORS: {
    best:  "#00A651",  // green  = lowest predicted fuel
    mid:   "#26261F",  // ink    = normal alternative
    worst: "#E8230E",  // red    = highest predicted fuel
    casing: "#FFFFFF", // white outline so lines stay readable
  },

  /* ---------- Currency options ---------- */
  CURRENCIES: [
    { symbol: "₹", label: "INR ₹", perLiterDefault: 105 },
    { symbol: "$", label: "USD $", perLiterDefault: 3.6 },
    { symbol: "€", label: "EUR €", perLiterDefault: 1.7 },
    { symbol: "£", label: "GBP £", perLiterDefault: 1.5 },
  ],
};
