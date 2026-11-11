/* fps girando com o 3D ligado, com e sem relevo; e o tempo de abrir o index.html.
 * uso: bun run notas/spike/relevo-fps.ts */
import { chromium } from "playwright";
import { copiaSondada } from "../../testes/comum.ts";
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu"] });
try {
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const t0 = Date.now();
  await pg.goto(copiaSondada());
  await pg.waitForSelector("#carregando", { state: "detached", timeout: 60000 });
  console.log("abrir até o véu sair:", (Date.now() - t0) / 1000, "s");
  await pg.evaluate("window.__testes.define3D(true, { animar: false })");
  await pg.waitForFunction("window.__testes.relevo().ativo");
  const gira = (onde: string) => pg.evaluate(`new Promise(ok => { const t = window.__testes, m = t.map;
    ${onde}
    setTimeout(() => { let n = 0; const t0 = performance.now();
      const passo = () => { m.jumpTo({ bearing: m.getBearing() + 1.2 }); n++;
        if (performance.now() - t0 < 3000) requestAnimationFrame(passo); else ok(+(n / 3).toFixed(0)); };
      requestAnimationFrame(passo); }, 1500); })`);
  const lugares = {
    brasil: "m.jumpTo({ center: [-54, -15], zoom: m.getMinZoom() + 0.15, pitch: 55 });",
    perto: "m.jumpTo({ center: [-46.4, -23.6], zoom: m.getMinZoom() + 5, pitch: 55 });",
  };
  for (const [nome, onde] of Object.entries(lugares)) {
    const com = await gira(onde);
    await pg.evaluate("window.__testes.desligaRelevo()");
    const sem = await gira(onde);
    await pg.evaluate("window.__testes.ligaRelevo()");
    await pg.waitForFunction("window.__testes.relevo().ativo");
    console.log(nome, "fps com relevo", com, "· sem", sem);
  }
} finally { await b.close(); }
