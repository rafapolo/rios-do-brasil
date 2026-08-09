#!/usr/bin/env python3
"""Tendência de longo prazo da vazão de cada estação fluviométrica da ANA.

Responde à pergunta que o mapa não responde: os rios estão secando?

O mapa mostra a vazão *média* de cada trecho. Média não tem direção — uma
estação com 40 anos de série e outra com 40 anos de queda contínua aparecem
iguais se a média bater. Aqui a série anual inteira entra num teste de
tendência.

Fonte: `br_ana_telemetria/series_vazao_mensal` no beelink, o ETL do zip
histórico da ANA (`rodado/scripts/scrap/ana_series_historicas.py`) — 3.954
estações, 1901 a 2023-09. É bem mais fundo que o `baixa_vazao.py` deste mesmo
pipeline, que só pega 1995-2025 pelo SOAP.

Método:
  * Média anual por estação, exigindo >= 10 meses medidos no ano. Ano
    incompleto em rio sazonal não é ruído, é viés: se faltam justo os meses de
    cheia, a média do ano despenca por ausência, não por seca.
  * Mann-Kendall para o *se* existe tendência (não-paramétrico: não assume
    normalidade nem linearidade, e vazão não é normal — é log-normal com cauda
    pesada).
  * Sen's slope para o *quanto* (mediana das inclinações par a par, imune aos
    outliers que uma regressão linear engoliria: um ano de El Nino move OLS,
    não move a mediana).
  * Benjamini-Hochberg no fim. Testar ~mil estações a p<0,05 gera dezenas de
    "tendências" que são só sorteio. Sem essa correção o ranking é ruído bem
    desenhado.

Normalização: a inclinação vai para %/década da própria média da estação. Em
m³/s absoluto o ranking seria só os rios grandes — o Amazonas perde mais água
num ano ruim do que o Tietê inteiro carrega, e nenhum rio pequeno apareceria.

Saída: pipeline/tendencia.json

Uso:
    python3 pipeline/analisa_tendencia.py
"""
import json
import math
import re
import subprocess
from pathlib import Path

import numpy as np

S = Path(__file__).parent
SERIES = "~/rodado/br_ana_telemetria/series_vazao_mensal/**/*.parquet"
INVENTARIO = "~/rodado/br_ana_telemetria/estacoes_inventario_2023/*.parquet"

MESES_MIN = 10      # meses medidos para o ano valer
# Piso de 20 anos por causa de tasks/ana_series_historicas.md no rodado, que é
# onde esta análise foi encomendada. A página filtra por 30/40/50 em cima disso
# — melhor exportar largo e apertar na interface do que cortar aqui e não poder
# afrouxar sem reprocessar.
ANOS_MIN = 20
ANO_CORTE = 2015    # estação que morreu antes disso não fala do presente
ALFA = 0.05

# Critérios do ranking padrão da página (mais apertados que os da exportação:
# tudo continua no JSON com as flags, a página é que filtra).
ANOS_RANKING = 30

# Estação em barragem, açude ou canal mede operação, não rio. A série muda de
# patamar no dia em que a obra fecha, e o teste de tendência lê isso como
# tendência — a maior "alta" do país era o Uruguai no barramento da UHE Itá,
# +70%/década, que é a data de enchimento do reservatório e mais nada.
RE_OBRA = re.compile(
    r"\b(UHE|PCH|AÇUDE|ACUDE|BARRAG\w*|BARRAM\w*|MONTANTE|JUSANTE|"
    r"RESERVAT\w*|USINA|VERTEDOR\w*|CANAL|ECLUSA|COMPORTA)\b",
    re.IGNORECASE,
)

SQL_ANUAL = f"""SET enable_progress_bar=false;
SELECT codigo,
       year(data) AS ano,
       round(avg(media), 4) AS q
FROM read_parquet('{SERIES}')
WHERE media IS NOT NULL AND media >= 0
GROUP BY 1, 2
HAVING count(*) >= {MESES_MIN}
ORDER BY 1, 2;"""

