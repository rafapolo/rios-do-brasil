#!/usr/bin/env python3
"""Leva a tendência da estação para os trechos que ela mede.

O modo Tendência do mapa nasceu como camada de pontos: um disco por estação,
colorido pela inclinação de Theil-Sen. O número estava lá, mas o rio não — quem
abria o modo via onde ficam os postos, não quais rios estão secando. Este script
dá forma de rio ao número.

A tendência é medida num ponto e vale para uma bacia: o que passou na régua veio
de tudo que drena até ali. Então cada trecho herda a tendência da **primeira
estação a jusante dele** — a bacia incremental de cada posto, parando na próxima
estação rio acima. Isso reparte a rede sem sobreposição: dois postos encaixados
no mesmo rio não disputam trecho, o de cima fica com o que é dele.

Por cima disso vem o PISO. Sem ele, um posto de bacia grande sem nenhuma estação
acima leva seu número até a última nascente: 332 mil trechos, 72% da rede, dois
milhões de quilômetros — e um córrego de cabeceira de 0,2 m³/s não foi medido
por uma régua no tronco a quinhentos quilômetros dali. O piso corta por fração
da vazão da estação, que é a pergunta certa ("este trecho é uma parte
apreciável do que a régua viu passar?") e não por vazão absoluta, que trataria
igual o Amazonas e um riacho do agreste.

O que este número NÃO é, e a página precisa dizer junto: não é tendência medida
no trecho. É a tendência do posto, estendida à área que drena até ele. Onde a
bacia incremental é grande, a extensão é grande — o Solimões-Amazonas inteiro
sai da régua de Jatuarana.

Uso:
    python3 baixa_topologia.py 1     # se ainda não houver bho_topologia*.parquet
    python3 analisa_tendencia.py     # faz o tendencia.json
    python3 tendencia_mapa.py        # poda para o tendencia_mapa.json
    python3 tendencia_rede.py        # acrescenta `lista` e `trecho` a ele
    python3 monta_pagina.py
"""
import json
import math
from pathlib import Path

import numpy as np
import polars as pl
from shapely.geometry import Point
from shapely.strtree import STRtree

from poluicao import decodifica, geometria_do_mapa
from processa import codifica

S = Path(__file__).parent

# Fração da vazão da estação abaixo da qual o trecho não é pintado. 2% deixa o
# tronco e os afluentes grandes e descarta o capilar: 42 mil trechos em vez de
# 332 mil, 205 mil km em vez de dois milhões, e um blob de 78 kB em vez de 346.
PISO = 0.02

# Os mesmos do processa.py, que é onde este casamento estação->trecho existe
# primeiro: até 0,05° (~5 km) de distância e área de drenagem a até ~1,4x. As
# duas condições juntas é que fazem a régua cair no rio certo — só a distância
# casaria um posto do afluente com o tronco que passa ao lado.
TOL_GRAU = 0.05
TOL_AREA = 0.35   # em log; 0,35 é fator 1,42


def casa_estacoes(geoms, area, estacoes):
    """Índice do trecho que cada estação mede. Cópia do critério do processa.py.

    Devolve {índice do trecho -> posição na lista de estações}. Quando duas
    estações caem no mesmo trecho vence a de melhor score, como lá — e a perdida
    fica sem trecho, continuando visível como ponto.
    """
    tree = STRtree(geoms)
    melhor_de = {}
    for k, e in enumerate(estacoes):
        p = Point(e["lon"], e["lat"])
        alvo, nota = None, None
        for i in tree.query(p.buffer(TOL_GRAU)):
            i = int(i)
            d = geoms[i].distance(p)
            if d > TOL_GRAU:
                continue
            razao = abs(math.log((area[i] or 1) / max(e["area"] or 1, 1e-9)))
            if razao > TOL_AREA:
                continue
            score = razao + d * 10
            if nota is None or score < nota:
                alvo, nota = i, score
        if alvo is None:
            continue
        anterior = melhor_de.get(alvo)
        if anterior is None or nota < anterior[1]:
            melhor_de[alvo] = (k, nota)
    return {tr: k for tr, (k, _) in melhor_de.items()}


