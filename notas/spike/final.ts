/* Medição do index.html final, no mesmo molde do base.ts/spike.ts: abertura, memória e fps girando. GPU=1 liga o Metal. */
import { chromium } from "playwright";
import { copiaSondada } from "../../testes/comum";
const b = await chromium.launch({ args: ["--enable-precise-memory-info", "--js-flags=--expose-gc", ...(process.env.GPU ? ["--use-angle=metal", "--enable-gpu"] : [])] });
try {
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  pg.on("pageerror", (e) => console.log("pageerror", e.message));
  const t0 = Date.now();
  await pg.goto(copiaSondada());
  await pg.waitForSelector("#carregando", { state: "detached", timeout: 120000 });
  const abertura = (Date.now() - t0) / 1000;
  await pg.waitForTimeout(1500);
  await pg.evaluate("window.gc && gc()");
  const heap = await pg.evaluate("performance.memory.usedJSHeapSize/1e6");
  const rss = Number((await Bun.$`ps -axo rss=,command= | grep ms-playwright | grep -v grep | awk '{s+=$1} END {print s/1024}'`.text()).trim());
  await pg.evaluate("window.__testes.define3D(true, {animar:false})");
  const fps: any = await pg.evaluate(`(async()=>{
    const t = window.__testes, map = t.map, out = {};
    const z0 = map.getMinZoom() + Math.log2(0.9) * 0;
    for (const [nome, z, lon, lat] of [['brasil', null, -54, -14], ['perto', 3.2, -60.0, -3.14], ['teto', 7.4, -60.0, -3.14]]) {
      map.jumpTo({ center: [lon, lat], zoom: z === null ? map.getMinZoom() + Math.log2(0.9) * 0 + 0.15 : map.getMinZoom() + z, pitch: 55, bearing: 0 });
      await new Promise(r => setTimeout(r, z === null ? 2500 : 3500));
      let n = 0, ang = 0, ft = [], last = performance.now(); const t0 = last;
      await new Promise(res => { (function l(t) { n++; ang += 1.2; map.jumpTo({ bearing: ang }); ft.push(t - last); last = t; if (t - t0 < 4000) requestAnimationFrame(l); else res(); })(t0); });
      ft.sort((a, b) => a - b);
      out[nome] = { fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1), p95_ms: +ft[Math.floor(ft.length * 0.95)].toFixed(1) };
    }
    return out;
  })()`);
  const gl = await pg.evaluate(`(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');const e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})()`);
  console.log(JSON.stringify({ abertura_s: abertura, heap_mb: Math.round(heap), rss_total_mb: Math.round(rss), fps, gl }));
} finally { await b.close(); }