SQL_INVENTARIO = f"""SET enable_progress_bar=false;
SELECT Codigo AS codigo, Nome AS nome, RioNome AS rio, EstadoSigla AS uf,
       MunicipioNome AS mun, BaciaNome AS bacia, SubBaciaNome AS subbacia,
       AreaDrenagem AS area, Latitude AS lat, Longitude AS lon,
       OperadoraNome AS operadora
FROM read_parquet('{INVENTARIO}');"""
# Sem filtro por tipo de propósito. Este inventário marca descarga líquida como
# 'SIM'/'NÃO' (o do SOAP usa '1'/'0'), e a flag envelhece: quem decide se a
# estação mede vazão é existir série de vazão, o que o join já garante.


def consulta(sql: str) -> list[dict]:
    """Roda SQL no duckdb do beelink. Mesmo transporte de baixa_reservatorios.py."""
    out = subprocess.run(
        ["ssh", "beelink", "~/bin/duckdb -json"],
        input=sql, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout[out.stdout.index("["):])


def mann_kendall(y: np.ndarray) -> tuple[float, float]:
    """Estatística S de Mann-Kendall -> p bicaudal, com correção de empates.

    S conta quantos pares posteriores são maiores menos quantos são menores.
    A aproximação normal vale bem acima de n~10; aqui n >= 30 sempre.
    """
    n = len(y)
    s = sum(np.sign(y[k + 1:] - y[k]).sum() for k in range(n - 1))

    # Empates reduzem a variância de S. Vazão medida em 3 casas quase não
    # empata, mas anos de rio seco empatam todos em zero — sem esta correção
    # justamente as estações mais secas ganhariam p-valor otimista demais.
    _, contagens = np.unique(y, return_counts=True)
    empates = (contagens * (contagens - 1) * (2 * contagens + 5)).sum()
    var = (n * (n - 1) * (2 * n + 5) - empates) / 18.0
    if var <= 0:
        return 0.0, 1.0

    # Correção de continuidade: S é discreto, a normal é contínua.
    z = (s - np.sign(s)) / math.sqrt(var) if s != 0 else 0.0
    return float(z), math.erfc(abs(z) / math.sqrt(2))


def sen_slope(x: np.ndarray, y: np.ndarray) -> float:
    """Mediana das inclinações de todos os pares. Aguenta anos faltando."""
    dy = np.subtract.outer(y, y)
    dx = np.subtract.outer(x, x)
    sup = np.triu_indices(len(x), k=1)
    return float(np.median(dy[sup] / dx[sup]))


def benjamini_hochberg(p: np.ndarray) -> np.ndarray:
    """p-valores -> q-valores (FDR). Devolve na ordem original."""
    n = len(p)
    ordem = np.argsort(p)
    escalado = p[ordem] * n / np.arange(1, n + 1)
    # q monotônico: varre de trás para frente acumulando o mínimo.
    q = np.minimum.accumulate(escalado[::-1])[::-1]
    saida = np.empty(n)
    saida[ordem] = np.clip(q, 0, 1)
    return saida


