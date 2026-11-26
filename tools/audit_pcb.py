#!/usr/bin/env python3
"""Static manufacturing audit for the PulseNode KiCad PCB.

This is not a substitute for PCBWay's final CAM review or for KiCad's own DRC,
but it is a strict local geometric audit: placement inside the outline, body
spacing, copper spacing, board-edge copper clearance, drill inventory, BOM
coverage, and layer-aware ratsnest connectivity.
"""
import csv
import importlib.util
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COPPER_CLEARANCE = 0.25
EDGE_CLEARANCE = 0.40
BODY_CLEARANCE = 0.50
TOL = 1e-7

EXPECTED_REFS = ["U1", "C1", "R1", "R2", "R3", "R4", "D1", "D2", "Q1", "SW1", "BZ1", "J1"]
EXPECTED_NET_PADS = {
    "+5V": {"U1.1", "C1.1", "Q1.1", "J1.1"},
    "GND": {"U1.8", "C1.2", "R1.2", "D1.2", "D2.2", "SW1.3", "SW1.4", "BZ1.2", "J1.3"},
    "PA6_PIEZO": {"U1.2", "BZ1.1"},
    "PA7_LDR": {"U1.3", "R1.1", "Q1.2"},
    "PA1_BTN": {"U1.4", "SW1.1", "SW1.2"},
    "PA2_STATUS": {"U1.5", "R4.1"},
    "PA0_UPDI": {"U1.6", "R3.1"},
    "PA3_PWM": {"U1.7", "R2.1"},
    "PWM_LED": {"R2.2", "D1.1"},
    "STATUS_LED": {"R4.2", "D2.1"},
    "UPDI_HDR": {"R3.2", "J1.2"},
}


