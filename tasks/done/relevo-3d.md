# Relevo de verdade na vista 3D

**Objetivo.** Hoje a vista 3D (`#bt3d`, `define3D`) só inclina a câmera sobre um plano: a
página não tem nenhum dado de altitude, e a rede aparece sobre uma mesa lisa. Com o relevo
de verdade, as serras, chapadas e vales aparecem, e a água desce por onde de fato escorre: o
São Francisco cortando o planalto, o Tietê correndo para o interior a partir da Serra do Mar,
o Pantanal como uma bacia rasa.

**Estado:** **implementado em 11/11/2026.** Etapas 0–4 e 6 feitas; na 5 (tour) as câmeras não precisaram
de ajuste: os prints das cenas em 3D com e sem relevo (`notas/spike/relevo-tour.ts`) enquadram igual. O que
saiu diferente do plano, e por quê:

- **Spike:** plano A (terreno da biblioteca), e o z da camada própria é **relativo à altitude do centro**
  (`map.transform.elevation`), não absoluto — a `customLayerMatrix()` não conhece o terreno. Respostas
  medidas nos três motores em [`notas/spike-relevo.md`](../../notas/spike-relevo.md).
- **Grade:** 1/30° (1.770 × 1.470). A de 1/60° deu 5+ MB e não cabe nos 2 MB. A codificação acabou
  em preditor plano + zigue-zague + dois planos de byte, quantum de 2 m: **1,37 MB** em base64 (o delta
  por linha em int16 dava 2,1 MB). Lake: `world_noaa_etopo.etopo2022_60s_america_sul` (CC0).
- **Exagero:** não é constante. 12× no enquadramento nacional, cai com a raiz do zoom, piso 1,5×
  (`EXAGERO`), aplicado em `map.terrain.exaggeration` a cada zoom. A 12× fixo, de perto a Serra do Mar
  vira parede.
- **Armadilha nova:** `setTerrain` (ligar ou desligar) com a câmera em movimento congela a animação
  no meio (pitch 32° de 60°; o padding do tour pela metade, que um teste do celular pegou). A troca espera
  o `moveend` (`aplicaRelevo`).
- **Sem oclusão:** a camada própria chega com o teste de profundidade desligado e fica assim; o rio
  atrás do morro continua visível, e é isso que mantém a rede legível.
- Custo medido: +1,4 MB (17,7 → 19,1 MB), abertura igual (1,3 s), ligar o 3D < 300 ms (testado), giro
  a 55° em 79/73 fps (nacional/perto) contra 84/61 sem relevo.

**Fica em aberto** (não feito, de propósito): **cavar** a grade ao longo dos rios grandes (o risco do
"rio fora do vale" — não apareceu nos prints a esse exagero, então não foi medido), a altitude sob a
câmera no `SomRio`, e o teste em aparelho real (o `celular.test.ts` emulado passa).

## Restrições que valem desde o começo

- **`file://` sem rede.** O relevo vai **embutido** no HTML, como os outros dados (gzip+base64),
  e não é uma camada online opcional como o satélite. Os ladrilhos online (Terrarium/AWS) ficam
  só como possível acréscimo de detalhe fino, depois e opcionais.
- **Peso.** A página tem ~17 MB (ver [`done/peso-do-mapa.md`](done/peso-do-mapa.md)). O orçamento
  do relevo é de **≤ 2 MB** gz+base64; se passar disso, a resolução cai antes de qualquer outra
  coisa.
- **O plano continua plano.** O relevo só existe com o 3D ligado. Com o 3D desligado não há
  custo de GPU nem de memória e nada muda (os testes do modo plano têm que passar intactos).
- **Por software (`POR_SOFTWARE`), sem relevo.** A página já abre plana e corta faixas de vazão
  nesse caso. O botão 3D continua inclinando a câmera, mas sem terreno.

## Fonte do relevo

Candidatas, nesta ordem:

