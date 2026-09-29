/* =========================================================
   APP.JS  —  the UI glue. Everything happens from here:
     · Leaflet map + click-to-place waypoints
     · CALCULATE button flow (OSRM -> elevation -> fuel model)
     · rendering route cards, details, stats and the log

   The whole app state lives in ONE object (`state`) which is
   also exposed as window.state — open the browser console
   any time to inspect it while debugging.
   ========================================================= */

/* ---------- Global state ---------- */
const state = {
  start: [...CONFIG.DEFAULT_START],   // [lat, lon]
  end: [...CONFIG.DEFAULT_END],
  checkpoints: [],                    // array of [lat, lon]
  pickMode: null,                     // 'start' | 'end' | 'checkpoint' | null
  routes: [],                         // enriched + ranked routes
  selected: -1,                       // index into state.routes
  calculating: false,
  demoMode: false,
};
window.state = state; // <- debug handle

/* ---------- Handy DOM shortcut ---------- */
const $ = id => document.getElementById(id);

/* Leaflet objects (not part of state — created once in initMap) */
let map, routeLayer, markerLayer;

// If the Leaflet CDN couldn't load (offline / blocked), the dashboard
// still runs — just without the map panel. Everything checks this flag.
const mapAvailable = (typeof L !== "undefined");

/* =========================================================
   SYSTEM LOG  (the black terminal panel, bottom right)
   ========================================================= */
function log(message, kind = "info") {
  const box = $("log");
  const time = new Date().toTimeString().slice(0, 8);
  const line = document.createElement("div");
  line.innerHTML = '<span class="t">' + time + "</span>" +
    '<span class="' + kind + '">' + message + "</span>";
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;      // auto-scroll to newest
  console.log("[ER-13]", message);       // mirror to devtools too
}

function setLed(id, cls) {
  $(id).className = "led " + cls;
}

function showBanner(text, isError = false) {
  const b = $("banner");
  b.textContent = text;
  b.className = "banner" + (isError ? " error" : "");
}
function hideBanner() { $("banner").className = "banner hidden"; }

/* =========================================================
   MAP SETUP
   ========================================================= */
function initMap() {
  map = L.map("map", { zoomControl: true })
    .setView(CONFIG.DEFAULT_CENTER, CONFIG.DEFAULT_ZOOM);

  L.tileLayer(CONFIG.TILE_URL, {
    attribution: CONFIG.TILE_ATTRIBUTION,
    maxZoom: 19,
  }).addTo(map);

  // Separate layer groups so we can clear routes/markers independently.
  routeLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  // Click handler: places points depending on the active pick mode.
  map.on("click", e => {
    if (!state.pickMode) return;
    const p = [+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)];
    if (state.pickMode === "start") {
      state.start = p;
      setPickMode(null);
      log("INPUT · start set to " + p);
    } else if (state.pickMode === "end") {
      state.end = p;
      setPickMode(null);
      log("INPUT · destination set to " + p);
    } else if (state.pickMode === "checkpoint") {
      state.checkpoints.push(p);
      // stay in checkpoint mode so you can add several in a row
      log("INPUT · checkpoint " + state.checkpoints.length + " added at " + p);
    }
    updateMarkers();
    renderWaypointList();
  });

  updateMarkers();
}

