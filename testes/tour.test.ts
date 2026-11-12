/* O tour: um passeio de ~2 min por fatos conferidos (design/tour.json), com música gerada na hora.
 * `?rapido=N` acelera o relógio do tour N vezes, então o passeio de 120 s cabe em segundos.
 * Só chromium (o mapa é WebGL e a suíte já cobre os outros motores no resto); o navegador é
 * fechado no fim, e o satélite (rede) é barrado, porque as cenas dele pediriam ladrilhos. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, devices, type Browser, type Page } from "playwright";
import { LENTO, RAIZ, argsGl, copiaSondada, roda, servidor, urlDe } from "./comum";
import { join } from "node:path";

let base: string, parar: () => void, nav: Browser;
beforeAll(async () => {
  ({ base, parar } = servidor());
  nav = await chromium.launch({ args: argsGl("chromium") });
});
afterAll(async () => { parar(); await nav.close(); });

/* conta os AudioContext criados e guarda a preferência de som antes de qualquer script da página */
const SONDA_AUDIO = (som?: string) => `
  window.__audios = 0;
  const A = window.AudioContext;
  window.AudioContext = function (...a) { window.__audios++; return new A(...a); };
  window.AudioContext.prototype = A.prototype;
  ${som ? `try { localStorage.setItem('rios-tour-som', '${som}'); } catch (e) {}` : ""}`;

type Aberta = { pg: Page; erros: string[]; fecha: () => Promise<void> };
async function abre(url: string, o: { ctx?: object; som?: string } = {}): Promise<Aberta> {
  const c = await nav.newContext({ viewport: { width: 1280, height: 800 }, ...(o.ctx ?? {}) });
  await c.route(/eox\.at|arcgis|openstreetmap|tile/i, (r) => r.abort());
  const pg = await c.newPage();
  const erros: string[] = [];
  pg.on("pageerror", (e) => erros.push(`pageerror: ${e.message}`));
  pg.on("console", (m) => { /* os ladrilhos do satélite barrados de propósito não contam */
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(`console: ${m.text()}`); });
  await pg.addInitScript(SONDA_AUDIO(o.som));
  await pg.goto(url);
  await pg.waitForSelector("#carregando", { state: "detached", timeout: 60_000 });
  await pg.waitForTimeout(1200);
  return { pg, erros, fecha: () => c.close() };
}

/* tudo o que o tour precisa devolver como estava */
const ESTADO = `() => {
  const m = window.__testes.map, c = m.getCenter();
  const pres = (id) => document.getElementById(id).getAttribute('aria-pressed');
  return { modo: document.querySelector('.modo[aria-pressed="true"]').dataset.modo,
    camadas: ['btFluxo', 'btEst', 'btRes', 'btEtes', 'btSat', 'bt3d'].map(pres).join(','),
    pitch: Math.round(m.getPitch()), bearing: Math.round(m.getBearing()) + 0, zoom: +m.getZoom().toFixed(3),
    lng: +c.lng.toFixed(4), lat: +c.lat.toFixed(4), touring: document.body.classList.contains('touring'),
    titulo: document.title, url: location.search + location.hash };
}`;
const estado = (pg: Page) => roda<any>(pg, ESTADO);

/* um estado que não é o de abertura: outro modo, Estações e Fluxo ligados, câmera mexida */
const PREPARA = `() => {
  document.querySelector('.modo[data-modo="outorga"]').click();
  document.getElementById('btEst').click();
  if (document.getElementById('btFluxo').getAttribute('aria-pressed') !== 'true') document.getElementById('btFluxo').click();
  window.__testes.map.jumpTo({ center: [-47, -15], zoom: 5.2 });
}`;

const espera = async (pg: Page, cond: string, ms = 30_000) =>
  pg.waitForFunction(cond, undefined, { timeout: ms, polling: 50 });

