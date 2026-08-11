#!/usr/bin/env python3
"""Nomeia a bacia de cada trecho, para a linha "Bacia" na ficha do mapa.

Desce a rede pelo trecho de jusante (NUTRJUS) até não haver mais para onde ir —
a foz, ou a fronteira, para os rios que saem do país — e usa o nome oficial da
ANA naquele ponto como bacia de todo mundo que drena até ali. É a mesma lógica
de bacia incremental do tendencia_rede.py, só que sem régua nenhuma: aqui o
"dono" de cada trecho é o ponto final do seu próprio curso, não uma estação.

Duas correções em cima do resultado cru:

1. **Fronteira.** Vários rios grandes do Sul e Sudoeste (Paraná, Paraguai,
   Uruguai) só terminam de verdade fora do Brasil, no Rio da Prata — a base
   continua a topologia até lá. Sem corte, os três aparecem com um nome só
   ("Rio da Prata"), que ninguém no Brasil usa. A regra: só refina o trecho
   pela fronteira quando o TERMINAL ORIGINAL do grupo já está fora do Brasil
   (campo `fora` do próprio rede_vazao.json) — Amazonas, São Francisco etc.
   desaguam dentro do país e não são tocados. Onde o terminal é estrangeiro,
   reconta parando um passo antes de entrar em território de fora, o que
   recupera os nomes que o brasileiro reconhece.

2. **Delta sem nome de rio.** O Tocantins se perde no complexo estuarino do
   Amazonas antes de qualquer trecho voltar a se chamar "Rio Tocantins" — o
   terminal do grupo é rotulado "Baía de Marajó" pela ANA, o que faria a bacia
   inteira (184 mil km de rio) aparecer com um nome de acidente geográfico
   pequeno em vez do quinto maior rio do país. `RENOMEIA` corrige esse único
   caso, verificado à mão (ver README/histórico do commit).

Só as `TOP_N` maiores bacias por quilômetro de rio ganham nome — o resto
(~um quinto da rede, em milhares de bacias costeiras e de fronteira pequenas)
cai em "Outras bacias", índice 0. Sem esse corte o dicionário de nomes explode
(checamos: sem a correção da fronteira dá 63 mil grupos, a maioria riachos de
fronteira que nunca vê usuário nenhum) e o campo pesaria mais do que vale.

Uso:
    python3 baixa_topologia.py 1     # se ainda não houver bho_topologia*.parquet
    python3 processa.py              # se rede_vazao.json ainda não existe
    python3 bacia_rede.py            # acrescenta `bacia` e `bacias` a ele
    python3 monta_pagina.py
"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import polars as pl

from processa import codifica

S = Path(__file__).parent
URL = ("https://www.snirh.gov.br/arcgis/rest/services/SPR/"
       "BHO2017_5K_TRECHODRENAGEM/FeatureServer/0/query")

TOP_N = 24
# Ver ponto 2 da docstring: o terminal deste grupo é rotulado por um acidente
# geográfico do estuário, não pelo rio. Índice é por nome, não por COTRECHO,
# porque o próprio nome pode mudar de trecho terminal entre rodadas da ANA.
RENOMEIA = {"Baía de Marajó": "Rio Tocantins"}


def decodifica(s):
    IDX = {c: i for i, c in enumerate(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")}
    out, v, desl = [], 0, 0
    for ch in s:
        c = IDX[ch]
        v |= (c & 31) << desl
        if c & 32:
            desl += 5
            continue
        out.append(~(v >> 1) if v & 1 else v >> 1)
        v, desl = 0, 0
    return out


def raizes(jus, n):
    """Índice do terminal (sem downstream) de cada trecho, por doubling em log n passos."""
    terminal = jus < 0
    prox = np.where(jus >= 0, jus, np.arange(n))
    alvo = np.arange(n, dtype=np.int64)
    for _ in range(30):
        novo = np.where(terminal[alvo], alvo, prox[alvo])
        if np.array_equal(novo, alvo):
            break
        alvo = novo
        prox = np.where(terminal[np.arange(n)], np.arange(n), prox[prox.clip(0, n - 1)])
    return alvo


def busca_nomes(cotrechos):
    """NORIOCOMP de uma lista de COTRECHO, em lotes — evita URL gigante."""
    nomes = {}
    for i in range(0, len(cotrechos), 200):
        lote = cotrechos[i:i + 200]
        params = {
            "where": f"COTRECHO IN ({','.join(map(str, lote))})",
            "outFields": "COTRECHO,NORIOCOMP",
            "returnGeometry": "false",
            "f": "json",
        }
        data = urllib.parse.urlencode(params).encode()
        req = urllib.request.Request(URL, data=data, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.load(r)
        for f in resp.get("features", []):
            a = f["attributes"]
            nomes[a["COTRECHO"]] = (a.get("NORIOCOMP") or "").strip()
    return nomes


def main() -> int:
    topo = sorted(S.glob("bho_topologia*.parquet"))
    if not topo:
        raise SystemExit("bho_topologia*.parquet ausente — rode baixa_topologia.py 1")
    props = pl.read_parquet(topo[0]).to_dicts()
    n = len(props)
    print(f"topologia: {n} trechos de {topo[0].name}")

    caminho = S / "rede_vazao.json"
    dados = json.loads(caminho.read_text())
    if dados["n"] != n:
        raise SystemExit(f"rede_vazao.json tem {dados['n']} trechos e a topologia {n} — "
                          "as duas precisam vir da mesma versão da base")
    area_json = decodifica(dados["area"])
    difs = sum(1 for a, b in zip(area_json, (int(round(p["NUAREAMONT"])) for p in props)) if a != b)
    if difs:
        raise SystemExit(f"ordem dos trechos não bate ({difs} áreas diferentes) — "
                          "rede_vazao.json e a topologia estão em versões distintas")
    print("  ordem dos trechos confere com rede_vazao.json")

    cot_por_idx = [p["COTRECHO"] for p in props]
    pos = {c: i for i, c in enumerate(cot_por_idx)}
    jus = np.array([pos.get(p["NUTRJUS"], -1) for p in props], dtype=np.int64)

    fora = np.zeros(n, dtype=bool)
    acc = 0
    for d in decodifica(dados["fora"]):
        acc += d
        fora[acc] = True

    # passada 1: terminal cru, sem olhar fronteira
    raiz = raizes(jus, n)

    # passada 2: só nos grupos cujo terminal cru já está fora do Brasil, refaz
    # cortando ao entrar em trecho fora — descasca Paraná/Paraguai/Uruguai de
    # dentro do que seria só "Rio da Prata"
    grupos_fora = np.flatnonzero(fora[raiz])
    if grupos_fora.size:
        jus_corte = np.where((jus >= 0) & fora[np.clip(jus, 0, n - 1)], -1, jus)
        raiz_cortada = raizes(jus_corte, n)
        raiz[grupos_fora] = raiz_cortada[grupos_fora]
        print(f"  {int(np.unique(raiz[grupos_fora]).size)} sub-bacias recuperadas de grupos "
              f"cujo terminal original já era estrangeiro ({grupos_fora.size} trechos)")

    comp = np.array(decodifica(dados["comp"]), dtype=float) / 10.0
    distintas, inv = np.unique(raiz, return_inverse=True)
    km_por_grupo = np.bincount(inv, weights=comp)
    ordem = np.argsort(-km_por_grupo)[:TOP_N]

    candidatos_cot = [cot_por_idx[distintas[k]] for k in ordem]
    nomes = busca_nomes(candidatos_cot)
    print(f"  {sum(1 for c in candidatos_cot if nomes.get(c))} das {TOP_N} maiores por km "
          f"têm nome oficial (as sem nome caem em 'Outras bacias')")

    raiz_para_nome = {}
    for k in ordem:
        cot = cot_por_idx[distintas[k]]
        nome = nomes.get(cot)
        if nome:
            raiz_para_nome[int(distintas[k])] = RENOMEIA.get(nome, nome)

    nomes_unicos = sorted(set(raiz_para_nome.values()))
    tabela = ["Outras bacias"] + nomes_unicos
    nome_para_bucket = {nm: i + 1 for i, nm in enumerate(nomes_unicos)}
    raiz_para_bucket = {r: nome_para_bucket[nm] for r, nm in raiz_para_nome.items()}

    bucket = np.array([raiz_para_bucket.get(int(r), 0) for r in raiz], dtype=np.int64)
    outras = int((bucket == 0).sum())
    print(f"  {len(nomes_unicos)} bacias nomeadas, {outras} trechos ({100 * outras / n:.0f}%) "
          "em 'Outras bacias'")

    dados["bacia"] = codifica(bucket.tolist())
    dados["bacias"] = tabela
    caminho.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    print(f"-> {caminho} ({caminho.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
