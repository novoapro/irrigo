#!/usr/bin/env python3
"""Offline Excalidraw -> PNG renderer.

Converts a subset of Excalidraw JSON (rectangle, ellipse, text, line, arrow;
roughness 0) to a plain SVG and screenshots it with the locally-installed
Playwright Chromium. No network required (unlike the esm.sh-based renderer).
"""
import json, sys, math, html
from pathlib import Path
from playwright.sync_api import sync_playwright

def esc(s): return html.escape(s, quote=True)

def arrowhead(tip, prev, color, size=11):
    dx, dy = tip[0]-prev[0], tip[1]-prev[1]
    d = math.hypot(dx, dy) or 1
    ux, uy = dx/d, dy/d
    px, py = -uy, ux
    b = (tip[0]-ux*size, tip[1]-uy*size)
    p1 = (b[0]+px*size*0.5, b[1]+py*size*0.5)
    p2 = (b[0]-px*size*0.5, b[1]-py*size*0.5)
    return f'<polygon points="{tip[0]:.1f},{tip[1]:.1f} {p1[0]:.1f},{p1[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}" fill="{color}"/>'

def main(path):
    data = json.loads(Path(path).read_text())
    els = [e for e in data.get("elements", []) if not e.get("isDeleted")]
    # bounds
    xs, ys = [], []
    for e in els:
        if e["type"] == "arrow" or e["type"] == "line":
            for p in e.get("points", [[0,0]]):
                xs.append(e["x"]+p[0]); ys.append(e["y"]+p[1])
        else:
            xs += [e["x"], e["x"]+e.get("width",0)]
            ys += [e["y"], e["y"]+e.get("height",0)]
    pad = 30
    minx, miny = min(xs)-pad, min(ys)-pad
    maxx, maxy = max(xs)+pad, max(ys)+pad
    W, H = maxx-minx, maxy-miny
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" '
           f'viewBox="{minx:.0f} {miny:.0f} {W:.0f} {H:.0f}" font-family="ui-monospace,Menlo,Consolas,monospace">',
           f'<rect x="{minx:.0f}" y="{miny:.0f}" width="{W:.0f}" height="{H:.0f}" fill="#ffffff"/>']
    # draw shapes first, then arrows, then text
    shapes = [e for e in els if e["type"] in ("rectangle","ellipse")]
    lines  = [e for e in els if e["type"] in ("arrow","line")]
    texts  = [e for e in els if e["type"]=="text"]
    for e in shapes:
        fill = e.get("backgroundColor","transparent")
        if fill == "transparent": fill = "none"
        stroke = e.get("strokeColor","#000")
        sw = e.get("strokeWidth",1)
        dash = ' stroke-dasharray="8 6"' if e.get("strokeStyle")=="dashed" else ""
        rx = 12 if e.get("roundness") else 0
        if e["type"]=="rectangle":
            out.append(f'<rect x="{e["x"]}" y="{e["y"]}" width="{e["width"]}" height="{e["height"]}" '
                       f'rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>')
        else:
            out.append(f'<ellipse cx="{e["x"]+e["width"]/2}" cy="{e["y"]+e["height"]/2}" '
                       f'rx="{e["width"]/2}" ry="{e["height"]/2}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
    for e in lines:
        stroke = e.get("strokeColor","#000")
        sw = e.get("strokeWidth",2)
        pts = [(e["x"]+p[0], e["y"]+p[1]) for p in e.get("points",[[0,0]])]
        ptstr = " ".join(f"{x:.1f},{y:.1f}" for x,y in pts)
        out.append(f'<polyline points="{ptstr}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round"/>')
        if e["type"]=="arrow" and len(pts)>=2:
            if e.get("endArrowhead")=="arrow":
                out.append(arrowhead(pts[-1], pts[-2], stroke))
            if e.get("startArrowhead")=="arrow":
                out.append(arrowhead(pts[0], pts[1], stroke))
    for e in texts:
        color = e.get("strokeColor","#000")
        fs = e.get("fontSize",16)
        lh = fs * e.get("lineHeight",1.25)
        tlines = e.get("text","").split("\n")
        align = e.get("textAlign","left")
        valign = e.get("verticalAlign","top")
        bx, by, bw, bh = e["x"], e["y"], e.get("width",0), e.get("height",0)
        if align=="center": tx, anchor = bx+bw/2, "middle"
        elif align=="right": tx, anchor = bx+bw, "end"
        else: tx, anchor = bx, "start"
        total = len(tlines)*lh
        if valign=="middle": start = by+bh/2 - total/2 + fs*0.85
        else: start = by + fs
        for i, ln in enumerate(tlines):
            yy = start + i*lh
            out.append(f'<text x="{tx:.1f}" y="{yy:.1f}" font-size="{fs}" fill="{color}" '
                       f'text-anchor="{anchor}">{esc(ln)}</text>')
    out.append("</svg>")
    svg = "\n".join(out)
    htmldoc = f'<!doctype html><meta charset=utf-8><body style="margin:0">{svg}</body>'
    png = str(Path(path).with_suffix(".png"))
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(device_scale_factor=2)
        pg.set_content(htmldoc, wait_until="load")
        el = pg.query_selector("svg")
        el.screenshot(path=png)
        b.close()
    print("wrote", png, f"({W:.0f}x{H:.0f})")

if __name__ == "__main__":
    main(sys.argv[1])
