/* A vista 3D: inclinar e girar são uma camada que se liga a pedido. Desligada, o
 * mapa é o de sempre — plano, norte para cima, sem gesto que incline por acidente;
 * ligada, a câmera sobe a ~50° e os gestos voltam. A URL guarda o estado. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import type { Page } from "playwright";
import { LENTO, INDEX, TINTA, abrir, copiaSondada, fecharTudo, roda, servidor, urlDe } from "./comum";

let base: string, parar: () => void;
beforeAll(() => { ({ base, parar } = servidor()); });
afterAll(async () => { parar(); await fecharTudo(); });

const estado = (p: Page) => roda<any>(p, `() => {
  const m = window.__testes.map;
  return { pitch: Math.round(m.getPitch()), bearing: Math.round(m.getBearing()) + 0,
    giro: m.dragRotate.isEnabled(), inclina: m.touchPitch.isEnabled(), rotaToque: !m.touchZoomRotate._rotationDisabled,
    pressed: document.getElementById('bt3d').getAttribute('aria-pressed'),
    norteOculto: document.getElementById('btNorte').hidden, url: location.search + location.hash };
}`);

describe("vista 3D", () => {
  test("abre plana, com o norte para cima e os gestos de giro desativados", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    const e = await estado(pg);
    expect(e).toMatchObject({ pitch: 0, bearing: 0, giro: false, inclina: false, pressed: "false", norteOculto: true });
    expect(e.rotaToque, "o giro por toque devia estar desativado").toBe(false);
    expect(e.url).toBe("");
    await pg.context().close();
  }, LENTO);

  test("ligar inclina e habilita os gestos; o botão do norte volta o giro; desligar volta ao plano", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    await pg.click("#bt3d");
    await pg.waitForTimeout(1300);
    let e = await estado(pg);
    expect(e.pitch).toBeGreaterThanOrEqual(45);
    expect(e).toMatchObject({ giro: true, inclina: true, pressed: "true", norteOculto: false });
    expect(e.rotaToque).toBe(true);
    expect(await roda<number>(pg, TINTA), "a vista inclinada não desenhou a rede").toBeGreaterThan(20);

    await roda(pg, `() => window.__testes.map.jumpTo({ bearing: 70 })`);
    expect((await estado(pg)).bearing).toBe(70);
    await pg.click("#btNorte");
    await pg.waitForTimeout(700);
    e = await estado(pg);
    expect(e.bearing, "a bússola não voltou ao norte").toBe(0);
    expect(e.pitch, "a bússola só desfaz o giro, a inclinação fica").toBeGreaterThanOrEqual(45);

    await roda(pg, `() => window.__testes.map.jumpTo({ bearing: -35 })`);
    await pg.click("#bt3d");
    await pg.waitForTimeout(1300);
    e = await estado(pg);
    expect(e).toMatchObject({ pitch: 0, bearing: 0, giro: false, inclina: false, pressed: "false", norteOculto: true });
    await pg.context().close();
  }, LENTO);

  test("o interruptor respeita movimento reduzido: vai direto, sem animação", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true, ctx: { reducedMotion: "reduce" } });
    await pg.click("#bt3d");
    await pg.waitForTimeout(150);
    expect((await estado(pg)).pitch).toBeGreaterThanOrEqual(45);
    await pg.context().close();
  }, LENTO);

  test("define3D é o ponto de entrada para quem quiser ligar o 3D (o tour)", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    await roda(pg, `() => window.__testes.define3D(true, { animar: false })`);
    expect(await estado(pg)).toMatchObject({ pitch: 50, giro: true, pressed: "true" });
    await roda(pg, `() => window.__testes.define3D(false, { animar: false })`);
    expect(await estado(pg)).toMatchObject({ pitch: 0, bearing: 0, giro: false, pressed: "false" });
    await pg.context().close();
  }, LENTO);

  test("a URL guarda o estado: ligar escreve ?3d=1 e a câmera, desligar apaga os dois", async () => {
    const { pg } = await abrir(`${base}/index.html?mapa=esgoto`, { fresco: true });
    await pg.click("#bt3d");
    await pg.waitForTimeout(1500);
    let u = new URL(await pg.url());
    expect(u.searchParams.get("3d")).toBe("1");
    expect(u.searchParams.get("mapa"), "o modo some da URL").toBe("esgoto");
    expect(u.hash).toMatch(/^#[\d.]+\/-?[\d.]+\/-?[\d.]+\/\d+\/5\d$/);
    await pg.click("#bt3d");
    await pg.waitForTimeout(1500);
    u = new URL(await pg.url());
    expect(u.searchParams.has("3d")).toBe(false);
    expect(u.searchParams.get("mapa")).toBe("esgoto");
    expect(u.hash, "plano, no enquadramento inicial: nada de câmera na URL").toBe("");
    await pg.context().close();
  }, LENTO);

  test("um link em 3D abre em 3D, na câmera do hash, e o modo da query segue valendo", async () => {
    const { pg } = await abrir(`${base}/index.html?mapa=outorga&3d=1#6.5/-3.1/-60/40/58`, { fresco: true });
    expect(await pg.getAttribute("#bt3d", "aria-pressed")).toBe("true");
    expect(await pg.isVisible("#btNorte")).toBe(true);
    expect(await pg.getAttribute('.modo[data-modo="outorga"]', "aria-pressed")).toBe("true");
    expect(await roda<number>(pg, TINTA)).toBeGreaterThan(20);
    // a câmera do hash foi aplicada: o mapa a reescreve igual depois de assentar
    await pg.click("#btMais");
    await pg.waitForTimeout(600);
    const u = new URL(await pg.url());
    expect(u.hash).toMatch(/\/40\/58$/);
    expect(u.searchParams.get("3d")).toBe("1");
    // reenquadrar (⤢) volta ao Brasil inteiro e mantém o 3D, na inclinação padrão
    await pg.click("#btReset");
    await pg.waitForTimeout(500);
    const v = new URL(await pg.url());
    expect(v.hash).toMatch(/\/0\/50$/);
    expect(v.searchParams.get("3d")).toBe("1");
    await pg.context().close();
  }, LENTO);

  test("clicar num rio com a vista inclinada e girada abre a ficha dele", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    await roda(pg, `() => window.__testes.define3D(true, { animar: false })`);
    // o Xingu, de perto, inclinado e girado
    const alvo = await roda<{ x: number; y: number; nome: string }>(pg, `() => {
      const t = window.__testes, i = t.buscaRios('xingu')[0].i;
      const a = t.inicio[i], b = t.inicio[i + 1], j = a + 2 * (((b - a) >> 2));
      const lon = t.coords[j] * 360 - 180;
      const lat = 360 / Math.PI * Math.atan(Math.exp(Math.PI * (1 - 2 * t.coords[j + 1]))) - 90;
      t.map.jumpTo({ center: [lon, lat], zoom: t.map.getMaxZoom() - 4, bearing: 25, pitch: 55 });
      return { i, lon, lat, nome: t.D.nomes[t.nomeIdx[i]] };
    }`);
    await pg.waitForTimeout(900);
    const px = await roda<{ x: number; y: number }>(pg, `(a) => {
      const t = window.__testes, p = t.map.project([a.lon, a.lat]);
      return { x: p.x, y: p.y };
    }`, alvo);
    await pg.mouse.click(px.x, px.y);
    await pg.waitForTimeout(500);
    const ficha = (await pg.textContent("#ficha")) ?? "";
    expect(ficha, "a ficha não abriu com a vista inclinada").toContain(alvo.nome);
    await pg.context().close();
  }, LENTO);

  test("o fluxo animado desenha com a vista inclinada", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    await roda(pg, `() => { const t = window.__testes; t.define3D(true, { animar: false });
      t.map.jumpTo({ center: [-60, -3.14], zoom: t.map.getMinZoom() + 3.2, bearing: 30, pitch: 55 }); }`);
    await pg.click("#btFluxo");
    await pg.waitForTimeout(1300);
    const tinta = await roda<boolean>(pg, `() => { const c = document.getElementById('cvFluxo');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4 * 331) if (d[i] > 0) return true; return false; }`);
    expect(tinta, "o canvas de fluxo ficou vazio com a vista inclinada").toBe(true);
    await pg.context().close();
  }, LENTO);
});

/* O relevo de verdade na vista 3D (tasks/relevo-3d.md): a grade do ETOPO vai embutida, vira
 * terreno da biblioteca pelos ladrilhos montados no navegador, e a rede sobe com ele no shader
 * (e o fluxo, os anéis e o acerto pelo paraTela). Desligado o 3D, nada disso existe. */
