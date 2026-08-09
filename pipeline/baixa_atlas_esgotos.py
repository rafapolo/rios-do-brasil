#!/usr/bin/env python3
"""Traz o Atlas Esgotos da ANA e a sede de cada município, do espelho no beelink.

Serve a duas coisas em poluicao.py:

  1. **Teto de sanidade.** As outorgas trazem lançamentos com finalidade errada —
     os três maiores "esgotos" do país são, na verdade, transferências entre
     represas do Alto Tietê. O Atlas dá a vazão de esgoto que cada município
     de fato gera, e o que passar muito disso é descartado.
  2. **Camada de cobertura.** As outorgas cobrem menos da metade do esgoto
     coletado do país. Onde o Atlas aponta carga e não há outorga nenhuma, o
     mapa precisa dizer "não se sabe" em vez de deixar o rio limpo.

A sede municipal (IBGE 2010, via geobr) é o ponto onde a cidade encosta no rio —
é dela que sai o traço da camada de cobertura.
"""
import os
import subprocess
from pathlib import Path

import polars as pl

S = Path(__file__).parent
HOST = os.environ.get("BEELINK_HOST", "beelink")
DB = "~/rodado/basedosdados.duckdb"

SQL = """
SET enable_progress_bar=false;
LOAD spatial;
WITH atlas AS (
  SELECT id_municipio,
         vazao_total,
         vazao_com_coleta_com_tratamento + vazao_com_coleta_sem_tratamento AS vazao_coletada,
         carga_lancada_total,
         indice_atendimento_com_coleta_com_tratamento AS indice_tratamento
  FROM read_parquet('~/rodado/br_ana_atlas_esgotos/municipio/municipio.parquet')
), sede AS (
  SELECT id_municipio, nome_municipio, sigla_uf,
         ST_X(ST_Centroid(geometria)) AS lon,
         ST_Y(ST_Centroid(geometria)) AS lat
  FROM read_parquet('~/rodado/br_geobr_mapas/sede_municipal/*.parquet')
  WHERE ano = 2010
)
SELECT s.id_municipio, s.nome_municipio, s.sigla_uf,
       round(s.lon, 5) AS lon, round(s.lat, 5) AS lat,
       a.vazao_total, a.vazao_coletada, a.carga_lancada_total, a.indice_tratamento
FROM sede s JOIN atlas a USING (id_municipio)
ORDER BY s.id_municipio;
"""


def main():
    print(f"consultando {HOST}...")
    r = subprocess.run(
        ["ssh", HOST, f"~/bin/duckdb -csv {DB}"],
        input=SQL, capture_output=True, text=True, timeout=600,
    )
    if r.returncode != 0:
        raise SystemExit(f"duckdb falhou: {r.stderr[:500]}")
    # o .duckdbrc do beelink imprime uma linha de aviso antes do CSV
    linhas = [l for l in r.stdout.splitlines() if l.strip()]
    inicio = next(i for i, l in enumerate(linhas) if l.startswith("id_municipio"))
    csv = "\n".join(linhas[inicio:])

    df = pl.read_csv(csv.encode())
    path = S / "atlas_esgotos.csv"
    df.write_csv(path)
    print(f"{df.height} municípios -> {path}")
    print(f"  vazão de esgoto gerada no país: {df['vazao_total'].sum() / 1000:.0f} m³/s")
    print(f"  coletada: {df['vazao_coletada'].sum() / 1000:.0f} m³/s")


if __name__ == "__main__":
    main()
