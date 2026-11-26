#!/usr/bin/env python3
"""Generate the complete PulseNode schematic deterministically."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_n = 0


def uuid():
    global _n
    _n += 1
    return "b4120000-0000-4000-8000-%012x" % _n


def fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def lib_two(name, ref, p1="1", p2="2", n1="A", n2="B"):
    return f'''    (symbol "PulseNode:{name}"
      (in_bom yes) (on_board yes)
      (property "Reference" "{ref}" (at 0 5.08 0) (effects (font (size 1.27 1.27))))
      (property "Value" "{name}" (at 0 -5.08 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 -7.62 0) (effects (font (size 1.27 1.27)) hide))
      (symbol "{name}_0_1"
        (rectangle (start -5.08 2.54) (end 5.08 -2.54) (stroke (width 0.254) (type default)) (fill (type background)))
      )
      (symbol "{name}_1_1"
        (pin passive line (at -7.62 0 0) (length 2.54) (name "{n1}") (number "{p1}"))
        (pin passive line (at 7.62 0 180) (length 2.54) (name "{n2}") (number "{p2}"))
      )
    )'''


def inst(lib, ref, value, footprint, x, y):
    return f'''  (symbol (lib_id "PulseNode:{lib}") (at {fmt(x)} {fmt(y)} 0) (unit 1)
    (in_bom yes) (on_board yes)
    (uuid "{uuid()}")
    (property "Reference" "{ref}" (at {fmt(x)} {fmt(y - 5.08)} 0) (effects (font (size 1.27 1.27))))
    (property "Value" "{value}" (at {fmt(x)} {fmt(y + 5.08)} 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "{footprint}" (at {fmt(x)} {fmt(y + 7.62)} 0) (effects (font (size 1.27 1.27)) hide))
  )'''


def wire(x1, y1, x2, y2):
    return f'  (wire (pts (xy {fmt(x1)} {fmt(y1)}) (xy {fmt(x2)} {fmt(y2)})) (stroke (width 0) (type default)) (uuid "{uuid()}")'


def label(net, x, y):
    return f'  (label "{net}" (at {fmt(x)} {fmt(y)} 0) (effects (font (size 1.27 1.27))) (uuid "{uuid()}")'


def two_pin_instance(lib, ref, value, footprint, x, y, left_net, right_net):
    return "\n".join([
        inst(lib, ref, value, footprint, x, y),
        wire(x - 7.62, y, x - 11.43, y),
        wire(x + 7.62, y, x + 11.43, y),
        label(left_net, x - 11.43, y),
        label(right_net, x + 11.43, y),
    ])


MCU_LIB = '''    (symbol "MCU_Microchip_ATtiny:ATtiny412-SS"
      (in_bom yes) (on_board yes)
      (property "Reference" "U" (at 0 10.16 0) (effects (font (size 1.27 1.27))))
      (property "Value" "ATtiny412-SSNR" (at 0 -10.16 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" (at 0 -12.7 0) (effects (font (size 1.27 1.27)) hide))
      (symbol "ATtiny412-SS_0_1"
        (rectangle (start -7.62 7.62) (end 7.62 -7.62) (stroke (width 0.254) (type default)) (fill (type background)))
      )
      (symbol "ATtiny412-SS_1_1"
        (pin power_in line (at -10.16 5.08 0) (length 2.54) (name "VCC") (number "1"))
        (pin bidirectional line (at -10.16 2.54 0) (length 2.54) (name "PA6/DAC") (number "2"))
        (pin bidirectional line (at -10.16 -2.54 0) (length 2.54) (name "PA7/AIN7") (number "3"))
        (pin bidirectional line (at -10.16 -5.08 0) (length 2.54) (name "PA1/SDA") (number "4"))
        (pin bidirectional line (at 10.16 -5.08 180) (length 2.54) (name "PA2/SCL") (number "5"))
        (pin bidirectional line (at 10.16 -2.54 180) (length 2.54) (name "PA0/UPDI") (number "6"))
        (pin bidirectional line (at 10.16 2.54 180) (length 2.54) (name "PA3/PWM") (number "7"))
        (pin power_in line (at 10.16 5.08 180) (length 2.54) (name "GND") (number "8"))
      )
    )'''

J1_LIB = '''    (symbol "PulseNode:UPDI_HDR"
      (in_bom yes) (on_board yes)
      (property "Reference" "J" (at 0 7.62 0) (effects (font (size 1.27 1.27))))
      (property "Value" "UPDI Power Header" (at 0 -7.62 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 -10.16 0) (effects (font (size 1.27 1.27)) hide))
      (symbol "UPDI_HDR_0_1"
        (rectangle (start -2.54 5.08) (end 5.08 -5.08) (stroke (width 0.254) (type default)) (fill (type background)))
      )
      (symbol "UPDI_HDR_1_1"
        (pin passive line (at -5.08 2.54 0) (length 2.54) (name "+5V") (number "1"))
        (pin passive line (at -5.08 0 0) (length 2.54) (name "UPDI") (number "2"))
        (pin passive line (at -5.08 -2.54 0) (length 2.54) (name "GND") (number "3"))
      )
    )'''

SW_LIB = '''    (symbol "PulseNode:SW_PTS645"
      (in_bom yes) (on_board yes)
      (property "Reference" "SW" (at 0 7.62 0) (effects (font (size 1.27 1.27))))
      (property "Value" "PTS645" (at 0 -7.62 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 -10.16 0) (effects (font (size 1.27 1.27)) hide))
      (symbol "SW_PTS645_0_1"
        (rectangle (start -5.08 5.08) (end 5.08 -5.08) (stroke (width 0.254) (type default)) (fill (type background)))
      )
      (symbol "SW_PTS645_1_1"
        (pin passive line (at -7.62 2.54 0) (length 2.54) (name "A1") (number "1"))
        (pin passive line (at -7.62 -2.54 0) (length 2.54) (name "A2") (number "2"))
        (pin passive line (at 7.62 2.54 180) (length 2.54) (name "B1") (number "3"))
        (pin passive line (at 7.62 -2.54 180) (length 2.54) (name "B2") (number "4"))
      )
    )'''


def generate():
    x, y = 127.0, 101.6
    parts = [
        "(kicad_sch", "  (version 20231120)", '  (generator "generate_schematic.py")',
        '  (generator_version "1.1")', f'  (uuid "{uuid()}")', '  (paper "A4")',
        "  (title_block",
        '    (title "ATtiny412 PulseNode: complete ambient light and PWM controller")',
        '    (date "2026-11-25")', '    (rev "1.1")', '    (company "Aariv Patel")',
        '    (comment 1 "MCU: ATtiny412-SSNR (SOIC-8)")',
        '    (comment 2 "Power and programming: 3-pin UPDI header J1")',
        "  )", "  (lib_symbols)", MCU_LIB,
        lib_two("R_0805", "R"), lib_two("C_0805", "C"), lib_two("LED_0805", "D", n1="A", n2="K"),
        lib_two("ALS_PT19", "Q", n1="C", n2="E"), lib_two("PIEZO_PS1240", "BZ", n1="SIG", n2="GND"),
        SW_LIB, J1_LIB, "  )",
    ]
    parts.append(f'''  (symbol (lib_id "MCU_Microchip_ATtiny:ATtiny412-SS") (at {fmt(x)} {fmt(y)} 0) (unit 1)
    (in_bom yes) (on_board yes)
    (uuid "{uuid()}")
    (property "Reference" "U1" (at {fmt(x)} {fmt(y - 10.16)} 0) (effects (font (size 1.27 1.27))))
    (property "Value" "ATtiny412-SSNR" (at {fmt(x)} {fmt(y + 10.16)} 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" (at {fmt(x)} {fmt(y + 12.7)} 0) (effects (font (size 1.27 1.27)) hide))
  )''')
    mcu_nets = [
        (x - 10.16, y - 5.08, x - 15.24, "+5V"),
        (x - 10.16, y - 2.54, x - 15.24, "PA6_PIEZO"),
        (x - 10.16, y + 2.54, x - 15.24, "PA7_LDR"),
        (x - 10.16, y + 5.08, x - 15.24, "PA1_BTN"),
        (x + 10.16, y + 5.08, x + 15.24, "PA2_STATUS"),
        (x + 10.16, y + 2.54, x + 15.24, "PA0_UPDI"),
        (x + 10.16, y - 2.54, x + 15.24, "PA3_PWM"),
        (x + 10.16, y - 5.08, x + 15.24, "GND"),
    ]
    for px, py, lx, net in mcu_nets:
        parts += [wire(px, py, lx, py), label(net, lx, py)]
    rfp = "Resistor_SMD:R_0805_2012Metric"
    rows = [
        ("C_0805", "C1", "100nF 50V X7R", "Capacitor_SMD:C_0805_2012Metric", 55, 45, "+5V", "GND"),
        ("R_0805", "R1", "10k Ohm 1%", rfp, 80, 45, "PA7_LDR", "GND"),
        ("ALS_PT19", "Q1", "ALS-PT19 Phototransistor", "LED_SMD:LED_0805_2012Metric", 105, 45, "+5V", "PA7_LDR"),
        ("PIEZO_PS1240", "BZ1", "Piezo Transducer 12mm", "Buzzer_Beeper:MagneticBuzzer_12x12mm", 55, 70, "PA6_PIEZO", "GND"),
        ("R_0805", "R2", "330 Ohm 1%", rfp, 80, 70, "PA3_PWM", "PWM_LED"),
        ("LED_0805", "D1", "Amber PWM LED", "LED_SMD:LED_0805_2012Metric", 105, 70, "PWM_LED", "GND"),
        ("R_0805", "R3", "4.7k Ohm UPDI", rfp, 80, 95, "PA0_UPDI", "UPDI_HDR"),
        ("R_0805", "R4", "330 Ohm 1%", rfp, 80, 120, "PA2_STATUS", "STATUS_LED"),
        ("LED_0805", "D2", "Emerald Status LED", "LED_SMD:LED_0805_2012Metric", 105, 120, "STATUS_LED", "GND"),
    ]
    for row in rows:
        parts.append(two_pin_instance(*row))
    parts += [
        inst("SW_PTS645", "SW1", "PTS645 Tactile Switch", "Button_Switch_SMD:SW_SPST_PTS645", 150, 55),
        wire(142.38, 52.46, 137.16, 52.46), label("PA1_BTN", 137.16, 52.46),
        wire(142.38, 57.54, 137.16, 57.54), label("PA1_BTN", 137.16, 57.54),
        wire(157.62, 52.46, 162.56, 52.46), label("GND", 162.56, 52.46),
        wire(157.62, 57.54, 162.56, 57.54), label("GND", 162.56, 57.54),
        inst("UPDI_HDR", "J1", "1x03 UPDI Pin Header", "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical", 150, 90),
        wire(144.92, 87.46, 139.7, 87.46), label("+5V", 139.7, 87.46),
        wire(144.92, 90, 139.7, 90), label("UPDI_HDR", 139.7, 90),
        wire(144.92, 92.54, 139.7, 92.54), label("GND", 139.7, 92.54),
        ")",
    ]
    return "\n".join(parts) + "\n"


def main():
    text = generate()
    for rel in ("attiny412-pulsenode.kicad_sch", "pcb/attiny412-pulsenode.kicad_sch"):
        (ROOT / rel).write_text(text)
    print("wrote complete schematic with 12 symbols")


if __name__ == "__main__":
    main()
