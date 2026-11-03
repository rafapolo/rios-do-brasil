#!/usr/bin/env python3
"""Quanto rio livre sobra em cada trecho, cortando a rede em cada barragem.

O mapa sabe para onde cada trecho escoa; o SNISB e a Aneel dizem onde há um
barramento. Juntando os dois dá para responder o que nenhum mapa interativo do
país responde: **este trecho faz parte de quantos quilômetros de rio que um peixe
percorre sem topar com um muro?**

A definição, porque "rio livre" admite várias:

  fragmento  — cortando a rede em cada trecho que tem barragem, ela se parte em
               pedaços. O trecho barrado fica no pedaço de CIMA (a barragem é
               posta no fim dele, rio abaixo). `livre` é a soma do comprimento
               de todos os trechos do pedaço deste trecho — rio principal e
               afluentes juntos, porque é isso que fica conectado. Vai com sinal
               negativo (−km − 1) quando nenhuma barragem encosta no pedaço:
               bacia pequena e intacta não é rio cortado. Na página vai como
               número do pedaço + tabela de km (`livre` e `livreKm`).
  barJus     — km do fim deste trecho até a primeira barragem rio abaixo, ou -1
               quando a água chega à foz (ou sai do país) sem barramento. Vai
               arredondado em degraus de BAR_PASSO km.
  barMont    — quantas barragens há a montante, contando a do próprio trecho.

Não é a métrica de conectividade de Grill et al. (2019), que pondera por vazão
e por volume de reservatório; é a contagem geométrica, mais simples de explicar
e de conferir na ficha.

Três coisas que o número não vê, e a página diz:

  - **Barragem fora do leito.** Muitos dos 29 mil cadastros do SNISB são
    açudes e tanques de irrigação ao lado do córrego, não sobre ele. O ponto
    cai no trecho mais próximo dentro de TOL e corta a rede ali, do mesmo jeito.
    Superestima a fragmentação nas cabeceiras agrícolas.
  - **Barragem sem cadastro.** O SNISB só tem o que alguém declarou; o país
    tem muito mais açude do que isso, sobretudo no semiárido. Subestima.
  - **Fora do Brasil.** Yacyretá e as barragens do Paraguai e da Argentina não
    estão em nenhuma das duas bases: o Paraná abaixo de Itaipu aparece mais
    livre do que é.

Uso:
    python3 baixa_barragens.py       # barragens.parquet
    python3 barragens.py             # acrescenta livre/barJus/barMont ao rede_vazao.json
                                     # e escreve barragens.json (camada de pontos)
    python3 monta_pagina.py
"""
import json
import unicodedata
from pathlib import Path

import numpy as np
import polars as pl
from shapely.geometry import Point
from shapely.strtree import STRtree

from poluicao import decodifica, geometria_do_mapa
from processa import codifica

S = Path(__file__).parent

# ~550 m. A barragem está SOBRE o rio que barra, então o trecho certo costuma
# ser o mais próximo de longe; o TOL_SNAP de 2 km da outorga, aqui, puxava açude
# de encosta para o córrego do vale vizinho. O que sobra órfão é relatado.
TOL = 0.005
# Fases em que não há muro de pé: projeto, plano, ruína ou já desmontada.
# "Sem informação" e nulo (10,9 mil) ficam DENTRO: é a maioria das barragens
# pequenas de fazenda, que estão lá, e descartá-las apagaria o semiárido.
FORA = {"Projeto", "Planejamento", "Desativada", "Descomissionada",
        "Descaracterizada", "Rompida"}
# O nome do rio resgata um trecho mais longe que TOL: a Aneel marca a casa de
# força, que em Belo Monte fica num canal a 2,5 km do Xingu barrado, e o ponto
# grudava num córrego de 1 m³/s. Para o SNISB, cujo nome é digitado e às vezes
# é o do açude, o resgate é mais curto.
TOL_NOME = {"aneel": 0.03, "snisb": 0.01}
# Duas hidrelétricas (Aneel e SNISB) a menos disto, no mesmo trecho casado ou no
# vizinho, são a mesma usina; a camada de pontos desenha só a do SNISB.
TOL_DUP = 0.01
# Degrau, em km, da distância até a primeira barragem rio abaixo.
BAR_PASSO = 5


