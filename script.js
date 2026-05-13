"use strict";

// 標準地域メッシュコード (JIS X 0410) ↔ 緯度経度

const MESH_DIGITS = [4, 6, 8, 9, 10, 11];

const MESH_SPANS = {
  4: { lat: 2 / 3, lng: 1 },
  6: { lat: 1 / 12, lng: 1 / 8 },
  8: { lat: 1 / 120, lng: 1 / 80 },
  9: { lat: 1 / 240, lng: 1 / 160 },
  10: { lat: 1 / 480, lng: 1 / 320 },
  11: { lat: 1 / 960, lng: 1 / 640 },
};

class MeshError extends Error {
  constructor(key, ...args) {
    super(key);
    this.i18nKey = key;
    this.i18nArgs = args;
  }
}

// ---- メッシュコード → bounds ----
function parseMeshCode(raw) {
  const code = String(raw).replace(/\s|-/g, "");
  if (!/^\d+$/.test(code)) {
    throw new MeshError("err_numeric");
  }
  if (!MESH_DIGITS.includes(code.length)) {
    throw new MeshError("err_digits");
  }

  const ab = parseInt(code.slice(0, 2), 10);
  const cd = parseInt(code.slice(2, 4), 10);
  let south = (ab * 2) / 3;
  let west = 100 + cd;
  let latSpan = 2 / 3;
  let lngSpan = 1;

  if (code.length >= 6) {
    const e = parseInt(code[4], 10);
    const f = parseInt(code[5], 10);
    if (e > 7 || f > 7) {
      throw new MeshError("err_secondary");
    }
    latSpan = latSpan / 8;
    lngSpan = lngSpan / 8;
    south += e * latSpan;
    west += f * lngSpan;
  }

  if (code.length >= 8) {
    const g = parseInt(code[6], 10);
    const h = parseInt(code[7], 10);
    latSpan = latSpan / 10;
    lngSpan = lngSpan / 10;
    south += g * latSpan;
    west += h * lngSpan;
  }

  for (let i = 8; i < code.length; i++) {
    const q = parseInt(code[i], 10);
    if (q < 1 || q > 4) {
      throw new MeshError("err_quadrant");
    }
    latSpan = latSpan / 2;
    lngSpan = lngSpan / 2;
    const north = q >= 3;
    const east = q === 2 || q === 4;
    if (north) south += latSpan;
    if (east) west += lngSpan;
  }

  const north = south + latSpan;
  const east = west + lngSpan;
  return {
    code,
    digits: code.length,
    south,
    west,
    north,
    east,
    latSpan,
    lngSpan,
    center: [(south + north) / 2, (west + east) / 2],
  };
}

// ---- 座標 → メッシュコード ----
function coordsToMesh(lat, lng, digits) {
  if (!MESH_DIGITS.includes(digits)) {
    throw new MeshError("err_level_invalid");
  }
  if (!isFinite(lat) || !isFinite(lng)) {
    throw new MeshError("err_coords_invalid");
  }
  if (lat < 0 || lat >= 67 || lng < 100 || lng >= 180) {
    throw new MeshError("err_out_of_range");
  }

  const ab = Math.floor(lat * 1.5);
  const cd = Math.floor(lng) - 100;
  let code = String(ab).padStart(2, "0") + String(cd).padStart(2, "0");
  const lat1Origin = (ab * 2) / 3;
  const lng1Origin = 100 + cd;
  if (digits === 4) return code;

  const e = Math.floor((lat - lat1Origin) / (1 / 12));
  const f = Math.floor((lng - lng1Origin) / (1 / 8));
  code += String(e) + String(f);
  const lat2Origin = lat1Origin + e / 12;
  const lng2Origin = lng1Origin + f / 8;
  if (digits === 6) return code;

  const g = Math.floor((lat - lat2Origin) / (1 / 120));
  const h = Math.floor((lng - lng2Origin) / (1 / 80));
  code += String(g) + String(h);
  let latOrigin = lat2Origin + g / 120;
  let lngOrigin = lng2Origin + h / 80;
  let latSpan = 1 / 120;
  let lngSpan = 1 / 80;
  if (digits === 8) return code;

  for (let d = 9; d <= digits; d++) {
    latSpan /= 2;
    lngSpan /= 2;
    const isNorth = lat - latOrigin >= latSpan;
    const isEast = lng - lngOrigin >= lngSpan;
    const q = isNorth ? (isEast ? 4 : 3) : isEast ? 2 : 1;
    code += String(q);
    if (isNorth) latOrigin += latSpan;
    if (isEast) lngOrigin += lngSpan;
  }
  return code;
}

