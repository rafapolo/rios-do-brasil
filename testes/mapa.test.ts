/* O index.html rodando: dados, legenda, ficha, camadas, modos e URL.
 * Tudo no chromium — a checagem entre motores fica em navegadores.test.ts. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright";
import { LENTO, INDEX, abrir, amostras, copiaSondada, eixoLegenda, fecharTudo, reinicia, roda, servidor, urlDe } from "./comum";

let pg: Page;
let erros: string[];
let sonda: Page;          // cópia com window.__testes
let base: string;         // servidor http
let parar: () => void;

beforeAll(async () => {
  ({ base, parar } = servidor());
  ({ pg, erros } = await abrir(urlDe(INDEX)));
  sonda = (await abrir(copiaSondada(), { fresco: true })).pg;
}, LENTO);

afterAll(async () => { parar(); await fecharTudo(); });

const modoAtivo = (p: Page) =>
  p.$$eval(".modo", (e) =>
    (e.find((b) => b.getAttribute("aria-pressed") === "true") as HTMLElement | undefined)?.dataset.modo);

// quantos pixels do canvas do fundo não são a cor de fundo
const TINTA = `() => {
  const c = document.getElementById('cv');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const set = new Set();
  for (let i = 0; i < d.length; i += 4 * 977) set.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
  return set.size;
}`;

describe("carregamento", () => {
  test("abre por file:// sem erro, pinta a rede e cita as fontes", async () => {
    expect(erros).toEqual([]);
    await reinicia(pg);
    // mais de um tom no canvas: a rede foi desenhada, não só o fundo
    expect(await roda<number>(pg, TINTA)).toBeGreaterThan(20);
    const t = (await pg.textContent("#rodape")) ?? "";
    expect(t).toContain("Base Hidrográfica Ottocodificada");
    expect(t).toContain("ANA");
  });

  test("desenha os 462.539 trechos da base", async () => {
    expect(await roda(sonda, "() => window.__testes.N")).toBe(462539);
  });
});

describe("legenda em barra log", () => {
  test("tem sete tons distintos e o eixo vai do córrego ao Amazonas", async () => {
    await reinicia(pg);
    const tons = await amostras(pg);
    expect(tons).toHaveLength(7);
    expect(new Set(tons).size).toBe(7);
    /* Os cortes são os da própria cor(), e a barra mostra os sete tons inteiros.
       Nenhuma lista de seis faixas cobria as 5,4 décadas: parava em "acima de
       500" e deixava sem entrada os dois azuis mais escuros, que é onde estão
       Amazonas, Solimões, Madeira e Negro. */
    expect(await eixoLegenda(pg)).toEqual(["1", "10", "100", "1.000", "10 mil", "100 mil"]);
  });

  test("a cunha engrossa da esquerda para a direita, pela mesma largura()", async () => {
    /* A silhueta tem 61 pontos no topo e volta pela base. Se o y do primeiro
       ponto não estiver abaixo do y do último, a cunha virou retângulo — e a
       espessura, que no mapa é vazão, teria deixado de dizer isso. */
    const d = await pg.$eval("#classes svg clipPath path", (p) => p.getAttribute("d") ?? "");
    const ys = d.replace("M", "").split("L").map((p) => parseFloat(p.split(",")[1]));
    expect(ys.length).toBe(122);
    expect(ys[0]).toBeGreaterThan(ys[60]);        // topo sobe
    expect(ys[60]).toBeLessThan(12);              // e passa da linha de meio
  });

  test("a cunha só existe onde a espessura é dado", async () => {
    // nos três modos de porcentagem o traço do mapa engrossa pela vazão do rio,
    // não pela métrica pintada: uma cunha ali diria que rio gordo é rio sujo
    for (const m of ["esgoto", "industria", "outorga"]) {
      await pg.click(`.modo[data-modo="${m}"]`);
      await pg.waitForTimeout(300);
      expect(await pg.$$eval("#classes svg rect", (e) => e.length), m).toBe(7);
      expect(await pg.$$eval("#classes svg clipPath", (e) => e.length),
             `${m}: a barra saiu em cunha`).toBe(0);
    }
    await reinicia(pg);
  });

  test("as cores saem da mesma cor() que pinta o mapa", async () => {
    // o fill do rect e o retorno de cor() são a mesma string: os dois saem do
    // token CSS lido por lerCores(), sem passar por serializador nenhum
    const ok = await roda(sonda, `() => {
      const t = window.__testes;
      const L0 = Math.log10(0.5), L1 = Math.log10(120000);
      return [...document.querySelectorAll('#classes svg rect')].every((r, i) =>
        r.getAttribute('fill') === t.cor(Math.pow(10, L0 + (i / 6) * (L1 - L0))));
    }`);
    expect(ok).toBe(true);
  });

  test("a indústria varia opacidade, não matiz", async () => {
    await pg.click('.modo[data-modo="industria"]');
    await pg.waitForTimeout(300);
    const tons = await amostras(pg);
    expect(new Set(tons).size, "a indústria é cor única").toBe(1);
    const alfa = await pg.$$eval("#classes svg rect", (e) =>
      e.map((r) => parseFloat(r.getAttribute("fill-opacity") ?? "1")));
    expect(alfa).toEqual([...alfa].sort((a, b) => a - b));
    expect(alfa[6]).toBeGreaterThan(alfa[0]);
    await reinicia(pg);
  });

  test("o que não cabe no eixo contínuo vai para o rodapé", async () => {
    // saturação e sem-dado são categóricos: no meio da barra virariam faixa
    await pg.click('.modo[data-modo="outorga"]');
    await pg.waitForTimeout(300);
    expect(await pg.textContent("#classes .rodape")).toContain("licença ≥ o rio inteiro");
    await pg.click('.modo[data-modo="esgoto"]');
    await pg.waitForTimeout(300);
    expect(await pg.textContent("#classes .rodape")).toContain("sem outorga");
    await reinicia(pg);
  });

  test("o título da legenda muda em cada modo", async () => {
    await reinicia(pg);
    const visto: Record<string, string> = {};
    for (const m of ["vazao", "esgoto", "industria", "outorga", "tendencia"]) {
      await pg.click(`.modo[data-modo="${m}"]`);
      await pg.waitForTimeout(300);
      visto[m] = (await pg.textContent("#tituloLegenda")) ?? "";
    }
    expect(visto).toEqual({
      vazao: "Vazão média (m³/s)",
      esgoto: "Quanto do rio é esgoto",
      industria: "Quanto do rio é efluente industrial",
      outorga: "Vazão já licenciada",
      tendencia: "Tendência da vazão (%/década)",
    });
    expect(new Set(Object.values(visto)).size).toBe(5);
  });

  test("cada modo traz o seu próprio eixo, e a tendência segue em classes", async () => {
    await reinicia(pg);
    const eixo: Record<string, string[]> = {};
    for (const m of ["esgoto", "outorga"]) {
      await pg.click(`.modo[data-modo="${m}"]`);
      await pg.waitForTimeout(300);
      eixo[m] = await eixoLegenda(pg);
    }
    // a poluição mede % do rio que é efluente e vai de 0,1% a 100%; a outorga
    // começa em 1%, porque licença de um milésimo da vazão não é notícia
    expect(eixo.esgoto).toEqual(["0,1%", "1%", "10%", "100%"]);
    expect(eixo.outorga).toEqual(["1%", "10%", "100%"]);

    /* A tendência não vira barra: a escala dela tem sinal, cai em corte fixo e
       o rótulo diz a direção antes do número. Barra ali prometeria um contínuo
       que o canvas não desenha. */
    await pg.click('.modo[data-modo="tendencia"]');
    await pg.waitForTimeout(600);
    expect(await pg.$$eval("#classes svg", (e) => e.length),
           "a tendência virou barra contínua").toBe(0);
    const cls = await pg.$$eval("#classes .classe", (e) => e.map((c) => c.textContent ?? ""));
    expect(cls).toHaveLength(7);
    expect(cls.join(" ")).toMatch(/cai .* estável .* sobe/);
    await reinicia(pg);
  });
});

