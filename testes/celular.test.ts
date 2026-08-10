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
      // .cartao, não h.children: o embrulho .hud-dir é display:contents e não
      // tem caixa própria para medir
      const vis = [...h.querySelectorAll('.cartao')].map(d => ({
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

  test("a coluna da direita se desfaz e os seis cartões voltam para a gaveta", async () => {
    const r = await roda<any>(pg, `() => {
      const h = document.getElementById('hud');
      // ordem visual, que difere da do DOM por causa dos order
      const vis = [...h.querySelectorAll('.cartao')]
        .map(d => ({ nome: d.querySelector('h1,h2')?.textContent ?? d.id,
                     topo: d.getBoundingClientRect().top }))
        .sort((a, b) => a.topo - b.topo).map(v => v.nome);
      return { display: getComputedStyle(document.getElementById('hudDir')).display,
               posModo: getComputedStyle(document.getElementById('cartaoModo')).position,
               vis };
    }`);
    expect(r.display, "o embrulho não se desfez no celular").toBe("contents");
    expect(r.posModo, "o cartão ficou preso na coluna fixa do desktop").not.toBe("fixed");
    expect(r.vis).toEqual(["ficha", "Detalhe da rede", "Camadas", "Vazão média (m³/s)",
                           "O que ver", "Os rios do Brasil, por vazão"]);
  });

  test("o puxador continua alcançável com a gaveta rolada", async () => {
    await pg.evaluate(() => {
      const h = document.getElementById("hud")!;
      h.classList.remove("recolhido");
      h.scrollTop = h.scrollHeight;
    });
    await pg.waitForTimeout(300);
    const r = await roda<any>(pg, `() => {
      const h = document.getElementById('hud'), p = document.getElementById('puxador');
      const hb = h.getBoundingClientRect(), pb = p.getBoundingClientRect();
      return { grudado: getComputedStyle(p).position,
               noTopo: Math.abs(pb.top - hb.top) < 2, rolou: h.scrollTop > 50 };
    }`);
    expect(r.rolou, "a gaveta não rolou — nada a testar").toBe(true);
    expect(r.grudado).toBe("sticky");
    expect(r.noTopo, "o puxador rolou para fora: a faixa recolhida mostraria um cartão")
      .toBe(true);
  });

  test("a rolagem por toque funciona, não só o scrollTop", async () => {
    /* Pelo puxador, e não tirando a classe na mão: é o caminho que também tira
       o `inert` dos cartões. Com eles inertes a roda atravessa para o mapa, que
       é o comportamento certo enquanto a gaveta está fechada. */
    if (!(await pg.$eval("#hud", (e) => e.classList.contains("recolhido")))) {
      await pg.click("#puxador");     // testes anteriores mexem na classe na mão
      await pg.waitForTimeout(400);
    }
    await pg.click("#puxador");
    await pg.waitForTimeout(400);
    await pg.evaluate(() => { document.getElementById("hud")!.scrollTop = 0; });
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

  test("as sete faixas da legenda cabem na largura do cartão", async () => {
    /* "5.400 – 43.000" e "acima de 43.000" são os rótulos mais largos da
       página, e a grade de duas colunas dá pouco mais de 130 px a cada um. */
    const r = await roda<any>(pg, `() => {
      const el = document.getElementById('classes');
      const c = el.closest('.cartao').getBoundingClientRect();
      const linhas = [...el.querySelectorAll('.classe')];
      return { n: linhas.length,
               vazam: linhas.filter(l => l.getBoundingClientRect().right > c.right + 1)
                            .map(l => l.textContent),
               transbordam: linhas.filter(l => l.scrollWidth > l.clientWidth + 1)
                                  .map(l => l.textContent),
               corpoRola: document.documentElement.scrollWidth > window.innerWidth + 1 };
    }`);
    expect(r.n).toBe(7);
    expect(r.vazam, "faixa passou da borda do cartão").toEqual([]);
    expect(r.transbordam, "rótulo maior que a célula da grade").toEqual([]);
    expect(r.corpoRola, "a página rola na horizontal no celular").toBe(false);
  });

  test("recolhido, os cartões saem do alcance do foco", async () => {
    /* Fora da tela e sem como rolar até eles: quem rola é a gaveta, que está
       fechada. Sem `inert`, dez controles seguiam no caminho do teclado e do
       leitor de tela, anunciando painéis que não estavam à vista. */
    const { pg: p } = await abrir(urlDe(INDEX), { dispositivo: "iPhone 13", fresco: true });
    const ESTADO = `() => {
      const hud = document.getElementById('hud');
      const alvo = document.querySelector('.modo[data-modo="esgoto"]');
      alvo.focus();
      const cartoes = [...hud.querySelectorAll('.cartao')];
      return { inertes: cartoes.filter(c => c.inert).length, total: cartoes.length,
               pegouFoco: document.activeElement === alvo,
               puxadorLivre: !document.getElementById('puxador').closest('[inert]') };
    }`;
    const fechado = await roda<any>(p, ESTADO);
    expect(fechado.total).toBeGreaterThan(3);
    expect(fechado.inertes, "cartão fora da tela ainda no caminho do foco").toBe(fechado.total);
    expect(fechado.pegouFoco, "um botão invisível recebeu foco").toBe(false);
    expect(fechado.puxadorLivre, "o puxador foi junto — não há como reabrir").toBe(true);

    await p.click("#puxador");
    await p.waitForTimeout(400);
    const aberto = await roda<any>(p, ESTADO);
    expect(aberto.inertes, "a gaveta abriu e os cartões seguiram inertes").toBe(0);
    expect(aberto.pegouFoco).toBe(true);
  }, LENTO);

  test("os alvos de toque têm pelo menos 42 px", async () => {
    // link e range entram junto: os dois não são <button> e escapavam da regra
    const pequenos = await roda<string[]>(pg, `() => {
      const maus = [];
      for (const b of document.querySelectorAll(
             '#hud button, #hud a[href], #hud input, .zoom button, .abrir')) {
        const r = b.getBoundingClientRect();
        if (r.height > 0 && r.height < 42) maus.push((b.id || b.className) + ' ' + Math.round(r.height));
      }
      return maus;
    }`);
    expect(pequenos).toEqual([]);
  });
});
