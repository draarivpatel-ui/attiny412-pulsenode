import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../assets/node-lab.js";
import { readFileSync } from "node:fs";

test("arduinoMap rejects non-finite inputs and a zero input span", () => {
  assert.throws(() => L.arduinoMap(1, 1, 1, 0, 255), RangeError);
  assert.throws(() => L.arduinoMap(NaN, 0, 1023, 0, 255), TypeError);
  assert.throws(() => L.arduinoMap(0, -Infinity, 1023, 0, 255), TypeError);
});

test("pwmAt rejects non-finite ADC or time and negative time", () => {
  for (const adc of [NaN, Infinity, -Infinity]) assert.throws(() => L.pwmAt(0, adc), TypeError);
  for (const t of [NaN, Infinity, -Infinity, -1]) assert.throws(() => L.pwmAt(1, 0, t), TypeError);
});

test("current model rejects unknown modes and non-finite duty", () => {
  assert.throws(() => L.statusCurrentMa(3), RangeError);
  assert.throws(() => L.nodeCurrentMa(3, 0.5), RangeError);
  assert.throws(() => L.ledCurrentMa(NaN), TypeError);
  assert.throws(() => L.ledCurrentMa(Infinity), TypeError);
});

test("sweepMode bounds count to the ADC resolution", () => {
  assert.equal(L.sweepMode(0, 1025).length, 1025);
  assert.throws(() => L.sweepMode(0, 1026), RangeError);
});

test("markerHitRadius rejects a non-finite requested radius", () => {
  assert.throws(() => L.markerHitRadius([0, 10], NaN), TypeError);
  assert.throws(() => L.markerHitRadius([0, 10], Infinity), TypeError);
});


test("primary button ink meets WCAG AA contrast on the accent token", () => {
  const sheet = readFileSync(new URL("../assets/sheet.css", import.meta.url), "utf8");
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const token = (source, name) => {
    const match = source.match(new RegExp("--" + name + ":\\s*oklch\\(([-0-9.]+)%\\s+([-0-9.]+)\\s+([-0-9.]+)\\)"));
    assert.ok(match, name + " token exists");
    const parsed = match.slice(1).map(Number);
    parsed[0] /= 100;
    return parsed;
  };
  const linear = ([L, C, H]) => {
    const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541729 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      Math.max(0, Math.min(1, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
      Math.max(0, Math.min(1, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
      Math.max(0, Math.min(1, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)),
    ];
  };
  const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const ink = lum(linear(token(sheet, "color-ink")));
  const accent = lum(linear(token(page, "accent")));
  assert.ok(ratio(ink, accent) >= 4.5, ratio(ink, accent).toFixed(2));
});

test("skip link hover keeps paper text on its ink background", () => {
  const sheet = readFileSync(new URL("../assets/sheet.css", import.meta.url), "utf8");
  assert.match(sheet, /\.skip:hover, \.skip-link:hover\s*\{[^}]*color:\s*var\(--color-paper\)/);
});
