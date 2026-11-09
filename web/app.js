// Penklinė: lango logika. Tas pats failas veikia dviem režimais:
// - svetainėje atpažinimas vyksta naršyklėje (worker.js);
// - Windows programoje atpažinimą atlieka vietinis serveris (adrese yra #t=raktas).

import { ScoreEditor } from "./editor.js";

const $ = (id) => document.getElementById(id);
const TOKEN = new URLSearchParams(location.hash.slice(1)).get("t");
const DESKTOP = !!TOKEN;
document.documentElement.classList.add(DESKTOP ? "desktop" : "web");
if (DESKTOP) $("fileInput").accept = "image/*,.heic,.heif,.pdf,application/pdf";

let files = [];
let running = false;
let page = 0;
let totalPages = 0;
let logLines = [];
let resultName = "natos";

const editor = new ScoreEditor({
  score: $("score"),
  toolbar: $("toolbar"),
  status: $("measureStatus"),
  onChange: () => onScoreChange(),
});

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

function onLogLine(line) {
  logLines.push(line);
  if (logLines.length > 400) logLines = logLines.slice(-400);
  if (running && line.startsWith("=====")) {
    page += 1;
    setStage(
      totalPages > 1 ? `Atpažįstamas ${page} puslapis iš ${totalPages}` : "Atpažįstamos natos",
      totalPages > 1 ? (page - 0.5) / totalPages : null,
    );
  }
}

function friendlyError(msg) {
  if (/No staffs found|No noteheads/i.test(msg)) {
    return "Lape neradau natų. Nufotografuok lapą tiesiai iš viršaus, prie gero apšvietimo.";
  }
  if (/out of memory|memory access out of bounds|Array buffer allocation failed/i.test(msg)) {
    return "Pritrūko atminties. Pabandyk atpažinti mažiau lapų vienu kartu.";
  }
  return "Natų atpažinti nepavyko. Nufotografuok lapą tiesiai iš viršaus, prie gero apšvietimo, ir bandyk dar kartą.";
}

// ---------------------------------------------------------------- atpažinimas naršyklėje

const webBackend = {
  worker: null,
  prepared: false,
  start() {
    this.worker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => fail("Nepavyko paleisti atpažinimo: " + (e.message || "nežinoma klaida"));
    this.prepared = false;
    this.worker.postMessage({ type: "prepare" });
  },
  onMessage(m) {
    if (m.type === "prepare") {
      const pct = Math.floor(m.fraction * 100);
      $("prep").textContent = pct < 100 ? `Ruošiama ${pct} %` : "";
      if (running && !page) setStage(`Ruošiama ${pct} %`, m.fraction);
    } else if (m.type === "ready") {
      this.prepared = true;
      $("prep").textContent = "";
      if (running && !page) setStage("Atpažįstamos natos", null);
    } else if (m.type === "log") {
      onLogLine(m.line);
    } else if (m.type === "done") {
      running = false;
      showResult(m.xml);
    } else if (m.type === "error") {
      if (m.message.includes("UNSUPPORTED")) {
        fail("Ši naršyklė dar negali vykdyti atpažinimo. Atidaryk Penklinę naujausioje Chrome, Edge " +
          "ar Samsung Internet versijoje.", "", "Naršyklė nepalaikoma");
      } else if (m.stage === "prepare") {
        $("prep").textContent = "Nepavyko paruošti";
        if (running) fail("Nepavyko atsisiųsti atpažinimo failų. Patikrink interneto ryšį ir bandyk dar kartą.", m.message);
      } else {
        fail(friendlyError(m.message), logLines.join("\n") + "\n\n" + m.message);
      }
    }
  },
  async recognize(list) {
    const payload = [];
    for (const f of list) {
      if (isPdf(f)) {
        setStage("Atveriamas PDF", null);
        payload.push(...(await pdfToImages(f)));
      } else {
        payload.push({ name: f.name, data: await f.arrayBuffer() });
      }
    }
    totalPages = payload.length;
    if (!running) return;
    setStage(this.prepared ? "Atpažįstamos natos" : "Ruošiama", null);
    if (!this.worker) this.start();
    this.worker.postMessage({ type: "recognize", files: payload }, payload.map((p) => p.data));
  },
  cancel() {
    this.worker?.terminate();
    this.start();
  },
};

