import { chromium } from "playwright";
import { copiaSondada } from "../../testes/comum";
const b = await chromium.launch({ args: process.env.GPU ? ["--use-angle=metal", "--enable-gpu"] : [] });
const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await pg.goto(copiaSondada());
await pg.waitForSelector("#carregando", { state: "detached", timeout: 120000 });
const r = await pg.evaluate(`(async () => {
  const map = window.__testes.map;
  const medida = async (nome) => {
    let ts = []; 
    for (let k = 0; k < 3; k++) { map.jumpTo({ bearing: k * 5 }); const t = performance.now(); await new Promise(res => map.once('render', res)); await new Promise(res => requestAnimationFrame(res)); ts.push(Math.round(performance.now() - t)); }
    return nome + ': ' + ts.join(',');
  };
  const out = [];
  map.jumpTo({ center: [-60, -3.14], zoom: map.getMinZoom() + 3.2, pitch: 0 });
  await new Promise(r => setTimeout(r, 3000));
  out.push(await medida('tudo'));
  map.removeLayer('rios'); out.push(await medida('sem rios'));
  map.removeLayer('pontos'); out.push(await medida('sem pontos'));
  for (const l of ['ufs','divisas','terra']) { map.removeLayer(l); out.push(await medida('sem ' + l)); }
  return out;
})()`);
console.log(r);
await b.close();
