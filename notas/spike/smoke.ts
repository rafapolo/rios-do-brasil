/* Abre o index.html e imprime erros + um print. uso: GPU=1 bun run notas/spike/smoke.ts [url-sufixo] [saida.png] */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const b = await chromium.launch({ args: process.env.GPU ? ["--use-angle=metal", "--enable-gpu"] : [] });
try {
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  pg.on("pageerror", (e) => console.log("pageerror", e.message));
  pg.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log(m.type(), m.text().slice(0, 300)); });
  const t0 = Date.now();
  await pg.goto(pathToFileURL(join(import.meta.dir, "../../index.html")).href + (process.argv[2] ?? ""));
  await pg.waitForSelector("#carregando", { state: "detached", timeout: 60000 }).catch((e) => console.log("véu não saiu"));
  console.log("abertura", (Date.now() - t0) / 1000);
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: process.argv[3] ?? "/tmp/smoke.png" });
} finally { await b.close(); }