const assina = `() => {
  const c = document.getElementById('cv');
  const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d'); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 4 * 53) h = (h * 31 + d[i] * 7 + d[i + 1] * 3 + d[i + 2]) >>> 0;
  return h;
}`;
const esperaTerreno = (pg: Page) => pg.waitForFunction(
  "window.__testes.relevo().ativo && window.__testes.map.areTilesLoaded()", undefined, { timeout: 20_000 });
/* um vértice do Tietê no planalto, perto da nascente, e a câmera inclinada sobre a serra */
const tieteNaSerra = `() => {
  // a BHO parte o Tietê nos reservatórios: os trechos da cabeceira saem direto pelo nome
  const t = window.__testes, pts = [];
  let i = -1;
  for (let k = 0; k < t.N; k++) {
    if (t.D.nomes[t.nomeIdx[k]] !== 'Rio Tietê') continue;
    for (let j = t.inicio[k]; j < t.inicio[k + 1]; j += 2) {
      const lon = t.coords[j] * 360 - 180;
      const lat = 360 / Math.PI * Math.atan(Math.exp(Math.PI * (1 - 2 * t.coords[j + 1]))) - 90;
      if (lon > -46.6 && lon < -45.9 && lat > -23.75 && lat < -23.4) { pts.push({ wx: t.coords[j], wy: t.coords[j + 1], lon, lat }); i = k; }
    }
  }
  /* o centro no litoral, olhando a serra do mar: o z é relativo ao centro, e com o centro no
     planalto o Tietê ficaria na mesma altitude dele (z ≈ 0) e o teste não veria diferença */
  t.map.jumpTo({ center: [-46.25, -23.98], zoom: t.map.getMinZoom() + 5, bearing: -10, pitch: 58 });
  return { nome: t.D.nomes[t.nomeIdx[i]], pts: pts.filter((_, k) => k % Math.max(1, (pts.length / 8) | 0) === 0).slice(0, 8) };
}`;

