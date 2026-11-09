// Penklinė svetainėje: lango logika. Atpažinimas vyksta worker.js.

const $ = (id) => document.getElementById(id);
let files = [];
let worker = null;
let prepared = false;
let preparing = false;
let running = false;
let page = 0;
let totalPages = 0;
let logLines = [];
let resultFile = null;

// ---------------------------------------------------------------- worker

function startWorker() {
  worker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => fail("Nepavyko paleisti atpažinimo: " + (e.message || "nežinoma klaida"));
  prepared = false;
  preparing = true;
  worker.postMessage({ type: "prepare" });
}

function onWorkerMessage(e) {
  const m = e.data;
  if (m.type === "prepare") {
    const pct = Math.floor(m.fraction * 100);
    $("prep").textContent = pct < 100 ? `Ruošiama ${pct} %` : "";
    if (running && !page) setStage(`Ruošiama ${pct} %`, m.fraction);
  } else if (m.type === "ready") {
    prepared = true;
    preparing = false;
    $("prep").textContent = "";
    if (running && !page) setStage("Atpažįstamos natos", null);
  } else if (m.type === "log") {
    logLines.push(m.line);
    if (logLines.length > 400) logLines = logLines.slice(-400);
    if (running && m.line.startsWith("=====")) {
      page += 1;
      setStage(
        totalPages > 1 ? `Atpažįstamas ${page} puslapis iš ${totalPages}` : "Atpažįstamos natos",
        totalPages > 1 ? (page - 0.5) / totalPages : null,
      );
    }
  } else if (m.type === "done") {
    running = false;
    showResult(m.xml);
  } else if (m.type === "error") {
    preparing = false;
    running = false;
    if (m.message.includes("UNSUPPORTED")) {
      fail(
        "Ši naršyklė dar negali vykdyti atpažinimo. Atidaryk Penklinę naujausioje Chrome, Edge " +
        "ar Samsung Internet versijoje.",
        "", "Naršyklė nepalaikoma",
      );
    } else if (m.stage === "prepare") {
      $("prep").textContent = "Nepavyko paruošti";
      if (running || !$("work").classList.contains("hidden")) {
        fail("Nepavyko atsisiųsti atpažinimo failų. Patikrink interneto ryšį ir bandyk dar kartą.", m.message);
      }
    } else {
      fail(friendlyError(m.message), logLines.join("\n") + "\n\n" + m.message);
    }
  }
}

function friendlyError(msg) {
  if (/No staffs found|No noteheads/i.test(msg)) {
    return "Lape neradau natų. Nufotografuok lapą tiesiai iš viršaus, prie gero apšvietimo.";
  }
  if (/memory|Out of bounds|RangeError/i.test(msg)) {
    return "Pritrūko atminties. Pabandyk atpažinti mažiau lapų vienu kartu.";
  }
  return "Natų atpažinti nepavyko. Nufotografuok lapą tiesiai iš viršaus, prie gero apšvietimo, ir bandyk dar kartą.";
}

// ---------------------------------------------------------------- būsenos

function show(id) {
  for (const s of ["pick", "work", "fail", "done"]) $(s).classList.toggle("hidden", s !== id);
  window.scrollTo(0, 0);
}

function fail(msg, log, title = "Nepavyko") {
  running = false;
  $("errorTitle").textContent = title;
  $("errorText").textContent = msg;
  $("errLog").textContent = log || "";
  $("errLog").parentElement.classList.toggle("hidden", !log);
  show("fail");
}

function setStage(text, fraction) {
  $("stage").textContent = text;
  const m = $("meter");
  m.classList.toggle("indet", fraction == null);
  m.style.setProperty("--p", fraction == null ? "0%" : Math.round(fraction * 100) + "%");
}

// ---------------------------------------------------------------- lapai

const lapu = (n) => (n === 1 ? "lapas" : n % 10 === 0 || (n % 100 > 10 && n % 100 < 20) ? "lapų" : "lapai");
const isPdf = (f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf";

function render() {
  const ul = $("sheets");
  ul.innerHTML = "";
  files.forEach((f, i) => {
    const li = document.createElement("li");
    li.className = "sheet";
    const pdf = isPdf(f.file);
    li.innerHTML = `
      <div class="paper">
        ${pdf ? '<span class="pdf">PDF</span>' : '<img alt="">'}
        <span class="nr">${i + 1}</span>
        <div class="tools">
          <button data-a="left" title="Perkelti į kairę" aria-label="Perkelti į kairę">‹</button>
          <button data-a="right" title="Perkelti į dešinę" aria-label="Perkelti į dešinę">›</button>
          <button data-a="del" title="Pašalinti" aria-label="Pašalinti">✕</button>
        </div>
      </div>
      <div class="name"></div>`;
    if (!pdf) li.querySelector("img").src = f.url;
    li.querySelector(".name").textContent = f.file.name;
    li.querySelector(".name").title = f.file.name;
    li.querySelectorAll("button").forEach((b) => (b.onclick = () => {
      const a = b.dataset.a;
      if (a === "del") { URL.revokeObjectURL(f.url); files.splice(i, 1); }
      if (a === "left" && i > 0) [files[i - 1], files[i]] = [files[i], files[i - 1]];
      if (a === "right" && i < files.length - 1) [files[i + 1], files[i]] = [files[i], files[i + 1]];
      render();
    }));
    ul.appendChild(li);
  });
  if (files.length) {
    const add = document.createElement("button");
    add.className = "add";
    add.textContent = "+";
    add.title = "Pridėti lapų";
    add.setAttribute("aria-label", "Pridėti lapų");
    add.onclick = () => $("fileInput").click();
    ul.appendChild(add);
  }
  $("sheets").classList.toggle("hidden", !files.length);
  $("empty").classList.toggle("hidden", !!files.length);
  $("count").textContent = files.length ? `${files.length} ${lapu(files.length)}` : "";
  $("start").disabled = !files.length;
}

function addFiles(list) {
  for (const file of list) {
    if (isPdf(file) || file.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(file.name)) {
      files.push({ file, url: URL.createObjectURL(file) });
    }
  }
  render();
}

$("choose").onclick = () => $("fileInput").click();
$("fileInput").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("over"); });
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

