const TZ = "America/New_York";
const STATION = "8417553";
const PORTLAND = "8418150";
const APP = "BirchIslandTides";
const API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

const $ = (id) => document.getElementById(id);

/** Local calendar YYYYMMDD in America/New_York. */
function fmtYMD(d) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("year")}${g("month")}${g("day")}`;
}

function addDaysYMD(ymd, n) {
  const y = +ymd.slice(0, 4), m = +ymd.slice(4, 6) - 1, d = +ymd.slice(6, 8);
  const dt = new Date(Date.UTC(y, m, d + n));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function ymdToISO(ymd) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function isoToYmd(iso) {
  return iso.replace(/-/g, "");
}

/** NOAA lst_ldt date stamp is already the local calendar day. */
function noaaYmd(t) {
  return t.slice(0, 10).replace(/-/g, "");
}

/**
 * Parse NOAA "YYYY-MM-DD HH:MM" as America/New_York wall time.
 * Used for clocks / interpolation only — day buckets use noaaYmd().
 */
function parseNoaaLocal(t) {
  const [date, time] = t.split(" ");
  const [Y, M, D] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  let guess = Date.UTC(Y, M - 1, D, h + 4, min);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const gotH = Number(parts.hour === "24" ? 0 : parts.hour);
  const gotM = Number(parts.minute);
  const want = h * 60 + min;
  const got = gotH * 60 + gotM;
  guess += (want - got) * 60 * 1000;
  return new Date(guess);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "numeric", minute: "2-digit"
  }).format(date);
}

function formatWeekday(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "long", month: "short", day: "numeric"
  }).format(date);
}

function formatMonthTitle(ymd) {
  const y = +ymd.slice(0, 4), m = +ymd.slice(4, 6) - 1, d = +ymd.slice(6, 8);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "long", year: "numeric"
  }).format(new Date(Date.UTC(y, m, d, 16)));
}

function cosineInterp(a, b, t) {
  const s = (1 - Math.cos(Math.PI * t)) / 2;
  return a + (b - a) * s;
}

function heightAt(ext, when) {
  if (!ext.length) return null;
  if (when <= ext[0].date) return Number(ext[0].v);
  if (when >= ext[ext.length - 1].date) return Number(ext[ext.length - 1].v);
  for (let i = 0; i < ext.length - 1; i++) {
    const a = ext[i], b = ext[i + 1];
    if (when >= a.date && when <= b.date) {
      const t = (when - a.date) / (b.date - a.date);
      return cosineInterp(Number(a.v), Number(b.v), t);
    }
  }
  return null;
}

function normalize(predictions) {
  return (predictions || []).map((p) => ({
    ...p,
    date: parseNoaaLocal(p.t),
    ymd: noaaYmd(p.t),
    v: Number(p.v)
  }));
}

/** Every high/low whose NOAA local timestamp falls on that calendar day. */
function tidesOnDay(ext, ymd) {
  return ext.filter((p) => p.ymd === ymd);
}

function monthBounds(anyYmd) {
  const first = anyYmd.slice(0, 6) + "01";
  const nextFirst = addDaysYMD(first, 32).slice(0, 6) + "01";
  const last = addDaysYMD(nextFirst, -1);
  return { first, last, nextFirst };
}

async function getJSON(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("NOAA request failed");
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data;
    } catch (err) {
      lastErr = err;
      const abortish = err && (err.name === "AbortError" || err.name === "TypeError");
      if (!abortish || attempt === 1) throw err;
    }
  }
  throw lastErr;
}

function hiloUrl(begin, end) {
  return (
    `${API}?product=predictions&application=${APP}` +
    `&begin_date=${begin}&end_date=${end}` +
    `&datum=MLLW&station=${STATION}&time_zone=lst_ldt&units=english&interval=hilo&format=json`
  );
}


/** Jean Meeus, Astronomical Algorithms 2nd ed., ch. 49 (true phases). */
const _DEG = Math.PI / 180;
const _sin = (d) => Math.sin(d * _DEG);
const _cos = (d) => Math.cos(d * _DEG);

function meeusPhaseJDE(k) {
  const T = k / 1236.85;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const Om = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;
  const A = [
    299.77 + 0.107408 * k - 0.009173 * T2, 251.88 + 0.016321 * k, 251.83 + 26.651886 * k,
    349.42 + 36.412478 * k, 84.66 + 18.206239 * k, 141.74 + 53.303371 * k,
    207.14 + 2.453732 * k, 154.84 + 7.306958 * k, 34.52 + 27.261239 * k,
    207.19 + 0.121824 * k, 291.34 + 1.844379 * k, 161.72 + 24.198154 * k,
    239.56 + 25.513099 * k, 331.55 + 3.592518 * k
  ];
  const Ac = [0.000325, 0.000165, 0.000164, 0.000126, 0.000110, 0.000062, 0.000060, 0.000056, 0.000047, 0.000042, 0.000040, 0.000037, 0.000035, 0.000023];
  const p = ((k % 1) + 1) % 1;
  let corr;
  if (p < 0.01) {
    corr = -0.40720 * _sin(Mp) + 0.17241 * E * _sin(M) + 0.01608 * _sin(2 * Mp) + 0.01039 * _sin(2 * F)
      + 0.00739 * E * _sin(Mp - M) - 0.00514 * E * _sin(Mp + M) + 0.00208 * E * E * _sin(2 * M)
      - 0.00111 * _sin(Mp - 2 * F) - 0.00057 * _sin(Mp + 2 * F) + 0.00056 * E * _sin(2 * Mp + M)
      - 0.00042 * _sin(3 * Mp) + 0.00042 * E * _sin(M + 2 * F) + 0.00038 * E * _sin(M - 2 * F)
      - 0.00024 * E * _sin(2 * Mp - M) - 0.00017 * _sin(Om) - 0.00007 * _sin(Mp + 2 * M)
      + 0.00004 * _sin(2 * Mp - 2 * F) + 0.00004 * _sin(3 * M) + 0.00003 * _sin(Mp + M - 2 * F)
      + 0.00003 * _sin(2 * Mp + 2 * F) - 0.00003 * _sin(Mp + M + 2 * F) + 0.00003 * _sin(Mp - M + 2 * F)
      - 0.00002 * _sin(Mp - M - 2 * F) - 0.00002 * _sin(3 * Mp + M) + 0.00002 * _sin(4 * Mp);
  } else if (Math.abs(p - 0.5) < 0.01) {
    corr = -0.40614 * _sin(Mp) + 0.17302 * E * _sin(M) + 0.01614 * _sin(2 * Mp) + 0.01043 * _sin(2 * F)
      + 0.00734 * E * _sin(Mp - M) - 0.00515 * E * _sin(Mp + M) + 0.00209 * E * E * _sin(2 * M)
      - 0.00111 * _sin(Mp - 2 * F) - 0.00057 * _sin(Mp + 2 * F) + 0.00056 * E * _sin(2 * Mp + M)
      - 0.00042 * _sin(3 * Mp) + 0.00042 * E * _sin(M + 2 * F) + 0.00038 * E * _sin(M - 2 * F)
      - 0.00024 * E * _sin(2 * Mp - M) - 0.00017 * _sin(Om) - 0.00007 * _sin(Mp + 2 * M)
      + 0.00004 * _sin(2 * Mp - 2 * F) + 0.00004 * _sin(3 * M) + 0.00003 * _sin(Mp + M - 2 * F)
      + 0.00003 * _sin(2 * Mp + 2 * F) - 0.00003 * _sin(Mp + M + 2 * F) + 0.00003 * _sin(Mp - M + 2 * F)
      - 0.00002 * _sin(Mp - M - 2 * F) - 0.00002 * _sin(3 * Mp + M) + 0.00002 * _sin(4 * Mp);
  } else {
    corr = -0.62801 * _sin(Mp) + 0.17172 * E * _sin(M) - 0.01183 * E * _sin(Mp + M) + 0.00862 * _sin(2 * Mp)
      + 0.00804 * _sin(2 * F) + 0.00454 * E * _sin(Mp - M) + 0.00204 * E * E * _sin(2 * M)
      - 0.00180 * _sin(Mp - 2 * F) - 0.00070 * _sin(Mp + 2 * F) - 0.00040 * _sin(3 * Mp)
      - 0.00034 * E * _sin(2 * Mp - M) + 0.00032 * E * _sin(M + 2 * F) + 0.00032 * E * _sin(M - 2 * F)
      - 0.00028 * E * E * _sin(Mp + 2 * M) + 0.00027 * E * _sin(2 * Mp + M) - 0.00017 * _sin(Om)
      - 0.00005 * _sin(Mp - M - 2 * F) + 0.00004 * _sin(2 * Mp + 2 * F) - 0.00004 * _sin(Mp + M + 2 * F)
      + 0.00004 * _sin(Mp - 2 * M) + 0.00003 * _sin(Mp + M - 2 * F) + 0.00003 * _sin(3 * M)
      + 0.00002 * _sin(2 * Mp - 2 * F) + 0.00002 * _sin(Mp - M + 2 * F) - 0.00002 * _sin(3 * Mp + M);
    const W = 0.00306 - 0.00038 * E * _cos(M) + 0.00026 * _cos(Mp) - 0.00002 * _cos(Mp - M) + 0.00002 * _cos(Mp + M) + 0.00002 * _cos(2 * F);
    corr += Math.abs(p - 0.25) < 0.01 ? W : -W;
  }
  for (let i = 0; i < 14; i++) jde += Ac[i] * _sin(A[i]);
  return jde + corr;
}

/** TT → UTC with ΔT ≈ 69 s (2026). Fine for calendar-day assignment. */
function jdeToDate(jde) {
  return new Date((jde - 2440587.5) * 86400000 - 69000);
}

function dateToJD(d) {
  return d.getTime() / 86400000 + 2440587.5;
}

const PHASE_KIND = { 0: "new", 0.25: "fq", 0.5: "full", 0.75: "lq" };

function principalPhases(firstYmd, lastYmd) {
  const y = +firstYmd.slice(0, 4);
  const mo = +firstYmd.slice(4, 6);
  const kStart = Math.floor((y + (mo - 1) / 12 - 2000) * 12.3685) - 2;
  const map = new Map();
  for (let i = 0; i < 8; i++) {
    for (const frac of [0, 0.25, 0.5, 0.75]) {
      const d = jdeToDate(meeusPhaseJDE(kStart + i + frac));
      const ymd = fmtYMD(d);
      if (ymd < firstYmd || ymd > lastYmd) continue;
      map.set(ymd, { kind: PHASE_KIND[frac], date: d });
    }
  }
  return map;
}

/** Illuminated fraction + waxing at JD. Meeus ch. 48.4 phase angle. */
function moonAtJD(jd) {
  const T = (jd - 2451545.0) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000;
  const i = 180 - D - 6.289 * _sin(Mp) + 2.100 * _sin(M) - 1.274 * _sin(2 * D - Mp)
    - 0.658 * _sin(2 * D) - 0.214 * _sin(2 * Mp) - 0.110 * _sin(D);
  const illum = (1 + Math.cos(i * _DEG)) / 2;
  D = ((D % 360) + 360) % 360;
  return { illum, waxing: D < 180 };
}

function moonTitle(kind, illum, when) {
  if (kind === "new") return `New moon${when ? " " + formatTime(when) : ""} · spring tides`;
  if (kind === "full") return `Full moon${when ? " " + formatTime(when) : ""} · spring tides`;
  if (kind === "fq") return `First quarter${when ? " " + formatTime(when) : ""}`;
  if (kind === "lq") return `Last quarter${when ? " " + formatTime(when) : ""}`;
  return `${Math.round(illum * 100)}% lit`;
}

function moonGlyphHTML(illum, waxing, kind, when) {
  const r = 5, c = 6;
  const lit = "#e8d6a3", dk = "#152830";
  const major = kind === "new" || kind === "full";
  const stroke = major ? "#d9c089" : "rgba(232,240,242,0.28)";
  const sw = major ? 1.2 : 0.55;
  let path = "";
  if (kind === "new" || illum < 0.02) {
    path = "";
  } else if (kind === "full" || illum > 0.98) {
    path = `<circle cx="6" cy="6" r="5" fill="${lit}"/>`;
  } else {
    const lightRight = waxing;
    const outerSweep = lightRight ? 1 : 0;
    const top = `${c},${c - r}`, bot = `${c},${c + r}`;
    if (illum > 0.47 && illum < 0.53) {
      path = `<path d="M${top} A${r},${r} 0 1 ${outerSweep} ${bot} Z" fill="${lit}"/>`;
    } else {
      const rx = Math.abs(2 * illum - 1) * r;
      const termSweep = illum < 0.5 ? outerSweep : 1 - outerSweep;
      path = `<path d="M${top} A${r},${r} 0 1 ${outerSweep} ${bot} A${rx.toFixed(3)},${r} 0 0 ${termSweep} ${top}" fill="${lit}"/>`;
    }
  }
  const title = moonTitle(kind, illum, when);
  return `<svg class="moon-glyph${major ? " is-major" : ""}${kind ? " is-" + kind : ""}" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><title>${title}</title>
    <circle cx="6" cy="6" r="5" fill="${dk}" stroke="${stroke}" stroke-width="${sw}"/>
    ${path}
  </svg>`;
}

const monthCache = new Map();
let viewMonthYmd = null;
let todayYmd = null;

async function fetchHilo(begin, end) {
  const payload = await getJSON(hiloUrl(begin, end));
  return normalize(payload.predictions);
}

function renderTideRows(items) {
  return items.map((p) => (
    `<div class="row">
      <span class="badge ${p.type}">${p.type === "H" ? "HIGH" : "LOW"}</span>
      <span class="when">${formatTime(p.date)}</span>
      <span class="ht">${p.v.toFixed(1)} ft</span>
    </div>`
  )).join("") || `<div class="error">No highs/lows for this day.</div>`;
}

async function load() {
  const now = new Date();
  todayYmd = fmtYMD(now);
  // Month card is independent of the week/today fetch so a first-load
  // SW claim or a failed 7-day request cannot leave title stuck at "Month".
  viewMonthYmd = todayYmd.slice(0, 6) + "01";
  const monthReady = renderMonth(viewMonthYmd);
  // Pad previous evening through next morning (+ week for the list).
  const start = addDaysYMD(todayYmd, -1);
  const end = addDaysYMD(todayYmd, 8);
  let offline = false;
  let ext;
  try {
    ext = await fetchHilo(start, end);
  } catch (err) {
    $("state").textContent = "Unavailable";
    $("todayList").innerHTML = `<div class="error">${err.message}</div>`;
    await monthReady;
    return;
  }
  if (!navigator.onLine) offline = true;

  $("todayLabel").textContent = formatWeekday(now);

  const upcoming = ext.filter((p) => p.date > now);
  const nextH = upcoming.find((p) => p.type === "H");
  const nextL = upcoming.find((p) => p.type === "L");
  if (nextH) {
    $("nextHigh").textContent = formatTime(nextH.date);
    $("nextHighH").textContent = `${nextH.v.toFixed(1)} ft`;
  }
  if (nextL) {
    $("nextLow").textContent = formatTime(nextL.date);
    $("nextLowH").textContent = `${nextL.v.toFixed(1)} ft`;
  }

  const prev = [...ext].reverse().find((p) => p.date <= now);
  const next = upcoming[0];
  let rising = true;
  if (prev && next) rising = next.v > prev.v;
  else if (next) rising = next.type === "H";
  const stateEl = $("state");
  stateEl.textContent = rising ? "Rising" : "Falling";
  stateEl.className = "status-word " + (rising ? "rising" : "falling");

  const est = heightAt(ext, now);
  if (est != null) $("nowHt").textContent = `${est.toFixed(1)} ft`;

  getJSON(
    `${API}?product=water_level&application=${APP}&date=latest&datum=MLLW` +
    `&station=${PORTLAND}&time_zone=lst_ldt&units=english&format=json`
  ).then((obs) => {
    if (obs.data && obs.data[0]) {
      $("nowHt").title = `Portland observed ${Number(obs.data[0].v).toFixed(2)} ft at ${obs.data[0].t}`;
    }
  }).catch(() => { /* observed optional — must not block month */ });

  const todayExt = tidesOnDay(ext, todayYmd);
  $("todayList").innerHTML = renderTideRows(todayExt);

  drawChart(ext, now);

  const byDay = new Map();
  for (const p of ext) {
    if (p.ymd < todayYmd) continue;
    if (!byDay.has(p.ymd)) byDay.set(p.ymd, []);
    byDay.get(p.ymd).push(p);
  }
  const days = [...byDay.entries()].slice(0, 7);
  $("weekList").innerHTML = days.map(([, items]) => {
    const label = formatWeekday(items[0].date);
    return `<div class="week-day"><h3>${label}</h3>${renderTideRows(items)}</div>`;
  }).join("");

  if (offline) $("offline").classList.add("show");

  await monthReady;
}

function drawChart(ext, now) {
  const svg = $("chart");
  const W = 360, H = 168, padL = 8, padR = 8, padT = 16, padB = 22;
  const start = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const samples = [];
  const step = 10 * 60 * 1000;
  for (let t = start.getTime(); t <= end.getTime(); t += step) {
    const d = new Date(t);
    const v = heightAt(ext, d);
    if (v != null) samples.push({ d, v });
  }
  if (samples.length < 2) return;
  const vmin = Math.min(...samples.map((s) => s.v));
  const vmax = Math.max(...samples.map((s) => s.v));
  const x = (d) => padL + ((d - start) / (end - start)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - vmin) / (vmax - vmin || 1)) * (H - padT - padB);

  const pts = samples.map((s) => `${x(s.d).toFixed(1)},${y(s.v).toFixed(1)}`).join(" ");
  const area = `${x(samples[0].d)},${H - padB} ${pts} ${x(samples[samples.length - 1].d)},${H - padB}`;
  const nowV = heightAt(ext, now);

  const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric" });
  let labels = "";
  const seen = new Set();
  for (const s of samples) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: false
    }).formatToParts(s.d);
    const hour = Number(parts.find((p) => p.type === "hour").value);
    const min = Number(parts.find((p) => p.type === "minute").value);
    if (min === 0 && hour % 6 === 0 && !seen.has(hour)) {
      seen.add(hour);
      labels += `<text x="${x(s.d).toFixed(1)}" y="${H - 6}" fill="#9bb3b8" font-size="10" text-anchor="middle">${hourFmt.format(s.d)}</text>`;
    }
  }

  const marks = ext
    .filter((p) => p.date >= start && p.date <= end)
    .map((p) => {
      const fill = p.type === "H" ? "#7ec8c0" : "#e08a6a";
      return `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.2" fill="${fill}"/>`;
    })
    .join("");

  svg.innerHTML = `
    <defs>
      <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7ec8c0" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#7ec8c0" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <polygon points="${area}" fill="url(#fill)"/>
    <polyline points="${pts}" fill="none" stroke="#7ec8c0" stroke-width="2.4" stroke-linejoin="round"/>
    ${marks}
    ${nowV != null ? `<circle class="now-dot" cx="${x(now).toFixed(1)}" cy="${y(nowV).toFixed(1)}" r="5"/>` : ""}
    ${labels}
  `;
}

