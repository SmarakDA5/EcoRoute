/* =========================================================
   FUEL-MODEL.JS  —  the "ML" brain of the dashboard

   In production you would POST each route's features to your
   FastAPI endpoint running the trained XGBRegressor, e.g.:

     const res = await fetch("https://your-api/predict", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({
         distance_km, speed_kmh, elevation_change_m, stops_per_km
       })
     });
     fuelLiters = (await res.json()).fuel_liters;

   To keep this frontend dependency-free (and debuggable), we
   ship a TRANSPARENT linear model with the same 4 features.
   Every coefficient is explained inline. Swap in the real
   model later — nothing else in the app needs to change.
   ========================================================= */

/* Predict fuel (liters) for one raw route + vehicle + settings. */
function predictFuel(route, vehicle) {
  const M = CONFIG.MODEL;

  // Feature 1: distance (km) — the dominant term.
  const km = route.distanceKm;

  // Feature 2: average speed (km/h).
  const speed = km / (route.durationMin / 60);

  // Feature 3: elevation gain per km (m/km) — how hilly it is.
  const climbPerKm = km > 0 ? route.elevation.gainM / km : 0;

  // Feature 4: stops per km (OSRM steps ≈ intersections/maneuvers).
  const stopsPerKm = km > 0 ? route.steps / km : 0;

  // Feature 5 (bonus): fraction of the route driven in congestion.
  const congestion = km > 0 ? Math.min(route.slowKm / km, 1) : 0;

  // --- Penalties: each is a fraction added to baseline burn ---
  // Hills: 40 m climb per km => +35% fuel (capped at 2x cap).
  const elevPenalty = M.ELEV_WEIGHT *
    Math.min(climbPerKm / M.HILLY_M_PER_KM, 2);

  // Stop-and-go: 6 stops per km => +25% fuel (capped).
  const stopPenalty = M.STOP_WEIGHT *
    Math.min(stopsPerKm / M.HEAVY_STOPS_PER_KM, 1.5);

  // Congestion: 100% of km below 25 km/h => +30% fuel.
  const trafficPenalty = M.TRAFFIC_WEIGHT * congestion;

  // Baseline liters for this distance at the vehicle's rated economy.
  const baseline = km * (vehicle.lPer100 / 100);

  const fuelLiters = baseline * (1 + elevPenalty + stopPenalty + trafficPenalty);

  // CO2: diesel emits more per liter than petrol.
  const co2PerLiter = vehicle.fuel === "diesel" ? M.CO2_DIESEL : M.CO2_PETROL;

  return {
    fuelLiters,
    co2Kg: fuelLiters * co2PerLiter,
    lPerKm: km > 0 ? fuelLiters / km : 0,
    speedKmh: speed,
    climbPerKm,
    stopsPerKm,
    congestion,
    // Breakdown so the UI (and you!) can see WHERE fuel is lost.
    penalties: { elevPenalty, stopPenalty, trafficPenalty },
  };
}

/* Eco score 0-100 from fuel intensity (liters per km).
   Simple linear mapping between "excellent" and "terrible". */
function ecoScore(lPerKm) {
  const M = CONFIG.MODEL;
  const t = (lPerKm - M.SCORE_BEST_L_PER_KM) /
            (M.SCORE_WORST_L_PER_KM - M.SCORE_BEST_L_PER_KM);
  return Math.max(5, Math.min(99, Math.round(100 * (1 - t))));
}

/* =========================================================
   Rank + tag the routes.
   priority = 0..1  (0 = care only about fuel, 1 = only time)
   Returns routes sorted best-first, each enriched with:
     rank, tags[], score, color
   ========================================================= */
function rankRoutes(routes, priority) {
  // Normalise fuel and time across the candidate set.
  const fuels = routes.map(r => r.fuel.fuelLiters);
  const times = routes.map(r => r.durationMin);
  const minF = Math.min(...fuels), maxF = Math.max(...fuels);
  const minT = Math.min(...times), maxT = Math.max(...times);

  for (const r of routes) {
    const fuelNorm = maxF > minF ? (r.fuel.fuelLiters - minF) / (maxF - minF) : 0;
    const timeNorm = maxT > minT ? (r.durationMin - minT) / (maxT - minT) : 0;
    // Lower score = better. priority slides between fuel and time.
    r.score = (1 - priority) * fuelNorm + priority * timeNorm;
  }

  routes.sort((a, b) => a.score - b.score);
  routes.forEach((r, i) => { r.rank = i; });

  // --- Descriptive tags (shown as chips on the cards) ---
  const minDist = Math.min(...routes.map(r => r.distanceKm));
  for (const r of routes) {
    r.tags = [];
    if (r.fuel.fuelLiters === minF) r.tags.push({ text: "ECO PICK", kind: "good" });
    if (r.durationMin === minT)     r.tags.push({ text: "FASTEST", kind: "good" });
    if (r.distanceKm === minDist)   r.tags.push({ text: "SHORTEST", kind: "good" });

    if (r.fuel.congestion > 0.25)      r.tags.push({ text: "HEAVY TRAFFIC", kind: "bad" });
    else if (r.fuel.congestion > 0.12) r.tags.push({ text: "MODERATE TRAFFIC", kind: "warn" });

    if (r.fuel.climbPerKm > 25) r.tags.push({ text: "STEEP CLIMBS", kind: "warn" });
    if (r.fuel.stopsPerKm > 4)  r.tags.push({ text: "STOP-AND-GO", kind: "warn" });

    if (routes.length > 1) {
      if (r.durationMin > minT * 1.15) {
        r.tags.push({ text: "+" + Math.round(r.durationMin - minT) + " MIN", kind: "bad" });
      }
      if (r.distanceKm > minDist * 1.10) {
        r.tags.push({ text: "+" + (r.distanceKm - minDist).toFixed(1) + " KM", kind: "bad" });
      }
      if (r.tags.length === 0) r.tags.push({ text: "BALANCED", kind: "good" });
    }
  }

  // --- Map line colors: green best, red worst, ink in between ---
  routes.forEach((r, i) => {
    if (routes.length === 1) r.color = CONFIG.COLORS.best;
    else if (i === 0) r.color = CONFIG.COLORS.best;
    else if (i === routes.length - 1) r.color = CONFIG.COLORS.worst;
    else r.color = CONFIG.COLORS.mid;
  });

  return routes;
}