def load_build_assets():
    spec = importlib.util.spec_from_file_location("build_assets", ROOT / "tools" / "build_assets.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def orient(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def on_segment(a, b, p, tol=TOL):
    return (abs(orient(a, b, p)) <= tol and
            min(a[0], b[0]) - tol <= p[0] <= max(a[0], b[0]) + tol and
            min(a[1], b[1]) - tol <= p[1] <= max(a[1], b[1]) + tol)


def segments_intersect(a, b, c, d):
    o1, o2 = orient(a, b, c), orient(a, b, d)
    o3, o4 = orient(c, d, a), orient(c, d, b)
    if abs(o1) <= TOL and on_segment(a, b, c): return True
    if abs(o2) <= TOL and on_segment(a, b, d): return True
    if abs(o3) <= TOL and on_segment(c, d, a): return True
    if abs(o4) <= TOL and on_segment(c, d, b): return True
    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def point_segment_distance(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    den = dx * dx + dy * dy
    if den == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den, 0.0, 1.0)
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def segment_segment_distance(a, b, c, d):
    if segments_intersect(a, b, c, d):
        return 0.0
    return min(point_segment_distance(c, a, b), point_segment_distance(d, a, b),
               point_segment_distance(a, c, d), point_segment_distance(b, c, d))


def point_rect_distance(p, r):
    dx = max(abs(p[0] - r["x"]) - r["w"] / 2, 0.0)
    dy = max(abs(p[1] - r["y"]) - r["h"] / 2, 0.0)
    return math.hypot(dx, dy)


def segment_rect_distance(a, b, r):
    if point_rect_distance(a, r) == 0 or point_rect_distance(b, r) == 0:
        return 0.0
    x1, x2 = r["x"] - r["w"] / 2, r["x"] + r["w"] / 2
    y1, y2 = r["y"] - r["h"] / 2, r["y"] + r["h"] / 2
    edges = [((x1, y1), (x2, y1)), ((x2, y1), (x2, y2)),
             ((x2, y2), (x1, y2)), ((x1, y2), (x1, y1))]
    if any(segments_intersect(a, b, c, d) for c, d in edges):
        return 0.0
    return min(segment_segment_distance(a, b, c, d) for c, d in edges)


def rect_rect_distance(a, b):
    dx = max(abs(a["x"] - b["x"]) - (a["w"] + b["w"]) / 2, 0.0)
    dy = max(abs(a["y"] - b["y"]) - (a["h"] + b["h"]) / 2, 0.0)
    return math.hypot(dx, dy)


def circle_rect_distance(c, r):
    return max(0.0, point_rect_distance((c["x"], c["y"]), r) - c["r"])


def circle_circle_distance(a, b):
    return max(0.0, math.hypot(a["x"] - b["x"], a["y"] - b["y"]) - a["r"] - b["r"])


def circle_segment_distance(c, a, b):
    return max(0.0, point_segment_distance((c["x"], c["y"]), a, b) - c["r"])


def object_distance(a, b):
    if a["kind"] == "seg" and b["kind"] == "seg":
        return segment_segment_distance(a["a"], a["b"], b["a"], b["b"]) - a["width"] / 2 - b["width"] / 2
    if a["kind"] == "seg" and b["kind"] == "rect":
        return segment_rect_distance(a["a"], a["b"], b) - a["width"] / 2
    if a["kind"] == "seg" and b["kind"] == "circle":
        return circle_segment_distance(b, a["a"], a["b"]) - a["width"] / 2
    if a["kind"] == "rect" and b["kind"] == "rect":
        return rect_rect_distance(a, b)
    if a["kind"] == "circle" and b["kind"] == "circle":
        return circle_circle_distance(a, b)
    if a["kind"] == "circle" and b["kind"] == "rect":
        return circle_rect_distance(a, b)
    return object_distance(b, a)


def layer_key(layer):
    return "F" if layer == "F.Cu" else "B" if layer == "B.Cu" else layer


def pad_is_round(p):
    return p.get("shape") in ("circle", "oval") and abs(p.get("w", 0) - p.get("h", 0)) < 1e-9


def copper_objects(board):
    objs = []
    for f in board["footprints"]:
        for p in f["pads"]:
            layers = {"F"} if p["kind"] == "smd" else {"F", "B"}
            if pad_is_round(p):
                objs.append(dict(kind="circle", x=p["x"], y=p["y"], r=p["w"] / 2,
                                 net=p["net"], name=f'{f["ref"]}.{p["number"]}', layers=layers))
            else:
                objs.append(dict(kind="rect", x=p["x"], y=p["y"], w=p["w"], h=p["h"],
                                 net=p["net"], name=f'{f["ref"]}.{p["number"]}', layers=layers))
    for v in board.get("vias", []):
        objs.append(dict(kind="circle", x=v["x"], y=v["y"], r=v["size"] / 2,
                         net=v["net"], name=f'via {v["x"]},{v["y"]}',
                         layers={layer_key(x) for x in v.get("layers", ["F.Cu", "B.Cu"])}))
    for i, s in enumerate(board["segments"], 1):
        objs.append(dict(kind="seg", a=(s["x1"], s["y1"]), b=(s["x2"], s["y2"]), width=s["width"],
                         net=s["net"], name=f'{s["layer"]} segment {i}', layers={layer_key(s["layer"])}))
    return objs


def envelope_for(f):
    ref = f["ref"]
    if ref == "U1":
        return dict(kind="rect", x=f["x"], y=f["y"], w=4.4, h=5.2)
    if ref in {"C1", "R1", "R2", "R3", "R4", "D1", "D2", "Q1"}:
        return dict(kind="rect", x=f["x"], y=f["y"], w=2.4, h=1.7)
    if ref == "SW1":
        return dict(kind="rect", x=f["x"], y=f["y"], w=6.0, h=6.0)
    if ref == "BZ1":
        return dict(kind="circle", x=f["x"], y=f["y"], r=6.1)
    if ref == "J1":
        return dict(kind="rect", x=f["x"], y=f["y"] + 2.54, w=2.54, h=7.62)
    return dict(kind="rect", x=f["x"], y=f["y"], w=2.0, h=2.0)


def envelope_distance(a, b):
    if a["kind"] == "rect" and b["kind"] == "rect":
        return rect_rect_distance(a, b)
    if a["kind"] == "circle" and b["kind"] == "circle":
        return circle_circle_distance(a, b)
    if a["kind"] == "circle" and b["kind"] == "rect":
        return circle_rect_distance(a, b)
    return envelope_distance(b, a)


def object_bounds(o):
    if o["kind"] == "seg":
        r = o["width"] / 2
        return (min(o["a"][0], o["b"][0]) - r, max(o["a"][0], o["b"][0]) + r,
                min(o["a"][1], o["b"][1]) - r, max(o["a"][1], o["b"][1]) + r)
    if o["kind"] == "rect":
        return (o["x"] - o["w"] / 2, o["x"] + o["w"] / 2, o["y"] - o["h"] / 2, o["y"] + o["h"] / 2)
    return (o["x"] - o["r"], o["x"] + o["r"], o["y"] - o["r"], o["y"] + o["r"])


def audit():
    ba = load_build_assets()
    board = ba.load_board()
    board["connectivity"] = ba.connectivity(board)
    outline = board["outline"]
    ox1, oy1 = outline["x"], outline["y"]
    ox2, oy2 = ox1 + outline["w"], oy1 + outline["h"]
    violations = []
    warnings = []

    refs = [f["ref"] for f in board["footprints"]]
    if refs != EXPECTED_REFS:
        violations.append(f"footprint refs/order mismatch: {refs}")
    if len(refs) != len(set(refs)):
        violations.append("duplicate footprint reference designator")
    if len(refs) != 12:
        violations.append(f"expected 12 footprints, found {len(refs)}")

    with open(ROOT / "bom.csv", newline="") as fh:
        rows = list(csv.DictReader(fh))
    bom_refs = [r["Reference"] for r in rows]
    if sorted(bom_refs) != sorted(EXPECTED_REFS):
        violations.append(f"BOM refs do not cover the placed board exactly: {bom_refs}")
    qty = sum(int(r["Quantity"]) for r in rows)
    cost = sum(int(r["Quantity"]) * float(r["Unit_Cost_USD"]) for r in rows)
    if qty != 12:
        violations.append(f"BOM quantity sum is {qty}, expected 12")
    if abs(cost - 1.76) > 0.005:
        violations.append(f"BOM cost is {cost:.2f}, expected 1.76")

    for f in board["footprints"]:
        env = envelope_for(f)
        if env["kind"] == "rect":
            x1, x2 = env["x"] - env["w"] / 2, env["x"] + env["w"] / 2
            y1, y2 = env["y"] - env["h"] / 2, env["y"] + env["h"] / 2
        else:
            x1, x2 = env["x"] - env["r"], env["x"] + env["r"]
            y1, y2 = env["y"] - env["r"], env["y"] + env["r"]
        if x1 < ox1 or x2 > ox2 or y1 < oy1 or y2 > oy2:
            violations.append(f'{f["ref"]} body crosses the board outline')
    envs = [(f["ref"], envelope_for(f)) for f in board["footprints"]]
    for i, (ra, a) in enumerate(envs):
        for rb, b in envs[i + 1:]:
            d = envelope_distance(a, b)
            if d < BODY_CLEARANCE:
                violations.append(f"{ra} to {rb} body clearance {d:.3f} mm")

    objs = copper_objects(board)
    min_copper = None
    for i, a in enumerate(objs):
        for b in objs[i + 1:]:
            if a["net"] == b["net"] or not (a["layers"] & b["layers"]):
                continue
            d = object_distance(a, b)
            if min_copper is None or d < min_copper[0]:
                min_copper = (d, a["name"], b["name"])
            if d < COPPER_CLEARANCE:
                violations.append(f'copper clearance {d:.3f} mm between {a["name"]} and {b["name"]}')
    min_edge = None
    for o in objs:
        x1, x2, y1, y2 = object_bounds(o)
        d = min(x1 - ox1, ox2 - x2, y1 - oy1, oy2 - y2)
        if min_edge is None or d < min_edge[0]:
            min_edge = (d, o["name"])
        if d < EDGE_CLEARANCE:
            violations.append(f'copper edge clearance {d:.3f} mm at {o["name"]}')

    missing_total = sum(n["missing"] for n in board["connectivity"])
    lonely = [n["net"] for n in board["connectivity"] if n["single_pad"]]
    if missing_total:
        violations.append(f"{missing_total} unrouted connectivity joins")
    if lonely:
        violations.append(f"single-pad nets remain: {lonely}")
    if sorted(board["nets"].values()) != [""] + sorted(EXPECTED_NET_PADS):
        violations.append(f'netlist mismatch: {sorted(board["nets"].values())}')
    for n in board["connectivity"]:
        want = EXPECTED_NET_PADS.get(n["net"])
        if want is not None and set(n["pads"]) != want:
            violations.append(f'net {n["net"]} pads {sorted(n["pads"])} != expected {sorted(want)}')

    pad_total = sum(len(f["pads"]) for f in board["footprints"])
    drill_total = sum(1 for f in board["footprints"] for p in f["pads"] if p.get("drill")) + len(board.get("vias", []))
    if pad_total != 33:
        violations.append(f"expected 33 component pads, found {pad_total}")
    if len(board.get("vias", [])) != 8:
        violations.append(f'expected 8 vias, found {len(board.get("vias", []))}')
    if drill_total != 13:
        violations.append(f"expected 13 drilled holes, found {drill_total}")
    if len(board["segments"]) != 45:
        violations.append(f'expected 45 track segments, found {len(board["segments"])}')
    for i, s in enumerate(board["segments"], 1):
        length = math.hypot(s["x2"] - s["x1"], s["y2"] - s["y1"])
        if length < 0.05:
            violations.append(f"zero-length or tiny track segment {i}")
        if s["width"] < 0.25:
            violations.append(f"track segment {i} is below 0.25 mm")
    for v in board.get("vias", []):
        if abs(v["size"] - 0.8) > 1e-9 or abs(v["drill"] - 0.4) > 1e-9:
            violations.append(f'via at {v["x"]},{v["y"]} is not 0.8/0.4 mm')

    summary = dict(
        ok=not violations,
        footprints=len(board["footprints"]),
        bomLineItems=len(rows),
        bomParts=qty,
        bomCostUsd=round(cost, 2),
        pads=pad_total,
        vias=len(board.get("vias", [])),
        drillHoles=drill_total,
        trackSegments=len(board["segments"]),
        namedNets=len(board["nets"]) - 1,
        unroutedJoins=missing_total,
        singlePadNets=len(lonely),
        copperClearanceMm=None if min_copper is None else round(min_copper[0], 3),
        copperClearancePair=None if min_copper is None else [min_copper[1], min_copper[2]],
        edgeClearanceMm=None if min_edge is None else round(min_edge[0], 3),
        edgeClearanceObject=None if min_edge is None else min_edge[1],
        violations=violations,
        warnings=warnings,
    )
    return summary


def main():
    summary = audit()
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
