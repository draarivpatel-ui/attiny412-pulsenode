// DOM wiring for the board readiness lab. All numbers come from node-lab.js,
// which is deterministic and shared with the Node test suite.
import * as L from "./node-lab.js";
import { h, svg, num, toast, copy } from "./ui.js";

const SAMPLES = 13;
const MODE_NOTES = [
  "Firmware mode 0: duty falls 255 to 18 as the LDR ADC rises across 60..960 (constrain + map, like the sketch).",
  "Firmware mode 1: triangle breath 0..255 over a 6.14 s cycle; the ADC reading is ignored. The dashed line is the cycle mean, the band is the instantaneous range.",
  "Firmware mode 2: beacon toggles 0/240 every 250 ms; the ADC reading is ignored. The dashed line is the cycle mean, the band is the instantaneous range.",
];

const $ = (s) => document.querySelector(s);

/** WebCrypto-backed reference SHA-256 for the live self-tests. */
async function refSha256(data) {
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime || "text/plain" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Mount the lab. deps: {pcb, bomText, onSelectNet(name), samples?}
 * Returns {syncNet} so the main net table can keep the lab rows in step.
 */
export function initLab({ pcb, bomText, onSelectNet }) {
  const board = L.analyzeBoard(pcb);
  const bom = L.parseBom(bomText, board.placedRefs);
  const state = L.decodeLabHash(location.hash) || { ...L.STATE_DEFAULTS };

  // ---- comparator table ---------------------------------------------------
  const netRows = $("#lab-net-rows");
  const renderNets = () => {
    netRows.replaceChildren(...board.nets.map((n) => {
      const badge =
        n.status === "routed" ? h("span", { class: "badge ok", text: "routed" })
        : n.status === "unrouted" ? h("span", { class: "badge flag", text: "unrouted" })
        : h("span", { class: "badge plain", text: "awaiting part" });
      const tr = h("tr", { tabindex: 0, "aria-selected": String(state.net === n.id), "data-net": n.id },
        h("td", { class: "num", text: n.pin ?? "-" }),
        h("td", { class: "data", text: n.name }),
        h("td", { class: "data", text: n.pads.join(", ") }),
        h("td", { class: "num", text: String(n.tracks) }),
        h("td", { class: "num", text: String(n.missing) }),
        h("td", { class: "data", text: n.awaiting.length ? n.awaiting.join(", ") : "-" }),
        h("td", {}, badge));
      const pick = () => {
        state.net = state.net === n.id ? -1 : n.id;
        syncAll();
        onSelectNet?.(n.name, state.net === n.id);
      };
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });
      return tr;
    }));
  };

  // ---- chart 1: ambient ADC to PWM duty and node current -------------------
  const CP = { w: 660, h: 300, l: 56, r: 58, t: 16, b: 36 };
  const iw = CP.w - CP.l - CP.r;
  const ih = CP.h - CP.t - CP.b;
  const MA_MAX = 20;
  const xAdc = (a) => CP.l + (a / L.ADC_MAX) * iw;
  const yDuty = (d) => CP.t + (1 - d / 100) * ih;
  const yMa = (ma) => CP.t + (1 - ma / MA_MAX) * ih;

  function drawPwm() {
    const pts = L.sweepMode(state.mode, SAMPLES);
    const kids = [];
    const kidsFront = [];
    // grid: duty left axis, mA right axis, ADC bottom axis
    for (const d of [0, 25, 50, 75, 100]) {
      kids.push(svg("line", { x1: CP.l, y1: yDuty(d), x2: CP.l + iw, y2: yDuty(d), class: "dim", "stroke-dasharray": d === 0 ? "" : "3 4" }));
      kids.push(svg("text", { x: CP.l - 8, y: yDuty(d) + 4, "text-anchor": "end", class: "dimtext" }, `${d}%`));
    }
    for (const ma of [0, 5, 10, 15, 20]) {
      kids.push(svg("text", { x: CP.l + iw + 8, y: yMa(ma) + 4, class: "dimtext" }, `${ma}`));
    }
    kids.push(svg("text", { x: CP.l + iw + 8, y: CP.t + 4, class: "dimtext" }, "mA"));
    for (const a of [0, 256, 512, 768, 1023]) {
      kids.push(svg("line", { x1: xAdc(a), y1: CP.t, x2: xAdc(a), y2: CP.t + ih, class: "dim", "stroke-dasharray": "3 4", opacity: 0.5 }));
      kids.push(svg("text", { x: xAdc(a), y: CP.t + ih + 22, "text-anchor": "middle", class: "dimtext" }, String(a)));
    }
    kids.push(svg("text", { x: CP.l - 8, y: CP.t - 4, "text-anchor": "end", class: "dimtext" }, "duty"));
    kids.push(svg("text", { x: CP.l + iw / 2, y: CP.h - 4, "text-anchor": "middle", class: "dimtext" }, "LDR ADC counts"));

    const stats = L.modeStats(state.mode, pts[0].adc);
    if (!stats.variesWithAdc) {
      // time-driven mode: shade the instantaneous min..max band, mean is dashed
      kids.push(svg("rect", {
        x: CP.l, y: yDuty((stats.pwmMax / 255) * 100), width: iw,
        height: Math.max(1, yDuty((stats.pwmMin / 255) * 100) - yDuty((stats.pwmMax / 255) * 100)),
        fill: "var(--accent-wash)", stroke: "none",
      }));
    }

    // fine polyline of the mean duty (exact for mode 0, flat mean for 1 and 2)
    const fine = [];
    for (let i = 0; i <= 64; i++) {
      const adc = Math.round((L.ADC_MAX * i) / 64);
      const st = L.modeStats(state.mode, adc);
      fine.push(`${xAdc(adc).toFixed(2)},${yDuty((st.pwmMean / 255) * 100).toFixed(2)}`);
    }
    kidsFront.push(svg("polyline", {
      points: fine.join(" "), fill: "none", stroke: "var(--accent)", "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-dasharray": stats.variesWithAdc ? "" : "7 5",
    }));
    const fineMa = [];
    for (let i = 0; i <= 64; i++) {
      const adc = Math.round((L.ADC_MAX * i) / 64);
      const st = L.modeStats(state.mode, adc);
      fineMa.push(`${xAdc(adc).toFixed(2)},${yMa(L.nodeCurrentMa(state.mode, st.pwmMean / 255)).toFixed(2)}`);
    }
    kidsFront.push(svg("polyline", {
      points: fineMa.join(" "), fill: "none", stroke: "var(--color-ink-2)", "stroke-width": 1.5,
      "stroke-dasharray": "2 4", "stroke-linejoin": "round",
    }));

    // sample markers with adaptive hit radii
    const centers = pts.map((p) => xAdc(p.adc));
    const hitR = L.markerHitRadius(centers, 22);
    pts.forEach((p, i) => {
      const cx = centers[i];
      const cy = yDuty(p.dutyPct);
      const sel = state.sample === i;
      const label = `ADC ${p.adc}: duty ${num(p.dutyPct, 1)} percent, D1 ${num(p.ledMa, 2)} mA, node ${num(p.nodeMa, 2)} mA`;
      const g = svg("g", { class: `lab-mark${sel ? " sel" : ""}`, tabindex: 0, role: "button", "aria-label": label, "data-sample": i },
        svg("circle", { class: "hit", cx, cy, r: hitR, fill: "transparent" }),
        svg("circle", { class: "dot", cx, cy, r: sel ? 5.5 : 4, fill: "var(--accent)", stroke: "var(--color-ink)", "stroke-width": 1 }));
      const choose = () => { state.sample = state.sample === i ? -1 : i; syncAll(); };
      g.addEventListener("click", choose);
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
      });
      kidsFront.push(g);
    });

    const pwmSvg = $("#lab-chart-pwm");
    pwmSvg.setAttribute("viewBox", `0 0 ${CP.w} ${CP.h}`);
    pwmSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    pwmSvg.replaceChildren(...kids, ...kidsFront);
    const at = state.sample >= 0 ? pts[state.sample] : pts[Math.floor(pts.length / 2)];
    $("#lab-pwm-readout").textContent = stats.variesWithAdc
      ? `ADC ${at.adc} -> PWM ${num(at.pwmMean, 0)}, duty ${num(at.dutyPct, 1)}%; D1 ${num(at.ledMa, 2)} mA; node ${num(at.nodeMa, 2)} mA`
      : `ADC ${at.adc} | cycle mean PWM ${num(at.pwmMean, 1)} (instantaneous ${stats.pwmMin}..${stats.pwmMax}), duty ${num(at.dutyPct, 1)}%; D1 ${num(at.ledMa, 2)} mA; node ${num(at.nodeMa, 2)} mA`;
  }

  // ---- chart 2: BOM cost placed vs remaining -------------------------------
  function drawBom() {
    const B = { w: 660, h: 240, base: 188, top: 46 };
    const max = bom.totalCost || 1;
    const bh = (c) => (c / max) * (B.base - B.top);
    const cols = [
      { x: 175, title: "Placed on PCB", cost: bom.placedCost, refs: bom.placedRefs, parts: bom.partCount - bom.remainingParts, fill: "var(--color-ok)" },
      { x: 480, title: "Still to place", cost: bom.remainingCost, refs: bom.remainingRefs, parts: bom.remainingParts, fill: "var(--color-flag)" },
    ];
    const kids = [];
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const y = B.base - frac * (B.base - B.top);
      kids.push(svg("line", { x1: 40, y1: y, x2: B.w - 20, y2: y, class: "dim", "stroke-dasharray": frac === 0 ? "" : "3 4" }));
      kids.push(svg("text", { x: 34, y: y + 4, "text-anchor": "end", class: "dimtext" }, `$${num(max * frac, 2)}`));
    }
    kids.push(svg("line", { x1: 40, y1: B.base, x2: B.w - 20, y2: B.base, stroke: "var(--color-ink)", "stroke-width": 1.5 }));
    cols.forEach((c, i) => {
      const hh = Math.max(2, bh(c.cost));
      const g = svg("g", { class: "lab-bar", tabindex: 0, role: "button", "aria-label": `${c.title}: $${num(c.cost, 2)} across ${c.refs.length} refs, ${c.parts} parts`, "data-col": i },
        svg("rect", { class: "hit", x: c.x - 105, y: 8, width: 210, height: B.h - 16, fill: "transparent" }),
        svg("rect", { class: "bar", x: c.x - 55, y: B.base - hh, width: 110, height: hh, fill: c.fill, stroke: "var(--color-ink)", "stroke-width": 1 }));
      kids.push(g);
      kids.push(svg("text", { x: c.x, y: B.base - hh - 8, "text-anchor": "middle", class: "lab-val" }, `$${num(c.cost, 2)}`));
      kids.push(svg("text", { x: c.x, y: B.base - hh - 24, "text-anchor": "middle", class: "dimtext" }, c.title));
      kids.push(svg("text", { x: c.x, y: B.base + 18, "text-anchor": "middle", class: "dimtext" }, `${c.refs.length} refs, ${c.parts} parts`));
      kids.push(svg("text", { x: c.x, y: B.base + 34, "text-anchor": "middle", class: "data lab-refs" }, c.refs.join(" ")));
      const pick = () => {
        $("#lab-bom-readout").textContent = i === 0
          ? `Placed: ${c.refs.join(", ")}: $${num(c.cost, 2)} of $${num(bom.totalCost, 2)} (${num((c.cost / max) * 100, 1)}%).`
          : `Still to place: ${c.refs.join(", ")}: $${num(c.cost, 2)} of $${num(bom.totalCost, 2)} (${num((c.cost / max) * 100, 1)}%).`;
      };
      g.addEventListener("click", pick);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
    const bomSvg = $("#lab-chart-bom");
    bomSvg.setAttribute("viewBox", `0 0 ${B.w} ${B.h}`);
    bomSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    bomSvg.replaceChildren(...kids);
    $("#lab-bom-readout").textContent =
      `bom.csv sums to $${num(bom.totalCost, 2)} across ${bom.partCount} parts on ${bom.lineCount} line items. Click a column for the split.`;
  }

  // ---- proof digest, verify, tamper, exports -------------------------------
  const stamped = () => {
    const payload = L.buildProofPayload(board, bom, state);
    if (state.tamper) {
      payload.board.openConnections += 1; // 1-unit tamper: claims one extra open connection
      payload.board.readyToOrder = false;
    }
    return L.stampProof(payload);
  };

  function updateProof() {
    const s = stamped();
    $("#lab-digest").textContent = s.digest;
    const note = $("#lab-proof-note");
    if (state.tamper) {
      const truth = L.stampProof(L.buildProofPayload(board, bom, { ...state, tamper: 0 }));
      note.textContent = `Tamper demo active: this payload claims ${s.payload.board.openConnections} open connections (the board really has ${truth.payload.board.openConnections}). Recompute and the digest still matches its own payload, but it no longer matches the untampered ${truth.digest.slice(0, 12)}...`;
    } else {
      note.textContent = "One canonical payload feeds the fingerprint, JSON, CSV and Markdown exports, so all four stamp the same digest.";
    }
  }

  function wireProof() {
    $("#lab-verify").addEventListener("click", () => {
      const s = stamped();
      const recomputed = L.sha256Hex(s.key);
      toast(recomputed === s.digest ? `Verified: ${s.digest.slice(0, 20)}...` : "Digest mismatch");
      $("#lab-proof-note").textContent = recomputed === s.digest
        ? `Verified: the displayed SHA-256 recomputed identically over the canonical payload (${s.digest.slice(0, 32)}...).`
        : "Mismatch: the displayed digest does not match its payload.";
    });
    $("#lab-tamper").addEventListener("click", (e) => {
      state.tamper = state.tamper ? 0 : 1;
      e.currentTarget.setAttribute("aria-pressed", String(!!state.tamper));
      syncAll();
    });
    $("#lab-dl-json").addEventListener("click", () => download("pulsenode-readiness.json", L.proofJson(stamped()), "application/json"));
    $("#lab-dl-csv").addEventListener("click", () => download("pulsenode-readiness.csv", L.proofCsv(stamped()), "text/csv"));
    $("#lab-dl-md").addEventListener("click", () => download("pulsenode-readiness.md", L.proofMarkdown(stamped()), "text/markdown"));
    $("#lab-copy-json")?.addEventListener("click", (e) => copy(L.proofJson(stamped()), e.currentTarget));
  }

  // ---- modes ---------------------------------------------------------------
  function wireModes() {
    document.querySelectorAll("#lab-modes button").forEach((b) => {
      b.addEventListener("click", () => {
        state.mode = Number(b.dataset.mode);
        state.sample = -1;
        syncAll();
      });
    });
  }

  // ---- self-tests ----------------------------------------------------------
  function wireTests() {
    $("#lab-run-tests").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      $("#lab-test-count").textContent = "running";
      try {
        const checks = await L.runSelfTests({ pcb, bomText, refSha256, samples: SAMPLES });
        const pass = checks.filter((c) => c.ok).length;
        $("#lab-test-count").textContent = `${pass}/${checks.length} pass`;
        $("#lab-test-count").className = `badge ${pass === checks.length ? "ok" : "flag"}`;
        $("#lab-tests").replaceChildren(...checks.map((c) =>
          h("li", {}, h("span", { class: `badge ${c.ok ? "ok" : "flag"}`, text: c.ok ? "PASS" : "FAIL" }),
            h("span", {}, h("span", { text: c.name }), h("span", { class: "lab-note", text: ` ${c.detail}` })))));
      } finally {
        e.currentTarget.disabled = false;
      }
    });
  }

  // ---- hash sync + initial render ------------------------------------------
  function syncAll() {
    const s = L.normalizeState(state);
    state.mode = s.mode; state.net = s.net; state.sample = s.sample; state.tamper = s.tamper;
    try {
      history.replaceState(null, "", `#pnlab=${L.encodeLabHash(state)}`);
    } catch { /* file:// or sandboxed contexts */ }
    document.querySelectorAll("#lab-modes button").forEach((b) =>
      b.setAttribute("aria-pressed", String(Number(b.dataset.mode) === state.mode)));
    $("#lab-mode-note").textContent = MODE_NOTES[state.mode] || "";
    $("#lab-tamper").setAttribute("aria-pressed", String(!!state.tamper));
    renderNets();
    drawPwm();
    updateProof();
  }

  wireModes();
  wireProof();
  wireTests();
  drawBom();
  syncAll();

  return {
    syncNet(name) {
      const n = board.nets.find((x) => x.name === name);
      state.net = n ? n.id : -1;
      syncAll();
    },
  };
}
