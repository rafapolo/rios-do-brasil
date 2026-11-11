/* Prints das cenas do tour com o relevo (e, com VELHO=<index.html>, sem ele) para reajustar câmeras.
 * uso: bun run notas/spike/relevo-tour.ts 3 9 10 13   → notas/spike/tour-<i>[-velho].png */
import { chromium } from "playwright";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { INDEX } from "../../testes/comum.ts";
const arq = process.env.VELHO ?? INDEX, suf = process.env.VELHO ? "-velho" : "";
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu"] });
try {
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const erros: string[] = [];
  pg.on("pageerror", (e) => erros.push(e.message));
  await pg.goto(pathToFileURL(arq).href);
  await pg.waitForSelector("#carregando", { state: "detached", timeout: 60000 });
  for (const i of process.argv.slice(2).map(Number)) {
    await pg.evaluate(`window.tour.mostra(${i})`);
    await pg.waitForTimeout(1500);   // o relevo liga quando a câmera para; os ladrilhos vêm depois
    await pg.screenshot({ path: join(import.meta.dir, `tour-${i}${suf}.png`) });
  }
  console.log("erros:", erros);
} finally { await b.close(); }
