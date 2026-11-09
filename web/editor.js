// Penklinė: natų peržiūra ir redagavimas (Verovio atvaizduoja, Score keičia MusicXML).

import { Score } from "./score.js";

let verovioPromise = null;
export function loadVerovio(src = "vendor/verovio/verovio-toolkit-wasm.js") {
  verovioPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => {
      try {
        /* global verovio */
        const m = verovio.module;
        const done = () => {
          try { resolve(new verovio.toolkit()); } catch (e) { reject(e); }
        };
        if (m.calledRun) done();
        else m.onRuntimeInitialized = done;
      } catch (e) {
        verovioPromise = null;
        reject(new Error("Nepavyko įkelti natų peržiūros"));
      }
    };
    s.onerror = () => {
      verovioPromise = null;
      reject(new Error("Nepavyko įkelti natų peržiūros"));
    };
    document.head.appendChild(s);
  });
  return verovioPromise;
}

const NOTE_ICON = {
  whole: '<ellipse cx="9" cy="15" rx="5.5" ry="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  half: '<ellipse cx="8" cy="16" rx="4.6" ry="3.2" fill="none" stroke="currentColor" stroke-width="1.7" transform="rotate(-20 8 16)"/><path d="M12.2 15V3" stroke="currentColor" stroke-width="1.5"/>',
  quarter: '<ellipse cx="8" cy="16" rx="4.6" ry="3.2" fill="currentColor" transform="rotate(-20 8 16)"/><path d="M12.2 15V3" stroke="currentColor" stroke-width="1.5"/>',
  eighth: '<ellipse cx="7" cy="16" rx="4.6" ry="3.2" fill="currentColor" transform="rotate(-20 7 16)"/><path d="M11.2 15V3" stroke="currentColor" stroke-width="1.5"/><path d="M11.2 3c1 3 5 4 4 9" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  "16th": '<ellipse cx="7" cy="16" rx="4.6" ry="3.2" fill="currentColor" transform="rotate(-20 7 16)"/><path d="M11.2 15V3" stroke="currentColor" stroke-width="1.5"/><path d="M11.2 3c1 3 5 3 4 7M11.2 7c1 3 5 3 4 7" fill="none" stroke="currentColor" stroke-width="1.5"/>',
};
const DURATIONS = [
  ["whole", "Sveikoji", "6"], ["half", "Pusinė", "5"], ["quarter", "Ketvirtinė", "4"],
  ["eighth", "Aštuntinė", "3"], ["16th", "Šešioliktinė", "2"],
];

export class ScoreEditor {
  constructor({ score, toolbar, status, onChange }) {
    this.scoreEl = score;
    this.toolbarEl = toolbar;
    this.statusEl = status;
    this.onChange = onChange || (() => {});
    this.score = null;
    this.tk = null;
    this.selected = null;
    this.undoStack = [];
    this.redoStack = [];
    this.buildToolbar();
    this.scoreEl.addEventListener("click", (e) => this.onClick(e));
    document.addEventListener("keydown", (e) => this.onKey(e));
    let w = window.innerWidth;
    window.addEventListener("resize", () => {
      if (Math.abs(window.innerWidth - w) > 80 && this.score) { w = window.innerWidth; this.render(); }
    });
  }

  get active() {
    return !!this.score && this.scoreEl.offsetParent !== null;
  }

  async load(xml) {
    this.tk = await loadVerovio();
    this.score = new Score(xml);
    this.selected = null;
    this.undoStack = [];
    this.redoStack = [];
    this.render();
  }

  xml() {
    return this.score ? this.score.toString() : "";
  }

  title() {
    return this.score ? this.score.title() : "";
  }

  setTitle(title) {
    if (!this.score || title === this.score.title()) return;
    this.change(() => { this.score.setTitle(title); return true; }, { rerender: true });
  }

  // ------------------------------------------------------------ atvaizdavimas

  options(print = false) {
    if (print) {
      return {
        pageWidth: 2100, pageHeight: 2970, scale: 45, adjustPageHeight: false,
        pageMarginTop: 80, pageMarginBottom: 80, pageMarginLeft: 80, pageMarginRight: 80,
        footer: "none", header: "auto", breaks: "auto",
      };
    }
    const width = this.scoreEl.clientWidth || 900;
    const narrow = width < 640;
    const scale = narrow ? 34 : 42;
    return {
      pageWidth: Math.max(900, Math.round((width - 24) * 100 / scale)),
      pageHeight: 60000, scale, adjustPageHeight: true,
      pageMarginTop: 40, pageMarginBottom: 40, pageMarginLeft: 40, pageMarginRight: 40,
      footer: "none", header: "auto", breaks: "auto",
    };
  }