describe("camadas", () => {
  test("as quatro nascem desligadas", async () => {
    const { pg: p } = await abrir(urlDe(INDEX), { fresco: true });
    const estado = await p.$$eval("#hud button.chave",
      (e) => Object.fromEntries(e.map((b) => [b.id, b.getAttribute("aria-pressed")])));
    for (const v of Object.values(estado)) expect(v).toBe("false");
    expect(Object.keys(estado).length).toBeGreaterThanOrEqual(3);
    // e os contadores ao lado de cada uma vêm preenchidos, não "( )"
    const n = await p.$$eval("#hud button.chave b", (e) => e.map((b) => b.textContent?.trim()));
    expect(n.length).toBeGreaterThanOrEqual(3);
    for (const v of n) expect(v).toMatch(/^\(\d[\d.]*\)$/);
  }, LENTO);

  test("ligar as estações muda o que está desenhado", async () => {
    await reinicia(pg);
    const antes = await roda<number>(pg, TINTA);
    await pg.click("#btEst");
    await pg.waitForTimeout(700);
    expect(await roda<number>(pg, TINTA)).not.toBe(antes);
    expect(await pg.getAttribute("#btEst", "aria-pressed")).toBe("true");
  });

  test("a ficha vazia cita só as camadas ligadas", async () => {
    await reinicia(pg);
    const texto = async () => (await pg.textContent("#ficha"))!.trim();
    expect(await texto()).toBe("Toque num rio para ver a vazão.");
    await pg.click("#btEst"); await pg.waitForTimeout(250);
    expect(await texto()).toBe("Toque num rio ou numa estação para ver a vazão.");
    await pg.click("#btRes"); await pg.waitForTimeout(250);
    expect(await texto()).toBe("Toque num rio, numa estação ou num reservatório para ver a vazão.");
    await reinicia(pg);
    expect(await texto()).toBe("Toque num rio para ver a vazão.");
  });

  test("o fluxo animado desenha no canvas de cima", async () => {
    await reinicia(pg);
    const vazio = `() => { const c = document.getElementById('cvFluxo');
      const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      for (let i = 3; i < d.length; i += 4 * 331) if (d[i] > 0) return false; return true; }`;
    expect(await roda(pg, vazio)).toBe(true);
    await pg.click("#btFluxo");
    await pg.waitForTimeout(1200);
    expect(await roda(pg, vazio)).toBe(false);
    await pg.click("#btFluxo");
  });
});

