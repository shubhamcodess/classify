// The two downloadable models and how they run. Works in a Web Worker (browser) and in Node (benchmark).
import { createLaya } from "./laya.js";

const viteEnv = import.meta.env || {};
const nodeEnv = typeof process !== "undefined" ? process.env || {} : {};

export const MODELS = {
  meaning: {
    key: "meaning",
    title: "Meaning",
    id: "Xenova/bge-small-en-v1.5",
    original: "BAAI/bge-small-en-v1.5",
    licence: "MIT",
    file: "model_quantized.onnx",
    weights: "model_quantized.onnx",
    bytes: 34014426,
    purpose: "Compares each row with your examples by meaning, so a paraphrase still matches.",
  },
  laya: {
    key: "laya",
    title: "Laya",
    // Convai Innovations' fine-tuned checkpoint, exported to ONNX by scripts/laya-export (see README).
    id: viteEnv.VITE_LAYA_REPO || nodeEnv.LAYA_REPO || "shubhamcodess/laya-typed-decisions-ONNX",
    original: "convaiinnovations/laya-typed-decisions",
    licence: "Apache-2.0",
    file: "model_fp16.onnx",
    weights: "model_fp16.onnx_data",
    bytes: 847235452,
    purpose: "A decision model. Reads the row and scores your options in one pass, as a second opinion.",
  },
};

const LOCAL = viteEnv.VITE_LAYA_LOCAL || nodeEnv.LAYA_LOCAL || "";
const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
const MAX_CHARS = 2000;
const VEC_LIMIT = 50000;
const OLD_CACHE = "transformers-cache";
const CACHE_DIR = "classify-models";

// Chromium refused to store the 843 MB weights in the Cache API, so Laya would download on every visit.
// The origin-private file system has no such limit, and works in a worker.
async function cacheDir() {
  if (!globalThis.navigator?.storage?.getDirectory) return null;
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(CACHE_DIR, { create: true });
}
const fileName = (key) => encodeURIComponent(String(key));
export function createFileCache() {
  return {
    async match(key) {
      try {
        const dir = await cacheDir();
        const file = await (await dir.getFileHandle(fileName(key))).getFile();
        return new Response(file, { headers: { "content-length": String(file.size) } });
      } catch {
        return undefined;
      }
    },
    async put(key, response) {
      const dir = await cacheDir();
      const file = await dir.getFileHandle(fileName(key), { create: true });
      // A writable stream only replaces the file when it closes, so a failed download leaves nothing behind.
      await response.body.pipeTo(await file.createWritable());
    },
  };
}

