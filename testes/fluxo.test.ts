/* A camada de fluxo animado (canvas #cvFluxo): o estilo de longe (tracejado, o
 * original), o de perto (partículas em faixas, que anda), o movimento reduzido
 * e a camada desligada. Arquivo próprio: abre páginas frescas, e o movimento
 * reduzido precisa de um contexto de navegador com a preferência ligada. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright";
import { LENTO, abrir, copiaSondada, fecharTudo, reinicia, roda } from "./comum";

let sonda: Page;      // cópia com window.__testes, movimento normal
let parado: Page;     // idem, com prefers-reduced-motion: reduce
let url: string;

beforeAll(async () => {
  url = copiaSondada();
  sonda = (await abrir(url, { fresco: true })).pg;
  parado = (await abrir(url, { fresco: true, ctx: { reducedMotion: "reduce" } })).pg;
}, LENTO);

afterAll(async () => { await fecharTudo(); });

// resumo do canvas de fluxo: pixels com tinta e uma impressão digital do conteúdo
const FOTO = `() => {
  const c = document.getElementById('cvFluxo');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let tinta = 0, h = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { tinta++; h = (Math.imul(h, 31) + d[i] + (i >> 2)) | 0; }
  return { tinta, h };
}`;
const foto = (p: Page) => roda<{ tinta: number; h: number }>(p, FOTO);
// Amazonas perto de Manaus: poucos rios largos na tela
const vai = (p: Page, z: number) => roda(p, `() => window.__testes.camera(-60.0, -3.14, ${z})`);
const liga = async (p: Page) => {
  if ((await p.getAttribute("#btFluxo", "aria-pressed")) !== "true") await p.click("#btFluxo");
};
const desliga = async (p: Page) => {
  if ((await p.getAttribute("#btFluxo", "aria-pressed")) === "true") await p.click("#btFluxo");
};

describe("fluxo animado", () => {
  test("de perto desenha partículas e elas andam de um quadro para o outro", async () => {
    await reinicia(sonda);
    await vai(sonda, 90);
    await liga(sonda);
    await sonda.waitForTimeout(800);
    const a = await foto(sonda);
    await sonda.waitForTimeout(250);
    const b = await foto(sonda);
    expect(a.tinta).toBeGreaterThan(300);
    expect(b.tinta).toBeGreaterThan(300);
    expect(b.h).not.toBe(a.h);
    await desliga(sonda);
  }, LENTO);

  test("a mistura de longe para perto não deixa buraco: toda escala desenha", async () => {
    await reinicia(sonda);
    await liga(sonda);
    for (const z of [1, 7, 12, 16, 20, 26, 40, 120, 180]) {
      await vai(sonda, z);
      await sonda.waitForTimeout(500);
      expect((await foto(sonda)).tinta, `z=${z}`).toBeGreaterThan(100);
    }
    await desliga(sonda);
  }, LENTO);

  test("funciona em todos os modos, de longe e de perto", async () => {
    await reinicia(sonda);
    await liga(sonda);
    for (const modo of ["vazao", "esgoto", "industria", "outorga", "tendencia", "livre"]) {
      await roda(sonda, `() => window.__testes.aplicaModo('${modo}')`);
      for (const z of [1, 40]) {
        await vai(sonda, z);
        await sonda.waitForTimeout(450);
        expect((await foto(sonda)).tinta, `${modo} z=${z}`).toBeGreaterThan(100);
      }
    }
    await roda(sonda, `() => window.__testes.aplicaModo('vazao')`);
    await desliga(sonda);
  }, LENTO);

  test("desligada, a camada fica vazia e para de pintar", async () => {
    await reinicia(sonda);
    await vai(sonda, 90);
    await liga(sonda);
    await sonda.waitForTimeout(500);
    expect((await foto(sonda)).tinta).toBeGreaterThan(300);
    await desliga(sonda);
    await sonda.waitForTimeout(400);
    expect((await foto(sonda)).tinta).toBe(0);
    await sonda.waitForTimeout(300);
    expect((await foto(sonda)).tinta).toBe(0);
  }, LENTO);

  test("com movimento reduzido a camada liga, mas o quadro fica parado", async () => {
    await reinicia(parado);
    await vai(parado, 90);
    await liga(parado);
    await parado.waitForTimeout(700);
    const a = await foto(parado);
    await parado.waitForTimeout(500);
    const b = await foto(parado);
    expect(a.tinta).toBeGreaterThan(300);
    expect(b).toEqual(a);
    await desliga(parado);
  }, LENTO);
});