describe("ficha", () => {
  test("clicar num rio abre a ficha com nome e vazão", async () => {
    await reinicia(pg);
    const c = (await pg.locator("#mapa").boundingBox())!;
    let achou = false;
    for (let k = 0; k < 40 && !achou; k++) {
      await pg.mouse.click(c.x + (c.width * ((k % 8) + 0.5)) / 8,
                           c.y + (c.height * (Math.floor(k / 8) + 0.5)) / 5);
      await pg.waitForTimeout(120);
      achou = await pg.$eval("#ficha", (e) => !e.classList.contains("vazia"));
    }
    expect(achou, "40 cliques sobre o mapa sem abrir uma ficha").toBe(true);
    expect(await pg.$eval("#ficha .nome", (e) => e.textContent!.length)).toBeGreaterThan(2);
    expect(await pg.textContent("#ficha")).toContain("Vazão");
  }, LENTO);

  test("nenhum div da ficha renderiza vazio", async () => {
    /* varre trecho, estação, reservatório e ETE chamando os construtores
       direto — clicar no mapa nunca cobriria as combinações raras */
    const ruins = await roda(sonda, `() => {
      const t = window.__testes, f = document.getElementById('ficha'), maus = [];
      const olha = (rot) => [...f.children].forEach((d, k) => {
        const em = d.querySelector('em');
        if (!d.textContent.trim() || (em && !em.textContent.trim()))
          maus.push(rot + ' div[' + (k + 1) + '] ' + d.className);
      });
      for (const m of ['vazao', 'esgoto', 'industria', 'outorga']) {
        t.aplicaModo(m);
        const passo = Math.max(1, Math.floor(t.N / 1500));
        for (let i = 0; i < t.N; i += passo) { t.fichaTrecho(i); olha('trecho/' + m + '/' + i); }
      }
      t.aplicaModo('vazao');
      return maus.slice(0, 20);
    }`);
    expect(ruins).toEqual([]);

    // e o número de divs fica na faixa que os construtores permitem
    const hist = await roda(sonda, `() => {
      const t = window.__testes, f = document.getElementById('ficha'), h = {};
      const passo = Math.max(1, Math.floor(t.N / 3000));
      for (let i = 0; i < t.N; i += passo) { t.fichaTrecho(i); h[f.children.length] = (h[f.children.length]||0)+1; }
      return h;
    }`) as Record<string, number>;
    const chaves = Object.keys(hist).map(Number);
    expect(Math.min(...chaves)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...chaves)).toBeLessThanOrEqual(12);
  }, LENTO);

  /* O aviso existe para o branco do mapa de esgoto não virar atestado de
     limpeza. Fora desses dois modos aparecia sozinho, sem linha nenhuma de
     efluente ao lado a que se referir. */
  test('o selo de "sem registro" só aparece nos modos de efluente', async () => {
    const r = await roda(sonda, `() => {
      const t = window.__testes, out = {};
      const alvos = [...t.semDado].filter(i => t.fEsg[i] < 0.001 && (!t.fInd || t.fInd[i] < 0.001)).slice(0, 3);
      for (const m of ['vazao', 'esgoto', 'industria', 'outorga']) {
        t.aplicaModo(m);
        out[m] = alvos.map(i => { t.fichaTrecho(i);
          const s = document.querySelector('#ficha .selo.neutro');
          return s ? s.textContent : null; });
      }
      t.aplicaModo('vazao');
      return { out, n: alvos.length };
    }`) as { out: Record<string, (string | null)[]>; n: number };
    expect(r.n).toBeGreaterThan(0);
    for (const m of ["esgoto", "industria"]) {
      for (const s of r.out[m]) expect(s).toContain("não tem outorga de lançamento");
    }
    for (const m of ["vazao", "outorga"]) {
      for (const s of r.out[m]) expect(s).toBe("vazão estimada");
    }
  });

  /* Esse selo é outro, e continua em todos os modos: ele diz se o número da
     ficha foi medido numa estação ou interpolado. */
  test("o selo de vazão medida ou estimada aparece em todos os modos", async () => {
    const r = await roda(sonda, `() => {
      const t = window.__testes, out = [];
      const medido = [...t.medidos][0], estimado = [...Array(t.N).keys()].find(i => !t.medidos.has(i));
      for (const m of ['vazao', 'esgoto', 'industria', 'outorga'])
        for (const i of [medido, estimado]) {
          t.aplicaModo(m); t.fichaTrecho(i);
          out.push(document.querySelector('#ficha .selo:last-child').textContent);
        }
      t.aplicaModo('vazao');
      return out;
    }`) as string[];
    expect(r).toHaveLength(8);
    expect(r.filter((s) => s === "vazão medida em estação")).toHaveLength(4);
    expect(r.filter((s) => s === "vazão estimada")).toHaveLength(4);
  });

  test("5.873 trechos têm metade da vazão ou mais já licenciada", async () => {
    const r = await roda(sonda, `() => {
      const t = window.__testes; let a = 0, b = 0, c = 0;
      for (let i = 0; i < t.N; i++) { const o = t.fOut[i];
        if (o >= 0.5) a++; if (o >= 1) b++; if (o >= 0.01) c++; }
      return { meia: a, cheia: b, piso: c };
    }`) as Record<string, number>;
    expect(r).toEqual({ meia: 5873, cheia: 2558, piso: 63204 });

    /* Acima de 100% o número deixa de ser atributo do rio e vira a notícia:
       ganha selo próprio em vez de mais uma linha. */
    const f = await roda(sonda, `() => {
      const t = window.__testes;
      const alto = [...Array(t.N).keys()].find(i => t.fOut[i] >= 1);
      const medio = [...Array(t.N).keys()].find(i => t.fOut[i] >= 0.05 && t.fOut[i] < 0.5);
      const ler = i => { t.fichaTrecho(i); const el = document.getElementById('ficha');
        return { txt: el.textContent, selos: [...el.querySelectorAll('.selo')].map(x => x.textContent) }; };
      return { alto: ler(alto), medio: ler(medio) };
    }`) as any;
    expect(f.alto.selos.join(" ")).toContain("licença de retirada igual ou maior que a vazão média");
    expect(f.alto.txt).toContain("Outorgado");
    expect(f.medio.txt).toContain("Outorgado");
    expect(f.medio.selos.join(" ")).not.toContain("igual ou maior");
  });
});

