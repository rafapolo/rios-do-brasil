#!/usr/bin/env python3
"""Relevo da América do Sul (ETOPO 2022, 60″) para o lake — roda uma vez.

ETOPO 2022 v1, superfície (topo do gelo/terra + batimetria), 1 minuto de arco (~1,85 km),
altura sobre o geoide EGM2008. NOAA/NCEI, CC0-1.0 ("not subject to copyright protection
within the United States"); citação pedida: NOAA NCEI 2022, ETOPO 2022 15 Arc-Second Global
Relief Model, https://doi.org/10.25921/fd45-gt74. Cabe no MIT do repo.

O recorte vai pelo OPeNDAP do THREDDS, sem baixar o globo (o netCDF global tem 0,9 GB): a
caixa é o `bounds` da página (a rede da BHO, dos Andes ao Prata, 80° O a 34° O e 46° S a 11° N)
com folga, ~41 MB em float32. Do lado de cá vira int16 em metros.

Saída:
  ~/rodado/world_noaa_etopo/etopo2022_60s_america_sul/data.parquet   (no beelink)
  pipeline/relevo_etopo.parquet                                       (cópia local, gitignored)
Colunas: lin (0 = sul), col (0 = oeste), z (int16, m), mais lat/lon do centro da célula.
O relevo.py lê a cópia local; sem ela, traz do lake com scp.

Armadilhas:
  1. O servidor só aceita um intervalo por variável num pedido (`lat[a:b],lat[c:d]` dá
     ConstraintException) e o curl precisa de `-g` por causa dos colchetes — aqui é requests.
  2. As células são centradas em x,x083…: o índice i da latitude é o centro
     −90 + (i + 0,5)/60. A linha 0 da grade é o SUL (latitude crescente).
"""
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
import polars as pl
import requests

S = Path(__file__).parent
URL = ("https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/"
       "ETOPO_2022_v1_60s_N90W180_surface.nc")
POR_GRAU = 60
SUL, NORTE, OESTE, LESTE = -47, 12, -81, -32          # graus, bordas da caixa
LOCAL = S / "relevo_etopo.parquet"
LAKE = "~/rodado/world_noaa_etopo/etopo2022_60s_america_sul"


def indices():
    i0, i1 = (SUL + 90) * POR_GRAU, (NORTE + 90) * POR_GRAU - 1
    j0, j1 = (OESTE + 180) * POR_GRAU, (LESTE + 180) * POR_GRAU - 1
    return i0, i1, j0, j1


def baixa():
    i0, i1, j0, j1 = indices()
    url = f"{URL}.dods?z[{i0}:1:{i1}][{j0}:1:{j1}]"
    print(f"  OPeNDAP z[{i0}:{i1}][{j0}:{j1}] …", flush=True)
    for tentativa in range(5):
        try:
            r = requests.get(url, timeout=600)
            r.raise_for_status()
            break
        except requests.RequestException as e:
            print(f"  tentativa {tentativa + 1}: {e}")
    else:
        sys.exit("ETOPO não respondeu")
    corpo = r.content
    k = corpo.index(b"\nData:\n") + 7
    # DAP2/XDR: o array vem precedido do tamanho duas vezes (int32 big-endian), em float32 BE
    n, n2 = struct.unpack(">II", corpo[k:k + 8])
    ni, nj = i1 - i0 + 1, j1 - j0 + 1
    if n != n2 or n != ni * nj:
        sys.exit(f"tamanho inesperado: {n}/{n2}, esperado {ni * nj}")
    z = np.frombuffer(corpo, dtype=">f4", count=n, offset=k + 8).reshape(ni, nj)
    print(f"  {ni} × {nj} células, {len(corpo) / 1e6:.0f} MB; z de {z.min():.0f} a {z.max():.0f} m")
    return z


def main():
    z = baixa()
    i0, _, j0, _ = indices()
    ni, nj = z.shape
    lin, col = np.divmod(np.arange(ni * nj), nj)
    df = pl.DataFrame({
        "lin": lin.astype(np.int16), "col": col.astype(np.int16),
        "lat": (-90 + (i0 + lin + 0.5) / POR_GRAU).astype(np.float32),
        "lon": (-180 + (j0 + col + 0.5) / POR_GRAU).astype(np.float32),
        "z": np.round(z.ravel()).astype(np.int16),
    })
    df.write_parquet(LOCAL, compression="zstd")
    print(f"  {LOCAL.name}: {LOCAL.stat().st_size / 1e6:.1f} MB, {df.height:,} linhas")
    subprocess.run(["ssh", "beelink", f"mkdir -p {LAKE}"], check=True)
    subprocess.run(["scp", "-q", str(LOCAL), f"beelink:{LAKE}/data.parquet"], check=True)
    print(f"  lake: {LAKE}/data.parquet — rode ../rodado/scripts/build_metadata_catalog.py")


if __name__ == "__main__":
    main()
