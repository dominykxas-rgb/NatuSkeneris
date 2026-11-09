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
const results = [];
const check = (cond, title, msg) => {
  results.push(`${cond ? "OK " : "KLAIDA "} ${title}: ${msg}`);
  if (!cond) { ok = false; error(title, msg); }
};
const report = (title, msg) => results.push(`   ${title}: ${msg}`);

async function testEditor(name) {
  const info = () => page.evaluate(() => {
    const ed = window.penkline.editor;
    return ed.selected ? ed.score.info(ed.selected) : null;
  });
  // Paspaudžiam natą peržiūroje (ne pauzę)
  const target = await page.evaluate(() => {
    const ed = window.penkline.editor;
    const id = ed.score.noteOrder.find((n) => {
      const i = ed.score.info(n);
      return i && !i.isRest && !i.isGrace;
    });
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    el.scrollIntoView({ block: "center" });
    const r2 = el.getBoundingClientRect();
    return { id, x: r2.left + r2.width / 2, y: r2.top + r2.height / 2, w: r.width };
  });
  await page.mouse.click(target.x, target.y);
  const before = await info();
  check(before && before.id === target.id, "Redaktorius: pasirinkimas", `paspausta ${target.id}, pasirinkta ${before && before.id}`);
  check(await page.isEnabled('[data-act="up"]'), "Redaktorius: juosta", "mygtukai įjungti pasirinkus natą");

  await page.keyboard.press("ArrowUp");
  const up = await info();
  check(up && (up.step !== before.step || up.octave !== before.octave), "Redaktorius: aukštis",
    `${before.step}${before.octave} → ${up && up.step}${up && up.octave}`);

  await page.click('[data-act="dur:half"]');
  const half = await info();
  check(half && half.type === "half", "Redaktorius: trukmė", `${before.type} → ${half && half.type}`);

  await page.click('[data-act="sharp"]');
  const sharp = await info();
  check(sharp && sharp.alter === 1 && sharp.accidental === "sharp", "Redaktorius: diezas", JSON.stringify(sharp));

  const xmlAfter = await page.evaluate(async () => (await (await fetch(document.getElementById("download").href)).text()));
  check(xmlAfter.includes(`id="${target.id}"`) && /<type>half<\/type>/.test(xmlAfter), "Redaktorius: atsisiuntimas",
    "atsisiųstame MusicXML yra pakeitimai");
  const bad = await page.textContent("#measureStatus");
  report("Taktų patikra", bad || "(be pastabų)");
  await page.screenshot({ path: `${out}/redaktorius.png` });

  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  const back = await info();
  check(back && back.step === before.step && back.octave === before.octave && back.type === before.type && back.alter === before.alter,
    "Redaktorius: atšaukti", JSON.stringify(back));
  await page.keyboard.press("Control+y");
  const redo = await info();
  check(redo && redo.step === up.step, "Redaktorius: grąžinti", JSON.stringify(redo));
  await page.keyboard.press("Control+z");

  await page.fill("#title", "Bandomasis kūrinys ąčę");
  await page.press("#title", "Enter");
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.penkline.editor.title()) === "Bandomasis kūrinys ąčę", "Redaktorius: pavadinimas", "pakeistas");

  // Tamsi tema ir grotuvas
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.querySelector("midi-player")?.shadowRoot?.querySelector("[part=control-panel]"), null, { timeout: 60e3 })
    .catch(() => {});
  await page.waitForTimeout(500);
  const player = await page.evaluate(() => {
    const panel = document.querySelector("midi-player")?.shadowRoot?.querySelector("[part=control-panel]");
    if (!panel) return null;
    const cs = getComputedStyle(panel);
    const time = panel.querySelector("[part=time]") || panel;
    return { bg: cs.backgroundColor, color: getComputedStyle(time).color };
  });
  const lum = (c) => {
    const m = (c || "").match(/\d+(\.\d+)?/g);
    if (!m) return 1;
    const [r, g, b] = m.slice(0, 3).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  check(player && lum(player.bg) < 0.3 && lum(player.color) > 0.6, "Grotuvas tamsioje temoje",
    player ? `fonas ${player.bg}, tekstas ${player.color}` : "grotuvas neįsikėlė");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${out}/tamsi-tema.png` });
  await page.emulateMedia({ colorScheme: "light" });

  // PDF
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.click("#pdf");
  await page.waitForFunction(() => window.__printed === true, null, { timeout: 30e3 });
  const svgPages = await page.evaluate(() => document.querySelectorAll("#printout .print-page").length);
  const pdfPath = `${out}/${name}.pdf`;
  await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
  const pdf = fs.readFileSync(pdfPath).toString("latin1");
  const pdfPages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
  check(pdfPages >= 1 && pdfPages === svgPages && fs.statSync(pdfPath).size > 20000, "PDF",
    `${pdfPages} psl. (natų lapų ${svgPages}), ${(fs.statSync(pdfPath).size / 1024).toFixed(0)} KB`);
}

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
    if (await page.isVisible("#again")) await page.click("#again");
    if (await page.isVisible("#retry")) {
      await page.click("#retry");
      await page.evaluate(() => document.querySelectorAll(".sheet [data-a=del]").forEach((b) => b.click()));
    }
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
    await page.waitForFunction(() => document.getElementById("download").href.startsWith("blob:"), null, { timeout: 30e3 });
    const xml = await page.evaluate(async () => {
      const href = document.getElementById("download").href;
      return await (await fetch(href)).text();
    });
    fs.writeFileSync(`${out}/${name}.musicxml`, xml);
    const notes = (xml.match(/<note[ >]/g) || []).length;
    const measures = (xml.match(/<measure[ >]/g) || []).length;
    const hasScore = await page.waitForSelector("#score .page svg", { timeout: 60e3 }).then(() => true, () => false);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    notice(`${name}`, `${sec.toFixed(1)} s, ${notes} natų, ${measures} taktų, peržiūra: ${hasScore ? "yra" : "NĖRA"}`);
    if (notes < 10) { ok = false; error(`${name}`, `Per mažai natų: ${notes}`); }
    if (!hasScore) { ok = false; error(`${name}`, "Neatsirado natų peržiūra"); }
    if (hasScore && img === images[0]) await testEditor(name);
  }

  // Telefono vaizdas
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const ed = window.penkline.editor;
    ed.select(ed.score.noteOrder[3], true);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/telefonas-rezultatas.png` });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/telefonas-tamsus.png` });
  await page.emulateMedia({ colorScheme: "light" });
  if (await page.isVisible("#again")) await page.click("#again");
  if (await page.isVisible("#retry")) await page.click("#retry");
  await page.setInputFiles("#fileInput", images);
  await page.screenshot({ path: `${out}/telefonas-lapai.png` });
} catch (e) {
  ok = false;
  error("Svetainės patikra", e.message);
  await page.screenshot({ path: `${out}/klaida.png`, fullPage: true }).catch(() => {});
} finally {
  if (results.length) console.log(`::notice title=Redaktoriaus patikra::${results.join("%0A")}`);
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
