/* Regressões de plataforma: cada teste é um bug já visto em outro lugar.
 *
 * Portados de scripts/test_platforms.py do cantography, onde cada teste trava um
 * defeito achado em iPhone, Android, Firefox ou num navegador sem JavaScript. O
 * WebKit faz as vezes do Safari do iOS: não tem teclado de verdade nem safe-area,
 * então o que depende disso é simulado onde o teste diz.
 *
 * Os três de WebGL (sem WebGL, WebGL por software, perda de contexto) entraram
 * com a migração para o MapLibre, no fim do arquivo. */
import { afterAll, describe, expect, test } from "bun:test";
import { chromium, firefox, type Page } from "playwright";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEX, LENTO, TINTA, abrir, argsGl, copiaSondada, fecharTudo, roda, texto, urlDe } from "./comum";

afterAll(fecharTudo);

const IPHONE = { motor: "webkit", dispositivo: "iPhone 13" } as const;

/** Uma página só para o teste, fechada no fim: cada uma guarda 462 mil trechos. */
async function efemera(o: Parameters<typeof abrir>[1], url = urlDe(INDEX)) {
  const { pg } = await abrir(url, { ...o, fresco: true });
  return { pg, fecha: () => pg.context().close() };
}

const caixa = (pg: Page, seletor: string) =>
  roda<{ x: number; y: number; w: number; h: number }>(pg, `(s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }`, seletor);

const centro = async (pg: Page, seletor: string) => {
  const c = await caixa(pg, seletor);
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
};

describe("celular: a busca do topo", () => {
  test("o campo tem largura útil e as linhas de sugestão não ficam espremidas", async () => {
    /* iPhone: a contagem de resultados espremia a caixa a 0–10 px, e linhas de
       44 px rolavam como 36. Aqui o equivalente é o campo da busca e a altura das
       linhas da lista, que são alvo de toque. */
    const { pg, fecha } = await efemera(IPHONE);
    await pg.tap("#buscaCampo");
    await pg.keyboard.type("rio preto");
    await pg.waitForSelector("#buscaLista li[data-i]");
    await pg.waitForTimeout(400);
    const campo = await caixa(pg, "#buscaCampo");
    expect(campo.w, "o campo da busca ficou sem largura").toBeGreaterThan(150);
    const linhas = await roda<{ h: number; cortada: boolean; x: number; w: number }[]>(pg, `() => {
      const lista = document.getElementById('buscaLista').getBoundingClientRect();
      return [...document.querySelectorAll('#buscaLista li[data-i]')].slice(0, 6).map(l => {
        const r = l.getBoundingClientRect();
        return { h: r.height, cortada: l.scrollHeight > l.clientHeight + 1, x: r.x, w: lista.width };
      });
    }`);
    expect(linhas.length).toBeGreaterThan(3);
    for (const l of linhas) {
      expect(l.h, "linha de sugestão abaixo de 40 px").toBeGreaterThanOrEqual(40);
      expect(l.cortada, "o texto da linha passa da caixa dela").toBe(false);
      expect(l.w).toBeGreaterThan(200);
    }
    // todas com a mesma altura: a lista não redesenha as linhas em outro tamanho
    expect(new Set(linhas.map((l) => Math.round(l.h))).size).toBe(1);
    await fecha();
  }, LENTO);

  test("digitar o nome e dar Enter de uma vez abre o primeiro rio, sem esperar a lista", async () => {
    /* A lista só aparece 120 ms depois da última tecla. O Enter que chega antes
       disso era descartado: nenhum rio abria e o teclado ficava na tela. */
    const { pg, fecha } = await efemera(IPHONE);
    await pg.tap("#buscaCampo");
    await pg.keyboard.type("xingu");
    await pg.keyboard.press("Enter");
    await pg.waitForFunction(
      "document.getElementById('ficha') && document.getElementById('ficha').textContent.includes('Xingu')",
      undefined, { timeout: 8000 });
    expect(await pg.evaluate("document.activeElement.id"), "o foco ficou no campo").not.toBe("buscaCampo");
    await fecha();
  }, LENTO);
});

