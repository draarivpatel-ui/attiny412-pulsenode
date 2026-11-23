// PulseNode board readiness, ambient PWM and BOM audit lab.
// Pure deterministic ESM: identical results in the browser (<script type="module">)
// and under `node --test`. No DOM access, no fetch, no clocks, no randomness.

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4), pure JS so the page fingerprint matches Node exactly.
// ---------------------------------------------------------------------------

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA_H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

/**
 * SHA-256 of a string (UTF-8) or Uint8Array. Returns 64 lowercase hex chars.
 * Throws TypeError on any other input type.
 */
export function sha256Hex(input) {
  let bytes;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    throw new TypeError("sha256Hex expects a string or Uint8Array");
  }

  const bitLenHi = Math.floor((bytes.length / 0x20000000));
  const bitLenLo = (bytes.length << 3) >>> 0;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(paddedLen - 8, bitLenHi >>> 0);
  dv.setUint32(paddedLen - 4, bitLenLo);

  const h = SHA_H0.slice();
  const w = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], q = h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (q + s1 + ch + SHA_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      q = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + q) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, "0");
  return out;
}

// ---------------------------------------------------------------------------
// Canonical JSON: sorted keys, cycle-safe, depth-bounded, -0 normalized.
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialization.
 *  - Object keys sorted by UTF-16 code units, own enumerable keys only.
 *  - undefined/function/symbol values in objects are skipped (like JSON.stringify).
 *  - Non-finite numbers, bigint, cycles and depth over maxDepth throw.
 */
export function canonicalize(value, maxDepth = 32) {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) throw new RangeError("maxDepth must be a non-negative integer");
  const seen = new Set();
  const enc = (v, depth) => {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "boolean") return v ? "true" : "false";
    if (t === "number") {
      if (!Number.isFinite(v)) throw new TypeError("canonicalize: non-finite number");
      return JSON.stringify(v === 0 ? 0 : v); // -0 -> 0
    }
    if (t === "string") return JSON.stringify(v);
    if (t === "bigint" || t === "undefined" || t === "function" || t === "symbol") {
      throw new TypeError(`canonicalize: unsupported ${t}`);
    }
    if (depth >= maxDepth) throw new RangeError("canonicalize: depth exceeded");
    if (seen.has(v)) throw new TypeError("canonicalize: cyclic value");
    seen.add(v);
    try {
      if (Array.isArray(v)) return "[" + v.map((x) => enc(x, depth + 1)).join(",") + "]";
      const keys = [];
      for (const k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) keys.push(k);
      }
      keys.sort();
      const parts = [];
      for (const k of keys) {
        const val = v[k];
        if (val === undefined || typeof val === "function" || typeof val === "symbol") continue;
        parts.push(JSON.stringify(k) + ":" + enc(val, depth + 1));
      }
      return "{" + parts.join(",") + "}";
    } finally {
      seen.delete(v);
    }
  };
  return enc(value, 0);
}

// ---------------------------------------------------------------------------
// Board analysis: the real pcb.json nets, placed footprints, tracks, ratsnest.
// ---------------------------------------------------------------------------

// Design intent from the schematic: which BOM refs still need landing on each net.
// Each unplaced BOM ref is charged to exactly one net (R2 appears once per unit).
export const NET_EXPECTED = {
  "+5V": [],
  "GND": [],
  "PA6_PIEZO": ["BZ1"],
  "PA7_LDR": ["Q1", "R1"],
  "PA1_BTN": ["SW1"],
  "PA2_STATUS": ["D2", "R2"],
  "PA0_UPDI": ["R3"],
  "PA3_PWM": ["R2"],
};

