#!/usr/bin/env python3
"""Faz a carga de efluente descer pela rede e vira fração da vazão de cada trecho.

O mapa já sabe quanta água passa em cada trecho. As outorgas de lançamento dizem
onde entra efluente. A razão entre as duas é o que a camada de poluição pinta:
**que fração deste rio, aqui, é efluente**.

A diluição sai de graça dessa conta. O mesmo lançamento pinta forte no córrego
onde cai e vai perdendo cor conforme o rio engorda a jusante — não há decaimento
nenhum embutido, só a água que chega de montante.

Sobre classificar esgoto e indústria: **a finalidade da outorga não serve**.
`tfn_ds` descreve o uso da água, não o efluente, e o resultado é que o esgoto de
Fortaleza inteiro aparece como "Outras" e o da Sabesp como "Consumo Humano".
Confiar nela perderia 1.778 pontos de esgoto e mais da metade do volume. Quem
separa aqui é o nome do responsável — regra minha, não da fonte, e por isso
declarada na página.
"""
import json
import re
import unicodedata
from pathlib import Path

import numpy as np
import polars as pl
from shapely.geometry import Point
from shapely.strtree import STRtree

from processa import ALFA, codifica

S = Path(__file__).parent

# Distância máxima entre o ponto outorgado e o trecho, em graus (~2 km). Acima
# disso o lançamento fica órfão: melhor não desenhar do que pendurar no rio errado.
TOL_SNAP = 0.02
# Água de passagem declarada como esgoto. Os três maiores "esgotos" do país são
# transferências entre represas do Alto Tietê, e um teto pelo que o município
# gera não resolve sozinho: a ETE de Barueri trata a região metropolitana
# inteira e lança 41 vezes o esgoto do próprio município, legitimamente.
#
# O que separa os dois casos é a captação. Barueri capta 0,04 m³/s e lança 16 —
# a água chega por esgoto. Mogi das Cruzes capta 34 e lança 67: é sistema
# produtor movendo água entre represas. Só cai quem falha nas duas coisas.
FOLGA_TETO = 3.0
RAZAO_PASSAGEM = 0.3
# Piso de esgoto coletado para cobrar outorga de um município, em m³/s. Abaixo
# disso é vilarejo, e a ausência de outorga não diz nada.
MIN_COLETA_COBRANCA = 0.05

# Operadores de saneamento: companhias estaduais, autarquias municipais e as
# concessionárias privadas. É o que separa esgoto de efluente industrial, já que
# a finalidade declarada não separa.
RE_OPERADOR = re.compile(
    r"(?i)("
    r"saneamento|sanea\w*|"
    r"\bagua\w*\s+e\s+esgoto|\besgoto\w*|\baguas?\s+de\s+|\baguas?\s+do\s+|"
    r"\bSAAE\b|\bSAMAE\b|\bSEMAE\b|\bDMAE\b|\bDAE\b|\bDEMAE\b|\bSAE\b|"
    r"\bSABESP\b|\bCOPASA\b|\bCEDAE\b|\bCAESB\b|\bSANEPAR\b|\bCORSAN\b|"
    r"\bEMBASA\b|\bCAERN\b|\bCAGEPA\b|\bCOMPESA\b|\bDESO\b|\bCASAL\b|"
    r"\bCAER\b|\bCAESA\b|\bCOSANPA\b|\bCAEMA\b|\bAGESPISA\b|\bCAGECE\b|"
    r"\bSANEAGO\b|\bCASAN\b|\bDEPASA\b|\bCAERD\b|\bSANEATINS\b|\bCESAN\b|"
    r"\bBRK\b|\bAEGEA\b|\bIGUA\b|ambiental"
    r")"
)
# Finalidades que são efluente industrial quando o responsável não é saneamento.
FIN_INDUSTRIA = {"Indústria", "Termoelétrica",
                 "Mineração - Extração de Areia/Cascalho em Leito de Rio",
                 "Mineração - Outros Processos Extrativos"}

IDX = {c: i for i, c in enumerate(ALFA)}


def decodifica(s):
    """Inverso de codifica(): zigue-zague + varint base64 -> lista de inteiros."""
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


def deltas(lista):
    ant, d = 0, []
    for v in lista:
        d.append(v - ant)
        ant = v
    return codifica(d)


def chave_mun(nome, uf):
    """Nome de município comparável entre a outorga e o Atlas (sem acento, caixa alta)."""
    n = unicodedata.normalize("NFKD", (nome or "").strip())
    n = "".join(c for c in n if not unicodedata.combining(c))
    return f"{n.upper()}|{(uf or '').strip().upper()}"


