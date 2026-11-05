// All app state lives here so it survives moving between screens, and a run keeps going in the background.
import { PLAYBOOKS, blankPlaybook } from "../playbooks.js";
import { parseFile, guessTextColumns } from "../parse.js";
import { runPlaybook, refreshRow, rowText, usableLabels, DEFAULT_THRESHOLD } from "../engine/run.js";
import { backend, getStatus, loadModel } from "../engine/client.js";
import { buildExport } from "../export.js";
import { listProjects, readProject, writeProject, removeProject, renameProjectMeta } from "./projects-db.js";

const KEY = "classify-playbooks-v1";
const PREFS = "classify-prefs-v1";
const clone = (x) => JSON.parse(JSON.stringify(x));
const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

function initialPlaybooks() {
  const saved = read(KEY);
  const all = clone(PLAYBOOKS);
  if (saved) return { ...all, ...saved };
  const old = read("classify-state-v1"); // labels from the earlier version of the app
  if (old?.labels?.length && old.preset === "imported") all.imported = { ...blankPlaybook("imported"), name: "Imported labels", categories: old.labels };
  return all;
}
const prefs = read(PREFS) || {};

export const state = {
  playbooks: initialPlaybooks(),
  activeId: prefs.activeId || "support",
  engine: prefs.engine || "meaning",
  layaAll: false,
  threshold: prefs.threshold || DEFAULT_THRESHOLD,
  data: null,
  textCols: [],
  results: [],
  overrides: {},
  learned: 0,
  dirty: false,
  exported: false,
  projectId: null,
  projectName: "",
  saveState: "",
  run: { status: "idle", stage: "", done: 0, total: 0, error: null, startedAt: 0, ms: 0 },
  fileError: null,
};
if (!state.playbooks[state.activeId]) state.activeId = "support";

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const emit = (what = "all") => listeners.forEach((fn) => fn(what));

export const active = () => state.playbooks[state.activeId];
export const savePlaybooks = () => write(KEY, state.playbooks);
const savePrefs = () => write(PREFS, { activeId: state.activeId, engine: state.engine, threshold: state.threshold });

export function setActive(id) {
  state.activeId = id;
  chooseColumns();
  savePrefs();
  emit();
}
export function setEngine(e) {
  state.engine = e;
  savePrefs();
  emit();
}
export function setThreshold(t) {
  state.threshold = t;
  savePrefs();
  rescoreFlags();
  emit();
}
export function touchPlaybook() {
  savePlaybooks();
  if (state.results.length) state.dirty = true;
  emit("playbook");
}
export function resetPlaybook(id) {
  if (PLAYBOOKS[id]) state.playbooks[id] = clone(PLAYBOOKS[id]);
  touchPlaybook();
}
export function newPlaybook() {
  const id = `p${Date.now()}`;
  state.playbooks[id] = blankPlaybook(id);
  state.activeId = id;
  savePlaybooks();
  savePrefs();
  emit();
  return id;
}
export function removePlaybook(id) {
  delete state.playbooks[id];
  if (state.activeId === id) state.activeId = "support";
  savePlaybooks();
  savePrefs();
  emit();
}

function chooseColumns() {
  const d = state.data;
  if (!d) return;
  const hint = active()?.textHint || [];
  const named = d.columns.filter((c) => hint.includes(c.toLowerCase()));
  const guessed = named.length ? named : guessTextColumns(d.columns, d.rows);
  state.textCols = guessed.length ? guessed : d.columns.slice(0, 1);
}
function clearResults() {
  state.results = [];
  state.overrides = {};
  state.learned = 0;
  state.dirty = false;
  state.exported = false;
  state.projectId = null;
  state.projectName = "";
  state.saveState = "";
  state.run = { status: "idle", stage: "", done: 0, total: 0, error: null, startedAt: 0, ms: 0 };
}
export async function openFile(file, opts) {
  cancelRun();
  state.fileError = null;
  try {
    const parsed = await parseFile(file, opts);
    if (!parsed.rows.length) throw new Error("No rows found. Is the table on another sheet?");
    state.data = parsed;
    state.file = file;
    clearResults();
    chooseColumns();
  } catch (e) {
    state.fileError = `Could not read ${file.name}: ${e.message}`;
  }
  emit();
}
export const switchSheet = (sheet) => openFile(state.file, { sheet });
export function closeFile() {
  cancelRun();
  state.data = null;
  state.file = null;
  clearResults();
  emit();
}
export function openSample() {
  const pb = active();
  const source = pb.sample ? pb : PLAYBOOKS.support;
  if (source !== pb) state.activeId = source.id;
  const buf = new TextEncoder().encode(source.sample).buffer;
  return openFile({ name: source.sampleName, arrayBuffer: async () => buf });
}
export function toggleColumn(c) {
  const on = state.textCols.includes(c);
  if (on && state.textCols.length === 1) return;
  state.textCols = on ? state.textCols.filter((x) => x !== c) : state.data.columns.filter((x) => x === c || state.textCols.includes(x));
  emit();
}

