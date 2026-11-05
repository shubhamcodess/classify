// The page's handle on the models: talks to the worker and keeps one status per model.
import { MODELS } from "./models.js";

const blank = { state: "idle", progress: 0, loaded: 0, total: 0, error: null, cached: false, device: null };
const status = { meaning: { ...blank }, laya: { ...blank } };
const listeners = new Set();
const calls = new Map();
let worker = null;
let seq = 0;

function set(name, patch) {
  status[name] = { ...status[name], ...patch };
  for (const fn of listeners) fn(name, status[name]);
}
function w() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data: m }) => {
    if (m.type === "status") return set(m.name, m.patch);
    const call = calls.get(m.id);
    if (!call) return;
    if (m.type === "tick") return call.tick?.(m.done, m.total);
    calls.delete(m.id);
    if (m.type === "done") call.resolve(m.result);
    else call.reject(new Error(m.error));
  };
  worker.onerror = (e) => {
    for (const call of calls.values()) call.reject(new Error(e.message || "The model worker stopped"));
    calls.clear();
    worker = null;
  };
  return worker;
}
function call(op, args, tick) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    calls.set(id, { resolve, reject, tick });
    w().postMessage({ id, op, args });
  });
}

export { MODELS };
export const getStatus = (name) => status[name];
export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const loadModel = (name) => call("load", [name]);
export const clearModel = (name) => call("clear", [name]);
export const backend = {
  embed: (texts, onTick) => call("embed", { texts, batch: 16 }, onTick),
  decide: (states, question) => call("decide", [states, question]),
};
export async function refreshCache() {
  const found = await call("checkCache");
  for (const name of Object.keys(found)) set(name, { cached: found[name] });
  return found;
}