describe("tooltip", () => {
  /* A licença acumulada a montante entra no tooltip em qualquer modo, porque a
     pergunta vale enquanto se lê a vazão. Como 13,7% dos trechos passam do piso
     de 1%, uma grade de passagens do cursor tem que topar com vários. */
  test("traz a vazão sempre e a outorga quando ela existe", async () => {
    await reinicia(pg);
    const c = (await pg.locator("#mapa").boundingBox())!;
    const tips: string[] = [];
    for (let k = 0; k < 96; k++) {
      await pg.mouse.move(c.x + (c.width * ((k % 12) + 0.5)) / 12,
                          c.y + (c.height * (Math.floor(k / 12) + 0.5)) / 8);
      await pg.waitForTimeout(60);
      if (await pg.$eval("#tip", (e) => e.classList.contains("on"))) {
        tips.push((await pg.textContent("#tip")) ?? "");
      }
    }
    expect(tips.length, "nenhum tooltip em 96 passagens do cursor").toBeGreaterThan(5);
    for (const t of tips) expect(t).toMatch(/m³\/s|L\/s/);
    expect(tips.some((t) => t.includes("Outorgado")),
      "nenhum tooltip trouxe a outorga").toBe(true);
  }, LENTO);
});

describe("modo pela URL", () => {
  const TITULOS: Record<string, string> = {
    vazao: "Os rios do Brasil, por vazão",
    esgoto: "Os rios do Brasil, por esgoto",
    industria: "Os rios do Brasil, por efluente industrial",
    outorga: "Os rios do Brasil, por licença de retirada",
    tendencia: "Os rios do Brasil, por tendência da vazão",
  };

  test("?mapa= abre em cada modo, e valor inválido cai em vazão", async () => {
    for (const [param, esperado] of [["esgoto", "esgoto"], ["industria", "industria"],
                                     ["outorga", "outorga"], ["vazao", "vazao"],
                                     ["tendencia", "tendencia"],
                                     ["bobagem", "vazao"], ["", "vazao"]] as const) {
      const { pg: p, erros: e } = await abrir(`${urlDe(INDEX)}?mapa=${param}`, { fresco: true });
      expect(await modoAtivo(p), `?mapa=${param}`).toBe(esperado);
      expect(await p.textContent("#titulo"), `?mapa=${param}`).toBe(TITULOS[esperado]);
      expect(await p.textContent("#tituloLegenda"), `?mapa=${param}`).toBe(
        { vazao: "Vazão média (m³/s)", esgoto: "Quanto do rio é esgoto",
          industria: "Quanto do rio é efluente industrial",
          outorga: "Vazão já licenciada",
          tendencia: "Tendência da vazão (%/década)" }[esperado]);
      expect(e, `?mapa=${param}`).toEqual([]);
    }
  }, LENTO * 7);

  test("a URL acompanha a troca de modo, e vazão sai dela", async () => {
    const { pg: p } = await abrir(`${base}/index.html?mapa=outorga`, { fresco: true });
    expect(p.url()).toContain("mapa=outorga");
    await p.click('.modo[data-modo="esgoto"]');
    await p.waitForTimeout(400);
    expect(p.url()).toContain("mapa=esgoto");
    expect(await p.title()).toBe("Os rios do Brasil, por esgoto");
    await p.click('.modo[data-modo="vazao"]');
    await p.waitForTimeout(400);
    expect(p.url()).not.toContain("mapa=");
  }, LENTO);

  test("preserva outros parâmetros e não empilha histórico", async () => {
    const { pg: p } = await abrir(`${base}/index.html?utm=x&mapa=esgoto`, { fresco: true });
    const antes = await roda<number>(p, "() => history.length");
    for (const m of ["outorga", "industria", "vazao"]) {
      await p.click(`.modo[data-modo="${m}"]`);
      await p.waitForTimeout(300);
    }
    expect(p.url()).toContain("utm=x");
    expect(p.url()).not.toContain("mapa=");
    expect(await roda<number>(p, "() => history.length")).toBe(antes);
  }, LENTO);
});

