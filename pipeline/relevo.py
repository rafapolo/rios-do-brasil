#!/usr/bin/env python3
"""Reamostra o ETOPO 2022 (baixa_relevo.py) na grade que vai embutida na página, ~2 s.

Grade: lat/lon regular de 1/30° (~3,7 km), média de blocos 2 × 2 das células de 60″. A de
1/60° não cabe no orçamento de 2 MB (mediu 5+ MB); 1/30° com o quantum de 2 m dá ~1,4 MB.

O que muda na altitude, nesta ordem (a página não mexe mais nela — o protocolo de ladrilhos e a
rede elevada no shader leem o mesmo número):
  1. mar e depressão em 0 (`max(z, 0)`): o relevo é da terra, e a batimetria não aparece;
  2. a compressão acima do TETO: h' = TETO + (h − TETO)·FATOR. Sem ela, com o exagero que o
     planalto pede, os Andes viram uma parede que esconde o oeste da Amazônia;
  3. o quantum de 2 m (invisível com a grade de 3,7 km).

Codificação (relevo.bin): o resíduo do preditor plano (esquerda + cima − diagonal), em zigzag,
como dois planos de bytes (todos os baixos, depois todos os altos). O relevo é suave, o resíduo
cabe em um byte em 99% das células, e o plano alto vira quase só zero para o gzip. A linha 0 é
o SUL. relevo.json guarda a geometria e as constantes; o monta_pagina.py embute os dois.
"""
import json
import subprocess
from pathlib import Path

import numpy as np
import polars as pl

S = Path(__file__).parent
ORIGEM = S / "relevo_etopo.parquet"
LAKE = "beelink:~/rodado/world_noaa_etopo/etopo2022_60s_america_sul/data.parquet"
BLOCO = 2            # células de 60″ por lado → 1/30°
QUANTUM = 2          # metros
TETO, FATOR = 2000, 0.25

# conferência: (nome, lat, lon, raio em graus, altitude real em m)
PONTOS = [
    ("Pico da Neblina", 0.805, -66.006, 0.1, 2995),
    ("Pico das Agulhas Negras (Itatiaia)", -22.383, -44.666, 0.1, 2791),
    ("Pico do Barbado (Chapada Diamantina)", -13.29, -41.90, 0.1, 2033),
    ("Pantanal (Poconé–Corumbá)", -18.0, -57.0, 0.5, 100),
    ("Aconcágua", -32.653, -70.011, 0.1, 6961),
]


def comprime(h):
    return np.where(h > TETO, TETO + (h - TETO) * FATOR, h)


def descomprime(h):
    return np.where(h > TETO, TETO + (h - TETO) / FATOR, h)


def main():
    if not ORIGEM.exists():
        subprocess.run(["scp", "-q", LAKE, str(ORIGEM)], check=True)
    df = pl.read_parquet(ORIGEM)
    ni, nj = int(df["lin"].max()) + 1, int(df["col"].max()) + 1
    lat_s = float(df["lat"][0]) - 1 / 120          # borda sul da célula (0, 0)
    lon_o = float(df["lon"][0]) - 1 / 120
    z = np.maximum(df["z"].to_numpy().reshape(ni, nj).astype(np.float64), 0)

    n0, n1 = ni // BLOCO * BLOCO, nj // BLOCO * BLOCO
    g = z[:n0, :n1].reshape(n0 // BLOCO, BLOCO, n1 // BLOCO, BLOCO).mean(axis=(1, 3))
    g = np.round(comprime(g) / QUANTUM).astype(np.int32)
    nlat, nlon = g.shape
    passo = BLOCO / 60

    pred = np.zeros_like(g)
    pred[1:, 1:] = g[1:, :-1] + g[:-1, 1:] - g[:-1, :-1]
    pred[0, 1:] = g[0, :-1]
    pred[1:, 0] = g[:-1, 0]
    d = g - pred
    if np.abs(d).max() >= 2 ** 15:
        raise SystemExit("resíduo não cabe em 16 bits")
    zz = ((d << 1) ^ (d >> 31)).astype(np.uint32)
    (S / "relevo.bin").write_bytes(np.concatenate([(zz & 255).astype(np.uint8).ravel(),
                                                   (zz >> 8).astype(np.uint8).ravel()]).tobytes())
    meta = {"fonte": "ETOPO 2022 v1 60″ (NOAA NCEI, CC0-1.0), doi:10.25921/fd45-gt74",
            "latS": lat_s, "lonO": lon_o, "passo": passo, "nlat": nlat, "nlon": nlon,
            "quantum": QUANTUM, "teto": TETO, "fator": FATOR, "max": int(g.max()) * QUANTUM}
    (S / "relevo.json").write_text(json.dumps(meta))
    print(f"  grade {nlat} × {nlon} de {passo * 60:.0f}′ ({passo * 111.32:.1f} km), "
          f"de {lat_s:.2f} a {lat_s + nlat * passo:.2f} e {lon_o:.2f} a {lon_o + nlon * passo:.2f}")
    print(f"  resíduo em 1 byte: {(np.abs(d) < 128).mean():.2%}; máximo comprimido {meta['max']} m")

    # conferência: o pico de verdade, o da grade de 60″ e o da página (média 2 × 2, descomprimida)
    print(f"  {'ponto':38s} {'real':>6s} {'60″':>6s} {'página':>7s}")
    for nome, la, lo, r, real in PONTOS:
        def janela(arr, p):
            i0, i1 = int((la - r - lat_s) / p), int((la + r - lat_s) / p) + 1
            j0, j1 = int((lo - r - lon_o) / p), int((lo + r - lon_o) / p) + 1
            return arr[max(i0, 0):i1, max(j0, 0):j1]
        bruto = janela(z, 1 / 60).max()
        pag = float(descomprime(janela(g * QUANTUM, passo).astype(float)).max())
        agr = "média" if real < 500 else "máx."
        if real < 500:
            bruto, pag = janela(z, 1 / 60).mean(), float(janela(g * QUANTUM, passo).mean())
        print(f"  {nome:38s} {real:6.0f} {bruto:6.0f} {pag:7.0f}  ({agr}; {pag / real - 1:+.0%} sobre o real)")


if __name__ == "__main__":
    main()