// ---- haversine 距離 (km) ----
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- N km 圏内のメッシュ列挙 ----
function meshesWithinRadius(lat, lng, km, digits) {
  if (!MESH_SPANS[digits]) throw new MeshError("err_level_bad");
  if (!(km > 0)) throw new MeshError("err_radius_positive");

  const latDeg = km / 110.574;
  const lngDeg = km / (111.32 * Math.cos((lat * Math.PI) / 180) + 1e-9);
  const minLat = lat - latDeg;
  const maxLat = lat + latDeg;
  const minLng = lng - lngDeg;
  const maxLng = lng + lngDeg;

  if (minLat < 0 || maxLat >= 67 || minLng < 100 || maxLng >= 180) {
    throw new MeshError("err_radius_out_of_range");
  }

  const span = MESH_SPANS[digits];
  const swBounds = parseMeshCode(coordsToMesh(minLat, minLng, digits));
  const neBounds = parseMeshCode(coordsToMesh(maxLat, maxLng, digits));

  const rows = Math.round((neBounds.north - swBounds.south) / span.lat);
  const cols = Math.round((neBounds.east - swBounds.west) / span.lng);
  const candidateCount = rows * cols;

  const MAX_CANDIDATES = 50000;
  if (candidateCount > MAX_CANDIDATES) {
    throw new MeshError("err_too_many", candidateCount.toLocaleString());
  }

  const result = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const meshSouth = swBounds.south + i * span.lat;
      const meshWest = swBounds.west + j * span.lng;
      const cLat = meshSouth + span.lat / 2;
      const cLng = meshWest + span.lng / 2;
      const d = haversineKm(lat, lng, cLat, cLng);
      if (d <= km) {
        result.push({
          code: coordsToMesh(cLat, cLng, digits),
          south: meshSouth,
          west: meshWest,
          north: meshSouth + span.lat,
          east: meshWest + span.lng,
          center: [cLat, cLng],
          distance: d,
        });
      }
    }
  }
  result.sort((a, b) => a.distance - b.distance);
  return result;
}