describe("celular: um toque basta", () => {
  /* O bug clássico: no WebKit, um :hover que muda o layout engole o primeiro
     toque (o dedo "passa o mouse" e só o segundo clica). No Chrome do Android o
     botão tocado ganha foco e um :focus-within do vizinho pode escondê-lo antes
     do clique. O teste é o mesmo nos dois: UM toque e o efeito acontece. */
  for (const [motor, dispositivo] of [["webkit", "iPhone 15 Pro"], ["chromium", "Pixel 7"]] as const) {
    test(`× da busca, barra de baixo e botões de modo respondem a um toque (${dispositivo})`, async () => {
      const { pg, fecha } = await efemera({ motor, dispositivo });
      await pg.tap("#buscaCampo");
      await pg.keyboard.type("xingu");
      await pg.waitForSelector("#buscaLista li[data-i]");
      const c = await centro(pg, "#buscaLimpa");
      await pg.touchscreen.tap(c.x, c.y);
      await pg.waitForTimeout(500);
      expect(await pg.inputValue("#buscaCampo"), "o × não limpou com um toque").toBe("");

      // a barra de baixo: um toque abre, um toque no mesmo fecha
      await pg.tap('#barraBaixo [data-painel="modo"]');
      await pg.waitForTimeout(450);
      expect(await pg.getAttribute('[data-painel="modo"]', "aria-expanded")).toBe("true");
      // o botão de modo, dentro do painel que acabou de abrir
      await pg.tap('.modo[data-modo="esgoto"]');
      await pg.waitForTimeout(400);
      expect(await pg.getAttribute('.modo[data-modo="esgoto"]', "aria-pressed"),
        "o botão de modo pediu dois toques").toBe("true");
      await pg.tap('#barraBaixo [data-painel="modo"]');
      await pg.waitForTimeout(450);
      expect(await pg.getAttribute('[data-painel="modo"]', "aria-expanded")).toBe("false");
      // e a gaveta de cima, que é o outro botão que fica sob o dedo
      await pg.tap("#btSobre");
      await pg.waitForTimeout(400);
      expect(await pg.$eval("#gaveta", (e) => e.classList.contains("on"))).toBe(true);
      await fecha();
    }, LENTO);
  }
});

describe("janela estreita e teclado", () => {
  /* Pontos de Tab que passam da tela, ou que ocupam a vaga de um controle que
     existe: o que importa é que cada parada seja algo que se vê. */
  const PARADA = `() => {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    const r = a.getBoundingClientRect(), cs = getComputedStyle(a);
    return { id: a.id || a.className || a.tagName, w: r.width, h: r.height,
             fora: r.bottom > innerHeight + 1 || r.top < -1 || r.right > innerWidth + 1 || r.left < -1,
             oculto: cs.visibility === 'hidden' || cs.display === 'none',
             inerte: !!a.closest('[inert]'), gaveta: !!a.closest('.gaveta:not(.on)') };
  }`;

  async function percorre(pg: Page, n: number) {
    const paradas: any[] = [];
    for (let k = 0; k < n; k++) {
      await pg.keyboard.press("Tab");
      const p = await roda<any>(pg, PARADA);
      if (p) paradas.push(p);
    }
    return paradas;
  }

  test("em janela estreita o Tab percorre os controles que se veem e o Enter age", async () => {
    /* A 500 px (ou 400 % de zoom) o botão de modo ganhava o foco e sumia, e o
       Enter não fazia nada. Aqui: toda parada do Tab está à vista, e o botão da
       barra de baixo focado pelo teclado abre o painel com Enter. */
    const { pg, fecha } = await efemera({ motor: "chromium", ctx: { viewport: { width: 500, height: 800 } } });
    const paradas = await percorre(pg, 40);
    expect(paradas.length).toBeGreaterThan(5);
    for (const p of paradas) {
      expect(p.oculto, `parada invisível: ${p.id}`).toBe(false);
      expect(p.inerte, `parada dentro de inert: ${p.id}`).toBe(false);
      expect(p.fora, `parada fora da tela: ${p.id}`).toBe(false);
      expect(p.w * p.h, `parada sem área: ${p.id}`).toBeGreaterThan(0);
    }
    await pg.focus('#barraBaixo [data-painel="modo"]');
    expect(await pg.evaluate("document.activeElement.dataset.painel")).toBe("modo");
    await pg.keyboard.press("Enter");
    await pg.waitForTimeout(400);
    expect(await pg.getAttribute('[data-painel="modo"]', "aria-expanded"),
      "o Enter no botão focado não abriu o painel").toBe("true");
    await pg.keyboard.press("Tab");
    // com o painel aberto, o foco segue para dentro dele, e não para fora da tela
    const dentro = await roda<any>(pg, PARADA);
    if (dentro) expect(dentro.fora, `o foco saiu da tela: ${dentro.id}`).toBe(false);
    await fecha();
  }, LENTO);

  test("painéis e gavetas fechados ficam fora da ordem do Tab", async () => {
    /* A ≤ 980 px (celular, ou desktop a 200 %) 58 de 80 paradas do Tab estavam
       fora da tela. Aqui a gaveta fechada fica à direita, fora da vista, e o
       painel recolhido, embaixo: nenhum dos dois pode receber foco. */
    for (const jan of [{ width: 640, height: 450 }, { width: 390, height: 844 }]) {
      const { pg, fecha } = await efemera({ motor: "chromium", ctx: { viewport: jan } });
      const paradas = await percorre(pg, 60);
      const fora = paradas.filter((p) => p.fora || p.gaveta || p.inerte);
      expect(fora.map((p) => p.id), `${jan.width} px: paradas do Tab fora da vista`).toEqual([]);
      await fecha();
    }
  }, LENTO);

  test("o Esc fecha a gaveta aberta e devolve o foco ao botão que a abriu", async () => {
    const { pg, fecha } = await efemera({ motor: "chromium", ctx: { viewport: { width: 390, height: 844 } } });
    await pg.focus("#btSobre");
    await pg.keyboard.press("Enter");
    await pg.waitForTimeout(400);
    expect(await pg.$eval("#gaveta", (e) => e.classList.contains("on"))).toBe(true);
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(400);
    expect(await pg.$eval("#gaveta", (e) => e.classList.contains("on"))).toBe(false);
    await fecha();
  }, LENTO);
});

