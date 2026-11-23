# ATtiny412 PulseNode

A compact 2-layer node built around the 8-pin ATtiny412-SSNR (SOIC-8) microcontroller: an ambient-light-driven PWM LED with a button, a status LED, and a piezo click. Designed in KiCad 8.

![ATtiny412 PulseNode PCB Layout](attiny412_pulsenode_pcb.png)

**Live inspector:** `index.html` (served by GitHub Pages at `https://aariv.me/attiny412-pulsenode/`) shows the board in 3D and 2D, the net routing status, and every download. It is generated from the KiCad file, so its numbers always match the board.

**Board readiness lab:** the same page carries a deterministic audit section (`assets/node-lab.js`, identical results in the browser and under `node --test`): an 8-net / SOIC-8 pin readiness comparator over the real `pcb.json` nets, a PWM duty and node-current curve that models all three firmware modes across the `0..1023` ADC sweep, a BOM cost split (`$1.76` total across 12 parts on 11 line items: `$0.68` placed, `$1.08` remaining), a single cached SHA-256 readiness proof shared by the on-page fingerprint and the JSON/CSV/Markdown exports (CSV is formula-injection safe), a fail-closed `#pnlab=` state hash, and an in-page self-test runner. `npm test` runs 402 checks.

## Current state

- The `.kicad_pcb` board is `36 x 26 x 1.6 mm`, 2 copper layers, and carries 4 placed footprints: `U1` (ATtiny412-SSNR), `C1` (100nF 0805), `D1` (amber LED, 0805) and `J1` (1x03 UPDI header).
- `bom.csv` lists 12 parts (also resistors, a status LED, a phototransistor, a tactile switch and a piezo). Those are not placed on the board yet, so four MCU pins (`PA6`, `PA7`, `PA1`, `PA2`) reach no other pad.
- 3 connections on `+5V` and `GND` are still unrouted. The Gerbers in `gerbers/` match the board as it stands today and are not a finished order package.

## Hardware Overview

- **Microcontroller** ATtiny412-SSNR (SOIC-8, UPDI single-wire programming on `PA0`, header `J1`)
- **Power** 5.0V and GND, with a 100nF 0805 ceramic capacitor (`C1`) across `VDD` (pin 1) and `GND` (pin 8)
- **Pin map** (from `firmware/attiny412_pulsenode.ino`) pin 2 `PA6` piezo, pin 3 `PA7` LDR input, pin 4 `PA1` button, pin 5 `PA2` status LED, pin 6 `PA0` UPDI, pin 7 `PA3` PWM LED
- **Board Dimensions** `36 x 26 mm`, 1.6 mm thick, as measured from the KiCad outline

## Repository Structure

- `attiny412-pulsenode.kicad_pro`, `attiny412-pulsenode.kicad_sch`, `attiny412-pulsenode.kicad_pcb` KiCad 8 project, schematic and PCB (copies also in `pcb/`)
- `gerbers/` Gerber layers and Excellon drill file for the current board, plus `attiny412-pulsenode-gerbers.zip`
- `bom.csv` Bill of Materials with LCSC, DigiKey and Microchip part numbers
- `firmware/attiny412_pulsenode.ino` megaTinyCore sketch: the button cycles three modes (ambient auto-dimming, a breathing pulse, a blinking beacon) with a piezo click
- `cad/` 3D assembly (`.step`, `.FCStd`) of the board with envelope bodies for the parts
- `assets/`, `tools/`, `index.html` the inspector page and the script (`tools/build_assets.py`) that regenerates its data, STL, STEP, Gerbers and hashes from the KiCad file

## Interactive Schematic & PCB Viewer

Inspect the schematic and PCB online via KiCanvas:
`https://kicanvas.org/?github=https%3A%2F%2Fgithub.com%2Fdraarivpatel-ui%2Fattiny412-pulsenode`