def main() -> int:
    print("puxando médias anuais do beelink...")
    anuais = consulta(SQL_ANUAL)
    print(f"  {len(anuais):,} pares estação-ano com >= {MESES_MIN} meses")

    print("puxando inventário...")
    meta = {r["codigo"]: r for r in consulta(SQL_INVENTARIO)}
    print(f"  {len(meta):,} estações fluviométricas no inventário")

    series: dict[str, list[tuple[int, float]]] = {}
    for r in anuais:
        if r["q"] is not None:
            series.setdefault(r["codigo"], []).append((r["ano"], r["q"]))

    resultados = []
    descartes = {"curta": 0, "morta": 0, "sem_meta": 0, "qmlt_zero": 0}
    for cod, pontos in series.items():
        pontos.sort()
        anos = np.array([a for a, _ in pontos], dtype=float)
        q = np.array([v for _, v in pontos], dtype=float)

        if len(anos) < ANOS_MIN:
            descartes["curta"] += 1
            continue
        if anos[-1] < ANO_CORTE:
            descartes["morta"] += 1
            continue
        m = meta.get(cod)
        if not m:
            descartes["sem_meta"] += 1
            continue
        qmlt = float(q.mean())
        if qmlt <= 0:
            descartes["qmlt_zero"] += 1
            continue

        z, p = mann_kendall(q)
        sen = sen_slope(anos, q)
        nome = (m["nome"] or "").strip()
        resultados.append({
            "cod": cod,
            "nome": nome,
            "obra": bool(RE_OBRA.search(nome)),
            "rio": (m["rio"] or "").strip(),
            "uf": m["uf"],
            "mun": (m["mun"] or "").strip(),
            "bacia": (m["bacia"] or "").strip(),
            "lat": m["lat"], "lon": m["lon"],
            "area": m["area"],
            "qmlt": round(qmlt, 3),
            "n": len(anos),
            "ini": int(anos[0]), "fim": int(anos[-1]),
            "sen": round(sen, 5),                            # m³/s por ano
            "pct": round(sen * 10 / qmlt * 100, 2),           # %/década
            "z": round(z, 3),
            "p": round(p, 6),
            "serie": [[int(a), round(v, 2)] for a, v in pontos],
        })

    if not resultados:
        print("nenhuma estação elegível — abortando")
        return 1

    q_fdr = benjamini_hochberg(np.array([r["p"] for r in resultados]))
    for r, qv in zip(resultados, q_fdr):
        r["q"] = round(float(qv), 6)
        r["sig"] = bool(qv < ALFA)

    resultados.sort(key=lambda r: r["pct"])
    for r in resultados:
        r["rank"] = bool(r["sig"] and not r["obra"] and r["n"] >= ANOS_RANKING)

    ranking = [r for r in resultados if r["rank"]]
    caindo = [r for r in ranking if r["pct"] < 0]
    subindo = [r for r in ranking if r["pct"] > 0]

    print(f"\nelegíveis: {len(resultados):,} estações "
          f"(>= {ANOS_MIN} anos, último ano >= {ANO_CORTE})")
    print(f"  descartadas na entrada: {descartes}")
    print(f"  brutas com p < {ALFA}: {sum(1 for r in resultados if r['p'] < ALFA):,}")
    print(f"  sobreviventes ao FDR:   {sum(1 for r in resultados if r['sig']):,}")
    print(f"  em estrutura hidráulica: {sum(1 for r in resultados if r['obra']):,} (fora do ranking)")
    print(f"  com < {ANOS_RANKING} anos: {sum(1 for r in resultados if r['n'] < ANOS_RANKING):,} (fora do ranking)")
    print(f"\nRANKING (>= {ANOS_RANKING} anos, sem obra, significativo): {len(ranking):,} estações"
          f" — {len(caindo):,} caindo, {len(subindo):,} subindo")

    linha = lambda r: (f"  {r['pct']:+7.1f}%/déc  {r['rio'][:24]:<24} {r['nome'][:20]:<20} "
                       f"{r['uf']}  {r['n']}a  {r['area'] or 0:>7.0f} km²  q={r['q']:.4f}")
    print("\n-- as 10 que mais caem --")
    for r in caindo[:10]:
        print(linha(r))
    print("-- as 10 que mais sobem --")
    for r in subindo[-10:][::-1]:
        print(linha(r))

    destino = S / "tendencia.json"
    destino.write_text(json.dumps({
        "criterios": {
            "meses_min": MESES_MIN, "anos_min": ANOS_MIN,
            "anos_ranking": ANOS_RANKING,
            "ano_corte": ANO_CORTE, "alfa": ALFA,
            "fonte": "ANA, séries históricas convencionais (1901-2023)",
        },
        "resumo": {
            "elegiveis": len(resultados),
            "ranking": len(ranking),
            "caindo": len(caindo), "subindo": len(subindo),
            "obra": sum(1 for r in resultados if r["obra"]),
            "curtas": sum(1 for r in resultados if r["n"] < ANOS_RANKING),
        },
        "estacoes": resultados,
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"\nescrito {destino} ({destino.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
