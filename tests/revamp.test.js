const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/sheet.css'), 'utf8');
const viewerSrc = fs.readFileSync(path.join(root, 'assets/viewer.js'), 'utf8');

const TEXT_EXT = new Set(['.md', '.html', '.css', '.js', '.py', '.csv', '.json', '.svg', '.txt', '.step', '.ino', '.gbr', '.drl', '.kicad_sch', '.kicad_pcb', '.kicad_pro']);
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'tests' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) yield p;
  }
}

test('repo text files contain no em/en dashes, AI mentions, smooth scroll, or vendor-prefixed placeholders', () => {
  const dash = /[\u2013\u2014]/;
  const ai = /\b(claude|anthropic|openai|chatgpt|gpt-\d|copilot|devin|swe-2|codex)\b|ai-generated/i;
  const secret = /(tskey-|ghp_|github_pat_|AKIA|xox[baprs]-|gsk_|nvapi-|tvly-|AIza[0-9A-Za-z]|sk-[a-zA-Z0-9]{8,})/;
  const bad = [];
  for (const f of walk(root)) {
    const t = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    if (dash.test(t)) bad.push(`${rel}: en/em dash`);
    if (ai.test(t)) bad.push(`${rel}: AI mention`);
    if (/scroll-behavior\s*:\s*smooth/.test(t)) bad.push(`${rel}: scroll-behavior smooth`);
    if (secret.test(t)) bad.push(`${rel}: vendor-prefixed placeholder`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('ui.js number formatting handles edge inputs', async () => {
  const src = fs.readFileSync(path.join(root, 'assets/ui.js'), 'utf8');
  const ui = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));
  assert.equal(ui.mm(36, 1), '36 mm');
  assert.equal(ui.mm(1.6, 2), '1.6 mm');
  assert.equal(ui.num(0.15, 2), '0.15');
  assert.equal(ui.fmtBytes(0), '0 B');
  assert.equal(ui.fmtBytes(1023), '1023 B');
  assert.equal(ui.fmtBytes(1024), '1.0 KB');
  assert.equal(ui.fmtBytes(1048576), '1.00 MB');
});

test('3D viewer failure path cannot take the whole page down', () => {
  assert.match(html, /try\s*\{\s*viewer\s*=\s*await\s+createViewer/, 'createViewer must be called inside try/catch');
  assert.match(html, /catch\s*\(err\)[\s\S]{0,200}3D viewer unavailable/, 'catch must warn instead of propagating');
});

test('no-viewer fallback hides the whole 3D toolbar including the separator', () => {
  const block = html.match(/if\s*\(!viewer\)\s*\{([\s\S]*?)\}\s*else\s*\{/);
  assert.ok(block, 'fallback block not found');
  for (const id of ['#views', '#wire', '#hint', '#sep1']) {
    assert.ok(block[1].includes(`$("${id}").hidden = true`), `${id} left visible in 2D-only fallback`);
  }
});

test('net picker cannot stick on NaN when a net name has no id', () => {
  assert.match(html, /raw\s*=\s*idOf\(n\.net\)[\s\S]{0,80}raw\s*===\s*undefined/, 'idOf result is not guarded');
});

test('banner names the single-pad nets, not their pad refs', () => {
  assert.match(html, /lonely\.map\(\(n\)\s*=>\s*n\.net\)/);
});

test('viewer.js falls back instead of rendering black on a missing CSS token', () => {
  assert.match(viewerSrc, /if\s*\(!value\)\s*return\s+new\s+T\.Color\(fallback\)/);
});

test('no innerHTML-style injection sinks anywhere in the page or shared JS', () => {
  const js = fs.readFileSync(path.join(root, 'assets/ui.js'), 'utf8') + viewerSrc;
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
    assert.ok(!html.includes(sink) && !js.includes(sink), `found ${sink}`);
  }
  assert.ok(!/href\s*=\s*["']?\s*javascript:/i.test(html), 'javascript: href present');
});

test('2D board svg is not touch-locked (mobile users can scroll over it)', () => {
  assert.ok(!/\.canvas\s+svg\s*\{[^}]*touch-action\s*:\s*none/.test(css), '.canvas svg still sets touch-action:none');
  assert.match(css, /\.canvas\s+\.gl\s+canvas\s*\{[^}]*touch-action\s*:\s*none/, 'WebGL canvas lost its own touch lock');
});

test('pcb.json matches the board facts the README claims', () => {
  const pcb = JSON.parse(fs.readFileSync(path.join(root, 'assets/pcb.json'), 'utf8'));
  assert.deepEqual(pcb.outline && { w: pcb.outline.w, h: pcb.outline.h }, { w: 36, h: 26 });
  assert.deepEqual(pcb.cad.size, [36, 26, 1.6]);
  assert.equal(pcb.cad.valid, true);
  assert.equal(pcb.footprints.length, 4);
  const unrouted = pcb.connectivity.reduce((s, n) => s + n.missing, 0);
  assert.equal(unrouted, 3, 'expected 3 unrouted connections');
  const lonely = pcb.connectivity.filter((n) => n.single_pad);
  assert.equal(lonely.length, 4, 'expected 4 single-pad nets');
  const netIds = new Set(Object.keys(pcb.nets));
  for (const n of pcb.connectivity) assert.ok([...netIds].some((id) => pcb.nets[id] === n.net), `net ${n.net} missing from nets map`);
  for (const f of pcb.footprints) for (const p of f.pads) assert.ok(netIds.has(String(p.net)), `pad ${f.ref}.${p.number} references unknown net ${p.net}`);
});

test('bom.csv parses cleanly, has no formula-injection cells, and quantities sum to 12', () => {
  const rows = fs.readFileSync(path.join(root, 'bom.csv'), 'utf8').trim().split(/\r?\n/);
  assert.equal(rows[0], 'Reference,Value,Footprint,Quantity,MPN,Supplier,Unit_Cost_USD');
  const data = rows.slice(1);
  assert.equal(data.length, 11);
  let qty = 0;
  const refs = new Set();
  for (const r of data) {
    const c = r.split(',');
    assert.equal(c.length, 7, `malformed row: ${r}`);
    assert.ok(!/^[=+\-@]/.test(c[0]) && !/^[=+\-@]/.test(c[1]) && !/^[=+\-@]/.test(c[4]), `formula-style cell in row: ${r}`);
    qty += parseInt(c[3], 10) || 0;
    refs.add(c[0]);
  }
  assert.equal(refs.size, data.length, 'duplicate reference designators');
  assert.equal(qty, 12);
});

test('JOURNAL.md describes the board that actually exists', () => {
  const j = fs.readFileSync(path.join(root, 'JOURNAL.md'), 'utf8');
  assert.match(j, /36x26|36 x 26/, 'journal keeps a wrong board size');
  for (const wrong of ['35x25', '35 x 25', 'soil', 'sleep', '1M Ohm']) {
    assert.ok(!j.toLowerCase().includes(wrong.toLowerCase()), `journal still claims ${wrong}`);
  }
});

test('firmware mode comment matches the sketch behavior and README', () => {
  const ino = fs.readFileSync(path.join(root, 'firmware/attiny412_pulsenode.ino'), 'utf8');
  assert.match(ino, /breathing pulse/);
  assert.ok(!ino.includes('25-min'), 'stale mode name still in firmware');
  for (const pin of ['PIN_PA6', 'PIN_PA7', 'PIN_PA1', 'PIN_PA2', 'PIN_PA3']) assert.ok(ino.includes(pin), `missing ${pin}`);
  assert.match(ino, /%\s*512/, 'breath phase not full-scale');
});

const PY = String.raw`
import importlib.util, json, sys, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location("ba", sys.argv[1] + "/tools/build_assets.py")
ba = importlib.util.module_from_spec(spec); spec.loader.exec_module(ba)
out = {}

# parse_sexp must read scientific notation and signed/dotted floats
out["sexp"] = ba.parse_sexp('(at 1e-3 0.5 -2 +3.25)')
assert out["sexp"] == ["at", 0.001, 0.5, -2.0, 3.25], out["sexp"]

# connectivity: a pad reached through a mid-board junction counts as routed
board = {"nets": {0: "", 1: "N"}, "segments": [
    {"x1": 0, "y1": 0, "x2": 5, "y2": 5, "width": .3, "layer": "F.Cu", "net": 1},
    {"x1": 5, "y1": 5, "x2": 9, "y2": 0, "width": .3, "layer": "F.Cu", "net": 1}],
 "footprints": [{"ref": "A", "pads": [{"number": "1", "x": 0, "y": 0, "net": 1, "net_name": "N", "ref": "A", "kind": "smd", "shape": "rect", "w": 1, "h": 1, "drill": None, "rratio": 0}]},
                {"ref": "B", "pads": [{"number": "1", "x": 9, "y": 0, "net": 1, "net_name": "N", "ref": "B", "kind": "smd", "shape": "rect", "w": 1, "h": 1, "drill": None, "rratio": 0},
                                      {"number": "2", "x": 9, "y": 9, "net": 1, "net_name": "N", "ref": "B", "kind": "smd", "shape": "rect", "w": 1, "h": 1, "drill": None, "rratio": 0}]}],
 "outline": {"x": 0, "y": 0, "w": 10, "h": 10, "width": .15}, "texts": []}
rep = ba.connectivity(board)[0]
assert rep["missing"] == 1, rep  # A.1+B.1 chained, B.2 isolated -> 1 missing, not 2

# gerber drill file supports multiple drill sizes and zero holes
board2 = dict(board, footprints=[{"ref": "J", "x": 5, "y": 5, "ref_at": [5, 3], "rects": [], "pads": [
    {"number": "1", "kind": "thru_hole", "shape": "oval", "x": 5, "y": 5, "w": 1.7, "h": 2.4, "drill": 1.0, "rratio": 0, "net": 1, "net_name": "N", "ref": "J"},
    {"number": "2", "kind": "thru_hole", "shape": "oval", "x": 5, "y": 8, "w": 1.7, "h": 2.4, "drill": 0.8, "rratio": 0, "net": 1, "net_name": "N", "ref": "J"}]}])
with tempfile.TemporaryDirectory() as td:
    ba.build_gerbers(board2, Path(td))
    drl = (Path(td) / "attiny412-pulsenode-PTH.drl").read_text()
assert "T1C0.800" in drl and "T2C1.000" in drl, drl

# oval pads with w != h no longer crash pad_on (stadium region)
with tempfile.TemporaryDirectory() as td:
    ba.build_gerbers(board2, Path(td))
    fcu = (Path(td) / "attiny412-pulsenode-F_Cu.gbr").read_text()
assert "G36" in fcu, fcu

# rotation: a 90-degree footprint rotates pad offsets and swaps w/h
kicad = """(kicad_pcb (version 20240108) (generator test)
  (gr_rect (start 0 0) (end 10 10) (stroke (width 0.15) (type solid)) (layer "Edge.Cuts"))
  (net 0 "") (net 1 "N")
  (footprint "X:X" (layer "F.Cu") (at 50 50 90)
    (property "Reference" "U9" (at 0 -2 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.1))))
    (property "Value" "V" (at 0 2 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.1))))
    (pad "1" smd rect (at -3 0) (size 2 1) (layers "F.Cu") (net 1 "N"))))"""
with tempfile.TemporaryDirectory() as td:
    p = Path(td) / "b.kicad_pcb"; p.write_text(kicad)
    old = ba.PCB; ba.PCB = p
    try:
        b = ba.load_board()
    finally:
        ba.PCB = old
pad = b["footprints"][0]["pads"][0]
assert abs(pad["x"] - 50) < 1e-6 and abs(pad["y"] - 47) < 1e-6, pad  # (-3,0) rot90 -> (0,-3)
assert (pad["w"], pad["h"]) == (1, 2), pad                          # w/h swapped at odd quarter-turn
ref = b["footprints"][0]["ref_at"]
assert abs(ref[0] - 52) < 1e-6 and abs(ref[1] - 50) < 1e-6, ref        # (0,-2) rot90 -> (2,0)

# shipped pcb.json still equals a fresh parse plus connectivity (no regen drift)
live = ba.load_board(); live["connectivity"] = ba.connectivity(live)
old = json.load(open(sys.argv[1] + "/assets/pcb.json"))
for k in ("nets", "outline", "texts", "footprints", "segments", "connectivity"):
    assert json.dumps(live[k], sort_keys=True) == json.dumps(old[k], sort_keys=True), k
print(json.dumps({"ok": True}))
`;

test('build_assets.py parser, connectivity, gerber and drill writers behave', () => {
  const out = execFileSync('python3', ['-c', PY, root], { encoding: 'utf8', cwd: root });
  assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), { ok: true });
});

test('python tools stay syntactically valid', () => {
  assert.doesNotThrow(() => execFileSync('python3', ['-m', 'py_compile', path.join(root, 'tools/build_assets.py')]));
});