def carrega_lancamentos():
    """Lê as outorgas, converte a vazão e classifica cada ponto."""
    df = pl.read_parquet(S / "lancamentos.parquet")
    df = df.with_columns(
        # a fonte traz m³/h; o mapa trabalha em m³/s
        (pl.col("int_qt_vazaomedia").fill_null(0.0) / 3600.0).alias("m3s"),
        pl.col("emp_nm_responsavel").fill_null("").alias("resp"),
    )
    op = pl.col("resp").str.contains(RE_OPERADOR.pattern)
    esgoto = (pl.col("tfn_ds") == "Esgotamento Sanitário") | op
    df = df.with_columns(
        pl.when(esgoto).then(pl.lit("esgoto"))
        .when(pl.col("tfn_ds").is_in(FIN_INDUSTRIA)).then(pl.lit("industria"))
        .otherwise(pl.lit("outros")).alias("classe")
    )
    # lançamento em poço é injeção no subsolo, não entra em rio nenhum
    df = df.filter(pl.col("tch_ds") != "Poço")
    return df


def aplica_teto(df):
    """Descarta o que é água de passagem declarada como esgoto.

    Duas condições, as duas necessárias. A cidade precisa declarar muito mais
    esgoto do que o Atlas diz que ela gera **e** captar uma fatia grande do que
    lança. A primeira sozinha condenaria as ETEs regionais, que tratam o esgoto
    de vizinhos e por isso lançam bem mais do que o próprio município produz; a
    segunda é o que distingue tratar esgoto de mover água de um rio para outro.
    """
    caminho = S / "atlas_esgotos.csv"
    if not caminho.exists():
        print("  atlas_esgotos.csv ausente — teto de sanidade não aplicado")
        return df, []
    atlas = pl.read_csv(caminho)
    # o Atlas está em L/s
    teto = {chave_mun(r["nome_municipio"], r["sigla_uf"]): r["vazao_total"] / 1000.0
            for r in atlas.iter_rows(named=True)}

    capta = {}
    cap_path = S / "captacoes.parquet"
    if cap_path.exists():
        cap = pl.read_parquet(cap_path).with_columns(
            (pl.col("int_qt_vazaomedia").fill_null(0.0) / 3600.0).alias("m3s"))
        for r in cap.group_by("ing_nm_municipio", "ing_sg_ufmunicipio").agg(
                pl.col("m3s").sum()).iter_rows(named=True):
            capta[chave_mun(r["ing_nm_municipio"], r["ing_sg_ufmunicipio"])] = r["m3s"]
    else:
        print("  captacoes.parquet ausente — água de passagem não detectada")

    ch = [chave_mun(n, u) for n, u in zip(df["ing_nm_municipio"], df["ing_sg_ufmunicipio"])]
    df = df.with_columns(pl.Series("chave", ch))
    soma = (df.filter(pl.col("classe") == "esgoto")
            .group_by("chave").agg(pl.col("m3s").sum().alias("somam3s")))

    suspeitos = set()
    for r in soma.iter_rows(named=True):
        t = teto.get(r["chave"])
        if t is None or r["somam3s"] <= max(t * FOLGA_TETO, 0.05):
            continue
        if capta.get(r["chave"], 0.0) >= RAZAO_PASSAGEM * r["somam3s"]:
            suspeitos.add(r["chave"])

    rebaixados = []
    if suspeitos:
        alvo = (pl.col("classe") == "esgoto") & pl.col("chave").is_in(list(suspeitos))
        rebaixados = (df.filter(alvo)
                      .select("emp_nm_empreendimento", "ing_nm_municipio",
                              "ing_sg_ufmunicipio", "m3s")
                      .sort("m3s", descending=True).head(10).rows())
        df = df.with_columns(
            pl.when(alvo).then(pl.lit("outros")).otherwise(pl.col("classe")).alias("classe"))
    return df, rebaixados


