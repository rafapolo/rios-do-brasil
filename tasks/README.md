# O que ainda cabe no mapa

Levantamento de 10/08/2026: o que existe de dado hídrico que a plataforma ainda não usa.
Cada arquivo aqui traz a fonte já sondada — endpoint, campos, contagens e as armadilhas
medidas contra o serviço, não supostas.

| Tarefa | Fonte | Estado |
|---|---|---|
| [Barragens e rio livre](barragens.md) | SNISB via ArcGIS do SNIRH | fonte confirmada, falta escrever o ETL |
| [Qualidade da água medida](qualidade-agua.md) | Indicadores de Qualidade (RNQA) do SNIRH | fonte confirmada, falta escrever o ETL |
| [Camada de satélite](satelite.md) | Sentinel-2 cloudless da EOX, mosaico de 2016 (CC BY 4.0) | **implementado na branch `wip/satelite-2016`, parado na suíte** — o `mapa.test.ts` não fecha e a causa não foi diagnosticada. Os anos 2017+ são BY-NC-SA e não cabem no MIT deste repo |

## Parados, mas prontos no lake

Estes dois não precisam baixar nada — já estão no data lake do `../rodado` e valem um painel
no `series.html`. Ficaram de fora da rodada atual por escolha, não por impedimento.

- **SNIS** (`br_mdr_snis/municipio_agua_esgoto`, 1995–2022, 5.425 municípios em 2022).
  Perda mediana na distribuição de **29,9%** em 2022, praticamente igual à de 2010 (30,2%);
  15,82 km³ produzidos contra 12,31 km³ consumidos. É o irmão do Atlas Esgotos pelo outro lado
  do cano, e o join município → rede já existe em `pipeline/baixa_atlas_esgotos.py`, que usa
  `br_geobr_mapas/sede_municipal`. Vale a ressalva de grão municipal que a camada de esgoto já
  carrega.
- **MapBiomas superfície de água** (`br_mapbiomas_estatisticas/cobertura_uf_classe`, classe 33,
  1985–2021). O espelho d'água do país cai de **189.000 km² para 168.000 km², −11%**. Interessa
  por ser instrumento independente: tudo que o `series.html` afirma hoje vem de régua de
  estação, e isto vem de satélite. Só existe no grão de UF — as tabelas municipais são de
  transição (`transicao_municipio_de_para_decenal`), que serve para um painel de "de/para".

## Descartado

- **RiverATLAS** (`world_wwf_hydrosheds/rivers_atlas`, 8,5 M trechos, 2,1 GB, 281 atributos).
  Rico de verdade, mas a rede não é a da BHO e casar as duas geometrias custa mais do que o
  que se ganha.
- **`DADOSABERTOS/Hidrelétricas_UHE_e_PCH_Operação`** — tem 30 registros. Ver
  [barragens.md](barragens.md) para o que usar no lugar.
