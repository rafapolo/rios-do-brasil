#!/usr/bin/env python3
"""Injeta os dados (gzip + base64) e a fonte no template das séries históricas.

Mesmo truque de monta_pagina.py: a página sai autocontida, sem servidor, sem
requisição de rede, e o navegador descomprime com DecompressionStream.
"""
import base64
import gzip
from pathlib import Path

S = Path(__file__).parent


def embutir(nome):
    cru = (S / nome).read_bytes()
    gz = gzip.compress(cru, 9)
    b64 = base64.b64encode(gz).decode()
    print(f"  {nome}: {len(cru) / 1e6:.2f} MB -> gz {len(gz) / 1e6:.2f} -> base64 {len(b64) / 1e6:.2f}")
    return b64


tpl = (S / "template_series.html").read_text()
pagina = tpl.replace("/*__FONTE__*/", (S / "fonte_mono.txt").read_text().strip())
pagina = pagina.replace("/*__TENDENCIA__*/", embutir("tendencia.json"))
pagina = pagina.replace("/*__PAINEIS__*/", embutir("paineis.json"))

out = S.parent / "series.html"
out.write_text(pagina)
print(f"{out} — {out.stat().st_size / 1e6:.2f} MB")
