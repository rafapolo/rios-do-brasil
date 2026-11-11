/* A vista 3D: inclinar e girar são uma camada que se liga a pedido. Desligada, o
 * mapa é o de sempre — plano, norte para cima, sem gesto que incline por acidente;
 * ligada, a câmera sobe a ~50° e os gestos voltam. A URL guarda o estado. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
    expect(lig.exag).toBe(12);
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

  test("com o 3D e o terreno ligados a página não sai à rede", async () => {
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
});
