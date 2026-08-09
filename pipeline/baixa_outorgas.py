#!/usr/bin/env python3
"""Baixa as outorgas de uso da água vigentes — lançamento e captação.

O mapa desenha a vazão que passa em cada trecho; as outorgas de **lançamento**
dizem onde entra efluente. Cruzando as duas sai a fração do rio que é efluente,
que é o que a camada de poluição pinta.

As de **captação** entram por um motivo só: separar efluente de água de
passagem. Um sistema produtor tira água de uma represa e devolve em outra, e a
devolução aparece na base como "lançamento" — às vezes com finalidade de
esgotamento sanitário. Quem capta quase tudo o que lança não está sujando nada,
e é isso que poluicao.py usa para descartar esses pontos.

Só entra o que a ANA marca como vigente (outorga_valida=1). Cuidado: a vazão
vem em m³/h, não m³/s.
"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import polars as pl
import requests

S = Path(__file__).parent
BASE = "https://www.snirh.gov.br/arcgis/rest/services/DADOSABERTOS"
PAG = 2000

# O lançamento precisa da ficha inteira: é dele que sai o ponto no mapa, a
# classificação e a vazão. Da captação basta o suficiente para somar por
# município e comparar com o que sai.
CAMPOS_LANC = ",".join([
    "emp_nm_empreendimento", "emp_nm_responsavel", "emp_nu_cpfcnpj",
    "int_qt_vazaomedia", "int_qt_vazaomaxima", "int_qt_volumeanual",
    "int_nm_corpohidrico", "ing_nm_municipio", "ing_sg_ufmunicipio",
    "ing_nm_regiao_hidro", "ing_cd_ottobacia_trecho",
    "int_nu_latitude", "int_nu_longitude",
    "tfn_ds", "tsf_ds", "tch_ds",
    "out_dt_outorgainicial", "out_dt_outorgafinal", "org_nm",
])
CAMPOS_CAPT = ",".join([
    "emp_nm_responsavel", "emp_nu_cpfcnpj", "int_qt_vazaomedia",
    "ing_nm_municipio", "ing_sg_ufmunicipio",
])

CAMADAS = [("federal", "outorgas_federais_superficial", 4),
           ("estadual", "outorgas_estaduais_superficial", 0)]


def pega(url, params, tentativas=5):
    for i in range(tentativas):
        try:
            r = requests.post(url, data=params, timeout=300)
            r.raise_for_status()
            d = r.json()
            if "error" in d:
                raise RuntimeError(d["error"])
            return d
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                print(f"  falhou: {e}", file=sys.stderr)
                return {"features": []}
            time.sleep(4 * (i + 1))


def baixa(esfera, servico, camada, tin, campos):
    url = f"{BASE}/{servico}/FeatureServer/{camada}/query"
    onde = f"outorga_valida=1 AND tin_ds='{tin}'"
    n = pega(url, {"where": onde, "returnCountOnly": "true", "f": "json"})["count"]
    print(f"  {esfera}: {n} em {-(-n // PAG)} páginas")

    def pagina(off):
        d = pega(url, {"where": onde, "outFields": campos, "returnGeometry": "false",
                       "resultOffset": off, "resultRecordCount": PAG,
                       "orderByFields": "int_cd", "f": "json"})
        return [f["attributes"] for f in d.get("features", [])]

    with ThreadPoolExecutor(6) as ex:
        partes = list(ex.map(pagina, range(0, n, PAG)))
    linhas = [x for p in partes for x in p]
    return pl.DataFrame(linhas, infer_schema_length=None).with_columns(
        pl.lit(esfera).alias("esfera"))


def main():
    for tin, campos, nome in (("Lançamento", CAMPOS_LANC, "lancamentos.parquet"),
                              ("Captação", CAMPOS_CAPT, "captacoes.parquet")):
        print(f"{tin}:")
        df = pl.concat([baixa(e, s, c, tin, campos) for e, s, c in CAMADAS],
                       how="diagonal")
        path = S / nome
        df.write_parquet(path)
        print(f"  {df.height} outorgas -> {nome} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