// ============================================================
// I18N
// ============================================================
const I18N = {
  ja: {
    title: "地域メッシュビューア",
    subtitle: "標準地域メッシュコード (JIS X 0410) を地図と相互変換するツール",
    tab_forward: "メッシュ→地図",
    tab_reverse: "座標→メッシュ",
    tab_radius: "範囲列挙",
    forward_label: "メッシュコード (4/6/8/9/10/11桁)",
    forward_placeholder: "例: 53394611",
    forward_submit: "表示",
    forward_empty: "メッシュコードを入力してください",
    reverse_lat: "緯度",
    reverse_lng: "経度",
    reverse_level: "メッシュレベル",
    reverse_submit: "変換",
    radius_lat: "中心 緯度",
    radius_lng: "中心 経度",
    radius_km: "半径 (km)",
    radius_level: "メッシュレベル",
    radius_submit: "列挙",
    radius_hint: "内包条件: メッシュ中心が円内",
    pick_btn: "地図クリックで取得",
    pick_active: "地図をクリック…",
    samples_summary: "サンプル",
    sample_5339: "5339 — 東京 1次",
    sample_533945: "533945 — 東京中心 2次",
    sample_53394611: "53394611 — 東京駅 3次",
    sample_533946114: "533946114 — 1/2",
    legend_summary: "メッシュ区分の対応",
    legend_4: "4桁 = 1次メッシュ (約 80km)",
    legend_6: "6桁 = 2次メッシュ (約 10km)",
    legend_8: "8桁 = 3次メッシュ (約 1km)",
    legend_9: "9桁 = 1/2地域メッシュ (約 500m)",
    legend_10: "10桁 = 1/4地域メッシュ (約 250m)",
    legend_11: "11桁 = 1/8地域メッシュ (約 125m)",
    legend_quadrant: "分割メッシュの末尾桁: 1=南西, 2=南東, 3=北西, 4=北東",
    lvl_4: "1次メッシュ (約80km)",
    lvl_6: "2次メッシュ (約10km)",
    lvl_8: "3次メッシュ (約1km)",
    lvl_9: "1/2地域メッシュ (約500m)",
    lvl_10: "1/4地域メッシュ (約250m)",
    lvl_11: "1/8地域メッシュ (約125m)",
    res_code: "コード",
    res_level: "区分",
    res_southwest: "南西",
    res_northeast: "北東",
    res_center: "中心",
    res_span: "幅",
    res_input: "入力",
    res_mesh_sw: "メッシュ南西",
    res_mesh_ne: "メッシュ北東",
    res_span_value: (lat, lng) => `緯度 ${lat}° / 経度 ${lng}°`,
    radius_found_html: (n) => `<strong>${n}</strong> 件のメッシュを発見`,
    radius_csv: "CSV ダウンロード",
    radius_more: (n) => `…他 ${n} 件 (CSV ダウンロードで全件取得可)`,
    radius_center_popup: (lat, lng, km) => `中心<br>${lat}, ${lng}<br>半径 ${km} km`,
    radius_mesh_popup: (code, dist) => `${code}<br>中心からの距離: ${dist} km`,
    reverse_input_popup: (lat, lng) => `入力点<br>${lat}, ${lng}`,
    err_numeric: "数字のみ入力してください",
    err_digits: "メッシュコードは 4/6/8/9/10/11 桁で入力してください",
    err_secondary: "2次メッシュの 5,6 桁目は 0-7 です",
    err_quadrant: "分割メッシュの桁は 1-4 です (1:SW 2:SE 3:NW 4:NE)",
    err_level_invalid: "レベルは 4/6/8/9/10/11 のいずれかです",
    err_coords_invalid: "有効な緯度経度を入力してください",
    err_out_of_range: "座標が標準地域メッシュの範囲外です (緯度 0〜67, 経度 100〜180)",
    err_level_bad: "レベルが不正です",
    err_radius_positive: "半径は 0 より大きい値を指定してください",
    err_radius_out_of_range: "半径が大きすぎてメッシュ定義域外を含みます",
    err_too_many: (n) => `候補メッシュが多すぎます (${n} 個)。半径かレベルを調整してください`,
    lang_toggle_label: "EN",
  },
  en: {
    title: "Japan Mesh Viewer",
    subtitle: "Convert between Japanese Standard Mesh Codes (JIS X 0410) and the map",
    tab_forward: "Mesh → Map",
    tab_reverse: "Coords → Mesh",
    tab_radius: "Within radius",
    forward_label: "Mesh code (4/6/8/9/10/11 digits)",
    forward_placeholder: "e.g. 53394611",
    forward_submit: "Show",
    forward_empty: "Please enter a mesh code",
    reverse_lat: "Latitude",
    reverse_lng: "Longitude",
    reverse_level: "Mesh level",
    reverse_submit: "Convert",
    radius_lat: "Center latitude",
    radius_lng: "Center longitude",
    radius_km: "Radius (km)",
    radius_level: "Mesh level",
    radius_submit: "List",
    radius_hint: "Inclusion: mesh center inside circle",
    pick_btn: "Pick from map",
    pick_active: "Click on map…",
    samples_summary: "Samples",
    sample_5339: "5339 — Tokyo (primary)",
    sample_533945: "533945 — Tokyo center (secondary)",
    sample_53394611: "53394611 — Tokyo Station (standard)",
    sample_533946114: "533946114 — 1/2 mesh",
    legend_summary: "Mesh code digits",
    legend_4: "4 digits = Primary mesh (~80 km)",
    legend_6: "6 digits = Secondary mesh (~10 km)",
    legend_8: "8 digits = Standard mesh (~1 km)",
    legend_9: "9 digits = 1/2 mesh (~500 m)",
    legend_10: "10 digits = 1/4 mesh (~250 m)",
    legend_11: "11 digits = 1/8 mesh (~125 m)",
    legend_quadrant: "Subdivision last digit: 1=SW, 2=SE, 3=NW, 4=NE",
    lvl_4: "Primary mesh (~80 km)",
    lvl_6: "Secondary mesh (~10 km)",
    lvl_8: "Standard mesh (~1 km)",
    lvl_9: "1/2 mesh (~500 m)",
    lvl_10: "1/4 mesh (~250 m)",
    lvl_11: "1/8 mesh (~125 m)",
    res_code: "Code",
    res_level: "Level",
    res_southwest: "SW",
    res_northeast: "NE",
    res_center: "Center",
    res_span: "Span",
    res_input: "Input",
    res_mesh_sw: "Mesh SW",
    res_mesh_ne: "Mesh NE",
    res_span_value: (lat, lng) => `lat ${lat}° / lng ${lng}°`,
    radius_found_html: (n) => `Found <strong>${n}</strong> meshes`,
    radius_csv: "Download CSV",
    radius_more: (n) => `…and ${n} more (download CSV for the full list)`,
    radius_center_popup: (lat, lng, km) => `Center<br>${lat}, ${lng}<br>Radius ${km} km`,
    radius_mesh_popup: (code, dist) => `${code}<br>Distance: ${dist} km`,
    reverse_input_popup: (lat, lng) => `Input<br>${lat}, ${lng}`,
    err_numeric: "Please enter digits only",
    err_digits: "Mesh code must be 4, 6, 8, 9, 10, or 11 digits",
    err_secondary: "Secondary mesh digits 5 & 6 must be 0-7",
    err_quadrant: "Subdivision digits must be 1-4 (1:SW 2:SE 3:NW 4:NE)",
    err_level_invalid: "Level must be 4, 6, 8, 9, 10, or 11",
    err_coords_invalid: "Please enter valid latitude and longitude",
    err_out_of_range: "Coordinates outside standard mesh domain (lat 0–67, lng 100–180)",
    err_level_bad: "Invalid level",
    err_radius_positive: "Radius must be greater than 0",
    err_radius_out_of_range: "Radius too large — extends outside mesh domain",
    err_too_many: (n) => `Too many candidate meshes (${n}). Reduce radius or use a coarser level`,
    lang_toggle_label: "日本語",
  },
};

