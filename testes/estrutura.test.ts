/* O que dá para conferir sem abrir navegador: as duas páginas continuam
 * autocontidas, o template e o produto não divergiram, e as convenções de CSS
 * que o CLAUDE.md registra seguem valendo. */
import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import {
  INDEX, SERIES, TEMPLATE, TEMPLATE_SERIES,
  blocoCss, estilo, semFonte, texto, variaveis,
} from "./comum";

const PAGINAS: [string, string][] = [["index.html", INDEX], ["series.html", SERIES]];

describe("arquivos", () => {
  test("as duas páginas existem e trazem o dado embutido", () => {
    for (const [nome, p] of PAGINAS) {
      expect(statSync(p).size, nome).toBeGreaterThan(100_000);
    }
    const s = texto(INDEX);
    expect(s.length).toBeGreaterThan(5_000_000);
    expect(s).toContain('id="dados" type="text/plain"');
    expect(s).toContain("DecompressionStream");
  });

  test("os marcadores de montagem só existem nos templates", () => {
    for (const m of ["/*__DADOS__*/", "/*__FONTE__*/"]) {
      expect(texto(TEMPLATE), `${m} sumiu do template`).toContain(m);
      expect(texto(INDEX), `${m} sobrou no produto`).not.toContain(m);
    }
    expect(texto(TEMPLATE_SERIES)).toContain("/*__TENDENCIA__*/");
    expect(texto(SERIES)).not.toContain("/*__TENDENCIA__*/");
  });
});

describe("cabeçalho", () => {
  /* Sem a tag o celular adota 980 px e nenhuma media query de max-width
     dispara — todo o CSS de celular vira letra morta. */
  test("as duas páginas declaram o viewport do aparelho", () => {
    for (const [nome, p] of PAGINAS) {
      expect(texto(p), nome).toMatch(/<meta\s+name="viewport"[^>]*width=device-width/);
    }
  });

  /* Sem doctype o navegador renderiza em quirks mode, que é outro conjunto de
     regras de layout; sem lang o leitor de tela lê português com fonema de
     inglês. Nenhum dos dois aparece numa inspeção visual. */
  test("as duas páginas têm doctype, lang e título", () => {
    for (const [nome, p] of PAGINAS) {
      const s = texto(p);
      expect(s.slice(0, 60).toLowerCase(), nome).toContain("<!doctype html>");
      expect(s, nome).toMatch(/<html[^>]*lang="pt-BR"/i);
      expect(s, nome).toMatch(/<title>[^<]{5,}<\/title>/);
    }
  });

  /* Abrir por file:// tem que funcionar: nada de CDN, fonte remota, @import. */
  test("nenhuma das duas carrega recurso externo", () => {
    for (const [nome, p] of PAGINAS) {
      const s = texto(p);
      for (const re of [/<script[^>]+src="(?!data:)/, /<link[^>]+href="(?!data:)/,
                        /<img[^>]+src="(?!data:)/, /@import/, /url\(\s*['"]?https?:\/\//]) {
        expect(s, `${nome} carrega recurso externo: ${re}`).not.toMatch(re);
      }
    }
  });
});

describe("template contra produto", () => {
  /* A edição cirúrgica no artefato tem que ter sido aplicada ao template,
     senão some na próxima montagem. */
  test("index.html e template.html têm o mesmo <style>", () => {
    expect(semFonte(estilo(texto(INDEX)))).toBe(semFonte(estilo(texto(TEMPLATE))));
  });

  test("series.html e template_series.html têm o mesmo <style>", () => {
    expect(semFonte(estilo(texto(SERIES)))).toBe(semFonte(estilo(texto(TEMPLATE_SERIES))));
  });

  test("index.html e template.html têm o mesmo hud", () => {
    const hud = (s: string) => s.slice(s.indexOf('<div class="hud"'), s.indexOf('<div class="veu"'));
    expect(hud(texto(INDEX))).toBe(hud(texto(TEMPLATE)));
  });

  test("index.html e template.html têm o mesmo trecho de início", () => {
    const corpo = (s: string) => {
      const i = s.indexOf("/* ---------- início ---------- */");
      return s.slice(i, s.indexOf("</script>", i));
    };
    expect(corpo(texto(INDEX))).toBe(corpo(texto(TEMPLATE)));
  });
});

