#!/usr/bin/env python3
"""Faz a licença de retirada subir pela rede e vira fração da vazão de cada trecho.

Espelho do poluicao.py, com o sinal trocado. Lá a pergunta é quanto de efluente
ENTRA no rio; aqui é quanto de água já está autorizado a SAIR dele. As outorgas
de captação vigentes do SNIRH dizem onde fica cada tomada d'água e quanto ela
pode tirar; o mapa já sabe quanta água passa em cada trecho. A razão entre as
duas é o que esta camada pinta: **que fração deste rio, aqui, já está prometida
em licença**.

A conta acumula a montante, como a do efluente, e pela mesma razão: uma retirada
lá em cima falta aqui embaixo. Um pivô no alto de uma cabeceira pinta forte no
córrego onde capta e vai desbotando conforme o rio engorda — não porque a água
volte, mas porque a licença pesa menos sobre um leito maior.

Três coisas que este número **não** é, e que a página precisa dizer junto:

  não é uso     — é licença. Ninguém garante que a água autorizada seja retirada,
                  nem que a retirada real caiba na licença.
  não é consumo — irrigação consome quase tudo o que tira, indústria devolve boa
                  parte. A camada trata os dois igual, porque a base não informa
                  a devolução.
  não é série   — são as outorgas válidas hoje. Caracterizam a pressão atual, não
                  a história que levou o rio até aqui.

Diferente do painel de outorga do series.html, que soma por MUNICÍPIO porque a
tendência só tem coordenada de estação, esta camada usa a coordenada do próprio
ponto outorgado. É a diferença entre "o município de Barreiras tem licença de
dez vezes o Rio da Boa Sorte" e "esta tomada d'água fica neste trecho".

Uso:
    python3 baixa_topologia.py 1     # se ainda não houver bho_topologia*.parquet
    python3 outorga.py               # recalcula `out` no rede_vazao.json
    python3 monta_pagina.py
"""
import json
from pathlib import Path

import numpy as np
import polars as pl
from shapely.geometry import Point
from shapely.strtree import STRtree

from poluicao import TOL_SNAP, decodifica, geometria_do_mapa
from processa import codifica

S = Path(__file__).parent

# Teto do que a camada representa: 300% da vazão média. Acima disso o valor
# deixa de discriminar (o leitor não distingue 400% de 900%, e as duas coisas
# querem dizer o mesmo: a licença perdeu relação com o leito) e o varint fica
# mais gordo à toa. O corte é do desenho, não da conta — os extremos continuam
# saindo no relatório do terminal.
TETO = 3.0
# Abaixo disso não pinta: 0,1% de licença sobre a vazão é ruído de arredondamento
# e encheria o mapa de traço colorido sem significado.
PISO = 0.001


def carrega_captacoes() -> pl.DataFrame:
    """Lê as outorgas de captação e converte a vazão.

    `int_qt_vazaomedia` vem nula em cerca de um terço dos registros. Eles
    continuam entrando: o ponto existe, a licença existe, e descartá-los faria a
    contagem de tomadas d'água mentir. O que eles não fazem é somar volume —
    entram como presença, igual ao que poluicao.py faz com o lançamento sem
    vazão declarada.
    """
    df = pl.read_parquet(S / "captacoes.parquet")
    df = df.with_columns(
        # a fonte traz m³/h; o mapa trabalha em m³/s
        (pl.col("int_qt_vazaomedia").fill_null(0.0) / 3600.0).alias("m3s"),
    )
    # Captação em poço tira do aquífero, não do leito. Some da camada de rio —
    # o que não quer dizer que não afete o rio: no oeste da Bahia é justamente o
    # bombeamento do Urucuia que a literatura aponta como causa do rebaixamento
    # das nascentes. Essa parte esta camada não enxerga, e a página diz isso.
    if "tch_ds" in df.columns:
        df = df.filter(pl.col("tch_ds") != "Poço")
    return df


