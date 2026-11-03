# Peso do mapa e tempo da suíte

> **Estado: feito (03/11/2026).** Ver "Resultado" no fim.

**Problema.** O modo "Rio livre" (29/10/2026) levou o `index.html` de 14,6 para **17,4 MB**:
`livre` (576 kB gz), `barJus` (472 kB gz), `barMont` (96 kB gz) no `rede_vazao.json` e mais
404 kB gz do `barragens.json`. Abrir a página ficou mais lento, e o `testes/mapa.test.ts`
completo **passou de 3 minutos** — a rodada cortada em 178 s derrubou os 7 testes de busca de
rio, que passam isolados (`-t 'busca de rio'`, 28 s). O teto de 3 min por rodada é regra.

## Opções medidas

| Ideia | Ganho (gz) | Custo |
|---|---:|---|
| `barJus` em degraus de 5 km | ~100 kB | a ficha diz "a ~35 km" em vez de "a 33 km" |
| `livre` como id de pedaço ordenado por tamanho + tabela de km | ~100 kB | um campo e uma indireção a mais no JS |
| tirar `barJus` da ficha | 472 kB | perde "primeira barragem rio abaixo" |

## A fazer

1. Escolher uma (ou nenhuma) das linhas acima.
2. Fazer a suíte do mapa caber em 3 min de novo: separar `mapa.test.ts` em dois arquivos
   (os testes de busca já são um `describe` próprio) ou reaproveitar mais a página aberta.
3. Atualizar "Como a página cabe em 17 MB" no README com o número que ficar.

## Resultado (03/11/2026)

Escolhidas as duas primeiras linhas da tabela.

| | Antes | Depois |
|---|---:|---:|
| `index.html` | 17.433.585 B | 17.190.093 B (−243 kB, −1,4%) |
| `livre` no blob (gz) | 579 kB | 501 kB (id do pedaço + tabela `livreKm`, **sem perda**) |
| `barJus` no blob (gz) | 472 kB | 366 kB (degraus de 5 km, erro máximo 2 km) |
| `mapa.test.ts` | 187 s (178 s no corte do usuário) | 86 s |
| `bun test` completo, em série | 314 s | 156 s |
| `bun run test` (paralelo, 3 processos) | — | 86 s |

- **Peso.** `livre` virou o número do pedaço de rede de cada trecho (ordenado por tamanho
  decrescente) mais uma tabela de km (com o sinal de "cortado") — conferido contra o valor
  antigo, trecho a trecho: idêntico. `barJus` é arredondado a 5 km; os `-1` ("nenhuma até a
  foz") são os mesmos e a ficha diz "a cerca de 35 km" (e "a menos de 3 km" no zero). A
  informação "primeira barragem rio abaixo" fica. Outras codificações de `livre` testadas e
  piores: ordem de aparição do pedaço (548 kB), delta dela (692 kB).
- **Tempo.** O grosso não era a busca de rio (28 s): eram os testes de `?mapa=` do arquivo
  `mapa.test.ts`, que abriam 9 páginas novas com espera fixa de 9 s e nunca as fechavam
  (65 s num teste só). `abrir()` agora espera o véu `#carregando` sair (+1,5 s de folga) e
  essas páginas são fechadas. A busca de rio foi para `busca.test.ts`, e `bun run test`
  (`testes/roda.ts`) roda um processo por arquivo, 3 por vez.
- Um teste novo cobre a ficha do trecho com os degraus e a tabela de pedaços.
- **Ainda dá para tirar**: `barJus` 472 kB inteiro (perde "primeira barragem") ou degraus de
  10 km (mais ~40 kB). Não feito.
