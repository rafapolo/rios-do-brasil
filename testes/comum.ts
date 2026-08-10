/* Peças que os arquivos de teste compartilham.
 *
 * O index.html tem 14 MB e leva alguns segundos entre decodificar o base64,
 * passar pelo DecompressionStream e desenhar os 462 mil trechos — abrir uma
 * página por teste levaria a suíte a dezenas de minutos. Cada par (motor, URL)
 * é aberto uma vez e reaproveitado; quem mexe no estado começa por reinicia().
 *
 * O repositório não tem build nem dependência de runtime, e continua sem: o
 * package.json aqui é só de desenvolvimento, e nada dele entra nas páginas. */
import { chromium, firefox, webkit, devices, type Browser, type Page } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const RAIZ = join(import.meta.dir, "..");
export const INDEX = join(RAIZ, "index.html");
export const SERIES = join(RAIZ, "series.html");
export const TEMPLATE = join(RAIZ, "pipeline", "template.html");
export const TEMPLATE_SERIES = join(RAIZ, "pipeline", "template_series.html");

export const urlDe = (caminho: string) => pathToFileURL(caminho).href;

/* descompressão + primeiro desenho; ~4 s no chromium, com folga para o webkit,
 * que é o mais lento dos três com o gzip embutido */
export const ESPERA = 9000;
export const LENTO = 90_000;   // teto de um teste que abre página nova

// ---------- leitura dos arquivos ----------

const lidos = new Map<string, string>();
export function texto(caminho: string): string {
  if (!lidos.has(caminho)) lidos.set(caminho, readFileSync(caminho, "utf8"));
  return lidos.get(caminho)!;
}

/** O conteúdo entre chaves que começa em `abertura`, respeitando aninhamento —
 *  os blocos de tema têm media query dentro de media query. */
export function blocoCss(css: string, abertura: string): string {
  let i = css.indexOf(abertura);
  if (i < 0) throw new Error(`bloco não encontrado: ${abertura}`);
  i = css.indexOf("{", i + abertura.length) + 1;
  let nivel = 1, j = i;
  while (nivel > 0) {
    if (css[j] === "{") nivel++;
    else if (css[j] === "}") nivel--;
    j++;
  }
  return css.slice(i, j - 1);
}

export const estilo = (html: string) =>
  html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

/** O template guarda o marcador da fonte onde o produto guarda 200 KB de
 *  base64; sem normalizar isso os dois nunca seriam comparáveis. */
export const semFonte = (s: string) =>
  s.replace(/url\(data:font\/woff2;base64,[^)]*\)/g, "url(FONTE)");

export const variaveis = (css: string) =>
  new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

// ---------- servidor local ----------

/** file:// é requisito do projeto, mas history.replaceState só se comporta de
 *  verdade sob http — os dois esquemas são exercitados. */
export function servidor() {
  const srv = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      return new Response(Bun.file(join(RAIZ, p === "/" ? "index.html" : p)));
    },
  });
  return { base: `http://127.0.0.1:${srv.port}`, parar: () => srv.stop(true) };
}

// ---------- navegadores ----------

const motores = { chromium, firefox, webkit };
export type Motor = keyof typeof motores;
export const MOTORES: Motor[] = ["chromium", "firefox", "webkit"];

const abertos = new Map<Motor, Browser>();
const cache = new Map<string, Pagina>();

export type Pagina = { pg: Page; erros: string[] };

/** O Playwright do Node avalia string como *expressão*, não como função a
 *  chamar — ao contrário do binding em Python, que detecta a arrow function e a
 *  invoca. Sem envolver em IIFE, `evaluate("() => …")` devolve undefined em
 *  silêncio e todo teste que dependia do valor passa a comparar nada com nada. */
export const roda = <T,>(pg: Page, fn: string, ...args: unknown[]) =>
  pg.evaluate(`(${fn})(...${JSON.stringify(args)})`) as Promise<T>;