1. **ETOPO 2022** (NOAA, 60″ ≈ 1,8 km, domínio público). Superfície contínua terra+mar, num
   arquivo só, que dá para recortar por OPeNDAP/THREDDS sem baixar o globo inteiro.
2. **GMTED2010** (USGS, 30″, domínio público), mediana por célula. Melhor para terra, mas vem
   em ladrilhos.
3. **Copernicus GLO-90.** Mais nítido, mas pesado de mosaicar e com licença própria. Só entra se
   os dois acima decepcionarem.

A licença tem que caber no MIT do repo (pelo mesmo motivo que travou o satélite em 2016), com o
crédito no rodapé de fontes. Isso precisa ser conferido antes do primeiro byte entrar na página.

O recorte é o `bounds` da página (a extensão inteira da BHO, dos Andes ao Prata), e não a
`moldura`: a rede desenhada passa da fronteira.

O dado bruto vai para o lake (`~/rodado/…/relevo/`), seguindo a convenção, e roda o
`build_metadata_catalog.py`. Este repo só guarda o script que lê e reamostra.

## Etapas

### 0. Spike: a MapLibre 4.7 com terreno e camada `custom` (½ dia, decide o resto)

Antes de qualquer pipeline, montar um HTML de bancada em `notas/spike/` com a MapLibre
embutida, um DEM de mentira (uma gaussiana), `setTerrain` alimentado por `addProtocol` e uma
camada `custom` com algumas linhas. É preciso responder a cinco perguntas, com print:

- Com o terreno ligado, as camadas `fill`/`line`/`raster` (terra, divisas, UFs, satélite)
  ficam drapeadas sozinhas? (Esperado: sim.)
- A camada `custom` recebe a matriz certa, e em que unidade vai o z? (O metro em unidade de
  Mercator é `1 / (circunferência · cos φ)`, e a exageração é multiplicada por cima.)
- A camada `custom` sai enterrada pelo depth buffer do terreno, ou é desenhada por cima de
  tudo? Isso decide se o z é obrigatório só para a posição ou também para não sumir atrás das
  serras.
- O `map.unproject` e o `map.transform.customLayerMatrix()` já levam o terreno em conta? Isso
  decide o que o `paraMundo` precisa refazer.
- O `addProtocol` funciona por `file://` nos três motores (chromium, firefox, webkit)?

**Plano B, se o terreno da biblioteca brigar com a camada própria:** desenhar o terreno
também numa camada `custom` (uma malha em grade, a mesma textura de altitude, sombreamento
no fragment shader) e deixar a MapLibre sem `setTerrain`. Isso perde o drapeamento automático
da terra, das divisas e do satélite, que passariam a ser desenhados por cima da malha. É mais
trabalho, mas o controle fica todo do nosso lado.

### 1. Pipeline: `pipeline/baixa_relevo.py` + `pipeline/relevo.py`

- `baixa_relevo.py` baixa o recorte da fonte para o lake (uma vez).
- `relevo.py` reamostra na grade da página. O ponto de partida é **1/30° (~3,7 km)**: com uma
  margem sobre o `bounds`, dá ~1.400 × 1.300 ≈ 1,8 M de amostras. O peso real é medido em
  dois níveis (1/30° e 1/60°), e escolhe-se o maior que couber no orçamento.
- Codificação: `int16` em metros, oceano e corpos d'água grandes em 0, com delta por linha
  antes do gzip (o relevo é suave, e o delta comprime muito melhor que o valor cru). A saída
  é o `relevo.json`/`.bin` intermediário, gitignored como os outros.
- **Pirâmide:** a biblioteca pede ladrilhos `raster-dem` por z/x/y. O `addProtocol` corta e
  reamostra a grade embutida sob demanda, no navegador, codificados em Terrarium, até o
  `maxzoom` em que a grade ainda tem detalhe (≈ z7 a 1/30°). Acima disso, a biblioteca
  sobreamostra sozinha.
