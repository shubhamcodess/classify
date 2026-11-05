// Saved work, kept in this browser's IndexedDB. A listing reads only the small "meta" records, so the
// Projects screen stays fast even when a project holds a large file and its results.
const DB = "classify";
const open = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("meta", { keyPath: "id" });
      req.result.createObjectStore("data", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const tx = async (stores, mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    const r = fn(t);
    if (r) r.onsuccess = () => (out = r.result);
    t.oncomplete = () => (db.close(), resolve(out));
    t.onerror = t.onabort = () => (db.close(), reject(t.error));
  });
};
export const listProjects = async () => ((await tx(["meta"], "readonly", (t) => t.objectStore("meta").getAll())) || []).sort((a, b) => b.savedAt - a.savedAt);
export const readProject = (id) => tx(["data"], "readonly", (t) => t.objectStore("data").get(id));
export const writeProject = (meta, data) =>
  tx(["meta", "data"], "readwrite", (t) => {
    t.objectStore("meta").put(meta);
    t.objectStore("data").put({ ...data, id: meta.id });
  });
export const renameProjectMeta = async (id, name) => {
  const metas = await listProjects();
  const meta = metas.find((m) => m.id === id);
  if (meta) await tx(["meta"], "readwrite", (t) => void t.objectStore("meta").put({ ...meta, name }));
};
export const removeProject = (id) =>
  tx(["meta", "data"], "readwrite", (t) => {
    t.objectStore("meta").delete(id);
    t.objectStore("data").delete(id);
  });
