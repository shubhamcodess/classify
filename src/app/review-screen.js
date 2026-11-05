import { $, $$, esc, pct } from "../ui.js";
import { state, subscribe, active, summary, correct, approve, exportFile, startRun, cancelRun, saveProject } from "./store.js";
import { rowText, usableLabels } from "../engine/run.js";

const PAGE = 50;
const STAGE = { words: "Reading words", meaning: "Comparing meaning", laya: "Laya reviewing unsure rows", done: "Done", "Getting ready": "Getting models ready" };
const stored = { filter: "review", query: "", page: 0, selected: -1 };
const FORMATS = { xlsx: "Excel", csv: "CSV", json: "JSON", jsonl: "JSON Lines" };

let pace = { stage: "", at: 0, done: 0 };
function trackRate(run) {
  const now = performance.now();
  if (pace.stage !== run.stage) pace = { stage: run.stage, at: now, done: run.done };
  const secs = (now - pace.at) / 1000;
  return secs > 3 && run.done > pace.done ? (run.done - pace.done) / secs : 0;
}

export function reviewScreen(root) {
  if (!state.data) {
    root.innerHTML = `<header class="head"><h1>Review</h1></header><div class="blank"><b>Nothing to review yet</b><span class="muted">Run a file and the results appear here, or open a saved project.</span><div class="row"><a class="btn btn--solid btn--sm" href="#/app">New run</a><a class="btn btn--line btn--sm" href="#/app/projects">Projects</a></div></div>`;
    const off = subscribe(() => state.data && (location.hash = "#/app/review"));
    return off;
  }
  root.innerHTML = `
    <header class="head">
      <div><h1>${esc(state.data.name)}</h1><p class="muted" data-sub></p></div>
      <div class="row" data-head-actions></div>
    </header>
    <div data-progress></div>
    <div data-banner></div>
    <div class="toolbar">
      <div class="tabs" data-tabs role="tablist"></div>
      <input class="input input--search" data-search type="search" placeholder="Search rows" aria-label="Search rows" value="${esc(stored.query)}" />
    </div>
    <div class="split">
      <section class="tablearea"><div class="tablewrap" data-table></div><div class="pager" data-pager></div></section>
      <aside class="detail" data-detail></aside>
    </div>`;

  const decisionsOn = () => usableLabels(active().decisions).length >= 2;
  const main = (r) => (decisionsOn() ? r.decision : r.category);

  function matching() {
    const q = stored.query.trim().toLowerCase();
    const out = [];
    state.results.forEach((r, i) => {
      if (!r || r.skipped) return;
      if (stored.filter === "review" && !(r.needsReview && !r.reviewed)) return;
      if (stored.filter.startsWith("d:") && main(r)?.label !== stored.filter.slice(2)) return;
      if (q && !rowText(state.data.rows[i], state.data.columns).toLowerCase().includes(q)) return;
      out.push(i);
    });
    return out;
  }

  function paintHead() {
    const s = summary();
    const run = state.run;
    $("[data-sub]", root).textContent = run.status === "running"
      ? `${s.total.toLocaleString()} rows`
      : `${s.total.toLocaleString()} rows · ${s.auto.toLocaleString()} decided automatically · ${s.review.toLocaleString()} need${s.review === 1 ? "s" : ""} review${s.reviewed ? ` · ${s.reviewed.toLocaleString()} reviewed` : ""}`;
    const k = state.data.kind;
    const primary = { xls: "xlsx", ods: "xlsx", xlsm: "xlsx", text: "csv" }[k] || k;
    const running = run.status === "running";
    $("[data-head-actions]", root).innerHTML = `
      ${running ? `<button class="btn btn--line btn--sm" data-cancel>Stop</button>` : state.projectId ? `<span class="muted small" data-saved>${state.saveState === "saving" ? "Saving…" : state.saveState === "saved" ? `Saved in ${esc(state.projectName)}` : esc(state.saveState)}</span>` : s.scored ? `<button class="btn btn--line btn--sm" data-save-project>Save project</button>` : ""}
      <div class="menu">
        <button class="btn btn--solid btn--sm" data-export="${primary}" ${s.scored ? "" : "disabled"}>Download ${FORMATS[primary]}</button>
        <details class="menu__more"><summary class="btn btn--line btn--sm" aria-label="Other formats">Other formats</summary>
          <div class="menu__list">${Object.keys(FORMATS).filter((f) => f !== primary && f !== "jsonl").map((f) => `<button data-export="${f}">${FORMATS[f]}</button>`).join("")}</div>
        </details>
      </div>`;
    const p = $("[data-progress]", root);
    if (running) {
      const share = run.total ? run.done / run.total : 0;
      const rate = trackRate(run);
      const left = rate && run.done < run.total ? (run.total - run.done) / rate : 0;
      const eta = left > 90 ? ` · about ${Math.round(left / 60)} min left` : left > 5 ? ` · about ${Math.round(left)} s left` : "";
      p.innerHTML = `<div class="progress-row"><span>${STAGE[run.stage] || esc(run.stage)}${run.total ? ` · ${run.done.toLocaleString()} of ${run.total.toLocaleString()}` : ""}${eta}. You can review rows while this runs.</span><div class="progress"><i style="--k:${share}"></i></div></div>`;
    } else p.innerHTML = "";
    const b = $("[data-banner]", root);
    let msg = "";
    if (run.status === "error") msg = `<p class="alert" role="alert">The run stopped: ${esc(run.error)}. ${s.scored ? "Results so far are kept." : ""}</p>`;
    else if (run.status === "cancelled") msg = `<p class="note">Stopped. Rows keep the best answer they had so far.</p>`;
    else if (state.dirty && !running) {
      const what = state.learned ? `${state.learned} correction${state.learned === 1 ? "" : "s"} learned.` : "The playbook changed.";
      msg = `<p class="note">${what} <button class="link" data-rerun>Run again</button> to apply this to the other rows. Your reviewed rows stay as they are.</p>`;
    }
    if (run.warning) msg = `<p class="alert" role="alert">${esc(run.warning)} <a class="link" href="#/app/models">Models</a></p>${msg}`;
    b.innerHTML = msg;
  }

  function paintTabs() {
    const counts = new Map();
    let review = 0;
    for (const r of state.results) {
      if (!r || r.skipped) continue;
      const l = main(r)?.label;
      counts.set(l, (counts.get(l) || 0) + 1);
      if (r.needsReview && !r.reviewed) review++;
    }
    const total = state.results.filter((r) => r && !r.skipped).length;
    const tabs = [["review", "Needs review", review], ["all", "All", total], ...[...counts].sort((a, b) => b[1] - a[1]).map(([l, n]) => [`d:${l}`, l, n])];
    if (stored.filter === "review" && !review && state.run.status !== "running") stored.filter = "all";
    if (!tabs.some(([k]) => k === stored.filter)) stored.filter = "all";
    $("[data-tabs]", root).innerHTML = tabs.map(([k, label, n]) => `<button role="tab" class="tab ${stored.filter === k ? "is-on" : ""}" aria-selected="${stored.filter === k}" data-tab="${esc(k)}">${esc(label)}<span>${n.toLocaleString()}</span></button>`).join("");
  }

  function paintTable() {
    const ids = matching();
    const pages = Math.max(1, Math.ceil(ids.length / PAGE));
    stored.page = Math.min(stored.page, pages - 1);
    const slice = ids.slice(stored.page * PAGE, (stored.page + 1) * PAGE);
    const hasCat = usableLabels(active().categories).length >= 2;
    const hasDec = decisionsOn();
    $("[data-table]", root).innerHTML = slice.length
      ? `<table class="tbl tbl--rows"><thead><tr><th class="n">Row</th><th>Record</th>${hasCat ? "<th>Category</th>" : ""}${hasDec ? "<th>Decision</th>" : ""}<th class="c">Confidence</th></tr></thead>
        <tbody>${slice.map((i) => {
          const r = state.results[i];
          const m = main(r);
          return `<tr data-row="${i}" tabindex="0" class="${i === stored.selected ? "is-sel" : ""}">
            <td class="n">${(state.data.rowNumbers?.[i] ?? i + 1).toLocaleString()}</td>
            <td class="rec">${esc(rowText(state.data.rows[i], state.textCols).slice(0, 160))}</td>
            ${hasCat ? `<td class="muted">${esc(r.category?.label ?? "")}</td>` : ""}
            ${hasDec ? `<td class="dec">${esc(r.decision?.label ?? "")}</td>` : ""}
            <td class="c">${m.by === "rule" ? '<span class="muted">Rule</span>' : r.reviewed ? '<span class="muted">Reviewed</span>' : `<span class="${r.needsReview ? "flag" : ""}">${pct(Math.min(m.confidence, r.category?.confidence ?? 1))}</span>`}</td>
          </tr>`;
        }).join("")}</tbody></table>`
      : `<div class="blank blank--sm"><span class="muted">${state.run.status === "running" ? "Working…" : stored.filter === "review" ? "Nothing needs review." : "No rows match."}</span></div>`;
    $("[data-pager]", root).innerHTML = pages > 1 ? `<button class="btn btn--ghost btn--sm" data-page="-1" ${stored.page ? "" : "disabled"}>Previous</button><span class="muted">Page ${stored.page + 1} of ${pages.toLocaleString()}</span><button class="btn btn--ghost btn--sm" data-page="1" ${stored.page < pages - 1 ? "" : "disabled"}>Next</button>` : "";
  }

  function bars(d) {
    if (!d?.probs?.length) return "";
    return `<div class="bars">${d.probs.slice().sort((a, b) => b.p - a.p).slice(0, 4).map((p) => `<div class="bar"><span>${esc(p.label)}</span><div class="bar__track"><i style="--k:${p.p}"></i></div><b>${pct(p.p)}</b></div>`).join("")}</div>`;
  }
  function evidence(d) {
    if (!d) return "";
    if (d.by === "you") return `<p class="muted small">Set by you.</p>`;
    if (d.by === "rule") return `<p class="why">A rule decided this: <b>${esc(d.ruleText)}</b>.</p>`;
    const items = [];
    if (d.rule) items.push(`Keyword rule “${esc(d.rule)}” matched.`);
    if (d.nearest) items.push(`Closest example: “${esc(d.nearest.text.slice(0, 140))}”`);
    const words = (d.why || []).filter((w) => w.weight > 0).slice(0, 5).map((w) => esc(w.token));
    if (words.length) items.push(`Words that pointed here: ${words.join(", ")}.`);
    if (d.laya) items.push(d.laya.label === d.label ? `Laya agrees.` : `Laya preferred ${esc(d.laya.label)}.`);
    return `<ul class="why">${items.map((x) => `<li>${x}</li>`).join("")}</ul>${bars(d)}`;
  }

  function paintDetail() {
    const el = $("[data-detail]", root);
    const i = stored.selected;
    const r = state.results[i];
    root.querySelector(".split").classList.toggle("has-detail", Boolean(r));
    if (!r) {
      el.innerHTML = "";
      return;
    }
    const pb = active();
    const picker = (field, labels, cur) => (labels.length < 2 ? "" : `
      <label class="pick"><span>${field === "decision" ? "Decision" : "Category"}</span>
        <select class="input" data-fix="${field}">${labels.map((l) => `<option ${l.name.trim() === cur ? "selected" : ""}>${esc(l.name.trim())}</option>`).join("")}</select>
      </label>`);
    const row = state.data.rows[i];
    el.innerHTML = `
      <div class="detail__head"><b>Row ${(state.data.rowNumbers?.[i] ?? i + 1).toLocaleString()}</b><button class="x" data-close-detail aria-label="Close">×</button></div>
      <div class="detail__scroll">
        <dl class="record">${state.data.columns.filter((c) => row[c] !== "").map((c) => `<dt>${esc(c)}</dt><dd>${esc(row[c])}</dd>`).join("")}</dl>
        ${picker("decision", usableLabels(pb.decisions), r.decision?.label)}
        ${r.decision ? evidence(r.decision) : ""}
        ${picker("category", usableLabels(pb.categories), r.category?.label)}
        ${r.decision ? (r.category ? `<details class="more"><summary>Why this category</summary>${evidence(r.category)}</details>` : "") : evidence(r.category)}
      </div>
      <div class="detail__foot">
        ${r.needsReview && !r.reviewed ? `<button class="btn btn--solid btn--sm" data-approve>Approve and next</button>` : `<button class="btn btn--line btn--sm" data-next>Next row</button>`}
      </div>`;
  }

  const next = () => {
    const ids = matching();
    const at = ids.indexOf(stored.selected);
    stored.selected = ids[at + 1] ?? ids[0] ?? -1;
    const pos = ids.indexOf(stored.selected);
    if (pos >= 0) stored.page = Math.floor(pos / PAGE);
    paintAll();
  };
  function paintAll() {
    paintHead();
    paintTabs();
    paintTable();
    paintDetail();
  }

  root.addEventListener("click", async (e) => {
    const t = e.target;
    const tab = t.closest("[data-tab]");
    if (tab) {
      stored.filter = tab.dataset.tab;
      stored.page = 0;
      return paintAll();
    }
    const row = t.closest("[data-row]");
    if (row) {
      stored.selected = Number(row.dataset.row);
      paintTable();
      return paintDetail();
    }
    const pg = t.closest("[data-page]");
    if (pg) {
      stored.page += Number(pg.dataset.page);
      return paintTable();
    }
    if (t.closest("[data-close-detail]")) {
      stored.selected = -1;
      paintTable();
      return paintDetail();
    }
    if (t.closest("[data-approve]")) {
      const i = stored.selected;
      const ids = matching();
      const nextId = ids[ids.indexOf(i) + 1] ?? -1;
      approve(i);
      stored.selected = nextId;
      return paintAll();
    }
    if (t.closest("[data-next]")) return next();
    if (t.closest("[data-cancel]")) {
      cancelRun();
      return paintAll();
    }
    if (t.closest("[data-rerun]")) return startRun();
    if (t.closest("[data-save-project]")) {
      try {
        await saveProject();
      } catch (err) {
        $("[data-banner]", root).innerHTML = `<p class="alert" role="alert">Could not save: ${esc(err.message)}</p>`;
      }
      return;
    }
    const ex = t.closest("[data-export]");
    if (ex) {
      const label = ex.textContent;
      ex.disabled = true;
      ex.textContent = "Preparing…";
      try {
        await exportFile(ex.dataset.export);
      } catch (err) {
        $("[data-banner]", root).innerHTML = `<p class="alert" role="alert">Could not build the file: ${esc(err.message)}</p>`;
      }
      ex.disabled = false;
      ex.textContent = label;
      root.querySelector(".menu__more")?.removeAttribute("open");
    }
  });
  root.addEventListener("keydown", (e) => {
    const row = e.target.closest?.("[data-row]");
    if (row && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      row.click();
    }
  });
  root.addEventListener("change", (e) => {
    const f = e.target.dataset?.fix;
    if (f) correct(stored.selected, { [f]: e.target.value });
  });
  $("[data-search]", root).addEventListener("input", (e) => {
    stored.query = e.target.value;
    stored.page = 0;
    paintTable();
  });

  paintAll();
  return subscribe((what) => {
    if (what === "progress") {
      paintHead();
      paintTabs();
      paintTable();
    } else if (what !== "projects") paintAll();
    else paintHead();
  });
}
