/* Etapa 0 do tasks/relevo-3d.md: terreno da MapLibre 4.7 + camada custom com z, nos três motores.
 * uso: bun run notas/spike/relevo.ts   (prints em notas/spike/relevo-<motor>-*.png) */
import { chromium, firefox, webkit } from "playwright";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const URL = pathToFileURL(join(import.meta.dir, "relevo.html")).href;
const motores = { chromium: [chromium, ["--use-angle=metal", "--enable-gpu"]], firefox: [firefox, []], webkit: [webkit, []] } as const;

for (const [nome, [tipo, args]] of Object.entries(motores)) {
  const b = await tipo.launch({ args: [...args] });
  try {
    const pg = await (await b.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
    const erros: string[] = [];
    pg.on("pageerror", (e) => erros.push(e.message));
    pg.on("console", (m) => { if (m.type() === "error") erros.push(m.text().slice(0, 200)); });
    await pg.goto(URL);
    await pg.waitForFunction("window.__pronto", null, { timeout: 30000 });
    await pg.waitForFunction("sonda.map.loaded() && sonda.map.areTilesLoaded()", null, { timeout: 30000 }).catch(() => erros.push("ladrilhos não terminaram"));
    await pg.waitForTimeout(800);
    const r1 = await pg.evaluate("sonda.pico()");
    console.log(nome, "pontos", JSON.stringify(await pg.evaluate("sonda.pontos()")));
    const extra = await pg.evaluate("({ pedidos: sonda.pedidos, depth: window.__depthTest })");
    await pg.screenshot({ path: join(import.meta.dir, `relevo-${nome}-terreno.png`) });
    // o mesmo sem z na custom: se as linhas descolam do pico, o z é obrigatório para a posição
    await pg.evaluate("(() => { sonda.custom.comZ = false; sonda.custom.sobe(sonda.map.painter.context.gl); sonda.map.triggerRepaint(); })()");
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: join(import.meta.dir, `relevo-${nome}-semz.png`) });
    console.log(nome, JSON.stringify({ ...r1, ...extra, erros }));
  } finally { await b.close(); }
}
