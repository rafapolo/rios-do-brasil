/* Celular de verdade: `is_mobile`, não `set_viewport_size`.
 *
 * Só a emulação real faz o Chromium respeitar (ou ignorar) a <meta viewport>.
 * Redimensionar a janela dispara as media queries de qualquer jeito, então um
 * teste feito assim passaria mesmo com a tag ausente — que foi exatamente o
 * estado em que as duas páginas ficaram por muito tempo. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright";
import { INDEX, LENTO, abrir, fecharTudo, roda, urlDe } from "./comum";

let pg: Page;

beforeAll(async () => {
  ({ pg } = await abrir(urlDe(INDEX), { dispositivo: "iPhone 13" }));
}, LENTO);

afterAll(fecharTudo);

describe("celular", () => {
  test("o viewport é o do aparelho e a media query de 760 px dispara", async () => {
    const r = await roda<any>(pg, `() => ({
      larguraCss: window.innerWidth,
      dpr: window.devicePixelRatio,
      disparou: window.matchMedia('(max-width: 760px)').matches,
      // no celular o cartão do título vai para o fim por flex order
      ordemTitulo: getComputedStyle(document.querySelector('.titulo-cartao')).order,
      h1Escondido: getComputedStyle(document.querySelector('.titulo-cartao h1')).display,
    })`);
    expect(r.larguraCss).toBeLessThan(500);
    expect(r.dpr).toBeGreaterThan(1);
    expect(r.disparou, "a media query de celular não disparou — <meta viewport>?").toBe(true);
    expect(r.ordemTitulo).toBe("9");
    expect(r.h1Escondido).toBe("none");
  });

  test("o hud abre recolhido e o puxador nomeia o modo", async () => {
    const { pg: p } = await abrir(`${urlDe(INDEX)}?mapa=outorga`,
      { dispositivo: "iPhone 13", fresco: true });
    expect(await p.$eval("#hud", (e) => e.classList.contains("recolhido"))).toBe(true);
    expect(await p.getAttribute("#puxador", "aria-expanded")).toBe("false");
    expect(await p.textContent("#puxadorRotulo")).toBe("Os rios do Brasil, por licença de retirada");
    await p.click("#puxador");
    await p.waitForTimeout(500);
    expect(await p.$eval("#hud", (e) => e.classList.contains("recolhido"))).toBe(false);
    expect(await p.getAttribute("#puxador", "aria-expanded")).toBe("true");
  }, LENTO);

  test("o hud rola até o último painel", async () => {
    await pg.evaluate(() => document.getElementById("hud")!.classList.remove("recolhido"));
    await pg.waitForTimeout(400);
    const r = await roda<any>(pg, `() => {
      const h = document.getElementById('hud');
      h.scrollTop = h.scrollHeight;
      const hb = h.getBoundingClientRect();
      // ordem visual, não a do DOM: o cartão do título tem order 9
      const vis = [...h.children].map(d => ({
        nome: d.querySelector('h1,h2')?.textContent ?? d.id,
        topo: d.getBoundingClientRect().top, base: d.getBoundingClientRect().bottom,
      })).sort((a, b) => a.topo - b.topo);
      const ult = vis[vis.length - 1];
      return { rolavel: h.scrollHeight > h.clientHeight + 1,
               chegouAoFim: Math.abs(h.scrollTop - (h.scrollHeight - h.clientHeight)) < 2,
               ultimo: ult.nome, ultimoVisivel: ult.base <= hb.bottom + 1 && ult.topo >= hb.top - 1,
               overflow: getComputedStyle(h).overflowY };
    }`);
    expect(r.overflow).toBe("auto");
    expect(r.rolavel, "o hud não tem o que rolar — os painéis couberam?").toBe(true);
    expect(r.chegouAoFim).toBe(true);
    expect(r.ultimoVisivel, `o último painel (${r.ultimo}) não chega à área visível`).toBe(true);
  });

  test("a rolagem por toque funciona, não só o scrollTop", async () => {
    await pg.evaluate(() => {
      const h = document.getElementById("hud")!;
      h.classList.remove("recolhido");
      h.scrollTop = 0;
    });
    await pg.waitForTimeout(300);
    const caixa = (await pg.locator("#hud").boundingBox())!;
    const x = caixa.x + caixa.width / 2;
    for (let k = 0; k < 6; k++) {
      await pg.mouse.move(x, caixa.y + caixa.height - 40);
      await pg.mouse.wheel(0, 300);
      await pg.waitForTimeout(120);
    }
    expect(await pg.$eval("#hud", (e) => e.scrollTop)).toBeGreaterThan(50);
  });

  test("a cunha encolhe em vez de cortar", async () => {
    /* É o ponto de ela ter viewBox: os SVG do series.html não têm, e por isso
       max-width neles corta a metade direita em vez de reduzir. */
    const r = await roda<any>(pg, `() => {
      const svg = document.querySelector('#classes svg');
      const cartao = svg.closest('.cartao');
      const s = svg.getBoundingClientRect(), c = cartao.getBoundingClientRect();
      const ults = [...svg.querySelectorAll('text')].pop().getBoundingClientRect();
      return { largura: s.width, cartaoLargura: c.width, viewBox: svg.getAttribute('viewBox'),
               ultimoRotuloDentro: ults.right <= s.right + 1,
               corpoRola: document.documentElement.scrollWidth > window.innerWidth + 1 };
    }`);
    expect(r.viewBox).toBe("0 0 288 36");
    expect(r.largura).toBeLessThanOrEqual(r.cartaoLargura + 1);
    expect(r.largura).toBeGreaterThan(200);
    expect(r.ultimoRotuloDentro, '"100 mil" vazou para fora da cunha').toBe(true);
    expect(r.corpoRola, "a página rola na horizontal no celular").toBe(false);
  });

  test("os alvos de toque têm pelo menos 42 px", async () => {
    const pequenos = await roda<string[]>(pg, `() => {
      const maus = [];
      for (const b of document.querySelectorAll('#hud button, .zoom button, .abrir')) {
        const r = b.getBoundingClientRect();
        if (r.height > 0 && r.height < 42) maus.push((b.id || b.className) + ' ' + Math.round(r.height));
      }
      return maus;
    }`);
    expect(pequenos).toEqual([]);
  });
});
