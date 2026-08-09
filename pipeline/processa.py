#!/usr/bin/env python3
"""Cruza a rede BHO com as vazões medidas da ANA e estima vazão por trecho.

Método:
  1. Para cada estação com série longa, Qmlt = média das médias mensais e
     Qesp = Qmlt / área de drenagem (L/s/km²).
  2. Para cada trecho, Qesp local = média geométrica ponderada por 1/d² das
     K_VIZINHOS estações mais próximas do seu ponto médio.
  3. Cada trecho gera Qesp_local × área própria (a área que entra nele e ainda
     não veio de outro trecho da rede) e esse valor desce pela topologia da
     BHO, somando trecho a trecho até a foz.
  4. Onde uma estação mede o próprio trecho, o total acumulado é substituído
     pelo valor medido, que passa a valer para todo o curso a jusante.

A qualidade sai da validação cruzada em 5 dobras: retira-se um quinto das
estações, reestima-se a rede inteira sem elas e compara-se nos trechos que elas
mediam.
"""
import json
import math
from pathlib import Path

import numpy as np
import polars as pl
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

S = Path(__file__).parent
MIN_MESES = 60
# Vazão específica plausível no Brasil: da caatinga (<1) ao litoral mais chuvoso
# (~60). Acima de 70 L/s/km² é erro de dado -- há estações cuja série devolve
# valores impossíveis para a própria área de drenagem (o Atibaia, com 1.930 km²,
# aparece com 12.814 m³/s). O corte tira esses postos da interpolação.
QESP_MIN, QESP_MAX = 0.05, 70.0  # L/s/km²
K_VIZINHOS = 8
# Precisão da geometria pela área de drenagem, não pela ordem de Strahler: a
# BHO não mapeia as cabeceiras fora do Brasil, então rios grandes de país
# vizinho (o Salado argentino, com 286 mil km²) aparecem como ordem 1 e levariam
# o tratamento de córrego. A área não tem esse problema.
TOL_POR_AREA = [(50000, 0.0002), (5000, 0.0003), (500, 0.0007), (50, 0.0015)]
TOL_GROSSO = 0.0032
AREA_FINA = 500  # km²: acima disso, grade de 11 m; abaixo, de 110 m


def tolerancia(area_km2):
    for limite, tol in TOL_POR_AREA:
        if area_km2 >= limite:
            return tol
    return TOL_GROSSO



# ---------------------------------------------------------------------------
# Codificação compacta
# Guardar 2,7 milhões de vértices como inteiros em JSON custa ~24 MB só de
# vírgulas e dígitos. Aqui cada número vira zigue-zague + varint em base64
# (5 bits de dado por caractere, o sexto marca continuação), no mesmo espírito
# do polyline do Google mas com um alfabeto que não precisa de escape em JSON.
ALFA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def codifica(valores):
    saida = []
    for v in valores:
        z = (v << 1) ^ (v >> 63) if v < 0 else v << 1
        while True:
            c = z & 31
            z >>= 5
            saida.append(ALFA[c | 32] if z else ALFA[c])
            if not z:
                break
    return "".join(saida)


def feicoes(caminho):
    """Percorre as feições de um GeoJSON sem carregar o arquivo inteiro."""
    dec = json.JSONDecoder()
    with open(caminho) as fh:
        buf = fh.read(1 << 20)
        i = buf.index('"features"')
        i = buf.index("[", i) + 1
        while True:
            while i < len(buf) and buf[i] in ", \n\r\t":
                i += 1
            if i < len(buf) and buf[i] == "]":
                return
            if i >= len(buf) - 2:
                pedaco = fh.read(1 << 20)
                if not pedaco:
                    return
                buf = buf[i:] + pedaco
                i = 0
                continue
            try:
                obj, fim = dec.raw_decode(buf, i)
            except ValueError:
                pedaco = fh.read(1 << 20)
                if not pedaco:
                    return
                buf = buf[i:] + pedaco
                i = 0
                continue
            yield obj
            i = fim


