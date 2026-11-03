/* A busca de rio no index.html, num arquivo próprio: abrir a página custa ~9 s por
 * cópia e o mapa.test.ts já sozinho passava de 3 min. Rodando como processo à parte
 * (ver testes/roda.ts) as duas metades andam em paralelo. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright";
import { LENTO, INDEX, abrir, copiaSondada, fecharTudo, reinicia, roda, urlDe } from "./comum";

let pg: Page;
let sonda: Page;          // cópia com window.__testes

beforeAll(async () => {
  ({ pg } = await abrir(urlDe(INDEX)));
  sonda = (await abrir(copiaSondada(), { fresco: true })).pg;
}, LENTO);

afterAll(async () => { await fecharTudo(); });

// quantos pixels do canvas do fundo não são a cor de fundo
const TINTA = `() => {
  const c = document.getElementById('cv');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const set = new Set();
  for (let i = 0; i < d.length; i += 4 * 977) set.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
  return set.size;
}`;

describe("busca de rio", () => {
  const sugestoes = (p: Page) =>
    p.$$eval("#buscaLista li[data-i]", (e) => e.map((l) => ({
      nome: l.querySelector(".busca-nome")!.textContent!,
      meta: l.querySelector(".busca-meta")!.textContent!,
    })));

  async function digita(texto: string) {
    await pg.fill("#buscaCampo", texto);
    await pg.waitForTimeout(400);      // 120 ms de debounce, com folga
  }

  test("o índice cobre os 82.604 rios com nome, não os 38 mil nomes", async () => {
    // o grão é o grupo de rioDe — nome MAIS conectividade. Cair para o número de
    // nomes significa que a busca voltou a fundir homônimos sem relação.
    expect(await roda<number>(sonda, "() => window.__testes.montaBusca()")).toBe(82_604);
  });

  test("acha o rio pelo nome, sem acento e em qualquer caixa", async () => {
    await reinicia(pg);
    await digita("são franc");
    const comAcento = await sugestoes(pg);
    expect(comAcento[0].nome).toBe("Rio São Francisco");
    // a maior vazão primeiro: é o desempate entre os homônimos
    expect(comAcento[0].meta).toContain("BA/AL");
    await digita("SAO FRANC");
    expect((await sugestoes(pg))[0]).toEqual(comAcento[0]);
  }, LENTO);

  test("uma letra só não abre a lista", async () => {
    await reinicia(pg);
    await digita("r");
    expect(await pg.$eval("#buscaLista", (e) => (e as HTMLElement).hidden)).toBe(true);
  });

  test("nome sem correspondência avisa em vez de abrir lista vazia", async () => {
    await reinicia(pg);
    await digita("zzqx");
    expect(await sugestoes(pg)).toHaveLength(0);
    expect(await pg.textContent("#buscaLista")).toContain("Nenhum rio");
  });

  test("homônimos saem separados, com UF e em vazão decrescente", async () => {
    // "Rio Preto" são 1.165 trechos em dezenas de rios sem relação nenhuma.
    // Agrupá-los pelo nome daria uma linha só, com bbox do tamanho do Brasil.
    await reinicia(pg);
    await digita("rio preto");
    const r = await sugestoes(pg);
    expect(r.length).toBeGreaterThan(3);
    expect(r.filter((x) => x.nome === "Rio Preto").length).toBeGreaterThan(2);
    const ufs = new Set(r.map((x) => x.meta.split(" · ")[0]));
    expect(ufs.size, "todos os homônimos caíram no mesmo estado").toBeGreaterThan(1);
    const vazoes = r.map((x) => parseFloat(x.meta.split(" · ")[1].replace(/\./g, "").replace(",", ".")));
    for (let i = 1; i < vazoes.length; i++) expect(vazoes[i]).toBeLessThanOrEqual(vazoes[i - 1]);
  }, LENTO);

  test("rio fora do Brasil não ganha UF inventada", async () => {
    // o Solimões-Amazonas e os do Prata estão no mapa e correm por fora dos
    // contornos: point-in-polygon sem casamento tem que sair em branco
    const r = await roda<any[]>(sonda, "(s) => window.__testes.buscaRios(s)", "amazonas");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => /^[A-Z]{2}(\/[A-Z]{2})?$|^$/.test(x.uf)),
      "saiu sigla que não é UF: " + r.map((x) => x.uf).join()).toBe(true);
  });

  test("escolher um resultado voa até o rio e abre a ficha dele", async () => {
    await reinicia(pg);
    const antes = await roda<number>(pg, TINTA);
    await digita("xingu");
    await pg.click("#buscaLista li:first-child");
    await pg.waitForTimeout(1200);      // 500 ms de voo, com folga
    expect(await roda<number>(pg, TINTA), "o mapa não se mexeu").not.toBe(antes);
    expect(await pg.textContent("#ficha")).toContain("Rio Xingu");
    expect(await pg.$eval("#buscaLista", (e) => (e as HTMLElement).hidden)).toBe(true);
  }, LENTO);

  test("o enquadramento cobre o rio inteiro, não o trecho de maior vazão", async () => {
    // o clique na tabela dos vinte maiores enquadra UM trecho e por isso divide a
    // largura por 6; aqui a caixa é do curso todo, e o mesmo divisor cortaria as
    // pontas do Xingu fora da tela
    const caixa = await roda<any>(sonda, `(nome) => {
      const t = window.__testes;
      const alvo = t.buscaRios(nome)[0];
      t.vaiAoRio(alvo.i);
      let minx = 1, miny = 1, maxx = 0, maxy = 0;
      for (const s of t.trechosDoRio(alvo.i)) {
        const b = s * 4;
        if (t.bbox[b] < minx) minx = t.bbox[b];
        if (t.bbox[b + 1] < miny) miny = t.bbox[b + 1];
        if (t.bbox[b + 2] > maxx) maxx = t.bbox[b + 2];
        if (t.bbox[b + 3] > maxy) maxy = t.bbox[b + 3];
      }
      return { minx, miny, maxx, maxy };
    }`, "xingu");
    await sonda.waitForTimeout(1200);          // o voo dura 500 ms
    const r = await roda<any>(sonda, `(c) => {
      const v = window.__testes.vista;
      return { larg: (c.maxx - c.minx) * v.k, alt: (c.maxy - c.miny) * v.k,
               jan: [window.innerWidth, window.innerHeight] };
    }`, caixa);
    // a caixa do rio cabe na tela, e não sobra tanto espaço que o rio suma
    expect(r.larg).toBeLessThanOrEqual(r.jan[0]);
    expect(r.alt).toBeLessThanOrEqual(r.jan[1]);
    expect(Math.max(r.larg / r.jan[0], r.alt / r.jan[1]),
      "o rio ficou minúsculo no meio da tela").toBeGreaterThan(0.3);
    await sonda.click("#btReset");
  }, LENTO);

  test("as setas andam pela lista e o Enter escolhe o item marcado", async () => {
    await reinicia(pg);
    await digita("rio preto");
    const segundo = (await sugestoes(pg))[1];
    await pg.press("#buscaCampo", "ArrowDown");
    await pg.press("#buscaCampo", "Enter");
    await pg.waitForTimeout(1200);
    expect(await pg.textContent("#ficha")).toContain(segundo.nome);
  }, LENTO);

  test("Esc fecha a lista sem mover o mapa", async () => {
    await reinicia(pg);
    const antes = await roda<number>(pg, TINTA);
    await digita("doce");
    expect(await pg.$eval("#buscaLista", (e) => (e as HTMLElement).hidden)).toBe(false);
    await pg.press("#buscaCampo", "Escape");
    await pg.waitForTimeout(300);
    expect(await pg.$eval("#buscaLista", (e) => (e as HTMLElement).hidden)).toBe(true);
    expect(await roda<number>(pg, TINTA)).toBe(antes);
  }, LENTO);
});
