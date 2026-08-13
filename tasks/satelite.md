# Camada de satélite (Sentinel-2 cloudless)

> **Estado: implementado e validado.** O roteiro abaixo está todo escrito em
> `pipeline/template.html` e `index.html` (as mesmas edições nos dois), e a suíte fecha.
> O que travava está resolvido — ver [O que travava a entrega](#o-que-travava-a-entrega).

## Conferido (13/08/2026, chromium headless, por `file://`)

- **Com a camada desligada, a página faz 0 requisições de rede.** Medido com o `page.on('request')`
  filtrando o que não é `file:`. O requisito de abrir offline continua de pé.
- Ligar pede ladrilho de verdade: 35 na vista nacional em 1280×860 com `dpr` 1.
- **O `z` pedido bate com a conta do plano.** Vista nacional com `dpr` 2 → z6. No fim do trave de
  zoom (`kBase()*40`) → z11, com 622 ladrilhos numa varredura de 40 passos. **O teto z14 do
  Sentinel-2 nunca é alcançado**, que era a aposta que justificou escolher a fonte aberta em vez
  da Esri.
- Interruptor, `aria-pressed`, crédito que aparece e some junto com a camada, canvas que muda:
  todos ok. Nenhum erro de JS no console em nenhum momento.
- A rede azul continua legível sobre a imagem com o véu em 0,38 — conferido em tela nacional e
  com zoom, **nos dois temas**, sobre ladrilho de verdade no Solimões (mata fechada em z≈11, que
  é o pior caso da rampa). No escuro, onde `--terra` é `#141a1e`, o véu escurece a mata o
  bastante para a capilaridade fina aparecer com folga. **O tema claro é o mais apertado dos
  dois**: ali o pé da rampa é quase branco e a mata velada fica cinza-esverdeada de meio-tom, e
  o córrego de cabeceira se lê, mas por pouco. Se um dia alguém mexer no alfa, é o claro que
  decide o limite, não o escuro.
- `bun test testes/estrutura.test.ts`: **19 passam, 0 falham**. É o arquivo que compara template
  contra artefato, então o par de edições não divergiu. O `btSat` e o `let mostrarSat = false`
  entraram na lista que ele confere, senão a camada podia divergir entre os dois arquivos ou
  nascer ligada sem nada reclamar.

## O que travava a entrega

**Era uma asserção só, e a lentidão era da máquina.** A rodada de 799 s com 28 falhas foi feita
enquanto os navegadores da rodada anterior — cortada por timeout, sem deixar o `afterAll` chamar
`fecharTudo()` — ainda estavam vivos disputando a máquina. Com a máquina limpa, o mesmo
`mapa.test.ts` sem nenhuma correção fechou em **174,9 s, 47 passam e 1 falha**: exatamente o
tempo de antes da camada. Fica a regra: **rodada cortada na mão deixa navegador solto, e a
rodada seguinte não vale como medida** — conferir `ps` antes de acreditar num tempo.

A falha real, única, era boba: `as quatro nascem desligadas` exigia
`/^\(\d[\d.]*\)$/` de **todo** `#hud button.chave b`, e o `<b>` do satélite traz `2016`, que é o
ano do mosaico e não um contador. O teste agora pede o contador das camadas que contam e checa
o ano à parte.

A pista da suíte segurando ladrilho em voo **não era a causa** — nenhum teste ligava a camada —,
mas apontava para um defeito de verdade no produto, que foi corrigido junto:

- **Desligar não cancelava nada.** Os ladrilhos que a última vista pediu seguiam baixando, e
  cada um que chegava disparava `pedeRepinteSat()` → repinte dos 462 mil trechos com a camada
  já desligada. Agora o `onload` só repinta se `mostrarSat`, e `paraSatelite()` corta o que está
  em voo (`img.src = ''`, ouvintes soltos, chave fora do `satCache`) quando o interruptor cai.

O teste do item 6 do roteiro está em `testes/mapa.test.ts`, na `describe("camadas")`, e serve o
ladrilho localmente com `page.route` — não depende do serviço da EOX estar no ar e não gasta um
byte de internet. Ele cobre quatro coisas: desligada a página não pede nada à rede nem ao mexer
no mapa; ligada pede ladrilho, pinta o canvas e acende o crédito; a URL segue o padrão do WMTS;
e a ordem `{z}/{y}/{x}` está certa — quem denuncia a troca é a latitude, porque lido como
`{x}/{y}` o mesmo pedido aterrissa acima do paralelo 30 norte.

**Objetivo.** O mapa desenha o rio como traço sobre chapado de cor. Não há como o leitor
confrontar o que a página afirma com o chão: o reservatório que encolheu, o pivô de irrigação
encostado no trecho que o modo Tendência pinta de laranja, o leito que virou banco de areia.
Uma base de imagem por baixo da rede resolve isso sem nenhum dado novo no blob — **a projeção
da página já é a dos ladrilhos**, e é essa coincidência que torna a camada barata.

## Fonte

```
https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg
```

Mosaico sem nuvem do Sentinel-2, feito pela EOX a partir do Copernicus/ESA. Sem chave, sem
conta. **É a camada sem sufixo de ano, e ela é a de 2016 — a única sob CC BY 4.0.**

**A escolha do ano é a licença, não a estética.** O `WMTSCapabilities.xml` declara camada por
camada (lido em 13/08/2026):

| Camada | Ano | Licença |
|---|---|---|
| `s2cloudless_3857` | 2016 | **CC BY 4.0** |
| `s2cloudless-2017_3857` … `-2025_3857` | 2017–2025 | **CC BY-NC-SA 4.0** |

Os anos recentes são **não comercial + ShareAlike**, e o ShareAlike é o que impede: o
`README.md` publica este repo **sob MIT**, e derivada de BY-NC-SA tem que sair sob BY-NC-SA.
O passo 3 do roteiro literalmente modifica a imagem (véu por cima) e funde tudo num canvas só
— é adaptação, não coletânea, então não dá para argumentar que a SA não pega. Usar 2025 obriga
a relicenciar a página inteira e mata o "código sob MIT". **2016 não tem nem NC nem SA e resolve
os dois de uma vez.**

Crédito obrigatório, na forma que o próprio serviço declara:

> Imagem: EOxCloudless (cloudless.eox.at) por EOX IT Services GmbH — contém dados Copernicus
> Sentinel modificados de 2016, sob CC BY 4.0

### Por que não as outras

| Fonte | Por que fica fora |
|---|---|
| CARTO (`basemaps.cartocdn.com`) | **não tem imagem nenhuma.** Positron, Dark Matter e Voyager são estilos cartográficos de OSM. É o que o `../swissviz` usa, e não serve aqui |
| Esri World Imagery | funciona sem chave (HTTP 200 medido) e chega a z19, mas é ToS da ArcGIS Online, revogável — não é licença aberta. **É o plano B**: não impõe NC nem SA, então não contamina o MIT, e é o caminho se o de 2016 for velho demais |
| Mapbox / MapTiler / Bing | exigem token, que ficaria em texto puro num arquivo que qualquer um abre |
| NASA GIBS | domínio público, mas 250 m de resolução: inútil para leito de rio |

## Armadilhas medidas (13/08/2026)

- **A coordenada de mundo da página já é a do ladrilho.** `projX`/`merc`
  (`template.html:945`) devolvem Mercator normalizado em `[0,1]²`, que é exatamente o espaço
  XYZ; o ladrilho `(z,x,y)` ocupa `[x/2^z,(x+1)/2^z] × [y/2^z,(y+1)/2^z]`. Não há reprojeção, e
  `paraTela` já é `w*k + deslocamento`. Sem essa coincidência a camada exigiria MapLibre e a
  reescrita do renderizador inteiro.
- **`{z}/{y}/{x}` — `y` antes de `x`**, ao contrário do padrão `{z}/{x}/{y}` do CARTO. Inverter
  devolve 200 com a imagem errada, não erro.
- **CORS funciona a partir de `file://`.** O servidor reflete a origem: com `Origin: null` (que é
  o que `file://` manda) responde `access-control-allow-origin: null`, que casa; sem `Origin`
  responde `*`. Medido com `curl -D`. Além disso **não há um único `getImageData`/`toDataURL` no
  template** — só o `drawImage` da linha 1875 —, então contaminar o canvas não quebra nada e o
  `crossOrigin` é precaução, não requisito.
- **O teto útil é z13–14, não o que o servidor entrega.** O Sentinel-2 é de 10 m, ~z14 no
  equador. z15 e z16 respondem 200, mas a imagem é interpolada — conferido a olho sobre Manaus:
  z12 sai nítido, z16 sai borrado, sem detalhe novo. Travar o `z` em 14.
- **O trave de zoom da página já limita mais que a fonte.** `vista.k` é preso em `kBase()*40`
  (`template.html:2322`), o que dá z≈11 (~60 m/px). Ou seja o teto do Sentinel-2 **sobra** no
  alcance atual — nada se perde por usar a fonte aberta em vez da Esri. Se um dia o trave subir
  (80–200×), aí sim z14 vira o limite, e junto vêm o `corteZoom` e a camada de fluxo, que não
  foram calibrados para essa faixa.
- **O peso não é desprezível.** Média de **8,3 kB por ladrilho** em z7 sobre o Brasil (20
  ladrilhos amostrados); a tela nacional pega ~132 ladrilhos, ou **~1 MB**. `cache-control:
  max-age=604800` (7 dias) ajuda na revisita, não na primeira. Motivo a mais para a camada
  nascer desligada.
- **`file://` deixa de se bastar** — e isso é requisito escrito no CLAUDE.md, não conveniência.
  A camada tem que ser opcional, desligada por padrão, e cair calada para a base vetorial quando
  o ladrilho não vier (bandeira `img.ruim` no `onerror`). É também o que mantém os testes verdes:
  a suíte abre por `file://` e nunca vai carregar ladrilho.
- **A rampa azul morre sobre a imagem.** O desenho inteiro é sequencial azul sobre chapado; sobre
  água e mata escura o pé da rampa (`--ramp-0..2`) some. Precisa de véu translúcido de
  `COR_TERRA` por cima dos ladrilhos, e o `fill` de `terra` tem que ser **pulado** quando a
  camada está ligada — senão ele tapa a imagem que acabou de ser desenhada.
- **Emenda entre ladrilhos.** Em escala fracionária o `drawImage` deixa fio de 1 px. Arredondar
  as **duas** bordas e usar a diferença como largura, nunca arredondar a largura.
- **É composto anual, não uma data — e o ano é 2016.** A lâmina d'água é mediana do ano. Num
  mapa cujo assunto é vazão e seca, alguém vai ler a largura do rio na imagem como se fosse
  medição, e ainda por cima numa imagem uma década mais velha que o resto da página. A nota do
  modo precisa dizer as duas coisas: que a imagem é composto de **2016** e que o número é a
  vazão — mesmo espírito da nota do `tch_ds == 'Poço'` na camada de outorga. A defasagem é
  aceitável para leito de rio, que quase não mudou; **não** é aceitável para desmatamento,
  lavoura ou barragem nova, e ninguém deve poder concluir isso da imagem.
- **A qualidade de 2016 não é o problema.** Conferido a olho sobre Manaus em z12: o mosaico de
  2016 sai tão nítido quanto o de 2025, mesma faixa de peso (8,9 kB em z7, 23,7 kB em z12) e
  serve até z14 igual. O custo de escolher a licença limpa é a data, não a imagem.

## Roteiro

1. Cache de ladrilhos (`Map` de `"z/x/y"` → `Image`, teto ~500 com descarte do mais antigo).
   No `onload`, `estaticoSujo = true; agendar()`; no `onerror`, marcar `img.ruim`.
2. `desenhaSatelite()` no topo do `desenharEstatico()` (`template.html:1599`), pintando em
   `octx` **antes** do `fill` de `terra`. Assim a camada pega carona no composto que o
   `desenhar()` já faz com `drawImage(off, …)`, inclusive durante a animação de fluxo.

   ```js
   const z = Math.max(0, Math.min(14, Math.round(Math.log2(vista.k * dpr / 256))));
   const n = 2 ** z, lado = vista.k / n;
   const [w0x, w0y] = paraMundo(0, 0), [w1x, w1y] = paraMundo(W, H);
   for (let x = Math.floor(w0x * n); x <= Math.floor(w1x * n); x++)
     for (let y = Math.max(0, Math.floor(w0y * n)); y <= Math.min(n - 1, Math.floor(w1y * n)); y++) {
       const img = tile(z, ((x % n) + n) % n, y);
       if (!img.complete || img.ruim || !img.naturalWidth) continue;
       const px = Math.round(x * lado + vista.x), py = Math.round(y * lado + vista.y);
       octx.drawImage(img, px, py,
         Math.round((x + 1) * lado + vista.x) - px,
         Math.round((y + 1) * lado + vista.y) - py);
     }
   ```
3. Véu e desvio do chapado, ainda no `desenharEstatico()`:
   ```js
   if (satelite) { desenhaSatelite();
     octx.fillStyle = COR_TERRA; octx.globalAlpha = .38;
     octx.fillRect(0, 0, W, H); octx.globalAlpha = 1; }
   else { /* o fill de `terra` que já existe */ }
   ```
   Calibrar o alfa contra o pé da rampa nos dois temas, não só no escuro.
4. Interruptor no cartão **Camadas**, junto de Estações/Reservatórios/ETEs, desligado por
   padrão. Crédito da EOX aparece com a camada ligada e entra também no "Sobre os dados".
5. Aplicar em `pipeline/template.html` **e** no `index.html` — o artefato não se regenera sem o
   `rede_vazao.json`, então edição só no template some do produto e edição só no produto some no
   próximo build (CLAUDE.md, "Como uma página é montada").
6. Teste novo em `testes/mapa.test.ts` que garanta o padrão: com a camada desligada nada de rede
   é pedido, e a página abre por `file://` como sempre.

## Extensão que o dado permitiria — e o que ela custa

Tecnicamente, um seletor de ano é a troca de uma string na URL: comparar o Sobradinho de 2017
com o de 2025 seria instrumento independente da régua, como o MapBiomas citado no
[README](README.md), e cai exatamente no assunto da página. **Mas todo ano de 2017 em diante é
BY-NC-SA**, então o seletor traz de volta o problema de licença que a escolha de 2016 resolve.

Dois caminhos honestos, nenhum deles "usar assim mesmo":

1. **Pedir autorização à EOX** (`cloudless@eox.at`). A página deles convida ao contato e lista
   "Sustainability & Environmental Protection" e "Research & Education" entre os usos — um mapa
   público e gratuito dos rios do Brasil é o caso-tipo. Uma isenção por escrito destrava a série
   inteira.
2. **Relicenciar a página** sob BY-NC-SA, o que contraria o MIT do `README.md:208` e o espírito
   de "os dados são públicos, cite as fontes". Só se for decisão consciente do dono do repo.

Enquanto nenhum dos dois acontecer, a camada fica em 2016 e o seletor de ano não entra.
