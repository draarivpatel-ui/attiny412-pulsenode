#!/usr/bin/env python3
"""Generate the complete ATtiny412 PulseNode PCB layout deterministically.

The board is intentionally written as plain KiCad s-expressions so the layout,
the copied project in pcb/, the static audit, and the generated fabrication
outputs all come from one placement and routing table.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTLINE = (100.0, 85.0, 136.0, 111.0)

NETS = [
    (1, "+5V"),
    (2, "GND"),
    (3, "PA6_PIEZO"),
    (4, "PA7_LDR"),
    (5, "PA1_BTN"),
    (6, "PA2_STATUS"),
    (7, "PA0_UPDI"),
    (8, "PA3_PWM"),
    (9, "PWM_LED"),
    (10, "STATUS_LED"),
    (11, "UPDI_HDR"),
]
NET = dict(NETS)

_uuid_counter = 0


def uuid():
    global _uuid_counter
    _uuid_counter += 1
    return "a4120000-0000-4000-8000-%012x" % _uuid_counter


def fmt(v):
    s = f"{float(v):.3f}".rstrip("0").rstrip(".")
    return s if s not in ("-0", "") else "0"


def smd_pad(number, dx, dy, net, w=1.0, h=1.3):
    return dict(number=str(number), kind="smd", shape="roundrect", dx=dx, dy=dy,
                w=w, h=h, drill=None, net=net)


def th_pad(number, dx, dy, net, w=1.7, h=1.7, drill=1.0, shape="oval"):
    return dict(number=str(number), kind="thru_hole", shape=shape, dx=dx, dy=dy,
                w=w, h=h, drill=drill, net=net)


def fp_0805(ref, value, x, y, nets, footprint="Resistor_SMD:R_0805_2012Metric", ref_off=(0, -1.8)):
    return dict(name=footprint, ref=ref, value=value, x=x, y=y, ref_off=ref_off,
                body=("rect", -1.2, -0.85, 1.2, 0.85),
                pads=[smd_pad(1, -1.0, 0, nets[0]), smd_pad(2, 1.0, 0, nets[1])])


def footprints():
    out = []
    out.append(dict(
        name="Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", ref="U1", value="ATtiny412-SSNR",
        x=118.0, y=98.0, ref_off=(0, -3.8), body=("rect", -2.2, -2.6, 2.2, 2.6),
        pads=[
            smd_pad(1, -2.7, -1.905, 1, 1.5, 0.6),
            smd_pad(2, -2.7, -0.635, 3, 1.5, 0.6),
            smd_pad(3, -2.7, 0.635, 4, 1.5, 0.6),
            smd_pad(4, -2.7, 1.905, 5, 1.5, 0.6),
            smd_pad(5, 2.7, 1.905, 6, 1.5, 0.6),
            smd_pad(6, 2.7, 0.635, 7, 1.5, 0.6),
            smd_pad(7, 2.7, -0.635, 8, 1.5, 0.6),
            smd_pad(8, 2.7, -1.905, 2, 1.5, 0.6),
        ]))
    out.append(fp_0805("C1", "100nF 50V X7R", 118.0, 92.7, (1, 2),
                       "Capacitor_SMD:C_0805_2012Metric"))
    out.append(fp_0805("R1", "10k Ohm 1%", 108.5, 92.2, (4, 2)))
    out.append(fp_0805("R2", "330 Ohm 1%", 125.0, 90.5, (8, 9)))
    out.append(fp_0805("R3", "4.7k Ohm UPDI", 126.0, 99.0, (7, 11)))
    out.append(fp_0805("R4", "330 Ohm 1%", 126.0, 107.2, (6, 10)))
    out.append(fp_0805("D1", "Amber PWM LED", 129.3, 90.5, (9, 2),
                       "LED_SMD:LED_0805_2012Metric"))
    out.append(fp_0805("D2", "Emerald Status LED", 130.2, 107.2, (10, 2),
                       "LED_SMD:LED_0805_2012Metric"))
    out.append(fp_0805("Q1", "ALS-PT19 Phototransistor", 104.9, 90.2, (1, 4),
                       "LED_SMD:LED_0805_2012Metric"))
    out.append(dict(
        name="Button_Switch_SMD:SW_SPST_PTS645", ref="SW1", value="PTS645 Tactile Switch",
        x=118.0, y=107.3, ref_off=(0, -4.2), body=("rect", -3.0, -3.0, 3.0, 3.0),
        pads=[
            smd_pad(1, -3.25, -2.25, 5, 1.3, 1.5),
            smd_pad(2, -3.25, 2.25, 5, 1.3, 1.5),
            smd_pad(3, 3.25, -2.25, 2, 1.3, 1.5),
            smd_pad(4, 3.25, 2.25, 2, 1.3, 1.5),
        ]))
    out.append(dict(
        name="Buzzer_Beeper:MagneticBuzzer_12x12mm", ref="BZ1", value="Piezo Transducer 12mm",
        x=106.7, y=104.0, ref_off=(0, -6.8), body=("circle", 0.0, 0.0, 6.1),
        pads=[
            th_pad(1, 2.5, 0.0, 3, 1.8, 1.8, 0.8, "circle"),
            th_pad(2, -2.5, 0.0, 2, 1.8, 1.8, 0.8, "circle"),
        ]))
    out.append(dict(
        name="Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical",
        ref="J1", value="UPDI Power Header", x=133.3, y=98.6, ref_off=(0, -2.7),
        body=("rect", -1.27, -1.27, 1.27, 6.35),
        pads=[
            th_pad(1, 0.0, 0.0, 1, 1.7, 1.7, 1.0, "rect"),
            th_pad(2, 0.0, 2.54, 11, 1.7, 1.7, 1.0, "oval"),
            th_pad(3, 0.0, 5.08, 2, 1.7, 1.7, 1.0, "oval"),
        ]))
    return out


# Copper segments. Signal escapes are on the top copper. Power and ground use
# short top stubs to vias, then two separated bottom-copper distribution trees.
SEGMENTS = [
    # +5V top stubs
    ((115.3, 96.095), (117.0, 92.7), 0.30, "F.Cu", 1),
    ((117.0, 92.7), (115.2, 92.7), 0.30, "F.Cu", 1),
    ((103.9, 90.2), (102.8, 90.2), 0.30, "F.Cu", 1),
    # GND top stubs and switch pair
    ((120.7, 96.095), (119.0, 92.7), 0.30, "F.Cu", 2),
    ((119.0, 92.7), (121.0, 92.7), 0.30, "F.Cu", 2),
    ((109.5, 92.2), (110.6, 93.5), 0.30, "F.Cu", 2),
    ((130.3, 90.5), (131.4, 91.8), 0.30, "F.Cu", 2),
    ((131.2, 107.2), (132.2, 108.5), 0.30, "F.Cu", 2),
    ((121.25, 105.05), (121.25, 109.55), 0.30, "F.Cu", 2),
    ((121.25, 109.55), (123.5, 109.55), 0.30, "F.Cu", 2),
    # Piezo escape and bottom return
    ((115.3, 97.365), (113.7, 97.365), 0.30, "F.Cu", 3),
    ((113.7, 97.365), (109.2, 104.0), 0.30, "B.Cu", 3),
    # Light sensor divider node
    ((115.3, 98.635), (112.5, 98.635), 0.30, "F.Cu", 4),
    ((112.5, 98.635), (107.5, 92.2), 0.30, "F.Cu", 4),
    ((107.5, 92.2), (105.9, 90.2), 0.30, "F.Cu", 4),
    # Button node and its paired switch contacts
    ((115.3, 99.905), (114.75, 105.05), 0.30, "F.Cu", 5),
    ((114.75, 105.05), (114.75, 109.55), 0.30, "F.Cu", 5),
    # Status LED series chain
    ((120.7, 99.905), (125.0, 107.2), 0.30, "F.Cu", 6),
    ((127.0, 107.2), (129.2, 107.2), 0.30, "F.Cu", 10),
    # UPDI series chain
    ((120.7, 98.635), (125.0, 99.0), 0.30, "F.Cu", 7),
    ((127.0, 99.0), (133.3, 101.14), 0.30, "F.Cu", 11),
    # PWM LED series chain
    ((120.7, 97.365), (122.2, 97.365), 0.30, "F.Cu", 8),
    ((122.2, 97.365), (124.0, 90.5), 0.30, "F.Cu", 8),
    ((126.0, 90.5), (128.3, 90.5), 0.30, "F.Cu", 9),
    # Bottom +5V tree
    ((102.8, 90.2), (102.8, 88.9), 0.45, "B.Cu", 1),
    ((102.8, 88.9), (115.2, 88.9), 0.45, "B.Cu", 1),
    ((115.2, 88.9), (133.3, 88.9), 0.45, "B.Cu", 1),
    ((115.2, 88.9), (115.2, 92.7), 0.45, "B.Cu", 1),
    ((133.3, 88.9), (133.3, 98.6), 0.45, "B.Cu", 1),
    # Bottom GND tree
    ((110.6, 93.5), (110.6, 95.0), 0.50, "B.Cu", 2),
    ((110.6, 95.0), (121.0, 95.0), 0.50, "B.Cu", 2),
    ((121.0, 95.0), (131.4, 95.0), 0.50, "B.Cu", 2),
    ((121.0, 92.7), (121.0, 95.0), 0.50, "B.Cu", 2),
    ((131.4, 91.8), (131.4, 95.0), 0.50, "B.Cu", 2),
    ((110.6, 95.0), (107.0, 95.0), 0.50, "B.Cu", 2),
    ((107.0, 95.0), (107.0, 106.2), 0.50, "B.Cu", 2),
    ((104.2, 104.0), (104.2, 106.2), 0.50, "B.Cu", 2),
    ((104.2, 106.2), (107.0, 106.2), 0.50, "B.Cu", 2),
    ((107.0, 106.2), (123.5, 106.2), 0.50, "B.Cu", 2),
    ((123.5, 106.2), (132.2, 106.2), 0.50, "B.Cu", 2),
    ((132.2, 106.2), (135.0, 106.2), 0.50, "B.Cu", 2),
    ((123.5, 109.55), (123.5, 106.2), 0.50, "B.Cu", 2),
    ((132.2, 108.5), (132.2, 106.2), 0.50, "B.Cu", 2),
    ((135.0, 106.2), (135.0, 103.68), 0.50, "B.Cu", 2),
    ((135.0, 103.68), (133.3, 103.68), 0.50, "B.Cu", 2),
]

VIAS = [
    (115.2, 92.7, 1),
    (102.8, 90.2, 1),
    (121.0, 92.7, 2),
    (110.6, 93.5, 2),
    (131.4, 91.8, 2),
    (132.2, 108.5, 2),
    (123.5, 109.55, 2),
    (113.7, 97.365, 3),
]


def pad_text(f, p):
    x = f["x"] + p["dx"]
    y = f["y"] + p["dy"]
    layers = '"F.Cu" "F.Paste" "F.Mask"' if p["kind"] == "smd" else '"*.Cu" "*.Mask"'
    shape = p["shape"]
    parts = [f'(pad "{p["number"]}" {p["kind"]} {shape} (at {fmt(p["dx"])} {fmt(p["dy"])})',
             f'(size {fmt(p["w"])} {fmt(p["h"])})']
    if p["drill"]:
        parts.append(f'(drill {fmt(p["drill"])})')
    parts.append(f'(layers {layers})')
    if shape == "roundrect":
        parts.append('(roundrect_rratio 0.25)')
    parts.append(f'(net {p["net"]} "{NET[p["net"]]}")')
    parts.append(f'(uuid "{uuid()}")')
    return "    " + " ".join(parts) + ")"


def footprint_text(f):
    lines = [f'  (footprint "{f["name"]}"', '    (layer "F.Cu")', f'    (uuid "{uuid()}")',
             f'    (at {fmt(f["x"])} {fmt(f["y"])} 0)']
    rx, ry = f["ref_off"]
    lines.append(f'    (property "Reference" "{f["ref"]}" (at {fmt(rx)} {fmt(ry)} 0) (layer "F.SilkS") (uuid "{uuid()}") (effects (font (size 0.9 0.9) (thickness 0.15))))')
    lines.append(f'    (property "Value" "{f["value"]}" (at 0 1.8 0) (layer "F.Fab") (uuid "{uuid()}") (effects (font (size 0.9 0.9) (thickness 0.15))))')
    body = f.get("body")
    if body and body[0] == "rect":
        _, x1, y1, x2, y2 = body
        lines.append(f'    (fp_rect (start {fmt(x1)} {fmt(y1)}) (end {fmt(x2)} {fmt(y2)}) (stroke (width 0.12) (type default)) (fill none) (layer "F.SilkS") (uuid "{uuid()}"))')
    elif body and body[0] == "circle":
        _, cx, cy, radius = body
        lines.append(f'    (fp_circle (center {fmt(cx)} {fmt(cy)}) (end {fmt(cx + radius)} {fmt(cy)}) (stroke (width 0.12) (type default)) (fill none) (layer "F.SilkS") (uuid "{uuid()}"))')
    lines.extend(pad_text(f, p) for p in f["pads"])
    lines.append("  )")
    return "\n".join(lines)


def generate():
    x1, y1, x2, y2 = OUTLINE
    lines = [
        "(kicad_pcb",
        "  (version 20240108)",
        '  (generator "generate_pcb.py")',
        '  (generator_version "1.1")',
        "  (general",
        "    (thickness 1.6)",
        "    (legacy_teardrops no)",
        "  )",
        '  (paper "A4")',
        "  (title_block",
        '    (title "ATtiny412 PulseNode Rev 1.1")',
        '    (date "2026-11-25")',
        '    (rev "1.1")',
        '    (company "Aariv Patel")',
        "  )",
        "  (layers",
        '    (0 "F.Cu" signal)',
        '    (31 "B.Cu" signal)',
        '    (32 "B.Adhes" user "B.Adhesive")',
        '    (33 "F.Adhes" user "F.Adhesive")',
        '    (34 "B.Paste" user)',
        '    (35 "F.Paste" user)',
        '    (36 "B.SilkS" user "B.Silkscreen")',
        '    (37 "F.SilkS" user "F.Silkscreen")',
        '    (38 "B.Mask" user)',
        '    (39 "F.Mask" user)',
        '    (44 "Edge.Cuts" user)',
        '    (46 "B.CrtYd" user "B.Courtyard")',
        '    (47 "F.CrtYd" user "F.Courtyard")',
        '    (48 "B.Fab" user)',
        '    (49 "F.Fab" user)',
        "  )",
        "  (setup",
        "    (pad_to_mask_clearance 0)",
        "  )",
        '  (net 0 "")',
    ]
    lines += [f'  (net {n} "{name}")' for n, name in NETS]
    lines += [
        "",
        f'  (gr_rect (start {fmt(x1)} {fmt(y1)}) (end {fmt(x2)} {fmt(y2)})',
        "    (stroke (width 0.15) (type default))",
        "    (fill none)",
        '    (layer "Edge.Cuts")',
        f'    (uuid "{uuid()}")',
        "  )",
        f'  (gr_text "PulseNode v1.1" (at 118 86.8 0) (layer "F.SilkS") (uuid "{uuid()}")',
        "    (effects (font (size 1.2 1.2) (thickness 0.2)))",
        "  )",
        "",
    ]
    for f in footprints():
        lines.append(footprint_text(f))
        lines.append("")
    for x, y, net in VIAS:
        lines.append(f'  (via (at {fmt(x)} {fmt(y)}) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net {net} "{NET[net]}") (uuid "{uuid()}"))')
    if VIAS:
        lines.append("")
    for a, b, width, layer, net in SEGMENTS:
        lines.append(f'  (segment (start {fmt(a[0])} {fmt(a[1])}) (end {fmt(b[0])} {fmt(b[1])}) (width {fmt(width)}) (layer "{layer}") (net {net}) (uuid "{uuid()}"))')
    lines.append(")")
    return "\n".join(lines) + "\n"


def main():
    text = generate()
    for rel in ("attiny412-pulsenode.kicad_pcb", "pcb/attiny412-pulsenode.kicad_pcb"):
        (ROOT / rel).write_text(text)
    print(f"wrote {len(footprints())} footprints, {len(SEGMENTS)} segments, {len(VIAS)} vias")


if __name__ == "__main__":
    main()
