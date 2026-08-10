/* O series.html. Menos superfície que o mapa, mas duas armadilhas próprias: os
 * gráficos são SVG sem viewBox — de propósito — e a página inteira só aparece
 * depois de dois DecompressionStream, então um erro ali deixa um "descomprimindo
 * as séries…" parado na tela em vez de uma página quebrada. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright";
import { LENTO, SERIES, abrir, fecharTudo, roda, urlDe } from "./comum";

let pg: Page;
let erros: string[];

beforeAll(async () => {
  ({ pg, erros } = await abrir(urlDe(SERIES)));
}, LENTO);

afterAll(fecharTudo);

describe("series.html", () => {
  test("descomprime e troca o aviso de carregamento pela página", async () => {
    expect(erros).toEqual([]);
    // o aviso sai do DOM quando os dois gzip terminam; se ficar, travou
    expect(await pg.$("#carregando")).toBeNull();
    expect(await pg.$eval("#pagina", (e) => e.hasAttribute("hidden"))).toBe(false);
    expect(await pg.$eval("#pagina", (e) => e.children.length)).toBeGreaterThan(3);
    // o total de anos é escrito pelo script; "…" parado significa que travou
    expect(await pg.textContent("#totAnos")).toMatch(/^[\d.]+$/);
  });

  test("os painéis principais estão na página", async () => {
    const txt = (await pg.textContent("#pagina")) ?? "";
    for (const t of ["tendência", "seco", "cheia"]) {
      expect(txt.toLowerCase(), `sem painel de ${t}`).toContain(t);
    }
    expect(await pg.$$eval("#pagina svg", (e) => e.length)).toBeGreaterThan(3);
  });

  /* Os SVG não têm viewBox: `max-width: 100%` neles cortaria a metade direita
     em vez de encolher, e não haveria como alcançá-la. Quem rola é o .svgwrap. */
  test("o gráfico rola dentro do .svgwrap, e a página não rola de lado", async () => {
    const r = await roda<any>(pg, `() => {
      const wraps = [...document.querySelectorAll('.svgwrap')];
      return {
        n: wraps.length,
        overflow: wraps.map(w => getComputedStyle(w).overflowX).filter((v, i, a) => a.indexOf(v) === i),
        comViewBox: wraps.map(w => w.querySelector('svg')?.getAttribute('viewBox')).filter(Boolean).length,
        corpoRola: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    }`);
    expect(r.n).toBeGreaterThan(3);
    expect(r.overflow).toEqual(["auto"]);
    expect(r.comViewBox, "um SVG ganhou viewBox — max-width nele passa a encolher").toBe(0);
    expect(r.corpoRola, "a página rola na horizontal").toBe(false);
  });

  test("no celular o gráfico largo rola e avisa que rola", async () => {
    const { pg: m } = await abrir(urlDe(SERIES), { dispositivo: "iPhone 13", fresco: true });
    const r = await roda<any>(m, `() => {
      const wraps = [...document.querySelectorAll('.svgwrap')];
      const rolam = wraps.filter(w => w.scrollWidth > w.clientWidth + 1);
      return { total: wraps.length, rolam: rolam.length,
               avisam: rolam.filter(w => w.classList.contains('rola') || w.classList.contains('meio')).length,
               corpoRola: document.documentElement.scrollWidth > window.innerWidth + 1 };
    }`);
    expect(r.rolam, "nenhum gráfico rola no celular — encolheram cortando?").toBeGreaterThan(0);
    expect(r.avisam, "gráfico que rola sem a marca .rola").toBe(r.rolam);
    expect(r.corpoRola).toBe(false);
  }, LENTO);

  test("o link para o mapa aponta para o index e leva ao modo vazão", async () => {
    const href = await pg.getAttribute('.abertura a[href="index.html"]', "href");
    expect(href).toBe("index.html");
    const volta = await pg.$$eval("a", (e) => e.map((a) => a.getAttribute("href")));
    expect(volta).toContain("index.html");
  });
});