def normaliza(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    for p in ("rio ", "ribeirao ", "corrego ", "arroio "):
        s = s.replace(p, "")
    return s.strip()


def casa(df, geoms, cob, nomes_trecho):
    """Trecho de cada ponto: o mais próximo, com dois desempates.

    O código do curso d'água do SNISB deveria ser prefixo do COBACIA dos
    trechos daquele rio, mas só aponta para um curso a menos de 5 km em 65% dos
    casos (amostra de 3 mil, out/2026) -- parece vir de outra versão da BHO.
    Fica como desempate dentro de TOL. O nome do rio (Aneel e SNISB) vale até
    TOL_NOME: ganha o trecho mais próximo cujo nome confere.
    """
    arvore = STRtree(geoms)
    trecho = np.full(df.height, -1)
    dist = np.full(df.height, np.nan)
    confere = testados = 0
    for k, r in enumerate(df.iter_rows(named=True)):
        p = Point(r["lon"], r["lat"])
        oc = (r["cocurso"] or "").strip()
        oc = oc if oc.isdigit() and not oc.endswith("9999") else ""
        rio = normaliza(r["rio"])
        rio = rio if rio and rio != "sem nome" else ""
        raio = max(TOL, TOL_NOME[r["origem"]]) if rio else TOL
        melhor, dmin = None, TOL
        melhor_ok, dmin_ok = None, raio
        for i in arvore.query(p.buffer(raio)):
            i = int(i)
            d = geoms[i].distance(p)
            if d < dmin:
                melhor, dmin = i, d
            ok = ((oc and d < TOL and cob[i].startswith(oc))
                  or (rio and rio == nomes_trecho[i]))
            if ok and d < dmin_ok:
                melhor_ok, dmin_ok = i, d
        if oc or rio:
            testados += 1
            confere += melhor_ok is not None
        esc = melhor_ok if melhor_ok is not None else melhor
        if esc is not None:
            trecho[k] = esc
            dist[k] = geoms[esc].distance(p)
    return trecho, dist, confere, testados


def main() -> int:
    topo = sorted(S.glob("bho_topologia*.parquet"))
    if not topo:
        raise SystemExit("bho_topologia*.parquet ausente — rode baixa_topologia.py 1")
    props = pl.read_parquet(topo[0]).to_dicts()
    dados = json.loads((S / "rede_vazao.json").read_text())
    if dados["n"] != len(props):
        raise SystemExit(f"rede_vazao.json tem {dados['n']} trechos e a topologia {len(props)}")
    area_json = decodifica(dados["area"])
    if any(a != int(round(p["NUAREAMONT"])) for a, p in zip(area_json, props)):
        raise SystemExit("ordem dos trechos não bate entre rede_vazao.json e a topologia")
    print(f"topologia: {len(props)} trechos, ordem confere com rede_vazao.json")

    geoms = geometria_do_mapa(dados)
    cob = [str(p.get("COBACIA") or "") for p in props]
    tab = dados["nomes"]
    nomes_trecho = [normaliza(tab[k]) if 0 <= k < len(tab) else ""
                    for k in decodifica(dados["nome"])]
    comp = np.array(decodifica(dados["comp"]), dtype=float) / 10.0   # km
    pos = {p["COTRECHO"]: i for i, p in enumerate(props)}
    jus = np.array([pos.get(p["NUTRJUS"], -1) for p in props])
    area = np.array([p["NUAREAMONT"] for p in props])
    sobe = np.argsort(area)          # montante -> jusante
    desce = sobe[::-1]               # jusante -> montante

    df = pl.read_parquet(S / "barragens.parquet")
    print(f"barragens.parquet: {df.height} pontos "
          f"({df.filter(pl.col('origem') == 'snisb').height} SNISB, "
          f"{df.filter(pl.col('origem') == 'aneel').height} Aneel)")
    df = df.filter(~pl.col("fase").is_in(list(FORA)) | pl.col("fase").is_null())
    print(f"  sem as fases sem muro de pé ({', '.join(sorted(FORA))}): {df.height}")

    trecho, dist, confere, testados = casa(df, geoms, cob, nomes_trecho)
    df = df.with_columns(pl.Series("trecho", trecho), pl.Series("dist", dist))
    orfaos = int((trecho < 0).sum())
    print(f"  casadas a um trecho a menos de {TOL}°: {df.height - orfaos} · órfãs: {orfaos}")
    if testados:
        print(f"  conferem com o código do curso d'água ou o nome do rio: "
              f"{confere}/{testados} ({100 * confere / testados:.0f}%)")
    d = dist[trecho >= 0] * 111
    print("  distância ao trecho (km): mediana {:.2f}, p90 {:.2f}".format(
        np.median(d), np.percentile(d, 90)))

    # --- a mesma usina nas duas bases ---
    casadas = df.filter(pl.col("trecho") >= 0)
    sn = casadas.filter(pl.col("origem") == "snisb")
    hid = sn.filter(pl.col("uso") == "Hidroelétrica")
    arv_hid = STRtree([Point(x, y) for x, y in zip(hid["lon"], hid["lat"])]) if hid.height else None
    dup = []
    for r in casadas.filter(pl.col("origem") == "aneel").iter_rows(named=True):
        perto = arv_hid.query(Point(r["lon"], r["lat"]).buffer(TOL_DUP)) if arv_hid else []
        dup.append(len(perto) > 0)
    an = casadas.filter(pl.col("origem") == "aneel").with_columns(pl.Series("dup", dup))
    print(f"  hidrelétricas da Aneel já no SNISB (< {TOL_DUP}°): {sum(dup)} de {an.height}")
    pontos = pl.concat([sn, an.filter(~pl.col("dup")).drop("dup")], how="diagonal_relaxed")

    # --- corta a rede ---
    # Com TODAS as casadas, inclusive a usina da Aneel que é duplicata de uma do
    # SNISB: a duplicata sai só da camada de pontos. O ponto do SNISB de
    # Sobradinho cai num córrego seco ao lado do eixo, e o da Aneel no São
    # Francisco; descartando o segundo, o maior reservatório do Nordeste não
    # barrava o rio.
    barr = np.zeros(len(props), dtype=bool)
    barr[casadas["trecho"].to_numpy()] = True
    print(f"  trechos barrados: {int(barr.sum())}")

    frag = np.full(len(props), -1)
    nfrag = 0
    for i in desce:
        j = jus[i]
        if j >= 0 and not barr[i] and frag[j] >= 0:
            frag[i] = frag[j]
        else:
            frag[i] = nfrag
            nfrag += 1
    km_frag = np.bincount(frag, weights=comp, minlength=nfrag)
    livre = km_frag[frag]
    # Pedaço pequeno não quer dizer pedaço cortado: um rio costeiro do Nordeste
    # sem barragem nenhuma tem bacia inteira de poucos mil km e cairia na mesma
    # cor do rio retalhado. Cortado é o pedaço que encosta numa barragem -- o de
    # cima dela (que começa no trecho barrado) e o de baixo (onde ele deságua).
    cortado = np.zeros(nfrag, dtype=bool)
    for i in np.flatnonzero(barr):
        cortado[frag[i]] = True
        if jus[i] >= 0:
            cortado[frag[jus[i]]] = True

    bjus = np.full(len(props), -1.0)
    for i in desce:
        j = jus[i]
        if barr[i]:
            bjus[i] = 0.0
        elif j >= 0 and bjus[j] >= 0:
            bjus[i] = comp[j] + bjus[j]
    nmont = barr.astype(np.int64)
    for i in sobe:
        if jus[i] >= 0:
            nmont[jus[i]] += nmont[i]

    total = comp.sum()
    print(f"\nrede: {total:,.0f} km em {nfrag:,} pedaços")
    for lim in (10, 100, 1000, 10000):
        print(f"  km em pedaços com menos de {lim:>6,} km: {comp[livre < lim].sum() / total * 100:5.1f}%")
    sem = comp[bjus < 0].sum()
    print(f"  km sem nenhuma barragem rio abaixo até a foz: {sem / total * 100:.1f}%")
    maiores = np.argsort(km_frag)[::-1][:5]
    for f in maiores:
        i = int(np.argmax(np.where(frag == f, area, -1)))
        print(f"    pedaço de {km_frag[f]:>9,.0f} km — foz em {cob[i]}")

    corta = cortado[frag]
    print(f"  km em pedaços que encostam numa barragem: {comp[corta].sum() / total * 100:.1f}%")
    # `livre` não guarda o km de cada trecho -- guarda o número do PEDAÇO, em
    # ordem decrescente de tamanho, e `livreKm` é a tabela dele: km, com o sinal
    # no próprio número (positivo é pedaço cortado, negativo, −km − 1, é pedaço
    # que nenhuma barragem toca). Sem perda: 13,9 mil pedaços para 462 mil
    # trechos, e o gzip cai de 579 para ~500 kB.
    ordem = np.argsort(-km_frag, kind="stable")
    rank = np.empty(nfrag, dtype=np.int64)
    rank[ordem] = np.arange(nfrag)
    tab = [int(round(km_frag[f])) if cortado[f] else -int(round(km_frag[f])) - 1
           for f in ordem]
    dados["livre"] = codifica([int(v) for v in rank[frag]])
    dados["livreKm"] = codifica(tab)
    # A distância até a primeira barragem rio abaixo vai em degraus de BAR_PASSO
    # km (a ficha diz "a cerca de 35 km"): metade do tamanho do campo, e -1
    # continua querendo dizer "nenhuma até a foz".
    dados["barJusPasso"] = BAR_PASSO
    dados["barJus"] = codifica([int(round(v / BAR_PASSO)) if v >= 0 else -1 for v in bjus])
    dados["barMont"] = codifica([int(v) for v in nmont])
    caminho = S / "rede_vazao.json"
    caminho.write_text(json.dumps(dados, separators=(",", ":"), ensure_ascii=False))
    print(f"\n-> {caminho.name} ({caminho.stat().st_size / 1e6:.1f} MB)")

    # --- camada de pontos ---
    # Colunas, não objetos: são 30 mil pontos, e repetir as chaves dobrava o
    # tamanho. As categorias viram índice numa tabela, pelo mesmo motivo.
    def tabela(col):
        vals = sorted({v for v in pontos[col].to_list() if v})
        idx = {v: k for k, v in enumerate(vals)}
        return vals, [idx.get(v, -1) if v else -1 for v in pontos[col].to_list()]

    saida = {"n": pontos.height, "orfas": orfaos, "fora": sorted(FORA)}
    for col in ("uso", "fase", "risco", "dano", "tipo", "uf"):
        saida[col + "Tab"], saida[col] = tabela(col)
    saida["lon"] = [round(v, 4) for v in pontos["lon"]]
    saida["lat"] = [round(v, 4) for v in pontos["lat"]]
    saida["trecho"] = pontos["trecho"].to_list()
    saida["nome"] = [(v or "").strip() for v in pontos["nome"]]
    saida["mun"] = [(v or "").strip() for v in pontos["mun"]]
    saida["aneel"] = [int(v == "aneel") for v in pontos["origem"]]
    saida["alt"] = [None if v is None or v != v else round(v, 1) for v in pontos["altura_m"]]
    # O maior reservatório do país (Serra da Mesa) tem 54 mil hm³. Acima de
    # 100 mil o número foi digitado em m³: Santo Antônio, no Madeira, declara
    # 2,3 bilhões de "hm³" -- 2.306 hm³ depois de dividido, perto dos 2,1 mil
    # publicados.
    def cap(v):
        if v is None or v != v:
            return None
        return round(v / 1e6 if v > 1e5 else v, 2)
    saida["cap"] = [cap(v) for v in pontos["cap_hm3"]]
    saida["kw"] = [None if v is None or v != v else int(v) for v in pontos["pot_kw"]]
    destino = S / "barragens.json"
    destino.write_text(json.dumps(saida, ensure_ascii=False, separators=(",", ":")))
    print(f"-> {destino.name}: {pontos.height} pontos ({destino.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