async function navegador(motor: Motor) {
  if (!abertos.has(motor)) abertos.set(motor, await motores[motor].launch());
  return abertos.get(motor)!;
}

type Opcoes = { motor?: Motor; dispositivo?: string; fresco?: boolean; ctx?: object };

/** Devolve { pg, erros }. `erros` acumula pageerror e console.error desde o
 *  carregamento — há teste dedicado conferindo que fica vazio. */
export async function abrir(url: string, o: Opcoes = {}): Promise<Pagina> {
  const motor = o.motor ?? "chromium";
  const ctx = { ...(o.dispositivo ? devices[o.dispositivo] : {}), ...(o.ctx ?? {}) };
  const chave = `${motor}|${url}|${JSON.stringify(ctx)}`;
  if (!o.fresco && cache.has(chave)) return cache.get(chave)!;

  const pg = await (await navegador(motor)).newContext(ctx).then((c) => c.newPage());
  const erros: string[] = [];
  pg.on("pageerror", (e) => erros.push(`pageerror: ${e.message}`));
  pg.on("console", (m) => { if (m.type() === "error") erros.push(`console: ${m.text()}`); });
  await pg.goto(url);
  await pg.waitForTimeout(ESPERA);

  const p = { pg, erros };
  if (!o.fresco) cache.set(chave, p);
  return p;
}

/** As cores das amostras da legenda, na ordem em que aparecem. Estilo
 *  computado e não `style.background`: o inline traz o hex do token e cada
 *  motor serializa de um jeito. */
export const amostras = (pg: Page) =>
  pg.$$eval("#classes .amostra", (e) => e.map((a) => getComputedStyle(a).backgroundColor));

export async function fecharTudo() {
  cache.clear();
  for (const b of abertos.values()) await b.close();
  abertos.clear();
}

/* devolve o mapa ao estado de abertura: modo vazão, camadas desligadas,
 * enquadramento inicial, gaveta e painel fechados */
const REINICIA = `() => {
  document.querySelector('.modo[data-modo="vazao"]').click();
  for (const b of document.querySelectorAll('#hud button.chave'))
    if (b.getAttribute('aria-pressed') === 'true') b.click();
  document.getElementById('btReset').click();
  document.getElementById('gaveta').classList.remove('on');
  document.getElementById('veu').classList.remove('on');
  document.getElementById('sobreCorpo').classList.remove('on');
  window.scrollTo(0, 0);
}`;

export async function reinicia(pg: Page) {
  await roda(pg, REINICIA);
  await pg.waitForTimeout(350);
}

/** Uma cópia do index.html com os internos expostos em `window.__testes`.
 *
 *  O produto não ganha porta de depuração por causa da suíte: a cópia sai num
 *  diretório temporário. Se a âncora sumir do arquivo o teste falha, em vez de
 *  silenciosamente deixar de conferir os dados. */
export function copiaSondada(): string {
  const ancora = "  /* ---------- início ---------- */";
  const s = texto(INDEX);
  if (s.split(ancora).length !== 2) throw new Error("âncora de injeção sumiu do index.html");
  const sonda =
    "  window.__testes = { N, q, areas, fEsg, fInd, fOut, semDado, medidos, foraBr,\n" +
    "    RES, ETES, D, nomeIdx, bbox, TEND, SECANDO,\n" +
    "    fichaTrecho: (i) => fichaTrecho(i), fichaEstacao: (e) => fichaEstacao(e),\n" +
    "    aplicaModo: (m) => aplicaModo(m),\n" +
    "    cor: (v) => cor(v), largura: (v, z) => largura(v, z), t01: (v) => t01(v) };\n";
  const destino = join(mkdtempSync(join(tmpdir(), "rios-")), "index.html");
  writeFileSync(destino, s.replace(ancora, sonda + ancora), "utf8");
  return urlDe(destino);
}
