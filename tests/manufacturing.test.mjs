import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function audit() {
  const out = execFileSync("python3", [path.join(root, "tools/audit_pcb.py")], { cwd: root, encoding: "utf8" });
  return JSON.parse(out);
}

test("static manufacturing audit passes with zero violations", () => {
  const a = audit();
  assert.deepEqual(a.violations, []);
  assert.equal(a.ok, true);
});

test("all 12 BOM parts are placed and every net is routed", () => {
  const a = audit();
  assert.equal(a.footprints, 12);
  assert.equal(a.bomParts, 12);
  assert.equal(a.unroutedJoins, 0);
  assert.equal(a.singlePadNets, 0);
});

test("clearances meet the local static DRC floor", () => {
  const a = audit();
  assert.ok(a.copperClearanceMm >= 0.25, `copper ${a.copperClearanceMm}`);
  assert.ok(a.edgeClearanceMm >= 0.4, `edge ${a.edgeClearanceMm}`);
});

test("generator output is deterministic and both PCB copies match", () => {
  const before = readFileSync(path.join(root, "attiny412-pulsenode.kicad_pcb"), "utf8");
  execFileSync("python3", [path.join(root, "tools/generate_pcb.py")], { cwd: root, encoding: "utf8" });
  const after = readFileSync(path.join(root, "attiny412-pulsenode.kicad_pcb"), "utf8");
  const copy = readFileSync(path.join(root, "pcb/attiny412-pulsenode.kicad_pcb"), "utf8");
  assert.equal(after, before);
  assert.equal(copy, after);
});

test("Gerber set has both copper layers, masks, paste, silkscreen, outline and drill", () => {
  const names = readdirSync(path.join(root, "gerbers")).filter((x) => x.endsWith(".gbr") || x.endsWith(".drl"));
  for (const want of [
    "attiny412-pulsenode-F_Cu.gbr", "attiny412-pulsenode-B_Cu.gbr",
    "attiny412-pulsenode-F_Mask.gbr", "attiny412-pulsenode-B_Mask.gbr",
    "attiny412-pulsenode-F_Paste.gbr", "attiny412-pulsenode-F_Silkscreen.gbr",
    "attiny412-pulsenode-Edge_Cuts.gbr", "attiny412-pulsenode-PTH.drl",
  ]) assert.ok(names.includes(want), want);
  const drill = readFileSync(path.join(root, "gerbers/attiny412-pulsenode-PTH.drl"), "utf8");
  assert.match(drill, /T1C0\.400/);
  assert.match(drill, /T2C0\.800/);
  assert.match(drill, /T3C1\.000/);
  assert.equal((drill.match(/^X/mg) || []).length, 13);
});

test("schematic covers all 12 refs and the intermediate series nets", () => {
  const sch = readFileSync(path.join(root, "attiny412-pulsenode.kicad_sch"), "utf8");
  const copy = readFileSync(path.join(root, "pcb/attiny412-pulsenode.kicad_sch"), "utf8");
  assert.equal(copy, sch);
  for (const ref of ["U1", "C1", "R1", "R2", "R3", "R4", "D1", "D2", "Q1", "SW1", "BZ1", "J1"]) {
    assert.ok(sch.includes(`"Reference" "${ref}"`), ref);
  }
  for (const net of ["PWM_LED", "STATUS_LED", "UPDI_HDR", "PA7_LDR", "PA6_PIEZO", "PA1_BTN"]) {
    assert.ok(sch.includes(`(label "${net}"`), net);
  }
});