def calcula(geoms, props, jus, ordem_topo, q):
    """Fração de efluente em cada trecho, já acumulada a jusante.

    Devolve o bloco pronto para entrar no JSON do mapa.
    """
    df = carrega_lancamentos()
    print(f"lançamentos vigentes em corpo d'água: {df.height}")
    df, rebaixados = aplica_teto(df)
    print("  " + " · ".join(
        f"{c}: {n}" for c, n in df["classe"].value_counts(sort=True).rows()))
    if rebaixados:
        print(f"  rebaixados pelo teto do Atlas ({len(rebaixados)} maiores):")
        for nome, mun, uf, v in rebaixados[:4]:
            print(f"    {v:7.2f} m³/s  {(nome or '')[:38]:38} {mun}/{uf}")

    sem_vazao = int((df["m3s"] <= 0).sum())
    print(f"  sem vazão declarada (entram como presença, não somam): {sem_vazao}")

    # --- casa cada ponto ao trecho mais próximo ---
    arvore = STRtree(geoms)
    cob = [str(p.get("COBACIA") or "") for p in props]
    carga = {"esgoto": np.zeros(len(geoms)), "industria": np.zeros(len(geoms)),
             "outros": np.zeros(len(geoms))}
    casados = orfaos = confere = testados = 0
    trecho_de = []
    for r in df.iter_rows(named=True):
        lat, lon = r["int_nu_latitude"], r["int_nu_longitude"]
        if lat is None or lon is None or (lat == 0 and lon == 0):
            orfaos += 1
            trecho_de.append(-1)
            continue
        p = Point(lon, lat)
        oc = (r["ing_cd_ottobacia_trecho"] or "").strip()
        # Distância sozinha erra em cidade: no ABC paulista há meia dúzia de
        # córregos dentro de 2 km, e o lançamento cai no vizinho. Quando o
        # código de ottobacia da própria outorga aponta um dos candidatos, ele
        # decide; onde não aponta (a maioria — boa parte dos códigos não existe
        # nesta versão da BHO), vale o mais próximo.
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
            trecho_de.append(-1)
            continue
        casados += 1
        trecho_de.append(escolhido)
        carga[r["classe"]][escolhido] += max(r["m3s"], 0.0)
    print(f"  casados a um trecho: {casados} · órfãos: {orfaos}")
    if testados:
        print(f"  confere com o código de ottobacia da fonte: "
              f"{confere}/{testados} ({100 * confere / testados:.0f}%)")

    # --- desce pela rede ---
    # mesma travessia de estima(): ordem_topo vai de montante para jusante, então
    # somar em jus[i] depois de fechar i propaga o total até a foz
    acum = {}
    for classe, base in carga.items():
        a = base.copy()
        for i in ordem_topo:
            j = jus[i]
            if j >= 0:
                a[j] += a[i]
        acum[classe] = a

    qs = np.maximum(np.asarray(q, dtype=float), 1e-6)
    saida = {}
    for classe, chave in (("esgoto", "esg"), ("industria", "ind")):
        frac = np.clip(acum[classe] / qs, 0.0, 1.0)
        saida[chave] = codifica([int(round(v * 10000)) for v in frac])
        vis = frac[frac > 0.001]
        print(f"  {classe}: {len(vis)} trechos acima de 0,1% de efluente · "
              f"mediana {100 * np.median(vis) if len(vis) else 0:.1f}% · "
              f"acima de 50%: {int((frac > 0.5).sum())}")

    saida["semDado"] = deltas(cobertura(df, geoms, arvore))
    return saida


def cobertura(df, geoms, arvore):
    """Trechos das cidades que coletam esgoto e não têm outorga de lançamento.

    As outorgas cobrem menos da metade do esgoto coletado do país. Sem esta
    camada, o rio de Belo Horizonte ou de Recife apareceria limpo no mapa — e
    ausência de registro viraria atestado de limpeza.
    """
    caminho = S / "atlas_esgotos.csv"
    if not caminho.exists():
        return []
    atlas = pl.read_csv(caminho)
    com_outorga = {
        chave_mun(n, u) for n, u, c in zip(
            df["ing_nm_municipio"], df["ing_sg_ufmunicipio"], df["classe"]) if c == "esgoto"
    }
    idx = set()
    faltam = 0
    for r in atlas.iter_rows(named=True):
        if (r["vazao_coletada"] or 0) / 1000.0 < MIN_COLETA_COBRANCA:
            continue
        if chave_mun(r["nome_municipio"], r["sigla_uf"]) in com_outorga:
            continue
        faltam += 1
        p = Point(r["lon"], r["lat"])
        melhor, dmin = None, 0.15
        for i in arvore.query(p.buffer(0.15)):
            i = int(i)
            d = geoms[i].distance(p)
            if d < dmin:
                melhor, dmin = i, d
        if melhor is not None:
            idx.add(melhor)
    print(f"  cobertura: {faltam} municípios coletam esgoto sem outorga de lançamento "
          f"-> {len(idx)} trechos marcados")
    return sorted(idx)


def geometria_do_mapa(dados):
    """Reconstrói as linhas a partir do que já está embutido no rede_vazao.json.

    Evita rebaixar 1 GB de geometria da ANA só para casar 10 mil pontos: o mapa
    guarda a rede inteira em deltas quantizados, e a grade mais grossa é de
    ~110 m — bem abaixo da precisão com que a outorga informa onde fica o cano.
    """
    from shapely.geometry import LineString
    esc_fino, esc_grosso = dados["esc"], dados["escGrosso"]
    area_fina = dados["areaFina"]
    areas = decodifica(dados["area"])
    geoms = []
    for i, pedaco in enumerate(dados["geo"].split(".")):
        nums = decodifica(pedaco)
        esc = esc_fino if areas[i] >= area_fina else esc_grosso
        pts, x, y = [], nums[0], nums[1]
        pts.append((x / esc, y / esc))
        for j in range(2, len(nums) - 1, 2):
            x += nums[j]
            y += nums[j + 1]
            pts.append((x / esc, y / esc))
        geoms.append(LineString(pts) if len(pts) > 1 else LineString([pts[0], pts[0]]))
    return geoms


def main():
    """Modo avulso: recalcula a poluição sobre um rede_vazao.json já pronto."""
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


if __name__ == "__main__":
    main()