export const engineNeeds = (e = state.engine) => (e === "laya" ? ["meaning", "laya"] : e === "meaning" ? ["meaning"] : []);
export const missingDownloads = () => engineNeeds().filter((m) => !getStatus(m).cached && getStatus(m).state !== "ready");
export function runProblem() {
  const pb = active();
  if (!state.data) return "Add a file first.";
  const c = usableLabels(pb.categories).length;
  const d = usableLabels(pb.decisions).length;
  if (c < 2 && d < 2) return "This playbook needs at least two categories or two decisions with examples.";
  return null;
}

let token = 0;
export function cancelRun() {
  if (state.run.status === "running") state.run = { ...state.run, status: "cancelled" };
  token++;
}
let lastEmit = 0;
export async function startRun() {
  if (runProblem()) return;
  const mine = ++token;
  const d = state.data;
  const pb = clone(active());
  const previous = state.results;
  state.run = { status: "running", stage: "Getting ready", done: 0, total: d.rows.length, error: null, startedAt: performance.now(), ms: 0 };
  state.results = previous.length === d.rows.length ? previous : new Array(d.rows.length).fill(null);
  state.dirty = false;
  state.exported = false;
  emit();
  const live = () => mine === token;
  try {
    let useLaya = state.engine === "laya";
    if (state.engine !== "words") await loadModel("meaning");
    if (useLaya) {
      // Laya is an optional second opinion: if it cannot load, finish the job without it and say so.
      try {
        await loadModel("laya");
      } catch (e) {
        useLaya = false;
        state.run = { ...state.run, warning: `Laya could not load, so this run used words and meaning only. ${e.message}` };
      }
    }
    if (!live()) return;
    await runPlaybook({
      playbook: pb,
      rows: d.rows,
      textCols: state.textCols,
      engine: { meaning: state.engine !== "words", laya: useLaya, layaAll: state.layaAll },
      backend,
      results: state.results,
      overrides: state.overrides,
      threshold: state.threshold,
      cancelled: () => !live(),
      onProgress: ({ stage, done, total }) => {
        if (!live()) return;
        state.run = { ...state.run, stage, done, total, ms: performance.now() - state.run.startedAt };
        const now = performance.now();
        if (now - lastEmit > 200 || stage === "done") {
          lastEmit = now;
          emit("progress");
        }
      },
    });
    if (live()) state.run = { ...state.run, status: "done", stage: "done", ms: performance.now() - state.run.startedAt };
    if (live()) autosave();
  } catch (e) {
    if (live()) state.run = { ...state.run, status: "error", error: e.message };
  }
  emit();
}

function rescoreFlags() {
  if (!state.data) return;
  state.results.forEach((r, i) => r && refreshRow(i, state.data.rows, state.results, active(), state.overrides, state.threshold));
}

/** A reviewer's answer: it fixes this row and, if it changed anything, becomes a training example. */
export function correct(i, patch, { learn = true } = {}) {
  const r = state.results[i];
  state.overrides[i] = { ...state.overrides[i], ...patch };
  const text = rowText(state.data.rows[i], state.textCols);
  const pb = active();
  if (learn) {
    for (const [field, list] of [["category", pb.categories], ["decision", pb.decisions]]) {
      const name = patch[field];
      if (!name || name === r[field]?.label) continue;
      const label = list.find((l) => l.name.trim() === name);
      if (label && !label.examples.includes(text)) {
        label.examples = label.examples.filter((x) => x.trim()).concat(text);
        state.learned++;
        state.dirty = true;
      }
    }
    savePlaybooks();
  }
  refreshRow(i, state.data.rows, state.results, pb, state.overrides, state.threshold);
  state.exported = false;
  autosave();
  emit("results");
}
export function approve(i) {
  const r = state.results[i];
  correct(i, { category: r.category?.label, decision: r.decision?.label }, { learn: false });
}