describe("celular deitado", () => {
  test("a barra, a busca e os botões de topo não ficam sob o notch", async () => {
    /* iPhone deitado: os controles das bordas ficavam sob o notch. O WebKit não
       aplica safe-area, então a página é servida com as do iPhone 15 Pro, como no
       cantography, trocando cada env(safe-area-inset-*) pelo valor.
       Sem `viewport-fit=cover` o Safari já mantém o conteúdo fora do notch e o
       env() vale 0: aí o que se confere é que nada passa das bordas da janela. */
    const ins: Record<string, string> = { left: "59px", right: "59px", top: "0px", bottom: "21px" };
    const html = texto(INDEX).replace(/env\(safe-area-inset-(left|right|top|bottom)\)/g,
      (_, lado) => ins[lado]);
    const url = urlDe(join(mkdtempSync(join(tmpdir(), "rios-")), "index.html"));
    writeFileSync(new URL(url), html, "utf8");
    const cobre = /viewport-fit\s*=\s*cover/.test(html);
    const { pg, fecha } = await efemera({
      motor: "webkit", ctx: { viewport: { width: 852, height: 343 }, isMobile: true, hasTouch: true } }, url);
    await pg.waitForTimeout(500);
    const bordas = await roda<{ s: string; esq: number; dir: number; topo: number; base: number }[]>(pg, `() => {
      const alvos = ['#busca', '.abrir-par', '.zoom', '.credito-sat', '#barraBaixo', '#hud'];
      return alvos.map(s => { const e = document.querySelector(s);
        const r = e.getBoundingClientRect();
        if (!r.width || getComputedStyle(e).display === 'none') return null;
        return { s, esq: r.left, dir: innerWidth - r.right, topo: r.top, base: innerHeight - r.bottom }; })
        .filter(Boolean);
    }`);
    expect(bordas.length, "nenhum controle de borda à vista").toBeGreaterThan(1);
    for (const b of bordas) {
      expect(Math.min(b.esq, b.dir), `${b.s} passa das bordas laterais`).toBeGreaterThanOrEqual(-0.5);
      expect(b.topo, `${b.s} passa do topo`).toBeGreaterThanOrEqual(-0.5);
      if (cobre) expect(Math.min(b.esq, b.dir), `${b.s} sob o notch`).toBeGreaterThanOrEqual(59);
    }
    /* nenhum par de controles de borda se sobrepõe. (O #hudDir fica de fora: deitado,
       a coluna da direita é mais alta que a janela e o zoom passa por cima dela, o
       que é um achado em aberto, não uma regressão desta suíte.) */
    const caixas = await Promise.all(["#busca", ".abrir-par", ".zoom", "#hud"].map(async (s) => [s, await caixa(pg, s)] as const));
    for (let i = 0; i < caixas.length; i++) for (let j = i + 1; j < caixas.length; j++) {
      const [sa, a] = caixas[i], [sb, b] = caixas[j];
      const cruza = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
      expect(cruza, `${sa} e ${sb} se sobrepõem`).toBe(false);
    }
    await fecha();
  }, LENTO);
});