  render() {
    const y = window.scrollY;
    this.tk.setOptions(this.options());
    this.tk.loadData(this.score.toString());
    const parts = [];
    for (let i = 1; i <= this.tk.getPageCount(); i++) parts.push(`<div class="page">${this.tk.renderToSVG(i)}</div>`);
    this.scoreEl.innerHTML = parts.join("");
    this.bad = this.score.badMeasures();
    for (const id of this.bad) this.scoreEl.querySelector(`#${CSS.escape(id)}`)?.classList.add("bad");
    this.highlight();
    this.updateStatus();
    window.scrollTo(0, y);
    this.midiDirty = true;
  }

  midi() {
    if (!this.score) return "";
    this.tk.setOptions(this.options());
    this.tk.loadData(this.score.toString());
    this.midiDirty = false;
    return this.tk.renderToMIDI();
  }

  highlight() {
    this.scoreEl.querySelectorAll(".sel").forEach((el) => el.classList.remove("sel"));
    if (this.selected) this.scoreEl.querySelector(`#${CSS.escape(this.selected)}`)?.classList.add("sel");
    this.updateToolbar();
  }

  updateStatus() {
    const n = this.bad.length;
    this.statusEl.innerHTML = "";
    if (!n) {
      if (!this.everSelected) this.statusEl.textContent = "Spustelėk natą, kad ją pataisytum.";
      return;
    }
    const span = document.createElement("span");
    span.textContent = n === 1
      ? "1 takte natų trukmė nesutampa su metru."
      : `${n} ${n % 10 === 0 || (n % 100 > 10 && n % 100 < 20) ? "taktų" : "taktuose"} natų trukmė nesutampa su metru.`;
    const btn = document.createElement("button");
    btn.className = "link";
    btn.textContent = "Rodyti";
    btn.onclick = () => {
      const cur = this.selected && this.score.note(this.selected)?.parentElement.getAttribute("id");
      const next = this.bad[(this.bad.indexOf(cur) + 1) % n];
      this.select(this.score.firstNoteIn(next), true);
    };
    this.statusEl.append(span, " ", btn);
  }

  // ------------------------------------------------------------ pasirinkimas

