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
      // pasta pede o index.html dela, como o servidor do site (/tour/ → tour/index.html)
      return new Response(Bun.file(join(RAIZ, p.endsWith("/") ? p + "index.html" : p)));
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

/* O mapa é WebGL. O chromium embutido do Playwright cai em SwiftShader (CPU) se
 * ninguém pedir a placa, e aí cada quadro de 460 mil trechos leva segundos: no Mac
 * a suíte liga o Metal (o que um leitor tem). Em outras máquinas segue o padrão, e
 * o corte por bloco da página (POR_SOFTWARE) mantém o quadro viável. */
const ARGS: Partial<Record<Motor, string[]>> = process.platform === "darwin" && !process.env.TESTES_SW
  ? { chromium: ["--use-angle=metal", "--enable-gpu"] } : {};

async function navegador(motor: Motor) {
  if (!abertos.has(motor)) abertos.set(motor, await motores[motor].launch({ args: ARGS[motor] }));
  return abertos.get(motor)!;
}

/* `init` roda antes de qualquer script da página (addInitScript); `semEspera` pula
 * a espera do véu, para os testes em que o véu nunca sai de propósito. */
type Opcoes = { motor?: Motor; dispositivo?: string; fresco?: boolean; ctx?: object;
                init?: string; semEspera?: boolean };

/** Devolve { pg, erros }. `erros` acumula pageerror e console.error desde o
 *  carregamento — há teste dedicado conferindo que fica vazio. */
export async function abrir(url: string, o: Opcoes = {}): Promise<Pagina> {
  const motor = o.motor ?? "chromium";
  const ctx = { ...(o.dispositivo ? devices[o.dispositivo] : {}), ...(o.ctx ?? {}) };
  const chave = `${motor}|${url}|${JSON.stringify(ctx)}|${o.init ?? ""}`;
  if (!o.fresco && cache.has(chave)) return cache.get(chave)!;

  const pg = await (await navegador(motor)).newContext(ctx).then((c) => c.newPage());
  if (o.init) await pg.addInitScript(o.init);
  const erros: string[] = [];
  pg.on("pageerror", (e) => erros.push(`pageerror: ${e.message}`));
  pg.on("console", (m) => { if (m.type() === "error") erros.push(`console: ${m.text()}`); });
  await pg.goto(url);
  if (o.semEspera) { const p = { pg, erros }; if (!o.fresco) cache.set(chave, p); return p; }
  /* O mapa tem um véu "carregando" que só sai depois do primeiro desenho; esperar
   * por ele em vez de um tempo fixo corta uns 5 s de cada abertura. O 1,5 s de
   * folga cobre o índice da busca (ocioso, 900 ms) e os primeiros ladrilhos. As
   * outras páginas não têm véu e seguem no tempo fixo. */
  if (await pg.$("#carregando")) {
    await pg.waitForSelector("#carregando", { state: "detached", timeout: ESPERA * 6 });
    await pg.waitForTimeout(1500);
  } else {
    await pg.waitForTimeout(ESPERA);
  }

  const p = { pg, erros };
  if (!o.fresco) cache.set(chave, p);
  return p;
}

/** As cores da legenda, na ordem em que aparecem. Nos quatro modos de escala
 *  log ela é uma barra de <rect> e a cor vem do atributo `fill`, que já é o hex
 *  do token — igual em todo motor. No modo tendência, que segue em classes, é o
 *  estilo computado da amostra: ali a cor é inline e cada motor serializa de um
 *  jeito. */
export const amostras = async (pg: Page) => {
  const barra = await pg.$$eval("#classes svg rect", (e) => e.map((r) => r.getAttribute("fill") ?? ""));
  if (barra.length) return barra;
  return pg.$$eval("#classes .amostra", (e) => e.map((a) => getComputedStyle(a).backgroundColor));
};

