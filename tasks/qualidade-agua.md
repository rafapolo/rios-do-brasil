# Qualidade da água medida

**Objetivo.** Os modos "esgoto" e "indústria" pintam carga **modelada**, que desce pela rede a
partir da outorga de lançamento. Não há nada na página que confronte isso com uma medição. As
séries do monitoramento de qualidade da ANA permitem que o leitor confira um trecho pintado
contra oxigênio dissolvido, DBO e coliformes de verdade medidos ali. É o maior ganho de
credibilidade disponível para o que o mapa já afirma.

## Fonte

> **29/10/2026: o serviço abaixo saiu do ar** (`{"error":{"code":404,"message":"Service not
> found"}}`). Varridas todas as pastas do ArcGIS do SNIRH e o Hub `dadosabertos.ana.gov.br`: o
> que sobra é `SPR/Monitoramento_QA_2001_a_2017` (só pontos em operação por ano — `CDSESTACAO`,
> `ANO`, `CORPODAGUA`, nenhum valor medido) e `DADOSABERTOS/IQA` (58 pontos, um recorte
> regional). Nenhum dos dois serve ao objetivo, que é confrontar medição com carga modelada.
> A tarefa está bloqueada até achar outra fonte nacional com valores.
> Pista principal: a API HidroWebService, que pede cadastro — ver [`hidroweb-acesso.md`](hidroweb-acesso.md).

> **Busca de 03/11/2026 (~30 min), sem fonte viável. Tarefa continua aberta e bloqueada.**
>
> - O serviço migrou de servidor, e nada com valores foi junto. Os dois serviços de
>   indicadores (`SPR/Indicadores_Qualidade_v31072023` e `..._v13052021`, os dois como
>   `MapServer` e `FeatureServer`) respondem `404 Service not found`. O Hub
>   `dadosabertos.ana.gov.br` (API `/api/search/v1/collections/all/items?q=...`) ainda lista as
>   camadas, mas com a URL do serviço morto: é só vitrine. O registro de metadados
>   (`metadados.snirh.gov.br`, "Indicadores de Qualidade de Água (2001 a 2021)") também aponta
>   para lá.
> - O servidor novo é `https://portal1.snirh.gov.br/server/rest/services/dados_abertos`
>   (179 serviços). Os de qualidade: `Estacao_de_Qualidade_de_Agua` (1.602 estações, campos
>   `CODIGO`, `LATITUDE`, `LONGITUDE`, `AREADRENAGEM`, `OPERANDO`, `BACIANOME`; **sem nenhum valor
>   medido**), `Rede_de_Monitoramento_de_Qualidade_de_Agua_Pontos_Em_Operacao` (1.817 pontos, só
>   cadastro), `Pontos_de_Monitoramento_..._Meta_2020` (4.453, só cadastro),
>   `IQA_Media_da_Serie_Disponivel` (erro 500 "GISService not instantiated", o serviço está
>   parado) e `IQA_Media_do_Ultimo_Ano_da_Serie` (responde, mas com zero camadas; descrição fala de
>   2001–2014). Os `Balanco_Hidrico_Qualitativo_*` são modelados, não medidos.
> - A API nova da ANA, `www.ana.gov.br/hidrowebservice/EstacoesTelemetricas/HidroSerieQA`,
>   responde `401 Unauthorized`: exige token do cadastro no HidroWeb (identificador e senha do
>   usuário). Não foi tentado, porque não há credencial; **é a pista mais promissora** — se o
>   Rafael tiver ou puder pedir o cadastro, a rota `HidroSerieQA` deve devolver as séries de
>   qualidade por estação. Vale testar antes de qualquer outra.
> - `dados.gov.br` (API pública de conjuntos) devolve 401 sem token; o CKAN antigo da ANA não existe
>   mais (`Cannot GET /api/3/...`). CETESB, IGAM, INEA, Waterbase e GEMStat não foram
>   investigados a fundo: o Waterbase é europeu; o GEMStat exige pedido de dados e tem poucas
>   estações no Brasil; os órgãos estaduais publicam relatórios em PDF e portais por estado, sem
>   um esquema único que caiba num download nacional neste esforço.

```
https://www.snirh.gov.br/arcgis/rest/services/SPR/Indicadores_Qualidade_v31072023/MapServer
```

Seis parâmetros, cada um em sua camada de ponto, com **média, mínimo e máximo por ano de 1978
a 2021** (`MED_1978`…`MED_2021`, `MIN_*`, `MAX_*`):

| Camada | Parâmetro | Estações |
|---:|---|---:|
| 2 | Oxigênio dissolvido | 4.902 |
| 8 | Turbidez | 4.900 |
| 14 | DBO | 4.536 |
| 5 | Fósforo total | 4.319 |
| 11 | E. coli (até 2020) | 4.227 |
| 17 | IQA | 3.368 |

Esquema idêntico nas seis: `LATITUDE`, `LONGITUDE`, `CDESTACAO`, `SGUF`, `ENTIDADE`,
`CORPODAGUA`, `AMBIENTE`, `NU<parâmetro>` (a classe), mais os três blocos anuais. Dá para
juntar tudo num registro por estação com seis séries.

## Armadilhas medidas

- **`CDESTACAO` é texto livre e sujo.** Encontrado: `'88070000 ou GER68'` — duas identidades
  num campo só. Não é o código de 8 dígitos da ANA, então a regra do `zfill(8)` que vale para
  o resto do repositório **não salva este join**. O casamento com a rede e com o inventário
  fluviométrico tem que ser por coordenada.
- **A janela honesta é bem mais curta que 1978–2021.** Estações com IQA preenchido: 68 em 1990,
  316 em 2000, 912 em 2010, 1.580 em 2015, 1.640 em 2021. Antes de ~2005 não há cobertura
  nacional. Isso tem o mesmo formato da ressalva de rede encolhendo que o `series.html` já faz
  para a consistência das séries de vazão, e precisa aparecer do mesmo jeito.
- **As camadas 0, 3, 6, 9, 12 e 15 são camadas de grupo** — devolvem `geometryType: null` e
  nenhum campo. As séries históricas são as ímpares-menos-um listadas acima (2, 5, 8, 11, 14,
  17); as intermediárias (1, 4, 7, …) são só a média do último ano.
- **O ArcGIS do SNIRH está lento** (37 s para o metadado de uma camada em 10/08/2026). Mesmo
  backoff e paginação do `baixa_outorgas.py`.
- O `AMBIENTE` separa lótico de lêntico. Comparar DBO de reservatório com DBO de rio corrente
  não é a mesma medida — separar antes de ranquear.

## Roteiro

1. `pipeline/baixa_qualidade.py`: pagina as seis camadas, junta por estação (coordenada +
   `CDESTACAO` como apoio), grava `qualidade.parquet` no formato longo
   (estação × parâmetro × ano × med/min/max).
2. Casar a estação ao trecho da BHO por coordenada.
3. Duas entregas possíveis, independentes:
   - **No mapa**: camada de pontos de qualidade, ficha com as seis séries — e, nos modos
     esgoto/indústria, a leitura medida ao lado da fração modelada no mesmo trecho.
   - **No `series.html`**: painel de tendência de OD/DBO/IQA na janela 2005–2021, no mesmo
     método de Mann-Kendall + Theil-Sen do `analisa_tendencia.py`, e o cruzamento com a
     tendência de vazão — rio que perde água concentra carga.
4. Se virar cor, a qualidade tem sinal (melhora/piora) e pede a escala divergente do
   `series.html`, não a rampa sequencial azul do mapa.