- Conferência impressa pelo script, no padrão do pipeline: as altitudes máximas de pontos
  conhecidos (Pico da Neblina ~2.995 m, Itatiaia ~2.791 m, Chapada Diamantina ~2.000 m,
  Pantanal ~100 m). Com 3,7 km o pico sai achatado. O script imprime o quanto, e isso vira
  nota na página.

### 2. Montagem: marcador `/*__RELEVO__*/`

- `template.html` ganha o marcador, e o `monta_pagina.py` injeta o blob. O blob só é
  descomprimido na primeira vez em que o 3D liga (para não pesar na abertura de ~1,5 s).
- `monta_pagina.py` confere as chaves do `relevo.json` antes de montar. A lição do
  `tendencia_mapa.json` velho vale aqui também (ver CLAUDE.md).

### 3. Terreno na página

- `define3D(true)`: descomprime o relevo (uma vez), registra o protocolo, faz
  `addSource('relevo', {type:'raster-dem', encoding:'terrarium', ...})` e
  `setTerrain({source:'relevo', exaggeration: EXAGERO})`. `define3D(false)`:
  `setTerrain(null)` e remove a fonte.
- **Exageração.** O Brasil é baixo: sem exagero, o planalto inteiro some na inclinação de 50°.
  O ponto de partida é ~12× a zoom nacional, diminuindo quando a câmera se aproxima. Uma
  exageração linear transforma os Andes (6.000 m) numa parede de ~70 km que esconde o oeste da
  Amazônia. Daí a **compressão acima de ~2.000 m** (`h' = 2000 + (h−2000)·0,25`), aplicada
  no pipeline, e não no shader, para que o protocolo e a camada própria vejam o mesmo número.
  Isso vira constante única, `EXAGERO`/`TETO_RELEVO`, no padrão do `ZOOM_MAX`, e vai escrita
  na nota do 3D ("relevo exagerado N×").
- **Sombreamento:** camada `hillshade` sobre a mesma fonte, por baixo do `veu-sat` e da rede,
  com as cores tiradas dos tokens CSS (`--ink`/`--rule`) nos três blocos de tema. É isso que
  faz o relevo ser lido mesmo de cima.

### 4. A rede sobe com o terreno (o grosso do trabalho)

- **Textura de altitude** na camada `rios` e na `pontos`: a mesma grade, já com a compressão
  dos Andes, numa textura `R16F`/`R32F` (ou `RG8` com a altitude codificada, se faltar
  `OES_texture_float_linear` no webkit). Uniformes `uAlt` (sampler), `uAltCaixa` (a extensão
  da grade em coordenada de mundo [0,1]) e `uExag` (o z por metro, já multiplicado pela
  exageração e por `1/cos φ` aproximado no centro da tela).
- `VS_REDE`: `uM * vec4(aA, z(aA), 1.)` no lugar de `vec4(aA, 0., 1.)`, e o mesmo para `aB`.
  O resto do shader (o recorte por `w`, a largura em pixel e a perspectiva por `uRef`) continua
  igual, porque já trabalha depois da projeção.
- **Folga contra o z-fighting:** a grade da rede (11 a 110 m) e a do relevo (3,7 km) não batem,
  e no fundo de vale o rio fica abaixo da superfície interpolada. A rede é desenhada **sem
  teste de profundidade contra o terreno** (é o que torna a rede legível) ou, se o spike
  mostrar que oclusão por serra é desejável, com um deslocamento de alguns metros × exagero.
  A escolha é visual, decidida com print: rio atrás do morro aparecer ou não.
- **Corte por blocos (`FAIXAS` × `GC`):** a caixa de cada bloco ganha a altitude máxima da
  célula, senão um bloco de serra é descartado como fora da tela quando ainda está visível.
