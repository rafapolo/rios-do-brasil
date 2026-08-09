#!/usr/bin/env python3
"""Converte os contornos das UFs (GeoJSON do DuckDB) para o mesmo formato
delta-int usado pelos trechos de rio."""
import json
from pathlib import Path

S = Path(__file__).parent
ESC = 10000
MIN_PTS = 8

linhas = []
for reg in json.loads((S / "uf.json").read_text()):
    g = reg["gj"]
    if isinstance(g, str):
        g = json.loads(g)
    polis = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    for poli in polis:
        for anel in poli:
            pts = []
            for x, y in anel:
                xi, yi = round(x * ESC), round(y * ESC)
                if pts and pts[-1] == (xi, yi):
                    continue
                pts.append((xi, yi))
            if len(pts) < MIN_PTS:
                continue
            flat = [pts[0][0], pts[0][1]]
            for j in range(1, len(pts)):
                flat += [pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]]
            linhas.append(flat)

p = S / "uf_linhas.json"
p.write_text(json.dumps(linhas, separators=(",", ":")))
print(f"{len(linhas)} anéis, {sum(len(l) // 2 for l in linhas):,} vértices, {p.stat().st_size / 1e3:.0f} KB")
