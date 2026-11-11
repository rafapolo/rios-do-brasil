# Spike: terreno da MapLibre 4.7.1 + camada `custom` com z (etapa 0 do `tasks/done/relevo-3d.md`)

Bancada: `notas/spike/relevo.html` (MapLibre de `pipeline/vendor/`, DEM de mentira: gaussiana de
3.000 m em −50/−15, σ 2°, servida em Terrarium por `addProtocol`, exagero 12×) e
`notas/spike/relevo.ts` (`bun run notas/spike/relevo.ts`), aberta por `file://` nos três motores do
Playwright 1.62 (chromium com Metal, firefox, webkit). Os prints (`notas/spike/relevo-<motor>-*.png`) saem do script e não são versionados.
11/11/2026.

| Pergunta | Resposta (igual nos três motores) |
|---|---|
| `fill`/`line`/`hillshade` drapeiam sozinhas? | **Sim.** A divisa de teste curva sobre o morro; o hillshade sai da mesma fonte `raster-dem`. |
| A `custom` recebe que matriz, e em que unidade vai o z? | A matriz do `render(gl, m)` é **idêntica** a `map.transform.customLayerMatrix()`. O z é em unidade de Mercator **relativo à altitude do centro**: `z = (h·EXAGERO − map.transform.elevation) / (C·cos φ)`, com `C = 2π·6.371.008,8 m` e `1/cos φ = cosh(2π(0,5 − y))` (exato por vértice, no shader). Com isso a projeção bate com `map.project` a ≤ 0,3 px em quatro pontos do morro; com o z absoluto (sem descontar `elevation`) sai 13 px acima. |
| A `custom` fica enterrada pelo depth buffer? | Não: chega com `DEPTH_TEST` desligado e desenha por cima de tudo. A rede já desliga o teste; fica assim (rio sempre legível, sem oclusão por serra). |
| `unproject` e `customLayerMatrix()` consideram o terreno? | `customLayerMatrix()` **não** (é preciso somar o z relativo, acima). `map.unproject` **sim**: devolve o ponto do terreno sob o pixel, com erro de ~0,02° (o buffer de coordenadas da biblioteca é grosso). Basta para o acerto de cursor, que procura trecho num raio em volta. |
| `addProtocol` por `file://`? | Funciona nos três: 14 ladrilhos pedidos, nenhum erro. O PNG é montado à mão (deflate "stored"), sem canvas no caminho. |

Consequência: **plano A** (terreno da biblioteca + rede elevada no shader da camada própria).
O plano B (malha própria) não é necessário.

`map.transform.elevation` muda quando o centro anda; o shader recebe o valor do quadro como
uniforme, e o `paraTela` da CPU lê o mesmo valor em `lerCamera()`.

**Achado depois do spike:** `setTerrain(...)` ou `setTerrain(null)` com a câmera em movimento congela a
animação em curso (um `easeTo` de 0° a 60° com padding parou em 32° e 81 de 150 px, sem `moveend`). A
página só troca o terreno com a câmera parada (`aplicaRelevo` espera o `moveend`).
