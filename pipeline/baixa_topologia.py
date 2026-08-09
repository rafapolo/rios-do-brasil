#!/usr/bin/env python3
"""Baixa só os atributos da rede BHO 2017 5K — sem geometria.

A geometria da rede inteira passa de 1 GB e leva horas de paginação; para fazer
o efluente descer pela rede não é preciso nada dela. Bastam a topologia
(COTRECHO e o trecho de jusante NUTRJUS), a área de drenagem, que dá a ordem de
montante para jusante, e o código de ottobacia, que confere o casamento dos
pontos. São 462 mil linhas de atributo, alguns megabytes.

Quem precisa de geometria de verdade é o processa.py, que refaz o mapa inteiro
a partir de baixa_rede.py. Aqui o alvo é o poluicao.py em modo avulso, que
reaproveita a geometria já embutida no rede_vazao.json.
"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import polars as pl
import requests

S = Path(__file__).parent
URL = ("https://www.snirh.gov.br/arcgis/rest/services/SPR/"
       "BHO2017_5K_TRECHODRENAGEM/FeatureServer/0/query")
ORDEM = int(sys.argv[1]) if len(sys.argv) > 1 else 1
WHERE = f"NUSTRAHLER>={ORDEM}"
CAMPOS = "COTRECHO,NUTRJUS,NUAREAMONT,NUSTRAHLER,COBACIA"


def pega(params, tentativas=5):
    for i in range(tentativas):
        try:
            r = requests.post(URL, data=params, timeout=300)
            r.raise_for_status()
            d = r.json()
            if "error" in d:
                raise RuntimeError(str(d["error"])[:200])
            return d
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                print(f"  falhou: {e}", file=sys.stderr)
                return {"features": []}
            time.sleep(3 * (i + 1))


def main():
    # O passo tem de ser o teto do próprio serviço: pedir mais devolve o teto
    # mesmo assim, e o offset maior pularia o excedente sem avisar.
    meta = requests.get(URL.replace("/query", ""), params={"f": "json"}, timeout=120).json()
    pag = int(meta.get("maxRecordCount") or 1000)
    n = pega({"where": WHERE, "returnCountOnly": "true", "f": "json"})["count"]
    print(f"{n} trechos em {-(-n // pag)} páginas de {pag}")

    def pagina(off):
        d = pega({"where": WHERE, "outFields": CAMPOS, "returnGeometry": "false",
                  "orderByFields": "COTRECHO", "resultOffset": off,
                  "resultRecordCount": pag, "f": "json"})
        return [f["attributes"] for f in d.get("features", [])]

    with ThreadPoolExecutor(8) as ex:
        partes = list(ex.map(pagina, range(0, n, pag)))
    linhas = [x for p in partes for x in p]
    if len(linhas) != n:
        print(f"  ATENÇÃO: recebidas {len(linhas)} de {n}", file=sys.stderr)

    df = pl.DataFrame(linhas, infer_schema_length=None)
    path = S / f"bho_topologia{ORDEM}.parquet"
    df.write_parquet(path)
    print(f"{df.height} trechos -> {path} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
