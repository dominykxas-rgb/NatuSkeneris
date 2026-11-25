// Penklinė: instrumento pasirinkimas. Instrumentas įrašomas į MusicXML, kad MuseScore ir
// Sibelius iškart parodytų tinkamą instrumentą ir grotų jo garsu.
//
// sound: MusicXML instrument-sound reikšmė; program: General MIDI programa (1–128);
// transpose: transponuojantiems instrumentams (natos lieka kaip lape, skamba teisingai).

export const INSTRUMENTS = [
  { id: "piano", name: "Fortepijonas", sound: "keyboard.piano", program: 1 },
  { id: "organ", name: "Vargonai", sound: "keyboard.organ.pipe", program: 20 },
  { id: "accordion", name: "Akordeonas", sound: "keyboard.accordion", program: 22 },
  { id: "violin", name: "Smuikas", sound: "strings.violin", program: 41 },
  { id: "viola", name: "Altas", sound: "strings.viola", program: 42 },
  { id: "cello", name: "Violončelė", sound: "strings.cello", program: 43 },
  { id: "contrabass", name: "Kontrabosas", sound: "strings.contrabass", program: 44,
    transpose: { diatonic: 0, chromatic: 0, octave: -1 } },
  { id: "guitar", name: "Gitara", sound: "pluck.guitar", program: 25,
    transpose: { diatonic: 0, chromatic: 0, octave: -1 } },
  { id: "flute", name: "Fleita", sound: "wind.flutes.flute", program: 74 },
  { id: "recorder", name: "Blokfleita", sound: "wind.flutes.recorder", program: 75 },
  { id: "oboe", name: "Obojus", sound: "wind.reed.oboe", program: 69 },
  { id: "clarinet", name: "Klarnetas (B♭)", sound: "wind.reed.clarinet", program: 72,
    transpose: { diatonic: -1, chromatic: -2 } },
  { id: "bassoon", name: "Fagotas", sound: "wind.reed.bassoon", program: 71 },
  { id: "alto-sax", name: "Altinis saksofonas (E♭)", sound: "wind.reed.saxophone.alto", program: 66,
    transpose: { diatonic: -5, chromatic: -9 } },
  { id: "tenor-sax", name: "Tenorinis saksofonas (B♭)", sound: "wind.reed.saxophone.tenor", program: 67,
    transpose: { diatonic: -1, chromatic: -2, octave: -1 } },
  { id: "trumpet", name: "Trimitas (B♭)", sound: "brass.trumpet", program: 57,
    transpose: { diatonic: -1, chromatic: -2 } },
  { id: "horn", name: "Valtorna (F)", sound: "brass.french-horn", program: 61,
    transpose: { diatonic: -4, chromatic: -7 } },
  { id: "trombone", name: "Trombonas", sound: "brass.trombone", program: 58 },
  { id: "voice", name: "Balsas", sound: "voice.vocals", program: 54 },
];

const kid = (el, tag) => Array.from(el.children).find((c) => c.tagName === tag) || null;

function ensure(doc, parent, tag, before = null) {
  let el = kid(parent, tag);
  if (!el) {
    el = doc.createElement(tag);
    parent.insertBefore(el, before);
  }
  return el;
}

// Grąžina MusicXML su pasirinktu instrumentu. Be pasirinkimo grąžina originalą nepakeistą.
export function applyInstrument(xml, id) {
  const inst = INSTRUMENTS.find((i) => i.id === id);
  if (!inst) return xml;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return xml;

  for (const sp of doc.querySelectorAll("part-list > score-part")) {
    const pid = sp.getAttribute("id");
    ensure(doc, sp, "part-name", sp.firstElementChild).textContent = inst.name;
    for (const tag of ["part-name-display", "part-abbreviation", "part-abbreviation-display"]) kid(sp, tag)?.remove();

    const si = ensure(doc, sp, "score-instrument");
    if (!si.getAttribute("id")) si.setAttribute("id", `${pid}-I1`);
    ensure(doc, si, "instrument-name", si.firstElementChild).textContent = inst.name;
    ensure(doc, si, "instrument-sound").textContent = inst.sound;

    const mi = ensure(doc, sp, "midi-instrument");
    if (!mi.getAttribute("id")) mi.setAttribute("id", si.getAttribute("id"));
    ensure(doc, mi, "midi-program").textContent = String(inst.program);
  }

  // Transpozicija pirmame kiekvienos partijos takte
  for (const part of doc.querySelectorAll("part")) {
    for (const t of part.querySelectorAll("attributes > transpose")) t.remove();
    if (!inst.transpose) continue;
    const measure = kid(part, "measure");
    if (!measure) continue;
    let attrs = kid(measure, "attributes");
    if (!attrs) {
      attrs = doc.createElement("attributes");
      measure.insertBefore(attrs, measure.firstElementChild);
    }
    const tr = doc.createElement("transpose");
    const add = (tag, val) => {
      const e = doc.createElement(tag);
      e.textContent = String(val);
      tr.appendChild(e);
    };
    add("diatonic", inst.transpose.diatonic);
    add("chromatic", inst.transpose.chromatic);
    if (inst.transpose.octave) add("octave-change", inst.transpose.octave);
    // MusicXML tvarka: transpose eina po clef/staff-details, prieš directive/measure-style
    const after = Array.from(attrs.children).find((c) => ["directive", "measure-style", "for-part"].includes(c.tagName));
    attrs.insertBefore(tr, after || null);
  }

  const body = new XMLSerializer().serializeToString(doc);
  return body.startsWith("<?xml") ? body : '<?xml version="1.0" encoding="UTF-8"?>\n' + body;
}
