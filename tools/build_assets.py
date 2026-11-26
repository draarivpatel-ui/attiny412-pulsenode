"""Rebuild every derived file in this repo from attiny412-pulsenode.kicad_pcb.

Outputs
  assets/pcb.json                    parsed board, connectivity status, used by index.html
  assets/board.stl, assets/parts.stl meshes used by the 3D viewer
  cad/attiny412_pulsenode_assembly.step   board plus envelope bodies for U1, C1, D1, J1
  gerbers/*.gbr, gerbers/*.drl, gerbers/attiny412-pulsenode-gerbers.zip
  assets/files.json                  size and SHA-256 of every downloadable file

Run with a Python that has build123d installed:  python tools/build_assets.py
Gerber coordinates use the board lower-left corner as origin, +Y up.
"""
import hashlib
import json
import math
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PCB = ROOT / "attiny412-pulsenode.kicad_pcb"


# ---------------------------------------------------------------- s-expression parse
def parse_sexp(text):
    tokens = re.findall(r'\(|\)|"(?:\\.|[^"\\])*"|[^\s()]+', text)
    pos = 0

    def read():
        nonlocal pos
        tok = tokens[pos]
        pos += 1
        if tok == "(":
            out = []
            while tokens[pos] != ")":
                out.append(read())
            pos += 1
            return out
        if tok.startswith('"'):
            return ("s", tok[1:-1])
        try:
            return float(tok) if re.fullmatch(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", tok) else tok
        except ValueError:
            return tok

    return read()


def sval(x):
    return x[1] if isinstance(x, tuple) else x


def find_all(node, key):
    return [c for c in node if isinstance(c, list) and c and c[0] == key]


def find_one(node, key):
    r = find_all(node, key)
    return r[0] if r else None


def _rot(x, y, deg):
    if not deg:
        return x, y
    r = math.radians(deg)
    return x * math.cos(r) - y * math.sin(r), x * math.sin(r) + y * math.cos(r)


def _quarter_turns(deg):
    # Positions are exact for any angle via _rot, but pad w/h are only swapped at
    # quarter turns; non-90-degree footprints and B.Cu (unmirrored) placements are
    # not handled. Revisit before the first rotated or bottom-side part.
    return int(round(deg / 90.0)) % 4


def load_board():
    tree = parse_sexp(PCB.read_text())
    nets = {int(n[1]): sval(n[2]) for n in find_all(tree, "net")}
    rect = find_all(tree, "gr_rect")[0]
    sx, sy = find_one(rect, "start")[1:3]
    ex, ey = find_one(rect, "end")[1:3]
    outline = dict(x=sx, y=sy, w=ex - sx, h=ey - sy,
                   width=find_one(find_one(rect, "stroke"), "width")[1])
    texts = []
    for t in find_all(tree, "gr_text"):
        at = find_one(t, "at")
        font = find_one(find_one(t, "effects"), "font")
        texts.append(dict(text=sval(t[1]), x=at[1], y=at[2],
                          layer=sval(find_one(t, "layer")[1]),
                          size=find_one(font, "size")[1]))
    fps = []
    for f in find_all(tree, "footprint"):
        at = find_one(f, "at")
        fx, fy = at[1], at[2]
        frot = at[3] if len(at) > 3 else 0
        props = {sval(p[1]): sval(p[2]) for p in find_all(f, "property")}
        ref_prop = [p for p in find_all(f, "property") if sval(p[1]) == "Reference"][0]
        ref_off = find_one(ref_prop, "at")
        refx, refy = _rot(ref_off[1], ref_off[2], frot)
        rects = []
        for r in find_all(f, "fp_rect"):
            a = find_one(r, "start")
            b = find_one(r, "end")
            (x1, y1), (x2, y2) = _rot(a[1], a[2], frot), _rot(b[1], b[2], frot)
            rects.append(dict(x1=fx + min(x1, x2), y1=fy + min(y1, y2),
                              x2=fx + max(x1, x2), y2=fy + max(y1, y2),
                              layer=sval(find_one(r, "layer")[1]),
                              width=find_one(find_one(r, "stroke"), "width")[1]))
        circles = []
        for c in find_all(f, "fp_circle"):
            center = find_one(c, "center")
            end = find_one(c, "end")
            cx, cy = _rot(center[1], center[2], frot)
            ex, ey = _rot(end[1], end[2], frot)
            radius = math.hypot(end[1] - center[1], end[2] - center[2])
            circles.append(dict(x=fx + cx, y=fy + cy, r=radius,
                                layer=sval(find_one(c, "layer")[1]),
                                width=find_one(find_one(c, "stroke"), "width")[1]))
        pads = []
        for p in find_all(f, "pad"):
            pat = find_one(p, "at")
            size = find_one(p, "size")
            net = find_one(p, "net")
            drill = find_one(p, "drill")
            rr = find_one(p, "roundrect_rratio")
            prot = pat[3] if len(pat) > 3 else 0
            px, py = _rot(pat[1], pat[2], frot)
            pw, ph = size[1], size[2]
            if _quarter_turns(frot + prot) % 2:
                pw, ph = ph, pw
            pads.append(dict(number=str(int(p[1])) if isinstance(p[1], float) else sval(p[1]),
                             kind=p[2], shape=p[3],
                             x=fx + px, y=fy + py, w=pw, h=ph,
                             drill=drill[1] if drill else None,
                             rratio=rr[1] if rr else 0.0,
                             net=int(net[1]), net_name=sval(net[2]),
                             ref=props.get("Reference", "?")))
        fps.append(dict(name=sval(f[1]), ref=props.get("Reference"), value=props.get("Value"),
                        x=fx, y=fy, ref_at=[fx + refx, fy + refy], rects=rects, circles=circles, pads=pads))
    vias = []
    for v in find_all(tree, "via"):
        at = find_one(v, "at")
        net = find_one(v, "net")
        vias.append(dict(x=at[1], y=at[2],
                         size=find_one(v, "size")[1],
                         drill=find_one(v, "drill")[1],
                         layers=[sval(x) for x in find_one(v, "layers")[1:]],
                         net=int(net[1]), net_name=sval(net[2])))
    segs = []
    for s in find_all(tree, "segment"):
        a = find_one(s, "start")
        b = find_one(s, "end")
        segs.append(dict(x1=a[1], y1=a[2], x2=b[1], y2=b[2],
                         width=find_one(s, "width")[1],
                         layer=sval(find_one(s, "layer")[1]),
                         net=int(find_one(s, "net")[1])))
    return dict(nets=nets, outline=outline, texts=texts, footprints=fps, vias=vias, segments=segs)


def _layer_key(layer):
    return "F" if layer == "F.Cu" else "B" if layer == "B.Cu" else layer


def _orient(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(a, b, p, tol=1e-7):
    return (abs(_orient(a, b, p)) <= tol and
            min(a[0], b[0]) - tol <= p[0] <= max(a[0], b[0]) + tol and
            min(a[1], b[1]) - tol <= p[1] <= max(a[1], b[1]) + tol)


def _segments_touch(a, b, c, d, tol=1e-7):
    o1, o2 = _orient(a, b, c), _orient(a, b, d)
    o3, o4 = _orient(c, d, a), _orient(c, d, b)
    if abs(o1) <= tol and _on_segment(a, b, c, tol): return True
    if abs(o2) <= tol and _on_segment(a, b, d, tol): return True
    if abs(o3) <= tol and _on_segment(c, d, a, tol): return True
    if abs(o4) <= tol and _on_segment(c, d, b, tol): return True
    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def _point_segment_distance(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    den = dx * dx + dy * dy
    if den == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def _point_in_rect(p, r, tol=1e-7):
    return (r["x"] - r["w"] / 2 - tol <= p[0] <= r["x"] + r["w"] / 2 + tol and
            r["y"] - r["h"] / 2 - tol <= p[1] <= r["y"] + r["h"] / 2 + tol)


def _segment_touches_rect(a, b, r, tol=1e-7):
    if _point_in_rect(a, r, tol) or _point_in_rect(b, r, tol):
        return True
    x1, x2 = r["x"] - r["w"] / 2, r["x"] + r["w"] / 2
    y1, y2 = r["y"] - r["h"] / 2, r["y"] + r["h"] / 2
    edges = [((x1, y1), (x2, y1)), ((x2, y1), (x2, y2)),
             ((x2, y2), (x1, y2)), ((x1, y2), (x1, y1))]
    return any(_segments_touch(a, b, c, d, tol) for c, d in edges)


def _pad_is_circle(p):
    return p.get("shape") in ("circle", "oval") and abs(p.get("w", 0) - p.get("h", 0)) < 1e-9


def _segment_touches_pad(a, b, p, tol=1e-7):
    if _pad_is_circle(p):
        return _point_segment_distance((p["x"], p["y"]), a, b) <= p["w"] / 2 + tol
    return _segment_touches_rect(a, b, p, tol)


def _pad_layers(p):
    return {"F"} if p.get("kind") == "smd" else {"F", "B"}


def connectivity(board):
    """Union pads joined by tracks and vias; report missing joins per net.

    Contacts are geometric, not only endpoint equality: a track ending inside a
    pad, touching another track on the same copper layer, or terminating at a
    via all count as connected. Front and back copper remain separate unless a
    through-hole pad or via bridges them.
    """
    pads = [p for f in board["footprints"] for p in f["pads"]]
    vias = board.get("vias", [])
    report = []
    tol = 0.01
    for nid, name in sorted(board["nets"].items()):
        if nid == 0:
            continue
        npads = [p for p in pads if p["net"] == nid]
        nvias = [v for v in vias if v["net"] == nid]
        segs = [s for s in board["segments"] if s["net"] == nid]
        objs = []
        for p in npads:
            objs.append(dict(kind="pad", pad=p, layers=_pad_layers(p)))
        for v in nvias:
            objs.append(dict(kind="via", via=v, layers={_layer_key(x) for x in v.get("layers", ["F.Cu", "B.Cu"])}))
        for s in segs:
            objs.append(dict(kind="seg", seg=s, layers={_layer_key(s["layer"])}))
        parent = list(range(len(objs)))

        def root(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(a, b):
            ra, rb = root(a), root(b)
            if ra != rb:
                parent[rb] = ra

        def contact(a, b):
            if not (a["layers"] & b["layers"]):
                return False
            ka, kb = a["kind"], b["kind"]
            if ka == "seg" and kb == "seg":
                sa, sb = a["seg"], b["seg"]
                return _segments_touch((sa["x1"], sa["y1"]), (sa["x2"], sa["y2"]),
                                       (sb["x1"], sb["y1"]), (sb["x2"], sb["y2"]), tol)
            if ka == "seg" and kb == "pad":
                s, p = a["seg"], b["pad"]
                return _segment_touches_pad((s["x1"], s["y1"]), (s["x2"], s["y2"]), p, tol)
            if ka == "pad" and kb == "seg":
                return contact(b, a)
            if ka == "seg" and kb == "via":
                s, v = a["seg"], b["via"]
                return _point_segment_distance((v["x"], v["y"]), (s["x1"], s["y1"]), (s["x2"], s["y2"])) <= v["size"] / 2 + tol
            if ka == "via" and kb == "seg":
                return contact(b, a)
            if ka == "via" and kb == "pad":
                v, p = a["via"], b["pad"]
                if _pad_is_circle(p):
                    return math.hypot(v["x"] - p["x"], v["y"] - p["y"]) <= v["size"] / 2 + p["w"] / 2 + tol
                return _point_in_rect((v["x"], v["y"]), p, v["size"] / 2 + tol)
            if ka == "pad" and kb == "via":
                return contact(b, a)
            if ka == "via" and kb == "via":
                va, vb = a["via"], b["via"]
                return math.hypot(va["x"] - vb["x"], va["y"] - vb["y"]) <= (va["size"] + vb["size"]) / 2 + tol
            return False

        for i in range(len(objs)):
            for j in range(i + 1, len(objs)):
                if contact(objs[i], objs[j]):
                    union(i, j)
        pad_indices = [i for i, o in enumerate(objs) if o["kind"] == "pad"]
        groups = len({root(i) for i in pad_indices})
        report.append(dict(net=name, pads=[f'{p["ref"]}.{p["number"]}' for p in npads],
                           tracks=len(segs), vias=len(nvias),
                           missing=max(groups - 1, 0),
                           single_pad=len(npads) == 1))
    return report


# ---------------------------------------------------------------- gerber / excellon
class Gerber:
    def __init__(self, function, polarity="Positive"):
        self.function, self.polarity = function, polarity
        self.apertures, self.body = {}, []

    def ap(self, kind, *dims):
        key = (kind,) + tuple(round(d, 6) for d in dims)
        if key not in self.apertures:
            self.apertures[key] = 10 + len(self.apertures)
        return self.apertures[key]

    @staticmethod
    def n(v):
        return int(round(v * 1e6))

    def select(self, code):
        self.body.append(f"D{code}*")

    def move(self, x, y):
        self.body.append(f"X{self.n(x)}Y{self.n(y)}D02*")

    def draw(self, x, y):
        self.body.append(f"X{self.n(x)}Y{self.n(y)}D01*")

    def flash(self, x, y):
        self.body.append(f"X{self.n(x)}Y{self.n(y)}D03*")

    def line(self, x1, y1, x2, y2, width):
        self.select(self.ap("C", width))
        self.move(x1, y1)
        self.draw(x2, y2)

    def path(self, pts, width, closed=True):
        self.select(self.ap("C", width))
        self.move(*pts[0])
        for p in pts[1:]:
            self.draw(*p)
        if closed:
            self.draw(*pts[0])

    def region(self, pts):
        self.body.append("G36*")
        self.move(*pts[0])
        for p in pts[1:] + [pts[0]]:
            self.draw(*p)
        self.body.append("G37*")

    def roundrect(self, cx, cy, w, h, ratio, arc_steps=6):
        r = min(ratio * min(w, h), w / 2, h / 2)
        if r < 1e-6:
            self.select(self.ap("R", w, h))
            self.flash(cx, cy)
            return
        pts = []
        for ax, ay, a0 in ((cx + w / 2 - r, cy - h / 2 + r, -90.0),
                           (cx + w / 2 - r, cy + h / 2 - r, 0.0),
                           (cx - w / 2 + r, cy + h / 2 - r, 90.0),
                           (cx - w / 2 + r, cy - h / 2 + r, 180.0)):
            for i in range(arc_steps + 1):
                a = math.radians(a0 + 90.0 * i / arc_steps)
                pts.append((ax + r * math.cos(a), ay + r * math.sin(a)))
        self.region(pts)

    def render(self, note):
        head = [f"G04 {note}*",
                f"%TF.FileFunction,{self.function}*%",
                f"%TF.FilePolarity,{self.polarity}*%",
                "%FSLAX46Y46*%", "G04 Gerber format 4.6, absolute, unit mm*", "%MOMM*%"]
        for key, code in self.apertures.items():
            if key[0] == "R":
                dims = "X".join(f"{d:.6f}" for d in key[1:])
                head.append(f"%ADD{code}R,{dims}*%")
            else:
                dims = ",".join(f"{d:.6f}" for d in key[1:])
                head.append(f"%ADD{code}C,{dims}*%")
        head += ["%LPD*%", "G01*", "G75*"]
        return "\n".join(head + self.body + ["M02*"]) + "\n"


def build_gerbers(board, out_dir):
    ox, oy = board["outline"]["x"], board["outline"]["y"]
    H = board["outline"]["h"]

    def X(x):
        return x - ox

    def Y(y):
        return oy + H - y

    pads = [p for f in board["footprints"] for p in f["pads"]]
    smd = [p for p in pads if p["kind"] == "smd"]
    tht = [p for p in pads if p["kind"] == "thru_hole"]

    def pad_on(g, p):
        cx, cy = X(p["x"]), Y(p["y"])
        if p["kind"] == "smd" or p["shape"] == "rect":
            g.roundrect(cx, cy, p["w"], p["h"], p["rratio"])
        elif p["shape"] == "oval" and abs(p["w"] - p["h"]) > 1e-9:
            g.roundrect(cx, cy, p["w"], p["h"], 0.5)
        elif abs(p["w"] - p["h"]) < 1e-9:
            g.select(g.ap("C", p["w"]))
            g.flash(cx, cy)
        else:
            raise ValueError("unsupported pad shape %s %sx%s" % (p["shape"], p["w"], p["h"]))

    via_pads = [dict(kind="smd", shape="circle", x=v["x"], y=v["y"], w=v["size"], h=v["size"],
                     drill=v["drill"], rratio=0, net=v["net"], net_name=v["net_name"], ref="VIA")
                for v in board.get("vias", [])]

    layers = {}
    g = Gerber("Copper,L1,Top")
    for p in smd + tht + via_pads:
        pad_on(g, p)
    for s in board["segments"]:
        if s["layer"] == "F.Cu":
            g.line(X(s["x1"]), Y(s["y1"]), X(s["x2"]), Y(s["y2"]), s["width"])
    layers["F_Cu.gbr"] = g

    g = Gerber("Copper,L2,Bot")
    for p in tht + via_pads:
        pad_on(g, p)
    for s in board["segments"]:
        if s["layer"] == "B.Cu":
            g.line(X(s["x1"]), Y(s["y1"]), X(s["x2"]), Y(s["y2"]), s["width"])
    layers["B_Cu.gbr"] = g

    g = Gerber("Soldermask,Top", "Negative")
    for p in smd + tht:
        pad_on(g, p)
    layers["F_Mask.gbr"] = g

    g = Gerber("Soldermask,Bot", "Negative")
    for p in tht:
        pad_on(g, p)
    layers["B_Mask.gbr"] = g

    g = Gerber("Paste,Top")
    for p in smd:
        pad_on(g, p)
    layers["F_Paste.gbr"] = g

    g = Gerber("Legend,Top")
    for f in board["footprints"]:
        for r in f.get("rects", []):
            if r["layer"] == "F.SilkS":
                g.path([(X(r["x1"]), Y(r["y1"])), (X(r["x2"]), Y(r["y1"])),
                        (X(r["x2"]), Y(r["y2"])), (X(r["x1"]), Y(r["y2"]))], r["width"])
        for c in f.get("circles", []):
            if c["layer"] == "F.SilkS":
                pts = []
                for i in range(48):
                    a = 2 * math.pi * i / 48
                    pts.append((X(c["x"] + c["r"] * math.cos(a)), Y(c["y"] + c["r"] * math.sin(a))))
                g.path(pts, c["width"])
    layers["F_Silkscreen.gbr"] = g

    g = Gerber("Profile,NP")
    o = board["outline"]
    g.path([(0, 0), (o["w"], 0), (o["w"], o["h"]), (0, o["h"])], o["width"])
    layers["Edge_Cuts.gbr"] = g

    note = "Generated by tools/build_assets.py from attiny412-pulsenode.kicad_pcb; board text is not exported"
    written = []
    for suffix, gr in layers.items():
        path = out_dir / f"attiny412-pulsenode-{suffix}"
        path.write_text(gr.render(note))
        written.append(path)

    holes = [p for p in tht + via_pads if p["drill"]]
    drills = sorted({p["drill"] for p in holes})
    lines = ["M48", "; Generated by tools/build_assets.py", "; #@! TF.FileFunction,Plated,1,2,PTH",
             "METRIC"] + [f"T{i}C{d:.3f}" for i, d in enumerate(drills, 1)] + ["%"]
    for i, d in enumerate(drills, 1):
        lines.append(f"T{i}")
        lines += [f"X{X(p['x']):.3f}Y{Y(p['y']):.3f}" for p in holes if p["drill"] == d]
    lines.append("M30")
    drl = out_dir / "attiny412-pulsenode-PTH.drl"
    drl.write_text("\n".join(lines) + "\n")
    written.append(drl)
    return written


# ---------------------------------------------------------------- CAD
def build_cad(board):
    from build123d import Box, Compound, Pos, export_step, export_stl, Cylinder

    ox, oy = board["outline"]["x"], board["outline"]["y"]
    W, H, T = board["outline"]["w"], board["outline"]["h"], 1.6

    def X(x):
        return x - ox

    def Y(y):
        return oy + H - y

    board_solid = Pos(W / 2, H / 2, T / 2) * Box(W, H, T)
    holes = []
    for f in board["footprints"]:
        holes.extend(p for p in f["pads"] if p["drill"])
    holes.extend(dict(x=v["x"], y=v["y"], drill=v["drill"]) for v in board.get("vias", []))
    for p in holes:
        board_solid = board_solid - Pos(X(p["x"]), Y(p["y"]), T / 2) * Cylinder(p["drill"] / 2, T + 1)
    board_solid.label = f"PCB FR-4 {W:g}x{H:g}x1.6"

    envelopes = {
        "U1": (3.9, 4.9, 1.5, 0, 0),
        "C1": (2.0, 1.25, 1.0, 0, 0),
        "R1": (2.0, 1.25, 0.8, 0, 0),
        "R2": (2.0, 1.25, 0.8, 0, 0),
        "R3": (2.0, 1.25, 0.8, 0, 0),
        "R4": (2.0, 1.25, 0.8, 0, 0),
        "D1": (2.0, 1.25, 1.0, 0, 0),
        "D2": (2.0, 1.25, 1.0, 0, 0),
        "Q1": (2.0, 1.25, 1.0, 0, 0),
        "SW1": (6.0, 6.0, 4.3, 0, 0),
        "J1": (2.54, 7.62, 2.5, 0, 2.54),
    }
    parts = []
    for f in board["footprints"]:
        if f["ref"] == "BZ1":
            body = Pos(X(f["x"]), Y(f["y"]), T + 6.5 / 2) * Cylinder(6.1, 6.5)
            body.label = "BZ1 envelope diameter 12.2 x 6.5"
            parts.append(body)
        elif f["ref"] in envelopes:
            w, h, d, dx, dy = envelopes[f["ref"]]
            body = Pos(X(f["x"]) + dx, Y(f["y"]) - dy, T + d / 2) * Box(w, h, d)
            body.label = f'{f["ref"]} envelope {w}x{h}x{d}'
            parts.append(body)
    assembly = Compound(children=[board_solid] + parts, label="ATtiny412 PulseNode assembly")
    export_step(assembly, str(ROOT / "cad" / "attiny412_pulsenode_assembly.step"))
    export_stl(board_solid, str(ROOT / "assets" / "board.stl"))
    export_stl(Compound(children=parts), str(ROOT / "assets" / "parts.stl"))
    bb = assembly.bounding_box()
    return dict(size=[round(bb.size.X, 3), round(bb.size.Y, 3), round(bb.size.Z, 3)],
                volume=round(assembly.volume, 3), valid=bool(assembly.is_valid))


def main():
    (ROOT / "assets").mkdir(exist_ok=True)
    (ROOT / "gerbers").mkdir(exist_ok=True)
    (ROOT / "cad").mkdir(exist_ok=True)
    board = load_board()
    board["connectivity"] = connectivity(board)
    board["cad"] = build_cad(board)
    (ROOT / "assets" / "pcb.json").write_text(json.dumps(board, indent=1))

    for old in (ROOT / "gerbers").glob("*"):
        old.unlink()
    files = build_gerbers(board, ROOT / "gerbers")
    with zipfile.ZipFile(ROOT / "gerbers" / "attiny412-pulsenode-gerbers.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            info = zipfile.ZipInfo(f.name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, f.read_bytes())

    manifest = []
    for rel in ["gerbers/attiny412-pulsenode-gerbers.zip"] + [f"gerbers/{f.name}" for f in files] + [
            "cad/attiny412_pulsenode_assembly.step", "assets/board.stl", "assets/parts.stl",
            "attiny412-pulsenode.kicad_pro", "attiny412-pulsenode.kicad_sch", "attiny412-pulsenode.kicad_pcb",
            "bom.csv", "firmware/attiny412_pulsenode.ino"]:
        data = (ROOT / rel).read_bytes()
        manifest.append(dict(path=rel, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
    (ROOT / "assets" / "files.json").write_text(json.dumps(manifest, indent=1))
    print("cad", board["cad"])
    for c in board["connectivity"]:
        print(c)


if __name__ == "__main__":
    main()
