# Qualidade da água medida

**Objetivo.** Os modos "esgoto" e "indústria" pintam carga **modelada**, que desce pela rede a
partir da outorga de lançamento. Não há nada na página que confronte isso com uma medição. As
séries do monitoramento de qualidade da ANA permitem que o leitor confira um trecho pintado
contra oxigênio dissolvido, DBO e coliformes de verdade medidos ali. É o maior ganho de
credibilidade disponível para o que o mapa já afirma.

## Fonte

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
