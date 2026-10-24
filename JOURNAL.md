# ATtiny412 PulseNode Build Journal

## October 24, 2026 - Designed ATtiny412 schematic, 2-layer PCB, and Gerbers (5.0h)

![ATtiny412 PulseNode PCB Layout](attiny412_pulsenode_pcb.png)

Designed the full schematic and 35x25mm 2-layer PCB in KiCad 8 around the 8-pin ATtiny412-SSNR SOIC-8 microcontroller. Placed a 100nF 0805 decoupling capacitor (`C1`) right across Pin 1 (`VDD`) and Pin 8 (`GND`), routed the single-wire UPDI programming header on `PA0` (Pin 6), wired the 1M Ohm RC relaxation oscillator network across `PA1` (Pin 4) and `PA2` (Pin 5) for capacitive soil moisture sensing, and routed two 0805 status LEDs on `PA6` (Pin 2) and `PA7` (Pin 3) through 330 Ohm current-limiting resistors. Exported the complete Gerber and Excellon drill files, BOM, and megaTinyCore STANDBY sleep firmware.
