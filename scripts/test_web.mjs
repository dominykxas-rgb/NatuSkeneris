// Penklinės svetainės patikra su tikra naršykle (GitHub Actions).
// node scripts/test_web.mjs http://127.0.0.1:8000/ test/chula.png [kiti failai...]

import { chromium } from "playwright";
import fs from "node:fs";

const [url, ...images] = process.argv.slice(2);
const out = "test/web";
fs.mkdirSync(out, { recursive: true });

const notice = (title, msg) => console.log(`::notice title=${title}::${msg}`);
const error = (title, msg) => console.log(`::error title=${title}::${String(msg).replace(/\n/g, "%0A")}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const consoleLines = [];
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));
page.on("worker", (w) => w.on("console", (m) => consoleLines.push(`[worker] ${m.text()}`)));

let ok = true;
try {
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.penkline && window.penkline.prepared, null, { timeout: 10 * 60e3 })
    .catch(async () => {
      throw new Error("Neparuošta per 10 min.\n" + (await page.textContent("#prep")));
    });
  const prepSec = (Date.now() - t0) / 1000;
  notice("Paruošimas", `${prepSec.toFixed(1)} s (Python + modeliai)`);

  for (const img of images) {
    await page.click("#again").catch(() => {});
    await page.setInputFiles("#fileInput", img);
    const t1 = Date.now();
    await page.click("#start");
    const which = await Promise.race([
      page.waitForSelector("#done:not(.hidden)", { timeout: 20 * 60e3 }).then(() => "done"),
      page.waitForSelector("#fail:not(.hidden)", { timeout: 20 * 60e3 }).then(() => "fail"),
    ]);
    const sec = (Date.now() - t1) / 1000;
    const name = img.split("/").pop();
    if (which === "fail") {
      ok = false;
      const text = await page.textContent("#errorText");
      const log = await page.evaluate(() => window.penkline.log.slice(-60).join("\n"));
      error(`${name} nepavyko`, `${text}\n${log}`);
      await page.screenshot({ path: `${out}/${name}-klaida.png`, fullPage: true });
      continue;
    }
    const xml = await page.evaluate(async () => {
      const href = document.getElementById("download").href;
      return await (await fetch(href)).text();
    });
    fs.writeFileSync(`${out}/${name}.musicxml`, xml);
    const notes = (xml.match(/<note[ >]/g) || []).length;
    const measures = (xml.match(/<measure[ >]/g) || []).length;
    await page.waitForSelector("#score .page", { timeout: 60e3 }).catch(() => {});
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    notice(`${name}`, `${sec.toFixed(1)} s, ${notes} natų, ${measures} taktų`);
    if (notes < 10) { ok = false; error(`${name}`, `Per mažai natų: ${notes}`); }
  }

  // Telefono vaizdas
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/telefonas-rezultatas.png`, fullPage: true });
  await page.click("#again");
  await page.setInputFiles("#fileInput", images);
  await page.screenshot({ path: `${out}/telefonas-lapai.png` });
} catch (e) {
  ok = false;
  error("Svetainės patikra", e.message);
  await page.screenshot({ path: `${out}/klaida.png`, fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(`${out}/console.log`, consoleLines.join("\n"));
  const log = await page.evaluate(() => window.penkline ? window.penkline.log.join("\n") : "").catch(() => "");
  fs.writeFileSync(`${out}/penkline.log`, log);
  console.log("----- console (paskutinės 80) -----");
  console.log(consoleLines.slice(-80).join("\n"));
  console.log("----- penkline.log (paskutinės 80) -----");
  console.log(log.split("\n").slice(-80).join("\n"));
  await browser.close();
}
process.exit(ok ? 0 : 1);