describe("tour", () => {
  test("o toque começa com música, as cenas avançam, o fluxo fica ligado em todas e o fim restaura tudo", async () => {
    const { pg, erros, fecha } = await abre(copiaSondada() + "?tour=1&rapido=20");
    // ?tour=1: o convite pede o toque, avisa do som, e nenhum áudio nasce antes do gesto
    const convite = pg.locator("#tour-convite");
    await convite.waitFor({ state: "visible" });
    expect(await convite.innerText()).toContain("Aperte para começar");
    expect(await convite.innerText()).toMatch(/som/i);
    expect(await roda(pg, `() => window.tour.ativo()`)).toBe(false);
    expect(await roda(pg, `() => window.__audios`), "AudioContext criado antes do gesto").toBe(0);
    expect(pg.url(), "tour=1 sai do endereço, para o recarregar abrir só o mapa").not.toContain("tour=1");
    await roda(pg, PREPARA);
    const antes = await estado(pg);
    expect(antes.camadas.split(",")[0], "o fluxo deste teste começa ligado").toBe("true");
    // amostra, a cada quadro, a cena, o fluxo, a 3D e os pixels do canvas do fluxo
    await roda(pg, `() => {
      window.__v = { cenas: new Set(), fluxo: new Set(), d3: new Set(), tinta: 0, legendas: new Set(), ativoVisto: false, hudNaCena1: new Set(), hudFora: new Set() };
      const t = () => {
        const T = window.tour; if (T.ativo()) {
          const v = window.__v; v.ativoVisto = true; v.cenas.add(T.cena());
          v.fluxo.add(document.getElementById('btFluxo').getAttribute('aria-pressed'));
          v.d3.add(document.getElementById('bt3d').getAttribute('aria-pressed'));
          const hv = getComputedStyle(document.getElementById('hud')).visibility;
          if (T.cena() === 1) v.hudNaCena1.add(hv); else if (T.cena() > 1) v.hudFora.add(hv);
          v.legendas.add(document.getElementById('tour-line').textContent);
          const c = document.getElementById('cvFluxo'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0; for (let i = 3; i < d.length; i += 4 * 7) if (d[i]) n++; if (n > 0) v.tinta++;
        }
        requestAnimationFrame(t);
      }; t();
    }`);
    await pg.click("#tour-convite button");
    // o gesto criou o AudioContext (um só) e o tour começou
    expect(await roda(pg, `() => window.__audios`)).toBe(1);
    await espera(pg, `window.tour.ativo()`, 5000);
    expect(await roda(pg, `() => document.body.classList.contains('touring')`)).toBe(true);
    expect(await roda(pg, `() => window.SomRio.criado()`)).toBe(true);
    // a hud e a barra somem; a faixa de legenda e o botão de som ficam
    expect(await pg.locator("#hud").isVisible()).toBe(false);
    expect(await pg.locator("#tour-som").isVisible()).toBe(true);
    await espera(pg, `!window.tour.ativo()`);
    const v = await roda<any>(pg, `() => ({ cenas: [...window.__v.cenas], fluxo: [...window.__v.fluxo], d3: [...window.__v.d3],
      tinta: window.__v.tinta, hudNaCena1: [...window.__v.hudNaCena1], hudFora: [...window.__v.hudFora], legendas: window.__v.legendas.size, total: window.tour.total() })`);
    expect(v.cenas.length, "todas as cenas passaram").toBe(v.total);
    expect(v.total).toBe(14);
    expect(v.legendas, "uma legenda por cena").toBeGreaterThanOrEqual(13);
    expect(v.hudNaCena1, "na cena dos painéis a hud aparece").toContain("visible");
    expect(v.hudFora, "nas outras cenas a hud some").toEqual(["hidden"]);
    expect(v.fluxo, "o fluxo animado fica ligado em TODAS as cenas").toEqual(["true"]);
    expect(v.d3, "a vista 3D liga com o tour").toEqual(["true"]);
    expect(v.tinta, "partículas do fluxo no canvas durante o tour").toBeGreaterThan(10);
    await pg.waitForTimeout(500);
    const depois = await estado(pg);
    expect(depois).toMatchObject({ modo: antes.modo, camadas: antes.camadas, pitch: antes.pitch, bearing: antes.bearing,
      zoom: antes.zoom, lng: antes.lng, lat: antes.lat, touring: false, titulo: antes.titulo });
    expect(await roda(pg, `() => document.getElementById('tour').hidden`)).toBe(true);
    expect(erros).toEqual([]);
    await fecha();
  }, LENTO);

  test("?tour=en: convite e legendas em inglês, uma por cena, e o tour=en sai do endereço", async () => {
    const { pg, erros, fecha } = await abre(copiaSondada() + "?tour=en&rapido=20");
    const convite = pg.locator("#tour-convite");
    await convite.waitFor({ state: "visible" });
    expect(await convite.innerText()).toContain("Press to start");
    expect(pg.url()).not.toContain("tour=en");
    await roda(pg, `() => {
      window.__l = new Set();
      const t = () => { if (window.tour.ativo()) window.__l.add(document.getElementById('tour-kicker').textContent + '|' + document.getElementById('tour-line').textContent); requestAnimationFrame(t); }; t();
    }`);
    await pg.click("#tour-convite button");
    await espera(pg, `window.tour.ativo()`, 5000);
    expect(await roda(pg, `() => document.getElementById('tour-cap').lang`)).toBe("en");
    await espera(pg, `!window.tour.ativo()`);
    const ls = await roda<string[]>(pg, `() => [...window.__l].filter(x => x !== '|')`);
    const roteiro = JSON.parse(await Bun.file(join(RAIZ, "design", "tour.json")).text());
    const esperadas = roteiro.map((c: any) => c.kicker_en + "|" + c.frase_en);
    expect(roteiro.every((c: any) => c.kicker_en && c.frase_en && c.fonte_en), "toda cena tem a versão em inglês").toBe(true);
    // a 20× uma cena curta pode cair entre dois quadros amostrados (como no teste do ?tour=1)
    expect(esperadas.filter((e: string) => ls.includes(e)).length, "a legenda em inglês de cada cena aparece").toBeGreaterThanOrEqual(13);
    expect(ls.filter(x => !esperadas.includes(x)), "nenhuma legenda em português").toEqual([]);
    expect(erros).toEqual([]);
    await fecha();
  }, LENTO);

  test("Esc para no meio e devolve modo, camadas, câmera e 3D como estavam (fluxo desligado ou ligado); '✕ esc' também", async () => {
    const { pg, fecha } = await abre(copiaSondada() + "?rapido=4");
    // 1) abertura limpa: fluxo e 3D desligados voltam desligados
    const limpo = await estado(pg);
    expect(limpo.camadas).toBe("false,false,false,false,false,false");
    await pg.click("#btTour");
    await espera(pg, `window.tour.cena() >= 1`);
    expect((await estado(pg)).camadas.split(",")[0], "o tour liga o fluxo").toBe("true");
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(300);
    expect(await roda(pg, `() => window.tour.ativo()`)).toBe(false);
    expect(await estado(pg)).toMatchObject({ modo: "vazao", camadas: limpo.camadas, pitch: 0, bearing: 0, zoom: limpo.zoom, touring: false });
    // 2) outro modo, Estações e Fluxo ligados, câmera mexida
    await roda(pg, PREPARA);
    const antes = await estado(pg);
    await pg.click("#btTour");
    await espera(pg, `window.tour.cena() >= 2`);
    const meio = await estado(pg);
    expect(meio.touring).toBe(true);
    expect(meio.modo === antes.modo && meio.camadas === antes.camadas, "em cena o estado é o do roteiro").toBe(false);
    await pg.click("#tour-parar");       // "✕ esc"
    await pg.waitForTimeout(300);
    expect(await estado(pg)).toMatchObject({ modo: antes.modo, camadas: antes.camadas, pitch: antes.pitch,
      bearing: antes.bearing, zoom: antes.zoom, lng: antes.lng, lat: antes.lat, touring: false, titulo: antes.titulo });
    // sem relógio solto: nada muda depois de parar
    await pg.waitForTimeout(1200);
    expect((await estado(pg)).modo).toBe(antes.modo);
    await fecha();
  }, LENTO);

  test("o botão de som liga e desliga, lembra a preferência", async () => {
    const { pg, fecha } = await abre(copiaSondada() + "?rapido=3");
    await pg.click("#btTour");
    await espera(pg, `window.tour.ativo()`, 5000);
    expect(await pg.getAttribute("#tour-som", "aria-pressed")).toBe("true");
    expect(await roda(pg, `() => window.__audios`)).toBe(1);
    // há som de verdade na saída (RMS) depois de um instante
    await roda(pg, `() => window.SomRio.nivel()`);   // a primeira chamada liga o analisador
    await pg.waitForTimeout(1500);
    expect(await roda<number>(pg, `() => window.SomRio.nivel()`), "saída muda").toBeGreaterThan(0.0005);
    await pg.click("#tour-som");
    expect(await pg.getAttribute("#tour-som", "aria-pressed")).toBe("false");
    expect(await roda(pg, `() => localStorage.getItem('rios-tour-som')`)).toBe("off");
    await pg.waitForTimeout(900);
    expect(await roda<number>(pg, `() => window.SomRio.nivel()`), "silêncio depois da rampa").toBeLessThan(0.0005);
    await pg.keyboard.press("Escape");
    await fecha();
  }, LENTO);

  test("tour/index.html leva ao tour, por http e por file://", async () => {
    // (com a preferência "mudo" guardada: o gesto começa o tour e não cria áudio nenhum)
    const h = await abre(`${base}/tour/?rapido=20`, { som: "off" });
    await h.pg.locator("#tour-convite").waitFor({ state: "visible" });
    expect(await h.pg.locator("#tour-convite").innerText()).toContain("Aperte para começar");
    expect(new URL(h.pg.url()).pathname).toMatch(/index\.html$/);
    await h.pg.click("#tour-convite button");
    await espera(h.pg, `window.tour.ativo()`, 5000);
    expect(await h.pg.getAttribute("#tour-som", "aria-pressed")).toBe("false");
    expect(await roda(h.pg, `() => window.__audios`), "mudo lembrado: sem AudioContext").toBe(0);
    await espera(h.pg, `!window.tour.ativo()`);
    await h.fecha();
    const f = await abre(urlDe(join(RAIZ, "tour", "index.html")));
    await f.pg.locator("#tour-convite").waitFor({ state: "visible" });
    expect(f.pg.url().startsWith("file://")).toBe(true);
    expect(await roda(f.pg, `() => window.__audios`)).toBe(0);
    await f.fecha();
    // a página de entrada é leve: nada de duplicar os 17 MB
    expect(Bun.file(join(RAIZ, "tour", "index.html")).size).toBeLessThan(4000);
  }, LENTO);

  test("movimento reduzido: cortes secos, sem voo", async () => {
    const { pg, fecha } = await abre(copiaSondada() + "?tour=1&rapido=10", { ctx: { reducedMotion: "reduce" } });
    // Esc fecha o convite sem criar áudio; o botão Tour do mapa começa direto
    await pg.locator("#tour-convite").waitFor({ state: "visible" });
    await pg.keyboard.press("Escape");
    expect(await pg.locator("#tour-convite").isVisible()).toBe(false);
    expect(await roda(pg, `() => window.__audios`)).toBe(0);
    await pg.click("#btTour");
    await espera(pg, `window.tour.cena() >= 2`);
    await pg.waitForTimeout(150);
    // a câmera já está na cena (a cena 2 é a do São Francisco: zoom 5,6, inclinação 35), sem animação a caminho
    const c = await roda<any>(pg, `() => { const m = window.__testes.map; return { z: m.getZoom(), p: m.getPitch(), mov: m.isMoving() }; }`);
    expect(c.p).toBeCloseTo(35, 0);
    expect(c.mov, "com movimento reduzido não há voo").toBe(false);
    await espera(pg, `!window.tour.ativo()`);
    await fecha();
  }, LENTO);

  test("em cada cena há rio realçado e partículas de fluxo na tela", async () => {
    const { pg, fecha } = await abre(copiaSondada());
    const r = await roda<any[]>(pg, `async () => {
      const out = [], n = window.tour.total();
      for (let i = 0; i < n; i++) {
        const nome = await window.tour.mostra(i);
        await new Promise((f) => setTimeout(f, 700));
        const c = document.getElementById('cvFluxo'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let px = 0; for (let k = 3; k < d.length; k += 4) if (d[k]) px++;
        out.push({ i, nome, px, fluxo: document.getElementById('btFluxo').getAttribute('aria-pressed') });
      }
      return out;
    }`);
    await pg.keyboard.press("Escape");
    for (const c of r) {
      expect(c.fluxo, `cena ${c.i}: fluxo ligado`).toBe("true");
      expect(c.px, `cena ${c.i} (${c.nome}): partículas do fluxo`).toBeGreaterThan(40);
      if (c.i < 13) expect(c.nome, `cena ${c.i}: o rio do realce foi achado`).toBeTruthy();
    }
    // os rios certos: Formoso é o da Bahia, e Piranhas-Açu o do Rio Grande do Norte/Paraíba
    const achados = await roda<any>(pg, `() => ({ f: window.tour.acha('Rio Formoso', [-45, -14], 7), p: window.tour.acha('Rio Piranhas ou Açu', [-37.4, -6.2], 7) })`);
    expect(achados.f.uf).toBe("BA");
    // a cena do Tietê para a Argentina: o Paraná do mapa desce abaixo de 29°S, com vazão de rio grande
    const pr = await roda<any>(pg, `() => { const T = window.__testes, a = window.tour.acha('Rio Paraná', [-54.5, -26.5], 4.5);
      let sul = 0; for (const t of T.trechosDoRio(a.i)) sul = Math.max(sul, T.bbox[t * 4 + 3]);
      return { q: a.q, lat: 360 / Math.PI * Math.atan(Math.exp(Math.PI * (1 - 2 * sul))) - 90 }; }`);
    expect(pr.lat, "o Paraná do mapa chega à Argentina").toBeLessThan(-29);
    expect(pr.q).toBeGreaterThan(15000);
    expect(achados.p.uf).toMatch(/RN|PB/);
    await fecha();
  }, LENTO);

  test("celular: convite, legenda legível na faixa de baixo, barra e painéis escondidos", async () => {
    const { pg, fecha } = await abre(copiaSondada() + "?tour=1&rapido=3", { ctx: { ...devices["iPhone 13"] } });
    await pg.locator("#tour-convite").waitFor({ state: "visible" });
    await pg.tap("#tour-convite button");
    await espera(pg, `window.tour.cena() === 1`);
    await pg.waitForTimeout(1200);
    // cena dos painéis: o painel sobe de cima da legenda, sem cobri-la
    expect(await pg.locator("#hud").isVisible()).toBe(true);
    const hb = await roda<any>(pg, `() => ({ h: document.getElementById('hud').getBoundingClientRect().bottom, l: document.getElementById('tour-baixo').getBoundingClientRect().top })`);
    expect(hb.h).toBeLessThanOrEqual(hb.l + 1);
    await espera(pg, `window.tour.cena() >= 3`);
    await pg.waitForTimeout(900);
    expect(await pg.locator("#barraBaixo").isVisible()).toBe(false);
    expect(await pg.locator("#hud").isVisible()).toBe(false);
    expect(await pg.locator(".busca").isVisible()).toBe(false);
    const m = await roda<any>(pg, `() => {
      const l = document.getElementById('tour-line'), r = l.getBoundingClientRect(), cs = getComputedStyle(l);
      const top = document.getElementById('tour-topo').getBoundingClientRect(), baixo = document.getElementById('tour-baixo').getBoundingClientRect();
      return { fonte: parseFloat(cs.fontSize), esq: r.left, dir: r.right, w: innerWidth, h: innerHeight, topoB: top.bottom,
        baixoT: baixo.top, baixoB: baixo.bottom, linhaT: r.top, linhaB: r.bottom, padB: window.__testes.map.getPadding().bottom };
    }`);
    expect(m.fonte, "legível no celular").toBeGreaterThanOrEqual(14);
    expect(m.esq).toBeGreaterThanOrEqual(0);
    expect(m.dir).toBeLessThanOrEqual(m.w);
    expect(m.linhaT, "a frase mora na faixa de baixo, fora do mapa").toBeGreaterThanOrEqual(m.baixoT - 1);
    expect(m.baixoB).toBeLessThanOrEqual(m.h + 1);
    // o mapa foi empurrado para fora da legenda: o padding da câmera cobre a faixa inteira
    expect(m.padB).toBeGreaterThanOrEqual(m.h - m.baixoT - 2);
    await pg.tap("#tour-parar");
    await pg.waitForTimeout(400);
    expect(await pg.locator("#barraBaixo").isVisible()).toBe(true);
    await fecha();
  }, LENTO);
});