let pdfjs = null;
async function pdfToImages(file) {
  pdfjs ??= await import("./vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const base = p.getViewport({ scale: 1 });
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

// ---------------------------------------------------------------- atpažinimas Windows programoje

async function api(path, opts = {}) {
  opts.headers = Object.assign({ "X-Token": TOKEN }, opts.headers || {});
  const r = await fetch(path, opts);
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || "Klaida " + r.status);
  }
  return (r.headers.get("Content-Type") || "").includes("json") ? r.json() : r.text();
}
const post = (path, body) => api(path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
});

const desktopBackend = {
  jobId: null,
  savedPath: "",
  start() {
    setInterval(() => post("/api/ping").catch(() => {}), 10000);
    post("/api/ping").catch(() => {});
    $("openFolder").onclick = () => post("/api/open-folder").catch((e) => alert(e.message));
  },
  async recognize(list) {
    totalPages = list.length;
    setStage("Įkeliami lapai", null);
    this.jobId = (await post("/api/new")).id;
    const names = [];
    for (const [i, f] of list.entries()) {
      const safe = String(i + 1).padStart(2, "0") + "_" + f.name.replace(/[\\/:*?"<>|]/g, "_");
      await api(`/api/job/${this.jobId}/upload?name=${encodeURIComponent(safe)}`, { method: "POST", body: f });
      names.push(safe);
    }
    await post(`/api/job/${this.jobId}/start`, { files: names });
    this.poll();
  },
  async poll() {
    if (!running) return;
    try {
      const j = await api(`/api/job/${this.jobId}`);
      if (j.status === "done") {
        running = false;
        this.savedPath = j.saved || "";
        const xml = await api(`/api/job/${this.jobId}/download`);
        return showResult(xml);
      }
      if (j.status === "error") return fail(j.error, (j.log || []).join("\n"));
      if (j.pages) totalPages = j.pages;
      const frac = j.pages && j.page ? (j.page - 0.5) / j.pages : null;
      setStage(j.stage || "Atpažįstamos natos", frac);
      setTimeout(() => this.poll(), 1200);
    } catch (e) { fail(e.message); }
  },
  cancel() {
    if (this.jobId) post(`/api/job/${this.jobId}/cancel`).catch(() => {});
  },
  saveTimer: null,
  saving: Promise.resolve(),
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 500);
  },
  saveNow() {
    clearTimeout(this.saveTimer);
    if (!this.jobId) return this.saving;
    const xml = editor.xml();
    this.saving = this.saving.then(() => post(`/api/job/${this.jobId}/save`, { xml }))
      .catch((e) => alert("Nepavyko išsaugoti: " + e.message));
    return this.saving;
  },
};

