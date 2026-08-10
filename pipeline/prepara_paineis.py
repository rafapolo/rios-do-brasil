#!/usr/bin/env python3
"""Os painéis da página de séries históricas, além do ranking de tendência.

`analisa_tendencia.py` responde "quais rios estão secando". Aqui saem os outros
recortes, cada um respondendo uma pergunta que o mapa de vazão média não alcança:

  seco     — quantos rios pararam de correr, e desde quando?
             Dias/ano com régua seca, rio cortado ou rio seco. Só existe na
             série diária: a média mensal de um rio que secou 20 dias e voltou
             não é zero, é baixa, e some no meio das outras baixas.
  cheia    — a estação das cheias mudou de data?
             Mês do pico em duas janelas de 30 anos, por média circular (a
             média aritmética de dez, jan e fev daria julho).
  q710     — o limite legal de retirada de água ainda bate com o rio real?
             A Q7,10 rege outorga no Brasil. Calculada em duas janelas.
  rede     — estamos medindo nossos rios menos do que nos anos 1990?
             Estações reportando por ano. É meta-dado, mas é a barra de erro
             honesta de todo o resto da página.

Saída: pipeline/paineis.json

Uso:
    python3 pipeline/prepara_paineis.py
"""
import json
import math
import subprocess
from collections import defaultdict
from pathlib import Path

S = Path(__file__).parent
# Duas janelas diferentes de propósito, e a diferença precisa aparecer na página:
# o mensal é zip + SOAP e vai a 2026-05; o diário é só o zip e para em 2023-09,
# porque `HidroSerieHistorica` devolve agregado mensal, não leitura por dia.
# Painel que usa o diário (rio seco, Q7,10) não pode afirmar nada sobre 2024+.
MENSAL = "~/rodado/br_ana_telemetria/series_vazao_mensal_completa/**/*.parquet"
DIARIA = "~/rodado/br_ana_telemetria/series_vazao_diaria/**/*.parquet"
FIM_DIARIO = 2022   # último ano completo da série diária (o zip para em set/2023)
INVENTARIO = "~/rodado/br_ana_telemetria/estacoes_inventario_2023/*.parquet"

# Duas janelas de 30 anos (norma climatológica da OMM), com o intervalo
# 1991-1993 vazio de propósito: janelas coladas fazem o leitor comparar o fim de
# uma com o começo da outra, que é ruído de um ano só.
ANTES = (1961, 1990)
DEPOIS = (1994, 2023)
MIN_ANOS_JANELA = 15  # anos válidos em CADA janela para a estação ser comparável


def consulta(sql: str) -> list[dict]:
    out = subprocess.run(
        ["ssh", "beelink", "~/bin/duckdb -json"],
        input="SET enable_progress_bar=false;\n" + sql,
        capture_output=True, text=True, check=True,
    )
    corte = out.stdout.find("[")
    return json.loads(out.stdout[corte:]) if corte >= 0 else []


def painel_seco() -> dict:
    """Dias de rio seco por estação-ano.

    Traz TODOS os anos das estações que secaram alguma vez, não só os anos secos
    — sem o denominador não dá para distinguir "não secou" de "não mediu", e
    essa diferença é a diferença entre um rio saudável e uma estação desativada.
    """
    linhas = consulta(f"""
        WITH secas AS (
            SELECT DISTINCT codigo FROM read_parquet('{DIARIA}')
             WHERE status IN (4, 5, 6)
        )
        SELECT d.codigo, year(d.data) AS ano,
               count(*) AS medidos,
               count(*) FILTER (WHERE d.status IN (4, 5, 6)) AS secos
          FROM read_parquet('{DIARIA}') d
          JOIN secas USING (codigo)
         GROUP BY 1, 2
        HAVING count(*) >= 300
         ORDER BY 1, 2;""")

    por_est = defaultdict(list)
    for r in linhas:
        por_est[r["codigo"]].append([r["ano"], r["secos"], r["medidos"]])

    total_ano = defaultdict(int)
    est_ano = defaultdict(set)
    for cod, anos in por_est.items():
        for ano, secos, _ in anos:
            if secos > 0:
                total_ano[ano] += secos
                est_ano[ano].add(cod)

    return {
        "estacoes": por_est,
        "por_ano": sorted(
            [[a, total_ano[a], len(est_ano[a])] for a in total_ano]
        ),
    }