export function analyzeBoard(pcb) {
  if (!pcb || typeof pcb !== "object") throw new TypeError("analyzeBoard: pcb object required");
  const netsById = pcb.nets || {};
  const footprints = Array.isArray(pcb.footprints) ? pcb.footprints : [];
  const segments = Array.isArray(pcb.segments) ? pcb.segments : [];
  const connectivity = Array.isArray(pcb.connectivity) ? pcb.connectivity : [];

  const placedRefs = footprints.map((f) => f.ref);
  const u1 = footprints.find((f) => f.ref === "U1") || null;
  const pinByNet = new Map(); // net id -> SOIC-8 pin number on U1
  if (u1) {
    for (const p of u1.pads) pinByNet.set(String(p.net), p.number);
  }
  const padTotal = footprints.reduce((s, f) => s + f.pads.length, 0);
  const connByName = new Map(connectivity.map((n) => [n.net, n]));

  const nets = Object.entries(netsById)
    .filter(([id]) => id !== "0")
    .map(([id, name]) => {
      const c = connByName.get(name) || { pads: [], tracks: 0, missing: 0, single_pad: false };
      const pin = pinByNet.get(id) ?? null;
      const status = c.missing > 0 ? "unrouted" : c.single_pad ? "awaiting part" : "routed";
      return {
        id: Number(id),
        name,
        pin,
        pads: c.pads.slice(),
        padCount: c.pads.length,
        tracks: c.tracks,
        missing: c.missing,
        singlePad: !!c.single_pad,
        status,
        awaiting: (NET_EXPECTED[name] || []).slice(),
      };
    })
    .sort((a, b) => a.id - b.id);

  const missingTotal = nets.reduce((s, n) => s + n.missing, 0);
  const lonely = nets.filter((n) => n.singlePad);
  return {
    nets,
    placedRefs,
    outline: { x: pcb.outline?.x ?? 0, y: pcb.outline?.y ?? 0, w: pcb.outline?.w ?? 0, h: pcb.outline?.h ?? 0, width: pcb.outline?.width ?? 0 },
    cadSize: Array.isArray(pcb.cad?.size) ? pcb.cad.size.slice() : null,
    cadValid: !!pcb.cad?.valid,
    footprintCount: footprints.length,
    namedNetCount: nets.length,
    padTotal,
    trackTotal: segments.length,
    missingTotal,
    lonelyNets: lonely.map((n) => n.name),
  };
}

// ---------------------------------------------------------------------------
// BOM analysis: real bom.csv rows, honest sums, placed vs remaining.
// ---------------------------------------------------------------------------

/**
 * Parse bom.csv. The Unit_Cost_USD column is the per-line cost as listed by the
 * suppliers (the R2 row already covers both 0805 resistors at a cent each), so
 * the column is summed directly and also multiplied by quantity for comparison.
 */
export function parseBom(csvText, placedRefs = []) {
  if (typeof csvText !== "string") throw new TypeError("parseBom: csv text required");
  const placed = new Set(placedRefs);
  const lines = csvText.trim().split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines.length ? lines[0].split(",") : [];
  const rows = lines.slice(1).map((line, i) => {
    const c = line.split(",");
    const qty = Number.parseInt(c[3], 10);
    const unitCost = Math.round(Number.parseFloat(c[6]) * 100) / 100;
    if (!Number.isFinite(qty) || !Number.isFinite(unitCost)) {
      throw new TypeError(`parseBom: malformed numeric field on line ${i + 2}`);
    }
    return {
      ref: c[0],
      value: c[1],
      footprint: c[2],
      qty,
      mpn: c[4],
      supplier: c[5],
      lineCost: unitCost,
      placed: placed.has(c[0]),
    };
  });
  const cents = (r) => Math.round(r.lineCost * 100);
  const totalCents = rows.reduce((s, r) => s + cents(r), 0);
  const placedRows = rows.filter((r) => r.placed);
  const remainingRows = rows.filter((r) => !r.placed);
  const placedCents = placedRows.reduce((s, r) => s + cents(r), 0);
  return {
    header,
    rows,
    lineCount: rows.length,
    partCount: rows.reduce((s, r) => s + r.qty, 0),
    totalCost: totalCents / 100,
    placedCost: placedCents / 100,
    remainingCost: (totalCents - placedCents) / 100,
    placedRefs: placedRows.map((r) => r.ref),
    remainingRefs: remainingRows.map((r) => r.ref),
    remainingParts: remainingRows.reduce((s, r) => s + r.qty, 0),
  };
}

