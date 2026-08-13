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
| `series_vazao_mensal_completa` | estação × mês | **é esta que a análise usa**: zip + SOAP, 1901–2026, 4.218 estações |
| `series_vazao_mensal` / `series_cota_mensal` | estação × mês | só o zip (1901–2023), particionadas em `bacia=XX/` |
| `series_vazao_diaria` / `series_cota_diaria` | estação × dia | 36 M e 48 M de linhas |
| `series_chuva_mensal` / `series_chuva_diaria` | estação × mês/dia | 5.389 pluviômetros, 69,8 M de linhas diárias |
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
python3 baixa_etes.py           # camada ETE do Atlas Esgotos, ~1 min (opcional)
python3 terra_fronteiras.py
python3 processa.py               # regionaliza + valida, ~5 min
python3 baixa_outorgas.py         # lançamento e captação do SNIRH, ~4 min
python3 outorga.py                # camada de licença de retirada, ~12 min
python3 baixa_topologia.py 1      # só atributos da BHO — usado por tendencia_rede.py e bacia_rede.py
python3 tendencia_mapa.py         # %/década por estação, do tendencia.json (opcional)
python3 tendencia_rede.py         # leva o %/década da estação para os trechos, ~10 s
python3 bacia_rede.py             # nome da bacia (22 maiores por km) na ficha do trecho, ~10 s
python3 monta_pagina.py