export function createRuntime(onStatus = () => {}) {
  let T = null;
  let extractor = null;
  let laya = null;
  const pending = {};
  let queue = Promise.resolve(); // one load at a time: the library's settings are shared
  const vecs = new Map();

  const tf = async () => {
    if (T) return T;
    T = await import("@huggingface/transformers");
    if (!isNode && (await cacheDir().catch(() => null))) {
      T.env.useBrowserCache = false;
      T.env.useCustomCache = true;
      T.env.customCache = createFileCache();
      navigator.storage.persist?.().catch(() => {});
      globalThis.caches?.delete(OLD_CACHE).catch(() => {}); // from earlier versions
    } else T.env.useBrowserCache = !isNode && typeof caches !== "undefined";
    return T;
  };
  const progress = (name) => {
    const m = MODELS[name];
    const files = new Map();
    return (p) => {
      if (!p?.file || (p.status !== "progress" && p.status !== "download")) return;
      const total = p.total || (p.file.includes(m.file) ? m.bytes : 0);
      files.set(p.file, { loaded: Math.min(p.loaded || 0, total || Infinity), total });
      let loaded = 0;
      let sum = 0;
      for (const f of files.values()) (loaded += f.loaded), (sum += f.total);
      // the weights file dominates; keep the known size in the total even before it starts
      sum = Math.max(sum, m.bytes);
      onStatus(name, { state: "downloading", loaded, total: sum, progress: Math.min(1, loaded / sum) });
    };
  };

  async function loadMeaning() {
    const t = await tf();
    t.env.allowLocalModels = false;
    t.env.allowRemoteModels = true;
    extractor = await t.pipeline("feature-extraction", MODELS.meaning.id, { dtype: "q8", device: isNode ? "cpu" : "wasm", progress_callback: progress("meaning") });
    return { device: "CPU (WebAssembly)" };
  }

  async function pickDevice() {
    if (isNode) return "cpu";
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      if (adapter?.features.has("shader-f16")) return "webgpu";
    } catch {}
    return "wasm";
  }

  async function loadLaya() {
    const t = await tf();
    t.env.allowLocalModels = Boolean(LOCAL);
    t.env.allowRemoteModels = !LOCAL;
    if (LOCAL) t.env.localModelPath = LOCAL;
    const id = MODELS.laya.id;
    const device = await pickDevice();
    const on = progress("laya");
    const tokenizer = await t.AutoTokenizer.from_pretrained(id, { progress_callback: on });
    const config = await t.AutoConfig.from_pretrained(id, { progress_callback: on });
    const model = await t.AutoModel.from_pretrained(id, { config, dtype: "fp16", device, progress_callback: on });
    const c = tokenizer.config || {};
    laya = createLaya({
      tokenizer,
      model,
      Tensor: t.Tensor,
      section: config.laya,
      tokens: { cls: c.cls_token, sep: c.sep_token, mask: c.mask_token, pad: c.pad_token },
    });
    return { device: device === "webgpu" ? "GPU (WebGPU)" : "CPU (slow)" };
  }

  function load(name) {
    if (name === "meaning" && extractor) return Promise.resolve();
    if (name === "laya" && laya) return Promise.resolve();
    pending[name] ||= (queue = queue.catch(() => {}).then(async () => {
      onStatus(name, { state: "loading", progress: 0, loaded: 0, total: 0, error: null });
      try {
        const info = await (name === "meaning" ? loadMeaning() : loadLaya());
        onStatus(name, { state: "ready", progress: 1, cached: true, error: null, ...info });
      } catch (e) {
        const message = name === "laya" && /locate|404|401|fetch|Unauthorized/i.test(e?.message || "") ? `The browser build of Laya is not available at ${MODELS.laya.id} yet.` : e?.message || String(e);
        onStatus(name, { state: "error", error: message });
        throw new Error(message);
      } finally {
        delete pending[name];
      }
    }));
    return pending[name];
  }

  async function embed(texts, batch = 16, onBatch) {
    await load("meaning");
    const out = new Array(texts.length);
    const todo = [];
    const keys = texts.map((t) => String(t).slice(0, MAX_CHARS));
    keys.forEach((k, i) => {
      const hit = vecs.get(k);
      if (hit) out[i] = hit;
      else todo.push(i);
    });
    for (let i = 0; i < todo.length; i += batch) {
      const idx = todo.slice(i, i + batch);
      const res = await extractor(idx.map((j) => keys[j].trim() || " "), { pooling: "cls", normalize: true });
      const dims = res.dims[res.dims.length - 1];
      idx.forEach((j, k) => {
        const v = res.data.slice(k * dims, (k + 1) * dims);
        if (vecs.size >= VEC_LIMIT) vecs.delete(vecs.keys().next().value);
        vecs.set(keys[j], v);
        out[j] = v;
      });
      onBatch?.(Math.min(i + batch, todo.length), todo.length);
    }
    return out;
  }

  async function decide(states, question) {
    await load("laya");
    return laya.decideBatch(states, question);
  }

  async function checkCache() {
    const out = { meaning: false, laya: false };
    try {
      const dir = await cacheDir();
      if (dir) {
        const names = [];
        for await (const name of dir.keys()) names.push(decodeURIComponent(name));
        for (const key of Object.keys(out)) out[key] = names.some((n) => n.includes(MODELS[key].id) && n.endsWith(MODELS[key].weights));
      }
    } catch {}
    return out;
  }

  async function clear(name) {
    if (name === "meaning") {
      extractor = null;
      vecs.clear();
    } else laya = null;
    try {
      const dir = await cacheDir();
      for await (const f of dir.keys()) if (decodeURIComponent(f).includes(MODELS[name].id)) await dir.removeEntry(f);
    } catch {}
    onStatus(name, { state: "idle", cached: false, progress: 0, loaded: 0, total: 0, error: null, device: null });
  }

  return { load, embed, decide, checkCache, clear };
}