describe("relevo na vista 3D", () => {
  test("o 3D liga o terreno e o sombreamento em menos de 300 ms; desligar tira os dois e o plano volta igual", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    await pg.waitForTimeout(500);
    const antes = await roda<number>(pg, assina);
    expect(await roda<any>(pg, `() => window.__testes.relevo()`)).toMatchObject({ tem: true, ativo: false });
    const ms = await roda<number>(pg, `() => new Promise(ok => {
      const t = window.__testes, t0 = performance.now();
      t.define3D(true, { animar: false });
      const vê = () => t.relevo().ativo && t.map.getTerrain() ? ok(performance.now() - t0) : requestAnimationFrame(vê);
      vê();
    })`);
    expect(ms, "abrir o 3D com relevo passou de 300 ms").toBeLessThan(300);
    await esperaTerreno(pg);
    const lig = await roda<any>(pg, `() => { const m = window.__testes.map; return {
      fonte: !!m.getSource('relevo'), sombra: !!m.getLayer('sombra'), terreno: m.getTerrain() && m.getTerrain().source,
      elev: m.transform.elevation, exag: m.terrain.exaggeration }; }`);
    expect(lig).toMatchObject({ fonte: true, sombra: true, terreno: "relevo" });
    expect(lig.elev, "o centro do Brasil ficou na altitude zero").toBeGreaterThan(1000);
    expect(lig.exag).toBe(30);
    expect(await roda<number>(pg, TINTA)).toBeGreaterThan(20);

    await roda(pg, `() => window.__testes.define3D(false, { animar: false })`);
    await pg.waitForTimeout(900);
    const des = await roda<any>(pg, `() => { const m = window.__testes.map; return {
      fonte: !!m.getSource('relevo') || !!m.getSource('relevo-sombra'), sombra: !!m.getLayer('sombra'),
      terreno: !!m.getTerrain(), ativo: window.__testes.relevo().ativo }; }`);
    expect(des).toEqual({ fonte: false, sombra: false, terreno: false, ativo: false });
    expect(await roda<number>(pg, assina), "o plano não voltou igual depois do relevo").toBe(antes);
    await pg.context().close();
  }, LENTO);

  test("a rede sobe com o terreno: o paraTela bate com a biblioteca e a GPU pinta onde ele diz", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    await roda(pg, `() => window.__testes.define3D(true, { animar: false })`);
    await esperaTerreno(pg);
    const { pts } = await roda<any>(pg, tieteNaSerra);
    expect(pts.length).toBeGreaterThanOrEqual(5);
    await esperaTerreno(pg);
    await pg.waitForTimeout(600);
    const r = await roda<any>(pg, `(pts) => {
      const t = window.__testes, m = t.map, c = document.getElementById('cv'), k = c.width / c.clientWidth;
      const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
      const x = tmp.getContext('2d'); x.drawImage(c, 0, 0);
      const M = m.transform.customLayerMatrix(), W = c.clientWidth, H = c.clientHeight;
      return pts.map(p => {
        const [sx, sy] = t.paraTela(p.wx, p.wy), d = m.project([p.lon, p.lat]);
        const w = M[3] * p.wx + M[7] * p.wy + M[15];   // o mesmo ponto sem o z: onde ele estaria no plano
        const plano = [(M[0] * p.wx + M[4] * p.wy + M[12]) / w * 0.5 * W + 0.5 * W, (1 - (M[1] * p.wx + M[5] * p.wy + M[13]) / w) * 0.5 * H];
        const px = x.getImageData(Math.round(sx * k) - 3, Math.round(sy * k) - 3, 7, 7).data;
        let azul = false;
        for (let i = 0; i < px.length; i += 4) if (px[i + 2] > px[i] + 40) azul = true;
        return { erro: Math.hypot(sx - d.x, sy - d.y), semZ: Math.hypot(plano[0] - d.x, plano[1] - d.y), azul };
      });
    }`, pts);
    for (const p of r) expect(p.erro, "o paraTela não pôs o ponto no terreno").toBeLessThan(1);
    expect(Math.min(...r.map((p: any) => p.semZ)), "sem z o ponto cairia no mesmo lugar: o teste não discrimina").toBeGreaterThan(4);
    expect(r.filter((p: any) => p.azul).length, "a GPU não desenhou o Tietê onde o paraTela diz").toBeGreaterThanOrEqual(r.length - 1);
    await pg.context().close();
  }, LENTO);

  test("clicar no Tietê com a câmera inclinada sobre a serra abre a ficha dele", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    await roda(pg, `() => window.__testes.define3D(true, { animar: false })`);
    await esperaTerreno(pg);
    const { nome, pts } = await roda<any>(pg, tieteNaSerra);
    await esperaTerreno(pg);
    await pg.waitForTimeout(600);
    const p = pts[(pts.length / 2) | 0];
    const px = await roda<{ x: number; y: number }>(pg, `(p) => { const d = window.__testes.map.project([p.lon, p.lat]); return { x: d.x, y: d.y }; }`, p);
    await pg.mouse.click(px.x, px.y);
    await pg.waitForTimeout(500);
    expect((await pg.textContent("#ficha")) ?? "", "a ficha do Tietê não abriu sobre o relevo").toContain(nome);
    await pg.context().close();
  }, LENTO);

  test("de longe, com o 3D e o terreno ligados, a página não sai à rede", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    const externos: string[] = [];
    pg.on("request", (q) => { if (!q.url().startsWith("file:") && !q.url().startsWith("data:") && !q.url().startsWith("blob:")) externos.push(q.url()); });
    await roda(pg, `() => window.__testes.define3D(true, { animar: false })`);
    await esperaTerreno(pg);
    await roda(pg, `() => window.__testes.map.jumpTo({ center: [-68, -16], zoom: window.__testes.map.getMinZoom() + 3, bearing: 60, pitch: 60 })`);
    await esperaTerreno(pg);
    await pg.waitForTimeout(500);
    expect(externos, "o relevo pediu algo à rede").toEqual([]);
    await pg.context().close();
  }, LENTO);

  /* De perto o relevo vem dos ladrilhos Terrarium da AWS (a grade embutida, de 3,7 km, não tem o
   * Pão de Açúcar). O ladrilho é servido aqui: chapado a 777 m, com uma agulha de 4 km num pixel
   * só, que é o defeito que os z10/z11 da AWS trazem no mar perto da costa. */
  const terrarium = (m: number, agulha = false) => {
    const N = 256, cru = Buffer.alloc((N * 3 + 1) * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const h = agulha && x === 100 && y === 100 ? 4000 : m, v = Math.round((h + 32768) * 256), o = y * (N * 3 + 1) + 1 + x * 3;
      cru[o] = v >> 16; cru[o + 1] = (v >> 8) & 255; cru[o + 2] = v & 255;
    }
    const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
    const pedaco = (t: string, d: Buffer) => { const tb = Buffer.concat([Buffer.from(t), d]), l = Buffer.alloc(4), c = Buffer.alloc(4);
      l.writeUInt32BE(d.length); c.writeUInt32BE(crc(tb)); return Buffer.concat([l, tb, c]); };
    const ih = Buffer.alloc(13); ih.writeUInt32BE(N, 0); ih.writeUInt32BE(N, 4); ih[8] = 8; ih[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pedaco("IHDR", ih),
      pedaco("IDAT", deflateSync(cru)), pedaco("IEND", Buffer.alloc(0))]);
  };
  /* zoom 10,3 da biblioteca: o terreno e o mosaico ficam no ladrilho z10 */
  const pertoDoRio = `() => { const t = window.__testes; t.define3D(true, { animar: false });
    t.map.jumpTo({ center: [-43.1566, -22.9486], zoom: 10.3, bearing: 90, pitch: 60 }); }`;

  test("de perto o relevo vem da rede: a rede de rios lê a mesma altitude, e a agulha da AWS sai", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    const pedidos: string[] = [];
    await pg.route("**/elevation-tiles-prod.s3.amazonaws.com/**", (r) => {
      pedidos.push(r.request().url());
      r.fulfill({ contentType: "image/png", body: terrarium(777, true), headers: { "access-control-allow-origin": "*" } });
    });
    await roda(pg, pertoDoRio);
    await pg.waitForFunction(`(() => { const t = window.__testes; return t.fino().on && Math.abs(t.altMundo(-43.1566, -22.9486) - 777) < 1; })()`,
      undefined, { timeout: 20_000 });
    await esperaTerreno(pg);
    const zs = new Set(pedidos.map(u => Number(u.split("/terrarium/")[1].split("/")[0])));
    expect([...zs].every(z => z >= 10 && z <= 12), `zooms pedidos: ${[...zs]}`).toBe(true);
    const r = await roda<any>(pg, `() => { const t = window.__testes, f = t.fino(), n = 2 ** f.z;
      // o centro do pixel (100, 100) de um ladrilho do mosaico: era a agulha
      const wx = (f.x0 + 1 + 100.5 / 256) / n, wy = (f.y0 + 1 + 100.5 / 256) / n;
      const lon = wx * 360 - 180, lat = 360 / Math.PI * Math.atan(Math.exp(Math.PI * (1 - 2 * wy))) - 90;
      return { z: f.z, agulha: t.altMundo(lon, lat), grade: t.altEm(-43.1566, -22.9486),
               terreno: t.map.transform.elevation / t.map.terrain.exaggeration }; }`);
    expect(r.z).toBe(10);
    expect(r.agulha, "o pixel solto de 4 km passou pelo filtro").toBeCloseTo(777, 0);
    expect(r.terreno, "o terreno da biblioteca não usou o ladrilho fino").toBeCloseTo(777, -1);
    expect(Math.abs(r.grade - 777), "a grade embutida já dava 777 m: o teste não prova nada").toBeGreaterThan(50);
    await pg.context().close();
  }, LENTO);

  test("o mosaico fino acompanha o arrasto: a rede não fica na grade enquanto a câmera anda", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    await pg.route("**/elevation-tiles-prod.s3.amazonaws.com/**", (r) =>
      r.fulfill({ contentType: "image/png", body: terrarium(777), headers: { "access-control-allow-origin": "*" } }));
    await roda(pg, pertoDoRio);
    await pg.waitForFunction("window.__testes.fino().on", undefined, { timeout: 20_000 });
    const ini = await roda<any>(pg, "() => window.__testes.fino()");
    // com o bearing de 90°, 3.000 px de arrasto andam vários ladrilhos z10; antes o mosaico só mudava no moveend
    await roda(pg, "() => window.__testes.map.panBy([3000, 0], { duration: 5000 })");
    await pg.waitForFunction(`(() => { const f = window.__testes.fino(); return f.x0 !== ${ini.x0} || f.y0 !== ${ini.y0}; })()`,
      undefined, { timeout: 4000 });
    await pg.waitForTimeout(300);   // a borda nova chega da rota (ladrilho fino) no quadro seguinte
    const r = await roda<any>(pg, "() => { const t = window.__testes, c = t.map.getCenter(); return { andando: t.map.isMoving(), f: t.fino(), alt: t.altMundo(c.lng, c.lat) }; }");
    expect(r.andando, "a câmera parou antes da conferência: o teste não prova nada").toBe(true);
    expect(r.f.on).toBe(true);
    // o centro em movimento está dentro do mosaico, e no ladrilho fino (777 m), não na grade
    expect(r.alt).toBeCloseTo(777, 0);
    await roda(pg, "() => window.__testes.map.stop()");
    await pg.context().close();
  }, LENTO);

  test("o teto de zoom sobe um nível na vista 3D e volta ao sair dela", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    const plano = await roda<number>(pg, "() => window.__testes.map.getMaxZoom()");
    await roda(pg, `() => { const t = window.__testes; t.define3D(true, { animar: false }); t.map.jumpTo({ zoom: t.map.getMaxZoom() }); }`);
    const r3d = await roda<any>(pg, "() => { const m = window.__testes.map; return { max: m.getMaxZoom(), z: m.getZoom() }; }");
    expect(r3d.max - plano).toBeCloseTo(1, 5);
    expect(r3d.z).toBeCloseTo(r3d.max, 5);
    await roda(pg, "() => window.__testes.define3D(false, { animar: false })");
    const r2d = await roda<any>(pg, "() => { const m = window.__testes.map; return { max: m.getMaxZoom(), z: m.getZoom() }; }");
    expect(r2d.max).toBeCloseTo(plano, 5);
    expect(r2d.z).toBeLessThanOrEqual(plano + 1e-6);
    await pg.context().close();
  }, LENTO);

  test("sem rede, de perto, o relevo cai calado na grade embutida", async () => {
    const { pg } = await abrir(copiaSondada(), { fresco: true });
    await pg.route("**/elevation-tiles-prod.s3.amazonaws.com/**", (r) => r.abort());
    await roda(pg, pertoDoRio);
    await pg.waitForFunction("window.__testes.fino().on", undefined, { timeout: 20_000 });
    await esperaTerreno(pg);
    const r = await roda<any>(pg, `() => { const t = window.__testes;
      return { fino: t.altMundo(-43.20, -22.95), grade: t.altEm(-43.20, -22.95) }; }`);
    // o mosaico guarda a grade reamostrada nos centros de pixel: só a interpolação difere
    expect(Math.abs(r.fino - r.grade)).toBeLessThan(2);
    expect(await roda<number>(pg, TINTA)).toBeGreaterThan(20);
    await pg.context().close();
  }, LENTO);
});