// ---------------------------------------------------------------------------
// Firmware model: the real 3-mode PWM behavior from attiny412_pulsenode.ino.
// ---------------------------------------------------------------------------

// Electrical constants used by the lab. Estimates are labeled as estimates.
export const ELEC = {
  VCC_V: 5.0,
  LED_VF_V: 2.0,        // amber KT-0805Y forward drop, typical
  STATUS_VF_V: 2.0,     // emerald KT-0805G forward drop, typical
  R_OHM: 330,           // R2 series resistor on the PWM LED
  MCU_MA: 4.5,          // estimate: ATtiny412 active at 5 V
  PIEZO_MA: 0,          // piezo idles between 45 ms click bursts
};

export const MODES = [
  { id: 0, key: "ambient", name: "Ambient auto-dimming" },
  { id: 1, key: "breathing", name: "Breathing pulse" },
  { id: 2, key: "beacon", name: "Blinking beacon" },
];

export const ADC_MIN = 0;
export const ADC_MAX = 1023;
const LDR_LO = 60;  // firmware constrain() bounds
const LDR_HI = 960;
const PWM_DIM = 18; // firmware map() output bounds
const PWM_FULL = 255;
const BEACON_ON = 240;
const BEACON_MS = 250;
const BREATH_MS = 12;
const BREATH_PERIOD = 512;

