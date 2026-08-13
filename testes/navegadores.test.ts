/* A mesma página nos três motores. O que muda entre eles não é o JavaScript e
 * sim o que o CSS e as APIs modernas suportam: `DecompressionStream` é o único
 * caminho de descompressão da página, e sem `color-mix` os ícones das camadas
 * ficam sem fundo. Firefox e WebKit chegaram nessas duas coisas anos depois do
 * Chromium, e nenhuma delas falha visivelmente — a página abre, só que errada. */
import { afterAll, describe, expect, test } from "bun:test";
import { INDEX, LENTO, MOTORES, abrir, amostras, fecharTudo, roda, urlDe } from "./comum";

afterAll(fecharTudo);

const SUPORTE = `() => ({
  decompression: typeof DecompressionStream === 'function',
  colorMix: CSS.supports('color', 'color-mix(in srgb, red 18%, transparent)'),
  dvh: CSS.supports('height', '70dvh'),
  desfoque: CSS.supports('backdrop-filter', 'blur(5px)')
           || CSS.supports('-webkit-backdrop-filter', 'blur(5px)'),
  searchParams: typeof URLSearchParams === 'function',
  replaceState: typeof history.replaceState === 'function',
  fonteMono: document.fonts.check('12px Mono'),
})`;

const TINTA = `() => {
  const c = document.getElementById('cv');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const s = new Set();
  for (let i = 0; i < d.length; i += 4 * 977) s.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
  return s.size;
}`;

for (const motor of MOTORES) {
  describe(motor, () => {
    test(`${motor}: abre por file:// sem erro e pinta a rede`, async () => {
      const { pg, erros } = await abrir(urlDe(INDEX), { motor });
      expect(erros).toEqual([]);
      expect(await pg.textContent("#titulo")).toBe("Os rios do Brasil, por vazão");
      // mais de um tom no canvas: a rede foi de fato desenhada, não só o fundo
      expect(await roda<number>(pg, TINTA)).toBeGreaterThan(20);
      expect(await pg.$eval("#ficha", (e) => e.textContent!.trim()))
        .toBe("Selecione um rio para ver os detalhes");
    }, LENTO);

    test(`${motor}: tem as APIs e o CSS de que a página depende`, async () => {
      const { pg } = await abrir(urlDe(INDEX), { motor });
      const s = await roda<Record<string, boolean>>(pg, SUPORTE);
      for (const [k, v] of Object.entries(s)) expect(v, `${motor} sem ${k}`).toBe(true);
    }, LENTO);

    test(`${motor}: a legenda tem sete tons e o modo entra pela URL`, async () => {
      const { pg } = await abrir(urlDe(INDEX), { motor });
      const tons = await amostras(pg);
      expect(tons).toHaveLength(7);
      expect(new Set(tons).size, `${motor}: a rampa perdeu tons`).toBe(7);

      const { pg: p2, erros } = await abrir(`${urlDe(INDEX)}?mapa=outorga`, { motor, fresco: true });
      expect(await p2.textContent("#titulo")).toBe("Os rios do Brasil, por licença de retirada");
      expect(await p2.textContent("#tituloLegenda")).toBe("Vazão já licenciada");
      await p2.click('.modo[data-modo="esgoto"]');
      await p2.waitForTimeout(500);
      expect(await p2.textContent("#tituloLegenda")).toBe("Quanto do rio é esgoto");
      expect(erros).toEqual([]);
    }, LENTO);
  });
}
