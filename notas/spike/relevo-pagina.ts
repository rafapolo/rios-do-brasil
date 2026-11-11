/* Prints do index.html com o relevo ligado. uso: bun run notas/spike/relevo-pagina.ts [motor]
 * Saída: notas/spike/pagina-<motor>-<cena>.png e, por cena, o que o console reclamou. */
import { chromium, firefox, webkit } from "playwright";
import { join } from "node:path";
import { copiaSondada } from "../../testes/comum.ts";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const motor = process.argv[2] ?? "chromium";
/* VELHO=<index.html> roda as mesmas câmeras numa página sem relevo, para comparar */
function sondada(): string {
  if (!process.env.VELHO) return copiaSondada();
  const ancora = "  /* ---------- início ---------- */";
  const sw = copiaSondada(), injetado = readFileSync(new URL(sw), "utf8");
  const bloco = injetado.slice(injetado.indexOf("  window.__testes = "), injetado.indexOf(ancora));
  const destino = join(mkdtempSync(join(tmpdir(), "rios-velho-")), "index.html");
  writeFileSync(destino, readFileSync(process.env.VELHO, "utf8").replace(ancora, bloco + ancora));
  return pathToFileURL(destino).href;
}
const sufixo = process.env.VELHO ? "-velho" : "";
const tipo = { chromium, firefox, webkit }[motor]!;
const CENAS: [string, number, number, number, number, number][] = [
  // nome, lon, lat, zRel, bearing, pitch
  ["brasil", -54, -15, 1, 0, 50],
  ["serra-do-mar", -46.6, -23.9, 14, -20, 60],
  ["andes-pantanal", -62, -17, 3, 70, 60],
  ["sao-francisco", -41.5, -10.5, 6, 20, 55],
];
const b = await tipo.launch({ args: motor === "chromium" ? ["--use-angle=metal", "--enable-gpu"] : [] });
try {
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const erros: string[] = [];
  pg.on("pageerror", (e) => erros.push(e.message));
  pg.on("console", (m) => { if (["error", "warning"].includes(m.type())) erros.push(m.text().slice(0, 300)); });
  await pg.goto(sondada());
  await pg.waitForSelector("#carregando", { state: "detached", timeout: 60000 });
  const t0 = Date.now();
  await pg.evaluate("window.__testes.define3D(true, { animar: false })");
  if (!process.env.VELHO) await pg.waitForFunction("window.__testes.map.getTerrain && window.__testes.map.getTerrain()", null, { timeout: 20000 });
  console.log(motor, "terreno ligado em", Date.now() - t0, "ms");
  for (const [nome, lon, lat, z, br, pi] of CENAS) {
    await pg.evaluate(`(() => { const t = window.__testes; t.camera(${lon}, ${lat}, ${z});
      t.map.jumpTo({ bearing: ${br}, pitch: ${pi} }); })()`);
    await pg.waitForFunction("window.__testes.map.areTilesLoaded()", null, { timeout: 20000 }).catch(() => erros.push("ladrilhos"));
    await pg.waitForTimeout(700);
    await pg.screenshot({ path: join(import.meta.dir, `pagina-${motor}-${nome}${sufixo}.png`) });
    const info = await pg.evaluate("(() => { const m = window.__testes.map; return { elev: Math.round(m.transform.elevation), exag: m.terrain && +m.terrain.exaggeration.toFixed(2), zoom: +m.getZoom().toFixed(2) }; })()");
    console.log(motor, nome, JSON.stringify(info), erros.splice(0).join(" | "));
  }
} finally { await b.close(); }