describe("tokens de cor", () => {
  /* O que importa não é qual página conhece qual escala, é qual EIXO recebe
     qual. Magnitude (vazão, efluente, outorga) pede rampa sequencial; mudança
     com sinal (tendência) pede divergente com cinza no zero. Trocar uma pela
     outra faz o leitor ler perda onde não há.

     O mapa passou a definir as duas porque ganhou o modo Tendência, e ali o
     laranja↔azul significa exatamente o que significa no series.html — é o
     mesmo número, e as duas páginas têm que concordar. O que continua proibido
     é cruzar: divergente medindo magnitude, ou sequencial medindo sinal. */
  test("cada escala fica no seu eixo", () => {
    const DIVERGENTE = ["--seca-1", "--seca-3", "--enche-1", "--enche-3", "--neutro"];

    const mapa = blocoCss(estilo(texto(INDEX)), ":root");
    for (let i = 0; i < 7; i++) expect(mapa, `--ramp-${i}`).toContain(`--ramp-${i}`);
    for (const v of DIVERGENTE) expect(mapa, `mapa/${v}`).toContain(v);

    /* E no script: cada função de cor puxa da lista certa. A comparação é
       sempre sobre a LINHA extraída, nunca sobre o arquivo — um expect que
       falha contra os 14 MB do index.html despeja a página inteira no relatório
       e o erro de verdade some no meio do base64. */
    const js = texto(INDEX);
    const linhaDe = (marca: string) => {
      const i = js.indexOf(marca);
      expect(i, `sumiu do index.html: ${marca}`).toBeGreaterThan(-1);
      return js.slice(i).split("\n")[0];
    };
    expect(linhaDe("const cor = "), "cor() de magnitude saiu da rampa sequencial")
      .toContain("RAMPA[");
    expect(linhaDe("const corTend = "), "corTend() de sinal precisa ler TND, não RAMPA")
      .toContain("TND[");
    // a divergente entra no mapa por um nome só, e é o da tendência
    expect(linhaDe("const TOKENS_TEND = "), "a divergente vazou para fora do modo Tendência")
      .toContain("--seca-3");
    for (const f of ["const cor = ", "const corPol = ", "const corOut = "]) {
      const linha = linhaDe(f);
      for (const v of DIVERGENTE) {
        expect(linha, `${f.trim()} usa ${v}, que é escala de sinal`).not.toContain(v);
      }
    }

    const serie = blocoCss(estilo(texto(SERIES)), ":root");
    for (const v of DIVERGENTE) expect(serie, `series/${v}`).toContain(v);
    expect(serie, "o series.html não deve usar a rampa de magnitude").not.toContain("--ramp-0");
  });

  test("as duas páginas têm os três blocos de tema", () => {
    for (const [nome, p] of PAGINAS) {
      const s = estilo(texto(p));
      expect(s, nome).toContain("@media (prefers-color-scheme: dark)");
      expect(s, `${nome}: falta a guarda do tema claro forçado`)
        .toContain(':root:not([data-theme="light"])');
      expect(s, nome).toContain(':root[data-theme="dark"]');
    }
  });

  /* Toda variável que o bloco escuro redefine precisa nascer no :root — sem
     isso o tema claro forçado fica sem valor nenhum para ela. */
  test("nenhuma cor definida só dentro de media query", () => {
    for (const [nome, p] of PAGINAS) {
      const css = estilo(texto(p));
      const claro = variaveis(blocoCss(css, ":root"));
      const escuro = variaveis(blocoCss(css, "@media (prefers-color-scheme: dark)"));
      for (const v of variaveis(blocoCss(css, ':root[data-theme="dark"]'))) escuro.add(v);
      const so = [...escuro].filter((v) => !claro.has(v));
      expect(so, `${nome}: definidas só no escuro`).toEqual([]);
    }
  });

  test("tabular-nums e a fonte mono embutida nas duas", () => {
    for (const [nome, p] of PAGINAS) {
      const s = texto(p);
      expect(s, nome).toContain("tabular-nums");
      expect(s, nome).toContain("@font-face");
      expect(s, nome).toContain("data:font/woff2;base64,");
    }
  });
});

describe("mudanças recentes, nos dois arquivos", () => {
  const DOIS: [string, string][] = [["template.html", TEMPLATE], ["index.html", INDEX]];

  test("a legenda de vazão são sete faixas, e a cunha sumiu", () => {
    for (const [nome, p] of DOIS) {
      const s = texto(p);
      // sete rótulos, um por tom da rampa — a lista de seis deixava de fora os
      // dois azuis mais escuros, que são os rios acima de 5.400 m³/s
      const m = s.match(/const CLASSES = \[([^\]]*)\]/);
      expect(m, `${nome}: sumiu a tabela de classes`).not.toBeNull();
      expect(m![1].match(/'/g)!.length / 2, nome).toBe(7);
      expect(s, `${nome}: sobrou a cunha`).not.toContain("cunhaVazao");
      expect(s, `${nome}: sobrou o CSS da cunha`).not.toContain(".classes.cunha");
    }
  });

  test("o modo entra e sai pela URL", () => {
    for (const [nome, p] of DOIS) {
      const s = texto(p);
      expect(s, nome).toContain("escreveModoNaURL");
      expect(s, nome).toContain("URLSearchParams(location.search)");
      expect(s, `${nome}: pushState empilharia histórico a cada troca`)
        .not.toContain("history.pushState");
    }
  });

  test('"O que ver" substituiu "O que pintar"', () => {
    for (const [nome, p] of DOIS) {
      expect(texto(p), nome).toContain("<h2>O que ver</h2>");
      expect(texto(p), nome).not.toContain("O que pintar");
    }
  });

  test("as camadas nascem desligadas no html e no script", () => {
    for (const [nome, p] of DOIS) {
      const s = texto(p);
      expect(s, nome).toContain("let mostrarEst = false, mostrarRes = false;");
      for (const bt of ["btEst", "btRes", "btEtes", "btFluxo"]) {
        expect(s, `${nome}/${bt}`).toContain(`<button id="${bt}" class="chave" aria-pressed="false">`);
      }
    }
  });

  test("o cartão desfoca em 5 px, com o prefixo webkit", () => {
    for (const [nome, p] of DOIS) {
      const cartao = blocoCss(estilo(texto(p)), "\n  .cartao ");
      expect(cartao, nome).toContain("backdrop-filter: blur(5px)");
      expect(cartao, nome).toContain("-webkit-backdrop-filter: blur(5px)");
    }
  });

  /* Os SVG do series.html não têm viewBox de propósito: max-width neles corta
     em vez de encolher, e quem rola é o .svgwrap em volta. */
  test("series.html rola o gráfico pelo .svgwrap", () => {
    const css = estilo(texto(SERIES));
    expect(css).toContain(".svgwrap");
    expect(blocoCss(css, "  .svgwrap ")).toContain("overflow-x: auto");
  });
});
