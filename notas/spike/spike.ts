/* Spike de desempenho: 462 mil trechos no MapLibre. Duas abordagens, medidas no chromium embutido.
 *   A = camada `line` sobre fonte GeoJSON montada dos buffers decodificados
 *   B = custom layer WebGL próprio (um quad por segmento, instanciado)
 * uso: bun run notas/spike/spike.ts A|B */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const modo = process.argv[2] ?? "A";
const raiz = join(import.meta.dir, "../..");
const ml = readFileSync(process.env.ML_JS ?? "/private/tmp/claude-501/ml-pkg/node_modules/maplibre-gl/dist/maplibre-gl.js", "utf8");
const css = readFileSync(process.env.ML_JS?.replace(/\.js$/, ".css") ?? "/private/tmp/claude-501/ml-pkg/node_modules/maplibre-gl/dist/maplibre-gl.css", "utf8");
const ancora = "  /* ---------- início ---------- */";
let html = readFileSync(join(raiz, "index.html"), "utf8");
html = html.replace(ancora, () => "  window.__buf = { coords, inicio, q, areas, N };\n" + ancora);
html = html.replace("<title>", () => `<style>${css}</style><script>${ml}</script><title>`);
const dir = mkdtempSync(join(tmpdir(), "spk-"));
writeFileSync(join(dir, "index.html"), html);

const spikeA = readFileSync(join(import.meta.dir, "spikeA.js"), "utf8");
const spikeB = readFileSync(join(import.meta.dir, "spikeB.js"), "utf8");

const b = await chromium.launch({ args: ["--enable-precise-memory-info", "--js-flags=--expose-gc", ...(process.env.GPU ? ["--use-angle=metal", "--enable-gpu"] : [])] });
try {
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  pg.on("pageerror", (e) => console.log("pageerror", e.message));
  pg.on("console", (m) => { if (m.type() === "error" || m.text().startsWith("SPK")) console.log(m.text()); });
  await pg.goto(pathToFileURL(join(dir, "index.html")).href);
  await pg.waitForFunction("window.__buf", null, { timeout: 60000 });
  await pg.waitForSelector("#carregando", { state: "detached", timeout: 60000 });
  const heap0 = await pg.evaluate("performance.memory.usedJSHeapSize/1e6");
  await pg.evaluate(`document.body.insertAdjacentHTML('beforeend','<div id="ml" style="position:fixed;inset:0;z-index:99"></div>')`);
  const t0 = Date.now();
  const r: any = await pg.evaluate(`(async()=>{${modo === "A" ? spikeA : spikeB}})()`);
  const primeiro = (Date.now() - t0) / 1000;
  await pg.waitForTimeout(1500);
  await pg.evaluate("window.gc && gc()");
  const heap1 = await pg.evaluate("performance.memory.usedJSHeapSize/1e6");
  const rss = Number((await Bun.$`ps -axo rss=,command= | grep ms-playwright | grep -v grep | awk '{s+=$1} END {print s/1024}'`.text()).trim());
  // fps: 4 s girando e inclinando via API (jumpTo a cada rAF) — mede o custo real de render
  const fps: any = await pg.evaluate(`(async()=>{
    const map = window.__map;
    const casos = {};
    for (const [nome, z, lon, lat] of [['brasil',null,null,null],['perto',9,-60.0,-3.14]]) {
      if (z) map.jumpTo({zoom:z, center:[lon,lat]}); else map.jumpTo({zoom:map.__z0, center:map.__c0, pitch:0, bearing:0});
      await new Promise(r=>setTimeout(r,2500));
      let n=0, t0=performance.now(), ang=0, ft=[];
      let last=t0;
      await new Promise(res=>{ (function l(t){ n++; ang+=1.2; map.jumpTo({bearing: ang, pitch: 55}); ft.push(t-last); last=t; if(t-t0<4000) requestAnimationFrame(l); else res(); })(t0) });
      ft.sort((a,b)=>a-b);
      casos[nome] = { fps: +(n/((performance.now()-t0)/1000)).toFixed(1), p95_ms: +ft[Math.floor(ft.length*0.95)].toFixed(1) };
    }
    return casos;
  })()`);
  const gl = await pg.evaluate(`(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');const e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})()`);
  console.log(JSON.stringify({ modo, primeiro_quadro_s: primeiro, ...r, heap_antes_mb: Math.round(heap0), heap_depois_mb: Math.round(heap1), rss_total_mb: Math.round(rss), fps, gl }));
  await pg.screenshot({ path: process.env.SHOT ?? "/tmp/spk.png" });
} finally { await b.close(); }