/** Os rótulos do eixo da barra, da esquerda para a direita. */
export const eixoLegenda = (pg: Page) =>
  pg.$$eval("#classes svg text", (e) => e.map((t) => t.textContent ?? ""));

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
  document.getElementById('gavetaProjeto').classList.remove('on');
  document.getElementById('veu').classList.remove('on');
  document.getElementById('sobreCorpo').classList.remove('on');
  // as páginas são reaproveitadas: sem limpar, o teste seguinte herda a lista
  // de sugestões aberta por cima do mapa
  document.getElementById('buscaCampo').value = '';
  document.getElementById('buscaLimpa').hidden = true;
  document.getElementById('buscaLista').hidden = true;
  document.getElementById('buscaLista').innerHTML = '';
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
    "  window.__testes = { N, q, areas, comps, fEsg, fInd, fOut, outLoc, OUT_FIN, semDado, medidos, foraBr,\n" +
    "    RES, ETES, D, nomeIdx, bbox, coords, inicio, paraTela: (x, y) => { lerCamera(); return paraTela(x, y); },\n" +
    "     TEND, TEND_OK, CORTES_TEND, LIMIARES_TEND,\n" +
    "    TEND_TR, TEND_PCT, TEND_LISTA, TEND_PISO, ordemTend, KM_TEND,\n" +
    "    LIVRE, LIVRE_BRUTO, BAR_JUS, BAR_MONT, LIVRE_CORTES, ordemLivre, BARR,\n" +
    "    fichaBarragem: (b) => fichaBarragem(b), fichaUsina: (u) => fichaUsina(u), fichaEte: (t) => fichaEte(t),\n" +
    "    filtraTend: (c) => filtraTend(c), corTend: (p) => corTend(p),\n" +
    "    fichaTrecho: (i) => fichaTrecho(i), fichaEstacao: (e) => fichaEstacao(e),\n" +
    "    aplicaModo: (m) => aplicaModo(m), vista, map, define3D: (on, o) => define3D(on, o), em3D: () => em3D,\n" +
    "    camera: (lon, lat, z) => { map.jumpTo({ center: [lon, lat], zoom: zBase() + Math.log2(z), bearing: 0, pitch: 0 }); },\n" +
    "    montaBusca: () => { montaBusca(); return BUSCA.repr.length; },\n" +
    "    buscaRios: (s) => buscaRios(s).map(r => ({ nome: D.nomes[nomeIdx[r.i]],\n" +
    "      uf: ufDoRio(r.i), q: r.q, peso: r.peso, i: r.i })),\n" +
    "    vaiAoRio: (i) => vaiAoRio(i), trechosDoRio: (i) => [...trechosDoRio(i)],\n" +
    "    cor: (v) => cor(v), largura: (v, z) => largura(v, z), t01: (v) => t01(v),\n" +
    "    relevo: () => ({ ativo: REL.ativo, exag: REL.exag, elev: REL.elev, zMax: REL.zMax, tem: TEM_RELEVO }),\n" +
    "    ligaRelevo: () => ligaRelevo(), desligaRelevo: () => desligaRelevo(),\n" +
    "    altEm: (lon, lat) => altLonLat(lon, lat) };\n";
  const destino = join(mkdtempSync(join(tmpdir(), "rios-")), "index.html");
  writeFileSync(destino, s.replace(ancora, sonda + ancora), "utf8");
  return urlDe(destino);
}

/** Quantos tons distintos há no canvas do mapa (WebGL: copiado para um canvas 2D
 *  para ler os pixels). Passa de ~20 quando a rede foi desenhada, e fica em 1-3
 *  quando só há o fundo. */
export const TINTA = `() => {
  const c = document.getElementById('cv');
  const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d'); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const s = new Set();
  for (let i = 0; i < d.length; i += 4 * 977) s.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
  return s.size;
}`;

/** Os argumentos de GL do chromium da suíte (Metal no Mac), para os testes que
 *  abrem um navegador próprio. */
export const argsGl = (motor: Motor) => ARGS[motor] ?? [];
