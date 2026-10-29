# Peso do mapa e tempo da suíte

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
