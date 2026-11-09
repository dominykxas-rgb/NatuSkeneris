// Penklinė: atpažinimas atskirame naršyklės procese (Web Worker).
// Python (Pyodide) vykdo homr kodą, ONNX Runtime Web vykdo modelius.

import { loadPyodide } from "./vendor/pyodide/pyodide.mjs";
import * as ort from "./vendor/ort/ort.min.mjs";

const BASE = new URL("./", import.meta.url).href;
let config = null;      // config.json: modelių failai ir dydžiai
let pyodide = null;
let ready = null;       // Promise, kai viskas paruošta
const sessions = [];    // ort.InferenceSession pagal id
const sessionByName = new Map();
const modelBytes = new Map();

ort.env.wasm.wasmPaths = BASE + "vendor/ort/";
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
  : 1;

const post = (type, data = {}) => self.postMessage({ type, ...data });

// ---------------------------------------------------------------- tenzoriai (kviečia onnxruntime.py)

const TYPED = {
  float32: Float32Array, float64: Float64Array, int32: Int32Array, int64: BigInt64Array,
  int8: Int8Array, uint8: Uint8Array, bool: Uint8Array, float16: Uint16Array,
};

self.penklineTensor = (type, bytes, dims) => {
  const buffer = bytes.slice().buffer; // kopija su 0 poslinkiu (lygiavimas)
  const Typed = TYPED[type];
  return new ort.Tensor(type, new Typed(buffer), Array.from(dims));
};

self.penklineTensorBytes = (tensor) => {
  const d = tensor.data;
  return {
    type: tensor.type,
    dims: Array.from(tensor.dims),
    bytes: new Uint8Array(d.buffer, d.byteOffset, d.byteLength),
  };
};

self.penklineCreateSession = async (name) => {
  if (sessionByName.has(name)) return sessionByName.get(name);
  let bytes = modelBytes.get(name);
  if (!bytes) bytes = await fetchModel(name);
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  modelBytes.delete(name); // modelis jau įkeltas, baitų nebereikia
  sessions.push(session);
  const info = {
    id: sessions.length - 1,
    inputNames: session.inputNames,
    outputNames: session.outputNames,
  };
  sessionByName.set(name, info);
  return info;
};

self.penklineRun = async (id, feeds, names) => {
  const result = await sessions[id].run(feeds, Array.from(names));
  return Array.from(names, (n) => result[n]);
};

// ---------------------------------------------------------------- atsisiuntimai

async function fetchWithProgress(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nepavyko atsisiųsti ${url} (${res.status})`);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

async function fetchModel(name) {
  const m = config.models.find((x) => x.file === name);
  if (!m) throw new Error("Nežinomas modelis: " + name);
  return fetchWithProgress(BASE + "models/" + name, () => {});
}

// ---------------------------------------------------------------- paruošimas

async function prepare() {
  const t0 = performance.now();
  config = await (await fetch(BASE + "config.json", { cache: "no-cache" })).json();

  const total = config.models.reduce((s, m) => s + m.size, 0) + config.pythonBytes;
  let done = 0;
  const bump = (n) => {
    done += n;
    post("prepare", { fraction: Math.min(1, done / total) });
  };

  // Modeliai siunčiami lygiagrečiai su Python įkėlimu.
  const models = Promise.all(config.models.map(async (m) => {
    modelBytes.set(m.file, await fetchWithProgress(BASE + "models/" + m.file, bump));
  }));

  pyodide = await loadPyodide({ indexURL: BASE + "vendor/pyodide/" });
  bump(config.pythonBytes * 0.3);
  await pyodide.loadPackage(config.packages, { messageCallback: () => {} });
  bump(config.pythonBytes * 0.4);

  const homr = await (await fetch(BASE + "homr.zip")).arrayBuffer();
  pyodide.unpackArchive(homr, "zip", { extractDir: "/penkline" });
  bump(config.pythonBytes * 0.3);

  pyodide.setStdout({ batched: (line) => post("log", { line }) });
  pyodide.setStderr({ batched: (line) => post("log", { line }) });

  pyodide.runPython("import sys; sys.path.insert(0, '/penkline')");
  // Modelių vykdymui reikia JavaScript Promise Integration (JSPI).
  const jspi = await pyodide.runPythonAsync(
    "from pyodide.ffi import can_run_sync\ncan_run_sync()"
  ).catch(() => false);
  if (!jspi) throw new Error("UNSUPPORTED");
  await models;
  await pyodide.runPythonAsync("import penkline_web");
  post("log", { line: `Paruošta per ${((performance.now() - t0) / 1000).toFixed(1)} s` });
}

// ---------------------------------------------------------------- pranešimai

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "prepare") {
    ready ??= prepare();
    try {
      await ready;
      post("ready");
    } catch (err) {
      ready = null;
      post("error", { message: String(err && err.message || err), stage: "prepare" });
    }
    return;
  }
  if (msg.type === "recognize") {
    try {
      ready ??= prepare();
      await ready;
      const t0 = performance.now();
      pyodide.FS.mkdirTree("/work/in");
      for (const f of pyodide.FS.readdir("/work/in")) {
        if (f !== "." && f !== "..") pyodide.FS.unlink("/work/in/" + f);
      }
      const names = [];
      msg.files.forEach((f, i) => {
        const safe = String(i + 1).padStart(2, "0") + "_" + f.name.replace(/[\\/:*?"<>|]/g, "_");
        pyodide.FS.writeFile("/work/in/" + safe, new Uint8Array(f.data));
        names.push(safe);
      });
      pyodide.globals.set("_names", pyodide.toPy(names));
      const xml = await pyodide.runPythonAsync(
        "from penkline_web import recognize\nrecognize(list(_names))"
      );
      post("done", { xml, seconds: (performance.now() - t0) / 1000 });
    } catch (err) {
      const message = String(err && err.message || err);
      post("error", { message, stage: "recognize" });
    }
  }
};