describe("busca: apóstrofo curvo e ligadura", () => {
  test("acha d'Água com apóstrofo reto e curvo, e ﬁ como fi", async () => {
    /* O iOS troca ' por ’ (pontuação inteligente) e o texto colado de PDF traz
       ﬁ: a busca respondia "nenhum rio" nos dois casos. */
    const { pg, fecha } = await efemera({ motor: "chromium" }, copiaSondada());
    const r = await roda<any>(pg, `() => {
      const t = window.__testes; t.montaBusca();
      const com = t.D.nomes.find(n => /^[^']* d'[A-Za-zÀ-ú]+$/.test(n) && /á|a/.test(n)
        && t.buscaRios(n).length) || t.D.nomes.find(n => n.includes("'"));
      const agua = t.D.nomes.find(n => /d'água/i.test(n));
      const figueira = t.D.nomes.find(n => /fi/i.test(n) && !/[ﬀ-ﬆ]/.test(n));
      const conta = s => t.buscaRios(s).length;
      return { com, agua, figueira,
        reto: conta(com), curvo: conta(com.replace(/'/g, '’')),
        aguaReto: conta(agua), aguaCurvo: conta(agua.replace(/'/g, '’')),
        aguaCurvoMaiusc: conta(agua.toUpperCase().replace(/'/g, '’')),
        fi: conta(figueira), lig: conta(figueira.replace(/fi/i, 'ﬁ')) };
    }`);
    expect(r.reto, `nenhum rio para "${r.com}"`).toBeGreaterThan(0);
    expect(r.curvo, `"${r.com}" com apóstrofo curvo`).toBe(r.reto);
    expect(r.aguaReto).toBeGreaterThan(0);
    expect(r.aguaCurvo, `"${r.agua}" com apóstrofo curvo`).toBe(r.aguaReto);
    expect(r.aguaCurvoMaiusc, "caixa alta com apóstrofo curvo").toBe(r.aguaReto);
    expect(r.lig, `"${r.figueira}" com a ligadura ﬁ`).toBe(r.fi);
    await fecha();
  }, LENTO);
});

describe("página que não consegue carregar diz o que houve", () => {
  test("sem DecompressionStream a mensagem aparece, e não o véu de carregamento", async () => {
    /* iOS 15–16.3 (navegadores embutidos em iPhones antigos): mapa vazio. Aqui o
       aviso era escrito atrás do véu "carregando o mapa…", que seguia por cima. */
    const { pg, fecha } = await efemera({ motor: "webkit", init: "delete window.DecompressionStream",
      semEspera: true });
    await pg.waitForSelector("#vazio.on", { timeout: 15_000 });
    expect(await pg.textContent("#vazio")).toContain("não descomprime");
    // o aviso está à vista: o véu de carregamento (z-index 999) já não existe
    expect(await pg.$("#carregando"), "o véu de carregamento ficou por cima da mensagem").toBeNull();
    expect(await pg.isVisible("#vazio")).toBe(true);
    await fecha();
  }, LENTO);

  test("sem JavaScript a página diz que precisa dele, em vez de ficar no véu", async () => {
    /* NoScript, Tor em "Safest": "carregando o mapa…" para sempre. */
    const { pg, fecha } = await efemera({ motor: "chromium", ctx: { javaScriptEnabled: false },
      semEspera: true });
    const texto = await pg.innerText("#carregando");
    expect(texto).toContain("JavaScript");
    expect(texto, "o véu ainda promete o mapa").not.toContain("carregando o mapa");
    expect(await pg.isVisible("#carregando .aro"), "o aro de espera segue girando").toBe(false);
    await fecha();
  }, LENTO);
});

