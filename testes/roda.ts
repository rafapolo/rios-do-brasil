/* Roda cada arquivo de teste num processo próprio, alguns ao mesmo tempo.
 *
 * `bun test` executa os arquivos em fila, e a suíte soma ~5 min — acima do teto de
 * 3 min por rodada. Cada arquivo abre a própria página e o Playwright é quem
 * espera (renderização, rede), então processos em paralelo ganham quase de
 * graça. `bun test` puro continua valendo e roda tudo em série.
 *
 *   bun run testes/roda.ts            # todos
 *   bun run testes/roda.ts busca      # só os que contêm "busca" no nome */
import { readdirSync } from "node:fs";
import { join } from "node:path";

const PARALELO = Number(process.env.TESTES_PARALELO ?? 3);
const filtro = process.argv.slice(2);
const arquivos = readdirSync(import.meta.dir)
  .filter((f) => f.endsWith(".test.ts") && (!filtro.length || filtro.some((x) => f.includes(x))))
  // os lentos primeiro: o último a começar não pode ser o que mais demora
  .sort((a, b) => PESO(b) - PESO(a));

function PESO(f: string) {
  return f.startsWith("mapa") || f.startsWith("tour") ? 3 : f.startsWith("navegadores") ? 2 : f.startsWith("celular") ? 1 : 0;
}

const t0 = Date.now();
let falhas = 0;
const fila = [...arquivos];

async function trabalha() {
  for (let f = fila.shift(); f; f = fila.shift()) {
    const ini = Date.now();
    const p = Bun.spawn(["bun", "test", join(import.meta.dir, f)], { stdout: "pipe", stderr: "pipe" });
    const [saida, erro] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const cod = await p.exited;
    const resumo = (saida + erro).split("\n").filter((l) => /^\s*\d+ (pass|fail)|^Ran /.test(l)).join(" | ");
    console.log(`${cod === 0 ? "ok  " : "FALHOU"} ${f} (${((Date.now() - ini) / 1000).toFixed(0)} s) ${resumo}`);
    if (cod !== 0) { falhas++; console.log(saida + erro); }
  }
}

await Promise.all(Array.from({ length: PARALELO }, trabalha));
console.log(`${arquivos.length} arquivos em ${((Date.now() - t0) / 1000).toFixed(0)} s, ${falhas} com falha`);
process.exit(falhas ? 1 : 0);
