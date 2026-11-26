import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const L = await import(pathToFileURL(path.join(root, "assets/node-lab.js")).href);
const pcb = JSON.parse(fs.readFileSync(path.join(root, "assets/pcb.json"), "utf8"));
const bomText = fs.readFileSync(path.join(root, "bom.csv"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets/sheet.css"), "utf8");
const labUiSrc = fs.readFileSync(path.join(root, "assets/lab-ui.js"), "utf8");
const labSrc = fs.readFileSync(path.join(root, "assets/node-lab.js"), "utf8");

const board = L.analyzeBoard(pcb);
const bom = L.parseBom(bomText, board.placedRefs);
const refSha = (data) => crypto.createHash("sha256").update(Buffer.from(data)).digest("hex");

// ---------------------------------------------------------------------------
// SHA-256: known-answer tests plus a 0..160 byte boundary sweep vs node:crypto
// ---------------------------------------------------------------------------

const KATS = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
  ["abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
    "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1"],
  ["The quick brown fox jumps over the lazy dog",
    "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"],
];
for (const [input, want] of KATS) {
  test(`sha256 KAT ${JSON.stringify(input.slice(0, 24))}`, () => {
    assert.equal(L.sha256Hex(input), want);
    assert.equal(L.sha256Hex(input), refSha(input));
  });
}
test("sha256 one-million-a KAT", () => {
  const a = new Uint8Array(1000000).fill(0x61);
  assert.equal(L.sha256Hex(a), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
});
for (let len = 0; len <= 160; len++) {
  test(`sha256 boundary length ${len}`, () => {
    const bytes = new Uint8Array(len).map((_, i) => (i * 31 + len) & 0xff);
    assert.equal(L.sha256Hex(bytes), refSha(bytes), `mismatch at ${len} bytes`);
  });
}
for (const [name, str] of [
  ["utf8 multibyte", "hexagram \u262f \u00e9\u00e8\u4e2d\u6587"],
  ["long string", "x".repeat(4096)],
  ["whitespace", " \t\r\n"],
]) {
  test(`sha256 vs crypto on ${name}`, () => {
    assert.equal(L.sha256Hex(str), refSha(str));
  });
}
test("sha256 rejects non-byte inputs", () => {
  for (const bad of [null, undefined, 42, {}, [], "x".length]) {
    assert.throws(() => L.sha256Hex(bad), TypeError);
  }
});

// ---------------------------------------------------------------------------
// Canonicalizer
// ---------------------------------------------------------------------------

test("canonicalize sorts object keys at every depth", () => {
  assert.equal(L.canonicalize({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
});
test("canonicalize preserves array order", () => {
  assert.equal(L.canonicalize([3, 1, 2]), "[3,1,2]");
});
test("canonicalize is stable across key insertion order", () => {
  const a = { x: 1, y: 2, z: 3 };
  const b = { z: 3, y: 2, x: 1 };
  assert.equal(L.canonicalize(a), L.canonicalize(b));
});
test("canonicalize handles unicode and escapes", () => {
  assert.equal(L.canonicalize({ "b\n": 'a"b' }), JSON.stringify({ "b\n": 'a"b' }));
});
test("canonicalize serializes -0 as 0", () => {
  assert.equal(L.canonicalize(-0), "0");
  assert.equal(L.canonicalize([-0]), "[0]");
  assert.equal(L.canonicalize({ n: -0 }), '{"n":0}');
});
for (const v of [NaN, Infinity, -Infinity]) {
  test(`canonicalize rejects ${v}`, () => assert.throws(() => L.canonicalize(v), TypeError));
}
test("canonicalize rejects direct cycles", () => {
  const o = {}; o.self = o;
  assert.throws(() => L.canonicalize(o), /cyclic/);
});
test("canonicalize rejects mutual cycles", () => {
  const a = {}, b = { a }; a.b = b;
  assert.throws(() => L.canonicalize(a), /cyclic/);
});
test("canonicalize allows repeated non-cyclic references", () => {
  const shared = { v: 1 };
  assert.equal(L.canonicalize([shared, shared]), '[{"v":1},{"v":1}]');
});
test("canonicalize enforces the depth bound at depth, not beyond", () => {
  let ok = 0; for (let i = 0; i < 30; i++) ok = [ok];
  assert.equal(L.canonicalize(ok), "[".repeat(30) + "0" + "]".repeat(30));
  let deep = 0; for (let i = 0; i < 33; i++) deep = [deep];
  assert.throws(() => L.canonicalize(deep), RangeError);
});
test("canonicalize custom maxDepth is honored", () => {
  assert.throws(() => L.canonicalize([[1]], 1), RangeError);
  assert.equal(L.canonicalize([[1]], 2), "[[1]]");
});
test("canonicalize rejects bigint, function, symbol inputs at top level", () => {
  assert.throws(() => L.canonicalize(10n), TypeError);
  assert.throws(() => L.canonicalize(() => 1), TypeError);
  assert.throws(() => L.canonicalize(Symbol("s")), TypeError);
});
test("canonicalize skips undefined and function object members", () => {
  assert.equal(L.canonicalize({ a: undefined, b: () => 1, c: 2 }), '{"c":2}');
});
test("canonicalize ignores inherited enumerable properties", () => {
  const o = Object.create({ inherited: 9 });
  o.own = 1;
  assert.equal(L.canonicalize(o), '{"own":1}');
});
test("canonicalize handles a __proto__ own data key safely", () => {
  const o = JSON.parse('{"__proto__":{"x":1},"a":2}');
  assert.equal(L.canonicalize(o), '{"__proto__":{"x":1},"a":2}');
});
test("canonicalize null, booleans, empty containers", () => {
  assert.equal(L.canonicalize(null), "null");
  assert.equal(L.canonicalize(true), "true");
  assert.equal(L.canonicalize(false), "false");
  assert.equal(L.canonicalize({}), "{}");
  assert.equal(L.canonicalize([]), "[]");
});
test("canonicalize rejects a negative or fractional maxDepth", () => {
  assert.throws(() => L.canonicalize({}, -1), RangeError);
  assert.throws(() => L.canonicalize({}, 1.5), RangeError);
});

// ---------------------------------------------------------------------------
// #pnlab= codec
// ---------------------------------------------------------------------------

test("codec encodes a normalized state deterministically", () => {
  assert.equal(L.encodeLabHash({ mode: 1, net: 7, sample: 3, tamper: 1 }), "v=1&m=1&n=7&s=3&t=1");
  assert.equal(L.encodeLabHash(L.STATE_DEFAULTS), "v=1&m=0&n=-1&s=-1&t=0");
});
test("codec ignores unknown fields when encoding", () => {
  assert.equal(L.encodeLabHash({ mode: 2, net: 3, sample: 0, tamper: 0, evil: "__proto__" }), "v=1&m=2&n=3&s=0&t=0");
});
test("codec encode normalizes floats, -0 and out-of-range", () => {
  const s = L.encodeLabHash({ mode: 2.9, net: -0, sample: 99, tamper: 5 });
  assert.equal(s, "v=1&m=2&n=0&s=63&t=1");
});
const RT = [
  { mode: 0, net: -1, sample: -1, tamper: 0 },
  { mode: 1, net: 3, sample: 0, tamper: 0 },
  { mode: 2, net: 11, sample: 63, tamper: 1 },
  { mode: 2, net: 0, sample: 12, tamper: 0 },
  { mode: 1, net: 1, sample: 6, tamper: 1 },
];
for (const s of RT) {
  test(`codec round trip ${JSON.stringify(s)}`, () => {
    const enc = L.encodeLabHash(s);
    assert.deepEqual(L.decodeLabHash(`pnlab=${enc}`), s);
    assert.deepEqual(L.decodeLabHash(`#pnlab=${enc}`), s);
    assert.deepEqual(L.decodeLabHash(enc), s);
  });
}
const HOSTILE = [
  ["null", null], ["number", 42], ["object", {}], ["empty", ""],
  ["no prefix", "m=1&n=2"], ["bare pnlab", "pnlab="],
  ["version 2", "pnlab=v=2&m=1"], ["version x", "pnlab=v=x"],
  ["version missing", "pnlab=m=1&n=2"], ["version 10", "pnlab=v=10"],
  ["unknown key", "pnlab=v=1&z=9"], ["__proto__ key", "pnlab=v=1&__proto__=1"],
  ["constructor key", "pnlab=v=1&constructor=1"], ["prototype key", "pnlab=v=1&prototype=1"],
  ["uppercase key", "pnlab=V=1&m=1"], ["two letter key", "pnlab=v=1&mm=1"],
  ["float value", "pnlab=v=1&m=1.5"], ["alpha value", "pnlab=v=1&m=abc"],
  ["hex value", "pnlab=v=1&m=0x10"], ["empty value", "pnlab=v=1&m="],
  ["empty pair", "pnlab=v=1&"], ["double amp", "pnlab=v=1&&m=1"],
  ["dup key", "pnlab=v=1&m=1&m=2"], ["dup version", "pnlab=v=1&v=1"],
  ["semicolon", "pnlab=v=1&m=1;alert(1)"], ["spaces", "pnlab=v=1& m=1"],
  ["javascript url", "javascript:alert(1)"], ["data url", "data:text/html,x"],
  ["percent junk", "pnlab=v%3d1%26m%3d1"], ["13 digit int", "pnlab=v=1&m=9999999999999"],
  ["section anchor", "lab"], ["other anchor", "nets"],
];
for (const [name, input] of HOSTILE) {
  test(`codec rejects hostile input: ${name}`, () => {
    assert.equal(L.decodeLabHash(input), null);
  });
}
test("codec rejects overlong payloads", () => {
  assert.equal(L.decodeLabHash("pnlab=v=1&" + "m=1&".repeat(80)), null);
});
const CLAMPS = [
  ["pnlab=v=1&m=99", { mode: 2 }], ["pnlab=v=1&m=-99", { mode: 0 }],
  ["pnlab=v=1&n=99", { net: 11 }], ["pnlab=v=1&n=-99", { net: -1 }],
  ["pnlab=v=1&s=99", { sample: 63 }], ["pnlab=v=1&s=-99", { sample: -1 }],
  ["pnlab=v=1&t=99", { tamper: 1 }], ["pnlab=v=1&t=-99", { tamper: 0 }],
  ["pnlab=v=1&m=999999999999", { mode: 2 }],
];
for (const [input, patch] of CLAMPS) {
  test(`codec clamps ${input}`, () => {
    const s = L.decodeLabHash(input);
    assert.ok(s, `expected clamped state for ${input}`);
    for (const [k, v] of Object.entries(patch)) assert.equal(s[k], v);
  });
}
test("codec canonicalizes -0 to 0", () => {
  const s = L.decodeLabHash("pnlab=v=1&n=-0");
  assert.ok(s);
  assert.ok(Object.is(s.net, 0));
});
test("codec fills missing keys with defaults", () => {
  assert.deepEqual(L.decodeLabHash("pnlab=v=1"), { mode: 0, net: -1, sample: -1, tamper: 0 });
  assert.deepEqual(L.decodeLabHash("pnlab=v=1&m=2"), { mode: 2, net: -1, sample: -1, tamper: 0 });
});
test("normalizeState handles hostile containers", () => {
  assert.deepEqual(L.normalizeState(null), { mode: 0, net: -1, sample: -1, tamper: 0 });
  assert.deepEqual(L.normalizeState("junk"), { mode: 0, net: -1, sample: -1, tamper: 0 });
  const s = L.normalizeState({ mode: NaN, net: Infinity, sample: -Infinity, tamper: undefined });
  assert.deepEqual(s, { mode: 0, net: -1, sample: -1, tamper: 0 });
});
test("codec state never pollutes Object.prototype", () => {
  const before = {}.evil;
  L.decodeLabHash("pnlab=v=1&__proto__=evil&constructor=x");
  assert.equal({}.evil, before);
  assert.equal({}.polluted, undefined);
});

// ---------------------------------------------------------------------------
// csvCell / csvRows: formula injection and quoting
// ---------------------------------------------------------------------------

const CSVF = [
  ["=1+1", "'=1+1"], ["+SUM(A1)", "'+SUM(A1)"], ["-10", "'-10"],
  ["@mention", "'@mention"], ["\tcmd", '"\tcmd"'], ["\rcmd", '"\rcmd"'],
  ["  =cmd", "'  =cmd"], [" \t +x", "' \t +x"], ["   @y", "'   @y"],
  ["plain", "plain"], ["0", "0"], ["-0", "'-0"], ["", ""],
  ['a,b', '"a,b"'], ['say "hi"', '"say ""hi"""'], ["line\nbreak", '"line\nbreak"'],
  [" trailing ", '" trailing "'], [" leading", '" leading"'],
];
for (const [input, want] of CSVF) {
  test(`csvCell ${JSON.stringify(input)}`, () => assert.equal(L.csvCell(input), want));
}
test("csvCell coerces non-strings", () => {
  assert.equal(L.csvCell(12), "12");
  assert.equal(L.csvCell(0), "0");
  assert.equal(L.csvCell(-3), "'-3");
  assert.equal(L.csvCell(null), "");
  assert.equal(L.csvCell(undefined), "");
});
test("csvRows joins rows with CRLF and escapes each cell", () => {
  const out = L.csvRows([["a", "b"], ["=x", "1,2"]]);
  assert.equal(out, 'a,b\r\n\'=x,"1,2"\r\n');
});

// ---------------------------------------------------------------------------
// bom.csv analysis (real file)
// ---------------------------------------------------------------------------

test("bom header is intact", () => {
  assert.equal(bom.header.join(","), "Reference,Value,Footprint,Quantity,MPN,Supplier,Unit_Cost_USD");
});
test("bom has 12 line items and 12 parts", () => {
  assert.equal(bom.lineCount, 12);
  assert.equal(bom.partCount, 12);
});
test("bom cost column sums to $1.76", () => {
  assert.equal(Math.round(bom.totalCost * 100), 176);
});
test("bom placed refs and cost", () => {
  assert.deepEqual(bom.placedRefs.sort(), ["BZ1", "C1", "D1", "D2", "J1", "Q1", "R1", "R2", "R3", "R4", "SW1", "U1"]);
  assert.equal(Math.round(bom.placedCost * 100), 176);
});
test("bom remaining refs, parts and cost", () => {
  assert.deepEqual(bom.remainingRefs, []);
  assert.equal(bom.remainingParts, 0);
  assert.equal(Math.round(bom.remainingCost * 100), 0);
});
const BOM_ROWS = [
  ["U1", 1, 0.58, true], ["C1", 1, 0.02, true], ["R1", 1, 0.01, true],
  ["R2", 1, 0.01, true], ["R3", 1, 0.01, true], ["R4", 1, 0.01, true],
  ["D1", 1, 0.03, true], ["D2", 1, 0.03, true], ["Q1", 1, 0.24, true],
  ["SW1", 1, 0.12, true], ["BZ1", 1, 0.65, true], ["J1", 1, 0.05, true],
];
for (const [ref, qty, cost, placed] of BOM_ROWS) {
  test(`bom row ${ref}: qty ${qty}, cost $${cost}, placed ${placed}`, () => {
    const r = bom.rows.find((x) => x.ref === ref);
    assert.ok(r, `missing row ${ref}`);
    assert.equal(r.qty, qty);
    assert.equal(r.lineCost, cost);
    assert.equal(r.placed, placed);
    assert.ok(r.mpn.length > 0 && r.supplier.length > 0 && r.footprint.length > 0);
  });
}
test("bom refs are unique", () => {
  assert.equal(new Set(bom.rows.map((r) => r.ref)).size, bom.rows.length);
});
test("bom placed plus remaining equals total and parts", () => {
  assert.equal(Math.round((bom.placedCost + bom.remainingCost) * 100), Math.round(bom.totalCost * 100));
  assert.equal(bom.partCount - bom.remainingParts, 12);
});
test("parseBom throws on malformed numeric fields", () => {
  assert.throws(() => L.parseBom("H\nX,v,f,NaNnotint,m,s,0.1"), TypeError);
  assert.throws(() => L.parseBom("H\nX,v,f,1,m,s,notanumber"), TypeError);
});
test("parseBom handles empty input", () => {
  const b = L.parseBom("h1,h2\n");
  assert.equal(b.lineCount, 0);
  assert.equal(b.totalCost, 0);
});
test("no bom cell begins with a spreadsheet formula char", () => {
  for (const line of bomText.trim().split(/\r?\n/)) {
    for (const cell of line.split(",")) assert.ok(!/^[=+\-@\t\r]/.test(cell), cell);
  }
});

// ---------------------------------------------------------------------------
// pcb.json board analysis (real file)
// ---------------------------------------------------------------------------

test("board outline is 36 x 26 mm at 100, 85", () => {
  assert.equal(board.outline.w, 36);
  assert.equal(board.outline.h, 26);
  assert.equal(board.outline.x, 100);
  assert.equal(board.outline.y, 85);
  assert.deepEqual(board.cadSize, [36, 26, 1.6]);
  assert.equal(board.cadValid, true);
});
test("board has exactly 12 placed footprints and 11 named nets", () => {
  assert.equal(board.footprintCount, 12);
  assert.deepEqual(board.placedRefs, ["U1", "C1", "R1", "R2", "R3", "R4", "D1", "D2", "Q1", "SW1", "BZ1", "J1"]);
  assert.equal(board.namedNetCount, 11);
});
test("board totals: 33 pads, 45 track segments, 0 open connections", () => {
  assert.equal(board.padTotal, 33);
  assert.equal(board.trackTotal, 45);
  assert.equal(board.missingTotal, 0);
});
test("no single-pad nets remain", () => {
  assert.deepEqual(board.lonelyNets, []);
});
const NET_WANT = [
  { id: 1, name: "+5V", pin: "1", pads: 4, tracks: 8, missing: 0, status: "routed" },
  { id: 2, name: "GND", pin: "8", pads: 9, tracks: 23, missing: 0, status: "routed" },
  { id: 3, name: "PA6_PIEZO", pin: "2", pads: 2, tracks: 2, missing: 0, status: "routed" },
  { id: 4, name: "PA7_LDR", pin: "3", pads: 3, tracks: 3, missing: 0, status: "routed" },
  { id: 5, name: "PA1_BTN", pin: "4", pads: 3, tracks: 2, missing: 0, status: "routed" },
  { id: 6, name: "PA2_STATUS", pin: "5", pads: 2, tracks: 1, missing: 0, status: "routed" },
  { id: 7, name: "PA0_UPDI", pin: "6", pads: 2, tracks: 1, missing: 0, status: "routed" },
  { id: 8, name: "PA3_PWM", pin: "7", pads: 2, tracks: 2, missing: 0, status: "routed" },
  { id: 9, name: "PWM_LED", pin: null, pads: 2, tracks: 1, missing: 0, status: "routed" },
  { id: 10, name: "STATUS_LED", pin: null, pads: 2, tracks: 1, missing: 0, status: "routed" },
  { id: 11, name: "UPDI_HDR", pin: null, pads: 2, tracks: 1, missing: 0, status: "routed" },
];
for (const w of NET_WANT) {
  test(`net ${w.name}: SOIC pin ${w.pin}, ${w.pads} pads, ${w.status}`, () => {
    const n = board.nets.find((x) => x.id === w.id);
    assert.ok(n, `net ${w.id} missing`);
    assert.equal(n.name, w.name);
    assert.equal(n.pin, w.pin);
    assert.equal(n.padCount, w.pads);
    assert.equal(n.tracks, w.tracks);
    assert.equal(n.missing, w.missing);
    assert.equal(n.status, w.status);
  });
}
test("every connectivity pad entry exists on a placed footprint", () => {
  const real = new Set();
  for (const f of pcb.footprints) for (const p of f.pads) real.add(`${f.ref}.${p.number}`);
  for (const n of pcb.connectivity) for (const pad of n.pads) assert.ok(real.has(pad), pad);
});
test("every footprint pad net resolves to a named net", () => {
  for (const f of pcb.footprints) {
    for (const p of f.pads) {
      assert.ok(Object.prototype.hasOwnProperty.call(pcb.nets, String(p.net)));
      assert.equal(pcb.nets[String(p.net)], p.net_name);
    }
  }
});
test("U1 has all 8 SOIC pads mapped to the 8 MCU-side nets", () => {
  const u1 = pcb.footprints.find((f) => f.ref === "U1");
  assert.equal(u1.pads.length, 8);
  const names = u1.pads.map((p) => p.net_name).sort();
  assert.deepEqual(names, ["+5V", "GND", "PA0_UPDI", "PA1_BTN", "PA2_STATUS", "PA3_PWM", "PA6_PIEZO", "PA7_LDR"].sort());
});
test("awaiting-parts map is empty on the completed board", () => {
  const charged = board.nets.flatMap((n) => n.awaiting);
  assert.equal(charged.length, 0);
});
test("analyzeBoard throws on non-objects", () => {
  assert.throws(() => L.analyzeBoard(null), TypeError);
  assert.throws(() => L.analyzeBoard("x"), TypeError);
});
test("analyzeBoard tolerates a board with no nets", () => {
  const b = L.analyzeBoard({ nets: {}, footprints: [], segments: [], connectivity: [], outline: { x: 0, y: 0, w: 1, h: 1 }, cad: { size: [1, 1, 1], valid: true } });
  assert.equal(b.namedNetCount, 0);
  assert.equal(b.missingTotal, 0);
});

// ---------------------------------------------------------------------------
// Firmware model
// ---------------------------------------------------------------------------

test("arduinoMap uses C++ truncation toward zero", () => {
  assert.equal(L.arduinoMap(60, 60, 960, 255, 18), 255);
  assert.equal(L.arduinoMap(960, 60, 960, 255, 18), 18);
  assert.equal(L.arduinoMap(0, 0, 1023, 0, 255), 0);
  assert.equal(L.arduinoMap(1023, 0, 1023, 0, 255), 255);
});
const PWM_M0 = [[0, 255], [59, 255], [60, 255], [61, 255], [64, 254], [512, 136], [959, 19], [960, 18], [961, 18], [1023, 18]];
for (const [adc, want] of PWM_M0) {
  test(`mode 0 pwmAt adc ${adc} = ${want}`, () => assert.equal(L.pwmAt(0, adc), want));
}
test("mode 0 duty is monotonic non-increasing across the whole ADC range", () => {
  let prev = Infinity;
  for (let adc = 0; adc <= 1023; adc += 7) {
    const v = L.pwmAt(0, adc);
    assert.ok(v <= prev, `rose at adc ${adc}`);
    assert.ok(v >= 18 && v <= 255);
    prev = v;
  }
});
test("mode 1 breath triangle at known timestamps", () => {
  assert.equal(L.pwmAt(1, 0, 0), 0);
  assert.equal(L.pwmAt(1, 0, 12 * 128), 128);
  assert.equal(L.pwmAt(1, 0, 12 * 255), 255);
  assert.equal(L.pwmAt(1, 0, 12 * 300), 211);
  assert.equal(L.pwmAt(1, 0, 12 * 511), 0);
  assert.equal(L.pwmAt(1, 512, 12 * 100), 100); // adc ignored
});
test("mode 2 beacon toggles 0/240 every 250 ms", () => {
  assert.equal(L.pwmAt(2, 0, 0), 0);
  assert.equal(L.pwmAt(2, 0, 249), 0);
  assert.equal(L.pwmAt(2, 0, 250), 240);
  assert.equal(L.pwmAt(2, 0, 499), 240);
  assert.equal(L.pwmAt(2, 0, 500), 0);
  assert.equal(L.pwmAt(2, 1023, 250), 240); // adc ignored
});
test("mode 1 cycle mean is 127.5 with range 0..255", () => {
  const s = L.modeStats(1, 0);
  assert.equal(s.pwmMin, 0);
  assert.equal(s.pwmMax, 255);
  assert.equal(s.pwmMean, 127.5);
  assert.equal(s.variesWithAdc, false);
});
test("mode 2 cycle mean is 120 with range 0..240", () => {
  const s = L.modeStats(2, 999);
  assert.equal(s.pwmMin, 0);
  assert.equal(s.pwmMax, 240);
  assert.equal(s.pwmMean, 120);
});
test("pwmAt throws on an unknown mode", () => {
  assert.throws(() => L.pwmAt(3, 0), RangeError);
  assert.throws(() => L.modeStats(9, 0), RangeError);
});
test("ledCurrentMa obeys Ohm's law and clamps", () => {
  const max = ((5.0 - 2.0) / 330) * 1000;
  assert.equal(L.ledCurrentMa(0), 0);
  assert.ok(Math.abs(L.ledCurrentMa(1) - max) < 1e-9);
  assert.equal(L.ledCurrentMa(2), max);
  assert.equal(L.ledCurrentMa(-1), 0);
  assert.ok(Math.abs(L.ledCurrentMa(0.5) - max / 2) < 1e-9);
});
test("nodeCurrentMa adds status draw per mode", () => {
  const base = L.nodeCurrentMa(0, 0.5);
  assert.ok(L.nodeCurrentMa(1, 0.5) > base); // status LED solid
  assert.ok(L.nodeCurrentMa(2, 0.5) > base); // status LED blinking
  assert.ok(L.nodeCurrentMa(1, 0.5) > L.nodeCurrentMa(2, 0.5));
});
test("sweepMode produces the requested count with ADC endpoints", () => {
  for (const m of [0, 1, 2]) {
    const pts = L.sweepMode(m, 13);
    assert.equal(pts.length, 13);
    assert.equal(pts[0].adc, 0);
    assert.equal(pts[12].adc, 1023);
    for (const p of pts) {
      assert.ok(Number.isFinite(p.dutyPct) && p.dutyPct >= 0 && p.dutyPct <= 100);
      assert.ok(Number.isFinite(p.ledMa) && p.ledMa >= 0);
      assert.ok(Number.isFinite(p.nodeMa) && p.nodeMa >= L.ELEC.MCU_MA);
    }
  }
});
test("sweepMode rejects a count below 2", () => {
  assert.throws(() => L.sweepMode(0, 1), RangeError);
  assert.throws(() => L.sweepMode(0, 2.5), RangeError);
});
for (const m of [0, 1, 2]) {
  test(`mode ${m} sweep: dutyPct equals pwmMean/255*100`, () => {
    for (const p of L.sweepMode(m, 13)) {
      assert.ok(Math.abs(p.dutyPct - (p.pwmMean / 255) * 100) < 1e-9);
      assert.ok(Math.abs(p.ledMa - L.ledCurrentMa(p.pwmMean / 255)) < 1e-9);
      assert.ok(Math.abs(p.nodeMa - L.nodeCurrentMa(m, p.pwmMean / 255)) < 1e-9);
    }
  });
}

// ---------------------------------------------------------------------------
// Proof digest, tamper demo, export surfaces
// ---------------------------------------------------------------------------

const state0 = { mode: 0, net: -1, sample: -1, tamper: 0 };
const stamped0 = L.stampProof(L.buildProofPayload(board, bom, state0));

test("proof payload reports the real board facts", () => {
  const p = stamped0.payload;
  assert.deepEqual(p.board.outlineMm, [36, 26]);
  assert.equal(p.board.footprints, 12);
  assert.equal(p.board.namedNets, 11);
  assert.equal(p.board.padsPlaced, 33);
  assert.equal(p.board.trackSegments, 45);
  assert.equal(p.board.openConnections, 0);
  assert.equal(p.board.readyToOrder, true);
});
test("proof payload reports the real bom facts", () => {
  const p = stamped0.payload;
  assert.equal(p.bom.lineItems, 12);
  assert.equal(p.bom.parts, 12);
  assert.equal(p.bom.costUsd, 1.76);
  assert.equal(p.bom.placedUsd, 1.76);
  assert.equal(p.bom.remainingUsd, 0);
});
test("stampProof caches one entry per canonical state", () => {
  const again = L.stampProof(L.buildProofPayload(board, bom, { ...state0 }));
  assert.equal(again, stamped0);
  assert.equal(again.digest, stamped0.digest);
});
test("stampProof digest equals sha256 of the canonical key", () => {
  assert.equal(stamped0.digest, refSha(stamped0.key));
});
test("all four surfaces stamp the identical digest", () => {
  const json = JSON.parse(L.proofJson(stamped0));
  assert.equal(json.sha256, stamped0.digest);
  const csv = L.proofCsv(stamped0);
  assert.ok(csv.split("\r\n").some((l) => l === `sha256,${stamped0.digest}`));
  assert.ok(L.proofMarkdown(stamped0).includes(`SHA-256: \`${stamped0.digest}\``));
});
test("state change moves the digest", () => {
  const s1 = L.stampProof(L.buildProofPayload(board, bom, { ...state0, mode: 1 }));
  const s2 = L.stampProof(L.buildProofPayload(board, bom, { ...state0, net: 3 }));
  assert.notEqual(s1.digest, stamped0.digest);
  assert.notEqual(s2.digest, stamped0.digest);
  assert.notEqual(s1.digest, s2.digest);
});
test("tamper demo adds exactly one open connection and flips the digest", () => {
  const t = L.tamperDemo(stamped0);
  assert.notEqual(t.after.digest, t.before.digest);
  assert.equal(t.after.payload.board.openConnections, t.before.payload.board.openConnections + 1);
});
test("proofCsv escapes formula-style values", () => {
  const evil = L.stampProof({ schema: "t", board: { outlineMm: [1, 1], footprints: 0, namedNets: 0, padsPlaced: 0, trackSegments: 0, openConnections: 0, singlePadNets: ["=x"], readyToOrder: false }, bom: { lineItems: 0, parts: 0, costUsd: 0, placedUsd: 0, remainingUsd: 0 }, mode: { id: 0, key: "a", sampleAdc: 0, pwmMean: 0, dutyPct: 0, ledMa: 0, nodeMa: 0 }, selectedNet: "-net", tamperDemo: 0 });
  const csv = L.proofCsv(evil);
  assert.ok(csv.includes('"\'=x"') || csv.includes("'=x"));
  assert.ok(csv.includes("'-net"));
});
test("proofJson is valid JSON that round-trips the payload", () => {
  const parsed = JSON.parse(L.proofJson(stamped0));
  assert.equal(parsed.sha256, stamped0.digest);
  assert.equal(L.canonicalize(parsed.proof), stamped0.key);
});
test("proofMarkdown carries honest counts and dollar amounts in backticks", () => {
  const md = L.proofMarkdown(stamped0);
  assert.ok(md.includes("`$1.76`") && md.includes("`$0.00`"));
  assert.ok(md.includes("36 x 26 mm"));
  assert.ok(md.includes("Ready to order: yes"));
});

// ---------------------------------------------------------------------------
// markerHitRadius
// ---------------------------------------------------------------------------

test("markerHitRadius caps at half the nearest gap", () => {
  assert.equal(L.markerHitRadius([0, 40, 80], 12), 12);
  assert.equal(L.markerHitRadius([0, 10, 80], 12), 5);
  assert.equal(L.markerHitRadius([0, 4, 8], 12), 2);
});
test("markerHitRadius handles degenerate inputs", () => {
  assert.equal(L.markerHitRadius([], 12), 12);
  assert.equal(L.markerHitRadius([5], 12), 12);
  assert.equal(L.markerHitRadius([0, 0, 0], 12), 12);
  assert.equal(L.markerHitRadius([0, NaN, 3], 12), 12);
  assert.equal(L.markerHitRadius([0, 4], -3), 0);
});

// ---------------------------------------------------------------------------
// runSelfTests: the exact in-page suite, verified in Node
// ---------------------------------------------------------------------------

test("in-page self-test suite runs >= 18 checks and all pass", async () => {
  const checks = await L.runSelfTests({ pcb, bomText, refSha256: refSha, samples: 13 });
  assert.ok(checks.length >= 18, `only ${checks.length} checks`);
  const failed = checks.filter((c) => !c.ok);
  assert.deepEqual(failed, [], failed.map((c) => `${c.name}: ${c.detail}`).join("\n"));
});

// ---------------------------------------------------------------------------
// DOM wiring: markup, styles and module references exist
// ---------------------------------------------------------------------------

const DOM_IDS = [
  "lab", "lab-modes", "lab-mode-note", "lab-net-table", "lab-net-rows",
  "lab-chart-pwm", "lab-pwm-readout", "lab-chart-bom", "lab-bom-readout",
  "lab-digest", "lab-verify", "lab-tamper", "lab-dl-json", "lab-dl-csv",
  "lab-dl-md", "lab-proof-note", "lab-run-tests", "lab-test-count", "lab-tests",
];
for (const id of DOM_IDS) {
  test(`index.html carries #${id}`, () => assert.ok(html.includes(`id="${id}"`)));
}
test("nav links to the lab section", () => {
  assert.match(html, /<a href="#lab">Lab<\/a>/);
});
test("modulepreloads and dynamic import cover node-lab and lab-ui", () => {
  assert.ok(html.includes('modulepreload" href="assets/node-lab.js'));
  assert.ok(html.includes('modulepreload" href="assets/lab-ui.js'));
  assert.ok(html.includes('import("./assets/lab-ui.js")'));
});
test("lab init is inside try/catch so a missing module degrades gracefully", () => {
  assert.match(html, /try\s*\{\s*const\s*\{\s*initLab\s*\}\s*=\s*await\s+import\("\.\/assets\/lab-ui\.js"\)/);
  assert.match(html, /catch\s*\(err\)\s*\{\s*console\.warn\("readiness lab unavailable/);
});
test("lab net rows bridge to the main inspector via onSelectNet", () => {
  assert.match(html, /onSelectNet:\s*\(name,\s*on\)/);
  assert.match(labUiSrc, /onSelectNet\?\.\(n\.name,\s*state\.net\s*===\s*n\.id\)/);
});
test("lab table markup carries the comparator columns", () => {
  for (const col of ["Pin", "Net", "Pads on board", "Tracks", "Open", "Parts awaiting pads", "Status"]) {
    assert.ok(html.includes(`<th` + (col === "Pin" || col === "Tracks" || col === "Open" ? ` class="num">${col}` : `>${col}`)), col);
  }
});
test("css guards mobile layout with minmax(0,1fr) and min-width:0", () => {
  assert.match(css, /\.lab-grid\s*\{[^}]*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.lab-charts\s*\{[^}]*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.lab-card\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.table-wrap\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /@media\s*\(max-width:\s*1000px\)[\s\S]*\.lab-grid,\s*\.lab-charts\s*\{[^}]*minmax\(0,\s*1fr\)/);
});
test("markers and bars are keyboard focusable with adaptive hit targets", () => {
  assert.match(labUiSrc, /tabindex:\s*0,\s*role:\s*"button"/);
  assert.match(labUiSrc, /markerHitRadius/);
  assert.match(labUiSrc, /class:\s*"hit"[\s\S]{0,80}fill:\s*"transparent"/);
});
test("hash codec writes and restores the pnlab hash", () => {
  assert.match(labUiSrc, /#pnlab=\$\{L\.encodeLabHash\(state\)\}/);
  assert.match(labUiSrc, /decodeLabHash\(location\.hash\)/);
});
test("self-test runner is wired and reports a pass count", () => {
  assert.match(labUiSrc, /lab-run-tests/);
  assert.match(labUiSrc, /runSelfTests/);
  assert.match(labUiSrc, /\$\{pass\}\/\$\{checks\.length\}\s*pass/);
});
test("node-lab has no DOM or network dependencies", () => {
  for (const bad of ["document.", "window.", "fetch(", "XMLHttpRequest", "localStorage", "Date.now", "Math.random", "new Date("]) {
    assert.ok(!labSrc.includes(bad), `node-lab.js uses ${bad}`);
  }
});
test("lab exports are all present for the UI and tests", () => {
  for (const name of [
    "sha256Hex", "canonicalize", "analyzeBoard", "parseBom", "arduinoMap", "pwmAt",
    "modeStats", "ledCurrentMa", "statusCurrentMa", "nodeCurrentMa", "sweepMode",
    "normalizeState", "encodeLabHash", "decodeLabHash", "csvCell", "csvRows",
    "buildProofPayload", "stampProof", "proofJson", "proofCsv", "proofMarkdown",
    "tamperDemo", "runSelfTests", "markerHitRadius", "MODES", "ELEC", "STATE_DEFAULTS",
    "ADC_MIN", "ADC_MAX", "NET_EXPECTED",
  ]) {
    assert.equal(typeof L[name], name === "MODES" || name === "ELEC" || name === "STATE_DEFAULTS" || name === "NET_EXPECTED" ? "object" : name === "ADC_MIN" || name === "ADC_MAX" ? "number" : "function", name);
  }
});
