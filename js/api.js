/* =========================================================
   API.JS  —  talks to the outside world
   1. fetchRoutes()      -> alternative routes from OSRM
   2. fetchElevation()   -> elevation profile from Open-Meteo
   3. makeDemoRoutes()   -> offline fallback so the dashboard
                            still works without internet
   Every function logs what it does into the SYSTEM LOG panel.
   ========================================================= */

/* --- Small helper: fetch with a timeout (so a dead API can't
       hang the dashboard forever) --- */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* --- Haversine distance between two [lat, lon] points, in km --- */
function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLon = (b[1] - a[1]) * Math.PI / 180;
  const lat1 = a[0] * Math.PI / 180;
  const lat2 = b[0] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* =========================================================
   1. ROUTES FROM OSRM
   points = array of [lat, lon]: [start, ...checkpoints, end]
   Returns an array of "raw route" objects:
     { geometry: [[lat,lon],...], distanceKm, durationMin,
       steps, slowKm, demo:false }
   ========================================================= */
async function fetchRoutes(points) {
  // OSRM wants "lon,lat;lon,lat;..." (note: longitude FIRST).
  const coordStr = points
    .map(p => p[1].toFixed(6) + "," + p[0].toFixed(6))
    .join(";");

  const url = CONFIG.OSRM_URL + coordStr +
    "?alternatives=true" +        // ask for 2-3 candidate paths
    "&overview=full" +            // full geometry for drawing
    "&geometries=geojson" +       // coordinates as [lon, lat]
    "&steps=true" +               // turn-by-turn steps (≈ intersections)
    "&annotations=duration,distance"; // per-segment speed data

  log("OSRM  · requesting " + points.length + " waypoints…");
  const data = await fetchWithTimeout(url, CONFIG.OSRM_TIMEOUT_MS);

  if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
    throw new Error("OSRM said: " + (data.code || "no routes") +
      " — points may be unreachable by car (water? closed area?)");
  }
  log("OSRM  · OK, received " + data.routes.length + " candidate route(s)");

  return data.routes.map(r => {
    // geometry is [lon, lat] — flip to [lat, lon] for Leaflet.
    const geometry = r.geometry.coordinates.map(c => [c[1], c[0]]);

    // Count intersections (each OSRM "step" ≈ one maneuver) and
    // how many km are driven below the congestion speed.
    let steps = 0, slowKm = 0;
    for (const leg of r.legs) {
      steps += leg.steps ? leg.steps.length : 0;
      const ann = leg.annotation;
      if (ann && ann.distance && ann.duration) {
        for (let i = 0; i < ann.distance.length; i++) {
          const segKm = ann.distance[i] / 1000;
          const segHours = ann.duration[i] / 3600;
          const speed = segHours > 0 ? segKm / segHours : 0; // km/h
          if (speed < CONFIG.MODEL.CONGESTION_SPEED) slowKm += segKm;
        }
      }
    }

    return {
      geometry,
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      steps,
      slowKm,
      demo: false,
    };
  });
}

/* =========================================================
   2. ELEVATION FROM OPEN-METEO
   geometry = [[lat,lon],...] — we sample up to N points along
   it (one API call per route) and return:
     { profile: [meters...], gainM: total uphill climb }
   If the API fails we fake a plausible profile so the UI
   never breaks (and mark it as simulated).
   ========================================================= */
async function fetchElevation(geometry, routeIndex) {
  // Pick evenly spaced sample points (always include the ends).
  const n = Math.min(CONFIG.ELEVATION_SAMPLES, geometry.length);
  const samples = [];
  for (let i = 0; i < n; i++) {
    samples.push(geometry[Math.round(i * (geometry.length - 1) / (n - 1))]);
  }

  const lons = samples.map(p => p[1].toFixed(5)).join(",");
  const lats = samples.map(p => p[0].toFixed(5)).join(",");
  const url = CONFIG.ELEVATION_URL + "?longitude=" + lons + "&latitude=" + lats;

  try {
    log("ELEV  · sampling " + n + " pts for route " + (routeIndex + 1) + "…");
    const data = await fetchWithTimeout(url, CONFIG.ELEVATION_TIMEOUT_MS);
    if (!data.elevation) throw new Error("bad response");

    // Elevation GAIN = sum of all uphill steps (downhill is ~free fuel-wise
    // for this model, coasting recovers little).
    let gainM = 0;
    for (let i = 1; i < data.elevation.length; i++) {
      const diff = data.elevation[i] - data.elevation[i - 1];
      if (diff > 0.5) gainM += diff; // ignore GPS-noise blips under 0.5 m
    }
    return { profile: data.elevation, gainM, source: "OPEN-METEO" };
  } catch (err) {
    log("ELEV  · failed (" + err.message + ") → simulating profile", "warn");
    return simulateElevation(geometry, routeIndex);
  }
}

/* Fake-but-deterministic elevation profile (offline fallback). */
function simulateElevation(geometry, routeIndex) {
  const n = 40;
  const seed = Math.abs(Math.round(geometry[0][0] * 1000)) + routeIndex * 77;
  const rand = mulberry32(seed);
  const base = 5 + rand() * 60;
  const profile = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    profile.push(Math.round(
      base + 30 * Math.sin(t * Math.PI * (1 + routeIndex)) + rand() * 8
    ));
  }
  let gainM = 0;
  for (let i = 1; i < n; i++) {
    const diff = profile[i] - profile[i - 1];
    if (diff > 0) gainM += diff;
  }
  return { profile, gainM, source: "SIMULATED" };
}

/* Tiny seeded random generator (same seed → same "random" numbers,
   so demo data doesn't jump around between renders). */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =========================================================
   3. OFFLINE DEMO ROUTES
   Used when OSRM can't be reached (e.g. no internet).
   Draws curved fake paths between the waypoints so the whole
   dashboard remains explorable. Clearly labelled DEMO DATA.
   ========================================================= */
function makeDemoRoutes(points) {
  log("DEMO  · OSRM unreachable → generating simulated routes", "warn");
  const start = points[0];
  const end = points[points.length - 1];

  // 3 variants: different curvature + assumed traffic behavior.
  const variants = [
    { bow: 0.10, speed: 42, stopFactor: 2.5 }, // longer, faster roads
    { bow: -0.05, speed: 30, stopFactor: 4.0 }, // direct, city traffic
    { bow: 0.22, speed: 35, stopFactor: 1.5 }, // big detour, smooth
  ];

  return variants.map((v, idx) => {
    const rand = mulberry32(
      Math.round(start[0] * 100) * 31 + Math.round(end[0] * 100) + idx * 991
    );
    // Quadratic bezier from start to end, control point offset sideways.
    const midLat = (start[0] + end[0]) / 2 + (end[1] - start[1]) * v.bow;
    const midLon = (start[1] + end[1]) / 2 - (end[0] - start[0]) * v.bow;
    const geometry = [];
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const lat = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * midLat + t ** 2 * end[0];
      const lon = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * midLon + t ** 2 * end[1];
      geometry.push([lat, lon]);
    }
    let distanceKm = 0;
    for (let i = 1; i < geometry.length; i++) {
      distanceKm += haversineKm(geometry[i - 1], geometry[i]);
    }
    const jitter = 0.9 + rand() * 0.25;
    const speed = v.speed * jitter;                 // km/h average
    const slowKm = distanceKm * (0.15 + rand() * 0.4);
    return {
      geometry,
      distanceKm,
      durationMin: (distanceKm / speed) * 60,
      steps: Math.round(distanceKm * v.stopFactor),
      slowKm,
      demo: true,
    };
  });
}