async function renderMonth(firstYmd) {
  const { first, last } = monthBounds(firstYmd);
  $("monthTitle").textContent = formatMonthTitle(first);
  $("monthList").innerHTML = `<div class="muted-line">Loading NOAA highs/lows…</div>`;

  const begin = addDaysYMD(first, -1);
  const end = addDaysYMD(last, 1);
  const key = `${begin}-${end}`;
  let ext;
  try {
    if (!monthCache.has(key)) {
      monthCache.set(key, fetchHilo(begin, end));
    }
    ext = await monthCache.get(key);
  } catch (err) {
    monthCache.delete(key);
    $("monthList").innerHTML = `<div class="error">${err.message}</div>`;
    return;
  }

  const byDay = new Map();
  for (let ymd = first; ymd <= last; ymd = addDaysYMD(ymd, 1)) {
    byDay.set(ymd, tidesOnDay(ext, ymd));
  }

  let scaleMin = Infinity, scaleMax = -Infinity;
  const rows = [];
  for (const [ymd, items] of byDay) {
    if (!items.length) continue;
    const vs = items.map((p) => p.v);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    scaleMin = Math.min(scaleMin, lo);
    scaleMax = Math.max(scaleMax, hi);
    rows.push({ ymd, items, lo, hi, range: hi - lo });
  }
  if (!rows.length) {
    $("monthList").innerHTML = `<div class="error">No predictions for this month.</div>`;
    $("monthScale").innerHTML = "";
    return;
  }

  const span = (scaleMax - scaleMin) || 1;
  const pct = (v) => ((v - scaleMin) / span) * 100;

  $("monthScale").innerHTML =
    `<span>${scaleMin.toFixed(1)}</span><span>ft MLLW</span><span>${scaleMax.toFixed(1)}</span>`;

  const wdFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });
  const majors = principalPhases(first, last);

  $("monthList").innerHTML = rows.map((r) => {
    const left = pct(r.lo);
    const width = Math.max(pct(r.hi) - pct(r.lo), 1.2);
    const isToday = r.ymd === todayYmd;
    const dayNum = +r.ymd.slice(6, 8);
    const y = +r.ymd.slice(0, 4), mo = +r.ymd.slice(4, 6) - 1, d = +r.ymd.slice(6, 8);
    const wd = wdFmt.format(new Date(Date.UTC(y, mo, d, 16)));
    const noon = parseNoaaLocal(`${ymdToISO(r.ymd)} 12:00`);
    const daily = moonAtJD(dateToJD(noon));
    const major = majors.get(r.ymd);
    const kind = major ? major.kind : null;
    const spring = kind === "new" || kind === "full";
    const glyph = moonGlyphHTML(daily.illum, daily.waxing, kind, major && major.date);
    const ticks = r.items.map((p) => {
      const x = pct(p.v);
      const cls = p.type === "H" ? "tick-h" : "tick-l";
      return `<span class="tick ${cls}" style="left:${x.toFixed(2)}%" title="${p.type === "H" ? "High" : "Low"} ${formatTime(p.date)} ${p.v.toFixed(1)} ft"></span>`;
    }).join("");
    return `<div class="horizon-row${isToday ? " is-today" : ""}${spring ? " is-spring" : ""}">
      <div class="horizon-day"><span class="wd">${wd}</span><span class="dn">${dayNum}</span></div>
      <div class="horizon-moon">${glyph}</div>
      <div class="horizon-track">
        <div class="horizon-bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></div>
        ${ticks}
      </div>
      <div class="horizon-rng">${r.range.toFixed(1)}</div>
    </div>`;
  }).join("");
}

$("prevMonth").addEventListener("click", () => {
  const { first } = monthBounds(viewMonthYmd);
  viewMonthYmd = addDaysYMD(first, -1).slice(0, 6) + "01";
  renderMonth(viewMonthYmd);
});
$("nextMonth").addEventListener("click", () => {
  const { nextFirst } = monthBounds(viewMonthYmd);
  viewMonthYmd = nextFirst;
  renderMonth(viewMonthYmd);
});

load().finally(() => {
  // Register after first paint so install/claim cannot abort the initial NOAA fetches.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
});
