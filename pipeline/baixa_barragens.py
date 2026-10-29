#!/usr/bin/env python3
"""Barragens do SNISB e hidrelétricas da Aneel, como pontos para a rede.

O mapa desenha 168 reservatórios do SIN; o país tem perto de 29 mil barragens
cadastradas. Este script só baixa e normaliza -- quem casa com a rede e conta
rio livre é o barragens.py.

Duas camadas, porque nenhuma basta sozinha:

  SNISB (IG/SNISB/MapServer/0) -- o cadastro nacional de segurança de barragem.
      Toda finalidade (irrigação, açude, rejeito de mineração), mas para
      hidrelétrica é incompleto: tem ~1,6 mil de uso hidroelétrico.
  AHE (SPR/Aproveitamento_Hidreletrico_AHE/MapServer/0) -- os ~3 mil
      empreendimentos hidrelétricos em operação da Aneel, com potência.

A deduplicação entre as duas é do barragens.py, por proximidade sobre o trecho
casado: aqui cada uma sai com sua origem marcada.

Armadilhas medidas contra o serviço:

  1. **ING_CD_CURSODAGUA_TRECHO não é código de ottobacia.** Vinha vazio em
     ago/2026; em out/2026 está preenchido em 28.562 de 28.902 linhas, e o
     barragens.py confere se o valor casa com o COBACIA da BHO antes de usá-lo
     como desempate. O casamento continua sendo espacial.
  2. **Metade não tem classificação de risco.** "Não Classificado" é a maior
     categoria de CATEGORIA_RISCO e de DANO_POTENCIAL; a ficha mostra isso como
     informação, não como dado faltante.
  3. **A geometria do SNISB vem em Web Mercator** (wkid 102100). Pedimos
     outSR=4674 (SIRGAS 2000, o datum da BHO) em vez de usar as colunas de
     latitude/longitude, que são texto digitado e às vezes vêm trocadas.
  4. **A camada AHE "em operação" traz usina que nunca foi construída.** São
     Luiz do Tapajós (licença negada em 2016), Marabá e Jamanxim estão lá, com
     potência outorgada e tudo. O que separa é AHE_NU_POTFISC_KW, a potência
     fiscalizada: nula em quem não opera. Só entra quem tem esse número.
  5. **O ArcGIS do SNIRH é lento** -- 37 s para o metadado de uma camada em
     ago/2026. Backoff e paginação do baixa_etes.py.
"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import polars as pl
import requests

S = Path(__file__).parent
BASE = "https://www.snirh.gov.br/arcgis/rest/services/"
SNISB = BASE + "IG/SNISB/MapServer/0"
AHE = BASE + "SPR/Aproveitamento_Hidreletrico_AHE/MapServer/0"
CAMPOS_SNISB = ("BAR_CD_SNISB,BAR_NM_NOME,USO_PRINCIPAL,FASE_DE_VIDA,CATEGORIA_RISCO,"
                "DANO_POTENCIAL,BAR_NU_ALT_MAX_NIVEL_TERRENO,BAR_NU_CAP_TOTAL_RESERV,"
                "ING_NM_MUNICIPIO,ING_SG_UFMUNICIPIO,NM_EMPREENDEDOR,ING_NM_TRECHO,"
                "ING_CD_CURSODAGUA_TRECHO,BAR_DS_CLASSE,POSSUI_PAE")
CAMPOS_AHE = "AHE_NM,AHE_TP,AHE_DS_CLASSE,AHE_NU_POT_KW,AHE_NU_POTFISC_KW,AHE_NM_RIO"


def pega(url, params, tentativas=6):
    for i in range(tentativas):
        try:
            r = requests.post(url + "/query", data={**params, "f": "json"}, timeout=300)
            r.raise_for_status()
            d = r.json()
            if "error" in d:
                raise RuntimeError(str(d["error"])[:200])
            return d
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                raise SystemExit(f"{url}: desisti depois de {tentativas} tentativas -- {e}")
            time.sleep(3 * 2 ** i)


def baixa(url, campos, pag_max=None):
    meta = requests.get(url, params={"f": "json"}, timeout=300).json()
    pag = int(meta.get("maxRecordCount") or 1000)
    # A camada da Aneel devolve 504 em página cheia de 1.000 (out/2026); a
    # mesma consulta em 250 passa.
    if pag_max:
        pag = min(pag, pag_max)
    n = pega(url, {"where": "1=1", "returnCountOnly": "true"})["count"]
    # Em 29/10/2026 o SNISB passou a responder {"count":0} sem erro, minutos
    # depois de entregar 28.902 -- serviço em recarga. Zero não é resposta.
    if not n:
        raise SystemExit(f"{url}: o serviço devolveu 0 registros -- fora do ar? tente mais tarde")
    print(f"{url.split('services/')[1]}: {n} registros em {-(-n // pag)} páginas de {pag}")

    def pagina(off):
        return pega(url, {"where": "1=1", "outFields": campos, "returnGeometry": "true",
                          "outSR": 4674, "orderByFields": "OBJECTID",
                          "resultOffset": off, "resultRecordCount": pag})["features"]

    with ThreadPoolExecutor(4) as ex:
        feats = [f for p in ex.map(pagina, range(0, n, pag)) for f in p]
    # Página que volta curta sem erro é o modo de falha calado deste serviço;
    # sem a conferência o arquivo sai com um buraco e ninguém percebe.
    if len(feats) != n:
        raise SystemExit(f"  recebidos {len(feats)} de {n} -- rode de novo")
    linhas = []
    for f in feats:
        g = f.get("geometry") or {}
        linhas.append({**f["attributes"], "lon": g.get("x"), "lat": g.get("y")})
    return linhas


def texto(v):
    v = (v or "").strip() if isinstance(v, str) else v
    return v or None


def main():
    snisb = baixa(SNISB, CAMPOS_SNISB)
    df = pl.DataFrame(snisb, infer_schema_length=None)
    trecho = df["ING_CD_CURSODAGUA_TRECHO"].drop_nulls().cast(pl.Utf8).str.strip_chars()
    print(f"  ING_CD_CURSODAGUA_TRECHO preenchido: {int((trecho != '').sum())}")
    antes = df.height
    df = df.unique("BAR_CD_SNISB", keep="first", maintain_order=True)
    sem_geo = df.filter(pl.col("lon").is_null() | pl.col("lat").is_null()).height
    print(f"  {antes} linhas -> {df.height} barragens distintas; {sem_geo} sem geometria")
    for col in ("USO_PRINCIPAL", "FASE_DE_VIDA", "CATEGORIA_RISCO", "DANO_POTENCIAL"):
        cont = df.group_by(col).len().sort("len", descending=True)
        print(f"  {col}: " + " · ".join(f"{v or 'nulo'} {n}" for v, n in cont.rows()[:12]))

    barr = df.select(
        pl.lit("snisb").alias("origem"),
        pl.col("BAR_CD_SNISB").cast(pl.Utf8).alias("id"),
        pl.col("BAR_NM_NOME").map_elements(texto, return_dtype=pl.Utf8).alias("nome"),
        pl.col("USO_PRINCIPAL").map_elements(texto, return_dtype=pl.Utf8).alias("uso"),
        pl.col("FASE_DE_VIDA").map_elements(texto, return_dtype=pl.Utf8).alias("fase"),
        pl.col("CATEGORIA_RISCO").map_elements(texto, return_dtype=pl.Utf8).alias("risco"),
        pl.col("DANO_POTENCIAL").map_elements(texto, return_dtype=pl.Utf8).alias("dano"),
        pl.lit(None, dtype=pl.Utf8).alias("tipo"),
        pl.col("BAR_NU_ALT_MAX_NIVEL_TERRENO").cast(pl.Float64).alias("altura_m"),
        # A capacidade vem em hm³ (milhões de m³) no SNISB.
        pl.col("BAR_NU_CAP_TOTAL_RESERV").cast(pl.Float64).alias("cap_hm3"),
        pl.lit(None, dtype=pl.Float64).alias("pot_kw"),
        pl.col("ING_NM_TRECHO").map_elements(texto, return_dtype=pl.Utf8).alias("rio"),
        # Código ottocodificado do curso d'água, de tamanho variável ('86',
        # '77978322'): é prefixo do COBACIA dos trechos daquele rio, e entra no
        # barragens.py como desempate, igual ao da outorga.
        pl.col("ING_CD_CURSODAGUA_TRECHO").cast(pl.Utf8).map_elements(texto, return_dtype=pl.Utf8)
          .alias("cocurso"),
        pl.col("ING_NM_MUNICIPIO").map_elements(texto, return_dtype=pl.Utf8).alias("mun"),
        pl.col("ING_SG_UFMUNICIPIO").map_elements(texto, return_dtype=pl.Utf8).alias("uf"),
        pl.col("lon").cast(pl.Float64), pl.col("lat").cast(pl.Float64),
    ).filter(pl.col("lon").is_not_null() & pl.col("lat").is_not_null())

    ahe = pl.DataFrame(baixa(AHE, CAMPOS_AHE, pag_max=250), infer_schema_length=None)
    projeto = ahe.filter(pl.col("AHE_NU_POTFISC_KW").fill_null(0) <= 0)
    print(f"  sem potência fiscalizada (não operam, saem): {projeto.height} -- "
          + ", ".join(projeto.sort("AHE_NU_POT_KW", descending=True)["AHE_NM"].head(5).to_list()))
    ahe = ahe.filter(pl.col("AHE_NU_POTFISC_KW").fill_null(0) > 0)
    print("  AHE_TP: " + " · ".join(f"{v} {n}" for v, n in
                                     ahe.group_by("AHE_TP").len().sort("len", descending=True).rows()))
    ahe = ahe.with_row_index("i").select(
        pl.lit("aneel").alias("origem"),
        pl.format("ahe-{}", pl.col("i")).alias("id"),
        pl.col("AHE_NM").map_elements(texto, return_dtype=pl.Utf8).alias("nome"),
        pl.lit("Hidroelétrica").alias("uso"),
        pl.col("AHE_TP").map_elements(texto, return_dtype=pl.Utf8).alias("tipo"),
        pl.lit("Operação").alias("fase"),
        pl.lit(None, dtype=pl.Utf8).alias("risco"),
        pl.lit(None, dtype=pl.Utf8).alias("dano"),
        pl.lit(None, dtype=pl.Float64).alias("altura_m"),
        pl.lit(None, dtype=pl.Float64).alias("cap_hm3"),
        pl.col("AHE_NU_POTFISC_KW").cast(pl.Float64).alias("pot_kw"),
        pl.col("AHE_NM_RIO").map_elements(texto, return_dtype=pl.Utf8).alias("rio"),
        pl.lit(None, dtype=pl.Utf8).alias("cocurso"),
        pl.lit(None, dtype=pl.Utf8).alias("mun"),
        pl.lit(None, dtype=pl.Utf8).alias("uf"),
        pl.col("lon").cast(pl.Float64), pl.col("lat").cast(pl.Float64),
    ).filter(pl.col("lon").is_not_null())
    print(f"  {ahe.height} hidrelétricas com ponto")

    saida = pl.concat([barr, ahe], how="diagonal_relaxed")
    destino = S / "barragens.parquet"
    saida.write_parquet(destino)
    print(f"-> {destino.name}: {saida.height} pontos ({destino.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    sys.exit(main())
