# Spike: 462 mil trechos no MapLibre GL 4.7.1

Ambiente: Mac M4, chromium embutido do Playwright 1.62 (nunca o Chrome instalado), janela 1280×800,
HTML de 17,37 MB aberto por `file://`. Dois modos de GL, porque o chromium embutido cai em
SwiftShader (CPU) se ninguém pedir a placa:

- **Metal**: `--use-angle=metal --enable-gpu` (placa de verdade, o que um leitor tem).
- **SwiftShader**: o padrão sem flags (o pior caso: VM, GPU na lista de bloqueio).

Reproduzir: `bun run notas/spike/base.ts`, `bun run notas/spike/spike.ts A|B` (`GPU=1` liga o Metal).
"fps" é a contagem de quadros por segundo girando o `bearing` 1,2°/quadro com `pitch` 55°, com a
rede inteira no enquadramento nacional ("brasil") e perto, z = 9 sobre a Amazônia ("perto").

| | Metal | SwiftShader |
|---|---|---|
| **Antes** (Canvas 2D, `index.html` de 17,37 MB) abrir até o véu sair | 1,10 s | 1,17 s |
| antes: heap JS após `gc()` / RSS de todos os processos | 99 MB / 642 MB | 99 MB / 674 MB |
| antes: fps arrastando | 120 | 57 |
| **A** `line` sobre GeoJSON montado dos buffers: setData até os ladrilhos | 1,5 s | 1,6 s |
| A: heap JS / RSS total | 320 MB / **2.216 MB** | 320 MB / 2.350 MB |
| A: fps girando brasil / perto | 120 / 121 | 26 / 101 |
| **B** custom layer WebGL, 2,2 M segmentos instanciados, sem corte: primeiro quadro | **0,38 s** | 18,5 s |
| B: heap JS / RSS total | 116 MB / 760 MB | 115 MB / 800 MB |
| B: fps girando brasil / perto | 75 / 85 | 0,2 / 0,2 |

## Leitura

Os dois passam no critério (abrir em menos de 10 s, 30 fps ou mais girando) **na placa**. Em
software a camada `line` ainda abre rápido e gira a 26 fps no enquadramento nacional.

**A** é o caminho com menos código, mas custa memória: o RSS sobe de 0,64 para 2,2 GB (o
GeoJSON é clonado para o worker, o geojson-vt indexa os 462 mil trechos e cada ladrilho
reencoda as propriedades). Os modos do mapa (esgoto, indústria, outorga, tendência, rio livre)
viram propriedades por feição (≥ 8 números × 462 mil) e trocar de modo obriga os ladrilhos a se
reconstruírem no worker. O acerto de cursor teria de passar pela geometria simplificada do
ladrilho, e não pela do dado.

**B** usa os buffers que a página já decodifica: heap de 116 MB (menos que o Canvas 2D de
hoje), primeiro quadro em 0,38 s, e o modo vira uma textura de cor por trecho (462 mil × 4 bytes),
trocada em milissegundos. O custo: sem corte, o vertex shader processa os 2,2 M de segmentos em
todo quadro, e em CPU isso dá 18 s. Ou seja, o B só serve com **corte espacial e por vazão**.

**Decisão: B**, com os trechos agrupados em blocos (faixa de vazão × célula de 40×40 sobre o
`bounds`), o corte das células pela matriz da câmera a cada quadro e o `corteZoom`/teto por faixa
reaproveitados do desenho antigo. A medição do resultado final está em `README.md` e no relatório
do commit que fecha a migração.
