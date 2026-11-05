import { $, $$, esc, BENCH, mb } from "../ui.js";
import { state, subscribe, active, setActive, setEngine, setThreshold, openFile, closeFile, openSample, switchSheet, toggleColumn, startRun, runProblem, missingDownloads, engineNeeds } from "./store.js";
import { usableLabels, missingRuleColumns } from "../engine/run.js";
import { MODELS, getStatus, onStatus, refreshCache } from "../engine/client.js";

const ACCEPT = ".csv,.tsv,.tab,.xlsx,.xlsm,.xls,.ods,.json,.jsonl,.ndjson,.log,.txt";
const pc = (x) => (x == null ? "" : `${Math.round(x)}%`);
const T = BENCH.decisions.test;
const ENGINES = [
  { id: "words", name: "Fast", about: "Your examples, matched by words. Instant, no download.", acc: T.words },
  { id: "meaning", name: "Balanced", about: "Adds meaning, so paraphrases match. Small download; big files take minutes.", acc: T.hybrid },
  { id: "laya", name: "Thorough", about: "Adds Laya's second opinion on unsure rows. Large download; needs a good GPU.", acc: T.all ?? null },
];

export function runScreen(root) {
  const paint = () => {
    const d = state.data;
    const pb = active();
    const counts = [
      [usableLabels(pb.categories).length, "categories"],
      [usableLabels(pb.decisions).length, "decisions"],
      [(pb.rules || []).length, "rules"],
    ].filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(" · ");
    const missing = missingDownloads();
    const missing_cols = d ? missingRuleColumns(pb.rules, d.columns) : [];
    const size = missing.reduce((a, m) => a + MODELS[m].bytes, 0);
    const problem = runProblem();
    const busy = engineNeeds().some((m) => ["downloading", "loading"].includes(getStatus(m).state));
    root.innerHTML = `
    <header class="head"><h1>New run</h1></header>
    ${state.fileError ? `<p class="alert" role="alert">${esc(state.fileError)}</p>` : ""}
    <section class="panel">
      ${
        d
          ? `<div class="filebar">
              <div class="filebar__name"><b>${esc(d.name)}</b><span class="muted">${d.rows.length.toLocaleString()} rows · ${d.columns.length} columns${d.headerRow > 1 ? ` · table starts at row ${d.headerRow}` : ""}</span></div>
              ${d.sheets?.length > 1 ? `<label class="inline">Sheet <select class="input input--sm" data-sheet>${d.sheets.map((s) => `<option ${s === d.sheet ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>` : ""}
              <button class="btn btn--ghost btn--sm" data-close>Remove</button>
            </div>
            <div class="tablewrap"><table class="tbl tbl--preview">
              <thead><tr>${d.columns.map((c) => `<th><label class="colpick ${state.textCols.includes(c) ? "is-on" : ""}"><input type="checkbox" data-col="${esc(c)}" ${state.textCols.includes(c) ? "checked" : ""}/>${esc(c)}</label></th>`).join("")}</tr></thead>
              <tbody>${d.rows.slice(0, 3).map((r) => `<tr>${d.columns.map((c) => `<td class="${state.textCols.includes(c) ? "" : "muted"}">${esc(String(r[c]).slice(0, 90))}</td>`).join("")}</tr>`).join("")}</tbody>
            </table></div>
            <p class="hint">Ticked columns are what gets read. All columns stay in your file, and rules can use any of them.</p>`
          : `<label class="dropzone" data-zone>
              <input type="file" accept="${ACCEPT}" data-file aria-label="Choose a file" />
              <svg class="s" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>
              <b>Drop a file, or click to choose</b>
              <span class="muted">Excel, CSV, JSON or logs. It stays on this device.</span>
            </label>
            <p class="hint center">No file to hand? <button class="link" data-sample>Try the sample file</button></p>`
      }
    </section>

    <section class="panel form">
      <div class="field">
        <span class="field__label">Playbook</span>
        <div class="field__body">
          <div class="row">
            <select class="input" data-playbook aria-label="Playbook">${Object.values(state.playbooks).map((p) => `<option value="${esc(p.id)}" ${p.id === pb.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
            <a class="btn btn--ghost btn--sm" href="#/app/playbooks">Edit</a>
          </div>
          <p class="hint">${counts || "Nothing taught yet"}</p>
          ${d && missing_cols.length ? `<p class="flag small">This file has no ${missing_cols.map((c) => `“${esc(c)}”`).join(" or ")} column, so ${missing_cols.length === 1 ? "that rule" : "those rules"} will not run.</p>` : ""}
        </div>
      </div>
      <div class="field">
        <span class="field__label">Engine</span>
        <div class="field__body engines" role="radiogroup" aria-label="Engine">
          ${ENGINES.map((e) => {
            const on = state.engine === e.id;
            return `<label class="engine ${on ? "is-on" : ""}"><input type="radio" name="engine" value="${e.id}" ${on ? "checked" : ""}/>
              <span class="engine__top"><b>${e.name}</b>${e.acc != null ? `<span class="muted" title="Correct decisions on ${T.n} test lines">${pc(e.acc)}</span>` : ""}</span>
              <span class="muted small">${e.about}</span></label>`;
          }).join("")}
        </div>
      </div>
      <div class="field">
        <span class="field__label">Review</span>
        <div class="field__body row">
          <label class="inline">Send rows to a person when confidence is below
            <select class="input input--sm" data-threshold>${[0.5, 0.6, 0.7, 0.8, 0.9].map((t) => `<option value="${t}" ${t === state.threshold ? "selected" : ""}>${t * 100}%</option>`).join("")}</select>
          </label>
        </div>
      </div>
    </section>

    <div class="actions">
      ${problem && d ? `<span class="muted">${esc(problem)}</span>` : ""}
      <button class="btn btn--solid" data-run ${problem || busy ? "disabled" : ""}>${missing.length ? `Download ${size > 1e8 ? `${Math.round(size / 1e6)} MB` : `${mb(size).split(".")[0]} MB`} and run` : "Run"}</button>
    </div>`;

    $("[data-file]", root)?.addEventListener("change", (e) => e.target.files[0] && openFile(e.target.files[0]));
    $("[data-sample]", root)?.addEventListener("click", (e) => (e.preventDefault(), openSample()));
    $("[data-close]", root)?.addEventListener("click", closeFile);
    $("[data-sheet]", root)?.addEventListener("change", (e) => switchSheet(e.target.value));
    $$("[data-col]", root).forEach((c) => c.addEventListener("change", () => toggleColumn(c.dataset.col)));
    $("[data-playbook]", root).addEventListener("change", (e) => setActive(e.target.value));
    $$('input[name="engine"]', root).forEach((r) => r.addEventListener("change", () => setEngine(r.value)));
    $("[data-threshold]", root).addEventListener("change", (e) => setThreshold(Number(e.target.value)));
    $("[data-run]", root).addEventListener("click", () => {
      startRun();
      location.hash = "#/app/review";
    });
  };
  paint();
  refreshCache().then(paint).catch(() => {});
  const offA = subscribe((w) => w !== "progress" && paint());
  const offB = onStatus(paint);
  return () => {
    offA();
    offB();
  };
}
