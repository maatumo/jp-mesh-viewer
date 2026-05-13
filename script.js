"use strict";

// 標準地域メッシュコード (JIS X 0410) ↔ 緯度経度

const MESH_LEVELS = {
  4: "1次メッシュ (約80km)",
  6: "2次メッシュ (約10km)",
  8: "3次メッシュ (約1km)",
  9: "1/2地域メッシュ (約500m)",
  10: "1/4地域メッシュ (約250m)",
  11: "1/8地域メッシュ (約125m)",
};

const MESH_SPANS = {
  4: { lat: 2 / 3, lng: 1 },
  6: { lat: 1 / 12, lng: 1 / 8 },
  8: { lat: 1 / 120, lng: 1 / 80 },
  9: { lat: 1 / 240, lng: 1 / 160 },
  10: { lat: 1 / 480, lng: 1 / 320 },
  11: { lat: 1 / 960, lng: 1 / 640 },
};

// ---- メッシュコード → bounds ----
function parseMeshCode(raw) {
  const code = String(raw).replace(/\s|-/g, "");
  if (!/^\d+$/.test(code)) {
    throw new Error("数字のみ入力してください");
  }
  const level = MESH_LEVELS[code.length];
  if (!level) {
    throw new Error("メッシュコードは 4/6/8/9/10/11 桁で入力してください");
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
      throw new Error("2次メッシュの 5,6 桁目は 0-7 です");
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
      throw new Error("分割メッシュの桁は 1-4 です (1:SW 2:SE 3:NW 4:NE)");
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
    level,
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
  if (!MESH_LEVELS[digits]) {
    throw new Error("レベルは 4/6/8/9/10/11 のいずれかです");
  }
  if (!isFinite(lat) || !isFinite(lng)) {
    throw new Error("有効な緯度経度を入力してください");
  }
  // 1次メッシュの定義域は概ね 0..66.66°N, 100..180°E
  if (lat < 0 || lat >= 67 || lng < 100 || lng >= 180) {
    throw new Error("座標が標準地域メッシュの範囲外です (緯度 0〜67, 経度 100〜180)");
  }

  // 1次
  const ab = Math.floor(lat * 1.5);
  const cd = Math.floor(lng) - 100;
  let code = String(ab).padStart(2, "0") + String(cd).padStart(2, "0");
  const lat1Origin = (ab * 2) / 3;
  const lng1Origin = 100 + cd;
  if (digits === 4) return code;

  // 2次
  const e = Math.floor((lat - lat1Origin) / (1 / 12));
  const f = Math.floor((lng - lng1Origin) / (1 / 8));
  code += String(e) + String(f);
  const lat2Origin = lat1Origin + e / 12;
  const lng2Origin = lng1Origin + f / 8;
  if (digits === 6) return code;

  // 3次
  const g = Math.floor((lat - lat2Origin) / (1 / 120));
  const h = Math.floor((lng - lng2Origin) / (1 / 80));
  code += String(g) + String(h);
  let latOrigin = lat2Origin + g / 120;
  let lngOrigin = lng2Origin + h / 80;
  let latSpan = 1 / 120;
  let lngSpan = 1 / 80;
  if (digits === 8) return code;

  // 1/2, 1/4, 1/8 の象限細分
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
// 「メッシュ中心が円内」を内包条件とする
function meshesWithinRadius(lat, lng, km, digits) {
  if (!MESH_SPANS[digits]) throw new Error("レベルが不正です");
  if (!(km > 0)) throw new Error("半径は 0 より大きい値を指定してください");

  // bbox 推定
  const latDeg = km / 110.574;
  const lngDeg = km / (111.320 * Math.cos((lat * Math.PI) / 180) + 1e-9);
  const minLat = lat - latDeg;
  const maxLat = lat + latDeg;
  const minLng = lng - lngDeg;
  const maxLng = lng + lngDeg;

  // 範囲外チェック
  if (minLat < 0 || maxLat >= 67 || minLng < 100 || maxLng >= 180) {
    throw new Error("半径が大きすぎてメッシュ定義域外を含みます");
  }

  const span = MESH_SPANS[digits];

  // SW/NE のメッシュ bounds を取得し、その間を走査
  const swBounds = parseMeshCode(coordsToMesh(minLat, minLng, digits));
  const neBounds = parseMeshCode(coordsToMesh(maxLat, maxLng, digits));

  const rows = Math.round((neBounds.north - swBounds.south) / span.lat);
  const cols = Math.round((neBounds.east - swBounds.west) / span.lng);
  const candidateCount = rows * cols;

  const MAX_CANDIDATES = 50000;
  if (candidateCount > MAX_CANDIDATES) {
    throw new Error(
      `候補メッシュが多すぎます (${candidateCount.toLocaleString()} 個)。半径かレベルを調整してください`
    );
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
// UI
// ============================================================

const map = L.map("map", { zoomSnap: 0.25 }).setView([36.0, 138.0], 5);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// レイヤーグループ (タブごと)
const layers = {
  forward: L.layerGroup().addTo(map), // メッシュ→地図
  reverse: L.layerGroup().addTo(map), // 座標→メッシュ
  radius: L.layerGroup().addTo(map), // 範囲列挙
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
let pickTarget = null; // { latInput, lngInput } or null
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
  btn.textContent = "地図をクリック…";
  document.getElementById("map").style.cursor = "crosshair";
}
function endPick() {
  if (pickTarget) {
    pickTarget.btn.classList.remove("picking");
    pickTarget.btn.textContent = pickTarget.btn.dataset.label;
    pickTarget = null;
  }
  document.getElementById("map").style.cursor = "";
}

document.querySelectorAll(".pick-btn").forEach((btn) => {
  btn.dataset.label = btn.textContent;
  btn.addEventListener("click", () => {
    const latInput = document.getElementById(btn.dataset.lat);
    const lngInput = document.getElementById(btn.dataset.lng);
    if (pickTarget && pickTarget.btn === btn) endPick();
    else startPick(latInput, lngInput, btn);
  });
});

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
    forwardError.textContent = "メッシュコードを入力してください";
    forwardError.hidden = false;
    return;
  }
  try {
    const b = parseMeshCode(v);
    layers.forward.clearLayers();
    L.rectangle(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { color: "#2A7DE1", weight: 2, fillOpacity: 0.15 }
    )
      .bindPopup(`${b.code}<br>${b.level}`)
      .addTo(layers.forward);
    map.fitBounds(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { padding: [40, 40], maxZoom: 16 }
    );

    forwardResult.innerHTML = `
      <dl>
        <dt>コード</dt><dd>${b.code}</dd>
        <dt>区分</dt><dd>${b.level}</dd>
        <dt>南西</dt><dd>${fmt(b.south)}, ${fmt(b.west)}</dd>
        <dt>北東</dt><dd>${fmt(b.north)}, ${fmt(b.east)}</dd>
        <dt>中心</dt><dd>${fmt(b.center[0])}, ${fmt(b.center[1])}</dd>
        <dt>幅</dt><dd>緯度 ${fmt(b.latSpan)}° / 経度 ${fmt(b.lngSpan)}°</dd>
      </dl>
    `;
    forwardResult.hidden = false;
  } catch (e) {
    forwardError.textContent = e.message;
    forwardError.hidden = false;
  }
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

reverseForm.addEventListener("submit", (e) => {
  e.preventDefault();
  reverseError.hidden = true;
  reverseResult.hidden = true;
  const lat = parseFloat(document.getElementById("reverse-lat").value);
  const lng = parseFloat(document.getElementById("reverse-lng").value);
  const digits = parseInt(document.getElementById("reverse-level").value, 10);
  try {
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
      .bindPopup(`${b.code}<br>${b.level}`)
      .addTo(layers.reverse);
    L.circleMarker([lat, lng], {
      radius: 5,
      color: "#E15A2A",
      fillColor: "#fff",
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(`入力点<br>${fmt(lat)}, ${fmt(lng)}`)
      .addTo(layers.reverse);
    map.fitBounds(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { padding: [80, 80], maxZoom: 16 }
    );

    reverseResult.innerHTML = `
      <dl>
        <dt>入力</dt><dd>${fmt(lat)}, ${fmt(lng)}</dd>
        <dt>コード</dt><dd><strong>${b.code}</strong></dd>
        <dt>区分</dt><dd>${b.level}</dd>
        <dt>メッシュ南西</dt><dd>${fmt(b.south)}, ${fmt(b.west)}</dd>
        <dt>メッシュ北東</dt><dd>${fmt(b.north)}, ${fmt(b.east)}</dd>
      </dl>
    `;
    reverseResult.hidden = false;
  } catch (err) {
    reverseError.textContent = err.message;
    reverseError.hidden = false;
  }
});

// ============================================================
// Tab 3: 範囲列挙
// ============================================================
const radiusForm = document.getElementById("radius-form");
const radiusResult = document.getElementById("radius-result");
const radiusError = document.getElementById("radius-error");

radiusForm.addEventListener("submit", (e) => {
  e.preventDefault();
  radiusError.hidden = true;
  radiusResult.hidden = true;
  const lat = parseFloat(document.getElementById("radius-lat").value);
  const lng = parseFloat(document.getElementById("radius-lng").value);
  const km = parseFloat(document.getElementById("radius-km").value);
  const digits = parseInt(document.getElementById("radius-level").value, 10);
  try {
    const list = meshesWithinRadius(lat, lng, km, digits);
    layers.radius.clearLayers();

    // 円
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
      .bindPopup(`中心<br>${fmt(lat)}, ${fmt(lng)}<br>半径 ${km} km`)
      .addTo(layers.radius);

    // メッシュ矩形
    list.forEach((m) => {
      L.rectangle(
        [
          [m.south, m.west],
          [m.north, m.east],
        ],
        {
          color: "#2AB37D",
          weight: 1,
          fillOpacity: 0.1,
        }
      )
        .bindPopup(
          `${m.code}<br>中心からの距離: ${m.distance.toFixed(3)} km`
        )
        .addTo(layers.radius);
    });

    // fit
    const padDeg = km / 100;
    map.fitBounds(
      [
        [lat - padDeg, lng - padDeg],
        [lat + padDeg, lng + padDeg],
      ],
      { padding: [40, 40] }
    );

    // 結果表示
    const max = 200;
    const preview = list.slice(0, max);
    const more = list.length > max ? `<p class="hint">…他 ${list.length - max} 件 (CSV ダウンロードで全件取得可)</p>` : "";
    radiusResult.innerHTML = `
      <p><strong>${list.length}</strong> 件のメッシュを発見</p>
      <button type="button" id="radius-csv">CSV ダウンロード</button>
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
  } catch (err) {
    radiusError.textContent = err.message;
    radiusError.hidden = false;
  }
});

// ============================================================
// URL ?code= で初期表示
// ============================================================
const params = new URL(location.href).searchParams;
const initialCode = params.get("code");
if (initialCode) {
  forwardInput.value = initialCode;
  forwardSubmit();
}
