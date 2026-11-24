import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../assets/node-lab.js";

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
