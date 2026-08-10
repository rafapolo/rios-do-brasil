# Barragens e "rio livre"

**Objetivo.** O mapa desenha 168 reservatórios do Sistema Interligado Nacional. O país tem
31.136 barragens cadastradas. Com a topologia da BHO que o `outorga.py` já percorre, dá para
responder a pergunta que este mapa está melhor equipado que qualquer outro para responder:
**quantos quilômetros de rio livre sobram acima e abaixo de cada trecho** — e ninguém publica
isso de forma interativa para o Brasil.

## Fonte

```
https://www.snirh.gov.br/arcgis/rest/services/IG/SNISB/MapServer/0
```

Camada de ponto, **31.136 registros**, todos com `BAR_NU_LATITUDE`/`BAR_NU_LONGITUDE`
preenchidos. Mesmo padrão ArcGIS de `pipeline/baixa_etes.py` e `pipeline/baixa_outorgas.py`:
paginar com `resultOffset`/`resultRecordCount` e pedir `f=json`.

### Campos que interessam

`BAR_CD_SNISB` (grão real), `BAR_NM_NOME`, `USO_PRINCIPAL`, `USO_COMPLEMENTAR`,
`CATEGORIA_RISCO`, `DANO_POTENCIAL`, `NIVEL_PERIGO`, `BAR_DS_CLASSE`, `FASE_DE_VIDA`,
`BAR_NU_ALT_MAX_NIVEL_TERRENO` (20.709 preenchidos), `BAR_NU_CAP_TOTAL_RESERV` (28.043),
`POSSUI_PAE`, `POSSUI_PLANO_SEGURANCA`, `BARRAGEM_AUTUADA`, `INS_DT_INSPECAO`,
`ING_NM_MUNICIPIO`, `ING_SG_UFMUNICIPIO`, `NM_EMPREENDEDOR`.

### O que há lá dentro (medido em 10/08/2026)

`USO_PRINCIPAL`:

| Uso | Barragens |
|---|---:|
| Irrigação | 10.501 |
| Dessedentação animal | 6.403 |
| Regularização de vazão | 4.398 |
| Abastecimento humano | 2.515 |
| Aquicultura | 1.858 |
| Hidroelétrica | 1.626 |
| Paisagismo | 1.131 |
| Recreação | 763 |
| Industrial | 637 |
| Contenção de rejeitos de mineração | 612 |
| Contenção de sedimentos de mineração | 297 |

`FASE_DE_VIDA`: Operação 16.940 · sem informação 6.311 · nulo 6.624 · Projeto 513 ·
Desativada 347 · Em descaracterização 148 · Construção 99 · 1º enchimento 52 ·
**Rompida 24**.

## Armadilhas medidas

- **`ING_CD_CURSODAGUA_TRECHO` existe e está vazio nas 31.136 linhas.** O campo sugere um
  join direto contra a BHO, como o `ing_cd_ottobacia_trecho` das outorgas — mas não há um
  único valor. O casamento com a rede tem que ser **espacial**, a partir de lat/lon, como o
  `poluicao.py` faz com os pontos de lançamento. Conferir antes de escrever qualquer SQL que
  dependa do código.
- **Metade das barragens não tem classificação de risco.** `CATEGORIA_RISCO`: Não Classificado
  16.097 (52%), Médio 5.208, Baixo 4.424, Alto 3.341, Não se Aplica 2.066. `DANO_POTENCIAL`:
  Não Classificado 14.985, Baixo 10.145, Alto 4.067, Médio 1.939. Uma camada colorida por
  risco pinta sobretudo "ninguém classificou" — o que é a notícia, mas precisa estar escrito
  no mapa, não deduzido pelo leitor. Mesmo espírito da nota do `tch_ds == 'Poço'` na camada de
  outorga.
- **`BAR_DS_CLASSE` é quase todo nulo** (26.857 de 31.136). Não serve de eixo.
- **Para hidrelétrica, o SNISB é incompleto.** Ele tem 1.626 barragens de uso hidroelétrico;
  a camada `SPR/Aproveitamento_Hidreletrico_AHE` tem **2.993** empreendimentos em operação,
  com `AHE_NU_POT_KW`, `AHE_NM_RIO` e coordenada. Para fragmentação, usar as duas e deduplicar
  por proximidade.
- **Não usar `DADOSABERTOS/Hidrelétricas_UHE_e_PCH_Operação`** — tem 30 registros.
- **O ArcGIS do SNIRH está lento.** Em 10/08/2026 o metadado de uma única camada levou 37 s e
  a listagem raiz de serviços estourou o timeout. O downloader precisa do mesmo backoff e da
  mesma paginação que o `baixa_outorgas.py` já implementa.

## Roteiro

1. `pipeline/baixa_barragens.py`, no molde do `baixa_etes.py`: pagina a camada, deduplica por
   `BAR_CD_SNISB`, normaliza os rótulos e grava `barragens.parquet`.
2. Casar cada barragem ao trecho da BHO por coordenada (a rotina do `poluicao.py`/`outorga.py`).
3. Acumular pela topologia: para cada trecho, quantas barragens a montante, e a distância em
   km até a primeira barragem subindo e descendo → **rio livre**.
4. Modo novo no mapa, ou camada de pontos com ficha. Se virar modo de cor, lembrar que a
   rampa sequencial azul é da vazão; fragmentação é outro eixo e pede outra escala.