def _media_circular(pesos: list[float]) -> float:
    """Mês médio de um ciclo de 12. Devolve 1..13 (fracionário)."""
    total = sum(pesos)
    if total <= 0:
        return float("nan")
    ang = [2 * math.pi * i / 12 for i in range(12)]
    x = sum(p * math.cos(a) for p, a in zip(pesos, ang))
    y = sum(p * math.sin(a) for p, a in zip(pesos, ang))
    if x == 0 and y == 0:
        return float("nan")
    m = math.atan2(y, x) / (2 * math.pi) * 12
    return (m % 12) + 1


def painel_cheia() -> list[dict]:
    linhas = consulta(f"""
        SELECT codigo,
               CASE WHEN year(data) BETWEEN {ANTES[0]} AND {ANTES[1]} THEN 'antes'
                    WHEN year(data) BETWEEN {DEPOIS[0]} AND {DEPOIS[1]} THEN 'depois'
               END AS janela,
               month(data) AS mes,
               avg(media) AS q,
               count(DISTINCT year(data)) AS anos
          FROM read_parquet('{MENSAL}')
         WHERE media IS NOT NULL
           AND year(data) BETWEEN {ANTES[0]} AND {DEPOIS[1]}
         GROUP BY 1, 2, 3
        HAVING janela IS NOT NULL
         ORDER BY 1, 2, 3;""")

    regimes: dict[str, dict[str, dict[int, float]]] = defaultdict(lambda: defaultdict(dict))
    anos_min: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(lambda: 999))
    for r in linhas:
        regimes[r["codigo"]][r["janela"]][r["mes"]] = r["q"] or 0.0
        anos_min[r["codigo"]][r["janela"]] = min(anos_min[r["codigo"]][r["janela"]], r["anos"])

    saida = []
    for cod, janelas in regimes.items():
        if set(janelas) != {"antes", "depois"}:
            continue
        if any(len(janelas[j]) != 12 for j in ("antes", "depois")):
            continue  # regime incompleto não tem mês de pico confiável
        if any(anos_min[cod][j] < MIN_ANOS_JANELA for j in ("antes", "depois")):
            continue
        a = [janelas["antes"][m] for m in range(1, 13)]
        d = [janelas["depois"][m] for m in range(1, 13)]
        pa, pd = _media_circular(a), _media_circular(d)
        if math.isnan(pa) or math.isnan(pd):
            continue
        desloc = (pd - pa + 6) % 12 - 6  # menor deslocamento com sinal, em meses
        saida.append({
            "cod": cod,
            "antes": [round(v, 2) for v in a],
            "depois": [round(v, 2) for v in d],
            "pico_antes": round(pa, 2),
            "pico_depois": round(pd, 2),
            "desloc": round(desloc, 2),
        })
    return saida


