#!/usr/bin/env python3
"""Massa de terra e fronteiras da América do Sul, do Natural Earth.

O mapa desenhava só o contorno das UFs; os rios que vêm dos Andes e os que
descem para o Prata ficavam boiando sem referência. Aqui a terra vira silhueta
escura e as divisas dos países viram linha, no mesmo formato delta-int que o
resto usa.
"""
import json
from pathlib import Path

import requests
from shapely.geometry import box, shape
from shapely.ops import unary_union

S = Path(__file__).parent
URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
       "master/geojson/ne_50m_admin_0_countries.geojson")
RECORTE = box(-84, -58, -25, 16)   # América do Sul com folga
ESC = 10000
TOL = 0.02                          # ~2 km: é silhueta de fundo, não contorno fino
MIN_PTS = 6


def anel_para_delta(coords):
    pts = []
    for x, y in coords:
        xi, yi = round(x * ESC), round(y * ESC)
        if pts and pts[-1] == (xi, yi):
            continue
        pts.append((xi, yi))
    if len(pts) < MIN_PTS:
        return None
    flat = [pts[0][0], pts[0][1]]
    for j in range(1, len(pts)):
        flat += [pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]]
    return flat


def main():
    print("baixando Natural Earth 1:50m...")
    r = requests.get(URL, timeout=300)
    r.raise_for_status()
    feats = r.json()["features"]
    print(f"  {len(feats)} países no mundo")

    poligonos, nomes = [], []
    for f in feats:
        g = shape(f["geometry"])
        if not g.intersects(RECORTE):
            continue
        g = g.intersection(RECORTE).simplify(TOL, preserve_topology=True)
        if g.is_empty:
            continue
        poligonos.append(g)
        nomes.append(f["properties"].get("NAME_PT") or f["properties"].get("NAME"))
    print(f"  {len(poligonos)} no recorte: {', '.join(sorted(n for n in nomes if n)[:8])}...")

    # a terra é uma silhueta só: a união evita costura visível entre vizinhos
    terra = unary_union(poligonos)
    aneis = []
    for g in (terra.geoms if terra.geom_type == "MultiPolygon" else [terra]):
        for anel in [g.exterior, *g.interiors]:
            d = anel_para_delta(list(anel.coords))
            if d:
                aneis.append(d)

    # as divisas ficam por cima, como linha
    divisas = []
    for g in poligonos:
        for parte in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
            d = anel_para_delta(list(parte.exterior.coords))
            if d:
                divisas.append(d)

    saida = {"esc": ESC, "terra": aneis, "divisas": divisas}
    p = S / "terra.json"
    p.write_text(json.dumps(saida, separators=(",", ":")))
    print(f"{len(aneis)} anéis de terra, {len(divisas)} de divisa, "
          f"{sum(len(a) // 2 for a in aneis):,} vértices -> {p.stat().st_size / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
