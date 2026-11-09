// Penklinė: MusicXML natų modelis ir redagavimo veiksmai.
// Natos keičiamos tiesiogiai MusicXML dokumente, kad eksportuotas failas liktų
// tinkamas MuseScore, Sibelius ir kitoms programoms.

const STEPS = ["C", "D", "E", "F", "G", "A", "B"];
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const TYPE_QUARTERS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25, "32nd": 0.125 };
// MusicXML <note> vaikų tvarka (pagal schemą)
const NOTE_ORDER = [
  "grace", "cue", "chord", "pitch", "unpitched", "rest", "duration", "tie", "instrument",
  "footnote", "level", "voice", "type", "dot", "accidental", "time-modification", "stem",
  "notehead", "notehead-text", "staff", "beam", "notations", "lyric", "play", "listen",
];

const kids = (el, tag) => Array.from(el.children).filter((c) => c.tagName === tag);
const kid = (el, tag) => Array.from(el.children).find((c) => c.tagName === tag) || null;
const num = (el, tag, fallback = 0) => {
  const c = el && kid(el, tag);
  const v = c ? parseFloat(c.textContent) : NaN;
  return Number.isFinite(v) ? v : fallback;
};
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export class Score {
  constructor(xmlText) {
    this.doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (this.doc.querySelector("parsererror") || !this.doc.querySelector("score-partwise")) {
      throw new Error("Netinkamas MusicXML");
    }
    this.ensureIds();
    this.normalizeDivisions();
    this.analyze();
  }

  toString() {
    const body = new XMLSerializer().serializeToString(this.doc);
    return body.startsWith("<?xml") ? body : '<?xml version="1.0" encoding="UTF-8"?>\n' + body;
  }

  // ------------------------------------------------------------ paruošimas

  ensureIds() {
    let n = 0;
    let m = 0;
    for (const el of this.doc.querySelectorAll("note")) {
      if (!el.getAttribute("id")) el.setAttribute("id", `pk${++n}`);
    }
    for (const el of this.doc.querySelectorAll("measure")) {
      if (!el.getAttribute("id")) el.setAttribute("id", `pm${++m}`);
    }
  }

  // Trukmės saugomos sveikais skaičiais, todėl divisions turi dalytis iš 8,
  // kad tilptų ir šešioliktinė su tašku.
  normalizeDivisions() {
    for (const part of this.doc.querySelectorAll("part")) {
      let factor = 1;
      for (const d of part.querySelectorAll("attributes > divisions")) {
        const v = parseInt(d.textContent, 10) || 1;
        factor = Math.max(factor, 8 / gcd(v, 8));
      }
      if (factor === 1) continue;
      for (const d of part.querySelectorAll("attributes > divisions, note > duration, backup > duration, forward > duration")) {
        d.textContent = String(Math.round(parseFloat(d.textContent) * factor));
      }
    }
  }

  // Kiekvienam taktui: divisions, tonacija, metras, raktai.
  analyze() {
    this.measures = [];
    this.ctxByMeasure = new Map();
    this.noteOrder = [];
    for (const part of this.doc.querySelectorAll("part")) {
      const ctx = { div: 1, fifths: 0, beats: 4, beatType: 4, clefs: { 1: { sign: "G", line: 2 } } };
      for (const measure of kids(part, "measure")) {
        for (const attr of kids(measure, "attributes")) {
          if (kid(attr, "divisions")) ctx.div = num(attr, "divisions", ctx.div);
          const key = kid(attr, "key");
          if (key && kid(key, "fifths")) ctx.fifths = num(key, "fifths", 0);
          const time = kid(attr, "time");
          if (time && kid(time, "beats")) {
            ctx.beats = num(time, "beats", 4);
            ctx.beatType = num(time, "beat-type", 4);
          }
          for (const clef of kids(attr, "clef")) {
            const n = parseInt(clef.getAttribute("number") || "1", 10);
            ctx.clefs = { ...ctx.clefs, [n]: { sign: kid(clef, "sign")?.textContent || "G", line: num(clef, "line", 2) } };
          }
        }
        this.ctxByMeasure.set(measure, { ...ctx, clefs: { ...ctx.clefs } });
        this.measures.push(measure);
        for (const note of kids(measure, "note")) this.noteOrder.push(note.getAttribute("id"));
      }
    }
  }

  note(id) {
    return this.doc.querySelector(`note[id="${CSS.escape(id)}"]`);
  }

  ctx(note) {
    return this.ctxByMeasure.get(note.parentElement);
  }

  // ------------------------------------------------------------ informacija pasirinktai natai

  info(id) {
    const el = this.note(id);
    if (!el) return null;
    const pitch = kid(el, "pitch");
    const rest = kid(el, "rest");
    const accidental = kid(el, "accidental")?.textContent || null;
    return {
      id,
      isRest: !!rest,
      isGrace: !!kid(el, "grace"),
      type: kid(el, "type")?.textContent || (rest && rest.getAttribute("measure") === "yes" ? "measure" : null),
      dotted: kids(el, "dot").length > 0,
      alter: pitch ? num(pitch, "alter", 0) : null,
      accidental,
      step: pitch ? kid(pitch, "step")?.textContent : null,
      octave: pitch ? num(pitch, "octave", 4) : null,
    };
  }

  // ------------------------------------------------------------ pagalbinės

  set(note, tag, text) {
    let el = kid(note, tag);
    if (!el) {
      el = this.doc.createElement(tag);
      const idx = NOTE_ORDER.indexOf(tag);
      const before = Array.from(note.children).find((c) => NOTE_ORDER.indexOf(c.tagName) > idx);
      note.insertBefore(el, before || null);
    }
    if (text != null) el.textContent = String(text);
    return el;
  }

  remove(note, tag) {
    for (const el of kids(note, tag)) el.remove();
  }

  keyAlter(fifths, step) {
    if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(step)) return 1;
    if (fifths < 0 && SHARP_ORDER.slice().reverse().slice(0, -fifths).includes(step)) return -1;
    return 0;
  }

  setPitch(note, step, octave, alter) {
    const pitch = kid(note, "pitch");
    // Pitch vaikų tvarka: step, alter, octave
    pitch.textContent = "";
    const s = this.doc.createElement("step");
    s.textContent = step;
    pitch.appendChild(s);
    if (alter) {
      const a = this.doc.createElement("alter");
      a.textContent = String(alter);
      pitch.appendChild(a);
    }
    const o = this.doc.createElement("octave");
    o.textContent = String(octave);
    pitch.appendChild(o);
  }

  // Akordo natos: pirmoji (be <chord/>) ir visos po jos su <chord/>
  chordGroup(note) {
    let head = note;
    while (kid(head, "chord")) {
      const prev = head.previousElementSibling;
      if (!prev || prev.tagName !== "note") break;
      head = prev;
    }
    const group = [head];
    let next = head.nextElementSibling;
    while (next && next.tagName === "note" && kid(next, "chord")) {
      group.push(next);
      next = next.nextElementSibling;
    }
    return group;
  }

  noteDuration(note) {
    return Math.round(num(note, "duration", 0));
  }

  durationFor(note, type, dotted) {
    const { div } = this.ctx(note);
    let d = TYPE_QUARTERS[type] * div * (dotted ? 1.5 : 1);
    const tm = kid(note, "time-modification");
    if (tm) d = (d * num(tm, "normal-notes", 1)) / num(tm, "actual-notes", 1);
    return Math.max(1, Math.round(d));
  }

  typeForDuration(dur, div) {
    for (const [type, q] of Object.entries(TYPE_QUARTERS)) {
      if (Math.round(q * div) === dur) return { type, dotted: false };
      if (Math.round(q * div * 1.5) === dur) return { type, dotted: true };
    }
    return { type: "whole", dotted: false };
  }

  // Pakeitus trukmę, kito balso <backup> turi grįžti į tą pačią vietą
  shiftBackup(afterNote, delta) {
    if (!delta) return;
    let el = afterNote.nextElementSibling;
    while (el) {
      if (el.tagName === "backup") {
        const d = kid(el, "duration");
        d.textContent = String(Math.max(0, Math.round(parseFloat(d.textContent) + delta)));
        return;
      }
      el = el.nextElementSibling;
    }
  }

  defaultPitch(note) {
    const staff = parseInt(kid(note, "staff")?.textContent || "1", 10);
    const clef = this.ctx(note).clefs[staff] || { sign: "G", line: 2 };
    if (clef.sign === "F") return ["D", 3];
    if (clef.sign === "C") return ["C", 4];
    return ["B", 4];
  }

  // ------------------------------------------------------------ veiksmai (grąžina true, jei kas pasikeitė)

  movePitch(id, steps) {
    const note = this.note(id);
    const pitch = note && kid(note, "pitch");
    if (!pitch) return false;
    const step = kid(pitch, "step").textContent;
    const index = STEPS.indexOf(step) + num(pitch, "octave", 4) * 7 + steps;
    const newStep = STEPS[((index % 7) + 7) % 7];
    const octave = Math.floor(index / 7);
    if (octave < 0 || octave > 9) return false;
    this.setPitch(note, newStep, octave, this.keyAlter(this.ctx(note).fifths, newStep));
    this.remove(note, "accidental");
    return true;
  }

  setAccidental(id, alter) {
    const note = this.note(id);
    const pitch = note && kid(note, "pitch");
    if (!pitch) return false;
    const step = kid(pitch, "step").textContent;
    const octave = num(pitch, "octave", 4);
    const names = { 1: "sharp", "-1": "flat", 0: "natural" };
    const current = kid(note, "accidental")?.textContent;
    if (current === names[alter] && num(pitch, "alter", 0) === alter) {
      // Antras paspaudimas grąžina tonacijos ženklą
      this.setPitch(note, step, octave, this.keyAlter(this.ctx(note).fifths, step));
      this.remove(note, "accidental");
    } else {
      this.setPitch(note, step, octave, alter);
      this.set(note, "accidental", names[alter]);
    }
    return true;
  }

  setDuration(id, type, dotted) {
    const note = this.note(id);
    if (!note) return false;
    const group = this.chordGroup(note);
    const head = group[0];
    const grace = !!kid(head, "grace");
    const oldDur = grace ? 0 : this.noteDuration(head);
    for (const n of group) {
      const rest = kid(n, "rest");
      if (rest) rest.removeAttribute("measure");
      if (!grace) this.set(n, "duration", this.durationFor(n, type, dotted));
      this.set(n, "type", type);
      this.remove(n, "dot");
      if (dotted) this.set(n, "dot");
    }
    if (!grace) this.shiftBackup(group[group.length - 1], this.noteDuration(head) - oldDur);
    return true;
  }

  toggleDot(id) {
    const info = this.info(id);
    if (!info) return false;
    const type = info.type && info.type !== "measure" ? info.type : this.typeForDuration(
      this.noteDuration(this.note(id)), this.ctx(this.note(id)).div).type;
    return this.setDuration(id, type, !info.dotted);
  }

  // Nata → pauzė (akorde nata tiesiog pašalinama), pauzė → nata
  toggleRest(id) {
    const note = this.note(id);
    if (!note) return false;
    const rest = kid(note, "rest");
    if (rest) {
      const measureRest = rest.getAttribute("measure") === "yes";
      const pitch = this.doc.createElement("pitch");
      note.replaceChild(pitch, rest);
      const [step, octave] = this.defaultPitch(note);
      this.setPitch(note, step, octave, this.keyAlter(this.ctx(note).fifths, step));
      if (measureRest || !kid(note, "type")) {
        const t = this.typeForDuration(this.noteDuration(note), this.ctx(note).div);
        this.set(note, "type", t.type);
        this.remove(note, "dot");
        if (t.dotted) this.set(note, "dot");
      }
      return true;
    }
    return this.deleteNote(id);
  }

  deleteNote(id) {
    const note = this.note(id);
    if (!note || kid(note, "rest")) return false;
    const group = this.chordGroup(note);
    if (group.length > 1) {
      if (note === group[0]) this.remove(group[1], "chord");
      note.remove();
      this.analyze();
      return true;
    }
    const pitch = kid(note, "pitch");
    const rest = this.doc.createElement("rest");
    note.replaceChild(rest, pitch);
    for (const tag of ["accidental", "tie", "stem", "beam", "notehead", "notations"]) this.remove(note, tag);
    return true;
  }

  setTitle(title) {
    const root = this.doc.documentElement;
    let work = kid(root, "work");
    if (!work) {
      work = this.doc.createElement("work");
      root.insertBefore(work, root.firstElementChild);
    }
    let wt = kid(work, "work-title");
    if (!wt) {
      wt = this.doc.createElement("work-title");
      work.appendChild(wt);
    }
    wt.textContent = title;
    const mt = kid(root, "movement-title");
    if (mt) mt.textContent = title;
  }

  title() {
    const root = this.doc.documentElement;
    return kid(kid(root, "work") || root, "work-title")?.textContent?.trim() ||
      kid(root, "movement-title")?.textContent?.trim() || "";
  }

  // ------------------------------------------------------------ taktų patikra

  // Grąžina taktų id, kuriuose kurio nors balso trukmė nesutampa su metru.
  badMeasures() {
    const bad = [];
    for (const [i, measure] of this.measures.entries()) {
      const ctx = this.ctxByMeasure.get(measure);
      const expected = Math.round(ctx.beats * (4 / ctx.beatType) * ctx.div);
      const sums = new Map();
      for (const note of kids(measure, "note")) {
        if (kid(note, "grace") || kid(note, "chord")) continue;
        const key = (kid(note, "staff")?.textContent || "1") + "|" + (kid(note, "voice")?.textContent || "1");
        const rest = kid(note, "rest");
        const dur = rest && rest.getAttribute("measure") === "yes" ? expected : this.noteDuration(note);
        sums.set(key, (sums.get(key) || 0) + dur);
      }
      const first = i === 0;
      const last = i === this.measures.length - 1 || this.measures[i + 1].parentElement !== measure.parentElement;
      for (const total of sums.values()) {
        if (total > expected || (total < expected && !first && !last)) {
          bad.push(measure.getAttribute("id"));
          break;
        }
      }
    }
    return bad;
  }

  firstNoteIn(measureId) {
    const m = this.doc.querySelector(`measure[id="${CSS.escape(measureId)}"]`);
    return m ? kid(m, "note")?.getAttribute("id") : null;
  }
}