# séries históricas (series.html) — só depende do lake
# analisa_tendencia.py roda antes do par tendencia_mapa.py/tendencia_rede.py: é ele que faz
# o tendencia.json de que os dois vivem
python3 pipeline/analisa_tendencia.py
python3 pipeline/prepara_paineis.py
python3 pipeline/monta_series.py
```

Dependências: `requests`, `polars`, `numpy`, `scipy`, `shapely`, `pyarrow`.
`analisa_tendencia.py` usa só `numpy` de propósito — Mann-Kendall e Theil-Sen estão escritos à
mão porque o beelink não tem scipy, e o código precisa poder migrar para lá.

**O pipeline não tem testes.** A verificação é empírica e cada script imprime o que serve de
conferência: `processa.py` roda validação cruzada 5-fold contra estações removidas;
`analisa_tendencia.py` imprime os extremos do ranking, que devem bater com a geografia
(semiárido caindo, arco de desmatamento subindo). Ao mexer nos números, compare contra o que o
README afirma — os valores lá são resultado medido, não arredondamento.

**As páginas geradas, sim.** 76 testes em `testes/`, com Bun e Playwright:

```bash
bun install && bun run preparar   # baixa chromium, firefox e webkit (uma vez)
bun test                          # ~4 min, 76 testes nos três motores
```

Isso continua não sendo build system: o `package.json` e o `node_modules/` são só de
desenvolvimento, nada deles entra no HTML publicado, e o `.gitignore` segura o `node_modules/`.

Três coisas ao mexer na suíte:

- **`page.evaluate` do Playwright em JS avalia string como expressão, não como função a
  chamar** — ao contrário do binding em Python, que detecta a arrow function e a invoca. Passar
  `"() => …"` direto devolve `undefined` calado, e o teste passa a comparar nada com nada. Use o
  `roda()` do `testes/comum.ts`, que envolve em IIFE.
- Os internos da página (`N`, `q`, `fOut`, `fichaTrecho`…) vivem dentro da IIFE do `<script>` e
  não dá para alcançá-los de fora. `copiaSondada()` gera uma cópia temporária do `index.html`
  com `window.__testes` injetado antes do marcador `/* ---------- início ---------- */` — o
  produto não ganha porta de depuração por causa do teste.
- Abrir o `index.html` custa ~9 s (14 MB, gzip, 462 mil trechos). Cada par (motor, URL) é aberto
  uma vez e reaproveitado; quem mexe no estado da página chama `reinicia()` antes.

## Como uma página é montada

`pipeline/template*.html` são HTML completos com marcadores de comentário
(`/*__DADOS__*/`, `/*__FONTE__*/`, `/*__TENDMAPA__*/`, `/*__PAINEIS__*/`). Os `monta_*.py`
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
- **Os limites da câmera do mapa moram em dois lugares só, e nenhum deles é literal solto.**
  O teto de zoom é `ZOOM_MAX` (hoje 120 × o enquadramento nacional, ~20 m/px), lido pelos três
  pontos que travam escala — botão, roda/pinça e os dois voos de enquadramento. O limite de
  arrasto é `prender()`, chamado no fim do `pointermove` e do `aplicarZoom()`: ele impede que o
  **centro da tela** saia do `bounds` (a extensão inteira da BHO, dos Andes ao Prata — não a
  `moldura`, que é só o contorno do Brasil). Sem ele o mapa é plano infinito e um arrasto
  distraído joga a rede para fora da tela sem deixar pista de para que lado voltar. Quem subir
  o `ZOOM_MAX` precisa reconferir duas coisas que não são cobertas por teste: o degrau da grade
  da BHO (11 m nas bacias grandes, 110 m nas pequenas) e a camada de fluxo, que nunca foi
  calibrada acima dessa faixa.
- **`<meta name="viewport">` é obrigatório** e as duas páginas ficaram sem ele por muito tempo.
  Sem a tag, o celular adota um viewport de 980 px e reduz tudo por zoom: o texto sai minúsculo
  e **nenhuma media query de `max-width` dispara**, então todo o CSS de celular vira letra
  morta. Não dá para flagrar com `page.set_viewport_size` do Playwright — só emulando com
  `is_mobile=True`, que é quando o Chromium passa a respeitar (ou não) a tag.
- **Os SVG dos gráficos não têm `viewBox`.** Logo `max-width: 100%` neles não encolhe, **corta**
  — a metade direita do gráfico some e não há como alcançá-la. Quem rola é o `.svgwrap` em volta.
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
- **O SOAP `telemetriaws1.ana.gov.br` devolve HTTP 429** sob concorrência, e o limite é **por
  IP** (medido: um segundo host responde 200 em 2 s enquanto o primeiro apanha). Precisa de
  backoff exponencial e de um freio compartilhado entre threads; sem isso as tentativas queimam
  em segundos e a estação é descartada silenciosamente. Ele recua até os anos 1930 — o corte em
  1995 do `baixa_vazao.py` é escolha, não limite. Para volume, distribua por hosts
  (`beelink`/`finland`/`livre`), não por threads: ~40 estações/min por IP.
- **A série diária não tem como ser atualizada pelo SOAP.** `HidroSerieHistorica` devolve
  agregado mensal; o dia a dia (e portanto os estados de rio seco e a Q7,10) só existe no zip,
  que para em setembro de 2023. Qualquer painel diário tem janela mais curta que os mensais, e
  isso precisa estar escrito na página.
- **`NivelConsistencia`**: 2 (consistido) sempre vence 1 (bruto) no dedup por
  `(codigo, mês)`. Inverter isso muda ~28 mil meses em 273 estações.
- **A janela da tendência não é a da série da estação.** `analisa_tendencia.py` só conta anos
  com 10 meses medidos e exige 20 anos e dado até 2015, então a ficha do mapa mostra as duas
  coisas: "Série 1995–2025 · 365 meses" ao lado de "Janela da tendência 1982–2023 · 42 anos".
  Confundir as duas faz o número parecer mais recente do que é. Das 1.534 estações com
  tendência, 1.273 estão no mapa — o resto não é desenhado. Dessas, o modo **Tendência**
  desenha **394**: as que passam nos dois testes que o ranking do `series.html` aplica
  (significância a 5% com FDR, e nome que não denuncia barragem). As outras 879 ficam fora —
  843 sem significância e 36 significativas mas em barragem —, e a nota do modo diz isso na
  página, senão o mapa parece afirmar que só algumas centenas de estações do país têm tendência
  medida. Os dois testes são fixos; a faixa do modo move só o corte em %/década, e na parada de
  25% sobram as 17 de sempre. **Toda a escala pendura no `LIMITE` do `tendencia_mapa.py`**: as
  classes da legenda são frações dele (±0,2, ±0,6, ±1) e as paradas da faixa também
  (0,2 a 1,6 ×), então mudar aquele número move cor, legenda e faixa juntas — a página lê o
  limite do próprio blob e não há corte escrito à mão no template.
- **A cor do trecho no modo Tendência é da estação, não do trecho.** `tendencia_rede.py`
  reparte a rede: cada trecho leva a tendência da **primeira estação a jusante dele**, e a
  próxima régua rio acima corta a herança. É a bacia incremental de cada posto, sem
  sobreposição. Por cima vem o `PISO` de 2% da vazão da estação — sem ele o mesmo cálculo
  pinta 332 mil trechos e dois milhões de km, levando o número de uma régua no tronco até a
  última nascente; com ele são **42.302 trechos e 204,5 mil km**, e o blob passa de 346 kB gz
  para 78. O trecho ancorado entra sempre, mesmo abaixo do piso. Três coisas daí:
  **(a)** a extensão pintada é proporcional à bacia incremental, não à confiança — o
  Solimões-Amazonas inteiro sai de uma régua em Jatuarana, e a nota do modo precisa continuar
  dizendo que a tendência não foi medida no trecho; **(b)** 3 das 394 estações não casam a
  trecho nenhum (critério do `processa.py:287`: 0,05° e razão de área ≤ 1,4×) e ficam só como
  ponto — inclusive o Jaguaribe/Quixeré, que é a 4ª que mais seca; **(c)** o script roda
  avulso sobre o `rede_vazao.json` pronto, no molde do `outorga.py`, e **reescreve o
  `tendencia_mapa.json`** acrescentando `lista`, `trecho` e `piso` — rodar o
  `tendencia_mapa.py` de novo apaga as três, então a ordem entre os dois importa. **Isso já
  quebrou a página publicada uma vez**: um `monta_pagina.py` rodado sobre um
  `tendencia_mapa.json` velho (de antes do `tendencia_rede.py` ter rodado nesse checkout)
  reempacotou o modo Tendência sem `trecho`, e ele voltou a mostrar só os pontos das estações,
  sem pintar rio nenhum — no ar por algumas horas até alguém notar. Os três JSON intermediários
  (`tendencia_mapa.json`, `rede_vazao.json`, `bacia_rede.py` mais abaixo) não têm data de
  validade visível; antes de montar a página a partir de um checkout que não acabou de rodar o
  pipeline inteiro, vale conferir `list(json.load(open(...)).keys())` contra o que o script que
  os produz promete escrever.
- **A bacia de cada trecho** (`bacia_rede.py`, roda depois do `tendencia_rede.py`) desce a rede
  até a foz e nomeia pelo trecho terminal — mas só as 22 maiores por km viram nome na ficha; o
  resto (~21% da rede) cai em "Outras bacias". Duas correções fazem parte do cálculo, não são
  acabamento: **(a)** Paraná, Paraguai e Uruguai só terminam de verdade no Rio da Prata, fora do
  Brasil — sem cortar a topologia na fronteira os três apareceriam com um nome só, que ninguém
  usa aqui; o corte só entra nos grupos cujo terminal original já estava fora do país, então
  Amazonas e São Francisco (que desaguam dentro) não são tocados. **(b)** O Tocantins se perde
  no estuário do Amazonas antes de qualquer trecho voltar a se chamar rio, e o terminal do grupo
  vem rotulado "Baía de Marajó" pela ANA — sem o `RENOMEIA` do script, o quinto maior rio do
  país apareceria com nome de acidente geográfico.
- **A ordem de Strahler não vale fora do Brasil** na BHO, e o nome do trecho às vezes é de um
  afluente pequeno — por isso o filtro do mapa é por vazão, não por ordem.
- **`MunicipioCodigo` da ANA não é IBGE**, e o inventário de 2023 marca descarga líquida como
  `'SIM'`/`'NÃO'` enquanto o do SOAP usa `'1'`/`'0'`.
- **Código de estação: sempre 8 dígitos com zero à esquerda.** Os MDB pluviométricos guardam o
  código como número e devolvem 7 (`1036005` onde todo o resto tem `01036005`). Um join contra o
  inventário sai vazio, calado — foi assim que o painel de chuva nasceu sem nenhum ponto. O ETL
  faz `zfill(8)`; qualquer fonte nova precisa fazer o mesmo.
- **A camada `SPR/ETE_2019` traz uma linha por município atendido, não por ETE.** "ETE Barueri"
  aparece 13 vezes, "ETE ABC" 9 — contar linha infla o total em ~3%. O grão real é `ETE_CD`, e é
  por ele que o `baixa_etes.py` deduplica (3.774 linhas → 3.667 estações). No mesmo dado,
  `ETE_DS_STATUS` chega com mojibake da origem ("Não localizadas" vira `Nto`, `Nmo`, `Nro`,
  `Nno`, cada uma contando separado), `ETE_QT_POPPROJ` vem zerado até nas grandes da RMSP e
  `ETE_NM_CORPORECEPTOR` vem em branco em 86% das linhas. Os sete códigos de
  `ETE_DS_TIPOLOGRESUMIDA` (LAG, RAN, LAT, SIM, QBI, MIS, ESP) não têm dicionário publicado — o
  do ETL foi lido do campo longo `ETE_DS_TIPOLOGIA` que acompanha cada linha.
- **A remoção de DBO da ETE vem como fração (0,88), não porcentagem**, e é a *declarada* no
  Atlas — projeto, não medição no rio. Não é comparável com a carga que o `poluicao.py` faz
  descer pela rede, que sai de outorga.
- **A outorga de captação tem coordenada, apesar de o `baixa_outorgas.py` ter passado muito
  tempo sem pedi-la.** A camada do SNIRH é de ponto e traz os mesmos 80 campos do lançamento,
  incluindo `int_nu_latitude`/`int_nu_longitude` e `ing_cd_ottobacia_trecho`. Enquanto só se
  baixava município, o cruzamento com a vazão ficava preso ao grão municipal — e é daí que vem
  a ressalva do painel de outorga do `series.html` (no Ribeirão do Gama o total do DF dá dez
  vezes o córrego). O `outorga.py` usa a coordenada; aquele painel ainda não, porque
  `tendencia.json` só tem lat/lon da estação, não da bacia dela.
- **`tch_ds == 'Poço'` é um terço das captações** (181.902 → 105.101 sem elas). São água
  subterrânea e não saem de leito nenhum, então ficam fora da camada do mapa. Isso deixa de
  fora justamente o bombeamento do Urucuia, que é o centro da denúncia sobre o oeste da Bahia —
  a nota do modo diz isso, e qualquer afirmação sobre pressão hídrica ali precisa repetir.
- **A vazão da outorga vem em m³/h e nula em um terço dos registros.** Os nulos entram como
  presença e somam zero, igual ao que `poluicao.py` faz com lançamento sem vazão declarada;
  descartá-los faria a contagem de tomadas d'água mentir.

## Publicação

`.github/workflows/publica-pages.yml` copia `index.html`, `series.html` e `screenshot.png` para
o GitHub Pages — sem build. `publica-roda.yml` dispara um `repository_dispatch` para
`rafapolo/rodado`, que reconstrói `/analises/rios-do-brasil/`.