def carrega_estacoes():
    completo = S / "estacoes_completo.parquet"
    if completo.exists():
        # inventário fluviométrico inteiro (não só as telemétricas)
        est = pl.read_parquet(completo).filter(
            pl.col("TipoEstacaoDescLiquida") == "1"
        ).select(
            pl.col("Codigo"),
            pl.col("Nome"),
            pl.col("RioNome"),
            pl.col("nmEstado"),
            pl.col("nmMunicipio"),
            pl.col("Latitude").cast(pl.Float64, strict=False).alias("lat"),
            pl.col("Longitude").cast(pl.Float64, strict=False).alias("lon"),
            pl.col("AreaDrenagem").cast(pl.Float64, strict=False).alias("area_km2"),
            pl.col("Altitude").cast(pl.Float64, strict=False).alias("altitude"),
            pl.col("OperadoraSigla").alias("operadora"),
            pl.col("ResponsavelSigla").alias("responsavel"),
            pl.col("Operando").alias("operando"),
            pl.col("TipoEstacaoTelemetrica").alias("telemetrica"),
            pl.col("TipoEstacaoSedimentos").alias("sedimentos"),
            pl.col("TipoEstacaoQualAgua").alias("qualidade"),
        ).filter(pl.col("lat").is_not_null() & pl.col("lon").is_not_null())
    else:
        est = pl.read_csv(S / "estacoes_vazao.csv", infer_schema_length=5000).with_columns(
            # o CSV do DuckDB traz "NULL" literal e notação científica em alguns campos
            pl.col(c).cast(pl.Float64, strict=False) for c in ("lat", "lon", "area_km2")
        )
    serie = S / "vazao_mensal_completo.parquet"
    vaz = pl.read_parquet(serie if serie.exists() else S / "vazao_mensal.parquet")
    # Regime sazonal: a média de cada mês do calendário ao longo da série toda.
    # É o dado que mostra a estação seca e a cheia — estava sendo jogado fora,
    # já que só a média geral era usada.
    regime = (
        vaz.with_columns(pl.col("mes").str.slice(5, 2).cast(pl.Int8).alias("mes_ano"))
        .group_by("codigo", "mes_ano")
        .agg(pl.col("vazao_media").mean().alias("m"))
        .sort("codigo", "mes_ano")
        .group_by("codigo", maintain_order=True)
        .agg(pl.col("mes_ano"), pl.col("m"))
    )
    reg = {
        r["codigo"]: [
            round(v, 2) for _, v in sorted(zip(r["mes_ano"], r["m"]))
        ] if len(r["mes_ano"]) == 12 else None
        for r in regime.iter_rows(named=True)
    }

    agg = vaz.group_by("codigo").agg(
        pl.col("vazao_media").mean().alias("qmlt"),
        pl.col("vazao_media").min().alias("q_min_mensal"),
        pl.col("vazao_media").max().alias("q_max_mensal"),
        pl.len().alias("n_meses"),
        pl.col("mes").min().alias("mes_ini"),
        pl.col("mes").max().alias("mes_fim"),
    )
    est = est.with_columns(pl.col("Codigo").cast(pl.Utf8)).join(
        agg.with_columns(pl.col("codigo").cast(pl.Utf8)),
        left_on="Codigo",
        right_on="codigo",
        how="inner",
    )
    est = est.filter(
        (pl.col("n_meses") >= MIN_MESES)
        & (pl.col("area_km2") > 0)
        & (pl.col("qmlt") > 0)
    ).with_columns((pl.col("qmlt") * 1000 / pl.col("area_km2")).alias("qesp"))
    est = est.filter(pl.col("qesp").is_between(QESP_MIN, QESP_MAX))
    return est, reg