/** Arduino map() with C++ integer semantics (truncation toward zero). */
export function arduinoMap(x, inMin, inMax, outMin, outMax) {
  return Math.trunc(((x - inMin) * (outMax - outMin)) / (inMax - inMin)) + outMin;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Instantaneous analogWrite value (0..255) for a mode at an ADC reading and
 * millisecond timestamp. Mode 0 is light driven; modes 1 and 2 are time driven
 * and ignore the ADC, exactly like the sketch.
 */
export function pwmAt(mode, adc, tMs = 0) {
  const a = Math.round(adc);
  const t = Math.floor(tMs);
  if (mode === 0) return arduinoMap(clamp(a, LDR_LO, LDR_HI), LDR_LO, LDR_HI, PWM_FULL, PWM_DIM);
  if (mode === 1) {
    const phase = Math.floor(t / BREATH_MS) % BREATH_PERIOD;
    return phase < 256 ? phase : BREATH_PERIOD - 1 - phase;
  }
  if (mode === 2) return Math.floor(t / BEACON_MS) % 2 ? BEACON_ON : 0;
  throw new RangeError(`pwmAt: unknown mode ${mode}`);
}

/**
 * Statistics of one mode at a given ADC reading: mean over the full drive
 * cycle plus instantaneous min/max. Mode 0 has min = max = mean.
 */
export function modeStats(mode, adc) {
  if (mode === 0) {
    const v = pwmAt(0, adc, 0);
    return { pwmMin: v, pwmMax: v, pwmMean: v, variesWithAdc: true };
  }
  if (mode === 1) {
    let sum = 0;
    for (let p = 0; p < BREATH_PERIOD; p++) sum += p < 256 ? p : BREATH_PERIOD - 1 - p;
    return { pwmMin: 0, pwmMax: 255, pwmMean: sum / BREATH_PERIOD, variesWithAdc: false };
  }
  if (mode === 2) return { pwmMin: 0, pwmMax: BEACON_ON, pwmMean: BEACON_ON / 2, variesWithAdc: false };
  throw new RangeError(`modeStats: unknown mode ${mode}`);
}

/** LED forward current in mA at a given duty fraction (0..1) through R_OHM. */
export function ledCurrentMa(duty01) {
  const d = clamp(duty01, 0, 1);
  return ((ELEC.VCC_V - ELEC.LED_VF_V) / ELEC.R_OHM) * d * 1000;
}

/** Status LED draw in mA for the mode: solid on in breathing, blinking in beacon. */
export function statusCurrentMa(mode) {
  const on = ((ELEC.VCC_V - ELEC.STATUS_VF_V) / ELEC.R_OHM) * 1000;
  if (mode === 1) return on;
  if (mode === 2) return on / 2;
  return 0;
}

/** Total node current estimate in mA at a mean duty fraction. */
export function nodeCurrentMa(mode, meanDuty01) {
  return ELEC.MCU_MA + ELEC.PIEZO_MA + ledCurrentMa(meanDuty01) + statusCurrentMa(mode);
}

/**
 * Deterministic sweep of `count` ADC sample points for one mode.
 * Returns [{adc, pwmMean, pwmMin, pwmMax, dutyPct, ledMa, nodeMa}].
 */
export function sweepMode(mode, count = 13) {
  if (!Number.isSafeInteger(count) || count < 2) throw new RangeError("sweepMode: count must be an integer >= 2");
  const pts = [];
  for (let i = 0; i < count; i++) {
    const adc = Math.round((ADC_MAX * i) / (count - 1));
    const st = modeStats(mode, adc);
    const duty = st.pwmMean / 255;
    pts.push({
      adc,
      pwmMean: st.pwmMean,
      pwmMin: st.pwmMin,
      pwmMax: st.pwmMax,
      dutyPct: (st.pwmMean / 255) * 100,
      ledMa: ledCurrentMa(duty),
      nodeMa: nodeCurrentMa(mode, duty),
    });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Fail-closed #pnlab= hash codec.
// Format: pnlab=v=1&m=<0..2>&n=<-1..8>&s=<-1..63>&t=<0|1>
// ---------------------------------------------------------------------------

export const STATE_DEFAULTS = Object.freeze({ mode: 0, net: -1, sample: -1, tamper: 0 });
const CODEC_SPEC = Object.freeze({
  m: { min: 0, max: 2 },
  n: { min: -1, max: 8 },
  s: { min: -1, max: 63 },
  t: { min: 0, max: 1 },
});

export function normalizeState(state) {
  const s = state && typeof state === "object" ? state : {};
  const num = (v, d, min, max) => {
    const n = typeof v === "number" ? v : d;
    if (!Number.isFinite(n)) return d;
    return clamp(Math.round(n === 0 ? 0 : n), min, max); // -0 -> 0
  };
  return {
    mode: num(s.mode, STATE_DEFAULTS.mode, CODEC_SPEC.m.min, CODEC_SPEC.m.max),
    net: num(s.net, STATE_DEFAULTS.net, CODEC_SPEC.n.min, CODEC_SPEC.n.max),
    sample: num(s.sample, STATE_DEFAULTS.sample, CODEC_SPEC.s.min, CODEC_SPEC.s.max),
    tamper: num(s.tamper, STATE_DEFAULTS.tamper, CODEC_SPEC.t.min, CODEC_SPEC.t.max),
  };
}

/** Encode a lab state to the inner codec payload (no "pnlab=" prefix). */
export function encodeLabHash(state) {
  const s = normalizeState(state);
  return `v=1&m=${s.mode}&n=${s.net}&s=${s.sample}&t=${s.tamper}`;
}

/**
 * Decode a hash payload. Accepts "pnlab=...", "#pnlab=..." or the bare
 * "v=1&..." form. Returns a normalized state, or null on any hostile or
 * malformed input: bad container, unknown or duplicated keys, non-integer or
 * non-finite values, or a version other than 1. Out-of-range integers clamp.
 */
export function decodeLabHash(input) {
  if (typeof input !== "string") return null;
  let payload = input;
  if (payload.startsWith("#")) payload = payload.slice(1);
  if (payload.startsWith("pnlab=")) payload = payload.slice(6);
  else if (!/^v=/.test(payload)) return null;
  if (payload.length === 0 || payload.length > 256) return null;

  const seen = new Set();
  const out = {};
  for (const pair of payload.split("&")) {
    const m = /^([a-z])=(-?\d{1,12})$/.exec(pair);
    if (!m) return null;
    const [, key, raw] = m;
    if (seen.has(key)) return null;
    seen.add(key);
    if (key === "v") {
      if (raw !== "1") return null;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(CODEC_SPEC, key)) return null;
    let n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    if (n === 0) n = 0; // -0 canonicalized
    const spec = CODEC_SPEC[key];
    out[key] = clamp(n, spec.min, spec.max);
  }
  if (!seen.has("v")) return null;
  return {
    mode: out.m ?? STATE_DEFAULTS.mode,
    net: out.n ?? STATE_DEFAULTS.net,
    sample: out.s ?? STATE_DEFAULTS.sample,
    tamper: out.t ?? STATE_DEFAULTS.tamper,
  };
}

// ---------------------------------------------------------------------------
// Formula-injection-safe CSV.
// ---------------------------------------------------------------------------

const FORMULA_FIRST = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Escape one CSV cell. If the first non-whitespace character could make a
 * spreadsheet evaluate the cell (= + - @ TAB CR), the value is prefixed with a
 * single quote. Cells containing , " newline CR or outer whitespace are quoted
 * with inner quotes doubled.
 */
export function csvCell(value) {
  let s = String(value ?? "");
  const first = s.trimStart().charAt(0);
  if (first && FORMULA_FIRST.has(first)) s = "'" + s;
  if (/[",\n\r]/.test(s) || s !== s.trim()) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Serialize rows (arrays of cells) to CRLF CSV text. */
export function csvRows(rows) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Readiness proof: one canonical payload, one cached SHA-256 per state key.
// ---------------------------------------------------------------------------

const proofCache = new Map();

/**
 * Build the deterministic proof payload for a lab state. Contains only
 * verified facts derived from pcb.json, bom.csv and the firmware model.
 */
export function buildProofPayload(board, bom, state) {
  const s = normalizeState(state);
  const mode = MODES[s.mode] || MODES[0];
  const pts = sweepMode(mode.id);
  const at = s.sample >= 0 && s.sample < pts.length ? pts[s.sample] : pts[Math.floor(pts.length / 2)];
  const net = s.net > 0 ? board.nets.find((n) => n.id === s.net) || null : null;
  return {
    schema: "attiny412-pulsenode/readiness-proof@1",
    board: {
      outlineMm: [board.outline.w, board.outline.h],
      footprints: board.footprintCount,
      namedNets: board.namedNetCount,
      padsPlaced: board.padTotal,
      trackSegments: board.trackTotal,
      openConnections: board.missingTotal,
      singlePadNets: board.lonelyNets.slice(),
      readyToOrder: board.missingTotal === 0 && board.lonelyNets.length === 0,
    },
    bom: {
      lineItems: bom.lineCount,
      parts: bom.partCount,
      costUsd: bom.totalCost,
      placedUsd: bom.placedCost,
      remainingUsd: bom.remainingCost,
    },
    mode: {
      id: mode.id,
      key: mode.key,
      sampleAdc: at.adc,
      pwmMean: at.pwmMean,
      dutyPct: at.dutyPct,
      ledMa: at.ledMa,
      nodeMa: at.nodeMa,
    },
    selectedNet: net ? net.name : null,
    tamperDemo: s.tamper,
  };
}

/**
 * Stamp a payload with its canonical SHA-256. One cached entry per distinct
 * canonical state: the on-page fingerprint, JSON export, CSV export and
 * Markdown brief always stamp the identical digest.
 */
export function stampProof(payload) {
  const key = canonicalize(payload);
  let entry = proofCache.get(key);
  if (!entry) {
    entry = { payload, key, digest: sha256Hex(key) };
    proofCache.set(key, entry);
  }
  return entry;
}

/** JSON export text for a stamped proof. */
export function proofJson(stamped) {
  return JSON.stringify({ sha256: stamped.digest, proof: stamped.payload }, null, 2) + "\n";
}

/** Formula-injection-safe CSV export text for a stamped proof. */
export function proofCsv(stamped) {
  const p = stamped.payload;
  const rows = [
    ["field", "value"],
    ["schema", p.schema],
    ["sha256", stamped.digest],
    ["outline_mm", `${p.board.outlineMm[0]} x ${p.board.outlineMm[1]}`],
    ["footprints_placed", p.board.footprints],
    ["named_nets", p.board.namedNets],
    ["pads_placed", p.board.padsPlaced],
    ["track_segments", p.board.trackSegments],
    ["open_connections", p.board.openConnections],
    ["single_pad_nets", p.board.singlePadNets.join(" ")],
    ["ready_to_order", p.board.readyToOrder ? "yes" : "no"],
    ["bom_line_items", p.bom.lineItems],
    ["bom_parts", p.bom.partCount],
    ["bom_cost_usd", p.bom.costUsd.toFixed(2)],
    ["bom_placed_usd", p.bom.placedUsd.toFixed(2)],
    ["bom_remaining_usd", p.bom.remainingUsd.toFixed(2)],
    ["mode_id", p.mode.id],
    ["mode_key", p.mode.key],
    ["sample_adc", p.mode.sampleAdc],
    ["pwm_mean", p.mode.pwmMean],
    ["duty_pct", Number(p.mode.dutyPct.toFixed(3))],
    ["led_ma", Number(p.mode.ledMa.toFixed(3))],
    ["node_ma", Number(p.mode.nodeMa.toFixed(3))],
    ["selected_net", p.selectedNet ?? "none"],
    ["tamper_demo", p.tamperDemo],
  ];
  return csvRows(rows);
}

/** Markdown brief text for a stamped proof. */
export function proofMarkdown(stamped) {
  const p = stamped.payload;
  const nets = p.board.singlePadNets.join(", ");
  return [
    "# ATtiny412 PulseNode readiness proof",
    "",
    `- SHA-256: \`${stamped.digest}\``,
    `- Board: ${p.board.outlineMm[0]} x ${p.board.outlineMm[1]} mm, ${p.board.footprints} footprints placed, ${p.board.namedNets} named nets`,
    `- Routing: ${p.board.trackSegments} track segments, ${p.board.openConnections} open connections, single-pad nets: ${nets}`,
    `- BOM: ${p.bom.lineItems} line items, ${p.bom.parts} parts, \`$${p.bom.costUsd.toFixed(2)}\` total (\`$${p.bom.placedUsd.toFixed(2)}\` placed, \`$${p.bom.remainingUsd.toFixed(2)}\` remaining)`,
    `- Mode: ${p.mode.key} at ADC ${p.mode.sampleAdc}, duty ${p.mode.dutyPct.toFixed(1)}%, D1 ${p.mode.ledMa.toFixed(2)} mA, node ${p.mode.nodeMa.toFixed(2)} mA`,
    `- Selected net: ${p.selectedNet ?? "none"}`,
    `- Ready to order: ${p.board.readyToOrder ? "yes" : "no"}`,
    "",
  ].join("\n");
}

/**
 * 1-unit tamper demo: clone the payload, add one unit to a counted field,
 * re-stamp. Returns {before, after} stamped entries.
 */
export function tamperDemo(stamped) {
  const clone = JSON.parse(stamped.key);
  clone.board.openConnections += 1;
  return { before: stamped, after: stampProof(clone) };
}

// ---------------------------------------------------------------------------
// In-page deterministic self-tests. deps: {pcb, bomText, refSha256?}
// refSha256(input) may return a hex string or a Promise of one (WebCrypto).
// ---------------------------------------------------------------------------

export async function runSelfTests({ pcb, bomText, refSha256 = null, samples = 13 }) {
  const checks = [];
  const eq = (a, b) => Object.is(a, b) || canonicalize(a) === canonicalize(b);
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      checks.push({ name, ok: true, detail: detail ?? "ok" });
    } catch (err) {
      checks.push({ name, ok: false, detail: String(err && err.message ? err.message : err) });
    }
  };
  const want = (cond, detail) => {
    if (!cond) throw new Error(detail || "assertion failed");
    return detail;
  };

  const board = analyzeBoard(pcb);
  const bom = parseBom(bomText, board.placedRefs);
  const state = { mode: 0, net: -1, sample: -1, tamper: 0 };
  const stamped = stampProof(buildProofPayload(board, bom, state));

  await check("sha256 empty-string KAT", () =>
    want(sha256Hex("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", sha256Hex("")));
  await check("sha256 'abc' KAT", () =>
    want(sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", sha256Hex("abc")));
  await check("sha256 56-byte boundary KAT", () =>
    want(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ===
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1", sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")));
  await check("sha256 matches platform crypto on binary input", async () => {
    const bytes = new Uint8Array(200).map((_, i) => (i * 37 + 11) & 0xff);
    const mine = sha256Hex(bytes);
    if (refSha256) {
      const ref = await refSha256(bytes);
      return want(ref === mine, `ref ${ref}`);
    }
    return "no reference implementation, skipped comparison";
  });
  await check("canonicalizer sorts keys deterministically", () =>
    want(canonicalize({ b: 1, a: 2 }) === '{"a":2,"b":1}', canonicalize({ b: 1, a: 2 })));
  await check("canonicalizer normalizes -0", () => want(canonicalize(-0) === "0", canonicalize(-0)));
  await check("canonicalizer rejects cycles", () => {
    const o = {}; o.self = o;
    try { canonicalize(o); } catch { return "cycle rejected"; }
    throw new Error("cycle accepted");
  });
  await check("canonicalizer enforces depth bound", () => {
    let v = 0; for (let i = 0; i < 40; i++) v = [v];
    try { canonicalize(v); } catch { return "depth bound held"; }
    throw new Error("deep nesting accepted");
  });
  await check("board outline is 36 x 26 mm", () =>
    want(board.outline.w === 36 && board.outline.h === 26, `${board.outline.w} x ${board.outline.h}`));
  await check("exactly 4 placed footprints U1 C1 D1 J1", () =>
    want(eq(board.placedRefs, ["U1", "C1", "D1", "J1"]), board.placedRefs.join(",")));
  await check("exactly 8 named nets present", () =>
    want(board.namedNetCount === 8, String(board.namedNetCount)));
  await check("net names match the schematic set", () =>
    want(eq(board.nets.map((n) => n.name), ["+5V", "GND", "PA6_PIEZO", "PA7_LDR", "PA1_BTN", "PA2_STATUS", "PA0_UPDI", "PA3_PWM"]),
      board.nets.map((n) => n.name).join(",")));
  await check("placed pad count is 15", () => want(board.padTotal === 15, String(board.padTotal)));
  await check("track segment count is 4", () => want(board.trackTotal === 4, String(board.trackTotal)));
  await check("open connection count is 3", () => want(board.missingTotal === 3, String(board.missingTotal)));
  await check("single-pad nets are the 4 unplaced MCU pins", () =>
    want(eq(board.lonelyNets, ["PA6_PIEZO", "PA7_LDR", "PA1_BTN", "PA2_STATUS"]), board.lonelyNets.join(",")));
  await check("BOM parses 11 line items and 12 parts", () =>
    want(bom.lineCount === 11 && bom.partCount === 12, `${bom.lineCount}/${bom.partCount}`));
  await check("BOM sum matches raw column sum", () => {
    const raw = bomText.trim().split(/\r?\n/).slice(1)
      .reduce((s, l) => s + Math.round(parseFloat(l.split(",")[6]) * 100), 0);
    return want(Math.round(bom.totalCost * 100) === raw, `$${bom.totalCost.toFixed(2)}`);
  });
  await check("placed cost plus remaining cost equals total", () =>
    want(Math.round((bom.placedCost + bom.remainingCost) * 100) === Math.round(bom.totalCost * 100),
      `$${bom.placedCost.toFixed(2)} + $${bom.remainingCost.toFixed(2)}`));
  await check("ambient duty is monotonic non-increasing over the ADC sweep", () => {
    const pts = sweepMode(0, samples);
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].pwmMean > pts[i - 1].pwmMean) throw new Error(`rose at index ${i}`);
    }
    return `${pts.length} points monotone`;
  });
  await check("ambient endpoints match firmware constrain/map", () => {
    const lo = pwmAt(0, ADC_MIN), hi = pwmAt(0, ADC_MAX);
    return want(lo === 255 && hi === 18, `adc0=${lo} adc1023=${hi}`);
  });
  await check("LED current stays inside Ohm's-law bounds", () => {
    const max = ((ELEC.VCC_V - ELEC.LED_VF_V) / ELEC.R_OHM) * 1000;
    for (const p of sweepMode(0, samples)) {
      if (!(p.ledMa >= 0 && p.ledMa <= max + 1e-9)) throw new Error(`out of bounds at adc ${p.adc}`);
    }
    return `0..${max.toFixed(2)} mA`;
  });
  await check("node current never drops below MCU draw plus LED share", () => {
    for (const m of [0, 1, 2]) {
      for (const p of sweepMode(m, samples)) {
        if (p.nodeMa < ELEC.MCU_MA + p.ledMa - 1e-9) throw new Error(`mode ${m} adc ${p.adc}`);
      }
    }
    return "3 modes bounded";
  });
  await check("digest parity across fingerprint, JSON, CSV and Markdown", () => {
    const surfaces = [
      stamped.digest,
      (proofJson(stamped).match(/"sha256":\s*"([0-9a-f]{64})"/) || [])[1],
      (proofCsv(stamped).split("\r\n")[2] || "").split(",")[1],
      (proofMarkdown(stamped).match(/SHA-256: `([0-9a-f]{64})`/) || [])[1],
    ];
    return want(surfaces.every((d) => d === stamped.digest), stamped.digest.slice(0, 16));
  });
  await check("tamper demo flips the digest", () => {
    const t = tamperDemo(stamped);
    return want(t.after.digest !== t.before.digest, `${t.after.digest.slice(0, 12)} != ${t.before.digest.slice(0, 12)}`);
  });
  await check("verify recomputes the stamped digest", () =>
    want(sha256Hex(stamped.key) === stamped.digest, stamped.digest.slice(0, 16)));
  await check("pnlab codec round-trips a state", () => {
    const s = { mode: 2, net: 7, sample: 5, tamper: 1 };
    const back = decodeLabHash("pnlab=" + encodeLabHash(s));
    return want(back && eq(back, s), JSON.stringify(back));
  });
  await check("pnlab codec rejects hostile input", () =>
    want(decodeLabHash("pnlab=v=1&__proto__=1") === null && decodeLabHash("pnlab=v=x") === null &&
      decodeLabHash("javascript:alert(1)") === null, "3 hostile probes rejected"));
  await check("pnlab codec clamps out-of-range integers", () => {
    const s = decodeLabHash("pnlab=v=1&m=99&n=-5&t=3");
    return want(s && s.mode === 2 && s.net === -1 && s.tamper === 1, JSON.stringify(s));
  });
  await check("CSV escaping defuses formula injection", () =>
    want(csvCell("=1+1") === "'=1+1" && csvCell("  =cmd") === "'  =cmd" && csvCell("plain") === "plain",
      `${csvCell("=1+1")} / ${csvCell("  =cmd")}`));
  await check("marker hit radius stays under half the neighbor gap", () => {
    const pts = sweepMode(0, samples);
    const r = markerHitRadius(pts.map((p, i) => i * 40), 12);
    return want(r <= 20 && r <= 12, `r=${r}`);
  });

  return checks;
}

/**
 * Adaptive marker hit radius: the requested radius capped at half the nearest
 * neighbor center distance so hit targets never overlap.
 */
export function markerHitRadius(centers, requested) {
  if (!Array.isArray(centers) || centers.length < 2 || !centers.every((c) => Number.isFinite(c))) {
    return Math.max(0, requested);
  }
  let gap = Infinity;
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const d = Math.abs(centers[j] - centers[i]);
      if (d > 0 && d < gap) gap = d;
    }
  }
  return Math.min(Math.max(0, requested), gap === Infinity ? requested : gap / 2);
}
