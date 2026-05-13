"use strict";

// 標準地域メッシュコード → 緯度経度 bounding box
//
// 桁数別の階層:
//   4桁: 1次メッシュ (約80km四方)   緯度幅 2/3°, 経度幅 1°
//   6桁: 2次メッシュ (約10km四方)   1次を 8x8 に分割
//   8桁: 3次メッシュ (約 1km四方)   2次を 10x10 に分割
//   9桁: 1/2地域メッシュ (約500m)   3次を 2x2 に分割 (1=SW, 2=SE, 3=NW, 4=NE)
//  10桁: 1/4地域メッシュ (約250m)   1/2 をさらに 2x2 に分割
//  11桁: 1/8地域メッシュ (約125m)   1/4 をさらに 2x2 に分割

const MESH_LEVELS = {
  4: "1次メッシュ (約80km)",
  6: "2次メッシュ (約10km)",
  8: "3次メッシュ (約1km)",
  9: "1/2地域メッシュ (約500m)",
  10: "1/4地域メッシュ (約250m)",
  11: "1/8地域メッシュ (約125m)",
};

function parseMeshCode(raw) {
  const code = String(raw).replace(/\s|-/g, "");
  if (!/^\d+$/.test(code)) {
    throw new Error("数字のみ入力してください");
  }
  const level = MESH_LEVELS[code.length];
  if (!level) {
    throw new Error("メッシュコードは 4/6/8/9/10/11 桁で入力してください");
  }

  // 1次メッシュ (4桁): AB CD
  const ab = parseInt(code.slice(0, 2), 10);
  const cd = parseInt(code.slice(2, 4), 10);
  let south = (ab * 2) / 3;
  let west = 100 + cd;
  let latSpan = 2 / 3;
  let lngSpan = 1;

  // 2次メッシュ (6桁)
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

  // 3次メッシュ (8桁)
  if (code.length >= 8) {
    const g = parseInt(code[6], 10);
    const h = parseInt(code[7], 10);
    latSpan = latSpan / 10;
    lngSpan = lngSpan / 10;
    south += g * latSpan;
    west += h * lngSpan;
  }

  // 1/2 (9桁) / 1/4 (10桁) / 1/8 (11桁) の象限
  // 1=SW, 2=SE, 3=NW, 4=NE
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

// ---- UI ----
const input = document.getElementById("mesh-input");
const form = document.getElementById("mesh-form");
const info = document.getElementById("info");
const errorBox = document.getElementById("error");

const map = L.map("map", { zoomSnap: 0.25 }).setView([36.0, 138.0], 5);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

let currentRect = null;

function fmt(n) {
  return Number(n).toFixed(6);
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
  info.hidden = true;
  if (currentRect) {
    map.removeLayer(currentRect);
    currentRect = null;
  }
}

function showResult(b) {
  errorBox.hidden = true;
  info.hidden = false;
  info.innerHTML = `
    <dl>
      <dt>コード</dt><dd>${b.code}</dd>
      <dt>区分</dt><dd>${b.level}</dd>
      <dt>南西</dt><dd>${fmt(b.south)}, ${fmt(b.west)}</dd>
      <dt>北東</dt><dd>${fmt(b.north)}, ${fmt(b.east)}</dd>
      <dt>中心</dt><dd>${fmt(b.center[0])}, ${fmt(b.center[1])}</dd>
      <dt>幅</dt><dd>緯度 ${fmt(b.latSpan)}° / 経度 ${fmt(b.lngSpan)}°</dd>
    </dl>
  `;

  const bounds = [
    [b.south, b.west],
    [b.north, b.east],
  ];
  if (currentRect) map.removeLayer(currentRect);
  currentRect = L.rectangle(bounds, {
    color: "#2A7DE1",
    weight: 2,
    fillOpacity: 0.15,
  })
    .bindPopup(`${b.code}<br>${b.level}`)
    .addTo(map);
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
}

function handle() {
  const v = input.value.trim();
  if (!v) {
    showError("メッシュコードを入力してください");
    return;
  }
  try {
    showResult(parseMeshCode(v));
  } catch (e) {
    showError(e.message);
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  handle();
});

// URL ?code=... で初期表示できるように
const url = new URL(location.href);
const initial = url.searchParams.get("code");
if (initial) {
  input.value = initial;
  handle();
}
