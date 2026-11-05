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