def calcula(geoms, props, jus, ordem_topo, q) -> dict:
    """Fração da vazão já outorgada em cada trecho, acumulada de montante.

    Devolve o bloco pronto para entrar no JSON do mapa.
    """
    df = carrega_captacoes()
    print(f"captações vigentes em corpo d'água: {df.height}")
    sem_vazao = int((df["m3s"] <= 0).sum())
    print(f"  sem vazão declarada (entram como presença, não somam): {sem_vazao}")
    por_fin = (df.group_by("tfn_ds")
                 .agg(pl.len().alias("n"), pl.col("m3s").sum().alias("m3s"))
                 .sort("m3s", descending=True))
    for fin, n, v in por_fin.head(5).rows():
        print(f"    {v:8.1f} m³/s  {n:>6} outorgas  {fin}")

    # --- casa cada ponto ao trecho mais próximo ---
    # Mesma regra do lançamento: a distância decide, e o código de ottobacia da
    # própria outorga desempata quando aponta um dos candidatos. Sem o desempate
    # a tomada d'água cai no córrego vizinho sempre que houver dois dentro de
    # 2 km, o que em área de pivô é a regra e não a exceção.
    arvore = STRtree(geoms)
    cob = [str(p.get("COBACIA") or "") for p in props]
    carga = np.zeros(len(geoms))
    casados = orfaos = confere = testados = 0
    # Quebra por finalidade do que de fato entrou no desenho. A quebra do
    # arquivo inteiro (acima) inclui o que ficou órfão, e citar uma no lugar da
    # outra erra a proporção — foi assim que a nota do mapa nasceu dizendo 79%
    # de irrigação onde o número da base casada é outro.
    fin_m3s: dict[str, float] = {}
    for r in df.iter_rows(named=True):
        lat, lon = r["int_nu_latitude"], r["int_nu_longitude"]
        if lat is None or lon is None or (lat == 0 and lon == 0):
            orfaos += 1
            continue
        p = Point(lon, lat)
        oc = (r["ing_cd_ottobacia_trecho"] or "").strip()
        melhor, dmin = None, TOL_SNAP
        melhor_oc, dmin_oc = None, TOL_SNAP
        for i in arvore.query(p.buffer(TOL_SNAP)):
            i = int(i)
            d = geoms[i].distance(p)
            if d < dmin:
                melhor, dmin = i, d
            if oc and d < dmin_oc:
                c = cob[i]
                if c and (c.startswith(oc) or oc.startswith(c)):
                    melhor_oc, dmin_oc = i, d
        if oc:
            testados += 1
            if melhor_oc is not None:
                confere += 1
        escolhido = melhor_oc if melhor_oc is not None else melhor
        if escolhido is None:
            orfaos += 1
            continue
        casados += 1
        v = max(r["m3s"], 0.0)
        carga[escolhido] += v
        fin_m3s[r["tfn_ds"] or "sem finalidade"] = fin_m3s.get(r["tfn_ds"] or "sem finalidade", 0.0) + v
    print(f"  casados a um trecho: {casados} · órfãos: {orfaos}")
    if testados:
        print(f"  confere com o código de ottobacia da fonte: "
              f"{confere}/{testados} ({100 * confere / testados:.0f}%)")
    total = carga.sum()
    print(f"  vazão outorgada casada à rede: {total:.1f} m³/s")
    print("  finalidade do que entrou no desenho (é esta a quebra que a página cita):")
    for fin, v in sorted(fin_m3s.items(), key=lambda kv: -kv[1])[:5]:
        print(f"    {v:8.1f} m³/s  {100 * v / total:4.1f}%  {fin}")

    # --- desce pela rede ---
    # ordem_topo vai de montante para jusante: somar em jus[i] depois de fechar i
    # propaga o total até a foz. O que se acumula aqui é a licença de TUDO que
    # está acima deste ponto, que é o que o trecho deixa de ver passar.
    acum = carga.copy()
    for i in ordem_topo:
        j = jus[i]
        if j >= 0:
            acum[j] += acum[i]

    qs = np.maximum(np.asarray(q, dtype=float), 1e-6)
    frac = np.clip(acum / qs, 0.0, TETO)
    vis = frac[frac >= PISO]
    print(f"  {len(vis)} trechos acima de {PISO * 100:.1f}% de licença · "
          f"mediana {100 * np.median(vis) if len(vis) else 0:.1f}%")
    for lim in (0.25, 0.5, 1.0):
        print(f"    acima de {lim * 100:.0f}% da vazão: {int((frac >= lim).sum())} trechos")

    return {"out": codifica([int(round(v * 10000)) for v in frac])}


def main() -> int:
    topo = sorted(S.glob("bho_topologia*.parquet"))
    if not topo:
        raise SystemExit("bho_topologia*.parquet ausente — rode baixa_topologia.py 1")
    props = pl.read_parquet(topo[0]).to_dicts()
    print(f"topologia: {len(props)} trechos de {topo[0].name}")

    dados = json.loads((S / "rede_vazao.json").read_text())
    if dados["n"] != len(props):
        raise SystemExit(f"rede_vazao.json tem {dados['n']} trechos e a topologia "
                         f"{len(props)} — as duas precisam vir da mesma versão da base")
    area_json = decodifica(dados["area"])
    area_bho = [int(round(p["NUAREAMONT"])) for p in props]
    difs = sum(1 for a, b in zip(area_json, area_bho) if a != b)
    if difs:
        raise SystemExit(f"ordem dos trechos não bate ({difs} áreas diferentes) — "
                         "rede_vazao.json e a topologia estão em versões distintas")
    print("  ordem dos trechos confere com rede_vazao.json")

    geoms = geometria_do_mapa(dados)
    print(f"  geometria reconstruída: {len(geoms)} linhas")

    area = np.array([p["NUAREAMONT"] for p in props])
    pos = {p["COTRECHO"]: i for i, p in enumerate(props)}
    jus = np.array([pos.get(p["NUTRJUS"], -1) for p in props])
    ordem_topo = np.argsort(area)
    q = np.array(decodifica(dados["q"]), dtype=float) / 1000.0

    dados.update(calcula(geoms, props, jus, ordem_topo, q))
    caminho = S / "rede_vazao.json"
    caminho.write_text(json.dumps(dados, separators=(",", ":"), ensure_ascii=False))
    print(f"\n-> {caminho} ({caminho.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
