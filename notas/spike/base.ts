/* Linha de base: o index.html atual (Canvas 2D). Mede abertura, heap e quadros ao arrastar. */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const arquivo = process.argv[2] ?? join(import.meta.dir, "../../index.html");
const b = await chromium.launch({ args: ["--enable-precise-memory-info", "--js-flags=--expose-gc", ...(process.env.GPU ? ["--use-angle=metal", "--enable-gpu"] : [])] });
try {
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const t0 = Date.now();
  await pg.goto(pathToFileURL(arquivo).href);
  await pg.waitForSelector("#carregando", { state: "detached", timeout: 60000 });
  const abertura = (Date.now() - t0) / 1000;
  await pg.waitForTimeout(1500);
  await pg.evaluate("window.gc && gc()");
  const heap = await pg.evaluate("performance.memory.usedJSHeapSize/1e6");
  const rss = Number((await Bun.$`ps -axo rss=,command= | grep ms-playwright | grep -v grep | awk '{s+=$1} END {print s/1024}'`.text()).trim());
  const gl = await pg.evaluate(`(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2')||c.getContext('webgl');if(!g)return 'sem webgl';const e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'?'})()`);
  // fps ao arrastar: 4 s de movimento do mouse em círculo, contando rAF
  await pg.evaluate(`window.__q=0; (function l(){window.__q++; requestAnimationFrame(l)})()`);
  const ini = Date.now();
  await pg.mouse.move(640, 400); await pg.mouse.down();
  for (let i = 0; i < 120; i++) { await pg.mouse.move(640 + 200 * Math.cos(i / 10), 400 + 150 * Math.sin(i / 10)); await pg.waitForTimeout(16); }
  await pg.mouse.up();
  const q = await pg.evaluate("window.__q"); const dt = (Date.now() - ini) / 1000;
  console.log(JSON.stringify({ arquivo, abertura_s: abertura, heap_mb: Math.round(heap), rss_total_mb: Math.round(rss), gl, fps_arrasto: +(q / dt).toFixed(1) }));
} finally { await b.close(); }
