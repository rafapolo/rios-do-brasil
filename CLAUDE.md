# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

Duas páginas HTML autocontidas sobre os rios do Brasil, geradas por scripts Python:

- **`index.html`** — mapa dos 462.539 trechos da Base Hidrográfica Ottocodificada da ANA,
  desenhados pela vazão média. Canvas 2D, 14 MB.
- **`series.html`** — análise da série histórica da ANA (1901–2023): tendência de vazão por
  estação, dias de rio seco, deslocamento da cheia, Q7,10, tamanho da rede. SVG, 770 KB.

**Não há build system, nem `package.json`, nem dependência em runtime.** Os dados vão embutidos
como gzip+base64 dentro do próprio HTML e são descomprimidos no navegador com
`DecompressionStream`. Abrir o arquivo por `file://` tem que funcionar — é requisito, não
conveniência.

## Os dados moram em `../rodado`

Este repo **não guarda dados**. Tudo pesado está num data lake de Parquet no host `beelink`
(configurado em `~/.ssh/config`), gerenciado pelo repo irmão `../rodado`. O padrão de acesso é
sempre o mesmo — SQL por stdin para o DuckDB remoto:

```bash
ssh beelink "~/bin/duckdb -json" <<'SQL'
SELECT count(*) FROM read_parquet('~/rodado/br_ana_telemetria/series_vazao_mensal/**/*.parquet');
SQL
```

Em Python isso é `subprocess.run(["ssh", "beelink", "~/bin/duckdb -json"], input=SQL, ...)` e
depois `json.loads(out.stdout[out.stdout.index("["):])` — o DuckDB imprime lixo antes do JSON,
por causa do `.duckdbrc`. Ver `pipeline/baixa_reservatorios.py:32` e
`pipeline/analisa_tendencia.py`.

Tabelas em `~/rodado/br_ana_telemetria/` que este repo consome:

| Tabela | Grão | Observação |
|---|---|---|
| `series_vazao_mensal` / `series_cota_mensal` | estação × mês | particionadas em `bacia=XX/` |
| `series_vazao_diaria` / `series_cota_diaria` | estação × dia | 36 M e 48 M de linhas |
| `estacoes_inventario_2023` | estação | inventário de 04/08/2023, 58 colunas |
| `estacoes` | estação | catálogo do SOAP, **sem nenhuma leitura** |

Os ETLs que produzem essas tabelas ficam em `../rodado/scripts/scrap/ana_*.py`, não aqui.

**Ao criar tabela nova no lake, rode `../rodado/scripts/build_metadata_catalog.py`** — sem isso
ela não entra no `_rodado_metadata/catalog.parquet`.

## Comandos

```bash
# mapa (index.html) — na ordem; baixa_rede.py leva ~20 min e 888 MB
cd pipeline
python3 baixa_rede.py 1
python3 baixa_vazao.py            # SOAP da ANA, ~35 min
python3 baixa_reservatorios.py
python3 terra_fronteiras.py
python3 processa.py               # regionaliza + valida, ~5 min
python3 monta_pagina.py

# séries históricas (series.html) — só depende do lake
python3 pipeline/analisa_tendencia.py
python3 pipeline/prepara_paineis.py
python3 pipeline/monta_series.py
```

Dependências: `requests`, `polars`, `numpy`, `scipy`, `shapely`, `pyarrow`.
`analisa_tendencia.py` usa só `numpy` de propósito — Mann-Kendall e Theil-Sen estão escritos à
mão porque o beelink não tem scipy, e o código precisa poder migrar para lá.

**Não há suíte de testes.** A verificação é empírica e cada script imprime o que serve de
conferência: `processa.py` roda validação cruzada 5-fold contra estações removidas;
`analisa_tendencia.py` imprime os extremos do ranking, que devem bater com a geografia
(semiárido caindo, arco de desmatamento subindo). Ao mexer nos números, compare contra o que o
README afirma — os valores lá são resultado medido, não arredondamento.

## Como uma página é montada

`pipeline/template*.html` são HTML completos com marcadores de comentário
(`/*__DADOS__*/`, `/*__FONTE__*/`, `/*__TENDENCIA__*/`, `/*__PAINEIS__*/`). Os `monta_*.py`
fazem `str.replace` desses marcadores por gzip+base64 e escrevem o HTML final na raiz do repo.

Consequência prática: **edite `pipeline/template*.html`, nunca o `index.html`/`series.html`
gerado** — a próxima montagem sobrescreve. A exceção é quando o dado-fonte não está disponível
localmente (o `index.html` precisa do `rede_vazao.json` e da BHO, ambos gitignored e caros de
refazer); aí a edição cirúrgica no artefato tem que ser aplicada **também** ao template, senão
some no próximo build.

Todos os JSON intermediários são gitignored. Os HTML gerados são versionados — são o produto.

## Convenções que o código já segue

- **Português** em nomes, comentários e commits (`type: descrição em minúscula`). Os scripts do
  `../rodado` são em inglês; os daqui não.
- **Tokens CSS compartilhados** entre as duas páginas (`--ink`, `--rule`, `--accent`,
  `--ramp-0..6`), definidos em três blocos: `:root`, `@media (prefers-color-scheme: dark)` com
  guarda `:root:not([data-theme="light"])`, e `:root[data-theme="dark"]`. Nunca defina cor só
  dentro de um media query.
- **O mapa usa rampa sequencial azul** (vazão é magnitude); **`series.html` usa escala divergente**
  laranja↔azul com cinza no zero (tendência tem sinal). Não misture: laranja ali significa "rio
  secando", e reusar esse par para outro eixo faz o leitor ler perda onde não há.
- Legenda e gráfico saem da mesma função de cor, para não divergirem (`montaLegenda()` em
  `template.html`).
- `font-variant-numeric: tabular-nums` em tudo que é número; JetBrains Mono embutida em base64
  (`pipeline/fonte_mono.txt`).

## Armadilhas da fonte

- **A ANA esvaziou** o repo `anagovbr/hidro-dados-estacoes-convencionais` em dez/2025. Um zip de
  `refs/heads/main` sai com zero byte; o commit `b8b65b0` ainda tem os 2,3 GB.
- **O SOAP `telemetriaws1.ana.gov.br` devolve HTTP 429** sob concorrência. Precisa de backoff
  exponencial e de um freio compartilhado entre threads; sem isso as tentativas queimam em
  segundos e a estação é descartada silenciosamente. Ele recua até os anos 1930 — o corte em
  1995 do `baixa_vazao.py` é escolha, não limite.
- **`NivelConsistencia`**: 2 (consistido) sempre vence 1 (bruto) no dedup por
  `(codigo, mês)`. Inverter isso muda ~28 mil meses em 273 estações.
- **A ordem de Strahler não vale fora do Brasil** na BHO, e o nome do trecho às vezes é de um
  afluente pequeno — por isso o filtro do mapa é por vazão, não por ordem.
- **`MunicipioCodigo` da ANA não é IBGE**, e o inventário de 2023 marca descarga líquida como
  `'SIM'`/`'NÃO'` enquanto o do SOAP usa `'1'`/`'0'`.

## Publicação

`.github/workflows/publica-pages.yml` copia `index.html`, `series.html` e `screenshot.png` para
o GitHub Pages — sem build. `publica-roda.yml` dispara um `repository_dispatch` para
`rafapolo/rodado`, que reconstrói `/analises/rios-do-brasil/`.