describe("controles", () => {
  test("os botões de zoom aproximam, afastam e reenquadram", async () => {
    await reinicia(pg);
    const inicial = await roda<number>(pg, TINTA);
    await pg.click("#btMais"); await pg.waitForTimeout(500);
    const perto = await roda<number>(pg, TINTA);
    expect(perto).not.toBe(inicial);
    await pg.click("#btReset"); await pg.waitForTimeout(600);
    expect(await roda<number>(pg, TINTA)).toBe(inicial);
  });

  test("o filtro de detalhe reduz a rede desenhada", async () => {
    await reinicia(pg);
    const conta = async () => (await pg.textContent("#rgTexto")) ?? "";
    expect(await conta()).toContain("a rede inteira");
    await pg.locator("#rgOrdem").fill("6");
    await pg.locator("#rgOrdem").dispatchEvent("input");
    await pg.waitForTimeout(600);
    expect(await conta()).toContain("500 m³/s");
    await pg.locator("#rgOrdem").fill("0");
    await pg.locator("#rgOrdem").dispatchEvent("input");
    await pg.waitForTimeout(400);
  });

  test("a gaveta abre com os vinte maiores rios, em ordem", async () => {
    await reinicia(pg);
    await pg.click("#btSobre");
    await pg.waitForTimeout(400);
    const linhas = await pg.$$eval("#tb tr td:nth-child(2)",
      (e) => e.map((t) => parseFloat(t.textContent!.replace(/\./g, "").replace(",", "."))));
    expect(linhas).toHaveLength(20);
    expect(linhas[0]).toBeGreaterThan(50_000);      // Amazonas
    for (let i = 1; i < linhas.length; i++) expect(linhas[i]).toBeLessThanOrEqual(linhas[i - 1]);
    const nomes = await pg.$$eval("#tb tr td:first-child", (e) => e.map((t) => t.textContent));
    expect(nomes.every((n) => n!.startsWith("Rio "))).toBe(true);
    // e clicar numa linha fecha a gaveta, enquadra o rio e abre a ficha dele
    const antes = await roda<number>(pg, TINTA);
    await pg.click("#tb tr:nth-child(3)");
    await pg.waitForTimeout(800);
    expect(await roda<number>(pg, TINTA)).not.toBe(antes);
    expect(await pg.$eval("#ficha", (e) => e.classList.contains("vazia"))).toBe(false);
    expect(await pg.$eval("#gaveta", (e) => e.classList.contains("on"))).toBe(false);
  }, LENTO);

  test('o painel "Sobre os dados" abre e traz números', async () => {
    await reinicia(pg);
    expect(await pg.$eval("#sobreCorpo", (e) => e.classList.contains("on"))).toBe(false);
    await pg.click("#btSobreNums");
    await pg.waitForTimeout(300);
    expect(await pg.$eval("#sobreCorpo", (e) => e.classList.contains("on"))).toBe(true);
    const t = (await pg.textContent("#sobreCorpo")) ?? "";
    expect(t).toContain("Trechos de rio");
    expect(t).toMatch(/462\.539/);
    await pg.click("#btSobreNums");
  });
});

