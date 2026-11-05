/* Prints e vídeos curtos da migração. uso: bun run notas/spike/prints.ts <pasta> */
import { chromium, webkit, devices } from "playwright";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, renameSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const saida = process.argv[2];
const url = pathToFileURL(join(import.meta.dir, "../../index.html")).href;
const args = ["--use-angle=metal", "--enable-gpu"];
const espera = (pg: any) => pg.waitForSelector("#carregando", { state: "detached", timeout: 60000 }).then(() => pg.waitForTimeout(1500));

const b = await chromium.launch({ args });
try {
  const vid = mkdtempSync(join(tmpdir(), "vid-"));
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: vid, size: { width: 960, height: 600 } } });
  const pg = await ctx.newPage();
  await pg.goto(url); await espera(pg);
  await pg.screenshot({ path: join(saida, "ml-01-brasil-plano.png") });
  // Amazônia inclinada e girada: o 3D liga pelo interruptor, o resto pela câmera
  await pg.click("#bt3d"); await pg.waitForTimeout(1200);
  await pg.evaluate(`(() => { const m = document.querySelector('#cv').__m; })()`).catch(() => {});
  await pg.goto(url + "?3d=1#6.4/-3.4/-60/35/58"); await espera(pg);
  await pg.screenshot({ path: join(saida, "ml-02-amazonia-3d.png") });
  // vídeo: o leitor gira com o botão direito
  await pg.mouse.move(640, 420); await pg.mouse.down({ button: "right" });
  for (let i = 0; i < 90; i++) { await pg.mouse.move(640 + i * 3, 420 - Math.sin(i / 14) * 40); await pg.waitForTimeout(25); }
  await pg.mouse.up({ button: "right" });
  await pg.waitForTimeout(600);
  // de perto, inclinado, com fluxo
  await pg.goto(url + "?3d=1#10.6/-3.14/-60.0/25/58"); await espera(pg);
  await pg.click("#btFluxo"); await pg.waitForTimeout(2500);
  await pg.screenshot({ path: join(saida, "ml-03-perto-fluxo.png") });
  await pg.waitForTimeout(2500);
  // outorga com ficha, inclinado
  await pg.goto(url + "?mapa=outorga&3d=1#7.6/-12.0/-45.0/20/55"); await espera(pg);
  await pg.mouse.click(660, 480); await pg.waitForTimeout(800);
  await pg.screenshot({ path: join(saida, "ml-04-outorga-ficha.png") });
  await ctx.close();
  for (const f of readdirSync(vid)) renameSync(join(vid, f), join(saida, "ml-gira-e-fluxo.webm"));
} finally { await b.close(); }

const w = await webkit.launch();
try {
  const ctx = await w.newContext({ ...devices["iPhone 13"] });
  const pg = await ctx.newPage();
  await pg.goto(url); await espera(pg);
  await pg.screenshot({ path: join(saida, "ml-05-iphone13-plano.png") });
  await pg.tap('#barraBaixo [data-painel="camadas"]'); await pg.waitForTimeout(500);
  await pg.screenshot({ path: join(saida, "ml-06-iphone13-camadas.png") });
  await pg.tap("#bt3d"); await pg.waitForTimeout(1500);
  await pg.tap('#barraBaixo [data-painel="camadas"]'); await pg.waitForTimeout(600);
  await pg.screenshot({ path: join(saida, "ml-07-iphone13-3d.png") });
  await ctx.close();
} finally { await w.close(); }