const LANG_KEY = "jp-mesh-viewer-lang";
let currentLang = "ja";

function t(key, ...args) {
  const v = I18N[currentLang][key];
  if (typeof v === "function") return v(...args);
  return v != null ? v : key;
}
function tErr(e) {
  if (e instanceof MeshError) return t(e.i18nKey, ...e.i18nArgs);
  return e.message;
}
function meshLevelName(digits) {
  return t(`lvl_${digits}`);
}

function applyTranslations() {
  document.documentElement.lang = currentLang;
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll(".pick-btn").forEach((btn) => {
    if (pickTarget && pickTarget.btn === btn) {
      btn.textContent = t("pick_active");
    } else {
      btn.textContent = t("pick_btn");
    }
  });
  const toggleBtn = document.getElementById("lang-toggle");
  if (toggleBtn) toggleBtn.textContent = t("lang_toggle_label");
}

// ============================================================
// UI
// ============================================================

const map = L.map("map", { zoomSnap: 0.25 }).setView([36.0, 138.0], 5);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const layers = {
  forward: L.layerGroup().addTo(map),
  reverse: L.layerGroup().addTo(map),
  radius: L.layerGroup().addTo(map),
};

function fmt(n, p = 6) {
  return Number(n).toFixed(p);
}

// --- タブ切り替え ---
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = true));
    btn.classList.add("active");
    document.querySelector(`[data-panel="${btn.dataset.tab}"]`).hidden = false;
  });
});

