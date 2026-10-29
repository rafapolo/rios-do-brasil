# O que ainda cabe no mapa

Levantamento de 10/08/2026: o que existe de dado hídrico que a plataforma ainda não usa.
Cada arquivo aqui traz a fonte já sondada — endpoint, campos, contagens e as armadilhas
medidas contra o serviço, não supostas.

| Tarefa | Fonte | Estado |
|---|---|---|
| [Barragens e rio livre](barragens.md) | SNISB via ArcGIS do SNIRH + hidrelétricas da Aneel | **implementado em 29/10/2026**: modo "Rio livre" no mapa, por `baixa_barragens.py` e `barragens.py` |
| [Qualidade da água medida](qualidade-agua.md) | Indicadores de Qualidade (RNQA) do SNIRH | **sem fonte desde out/2026**: o serviço `SPR/Indicadores_Qualidade_v31072023` devolve 404 (29/10/2026) e nada no SNIRH o substitui — ver a nota no arquivo |
| [Camada de satélite](satelite.md) | Sentinel-2 cloudless da EOX, mosaico de 2016 (CC BY 4.0) | **implementado e com a suíte fechando** — o que travava era uma asserção, não a camada. Os anos 2017+ são BY-NC-SA e não cabem no MIT deste repo |

## Feitos a partir do lake

Os dois painéis que estavam parados entraram no fim do `series.html` em 29/10/2026, por
`prepara_paineis.py espelho perda` (refaz só eles, sobre o `paineis.json` existente):

- **MapBiomas superfície de água** (classe 33, por UF): 192.596 → 168.658 km² entre as médias
  de 1985–89 e 2017–21, −12,4%. Pantanal à frente (MS −57,7%, MT −46,0%).
- **SNIS**, perda na distribuição (IN049) pela mediana entre municípios, 2006–2022: 31,1% →
  29,9%. A soma nacional dos volumes não serve — a água importada do vizinho entra na produção
  dos dois municípios e infla a conta em até seis pontos nos anos em que a importação salta.

## Descartado

- **RiverATLAS** (`world_wwf_hydrosheds/rivers_atlas`, 8,5 M trechos, 2,1 GB, 281 atributos).
  Rico de verdade, mas a rede não é a da BHO e casar as duas geometrias custa mais do que o
  que se ganha.
- **`DADOSABERTOS/Hidrelétricas_UHE_e_PCH_Operação`** — tem 30 registros. Ver
  [barragens.md](barragens.md) para o que usar no lugar.