  onClick(e) {
    if (!this.score) return;
    let el = e.target.closest("g.note, g.rest, g.mRest");
    if (!el) {
      // Telefone sunku pataikyti: imam artimiausią natą 44 px spinduliu
      let best = null;
      let bestD = 44;
      for (const g of this.scoreEl.querySelectorAll("g.note, g.rest, g.mRest")) {
        const r = g.getBoundingClientRect();
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
        const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = g; }
      }
      el = best;
    }
    this.select(el ? el.id : null);
  }

  select(id, scroll = false) {
    this.selected = id && this.score.note(id) ? id : null;
    if (this.selected && !this.everSelected) {
      this.everSelected = true;
      if (!this.bad.length) this.statusEl.textContent = "";
    }
    this.highlight();
    if (scroll && this.selected) {
      this.scoreEl.querySelector(`#${CSS.escape(this.selected)}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  step(dir) {
    const order = this.score.noteOrder;
    if (!order.length) return;
    const i = order.indexOf(this.selected);
    const next = i < 0 ? 0 : Math.min(order.length - 1, Math.max(0, i + dir));
    this.select(order[next], true);
  }

  // ------------------------------------------------------------ keitimai

  change(fn, { rerender = true } = {}) {
    const before = this.score.toString();
    if (!fn()) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.score.analyze();
    if (this.selected && !this.score.note(this.selected)) this.selected = null;
    if (rerender) this.render();
    this.onChange();
  }

  restore(xml) {
    const sel = this.selected;
    this.score = new Score(xml);
    this.selected = sel && this.score.note(sel) ? sel : null;
    this.render();
    this.onChange();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.score.toString());
    this.restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.score.toString());
    this.restore(this.redoStack.pop());
  }

  act(name, ...args) {
    if (!this.score) return;
    if (name === "undo") return this.undo();
    if (name === "redo") return this.redo();
    const id = this.selected;
    if (!id) return;
    const s = this.score;
    const ops = {
      up: () => s.movePitch(id, 1),
      down: () => s.movePitch(id, -1),
      octUp: () => s.movePitch(id, 7),
      octDown: () => s.movePitch(id, -7),
      sharp: () => s.setAccidental(id, 1),
      flat: () => s.setAccidental(id, -1),
      natural: () => s.setAccidental(id, 0),
      dot: () => s.toggleDot(id),
      rest: () => s.toggleRest(id),
      del: () => s.deleteNote(id),
    };
    if (name === "dur") {
      // Paspaudus kitą trukmę taškas nuimamas, kaip MuseScore
      return this.change(() => s.setDuration(id, args[0], false));
    }
    this.change(ops[name]);
  }

  onKey(e) {
    if (!this.active) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const map = {
      ArrowUp: ctrl ? "octUp" : "up", ArrowDown: ctrl ? "octDown" : "down",
      Delete: "del", Backspace: "del", "0": "rest", ".": "dot",
      "+": "sharp", "#": "sharp", "-": "flat", "=": "natural",
    };
    let handled = true;
    if (ctrl && (e.key === "z" || e.key === "Z")) this.act(e.shiftKey ? "redo" : "undo");
    else if (ctrl && (e.key === "y" || e.key === "Y")) this.act("redo");
    else if (ctrl) handled = false;
    else if (e.key === "ArrowLeft") this.step(-1);
    else if (e.key === "ArrowRight") this.step(1);
    else if (e.key === "Escape") this.select(null);
    else if (map[e.key] && this.selected) this.act(map[e.key]);
    else if (DURATIONS.some((d) => d[2] === e.key) && this.selected) this.act("dur", DURATIONS.find((d) => d[2] === e.key)[0]);
    else handled = false;
    if (handled) e.preventDefault();
  }

  // ------------------------------------------------------------ įrankių juosta

  buildToolbar() {
    const b = (act, html, title, cls = "") =>
      `<button type="button" class="tool ${cls}" data-act="${act}" title="${title}" aria-label="${title.replace(/ \(.+\)$/, "")}">${html}</button>`;
    const svg = (inner) => `<svg viewBox="0 0 18 22" width="18" height="22" aria-hidden="true">${inner}</svg>`;
    this.toolbarEl.innerHTML = `
      <div class="group">
        ${b("up", "↑", "Aukščiau (↑)")}${b("down", "↓", "Žemiau (↓)")}
      </div>
      <div class="group">
        ${b("sharp", "♯", "Diezas (+)", "acc")}${b("flat", "♭", "Bemolis (−)", "acc")}${b("natural", "♮", "Bekaras (=)", "acc")}
      </div>
      <div class="group">
        ${DURATIONS.map(([t, name, key]) => b("dur:" + t, svg(NOTE_ICON[t]), `${name} (${key})`)).join("")}
        ${b("dot", '<span class="dot-icon">•</span>', "Taškas (.)")}
      </div>
      <div class="group">
        ${b("rest", "Pauzė", "Nata ↔ pauzė (0)", "text")}${b("del", "Ištrinti", "Ištrinti (Delete)", "text")}
      </div>
      <div class="group">
        ${b("undo", "↶", "Atšaukti (Ctrl+Z)")}${b("redo", "↷", "Grąžinti (Ctrl+Y)")}
      </div>`;
    this.toolbarEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn || btn.disabled) return;
      const [act, arg] = btn.dataset.act.split(":");
      this.act(act, arg);
    });
    this.updateToolbar();
  }

  updateToolbar() {
    const info = this.score && this.selected ? this.score.info(this.selected) : null;
    for (const btn of this.toolbarEl.querySelectorAll("button[data-act]")) {
      const [act, arg] = btn.dataset.act.split(":");
      let enabled = !!info;
      let on = false;
      if (act === "undo") enabled = this.undoStack.length > 0;
      if (act === "redo") enabled = this.redoStack.length > 0;
      if (info) {
        if (["up", "down", "sharp", "flat", "natural", "del"].includes(act)) enabled = !info.isRest;
        if (act === "dur") on = info.type === arg;
        if (act === "dot") on = info.dotted;
        if (act === "rest") on = info.isRest;
        if (act === "sharp") on = info.accidental === "sharp";
        if (act === "flat") on = info.accidental === "flat";
        if (act === "natural") on = info.accidental === "natural";
      }
      btn.disabled = !enabled;
      btn.classList.toggle("on", on);
    }
  }

  // ------------------------------------------------------------ PDF (spausdinimas)

  async print(title) {
    if (!this.score) return;
    document.getElementById("printout")?.remove();
    const box = document.createElement("div");
    box.id = "printout";
    this.tk.setOptions(this.options(true));
    this.tk.loadData(this.score.toString());
    const pages = [];
    for (let i = 1; i <= this.tk.getPageCount(); i++) pages.push(`<div class="print-page">${this.tk.renderToSVG(i)}</div>`);
    box.innerHTML = pages.join("");
    document.body.appendChild(box);
    const oldTitle = document.title;
    document.title = title || "natos"; // naršyklė šį pavadinimą siūlo PDF failui
    const cleanup = () => {
      box.remove();
      document.title = oldTitle;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.print();
    // Ekrane #printout paslėptas, todėl jei afterprint neateis, jis niekam netrukdo.
  }
}