describe("larguras", () => {
  test("nenhuma gaveta nem painel aberto passa da largura da tela no iPhone 13", async () => {
    /* Trava o bug das gavetas cortadas em 36 px à esquerda: width de 100vw com
       padding e sem border-box, ancorada em right: 0. */
    const { pg, fecha } = await efemera({ motor: "webkit", dispositivo: "iPhone 13" });
    const MEDE = `(id) => {
      const e = document.getElementById(id), r = e.getBoundingClientRect();
      const filhos = [...e.querySelectorAll('*')].filter(f => f.getClientRects().length)
        .map(f => f.getBoundingClientRect()).filter(c => c.width);
      return { esq: r.left, dir: r.right, jan: innerWidth,
               rolaLado: e.scrollWidth > e.clientWidth + 1,
               pagRola: document.documentElement.scrollWidth > innerWidth + 1,
               filhoFora: filhos.some(c => c.left < -0.5 || c.right > innerWidth + 0.5) };
    }`;
    for (const [botao, id, fechar] of [
      ["#btProjeto", "gavetaProjeto", "#gavetaProjeto [data-fechar]"],
      ["#btSobre", "gaveta", "#btFechar"]] as const) {
      await pg.click(botao);
      await pg.waitForTimeout(450);
      const m = await roda<any>(pg, MEDE, id);
      expect(m.esq, `${id}: começa à esquerda da tela`).toBeGreaterThanOrEqual(-0.5);
      expect(m.dir, `${id}: passa da borda direita`).toBeLessThanOrEqual(m.jan + 0.5);
      expect(m.rolaLado, `${id}: rola na horizontal`).toBe(false);
      expect(m.filhoFora, `${id}: um elemento interno passa da tela`).toBe(false);
      expect(m.pagRola, `${id}: a página inteira rola na horizontal`).toBe(false);
      // a tabela dos 20 maiores cabe inteira, nas três colunas
      if (id === "gaveta") {
        const tab = await roda<any>(pg, `() => {
          const t = document.querySelector('#gaveta table.tabela').getBoundingClientRect();
          return { esq: t.left, dir: t.right, colunas: document.querySelectorAll('#gaveta table.tabela thead th').length };
        }`);
        expect(tab.colunas).toBe(3);
        expect(tab.esq).toBeGreaterThanOrEqual(0);
        expect(tab.dir).toBeLessThanOrEqual(m.jan);
      }
      // o Fechar continua alcançável
      await pg.click(fechar);
      await pg.waitForTimeout(400);
      expect(await pg.$eval("#" + id, (e) => e.classList.contains("on"))).toBe(false);
    }
    for (const n of ["modo", "camadas", "legenda", "dados", "ficha"]) {
      await pg.click(`[data-painel="${n}"]`);
      await pg.waitForTimeout(400);
      const m = await roda<any>(pg, MEDE, "hud");
      expect(m.esq, `painel ${n}: começa à esquerda da tela`).toBeGreaterThanOrEqual(-0.5);
      expect(m.dir, `painel ${n}: passa da borda direita`).toBeLessThanOrEqual(m.jan + 0.5);
      expect(m.rolaLado, `painel ${n}: rola na horizontal`).toBe(false);
      expect(m.pagRola, `painel ${n}: a página rola na horizontal`).toBe(false);
      await pg.click(`[data-painel="${n}"]`);
      await pg.waitForTimeout(350);
    }
    // a lista de sugestões da busca também sobra sobre o mapa: tem que caber
    await pg.tap("#buscaCampo");
    await pg.keyboard.type("rio preto");
    await pg.waitForSelector("#buscaLista li[data-i]");
    const l = await roda<any>(pg, MEDE, "buscaLista");
    expect(l.esq).toBeGreaterThanOrEqual(-0.5);
    expect(l.dir).toBeLessThanOrEqual(l.jan + 0.5);
    await fecha();
  }, LENTO);
});