/* Draw A / C1..Cn / B markers from current state. */
function updateMarkers() {
  if (!mapAvailable) return;
  markerLayer.clearLayers();

  const mk = (latlng, cls, letter, tooltip) =>
    L.marker(latlng, {
      icon: L.divIcon({
        className: "",
        html: '<div class="pin ' + cls + '">' + letter + "</div>",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    }).bindTooltip(tooltip).addTo(markerLayer);

  if (state.start) mk(state.start, "start", "A", "START");
  state.checkpoints.forEach((cp, i) => mk(cp, "cp", "C" + (i + 1), "CHECKPOINT " + (i + 1)));
  if (state.end) mk(state.end, "end", "B", "DESTINATION");
}

/* =========================================================
   PICK MODES  (the three buttons under SEC.01)
   ========================================================= */
function setPickMode(mode) {
  // clicking the active button again turns the mode off
  if (state.pickMode === mode) mode = null;
  state.pickMode = mode;

  const buttons = { start: "pick-start", end: "pick-end", checkpoint: "pick-cp" };
  for (const key in buttons) {
    $(buttons[key]).classList.toggle("active", state.pickMode === key);
  }
  const pill = $("map-mode");
  if (mode === "start")      { $("hint").textContent = "MODE · CLICK MAP TO PLACE START [A]"; pill.textContent = "PLACING START"; }
  else if (mode === "end")   { $("hint").textContent = "MODE · CLICK MAP TO PLACE DESTINATION [B]"; pill.textContent = "PLACING DEST"; }
  else if (mode === "checkpoint") { $("hint").textContent = "MODE · CLICK MAP TO ADD CHECKPOINTS (ESC WHEN DONE)"; pill.textContent = "PLACING CHECKPOINT"; }
  else                       { $("hint").textContent = "MODE · IDLE — CHOOSE AN ACTION ABOVE"; pill.textContent = "IDLE"; }
  pill.classList.toggle("active", !!mode);
  if (mapAvailable) map.getContainer().style.cursor = mode ? "crosshair" : "";
}

/* =========================================================
   WAYPOINT LIST (left panel)
   ========================================================= */
function renderWaypointList() {
  const ul = $("wp-list");
  ul.innerHTML = "";

  const addRow = (tag, tagCls, coords, onDelete) => {
    const li = document.createElement("li");
    li.innerHTML = '<span class="wp-tag ' + tagCls + '">' + tag + "</span>" +
      '<span class="wp-coords">' + coords[0].toFixed(4) + ", " + coords[1].toFixed(4) + "</span>";
    if (onDelete) {
      const btn = document.createElement("button");
      btn.className = "wp-del";
      btn.textContent = "✕";
      btn.title = "remove";
      btn.onclick = onDelete;
      li.appendChild(btn);
    }
    ul.appendChild(li);
  };

  if (state.start) addRow("A", "start", state.start, () => { state.start = null; updateMarkers(); renderWaypointList(); });
  state.checkpoints.forEach((cp, i) =>
    addRow("C" + (i + 1), "cp", cp, () => {
      state.checkpoints.splice(i, 1);
      updateMarkers(); renderWaypointList();
    })
  );
  if (state.end) addRow("B", "dest", state.end, () => { state.end = null; updateMarkers(); renderWaypointList(); });

  if (!state.start && !state.end && state.checkpoints.length === 0) {
    ul.innerHTML = '<li class="wp-empty">— EMPTY · CLICK THE MAP TO ADD POINTS —</li>';
  }
}

/* =========================================================
   SETTINGS HELPERS
   ========================================================= */
function getVehicle() {
  const id = $("vehicle").value;
  return CONFIG.VEHICLES.find(v => v.id === id) || CONFIG.VEHICLES[0];
}
function getFuelPrice() {
  return Math.max(0.01, parseFloat($("fuel-price").value) || 1);
}
function getCurrencySymbol() {
  return $("currency").selectedOptions[0].dataset.symbol || "₹";
}
function getPriority() {
  return parseInt($("priority").value, 10) / 100; // 0..1
}
function money(x) { return getCurrencySymbol() + x.toFixed(2); }

/* =========================================================
   MAIN FLOW: CALCULATE
   ========================================================= */
async function calculate() {
  if (state.calculating) return;

  // --- validate ---
  if (!state.start || !state.end) {
    showBanner("SET BOTH A START [A] AND A DESTINATION [B] FIRST.", true);
    log("ERROR · missing start or destination", "err");
    return;
  }
  hideBanner();
  state.calculating = true;
  state.demoMode = false;
  $("calculate").disabled = true;
  $("calculate").textContent = "◌ CALCULATING…";
  setLed("led-osrm", "warn"); setLed("led-elev", ""); setLed("led-model", "");

  try {
    // 1) candidate routes ------------------------------------------------
    const points = [state.start, ...state.checkpoints, state.end];
    let rawRoutes;
    try {
      rawRoutes = await fetchRoutes(points);
      setLed("led-osrm", "ok");
    } catch (err) {
      // No internet / OSRM down → fall back to simulated routes so the
      // dashboard stays usable (clearly labelled DEMO everywhere).
      log("OSRM  · FAILED (" + err.message + ")", "err");
      setLed("led-osrm", "err");
      rawRoutes = makeDemoRoutes(points);
      state.demoMode = true;
      showBanner("OFFLINE DEMO MODE — OSRM UNREACHABLE, SHOWING SIMULATED ROUTES. OPEN THIS PAGE IN A BROWSER WITH INTERNET FOR REAL ROUTING.");
    }

    // 2) elevation profile per route -------------------------------------
    setLed("led-elev", "warn");
    let elevOk = true;
    for (let i = 0; i < rawRoutes.length; i++) {
      rawRoutes[i].elevation = await fetchElevation(rawRoutes[i].geometry, i);
      if (rawRoutes[i].elevation.source === "SIMULATED") elevOk = false;
    }
    setLed("led-elev", elevOk ? "ok" : "warn");

    // 3) fuel model + ranking --------------------------------------------
    setLed("led-model", "warn");
    const vehicle = getVehicle();
    for (const r of rawRoutes) {
      r.fuel = predictFuel(r, vehicle);
      r.eco = ecoScore(r.fuel.lPerKm);
    }
    state.routes = rankRoutes(rawRoutes, getPriority());
    setLed("led-model", "ok");
    log("MODEL · scored " + state.routes.length + " routes with " + vehicle.label +
        " @ " + vehicle.lPer100 + " L/100km");

    // 4) render -----------------------------------------------------------
    renderRouteCards();
    drawRoutes();
    selectRoute(0);
  } catch (err) {
    log("FATAL · " + err.message, "err");
    showBanner("SOMETHING BROKE: " + err.message.toUpperCase(), true);
    console.error(err);
  } finally {
    state.calculating = false;
    $("calculate").disabled = false;
    $("calculate").textContent = "▶ CALCULATE ECO-ROUTES";
  }
}

/* =========================================================
   DRAW ROUTES ON THE MAP
   ========================================================= */
function drawRoutes() {
  if (!mapAvailable) return;
  routeLayer.clearLayers();
  state.routes.forEach((r, i) => {
    // white casing under the colored line keeps it readable on any tiles
    L.polyline(r.geometry, { color: CONFIG.COLORS.casing, weight: 9, opacity: 0.9 })
      .addTo(routeLayer);
    const line = L.polyline(r.geometry, {
      color: r.color,
      weight: i === state.selected ? 6.5 : 4,
      opacity: i === state.selected ? 1 : 0.75,
    }).addTo(routeLayer);
    line.on("click", () => selectRoute(i));
    line.bindTooltip("ROUTE " + String(i + 1).padStart(2, "0") +
      " · " + r.fuel.fuelLiters.toFixed(2) + " L", { sticky: true });
    r._line = line;
  });
  if (state.routes.length) {
    // zoom to fit ALL candidate routes, not just the first one
    const allPoints = [];
    state.routes.forEach(r => allPoints.push(...r.geometry));
    map.fitBounds(L.latLngBounds(allPoints).pad(0.12));
  }
}

/* =========================================================
   ROUTE CARDS  (SEC.04, under the map)
   ========================================================= */
function renderRouteCards() {
  const wrap = $("route-cards");
  wrap.innerHTML = "";
  $("cards-count").textContent = state.routes.length;

  state.routes.forEach((r, i) => {
    const card = document.createElement("div");
    card.className = "route-card" + (i === state.selected ? " selected" : "");
    card.onclick = () => selectRoute(i);

    const chips = r.tags.map(t =>
      '<span class="chip ' + t.kind + '">' + t.text + "</span>").join("");

    card.innerHTML =
      '<div class="rc-head">' +
        '<span class="rc-line" style="background:' + r.color + '"></span>' +
        '<span class="rc-name">ROUTE ' + String(i + 1).padStart(2, "0") + "</span>" +
        (r.demo ? '<span class="rc-demo">DEMO DATA</span>' : "") +
        '<span class="rc-score">' + r.eco + "<small>ECO SCORE</small></span>" +
      "</div>" +
      '<div class="rc-metrics">' +
        metric("DIST", r.distanceKm.toFixed(1) + " km") +
        metric("TIME", Math.round(r.durationMin) + " min") +
        metric("FUEL", r.fuel.fuelLiters.toFixed(2) + " L") +
        metric("COST", money(r.fuel.fuelLiters * getFuelPrice())) +
      "</div>" +
      '<div class="chips">' + chips + "</div>";

    wrap.appendChild(card);
  });

  function metric(label, value) {
    return '<div><span class="rc-metric-label">' + label + '</span>' +
           '<span class="rc-metric">' + value + "</span></div>";
  }
}

/* =========================================================
   SELECT A ROUTE  → update map, cards, details, top stats
   ========================================================= */
function selectRoute(i) {
  if (i < 0 || i >= state.routes.length) return;
  state.selected = i;
  const r = state.routes[i];

  // map emphasis
  state.routes.forEach((route, idx) => {
    if (route._line) route._line.setStyle({
      weight: idx === i ? 6.5 : 4,
      opacity: idx === i ? 1 : 0.6,
    });
  });

  renderRouteCards();      // re-render to move the "selected" styling
  renderDetails(r);
  renderTopStats(r);
}

function renderTopStats(r) {
  $("t-dist").innerHTML = r.distanceKm.toFixed(1) + "<i>KM</i>";
  $("t-fuel").innerHTML = r.fuel.fuelLiters.toFixed(2) + "<i>L</i>";
  $("t-co2").innerHTML = r.fuel.co2Kg.toFixed(2) + "<i>KG</i>";
  $("t-cost").innerHTML = money(r.fuel.fuelLiters * getFuelPrice());
}

/* =========================================================
   DETAIL PANEL  (SEC.05)
   ========================================================= */
function renderDetails(r) {
  $("detail-empty").classList.add("hidden");
  $("detail-body").classList.remove("hidden");

  $("d-title").textContent = "ROUTE " + String(r.rank + 1).padStart(2, "0") +
    (r.demo ? " · DEMO" : "");

  // eco score badge (green/amber/red by score)
  const badge = $("d-score");
  badge.textContent = r.eco;
  badge.className = "score-badge" + (r.eco >= 70 ? "" : r.eco >= 40 ? " mid" : " low");

  // tags
  $("d-tags").innerHTML = r.tags.map(t =>
    '<span class="chip ' + t.kind + '">' + t.text + "</span>").join("");

  // metric grid
  const price = getFuelPrice();
  $("d-fuel").innerHTML = r.fuel.fuelLiters.toFixed(2) + "<i>L</i>";
  $("d-co2").innerHTML = r.fuel.co2Kg.toFixed(2) + "<i>KG</i>";
  $("d-cost").innerHTML = money(r.fuel.fuelLiters * price);
  $("d-time").innerHTML = Math.round(r.durationMin) + "<i>MIN</i>";
  $("d-dist").innerHTML = r.distanceKm.toFixed(1) + "<i>KM</i>";
  $("d-elev").innerHTML = Math.round(r.elevation.gainM) + "<i>M</i>";
  $("d-stops").textContent = r.steps;
  $("d-cong").innerHTML = Math.round(r.fuel.congestion * 100) + "<i>% OF KM</i>";
  $("d-elev-src").textContent = r.elevation.source;

  renderProfile(r.elevation.profile);
  renderPenalties(r);
  renderSavings(r, price);
  renderCaveats(r);
}

/* Elevation profile as a tiny inline SVG sparkline. */
function renderProfile(profile) {
  const svg = $("d-profile");
  const W = 300, H = 64;
  const min = Math.min(...profile), max = Math.max(...profile);
  const span = Math.max(1, max - min);
  const pts = profile.map((e, i) => {
    const x = (i / (profile.length - 1)) * W;
    const y = H - 6 - ((e - min) / span) * (H - 14);
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  svg.innerHTML =
    '<polygon points="0,' + H + " " + pts.join(" ") + " " + W + "," + H + '"' +
      ' fill="rgba(0,166,81,0.14)"/>' +
    '<polyline points="' + pts.join(" ") + '" fill="none" stroke="#16161A" stroke-width="1.6"/>' +
    '<text x="4" y="10" font-size="8" fill="#6E6E66" font-family="monospace">MAX ' +
      Math.round(max) + "M</text>" +
    '<text x="4" y="' + (H - 3) + '" font-size="8" fill="#6E6E66" font-family="monospace">MIN ' +
      Math.round(min) + "M</text>";
}

/* "Where the fuel goes" bars: baseline + 3 penalty components. */
function renderPenalties(r) {
  const p = r.fuel.penalties;
  const rows = [
    ["BASELINE", r.distanceKm * (getVehicle().lPer100 / 100), ""],
    ["HILLS", r.distanceKm * (getVehicle().lPer100 / 100) * p.elevPenalty, "elev"],
    ["STOPS", r.distanceKm * (getVehicle().lPer100 / 100) * p.stopPenalty, ""],
    ["TRAFFIC", r.distanceKm * (getVehicle().lPer100 / 100) * p.trafficPenalty, "traffic"],
  ];
  const max = Math.max(...rows.map(x => x[1]), 0.0001);
  $("d-penalties").innerHTML = rows.map(([label, liters, cls]) =>
    '<div class="pen-row">' +
      '<span class="pen-label">' + label + "</span>" +
      '<span class="pen-track"><span class="pen-fill ' + cls + '" style="display:block;width:' +
        Math.max(2, (liters / max) * 100) + '%"></span></span>' +
      '<span class="pen-val">' + liters.toFixed(2) + " L</span>" +
    "</div>").join("");
}

/* Savings vs the fastest and vs the most fuel-thirsty candidate. */
function renderSavings(r, price) {
  const box = $("d-savings");
  if (state.routes.length < 2) {
    box.className = "savings none";
    box.innerHTML = "Only one candidate route was returned for these waypoints — nothing to compare against yet.";
    return;
  }
  const fastest = state.routes.reduce((a, b) => a.durationMin < b.durationMin ? a : b);
  const thirstiest = state.routes.reduce((a, b) => a.fuel.fuelLiters > b.fuel.fuelLiters ? a : b);

  const dL = thirstiest.fuel.fuelLiters - r.fuel.fuelLiters;
  const lines = [];
  if (thirstiest !== r && dL > 0.001) {
    lines.push("VS WORST CANDIDATE (ROUTE " + String(thirstiest.rank + 1).padStart(2, "0") + "): SAVES " +
      "<b>" + dL.toFixed(2) + " L · " + money(dL * price) + " · " +
      (dL * (getVehicle().fuel === "diesel" ? CONFIG.MODEL.CO2_DIESEL : CONFIG.MODEL.CO2_PETROL)).toFixed(2) + " KG CO₂</b>");
  }
  if (fastest !== r) {
    const dF = r.fuel.fuelLiters - fastest.fuel.fuelLiters;
    lines.push("VS FASTEST (ROUTE " + String(fastest.rank + 1).padStart(2, "0") + "): " +
      (dF <= 0.001
        ? "<b>ALSO THE FASTEST OPTION — FREE WIN</b>"
        : "BURNS " + dF.toFixed(2) + " L MORE BUT SAVES " +
          Math.round(r.durationMin - fastest.durationMin) + " MIN"));
  }
  box.className = "savings";
  box.innerHTML = lines.join("<br>") || "This route is the reference point.";
}

/* Human-readable caveat list for the selected route. */
function renderCaveats(r) {
  const ul = $("d-caveats");
  const items = [];

  if (r.fuel.congestion > 0.25)
    items.push([false, Math.round(r.fuel.congestion * 100) + "% of this route runs below " + CONFIG.MODEL.CONGESTION_SPEED + " km/h — expect stop-and-go burn."]);
  else if (r.fuel.congestion > 0.12)
    items.push([false, "Some congested stretches (" + Math.round(r.fuel.congestion * 100) + "% of km below " + CONFIG.MODEL.CONGESTION_SPEED + " km/h)."]);
  else
    items.push([true, "Traffic looks light — free-flowing speeds on most of the route."]);

  if (r.fuel.climbPerKm > 25)
    items.push([false, "Hilly: ~" + Math.round(r.elevation.gainM) + " m of climbing (" + r.fuel.climbPerKm.toFixed(0) + " m/km)."]);
  else
    items.push([true, "Mostly flat terrain — little elevation penalty."]);

  if (r.fuel.stopsPerKm > 4)
    items.push([false, "Dense intersections: ~" + r.steps + " maneuvers (" + r.fuel.stopsPerKm.toFixed(1) + "/km)."]);

  if (state.routes.length > 1) {
    const minT = Math.min(...state.routes.map(x => x.durationMin));
    if (r.durationMin > minT + 1)
      items.push([false, "Takes ~" + Math.round(r.durationMin - minT) + " min longer than the fastest option."]);
    const minF = Math.min(...state.routes.map(x => x.fuel.fuelLiters));
    if (r.fuel.fuelLiters <= minF + 0.001)
      items.push([true, "Lowest predicted fuel use of all candidates — the eco pick."]);
  }

  if (r.demo)
    items.push([false, "DEMO DATA: simulated route geometry and traffic (OSRM was unreachable)."]);

  items.push([true, "Estimates only — real consumption varies with AC, load, tire pressure and driving style."]);

  ul.innerHTML = items.map(([good, text]) =>
    '<li class="' + (good ? "good" : "") + '">' + text + "</li>").join("");
}

/* =========================================================
   WIRING: buttons, selects, keyboard
   ========================================================= */
function initUI() {
  // populate vehicle select
  $("vehicle").innerHTML = CONFIG.VEHICLES.map(v =>
    '<option value="' + v.id + '">' + v.label + " · " + v.lPer100 + " L/100KM</option>").join("");

  // populate currency select + keep fuel price in sync with the currency
  $("currency").innerHTML = CONFIG.CURRENCIES.map((c, i) =>
    '<option value="' + i + '" data-symbol="' + c.symbol + '"' +
    (i === 0 ? " selected" : "") + ">" + c.label + "</option>").join("");
  $("currency").onchange = () => {
    const c = CONFIG.CURRENCIES[parseInt($("currency").value, 10)];
    $("fuel-price").value = c.perLiterDefault;
    refreshAfterSettingsChange();
  };

  // priority slider label
  $("priority").oninput = () => {
    const p = getPriority();
    $("priority-label").textContent =
      p < 0.35 ? "FUEL-BIASED" : p > 0.65 ? "TIME-BIASED" : "BALANCED";
  };
  // re-rank existing routes live when priority changes (no refetch needed)
  $("priority").onchange = () => {
    if (state.routes.length > 1) {
      state.routes = rankRoutes(state.routes, getPriority());
      drawRoutes();
      selectRoute(0);
      log("MODEL · re-ranked with priority " + getPriority().toFixed(2));
    }
  };

  // re-score live when vehicle / fuel price change
  $("vehicle").onchange = refreshAfterSettingsChange;
  $("fuel-price").oninput = refreshAfterSettingsChange;

  // pick-mode buttons
  $("pick-start").onclick = () => setPickMode("start");
  $("pick-end").onclick = () => setPickMode("end");
  $("pick-cp").onclick = () => setPickMode("checkpoint");

  $("locate").onclick = () => {
    if (!navigator.geolocation) { log("GEO   · not supported by this browser", "err"); return; }
    log("GEO   · requesting location…");
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.start = [+pos.coords.latitude.toFixed(6), +pos.coords.longitude.toFixed(6)];
        if (mapAvailable) map.setView(state.start, 14);
        updateMarkers(); renderWaypointList();
        log("GEO   · start set to your location");
      },
      err => log("GEO   · denied/unavailable (" + err.message + ")", "err")
    );
  };

  $("clear-all").onclick = () => {
    state.start = null; state.end = null; state.checkpoints = [];
    state.routes = []; state.selected = -1;
    if (mapAvailable) routeLayer.clearLayers();
    updateMarkers(); renderWaypointList();
    $("route-cards").innerHTML = '<p class="empty-note">No routes yet — set start &amp; destination, then hit CALCULATE.</p>';
    $("cards-count").textContent = "0";
    $("detail-body").classList.add("hidden");
    $("detail-empty").classList.remove("hidden");
    ["t-dist", "t-fuel", "t-co2", "t-cost"].forEach(id => $(id).innerHTML = "–");
    hideBanner();
    log("INPUT · cleared everything");
  };

  $("calculate").onclick = calculate;
  $("clear-log").onclick = () => { $("log").innerHTML = ""; };

  // ESC cancels the active pick mode
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && state.pickMode) setPickMode(null);
  });
}