def main():
    print("carregando rede BHO...")
    arqs = sorted((S / "bho").glob("bho_strahler*.geojson"),
                  key=lambda f: int(f.stem.replace("bho_strahler", "")))
    if not arqs:
        raise SystemExit("nenhum arquivo da BHO em bho/")
    print(f"  usando {arqs[0].name} ({arqs[0].stat().st_size / 1e6:.0f} MB)")

    est, regime_mensal = carrega_estacoes()
    print(f"estações válidas para regionalização: {len(est)}")
    print(
        f"  Qesp (L/s/km²): p10={est['qesp'].quantile(0.1):.1f} "
        f"mediana={est['qesp'].median():.1f} p90={est['qesp'].quantile(0.9):.1f}"
    )

    # --- geometrias + ponto médio, lendo em fluxo ---
    # O GeoJSON da rede inteira tem quase 1 GB; carregar de uma vez viraria
    # vários GB de dicionários em memória. Aqui cada feição é decodificada,
    # convertida em LineString (que guarda a geometria no GEOS, não em listas
    # Python) e descartada em seguida.
    geoms, props, mids = [], [], []
    for f in feicoes(arqs[0]):
        coords = f["geometry"]["coordinates"]
        if f["geometry"]["type"] == "MultiLineString":
            coords = max(coords, key=len)
        if len(coords) < 2:
            continue
        ls = LineString(coords)
        geoms.append(ls)
        props.append(f["properties"])
        m = ls.interpolate(0.5, normalized=True)
        mids.append((m.x, m.y))
    mids = np.array(mids)
    print(f"  {len(geoms)} trechos com geometria válida")

    lon = est["lon"].to_numpy()
    lat = est["lat"].to_numpy()
    qesp = est["qesp"].to_numpy()
    area = np.array([p["NUAREAMONT"] for p in props])

    # --- topologia: trecho de jusante e área própria de cada trecho ---
    # Multiplicar a área de drenagem inteira pela vazão específica local
    # superestima os rios grandes: a foz costuma ficar perto de postos úmidos e
    # a bacia toda herda esse valor. Como o BHO traz o trecho de jusante
    # (NUTRJUS), dá para somar de verdade — cada trecho contribui só com a área
    # que entra nele, com a vazão específica do seu próprio lugar, e o total
    # desce pela rede.
    pos_cot = {p["COTRECHO"]: i for i, p in enumerate(props)}
    jus = np.array([pos_cot.get(p["NUTRJUS"], -1) for p in props])
    area_dos_filhos = np.zeros(len(props))
    for i, j in enumerate(jus):
        if j >= 0:
            area_dos_filhos[j] += area[i]
    # área própria: o que entra no trecho e ainda não veio de um trecho da rede
    # (inclui os afluentes de ordem menor, que não estão neste recorte)
    area_propria = np.maximum(area - area_dos_filhos, 0.0)
    ordem_topo = np.argsort(area)  # montante antes de jusante


    # --- dentro ou fora do Brasil ---
    # A BHO cobre as bacias inteiras, inclusive os trechos em território
    # vizinho (o Solimões vem do Peru, o Paraná sai para a Argentina). Eles
    # entram na conta -- a água que chega aqui vem de lá -- mas ficam marcados,
    # porque não há posto brasileiro medindo aquele lado.
    from shapely.geometry import shape
    from shapely.ops import unary_union

    import shapely

    br = unary_union([shape(r["gj"]) for r in json.loads((S / "uf.json").read_text())])
    dentro = shapely.contains_xy(br, mids[:, 0], mids[:, 1])
    print(f"trechos em território brasileiro: {dentro.sum()} de {len(dentro)}")

    # --- identidade do rio ---
    # Um trecho tem poucos quilômetros; o que o leitor chama de "rio" é a
    # sequência conectada que carrega o mesmo nome. Agrupar só pelo nome
    # acenderia todos os "Rio Bonito" do país, então a união exige as duas
    # coisas: mesmo nome E ligação pela topologia.
    nome_tr = [(p.get("NORIOCOMP") or "").strip() for p in props]
    pai = list(range(len(props)))

    def raiz(x):
        while pai[x] != x:
            pai[x] = pai[pai[x]]
            x = pai[x]
        return x

    for i, j in enumerate(jus):
        if j >= 0 and nome_tr[i] and nome_tr[i] == nome_tr[j]:
            ri, rj = raiz(i), raiz(j)
            if ri != rj:
                pai[ri] = rj
    compacto, rio_id = {}, []
    for i in range(len(props)):
        r = raiz(i)
        if r not in compacto:
            compacto[r] = len(compacto)
        rio_id.append(compacto[r])
    print(f"rios distintos (nome + conectividade): {len(compacto)}")

    # --- casa cada estação ao trecho que ela mede ---
    strtree = STRtree(geoms)
    q_obs = np.full(len(geoms), np.nan)
    est_trecho = {}
    casadas = 0
    for r in est.iter_rows(named=True):
        p = Point(r["lon"], r["lat"])
        cand = strtree.query(p.buffer(0.05))
        melhor, melhor_score = None, None
        for i in cand:
            i = int(i)
            d = geoms[i].distance(p)
            if d > 0.05:
                continue
            razao = abs(math.log((props[i]["NUAREAMONT"] or 1) / r["area_km2"]))
            if razao > 0.35:  # área a até ~1,4x de diferença
                continue
            score = razao + d * 10
            if melhor_score is None or score < melhor_score:
                melhor, melhor_score = i, score
        if melhor is not None:
            casadas += 1
            ant = est_trecho.get(melhor)
            if ant is None or melhor_score < ant[1]:
                est_trecho[melhor] = (r, melhor_score)
    for i, (r, _) in est_trecho.items():
        q_obs[i] = r["qmlt"]
    print(f"estações casadas a um trecho da rede: {casadas} ({len(est_trecho)} trechos)")

    medido = ~np.isnan(q_obs)

    # índice do trecho medido -> posição da estação, para ancorar a acumulação
    pos_est = {c: i for i, c in enumerate(est["Codigo"].to_list())}
    ancora = {tr: pos_est[r["Codigo"]] for tr, (r, _) in est_trecho.items()}

    def estima(sel):
        """Vazão acumulada em cada trecho usando só as estações de `sel`.

        Onde uma estação de `sel` mede o trecho, o total acumulado é substituído
        pelo valor medido — e a correção desce pela rede, porque o que passa na
        estação já inclui tudo que vem de montante.
        """
        tree = cKDTree(np.column_stack([lon[sel], lat[sel]]))
        k = min(K_VIZINHOS, int(sel.sum()))
        d, idx = tree.query(mids, k=k)
        d = np.maximum(np.atleast_2d(d.T).T, 1e-4)
        idx = np.atleast_2d(idx.T).T
        w = 1.0 / d**2
        # média geométrica ponderada: um posto com vazão específica muito fora
        # da vizinhança deixa de arrastar toda a região em volta
        viz = qesp[sel][idx]
        qesp_local = np.exp((w * np.log(viz)).sum(axis=1) / w.sum(axis=1))
        q = qesp_local * area_propria / 1000.0
        for i in ordem_topo:
            a = ancora.get(int(i))
            if a is not None and sel[a]:
                q[i] = q_obs[i]
            if jus[i] >= 0:
                q[jus[i]] += q[i]
        return q

    q_est = estima(np.ones(len(est), dtype=bool))
    q_final = q_est.copy()

    # --- validação cruzada em 5 dobras ---
    # Comparar a estimativa com a medida no próprio trecho da estação seria
    # circular: a estação está a distância ~0, domina o peso 1/d² e a estimativa
    # reproduz o valor medido. Aqui cada dobra de estações é retirada, a rede é
    # reestimada sem elas e a comparação é feita nos trechos que elas medem —
    # exatamente a situação de um trecho sem medição.
    dados_val = None
    if len(est_trecho) > 50:
        pos = {c: i for i, c in enumerate(est["Codigo"].to_list())}
        rng = np.random.default_rng(42)
        dobra = rng.integers(0, 5, len(est))
        prev, obs = [], []
        for f in range(5):
            sel = dobra != f
            q_f = estima(sel)
            for tr, (r, _) in est_trecho.items():
                if dobra[pos[r["Codigo"]]] == f:
                    prev.append(q_f[tr])
                    obs.append(r["qmlt"])
        prev, obs = np.array(prev), np.array(obs)
        ok = (prev > 0) & (obs > 0)
        razao = np.log10(prev[ok] / obs[ok])
        dados_val = {
            "n": int(ok.sum()),
            "dentro2x": round(float((np.abs(razao) < math.log10(2)).mean() * 100)),
            "dentro15x": round(float((np.abs(razao) < math.log10(1.5)).mean() * 100)),
            "vies": round(float(10 ** np.median(razao)), 2),
        }
        print(
            f"validação cruzada em {dados_val['n']} trechos medidos: "
            f"viés mediano ×{dados_val['vies']}, "
            f"{dados_val['dentro2x']}% dentro de 2× do observado, "
            f"{dados_val['dentro15x']}% dentro de 1,5×"
        )

    # --- saída compacta para o mapa ---
    # coordenadas quantizadas em 1e-4 grau (~11 m), guardadas como deltas
    # Duas grades: 1e-4 grau (~11 m) nos rios com bacia acima de 500 km², 1e-3
    # (~110 m) nos menores. Estes já saem simplificados a centenas de metros, então
    # a grade fina só produziria deltas maiores sem detalhe algum a mais — e são
    # 60% dos vértices. O decodificador escolhe a grade pela mesma regra.
    ESC, ESC_FINO = 1000, 10000
    geo, qs, ars, sts, nms, meds, fora, cmp_, rios = [], [], [], [], [], [], [], [], []
    vertices = 0
    nomes_idx, nomes_tab = {}, []
    for i, g in enumerate(geoms):
        gs = g.simplify(tolerancia(area[i]), preserve_topology=False)
        esc = ESC_FINO if area[i] >= AREA_FINA else ESC
        pts = []
        for x, y in gs.coords:
            xi, yi = round(x * esc), round(y * esc)
            if pts and pts[-1] == (xi, yi):
                continue
            pts.append((xi, yi))
        if len(pts) < 2:
            # Trecho menor que a célula da grade: em vez de descartar, vira um
            # segmento de uma célula na direção original. São 208 trechos em
            # 462 mil, todos com menos de 100 m — desenhá-los deslocados é mais
            # fiel do que sumir com eles.
            (x0, y0), (x1, y1) = gs.coords[0], gs.coords[-1]
            dx, dy = x1 - x0, y1 - y0
            passo = (1 if dx > 0 else -1 if dx < 0 else 0,
                     1 if dy > 0 else -1 if dy < 0 else 0)
            if passo == (0, 0):
                passo = (1, 0)
            pts = [pts[0], (pts[0][0] + passo[0], pts[0][1] + passo[1])]
        flat = [pts[0][0], pts[0][1]]
        for j in range(1, len(pts)):
            flat.append(pts[j][0] - pts[j - 1][0])
            flat.append(pts[j][1] - pts[j - 1][1])
        p = props[i]
        nome = (p.get("NORIOCOMP") or "").strip()
        if nome not in nomes_idx:
            nomes_idx[nome] = len(nomes_tab)
            nomes_tab.append(nome)
        k = len(geo)
        vertices += len(pts)
        geo.append(codifica(flat))
        qs.append(int(round(float(q_final[i]) * 100)))
        ars.append(int(round(p["NUAREAMONT"])))
        cmp_.append(int(round((p.get("NUCOMPTREC") or 0) * 10)))   # décimos de km
        rios.append(rio_id[i])
        sts.append(p["NUSTRAHLER"])
        nms.append(nomes_idx[nome])
        if medido[i]:
            meds.append(k)
        if not dentro[i]:
            fora.append(k)
    out = qs

    # listas de índices em delta, que é o que as torna pequenas
    def deltas(lista):
        ant, d = 0, []
        for v in lista:
            d.append(v - ant)
            ant = v
        return codifica(d)

    dados = {
        "periodo": [est["mes_ini"].min()[:4], est["mes_fim"].max()[:4]],
        "meses_total": int(est["n_meses"].sum()),
        "validacao": dados_val,
        "esc": ESC_FINO,
        "escGrosso": ESC,
        "areaFina": AREA_FINA,
        "uf": json.loads((S / "uf_linhas.json").read_text()),
        "terra": json.loads((S / "terra.json").read_text()),
        "n": len(geo),
        "geo": ".".join(geo),
        "q": codifica(qs),            # vazão × 100
        "area": codifica(ars),
        "comp": codifica(cmp_),   # comprimento em décimos de km
        "rio": codifica(rios),    # trechos do mesmo rio compartilham o id
        "strahler": "".join(str(s) for s in sts),
        "nome": codifica(nms),
        "nomes": nomes_tab,
        "medido": deltas(meds),       # índices dos trechos com estação
        "fora": deltas(fora),         # índices dos trechos fora do Brasil
        "estacoes": [
            {
                "cod": r["Codigo"],
                "nome": (r["Nome"] or "").strip(),
                "rio": (r["RioNome"] or "").strip(),
                "uf": r["nmEstado"],
                "lat": round(r["lat"], 4),
                "lon": round(r["lon"], 4),
                "area": r["area_km2"],
                "q": round(r["qmlt"], 2),
                "qmin": round(r["q_min_mensal"], 2),
                "qmax": round(r["q_max_mensal"], 2),
                "n": r["n_meses"],
                "ini": r["mes_ini"][:4],
                "fim": r["mes_fim"][:4],
                "mun": (r.get("nmMunicipio") or "").strip().title() or None,
                "alt": None if r.get("altitude") is None else round(r["altitude"]),
                "op": (r.get("operadora") or "").strip() or None,
                # o que mais essa estação mede além de vazão
                "mede": "".join(c for c, k in (("T", "telemetrica"), ("S", "sedimentos"),
                                               ("Q", "qualidade")) if r.get(k) == "1") or None,
                "ativa": 1 if r.get("operando") == "1" else 0,
                "regime": regime_mensal.get(r["Codigo"]),
            }
            for r in est.iter_rows(named=True)
        ],
    }
    path = S / "rede_vazao.json"
    path.write_text(json.dumps(dados, separators=(",", ":"), ensure_ascii=False))
    print(
        f"\n{len(geo)} trechos, {vertices:,} vértices, {len(dados['estacoes'])} estações "
        f"-> {path} ({path.stat().st_size / 1e6:.1f} MB)"
    )
    print(
        f"  geometria {len(dados['geo']) / 1e6:.1f} MB, atributos "
        f"{(len(dados['q']) + len(dados['area']) + len(dados['strahler']) + len(dados['nome'])) / 1e6:.1f} MB"
    )
    arr = np.array(out) / 100.0
    print(
        f"vazão estimada m³/s: mediana={np.median(arr):.1f} "
        f"p99={np.percentile(arr, 99):.0f} max={arr.max():.0f}"
    )


if __name__ == "__main__":
    main()