def painel_q710() -> list[dict]:
    """Q7 mínima anual em duas janelas.

    Aproximação assumida: a Q7,10 vira o percentil 10 das mínimas anuais de 7
    dias dentro da janela, em vez de ajustar uma distribuição de valores
    extremos. Com 30 anos por janela o percentil empírico é estável e não
    depende de escolher entre Weibull, Gumbel e log-Pearson III — que é uma
    discussão de hidrologia que mudaria o número em poucos por cento e não muda
    a direção, que é o que a página afirma.

    A média móvel usa 7 LINHAS, não 7 dias de calendário: onde faltam dias a
    janela estica. Por isso o filtro de 330 dias medidos no ano.
    """
    linhas = consulta(f"""
        WITH d AS (
            SELECT codigo, data, valor,
                   avg(valor) OVER (PARTITION BY codigo ORDER BY data
                                    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS q7,
                   count(*) OVER (PARTITION BY codigo, year(data)) AS dias_ano
              FROM read_parquet('{DIARIA}')
        ),
        anual AS (
            SELECT codigo, year(data) AS ano, min(q7) AS q7min
              FROM d WHERE dias_ano >= 330
             GROUP BY 1, 2
        )
        SELECT codigo,
               CASE WHEN ano BETWEEN {ANTES[0]} AND {ANTES[1]} THEN 'antes'
                    WHEN ano BETWEEN {DEPOIS[0]} AND {DEPOIS[1]} THEN 'depois'
               END AS janela,
               count(*) AS anos,
               quantile_cont(q7min, 0.10) AS q710,
               median(q7min) AS q7med
          FROM anual
         GROUP BY 1, 2
        HAVING janela IS NOT NULL AND count(*) >= {MIN_ANOS_JANELA}
         ORDER BY 1;""")

    por_est: dict[str, dict] = defaultdict(dict)
    for r in linhas:
        por_est[r["codigo"]][r["janela"]] = r

    saida = []
    for cod, j in por_est.items():
        if set(j) != {"antes", "depois"}:
            continue
        a, d = j["antes"]["q710"], j["depois"]["q710"]
        if a is None or d is None:
            continue
        saida.append({
            "cod": cod,
            "antes": round(a, 4), "depois": round(d, 4),
            "med_antes": round(j["antes"]["q7med"] or 0, 4),
            "med_depois": round(j["depois"]["q7med"] or 0, 4),
            "anos_antes": j["antes"]["anos"], "anos_depois": j["depois"]["anos"],
            # Variação relativa. Rio que zerou a Q7,10 marca -100%.
            "var": round((d - a) / a * 100, 1) if a > 0 else None,
            "zerou": bool(a > 0 and d == 0),
        })
    return saida


def painel_rede() -> dict:
    """Tamanho da rede por ano, em duas leituras que contam histórias diferentes.

    A contagem de estações reportando cai de 2.085 (2014) para 1.405 (2022).
    Parte disso é defasagem: o arquivo é um retrato de ago/2023 e a ANA publica
    com atraso, então os últimos anos ainda estavam enchendo quando a foto foi
    tirada. Apresentar essa cauda como "estações fechando" seria vender artefato
    como notícia, e 2023 nem ano inteiro é (o dado para em setembro).

    A segunda leitura não tem esse problema, porque não é sobre quantas estações
    existem e sim sobre o que foi feito com o dado delas: a consistência
    desabou de 1.939 estações em 2014 para 707 em 2015, e para UMA em 2022. Dado
    bruto continua entrando; ninguém mais o está conferindo. Essa é a barra de
    erro de toda esta página — as tendências recentes se apoiam em série que a
    própria ANA ainda não validou.
    """
    linhas = consulta(f"""
        SELECT year(m.data) AS ano,
               coalesce(nullif(trim(i.BaciaNome), ''), 'sem bacia') AS bacia,
               count(DISTINCT m.codigo) AS estacoes
          FROM read_parquet('{MENSAL}') m
          LEFT JOIN read_parquet('{INVENTARIO}') i ON i.Codigo = m.codigo
         WHERE m.media IS NOT NULL
         GROUP BY 1, 2
         ORDER BY 1, 2;""")
    bacias = sorted({r["bacia"] for r in linhas})
    por_ano: dict[int, dict[str, int]] = defaultdict(dict)
    for r in linhas:
        por_ano[r["ano"]][r["bacia"]] = r["estacoes"]

    consist = consulta(f"""
        SELECT year(data) AS ano,
               count(DISTINCT codigo) FILTER (WHERE nivel_consistencia = 2) AS consistido,
               count(DISTINCT codigo) FILTER (WHERE nivel_consistencia = 1) AS bruto,
               count(DISTINCT codigo) AS total
          FROM read_parquet('{MENSAL}')
         WHERE media IS NOT NULL
         GROUP BY 1 ORDER BY 1;""")

    return {
        "bacias": bacias,
        "anos": [[a] + [por_ano[a].get(b, 0) for b in bacias] for a in sorted(por_ano)],
        "consistencia": [[r["ano"], r["consistido"], r["bruto"], r["total"]] for r in consist],
        # Último ano civil fechado da série mensal unificada. 2026 está pela
        # metade (o SOAP vai a maio) e cairia como se a rede tivesse sumido.
        "ultimo_ano_cheio": 2025,
    }