- **CPU:** `altEm(wx, wy)`, bilinear na mesma grade. `paraTela(wx, wy)` passa a somar
  `MAT[8]·z` e `MAT[10]·z` (as colunas de z que hoje são ignoradas). `paraMundo(sx, sy)`
  usa o `unproject` da biblioteca, se o spike mostrar que ele já considera o terreno; se não,
  um raymarch curto contra `altEm`.
- **Fluxo animado e anéis de realce** (canvas 2D, reprojetados por `MAT`): todo ponto passa
  por `paraTela` com o z. Os pontos que projetam o fluxo inline, sem chamar `paraTela`, têm
  que ser achados e migrados (`grep MAT\[` no template).
- **Câmera:** com terreno, a biblioteca põe o centro sobre a altitude. Conferir que o
  `prender()` e o `HASH0` (o `#zoom/lat/lon/giro/inclinação` da URL) continuam reabrindo no
  mesmo lugar.

### 5. Tour

- As cenas em 3D (Sobradinho, Pantanal, Tietê até a Argentina...) foram enquadradas sobre o
  plano. Com o relevo, a câmera muda de altura e o enquadramento desloca. Só as **câmeras**
  se reajustam, por print com `window.tour.mostra(i)`; o roteiro e os números ficam (regra do
  `design/tour.md`).
- O som (`SomRio`) pode receber a altitude sob a câmera como mais um parâmetro. É opcional e
  fica fora do escopo mínimo.

### 6. Testes (`testes/vista3d.test.ts`, mantendo o teto de 3 min)

- O 3D ligado cria a fonte `relevo` e o terreno; desligado, os dois somem, e o plano sai igual
  pixel a pixel ao de antes (`TINTA`).
- Com o 3D e o terreno ligados, nenhuma requisição de rede (o teste existente de "não pede
  nada" passa a cobrir o 3D também).
- O rio fica em cima do terreno: numa câmera fixa sobre a Serra do Mar, a contagem de pixel
  azul da rede com o terreno não pode cair mais que X% em relação à vista sem terreno. Esse
  teste flagra a rede enterrada.
- O acerto do cursor em 3D com relevo: clicar no Tietê numa câmera inclinada sobre a serra
  abre a ficha do Tietê.
- `POR_SOFTWARE`/`TESTES_SW=1`: o botão 3D não cria terreno.
- Tempo: a abertura do 3D com o relevo não passa de +300 ms sobre o 3D atual no chromium da
  suíte.

## Riscos e decisões em aberto

- **Resolução versus peso:** 3,7 km achata as serras estreitas (Serra do Mar, Mantiqueira) e
  deixa os vales largos borrados. Se ficar feio de perto, resta o ladrilho online opcional
  como camada de detalhe, que quebra a simetria com o `file://` só para quem estiver online,
  como o satélite.
- **Rio fora do vale:** na grade grossa, o talvegue do relevo não coincide com o traçado da BHO.
  Com exagero alto, o rio "anda na encosta". Mitigação possível: **cavar** a grade ao longo
  dos trechos de maior vazão no `relevo.py` (rebaixar as células cortadas pela rede até o
  mínimo da vizinhança). Medir antes de fazer.
- **Celular:** a textura de altitude + o terreno + 462 mil trechos podem estourar a memória de
  GPU de aparelho fraco. A medida é com o `celular.test.ts` emulado e, se possível, em
  aparelho real. Se estourar, o celular fica com o terreno sem elevar a rede (só o
  sombreamento).
- A camada `custom` da MapLibre 4.x com terreno não é um caminho muito pisado. Se o spike da
  etapa 0 travar, a decisão entre o terreno da biblioteca e a malha própria vem antes de
  tudo.

## Documentação, quando sair

- CLAUDE.md: um item em "Convenções" (o relevo embutido, a `EXAGERO`/`TETO_RELEVO` como fonte
  única, a rede elevada no shader, sem terreno por software) e a nova linha em "Comandos".
- README: o crédito da fonte do relevo, a resolução e a exageração.
- A nota do 3D na página: "relevo exagerado N×, grade de ~3,7 km; picos achatados".