/* Re-run the model on cached routes when settings change —
   instant feedback, no new network calls. */
function refreshAfterSettingsChange() {
  if (state.routes.length === 0) return;
  const vehicle = getVehicle();
  for (const r of state.routes) {
    r.fuel = predictFuel(r, vehicle);
    r.eco = ecoScore(r.fuel.lPerKm);
  }
  state.routes = rankRoutes(state.routes, getPriority());
  drawRoutes();
  selectRoute(Math.max(0, Math.min(state.selected, state.routes.length - 1)));
  log("MODEL · re-scored with " + vehicle.label + " @ " + money(getFuelPrice()) + "/L");
}

/* =========================================================
   BOOT
   ========================================================= */
function init() {
  if (mapAvailable) {
    initMap();
  } else {
    // The map CDN didn't load (offline preview / blocked network).
    // Everything else still works with the pre-loaded demo corridor.
    showBanner("MAP LIBRARY (LEAFLET) COULDN'T LOAD — NO INTERNET OR BLOCKED CDN. ROUTE MATH STILL WORKS; OPEN THIS FILE IN A NORMAL BROWSER FOR THE FULL MAP.", true);
    log("BOOT  · Leaflet unavailable — running headless (no map)", "err");
  }
  initUI();
  renderWaypointList();

  log("BOOT  · " + CONFIG.PRODUCT_CODE + " " + CONFIG.PRODUCT_NAME);
  log("BOOT  · default corridor pre-loaded (Kolkata). Hit CALCULATE, or click the map to set your own points.");

  // Auto-run once so the dashboard is alive on first load.
  calculate();
}

document.addEventListener("DOMContentLoaded", init);