// --- 地図クリックでピック ---
let pickTarget = null;
map.on("click", (e) => {
  if (!pickTarget) return;
  pickTarget.latInput.value = e.latlng.lat.toFixed(6);
  pickTarget.lngInput.value = e.latlng.lng.toFixed(6);
  endPick();
});

function startPick(latInput, lngInput, btn) {
  endPick();
  pickTarget = { latInput, lngInput, btn };
  btn.classList.add("picking");
  btn.textContent = t("pick_active");
  document.getElementById("map").style.cursor = "crosshair";
}
function endPick() {
  if (pickTarget) {
    pickTarget.btn.classList.remove("picking");
    pickTarget.btn.textContent = t("pick_btn");
    pickTarget = null;
  }
  document.getElementById("map").style.cursor = "";
}

document.querySelectorAll(".pick-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const latInput = document.getElementById(btn.dataset.lat);
    const lngInput = document.getElementById(btn.dataset.lng);
    if (pickTarget && pickTarget.btn === btn) endPick();
    else startPick(latInput, lngInput, btn);
  });
});

// ============================================================
// 各タブの結果を覚えておき、言語切替時に再描画する
// ============================================================
let lastForward = null; // メッシュコード string
let lastReverse = null; // {lat, lng, digits}
let lastRadius = null; // {lat, lng, km, digits}

// ============================================================
// Tab 1: メッシュコード → 地図
// ============================================================
const forwardForm = document.getElementById("forward-form");
const forwardInput = document.getElementById("forward-input");
const forwardResult = document.getElementById("forward-result");
const forwardError = document.getElementById("forward-error");

function forwardSubmit() {
  forwardError.hidden = true;
  forwardResult.hidden = true;
  const v = forwardInput.value.trim();
  if (!v) {
    forwardError.textContent = t("forward_empty");
    forwardError.hidden = false;
    return;
  }
  try {
    const b = parseMeshCode(v);
    renderForward(b, true);
    lastForward = v;
  } catch (e) {
    forwardError.textContent = tErr(e);
    forwardError.hidden = false;
  }
}

function renderForward(b, fit) {
  layers.forward.clearLayers();
  L.rectangle(
    [
      [b.south, b.west],
      [b.north, b.east],
    ],
    { color: "#2A7DE1", weight: 2, fillOpacity: 0.15 }
  )
    .bindPopup(`${b.code}<br>${meshLevelName(b.digits)}`)
    .addTo(layers.forward);
  if (fit) {
    map.fitBounds(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { padding: [40, 40], maxZoom: 16 }
    );
  }
  forwardResult.innerHTML = `
    <dl>
      <dt>${t("res_code")}</dt><dd>${b.code}</dd>
      <dt>${t("res_level")}</dt><dd>${meshLevelName(b.digits)}</dd>
      <dt>${t("res_southwest")}</dt><dd>${fmt(b.south)}, ${fmt(b.west)}</dd>
      <dt>${t("res_northeast")}</dt><dd>${fmt(b.north)}, ${fmt(b.east)}</dd>
      <dt>${t("res_center")}</dt><dd>${fmt(b.center[0])}, ${fmt(b.center[1])}</dd>
      <dt>${t("res_span")}</dt><dd>${t("res_span_value", fmt(b.latSpan), fmt(b.lngSpan))}</dd>
    </dl>
  `;
  forwardResult.hidden = false;
}