def calcula(geoms, area, jus, ordem_topo, q, estacoes):
    """Índice+1 da estação que pinta cada trecho, 0 onde nenhuma pinta."""
    n = len(geoms)
    ancora = np.full(n, -1, dtype=np.int32)
    for tr, k in casa_estacoes(geoms, area, estacoes).items():
        ancora[tr] = k
    print(f"  {int((ancora >= 0).sum())} das {len(estacoes)} estações casaram a um trecho")

    # Ordem topológica invertida: o trecho de jusante fecha antes, e aí o de
    # montante só copia o dono dele. Uma passada, sem recursão nem fila.
    dono = np.full(n, -1, dtype=np.int32)
    for i in ordem_topo[::-1]:
        i = int(i)
        if ancora[i] >= 0:
            dono[i] = ancora[i]
        elif jus[i] >= 0:
            dono[i] = dono[jus[i]]
    cheio = int((dono >= 0).sum())
    print(f"  bacia incremental: {cheio} trechos têm estação a jusante "
          f"({100 * cheio / n:.0f}% da rede)")

    # O piso, com a âncora sempre dentro: o trecho onde a régua está é o único
    # em que a medição é literal, e perdê-lo por arredondamento apagaria do mapa
    # justamente a estação que a nota promete mostrar.
    qest = np.array([e["q"] for e in estacoes], dtype=float)
    frac = np.where(dono >= 0, q / np.maximum(qest[np.clip(dono, 0, None)], 1e-9), 0.0)
    pinta = (dono >= 0) & ((frac >= PISO) | (ancora >= 0))
    print(f"  o piso de {PISO * 100:.0f}% descarta {int((dono >= 0).sum() - pinta.sum())} "
          "deles, capilar longe demais da régua para carregar o número dela")
    return np.where(pinta, dono + 1, 0)


def main() -> int:
    topo = sorted(S.glob("bho_topologia*.parquet"))
    if not topo:
        raise SystemExit("bho_topologia*.parquet ausente — rode baixa_topologia.py 1")
    props = pl.read_parquet(topo[0]).to_dicts()
    print(f"topologia: {len(props)} trechos de {topo[0].name}")

    caminho = S / "tendencia_mapa.json"
    if not caminho.exists():
        raise SystemExit("tendencia_mapa.json ausente — rode tendencia_mapa.py")
    tend = json.loads(caminho.read_text())

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

    area = np.array([p["NUAREAMONT"] for p in props], dtype=float)
    pos = {p["COTRECHO"]: i for i, p in enumerate(props)}
    jus = np.array([pos.get(p["NUTRJUS"], -1) for p in props])
    ordem_topo = np.argsort(area)
    q = np.array(decodifica(dados["q"]), dtype=float) / 1000.0
    comp = np.array(decodifica(dados["comp"]), dtype=float) / 10.0

    # As mesmas duas peneiras que o modo aplica sempre, e que o template repete
    # do lado de lá: significância a 5% com FDR, e fora de barragem.
    est = [e for e in dados["estacoes"]
           if (t := tend["estacoes"].get(e["cod"])) and t[1] and not t[2]]
    pct = np.array([tend["estacoes"][e["cod"]][0] for e in est])
    print(f"  {len(est)} estações passam nos dois testes e podem pintar trecho")

    trecho = calcula(geoms, area, jus, ordem_topo, q, est)

    tend["lista"] = [e["cod"] for e in est]
    tend["trecho"] = codifica([int(v) for v in trecho])
    tend["piso"] = PISO
    caminho.write_text(json.dumps(tend, ensure_ascii=False, separators=(",", ":")))

    m = trecho > 0
    donos = np.clip(trecho - 1, 0, None)
    print(f"\n  {int(m.sum())} trechos pintados, {comp[m].sum() / 1000:.1f} mil km de rio")
    print("  extensão por classe de tendência:")
    faixas = [(-1e9, -25, "cai mais de 25%/déc"), (-25, -15, "cai 25 – 15%"),
              (-15, -5, "cai 15 – 5%"), (-5, 5, "estável (±5%)"),
              (5, 15, "sobe 5 – 15%"), (15, 25, "sobe 15 – 25%"),
              (25, 1e9, "sobe mais de 25%")]
    for lo, hi, rotulo in faixas:
        sel = m & (pct[donos] > lo) & (pct[donos] <= hi)
        print(f"    {rotulo:22s} {comp[sel].sum() / 1000:7.1f} mil km  "
              f"{int(sel.sum()):6d} trechos")
    # os que mais secam, para conferir contra a geografia: o ranking tem que
    # cair no semiárido e no norte de Minas, como o do series.html
    km = np.zeros(len(est))
    for i in np.flatnonzero(m):
        km[donos[i]] += comp[i]
    # Estação com 0 km é a que não casou a trecho nenhum, ou perdeu o trecho
    # para uma vizinha de score melhor: continua no mapa como ponto, sem rio.
    print("  as que mais secam, e quanto de rio cada uma pinta:")
    for k in np.argsort(pct)[:5]:
        print(f"    {pct[k]:+7.1f}%/déc  {est[k]['rio'][:24]:24s} "
              f"{est[k]['nome'][:20]:20s} {est[k]['uf'][:14]:14s} {km[k]:6.0f} km")
    print(f"  {int((km == 0).sum())} estações não pintam rio nenhum e ficam só como ponto")
    print(f"\n  {int((trecho == 0).sum())} trechos ficam cinza, "
          f"{comp[trecho == 0].sum() / 1000:.0f} mil km — nenhuma estação abaixo, "
          "ou fino demais para o piso")
    print(f"-> {caminho} ({caminho.stat().st_size / 1e3:.0f} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
