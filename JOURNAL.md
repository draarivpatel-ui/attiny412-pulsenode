# ATtiny412 PulseNode Build Journal

## October 24, 2026 - Designed ATtiny412 schematic, 2-layer PCB, and Gerbers (5.0h)

![ATtiny412 PulseNode PCB Layout](attiny412_pulsenode_pcb.png)

Designed the full schematic and 36x26mm 2-layer PCB in KiCad 8 around the 8-pin ATtiny412-SSNR SOIC-8 microcontroller. Placed a 100nF 0805 decoupling capacitor (`C1`) across Pin 1 (`VDD`) and Pin 8 (`GND`), routed the single-wire UPDI programming header `J1` on `PA0` (Pin 6), and placed the amber PWM LED `D1` on `PA3` (Pin 7). The megaTinyCore firmware sketch drives an ambient-light response on `PA7` (Pin 3), reads the mode button on `PA1` (Pin 4), drives a status LED on `PA2` (Pin 5), and clicks a piezo on `PA6` (Pin 2). Exported the Gerber and Excellon drill files and the BOM for the board as it stands: 4 footprints placed, 3 connections on `+5V` and `GND` still unrouted, and the remaining BOM parts (resistors, status LED, phototransistor, tactile switch, piezo) not yet on the board.