const backend = DESKTOP ? desktopBackend : webBackend;

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
    const heic = /\.hei[cf]$/i.test(f.file.name);
    li.innerHTML = `
      <div class="paper">
        ${pdf ? '<span class="pdf">PDF</span>' : heic ? '<span class="pdf">HEIC</span>' : '<img alt="">'}
        <span class="nr">${i + 1}</span>
        <div class="tools">
          <button data-a="left" title="Perkelti į kairę" aria-label="Perkelti į kairę">‹</button>
          <button data-a="right" title="Perkelti į dešinę" aria-label="Perkelti į dešinę">›</button>
          <button data-a="del" title="Pašalinti" aria-label="Pašalinti">✕</button>
        </div>
      </div>
      <div class="name"></div>`;
    if (!pdf && !heic) li.querySelector("img").src = f.url;
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
    if (isPdf(file) || file.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|tiff?|hei[cf])$/i.test(file.name)) {
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

$("start").onclick = async () => {
  show("work");
  running = true;
  page = 0;
  logLines = [];
  setStage("Ruošiama", null);
  resultName = (files[0]?.file.name || "natos").replace(/\.[^.]+$/, "") || "natos";
  try {
    await backend.recognize(files.map((f) => f.file));
  } catch (err) {
    fail("Nepavyko atverti failo. " + (err.message || ""));
  }
};

$("cancel").onclick = () => {
  running = false;
  backend.cancel();
  show("pick");
};
$("retry").onclick = () => show("pick");
$("again").onclick = async () => {
  if (DESKTOP) await desktopBackend.saveNow();
  files.forEach((f) => URL.revokeObjectURL(f.url));
  files = [];
  render();
  show("pick");
};

// ---------------------------------------------------------------- rezultatas ir redagavimas

let downloadUrl = null;
let midiTimer = null;

function fileName() {
  const t = editor.title().trim() || resultName;
  return t.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "natos";
}

function refreshDownload() {
  if (DESKTOP) return;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  const file = new File([editor.xml()], fileName() + ".musicxml", { type: "application/vnd.recordare.musicxml+xml" });
  downloadUrl = URL.createObjectURL(file);
  $("download").href = downloadUrl;
  $("download").download = file.name;
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  $("share").classList.toggle("hidden", !canShare);
  $("share").onclick = async () => {
    try { await navigator.share({ files: [file], title: file.name }); } catch { /* atšaukta */ }
  };
}

function refreshMidi() {
  clearTimeout(midiTimer);
  midiTimer = setTimeout(() => {
    const box = $("player");
    if (!customElements.get("midi-player")) {
      // grotuvas įkeliamas iš interneto; jei dar neįsikėlė, pabandom vėliau
      customElements.whenDefined("midi-player").then(refreshMidi);
      return;
    }
    const midi = editor.midi();
    if (!midi) return;
    let pl = box.querySelector("midi-player");
    if (!pl) {
      pl = document.createElement("midi-player");
      pl.setAttribute("sound-font", "");
      box.appendChild(pl);
    }
    pl.setAttribute("src", "data:audio/midi;base64," + midi);
  }, 400);
}

function onScoreChange() {
  refreshDownload();
  refreshMidi();
  if (DESKTOP) desktopBackend.scheduleSave();
}

async function showResult(xml) {
  show("done");
  $("player").innerHTML = "";
  $("score").innerHTML = '<p class="muted">Ruošiama peržiūra</p>';
  $("savedAt").textContent = DESKTOP ? desktopBackend.savedPath : "";
  $("title").value = resultName;
  try {
    await editor.load(xml);
    $("title").value = editor.title() || resultName;
    refreshDownload();
    refreshMidi();
  } catch (err) {
    $("score").innerHTML = "";
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Peržiūros parodyti nepavyko. " + (DESKTOP ? "Failas išsaugotas." : "Failą vis tiek gali atsisiųsti.");
    $("score").appendChild(p);
    if (!DESKTOP) {
      const file = new File([xml], resultName + ".musicxml");
      $("download").href = URL.createObjectURL(file);
      $("download").download = file.name;
    }
  }
}

$("title").addEventListener("change", () => editor.setTitle($("title").value.trim()));
$("title").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
$("pdf").onclick = () => editor.print(fileName());
$("open").onclick = async () => {
  await desktopBackend.saveNow();
  post(`/api/job/${desktopBackend.jobId}/open`).catch((e) => alert(e.message));
};
$("reveal").onclick = () => post(`/api/job/${desktopBackend.jobId}/reveal`).catch((e) => alert(e.message));

// ---------------------------------------------------------------- pradžia

render();
backend.start();
if (!DESKTOP && "serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
// Testams
window.penkline = {
  get prepared() { return DESKTOP || webBackend.prepared; },
  get log() { return logLines; },
  editor,
};