// ---------------------------------------------------------------- PDF → paveikslėliai

let pdfjs = null;
async function pdfToImages(file) {
  pdfjs ??= await import("./vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const base = p.getViewport({ scale: 1 });
    // ~300 DPI, bet ne daugiau kaip 3000 px ilgesnė kraštinė (telefono atminčiai)
    const scale = Math.min(300 / 72, 3000 / Math.max(base.width, base.height));
    const vp = p.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    out.push({ name: `${file.name.replace(/\.pdf$/i, "")}_${n}.png`, data: await blob.arrayBuffer() });
    canvas.width = canvas.height = 0;
  }
  return out;
}

// ---------------------------------------------------------------- atpažinimas

$("start").onclick = async () => {
  show("work");
  running = true;
  page = 0;
  logLines = [];
  setStage(prepared ? "Atpažįstamos natos" : "Ruošiama", null);
  try {
    const payload = [];
    for (const f of files) {
      if (isPdf(f.file)) {
        setStage("Atveriamas PDF", null);
        payload.push(...(await pdfToImages(f.file)));
      } else {
        payload.push({ name: f.file.name, data: await f.file.arrayBuffer() });
      }
    }
    totalPages = payload.length;
    if (!running) return;
    setStage(prepared ? "Atpažįstamos natos" : "Ruošiama", null);
    if (!worker) startWorker();
    worker.postMessage({ type: "recognize", files: payload }, payload.map((p) => p.data));
  } catch (err) {
    fail("Nepavyko atverti failo. " + (err.message || ""));
  }
};

$("cancel").onclick = () => {
  running = false;
  if (worker) worker.terminate();
  worker = null;
  startWorker();
  show("pick");
};
$("retry").onclick = () => show("pick");
$("again").onclick = () => {
  files.forEach((f) => URL.revokeObjectURL(f.url));
  files = [];
  render();
  show("pick");
};

// ---------------------------------------------------------------- rezultatas

let verovioReady = null;
function loadVerovio() {
  verovioReady ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/verovio/verovio-toolkit-wasm.js";
    s.onload = () => {
      // eslint-disable-next-line no-undef
      verovio.module.onRuntimeInitialized = () => resolve(new verovio.toolkit());
    };
    s.onerror = () => reject(new Error("Nepavyko įkelti peržiūros"));
    document.head.appendChild(s);
  });
  return verovioReady;
}

function baseName() {
  const first = files[0] ? files[0].file.name : "natos";
  return first.replace(/\.[^.]+$/, "") || "natos";
}

async function showResult(xml) {
  const name = baseName();
  resultFile = new File([xml], name + ".musicxml", { type: "application/vnd.recordare.musicxml+xml" });
  const url = URL.createObjectURL(resultFile);
  $("title").textContent = name;
  $("download").href = url;
  $("download").download = resultFile.name;
  $("share").classList.toggle(
    "hidden",
    !(navigator.canShare && navigator.canShare({ files: [resultFile] })),
  );
  $("player").innerHTML = "";
  $("score").innerHTML = '<p class="muted">Ruošiama peržiūra</p>';
  show("done");
  try {
    const tk = await loadVerovio();
    const narrow = window.innerWidth < 640;
    tk.setOptions({
      pageWidth: narrow ? 1200 : 2100, pageHeight: 2970, scale: narrow ? 30 : 40,
      adjustPageHeight: true, footer: "none", header: "auto", breaks: "auto",
    });
    tk.loadData(xml);
    $("score").innerHTML = "";
    for (let i = 1; i <= tk.getPageCount(); i++) {
      const d = document.createElement("div");
      d.className = "page";
      d.innerHTML = tk.renderToSVG(i);
      $("score").appendChild(d);
    }
    const midi = tk.renderToMIDI();
    if (midi && customElements.get("midi-player")) {
      const pl = document.createElement("midi-player");
      pl.setAttribute("src", "data:audio/midi;base64," + midi);
      pl.setAttribute("sound-font", "");
      $("player").appendChild(pl);
    }
  } catch (err) {
    $("score").innerHTML = "";
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Peržiūros parodyti nepavyko. Atsisiųstas failas vis tiek tinkamas.";
    $("score").appendChild(p);
  }
}

$("share").onclick = async () => {
  try { await navigator.share({ files: [resultFile], title: resultFile.name }); } catch { /* atšaukta */ }
};

// ---------------------------------------------------------------- pradžia

render();
startWorker();
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
// Testams: window.penkline leidžia patikrinti būseną.
window.penkline = { get prepared() { return prepared; }, get log() { return logLines; } };