describe("tendência da vazão", () => {
  test("a ficha da estação traz o %/década e a janela do cálculo", async () => {
    const r = await roda<any>(sonda, `() => {
      const t = window.__testes, ficha = document.getElementById('ficha');
      const txt = e => { t.fichaEstacao(e); return ficha.textContent.replace(/\\s+/g, ' '); };
      const pior = t.TEND_OK.slice().sort((a, b) => t.TEND[a.cod][0] - t.TEND[b.cod][0])[0];
      return { comTend: Object.keys(t.TEND).length, pior: txt(pior),
               semSig: txt(t.D.estacoes.find(e => t.TEND[e.cod] && !t.TEND[e.cod][1])),
               obra: txt(t.D.estacoes.find(e => t.TEND[e.cod] && t.TEND[e.cod][2])),
               semTend: txt(t.D.estacoes.find(e => !t.TEND[e.cod])) };
    }`);
    expect(r.comTend).toBeGreaterThan(1000);
    // menos tipográfico, uma casa decimal, e a janela do cálculo ao lado — que
    // não é a da série da estação: a análise exige 10 meses medidos por ano
    expect(r.pior).toMatch(/Tendência da vazão−\d+,\d% por década/);
    expect(r.pior).toMatch(/Janela da tendência\d{4}–\d{4} · \d+ anos/);
    expect(r.semSig).toContain("tendência sem significância estatística");
    expect(r.obra).toContain("estação de barragem");
    // sem tendência calculada a ficha não inventa linha nenhuma
    expect(r.semTend).not.toContain("Tendência da vazão");
  });

  test("o modo desenha só as medidas e fora de obra, e a faixa corta por %", async () => {
    const r = await roda<any>(sonda, `() => {
      const t = window.__testes;
      const corte = t.CORTES_TEND[0];   // o mesmo −25 que veio no blob
      return { total: t.D.estacoes.length, comTend: Object.keys(t.TEND).length,
               passam: t.TEND_OK.length, corte,
               semRessalva: t.TEND_OK.every(e => t.TEND[e.cod][1] && !t.TEND[e.cod][2]),
               semCorte: t.filtraTend(Infinity).length,
               noCorte: t.filtraTend(corte).length,
               abaixoDoCorte: t.filtraTend(corte).every(e => t.TEND[e.cod][0] <= corte),
               sobem: t.TEND_OK.filter(e => t.TEND[e.cod][0] > 0).length };
    }`);
    // os dois testes de honestidade valem sempre, em qualquer parada da faixa
    expect(r.semRessalva, "entrou estação sem significância ou de barragem").toBe(true);
    expect(r.passam).toBeGreaterThan(0);
    expect(r.passam).toBeLessThan(r.comTend);
    // sem corte a faixa mostra o conjunto inteiro, inclusive quem está enchendo
    expect(r.semCorte).toBe(r.passam);
    expect(r.sobem, "a divergente perdeu o lado azul").toBeGreaterThan(0);
    // e apertar até o corte histórico deixa um punhado
    expect(r.noCorte).toBeGreaterThan(0);
    expect(r.noCorte).toBeLessThan(r.passam / 10);
    expect(r.abaixoDoCorte, "entrou estação acima do corte").toBe(true);
  });

  test("a tendência pinta trecho, e cada um deles tem estação a jusante", async () => {
    const r = await roda<any>(sonda, `() => {
      const t = window.__testes;
      const tr = t.TEND_TR, n = t.N;
      let pintados = 0, foraDaLista = 0, km = 0;
      for (let i = 0; i < n; i++) {
        if (!tr[i]) continue;
        pintados++;
        km += t.comps[i] / 10;
        if (tr[i] > t.TEND_LISTA.length) foraDaLista++;
      }
      /* O piso: todo trecho pintado carrega uma fração apreciável da vazão da
         régua que o pinta, ou é o próprio trecho onde ela está.

         A margem de 1% não é folga do critério, é a diferença entre as duas
         contas: o pipeline decide em float64 sobre a vazão cheia da estação, e
         aqui o q do trecho chega em Float32 e o da estação arredondado a duas
         casas. Sem ela, meia dúzia de trechos exatamente no limiar cai de um
         lado no Python e do outro no navegador. */
      let abaixoDoPiso = 0;
      const qDe = new Map(t.D.estacoes.map(e => [e.cod, e.q]));
      for (const i of t.ordemTend) {
        const qEst = qDe.get(t.TEND_LISTA[tr[i] - 1]);
        if (t.q[i] < t.TEND_PISO * qEst * 0.99 && !t.medidos.has(i)) abaixoDoPiso++;
      }
      return { pintados, foraDaLista, km, abaixoDoPiso, n,
               naOrdem: t.ordemTend.length,
               kmDaPagina: t.KM_TEND,
               // as estações que pintam são as mesmas que o modo desenha
               listaSoAprovadas: t.TEND_LISTA.every(c => t.TEND[c][1] && !t.TEND[c][2]),
               // a ordem é por vazão decrescente: o teto por quadro come os menores
               decrescente: t.ordemTend.every((i, k) => k === 0 || t.q[t.ordemTend[k - 1]] >= t.q[i]) };
    }`);
    expect(r.foraDaLista, "índice de estação fora da lista do blob").toBe(0);
    expect(r.listaSoAprovadas, "pintou trecho de estação reprovada nos dois testes").toBe(true);
    expect(r.decrescente, "a ordem do desenho não é por vazão").toBe(true);
    expect(r.naOrdem).toBe(r.pintados);
    expect(Math.round(r.kmDaPagina)).toBe(Math.round(r.km));
    // o piso existe para o número de uma régua no tronco não chegar à nascente:
    // sem ele são 332 mil trechos, com ele algumas dezenas de milhares
    expect(r.abaixoDoPiso, "trecho fino demais escapou do piso").toBe(0);
    expect(r.pintados).toBeGreaterThan(1000);
    expect(r.pintados).toBeLessThan(r.n / 4);
  });

  test("a faixa corta o rio junto com o ponto", async () => {
    await reinicia(pg);
    await pg.click('.modo[data-modo="tendencia"]');
    await pg.waitForTimeout(600);
    const kmDe = async () => {
      const t = (await pg.textContent("#rgTendTexto")) ?? "";
      const m = t.match(/([\d,]+) mil km/);
      return m ? Number(m[1].replace(",", ".")) : null;
    };
    const largo = await kmDe();
    expect(largo, "a faixa não diz quanto rio está pintado").toBeGreaterThan(0);
    await pg.locator("#rgTend").fill("5");
    await pg.locator("#rgTend").dispatchEvent("input");
    await pg.waitForTimeout(500);
    const apertado = await kmDe();
    expect(apertado, "o corte tirou estação e deixou o rio").toBeLessThan(largo!);
    expect(apertado).toBeGreaterThan(0);
  });

  test("a cor do ponto sai da divergente, com cinza no zero e lados opostos", async () => {
    const cores = await roda<string[]>(sonda, `() => {
      const t = window.__testes;
      return [-99, -20, 0, 20, 99].map(p => t.corTend(p));
    }`);
    const [caiMuito, cai, zero, sobe, sobeMuito] = cores;
    // um tom por classe: os extremos não podem colidir com o meio nem entre si
    expect(new Set(cores).size).toBe(5);
    expect(caiMuito).not.toBe(sobeMuito);
    expect(cai).not.toBe(zero);
    expect(sobe).not.toBe(zero);
  });

  test("o modo acende as estações, mostra a faixa e explica quem ficou fora", async () => {
    await reinicia(pg);
    expect(await pg.getAttribute("#btEst", "aria-pressed")).toBe("false");
    expect(await pg.isVisible("#faixaTend")).toBe(false);

    await pg.click('.modo[data-modo="tendencia"]');
    await pg.waitForTimeout(600);
    // sem isto o modo abriria sobre a camada apagada e não desenharia nada
    expect(await pg.getAttribute("#btEst", "aria-pressed"),
           "o modo entrou sem acender as estações").toBe("true");
    expect(await pg.isVisible("#faixaTend")).toBe(true);

    const nota = (await pg.textContent("#notaModo")) ?? "";
    expect(nota, "a nota não diz quantas ficaram fora, nem por quê")
      .toMatch(/sem significância estatística/);
    expect(nota).toMatch(/em estação de barragem/);
    expect(nota).toMatch(/por década/);

    // a faixa: sem corte fala do conjunto, apertada fala do corte
    expect(await pg.textContent("#rgTendTexto")).toContain("tendência medida");
    await pg.locator("#rgTend").fill("5");
    await pg.locator("#rgTend").dispatchEvent("input");
    await pg.waitForTimeout(500);
    const apertada = (await pg.textContent("#rgTendTexto")) ?? "";
    expect(apertada).toContain("25%");
    expect(apertada).toMatch(/ou mais por década/);

    // sair do modo devolve a camada e recolhe a faixa junto com o corte
    await pg.click('.modo[data-modo="vazao"]');
    await pg.waitForTimeout(600);
    expect(await pg.isVisible("#faixaTend")).toBe(false);
    expect(await pg.inputValue("#rgTend"), "o corte ficou preso ao sair").toBe("0");
  });
});

