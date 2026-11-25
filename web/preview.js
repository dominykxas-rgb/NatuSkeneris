// Penklinė: atpažintų natų peržiūra, grojimas ir PDF (Verovio).

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

export class ScorePreview {
  constructor(container) {
    this.el = container;
    this.verovioSrc = "vendor/verovio/verovio-toolkit-wasm.js"; // svetainėje nustato app.js
    this.tk = null;
    this.xml = "";
    let w = window.innerWidth;
    window.addEventListener("resize", () => {
      if (this.xml && Math.abs(window.innerWidth - w) > 80) { w = window.innerWidth; this.render(); }
    });
  }

  async load(xml) {
    this.tk = await loadVerovio(this.verovioSrc);
    this.xml = xml;
    this.render();
  }

  options(print = false) {
    if (print) {
      return {
        pageWidth: 2100, pageHeight: 2970, scale: 45, adjustPageHeight: false,
        pageMarginTop: 80, pageMarginBottom: 80, pageMarginLeft: 80, pageMarginRight: 80,
        footer: "none", header: "auto", breaks: "auto",
      };
    }
    const width = this.el.clientWidth || 900;
    const scale = width < 640 ? 34 : 42;
    return {
      pageWidth: Math.max(900, Math.round((width - 24) * 100 / scale)),
      pageHeight: 60000, scale, adjustPageHeight: true,
      pageMarginTop: 40, pageMarginBottom: 40, pageMarginLeft: 40, pageMarginRight: 40,
      footer: "none", header: "auto", breaks: "auto",
    };
  }

  render() {
    this.tk.setOptions(this.options());
    this.tk.loadData(this.xml);
    const pages = [];
    for (let i = 1; i <= this.tk.getPageCount(); i++) pages.push(`<div class="page">${this.tk.renderToSVG(i)}</div>`);
    this.el.innerHTML = pages.join("");
  }

  midi() {
    return this.tk ? this.tk.renderToMIDI() : "";
  }

  // PDF per naršyklės spausdinimą: A4 natų lapai
  async print(title) {
    if (!this.tk) return;
    document.getElementById("printout")?.remove();
    const box = document.createElement("div");
    box.id = "printout";
    this.tk.setOptions(this.options(true));
    this.tk.loadData(this.xml);
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
  }
}