def main() -> int:
    paineis = {}

    print("painel: dias de rio seco...")
    paineis["seco"] = painel_seco()
    ns = len(paineis["seco"]["estacoes"])
    tot = sum(l[1] for l in paineis["seco"]["por_ano"])
    print(f"  {ns} estações que já secaram, {tot:,} dias secos no total")

    print("painel: deslocamento da cheia...")
    paineis["cheia"] = painel_cheia()
    if paineis["cheia"]:
        desl = sorted(r["desloc"] for r in paineis["cheia"])
        meio = desl[len(desl) // 2]
        adiant = sum(1 for x in desl if x < -0.5)
        atras = sum(1 for x in desl if x > 0.5)
        print(f"  {len(desl)} estações comparáveis; deslocamento mediano {meio:+.2f} mês")
        print(f"  {atras} com cheia mais tarde, {adiant} mais cedo (|desloc| > 0,5 mês)")

    print("painel: Q7,10...")
    paineis["q710"] = painel_q710()
    if paineis["q710"]:
        piorou = sum(1 for r in paineis["q710"] if r["var"] is not None and r["var"] < 0)
        zerou = sum(1 for r in paineis["q710"] if r["zerou"])
        print(f"  {len(paineis['q710'])} estações comparáveis; {piorou} com Q7,10 menor, "
              f"{zerou} zeraram a vazão mínima")

    print("painel: tamanho da rede...")
    paineis["rede"] = painel_rede()
    anos = paineis["rede"]["anos"]
    cheio = paineis["rede"]["ultimo_ano_cheio"]
    pico = max(anos, key=lambda l: sum(l[1:]))
    ult = next(l for l in anos if l[0] == cheio)
    print(f"  pico em {pico[0]} com {sum(pico[1:])} estações; "
          f"em {cheio} (último ano cheio), {sum(ult[1:])} "
          f"({sum(ult[1:]) / sum(pico[1:]) * 100:.0f}% do pico)")
    cons = {r[0]: r for r in paineis["rede"]["consistencia"]}
    print(f"  consistência: {cons[2014][1]} estações consistidas em 2014, "
          f"{cons[cheio][1]} em {cheio}")

    paineis["janelas"] = {"antes": ANTES, "depois": DEPOIS}
    # Procedência por painel: os dois grãos têm alcances diferentes e quem
    # consumir este JSON precisa saber qual painel para onde.
    paineis["fontes"] = {
        "mensal": ("ANA — arquivo de estações convencionais (1901 a 2023-09) fundido "
                   "com o SOAP HidroSerieHistorica (até 2026-05); alimenta cheia e rede"),
        "diaria": ("ANA — apenas o arquivo de estações convencionais, para em 2023-09 "
                   "(o SOAP só devolve agregado mensal); alimenta seco e q710"),
        "ultimo_ano_diario": FIM_DIARIO,
    }
    destino = S / "paineis.json"
    destino.write_text(json.dumps(paineis, ensure_ascii=False, separators=(",", ":")))
    print(f"\nescrito {destino} ({destino.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