forwardForm.addEventListener("submit", (e) => {
  e.preventDefault();
  forwardSubmit();
});

document.querySelectorAll(".samples button").forEach((b) => {
  b.addEventListener("click", () => {
    forwardInput.value = b.dataset.code;
    forwardSubmit();
  });
});

// ============================================================
// Tab 2: 座標 → メッシュ
// ============================================================
const reverseForm = document.getElementById("reverse-form");
const reverseResult = document.getElementById("reverse-result");
const reverseError = document.getElementById("reverse-error");

function reverseSubmit() {
  reverseError.hidden = true;
  reverseResult.hidden = true;
  const lat = parseFloat(document.getElementById("reverse-lat").value);
  const lng = parseFloat(document.getElementById("reverse-lng").value);
  const digits = parseInt(document.getElementById("reverse-level").value, 10);
  try {
    renderReverse(lat, lng, digits, true);
    lastReverse = { lat, lng, digits };
  } catch (err) {
    reverseError.textContent = tErr(err);
    reverseError.hidden = false;
  }
}

function renderReverse(lat, lng, digits, fit) {
  const code = coordsToMesh(lat, lng, digits);
  const b = parseMeshCode(code);
  layers.reverse.clearLayers();
  L.rectangle(
    [
      [b.south, b.west],
      [b.north, b.east],
    ],
    { color: "#E15A2A", weight: 2, fillOpacity: 0.15 }
  )
    .bindPopup(`${b.code}<br>${meshLevelName(b.digits)}`)
    .addTo(layers.reverse);
  L.circleMarker([lat, lng], {
    radius: 5,
    color: "#E15A2A",
    fillColor: "#fff",
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup(t("reverse_input_popup", fmt(lat), fmt(lng)))
    .addTo(layers.reverse);
  if (fit) {
    map.fitBounds(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { padding: [80, 80], maxZoom: 16 }
    );
  }
  reverseResult.innerHTML = `
    <dl>
      <dt>${t("res_input")}</dt><dd>${fmt(lat)}, ${fmt(lng)}</dd>
      <dt>${t("res_code")}</dt><dd><strong>${b.code}</strong></dd>
      <dt>${t("res_level")}</dt><dd>${meshLevelName(b.digits)}</dd>
      <dt>${t("res_mesh_sw")}</dt><dd>${fmt(b.south)}, ${fmt(b.west)}</dd>
      <dt>${t("res_mesh_ne")}</dt><dd>${fmt(b.north)}, ${fmt(b.east)}</dd>
    </dl>
  `;
  reverseResult.hidden = false;
}

reverseForm.addEventListener("submit", (e) => {
  e.preventDefault();
  reverseSubmit();
});

// ============================================================
// Tab 3: 範囲列挙
// ============================================================
const radiusForm = document.getElementById("radius-form");
const radiusResult = document.getElementById("radius-result");
const radiusError = document.getElementById("radius-error");

function radiusSubmit() {
  radiusError.hidden = true;
  radiusResult.hidden = true;
  const lat = parseFloat(document.getElementById("radius-lat").value);
  const lng = parseFloat(document.getElementById("radius-lng").value);
  const km = parseFloat(document.getElementById("radius-km").value);
  const digits = parseInt(document.getElementById("radius-level").value, 10);
  try {
    renderRadius(lat, lng, km, digits, true);
    lastRadius = { lat, lng, km, digits };
  } catch (err) {
    radiusError.textContent = tErr(err);
    radiusError.hidden = false;
  }
}

function renderRadius(lat, lng, km, digits, fit) {
  const list = meshesWithinRadius(lat, lng, km, digits);
  layers.radius.clearLayers();

  L.circle([lat, lng], {
    radius: km * 1000,
    color: "#2AB37D",
    weight: 2,
    fillOpacity: 0.05,
  }).addTo(layers.radius);
  L.circleMarker([lat, lng], {
    radius: 5,
    color: "#2AB37D",
    fillColor: "#fff",
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup(t("radius_center_popup", fmt(lat), fmt(lng), km))
    .addTo(layers.radius);

  list.forEach((m) => {
    L.rectangle(
      [
        [m.south, m.west],
        [m.north, m.east],
      ],
      { color: "#2AB37D", weight: 1, fillOpacity: 0.1 }
    )
      .bindPopup(t("radius_mesh_popup", m.code, m.distance.toFixed(3)))
      .addTo(layers.radius);
  });

  if (fit) {
    const padDeg = km / 100;
    map.fitBounds(
      [
        [lat - padDeg, lng - padDeg],
        [lat + padDeg, lng + padDeg],
      ],
      { padding: [40, 40] }
    );
  }

  const max = 200;
  const preview = list.slice(0, max);
  const more =
    list.length > max
      ? `<p class="hint">${t("radius_more", list.length - max)}</p>`
      : "";
  radiusResult.innerHTML = `
    <p>${t("radius_found_html", list.length)}</p>
    <button type="button" id="radius-csv">${t("radius_csv")}</button>
    <ul class="mesh-list">
      ${preview
        .map(
          (m) =>
            `<li><code>${m.code}</code> <span class="dist">${m.distance.toFixed(3)} km</span></li>`
        )
        .join("")}
    </ul>
    ${more}
  `;
  radiusResult.hidden = false;

  document.getElementById("radius-csv").addEventListener("click", () => {
    const csv =
      "code,center_lat,center_lng,south,west,north,east,distance_km\n" +
      list
        .map(
          (m) =>
            `${m.code},${m.center[0]},${m.center[1]},${m.south},${m.west},${m.north},${m.east},${m.distance}`
        )
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meshes_${digits}_${lat.toFixed(4)}_${lng.toFixed(4)}_${km}km.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

radiusForm.addEventListener("submit", (e) => {
  e.preventDefault();
  radiusSubmit();
});

// ============================================================
// 言語切替
// ============================================================
function setLang(lang) {
  if (lang !== "ja" && lang !== "en") return;
  currentLang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {}
  applyTranslations();
  rerenderResults();
}

function rerenderResults() {
  if (lastForward) {
    try {
      renderForward(parseMeshCode(lastForward), false);
    } catch (e) {
      forwardError.textContent = tErr(e);
      forwardError.hidden = false;
    }
  }
  if (lastReverse) {
    try {
      renderReverse(lastReverse.lat, lastReverse.lng, lastReverse.digits, false);
    } catch (e) {
      reverseError.textContent = tErr(e);
      reverseError.hidden = false;
    }
  }
  if (lastRadius) {
    try {
      renderRadius(
        lastRadius.lat,
        lastRadius.lng,
        lastRadius.km,
        lastRadius.digits,
        false
      );
    } catch (e) {
      radiusError.textContent = tErr(e);
      radiusError.hidden = false;
    }
  }
}

document.getElementById("lang-toggle").addEventListener("click", () => {
  setLang(currentLang === "ja" ? "en" : "ja");
});

// 初期言語: localStorage > navigator.language > ja
try {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === "ja" || saved === "en") {
    currentLang = saved;
  } else if (
    typeof navigator !== "undefined" &&
    navigator.language &&
    !navigator.language.toLowerCase().startsWith("ja")
  ) {
    currentLang = "en";
  }
} catch {}
applyTranslations();

// ============================================================
// URL ?code= で初期表示
// ============================================================
const params = new URL(location.href).searchParams;
const initialCode = params.get("code");
if (initialCode) {
  forwardInput.value = initialCode;
  forwardSubmit();
}
