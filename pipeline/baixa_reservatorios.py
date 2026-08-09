#!/usr/bin/env python3
"""Reservatórios do Sistema Interligado Nacional: coordenadas e capacidade do
serviço SAR da ANA, cruzadas com os 22 anos de operação diária que já estão no
beelink (br_ana_reservatorios/sin)."""
import json
import subprocess
from pathlib import Path

import requests

S = Path(__file__).parent
URL = "https://www.snirh.gov.br/arcgis/rest/services/IG/SAR/FeatureServer/0/query"

r = requests.get(URL, params={
    "where": "1=1", "outFields": "*", "returnGeometry": "false", "f": "json",
}, timeout=180)
r.raise_for_status()
pontos = [f["attributes"] for f in r.json()["features"]]
print(f"{len(pontos)} reservatórios no SAR")

SQL = """SET enable_progress_bar=false;
SELECT nome_reservatorio AS nome,
       count(*) AS dias,
       min(data) AS ini, max(data) AS fim,
       round(avg(vazao_turbinada), 1) AS turbinada,
       round(avg(vazao_vertida), 1) AS vertida,
       round(avg(afluencia), 1) AS afluencia,
       round(avg(vazao_natural), 1) AS natural_,
       round(avg(proporcao_volume_util) * 100, 1) AS volume_util
FROM read_parquet('~/rodado/br_ana_reservatorios/sin/sin.parquet')
GROUP BY 1 HAVING count(*) > 365;"""
out = subprocess.run(
    ["ssh", "beelink", "~/bin/duckdb -json ~/rodado/basedosdados.duckdb"],
    input=SQL, capture_output=True, text=True, check=True,
)
hist = json.loads(out.stdout[out.stdout.index("["):])
print(f"{len(hist)} reservatórios com histórico no beelink")

norm = lambda s: "".join(c for c in (s or "").upper() if c.isalnum())
por_nome = {norm(h["nome"]): h for h in hist}

saida, casados = [], 0
for p in pontos:
    lat, lon = p.get("SAR_NU_LATITUDE"), p.get("SAR_NU_LONGITUDE")
    if lat is None or lon is None:
        continue
    h = por_nome.get(norm(p.get("SAR_NM")))
    if h:
        casados += 1
    saida.append({
        "nome": (p.get("SAR_NM") or "").strip(),
        "lat": round(float(lat), 4),
        "lon": round(float(lon), 4),
        "uf": p.get("SAR_SG_UF"),
        "bacia": p.get("SAR_NM_BACIA"),
        "cap": p.get("SAR_QT_CAPACIDADE"),
        "vol": p.get("SAR_PC_VOLUME"),
        "turb": h["turbinada"] if h else None,
        "vert": h["vertida"] if h else None,
        "aflu": h["afluencia"] if h else None,
        "dias": h["dias"] if h else None,
        "ini": h["ini"][:4] if h else None,
        "fim": h["fim"][:4] if h else None,
    })

(S / "reservatorios.json").write_text(json.dumps(saida, ensure_ascii=False, separators=(",", ":")))
print(f"{len(saida)} com coordenada, {casados} com série de operação -> reservatorios.json")