describe("tema e layout", () => {
  test("o tema escuro troca as cores do traço", async () => {
    const claro = await abrir(urlDe(INDEX), { ctx: { colorScheme: "light" } });
    const escuro = await abrir(urlDe(INDEX), { ctx: { colorScheme: "dark" } });
    // a última faixa é o azul mais escuro no claro e o mais claro no escuro
    const cor = async (p: Page) => (await amostras(p)).at(-1);
    expect(await cor(claro.pg)).not.toBe(await cor(escuro.pg));
    const fundo = (p: Page) => p.$eval("body", (e) => getComputedStyle(e).backgroundColor);
    expect(await fundo(claro.pg)).not.toBe(await fundo(escuro.pg));

    // e data-theme=light vence o escuro do sistema, pelo MutationObserver
    const antes = await cor(escuro.pg);
    await roda(escuro.pg, `() => document.documentElement.setAttribute('data-theme', 'light')`);
    await escuro.pg.waitForTimeout(600);
    expect(await cor(escuro.pg)).not.toBe(antes);
    await roda(escuro.pg, `() => document.documentElement.removeAttribute('data-theme')`);
  }, LENTO);

  test("os painéis do hud saem na ordem esperada", async () => {
    await reinicia(pg);
    // .cartao, não `#hud > div`: dois deles moram dentro do embrulho .hud-dir
    const ordem = await pg.$$eval("#hud .cartao",
      (e) => e.map((d) => d.querySelector("h1,h2")?.textContent ?? d.id));
    expect(ordem).toEqual(["Os rios do Brasil, por vazão", "O que ver", "Detalhe da rede",
                           "Camadas", "Vazão média (m³/s)", "ficha"]);
  });

  test("no desktop 'O que ver' e 'Detalhe da rede' formam a coluna da direita", async () => {
    await reinicia(pg);
    const r = await roda<any>(pg, `() => {
      const d = document.getElementById('hudDir').getBoundingClientRect();
      const h = document.getElementById('hud').getBoundingClientRect();
      const sobre = document.getElementById('sobre');
      const dentro = [...document.querySelectorAll('#hudDir .cartao')]
        .map(c => c.querySelector('h2').textContent);
      return {
        posicao: getComputedStyle(document.getElementById('hudDir')).position,
        dentro, esquerda: d.left, direita: d.right, larguraJanela: window.innerWidth,
        hudDireita: h.right,
        // o "Sobre os dados" mora na própria coluna, não solto sobre o mapa
        sobreNaColuna: document.getElementById('hudDir').contains(sobre),
        sobreFixo: getComputedStyle(sobre).position,
      };
    }`);
    expect(r.posicao).toBe("fixed");
    expect(r.dentro).toEqual(["O que ver", "Detalhe da rede"]);
    expect(r.esquerda, "a coluna nova encosta na coluna esquerda").toBeGreaterThan(r.hudDireita);
    expect(r.direita).toBeLessThanOrEqual(r.larguraJanela);
    expect(r.sobreNaColuna, "o 'Sobre os dados' saiu da coluna").toBe(true);
    expect(r.sobreFixo, "o 'Sobre os dados' voltou a flutuar e cobre os cartões")
      .not.toBe("fixed");
  });

  test("no desktop o zoom desceu para o rodapé direito, sem colidir", async () => {
    await reinicia(pg);
    const r = await roda<any>(pg, `() => {
      const z = document.querySelector('.zoom').getBoundingClientRect();
      const a = document.querySelector('.abrir').getBoundingClientRect();
      const d = document.getElementById('hudDir').getBoundingClientRect();
      return { zTopo: z.top, zBase: z.bottom, aTopo: a.top, dBase: d.bottom,
               altura: window.innerHeight };
    }`);
    expect(r.zTopo, "o zoom ainda está no topo").toBeGreaterThan(r.altura / 2);
    expect(r.zBase, "o zoom cobre o 'Tabela e método'").toBeLessThanOrEqual(r.aTopo);
    expect(r.dBase, "a coluna da direita esbarra no zoom").toBeLessThanOrEqual(r.zTopo);
  });

  test("o campo de busca ocupa o topo da direita, acima da coluna", async () => {
    const r = await roda<any>(pg, `() => {
      const b = document.getElementById('busca').getBoundingClientRect();
      const d = document.getElementById('hudDir').getBoundingClientRect();
      const h = document.getElementById('hud');
      return { bDir: b.right, bBase: b.bottom, dTopo: d.top, jan: window.innerWidth,
               // fora do #hud: no celular a gaveta ganha transform, e transform em
               // ancestral prende o position:fixed do descendente
               dentroDoHud: h.contains(document.getElementById('busca')) };
    }`);
    expect(r.dentroDoHud, "a busca voltou para dentro do #hud").toBe(false);
    expect(r.bDir).toBeLessThanOrEqual(r.jan);
    expect(r.bBase, "o campo cobre o 'O que ver'").toBeLessThanOrEqual(r.dTopo);
  });
});

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