export async function exportFile(format) {
  const out = await buildExport(state.data, state.results, format);
  const url = URL.createObjectURL(new Blob([out.data], { type: out.mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: out.filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  state.exported = true;
  return out.filename;
}

export function summary() {
  const done = state.results.filter((r) => r && !r.skipped);
  const review = done.filter((r) => r.needsReview && !r.reviewed).length;
  return { total: done.length || state.data?.rows.length || 0, scored: done.length, review, reviewed: done.filter((r) => r.reviewed).length, auto: done.length - review - done.filter((r) => r.reviewed).length };
}

/* ---------- saved projects (IndexedDB, this browser only) ---------- */
let saved = [];
export const projects = () => saved;
export async function refreshProjects() {
  saved = await listProjects();
  emit("projects");
  return saved;
}
function snapshot() {
  const d = state.data;
  const { buffer, name } = d;
  return {
    meta: {
      id: state.projectId,
      name: state.projectName,
      fileName: name,
      bytes: buffer.byteLength,
      rows: d.rows.length,
      review: summary().review,
      playbook: active().name,
      savedAt: Date.now(),
    },
    data: { fileName: name, buffer, sheet: d.sheet, textCols: state.textCols, results: state.results, overrides: state.overrides, learned: state.learned, dirty: state.dirty, playbookId: state.activeId, playbook: active(), engine: state.engine, threshold: state.threshold },
  };
}
export async function saveProject(name) {
  if (!state.data) return;
  if (!state.projectId) {
    state.projectId = `w${Date.now()}`;
    state.projectName = name || state.data.name.replace(/\.[^.]+$/, "");
  }
  state.saveState = "saving";
  emit("results");
  const { meta, data } = snapshot();
  await writeProject(meta, data);
  navigator.storage?.persist?.().catch(() => {});
  state.saveState = "saved";
  await refreshProjects();
}
let saveTimer = 0;
function autosave() {
  if (!state.projectId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProject().catch((e) => {
    state.saveState = `Could not save: ${e.message}`;
    emit("results");
  }), 500);
}
export async function openProject(id) {
  const p = await readProject(id);
  if (!p) throw new Error("this project is no longer in this browser");
  cancelRun();
  const file = new File([p.buffer], p.fileName);
  const parsed = await parseFile(file, { sheet: p.sheet });
  state.file = file;
  state.data = parsed;
  // Keep the playbook this work was done with: restore it if it has since been deleted.
  if (!state.playbooks[p.playbookId]) state.playbooks[p.playbookId] = p.playbook;
  state.activeId = p.playbookId;
  state.engine = p.engine;
  state.threshold = p.threshold;
  state.textCols = p.textCols;
  state.results = p.results;
  state.overrides = p.overrides;
  state.learned = p.learned;
  state.dirty = p.dirty || JSON.stringify(state.playbooks[p.playbookId]) !== JSON.stringify(p.playbook);
  state.exported = true; // it is safely stored, so leaving the page loses nothing
  state.projectId = id;
  state.projectName = saved.find((m) => m.id === id)?.name || p.fileName;
  state.saveState = "saved";
  state.fileError = null;
  state.run = { status: p.results.some(Boolean) ? "done" : "idle", stage: "done", done: parsed.rows.length, total: parsed.rows.length, error: null, startedAt: 0, ms: 0 };
  savePlaybooks();
  savePrefs();
  emit();
}
export async function deleteProject(id) {
  await removeProject(id);
  if (state.projectId === id) {
    state.projectId = null;
    state.projectName = "";
    state.saveState = "";
  }
  await refreshProjects();
}
export async function renameProject(id, name) {
  await renameProjectMeta(id, name);
  if (state.projectId === id) state.projectName = name;
  await refreshProjects();
}

addEventListener("beforeunload", (e) => {
  if (state.results.some(Boolean) && !state.exported && !state.projectId) e.preventDefault();
});
