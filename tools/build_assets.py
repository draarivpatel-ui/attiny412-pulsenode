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
                        x=fx, y=fy, ref_at=[fx + refx, fy + refy], rects=rects, pads=pads))
    segs = []
    for s in find_all(tree, "segment"):
        a = find_one(s, "start")
        b = find_one(s, "end")
        segs.append(dict(x1=a[1], y1=a[2], x2=b[1], y2=b[2],
                         width=find_one(s, "width")[1],
                         layer=sval(find_one(s, "layer")[1]),
                         net=int(find_one(s, "net")[1])))
    return dict(nets=nets, outline=outline, texts=texts, footprints=fps, segments=segs)


def connectivity(board):
    """Union pads joined by tracks; report missing joins per net.

    Track ends that meet mid-board form junctions, so a pad reached by a
    multi-segment chain counts the same as one joined by a single track.
    """
    pads = [p for f in board["footprints"] for p in f["pads"]]
    report = []
    tol = 0.01
    for nid, name in sorted(board["nets"].items()):
        if nid == 0:
            continue
        npads = [p for p in pads if p["net"] == nid]
        segs = [s for s in board["segments"] if s["net"] == nid]
        pts = [(p["x"], p["y"]) for p in npads]
        for s in segs:
            pts += [(s["x1"], s["y1"]), (s["x2"], s["y2"])]
        parent = list(range(len(pts)))

        def root(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(a, b):
            parent[root(a)] = root(b)

        for k in range(len(segs)):
            union(len(npads) + 2 * k, len(npads) + 2 * k + 1)
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                if abs(pts[i][0] - pts[j][0]) < tol and abs(pts[i][1] - pts[j][1]) < tol:
                    union(i, j)
        groups = len({root(i) for i in range(len(npads))})
        report.append(dict(net=name, pads=[f'{p["ref"]}.{p["number"]}' for p in npads],
                           tracks=len(segs),
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

    layers = {}
    g = Gerber("Copper,L1,Top")
    for p in smd + tht:
        pad_on(g, p)
    for s in board["segments"]:
        g.line(X(s["x1"]), Y(s["y1"]), X(s["x2"]), Y(s["y2"]), s["width"])
    layers["F_Cu.gbr"] = g

    g = Gerber("Copper,L2,Bot")
    for p in tht:
        pad_on(g, p)
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
        for r in f["rects"]:
            if r["layer"] == "F.SilkS":
                g.path([(X(r["x1"]), Y(r["y1"])), (X(r["x2"]), Y(r["y1"])),
                        (X(r["x2"]), Y(r["y2"])), (X(r["x1"]), Y(r["y2"]))], r["width"])
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

    holes = [p for p in tht if p["drill"]]
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
    for f in board["footprints"]:
        for p in f["pads"]:
            if p["drill"]:
                board_solid = board_solid - Pos(X(p["x"]), Y(p["y"]), T / 2) * Cylinder(p["drill"] / 2, T + 1)
    board_solid.label = "PCB FR-4 36x26x1.6"

    envelopes = {
        "U1": (3.9, 4.9, 1.5, 0, 0),
        "C1": (2.0, 1.25, 1.0, 0, 0),
        "D1": (2.0, 1.25, 1.0, 0, 0),
        "J1": (2.54, 7.62, 2.5, 0, 2.54),
    }
    parts = []
    for f in board["footprints"]:
        if f["ref"] in envelopes:
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
            z.write(f, f.name)

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
