#!/usr/bin/env python3
"""Inventário fluviométrico COMPLETO da ANA (não só o telemétrico) + as séries
de vazão que ainda faltam.

O scrape anterior filtrou telemetrica=1 e pegou 2.840 estações com descarga
líquida. A rede inteira tem 4.855 — as convencionais são as de série mais longa.
Aqui o inventário vem sem o filtro e só as estações ainda não coletadas entram
na fila de séries, reaproveitando vazao_mensal.parquet.
"""
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock

import polars as pl
import requests

S = Path(__file__).parent
URL = "http://telemetriaws1.ana.gov.br/ServiceANA.asmx"
UA = "Mozilla/5.0"
INICIO, FIM = "01/01/1995", "31/12/2025"
WORKERS = 6

INV = """<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
 <soap:Body><HidroInventario xmlns="http://MRCS/">
  <codEstDE></codEstDE><codEstATE></codEstATE><tpEst>1</tpEst><nmEst></nmEst>
  <nmRio></nmRio><codSubBacia></codSubBacia><codBacia></codBacia><nmMunicipio></nmMunicipio>
  <nmEstado></nmEstado><sgResp></sgResp><sgOper></sgOper><telemetrica></telemetrica>
 </HidroInventario></soap:Body></soap:Envelope>"""

SERIE = """<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
 <soap:Body><HidroSerieHistorica xmlns="http://MRCS/">
  <codEstacao>{cod}</codEstacao><dataInicio>{ini}</dataInicio><dataFim>{fim}</dataFim>
  <tipoDados>3</tipoDados><nivelConsistencia></nivelConsistencia>
 </HidroSerieHistorica></soap:Body></soap:Envelope>"""

lock, done = Lock(), [0]
tag = lambda el: el.tag.rsplit("}", 1)[-1]


def soap(body, acao, tentativas=4):
    for i in range(tentativas):
        try:
            r = requests.post(URL, data=body.encode(), timeout=300, headers={
                "Content-Type": "text/xml; charset=utf-8",
                "SOAPAction": f"http://MRCS/{acao}", "User-Agent": UA})
            r.raise_for_status()
            return ET.fromstring(r.content)
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                raise
            time.sleep(5 * (i + 1))


def inventario():
    root = soap(INV, "HidroInventario")
    linhas = []
    for el in root.iter():
        if tag(el) == "Table":
            linhas.append({tag(c): c.text for c in el})
    return linhas


def serie(cod):
    try:
        root = soap(SERIE.format(cod=cod, ini=INICIO, fim=FIM), "HidroSerieHistorica")
    except Exception as e:  # noqa: BLE001
        print(f"  {cod}: falhou -- {e}", file=sys.stderr)
        return []
    meses = {}
    for el in root.iter():
        if tag(el) != "SerieHistorica":
            continue
        rec = {tag(c): c.text for c in el}
        data, media = (rec.get("DataHora") or "")[:7], rec.get("Media")
        if not data or media is None:
            continue
        nivel = int(rec.get("NivelConsistencia") or 1)
        if data in meses and meses[data][0] >= nivel:
            continue
        try:
            meses[data] = (nivel, float(media),
                           float(rec["Maxima"]) if rec.get("Maxima") else None,
                           float(rec["Minima"]) if rec.get("Minima") else None)
        except ValueError:
            continue
    with lock:
        done[0] += 1
        if done[0] % 100 == 0:
            print(f"  {done[0]} estações", flush=True)
    return [{"codigo": cod, "mes": m, "nivel_consistencia": v[0], "vazao_media": v[1],
             "vazao_maxima": v[2], "vazao_minima": v[3]} for m, v in sorted(meses.items())]


def main():
    print("inventário fluviométrico completo...")
    linhas = inventario()
    print(f"  {len(linhas)} estações")
    inv = pl.DataFrame(linhas, infer_schema_length=None)
    inv.write_parquet(S / "estacoes_completo.parquet", compression="zstd")

    com_vazao = [r["Codigo"] for r in linhas if r.get("TipoEstacaoDescLiquida") == "1"]
    ja = set(pl.read_parquet(S / "vazao_mensal.parquet")["codigo"].to_list())
    # inclui também as que foram consultadas e voltaram vazias, para não repetir
    tentadas = {r["Codigo"] for r in __import__("csv").DictReader(
        open(S / "estacoes_vazao.csv"))}
    faltam = [c for c in com_vazao if c not in ja and c not in tentadas]
    print(f"  {len(com_vazao)} medem vazão; {len(ja)} já com série, "
          f"{len(tentadas)} já tentadas -> {len(faltam)} a coletar")

    t0 = time.time()
    novas = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for rows in pool.map(serie, faltam):
            novas.extend(rows)

    df = pl.concat([pl.read_parquet(S / "vazao_mensal.parquet"), pl.DataFrame(novas)]) \
        if novas else pl.read_parquet(S / "vazao_mensal.parquet")
    df.write_parquet(S / "vazao_mensal_completo.parquet", compression="zstd")
    print(f"\n{len(df):,} linhas / {df['codigo'].n_unique()} estações com dado "
          f"(+{len(set(r['codigo'] for r in novas))} novas) em {(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
