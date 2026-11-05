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
      h1Escondido: getComputedStyle(document.querySelector('.titulo-cartao h1')).display,
    })`);
    expect(r.larguraCss).toBeLessThan(500);
    expect(r.dpr).toBeGreaterThan(1);
    expect(r.disparou, "a media query de celular não disparou — <meta viewport>?").toBe(true);
    expect(r.h1Escondido).toBe("none");
  });

  test("a barra de baixo abre com todos os painéis fechados e o modo dá nome ao botão", async () => {
    const { pg: p } = await abrir(`${urlDe(INDEX)}?mapa=outorga`,
      { dispositivo: "iPhone 13", fresco: true });
    expect(await p.$eval("#hud", (e) => e.classList.contains("recolhido"))).toBe(true);
    expect(await p.$eval("#hud", (e: any) => e.inert), "painel fechado precisa de inert").toBe(true);
    const botoes = await p.$$eval("#barraBaixo [data-painel]", (bs) =>
      bs.map((b) => [b.getAttribute("data-painel"), b.getAttribute("aria-expanded")]));
    expect(botoes).toEqual([["modo", "false"], ["camadas", "false"], ["legenda", "false"],
                            ["dados", "false"], ["ficha", "false"]]);
    expect(await p.getAttribute("#btPModo", "title")).toBe("Os rios do Brasil, por licença de retirada");
    await p.click('[data-painel="modo"]');
    await p.waitForTimeout(400);
    expect(await p.$eval("#hud", (e) => e.classList.contains("recolhido"))).toBe(false);
    expect(await p.getAttribute('[data-painel="modo"]', "aria-expanded")).toBe("true");
    await p.close();
  }, LENTO);

  test("um painel por vez: trocar de botão troca o painel e tocar de novo no ativo fecha", async () => {
    const { pg: p } = await abrir(urlDe(INDEX), { dispositivo: "iPhone 13", fresco: true });
    const ESTADO = `() => {
      const hud = document.getElementById('hud');
      const vis = [...hud.querySelectorAll('[data-p]')]
        .filter(c => getComputedStyle(c).display !== 'none' && !c.inert).map(c => c.dataset.p);
      return { recolhido: hud.classList.contains('recolhido'), inertHud: hud.inert,
               vis: [...new Set(vis)],
               exp: [...document.querySelectorAll('#barraBaixo [data-painel]')]
                      .filter(b => b.getAttribute('aria-expanded') === 'true').map(b => b.dataset.painel) };
    }`;
    for (const n of ["modo", "camadas", "legenda", "dados", "ficha"]) {
      await p.click(`[data-painel="${n}"]`);
      await p.waitForTimeout(300);
      const e = await roda<any>(p, ESTADO);
      expect(e.recolhido, n).toBe(false);
      expect(e.inertHud, n).toBe(false);
      expect(e.vis, `só o painel ${n} pode estar à vista`).toEqual([n]);
      expect(e.exp).toEqual([n]);
    }
    await p.click('[data-painel="ficha"]');
    await p.waitForTimeout(400);
    const f = await roda<any>(p, ESTADO);
    expect(f.recolhido).toBe(true);
    expect(f.inertHud, "fechado, o painel inteiro fica inert").toBe(true);
    expect(f.vis).toEqual([]);
    expect(f.exp).toEqual([]);
    // Esc fecha e devolve o foco ao botão
    await p.click('[data-painel="camadas"]');
    await p.waitForTimeout(300);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
    expect((await roda<any>(p, ESTADO)).recolhido, "Esc não fechou o painel").toBe(true);
    expect(await p.evaluate(() => (document.activeElement as HTMLElement)?.dataset.painel)).toBe("camadas");
    await p.close();
  }, LENTO);

  test("tocar num rio abre a ficha sozinho, mesmo com outro painel aberto", async () => {
    const { pg: p } = await abrir(urlDe(INDEX), { dispositivo: "iPhone 13", fresco: true });
    await p.click('[data-painel="legenda"]');
    await p.waitForTimeout(300);
    let achou = false;
    for (let y = 250; y < 560 && !achou; y += 20)
      for (let x = 60; x < 340 && !achou; x += 20) {
        await p.mouse.click(x, y);
        achou = await p.$eval("#hud", (e) => e.dataset.aberto === "ficha");
      }
    expect(achou, "nenhum toque achou rio").toBe(true);
    expect(await p.getAttribute('[data-painel="ficha"]', "aria-expanded")).toBe("true");
    expect(await p.$eval("#hud", (e) => e.classList.contains("recolhido"))).toBe(false);
    await p.close();
  }, LENTO);

  test("cada painel cabe entre o topo e a barra de baixo e rola até o fim", async () => {
    for (const n of ["modo", "camadas", "legenda", "dados", "ficha"]) {
      await pg.click(`[data-painel="${n}"]`);
      await pg.waitForTimeout(350);
      const r = await roda<any>(pg, `() => {
        const h = document.getElementById('hud');
        const barra = document.getElementById('barraBaixo').getBoundingClientRect();
        h.scrollTop = h.scrollHeight;
        const cs = [...h.querySelectorAll('[data-p]')].filter(c => getComputedStyle(c).display !== 'none');
        const ult = cs[cs.length - 1].getBoundingClientRect();
        const hb = h.getBoundingClientRect();
        return { n: cs.length, hBase: hb.bottom, hTopo: hb.top, barraTopo: barra.top,
                 overflow: getComputedStyle(h).overflowY,
                 ultimoVisivel: ult.bottom <= hb.bottom + 1 };
      }`);
      expect(r.n, n).toBeGreaterThan(0);
      expect(r.overflow).toBe("auto");
      expect(r.hBase, `${n}: o painel passa por baixo da barra`).toBeLessThanOrEqual(r.barraTopo + 1);
      expect(r.hTopo, `${n}: o painel invade a busca`).toBeGreaterThan(70);
      expect(r.ultimoVisivel, `${n}: o fim do painel não é alcançável`).toBe(true);
      await pg.click(`[data-painel="${n}"]`);
      await pg.waitForTimeout(300);
    }
  });

  test("a coluna da direita se desfaz e os cartões voltam para o painel", async () => {
    await pg.click('[data-painel="modo"]');
    await pg.waitForTimeout(300);
    const r = await roda<any>(pg, `() => {
      const h = document.getElementById('hud');
      // ordem visual, que difere da do DOM por causa dos order
      const vis = [...h.querySelectorAll('.cartao')]
        .filter(d => getComputedStyle(d).display !== 'none')
        .map(d => ({ nome: d.querySelector('h1,h2')?.textContent ?? d.id,
                     topo: d.getBoundingClientRect().top }))
        .sort((a, b) => a.topo - b.topo).map(v => v.nome);
      return { display: getComputedStyle(document.getElementById('hudDir')).display,
               posModo: getComputedStyle(document.getElementById('cartaoModo')).position,
               vis };
    }`);
    expect(r.display, "o embrulho não se desfez no celular").toBe("contents");
    expect(r.posModo, "o cartão ficou preso na coluna fixa do desktop").not.toBe("fixed");
    // o painel Modo junta os dois cartões; os outros ficam escondidos
    expect(r.vis).toEqual(["O que ver", "Detalhe da rede"]);
  });

  test("a busca fica no topo com a gaveta recolhida, sem cobrir os botões de ícone", async () => {
    /* A regressão que isto trava: pôr o campo dentro do #hud. A gaveta recolhida
       ganha `transform: translateY()`, e ancestral com transform vira bloco
       contentor de descendente `position: fixed` — o campo desceria junto com ela
       e sairia da tela, justamente no estado em que mais se quer buscar. */
    const { pg: p } = await abrir(urlDe(INDEX), { dispositivo: "iPhone 13", fresco: true });
    expect(await p.$eval("#hud", (e) => e.classList.contains("recolhido"))).toBe(true);
    const r = await roda<any>(p, `() => {
      const b = document.getElementById('busca').getBoundingClientRect();
      const a = document.querySelector('.abrir').getBoundingClientRect();
      return { bTopo: b.top, bBase: b.bottom, bDir: b.right, aEsq: a.left,
               altura: window.innerHeight };
    }`);
    expect(r.bTopo, "o campo desceu junto com a gaveta").toBeLessThan(r.altura / 3);
    expect(r.bDir, "a busca cobre o 'Tabela e método'").toBeLessThanOrEqual(r.aEsq);
    // e alcança 44 px de alvo de toque, como o resto dos controles
    expect(r.bBase - r.bTopo).toBeGreaterThanOrEqual(44);
    await p.close();
  }, LENTO);

  test("a barra da legenda encolhe em vez de cortar, e o eixo não colide", async () => {
    /* A barra tem viewBox — ao contrário dos gráficos do series.html —, então
       `width: 100%` a reduz junto com os rótulos. O que ainda pode dar errado é
       "10 mil" encostar em "100 mil" na largura de celular. */
    const r = await roda<any>(pg, `() => {
      const el = document.getElementById('classes');
      const c = el.closest('.cartao').getBoundingClientRect();
      const svg = el.querySelector('svg').getBoundingClientRect();
      const rot = [...el.querySelectorAll('svg text')]
        .map(t => ({ txt: t.textContent, cx: t.getBoundingClientRect() }))
        .sort((a, b) => a.cx.left - b.cx.left);
      const colidem = rot.filter((r, i) => i && r.cx.left < rot[i - 1].cx.right - 0.5)
                         .map(r => r.txt);
      return { n: el.querySelectorAll('svg rect').length,
               vaza: svg.right > c.right + 1 || svg.left < c.left - 1,
               colidem,
               corpoRola: document.documentElement.scrollWidth > window.innerWidth + 1 };
    }`);
    expect(r.n).toBe(7);
    expect(r.vaza, "a barra passou da borda do cartão").toBe(false);
    expect(r.colidem, "rótulos do eixo se sobrepondo").toEqual([]);
    expect(r.corpoRola, "a página rola na horizontal no celular").toBe(false);
  });

  test("fechado, o painel sai do alcance do foco; aberto, só o cartão do painel recebe foco", async () => {
    /* Fora da tela, o painel seguiria no caminho do teclado e do leitor de tela
       sem nada à vista. `inert` no #hud (fechado) e nos cartões de outros painéis. */
    const { pg: p } = await abrir(urlDe(INDEX), { dispositivo: "iPhone 13", fresco: true });
    const ESTADO = `() => {
      const alvo = document.querySelector('.modo[data-modo="esgoto"]');
      alvo.focus();
      const outro = document.getElementById('btEst');
      outro.focus();
      return { pegouModo: document.activeElement === alvo, pegouCamada: document.activeElement === outro,
               barraLivre: !document.getElementById('barraBaixo').closest('[inert]') };
    }`;
    const fechado = await roda<any>(p, ESTADO);
    expect(fechado.pegouModo, "um botão invisível recebeu foco").toBe(false);
    expect(fechado.pegouCamada, "um botão invisível recebeu foco").toBe(false);
    expect(fechado.barraLivre, "a barra foi junto — não há como reabrir").toBe(true);
    await p.click('[data-painel="modo"]');
    await p.waitForTimeout(400);
    const modo = await roda<any>(p, ESTADO);
    expect(modo.pegouModo).toBe(true);
    expect(modo.pegouCamada, "cartão de outro painel recebeu foco").toBe(false);
    await p.close();
  }, LENTO);

  test("os alvos de toque têm pelo menos 44 px", async () => {
    await pg.click('[data-painel="modo"]');     // medir com o painel aberto: fechado, o #hud é inert e sem caixa visível
    await pg.waitForTimeout(350);
    // link e range entram junto: os dois não são <button> e escapavam da regra
    const pequenos = await roda<string[]>(pg, `() => {
      const maus = [];
      for (const b of document.querySelectorAll(
             '#hud button, #hud a[href], #hud input, .zoom button, .abrir, #barraBaixo button')) {
        const r = b.getBoundingClientRect();
        if (r.height > 0 && r.height < 44) maus.push((b.id || b.className) + ' ' + Math.round(r.height));
      }
      return maus;
    }`);
    expect(pequenos).toEqual([]);
  });
});