describe("WebGL: sem ele, por software e depois de perdê-lo", () => {
  test("sem WebGL a página diz o que falta, em vez de ficar no véu para sempre", async () => {
    /* cantography `test_no_webgl_says_so`: sem WebGL 2 (Tor "mais seguro", GPU na lista
       de bloqueio) a página ficava em "carregando" eternamente. Aqui o aviso ocupa o
       lugar do véu e cita o WebGL. */
    const b = await firefox.launch({ firefoxUserPrefs: { "webgl.disabled": true } });
    try {
      const pg = await (await b.newContext()).newPage();
      const erros: string[] = [];
      pg.on("pageerror", (e) => erros.push(e.message));
      await pg.goto(urlDe(INDEX));
      await pg.waitForFunction("document.getElementById('vazio').textContent.includes('WebGL')", undefined, { timeout: 20_000 });
      expect(await pg.isVisible("#vazio")).toBe(true);
      expect(await pg.$("#carregando"), "o véu de carregamento ficou por cima do aviso").toBeNull();
      expect(erros).toEqual([]);
    } finally { await b.close(); }
  }, LENTO);

  test("WebGL por software avisa, abre plano e mantém o interruptor do 3D à mão", async () => {
    /* cantography `test_software_webgl_says_so`: numa VM ou GPU bloqueada
       (SwiftShader) a linha do tempo levava 8,7 s por quadro. Aqui o mapa abre do
       mesmo jeito — com menos faixas de vazão por quadro —, avisa, começa plano
       mesmo que o link peça 3D, e o interruptor continua disponível. */
    const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    try {
      const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      const erros: string[] = [];
      pg.on("pageerror", (e) => erros.push(e.message));
      await pg.goto(urlDe(INDEX) + "?3d=1");
      await pg.waitForSelector("#carregando", { state: "detached", timeout: 90_000 });
      expect(await pg.isVisible("#avisoSw"), "faltou o aviso de WebGL por software").toBe(true);
      expect(await pg.textContent("#avisoSw")).toContain("por software");
      expect(await pg.getAttribute("#bt3d", "aria-pressed"), "por software o mapa devia abrir plano").toBe("false");
      expect(await pg.isEnabled("#bt3d")).toBe(true);
      await pg.waitForTimeout(2500);
      expect(await roda<number>(pg, TINTA), "o mapa por software não desenhou a rede").toBeGreaterThan(20);
      expect(erros).toEqual([]);
    } finally { await b.close(); }
  }, 150_000);

  test("o WebGL perdido e devolvido (aba em segundo plano no iOS) volta a desenhar a rede", async () => {
    /* cantography `test_lamps_come_back_after_context_loss`: o iOS descarta o WebGL
       de uma aba em segundo plano e as lâmpadas nunca mais eram desenhadas. Aqui as
       duas camadas próprias recriam shaders, buffers e texturas dos mesmos dados. */
    const b = await chromium.launch({ args: argsGl("chromium") });
    try {
      const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      const erros: string[] = [];
      pg.on("pageerror", (e) => erros.push(e.message));
      await pg.goto(urlDe(INDEX));
      await pg.waitForSelector("#carregando", { state: "detached", timeout: 60_000 });
      await pg.waitForTimeout(800);
      expect(await roda<number>(pg, TINTA)).toBeGreaterThan(20);
      await pg.evaluate(`window.__x = document.getElementById('cv').getContext('webgl2').getExtension('WEBGL_lose_context'); __x.loseContext()`);
      await pg.waitForTimeout(800);
      await pg.evaluate("__x.restoreContext()");
      await pg.waitForFunction("!document.getElementById('cv').getContext('webgl2').isContextLost()", undefined, { timeout: 10_000 });
      await pg.waitForTimeout(1500);
      // o clique de zoom força um quadro novo, e os tons voltam ao canvas
      await pg.click("#btMais");
      await pg.waitForTimeout(1200);
      expect(await roda<number>(pg, TINTA), "a rede não voltou depois do contexto restaurado").toBeGreaterThan(20);
      expect(erros).toEqual([]);
    } finally { await b.close(); }
  }, LENTO);
});
