import { $, $$, esc } from "../ui.js";
import { state, active, setActive, newPlaybook, removePlaybook, resetPlaybook, touchPlaybook, savePlaybooks, subscribe, engineNeeds } from "./store.js";
import { PLAYBOOKS, blankLabel } from "../playbooks.js";
import { usableLabels, finishRow, DEFAULT_THRESHOLD } from "../engine/run.js";
import { trainNB, buildSemantic, classifyRow, fuseLaya, NB_ONLY, WEIGHTS } from "../classifier.js";
import { backend, getStatus } from "../engine/client.js";
import { selfTest } from "../model.js";

const OPS = ["contains", "not contains", "is", "is not", ">", ">=", "<", "<=", "is empty"];
const TABS = { categories: "Categories", decisions: "Decisions", rules: "Rules", test: "Test" };
let tab = "categories";
let open = 0;
let testText = "";

export function playbooksScreen(root) {
  const labelsOf = () => (tab === "decisions" ? active().decisions : active().categories);

  function labelEditor() {
    const list = labelsOf();
    const pb = active();
    const qKey = tab === "decisions" ? "decisionQuestion" : "categoryQuestion";
    const blurb = tab === "decisions" ? "What should happen to a row. Leave empty if you only need categories." : "What kind of row this is.";
    const st = selfTest(usableLabels(list));
    return `
      <p class="muted">${blurb}${st.accuracy != null && st.total > 3 ? ` Holding out each example in turn, the word model gets ${Math.round(st.accuracy * 100)}% right.` : ""}</p>
      <div class="labels">${list.map((l, i) => {
        const on = i === open;
        const n = l.examples.filter((x) => x.trim()).length;
        return `<div class="lab ${on ? "is-open" : ""}" data-i="${i}">
          <button type="button" class="lab__head" data-toggle aria-expanded="${on}"><b>${esc(l.name) || '<span class="muted">Untitled</span>'}</b><span class="muted small">${n} example${n === 1 ? "" : "s"}</span></button>
          ${on ? `<div class="lab__body">
            <label class="pick"><span>Name</span><input class="input" data-f="name" value="${esc(l.name)}" /></label>
            <label class="pick"><span>When it applies</span><input class="input" data-f="description" value="${esc(l.description)}" placeholder="One plain sentence" /></label>
            <label class="pick"><span>Examples, one per line</span><textarea class="input mono" rows="6" data-f="examples">${esc(l.examples.join("\n"))}</textarea></label>
            <label class="pick"><span>Keywords that strongly suggest it (optional)</span><input class="input" data-f="keywords" value="${esc(l.keywords)}" placeholder="refund, invoice" /></label>
            <button type="button" class="link link--danger" data-del>Remove</button>
          </div>` : ""}
        </div>`;
      }).join("")}</div>
      <button type="button" class="btn btn--ghost btn--sm" data-add>Add ${tab === "decisions" ? "decision" : "category"}</button>
      <label class="pick pick--q"><span>Question for Laya</span><input class="input" data-q="${qKey}" value="${esc(pb[qKey] || "")}" placeholder="Used only by the Thorough engine" /></label>`;
  }

  function rulesEditor() {
    const pb = active();
    pb.rules ||= [];
    const cats = usableLabels(pb.categories).map((l) => l.name.trim());
    const decs = usableLabels(pb.decisions).map((l) => l.name.trim());
    const cols = state.data?.columns || [];
    return `
      <p class="muted">Checked top to bottom before any model runs. The first match decides, every time.</p>
      ${decs.length < 2 ? `<p class="note">Add at least two decisions first.</p>` : ""}
      <datalist id="cols">${cols.map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>
      <div class="rules">${pb.rules.map((r, i) => `
        <div class="rule" data-r="${i}">
          <span class="muted">If</span>
          <select class="input input--sm" data-rf="category" aria-label="Category"><option value="">any category</option>${cats.map((c) => `<option ${c === r.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
          <input class="input input--sm" list="cols" data-rf="column" value="${esc(r.column || "")}" placeholder="column" aria-label="Column" />
          <select class="input input--sm" data-rf="op" aria-label="Condition">${OPS.map((o) => `<option ${o === (r.op || "contains") ? "selected" : ""}>${o}</option>`).join("")}</select>
          <input class="input input--sm" data-rf="value" value="${esc(r.value || "")}" placeholder="value" aria-label="Value" ${r.op === "is empty" ? "disabled" : ""}/>
          <span class="muted">then</span>
          <select class="input input--sm" data-rf="decision" aria-label="Decision"><option value="">choose…</option>${decs.map((d) => `<option ${d === r.decision ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
          <button class="x" data-rdel aria-label="Remove rule">×</button>
        </div>`).join("") || `<div class="blank blank--sm"><span class="muted">No rules yet.</span></div>`}</div>
      <button type="button" class="btn btn--ghost btn--sm" data-radd ${decs.length < 2 ? "disabled" : ""}>Add rule</button>`;
  }

  const testEditor = () => `
    <p class="muted">Type a record and see what this playbook would do. Uses the models you have ready. Rules that need other columns are not checked here.</p>
    <textarea class="input" rows="3" data-test placeholder="I was billed again after I cancelled">${esc(testText)}</textarea>
    <div data-test-out></div>`;

  async function runTest() {
    const out = $("[data-test-out]", root);
    if (!out) return;
    const text = testText.trim();
    if (!text) return (out.innerHTML = "");
    const pb = active();
    const meaning = getStatus("meaning").state === "ready" || getStatus("meaning").cached;
    const score = async (labels) => {
      const use = usableLabels(labels);
      if (use.length < 2) return null;
      const m = trainNB(use);
      if (!meaning || !engineNeeds().includes("meaning")) return classifyRow(m, null, text, null, NB_ONLY);
      const sem = await buildSemantic(m, use, (t) => backend.embed(t));
      const [v] = await backend.embed([text]);
      return classifyRow(m, sem, text, v, WEIGHTS);
    };
    const cat = await score(pb.categories);
    const dec = await score(pb.decisions);
    if (testText.trim() !== text) return;
    const r = finishRow({}, cat, dec, { rules: (pb.rules || []).filter((x) => !x.column) }, DEFAULT_THRESHOLD);
    const line = (name, d) => (d ? `<div class="kvline"><span class="muted">${name}</span><b>${esc(d.label)}</b><span class="muted">${Math.round(d.confidence * 100)}%</span></div>` : "");
    out.innerHTML = `<div class="panel">${line("Decision", r.decision)}${line("Category", r.category)}<p class="muted small">${esc(r.reason)}</p></div>`;
  }

  function paint() {
    const pb = active();
    const isTemplate = Boolean(PLAYBOOKS[pb.id]);
    root.innerHTML = `
    <header class="head"><h1>Playbooks</h1>
      <div class="row">
        <button class="btn btn--ghost btn--sm" data-export-pb>Export</button>
        <label class="btn btn--ghost btn--sm">Import<input type="file" accept=".json" data-import hidden /></label>
        <button class="btn btn--line btn--sm" data-new>New playbook</button>
      </div></header>
    <div class="pbgrid">
      <nav class="pblist" aria-label="Playbooks">${Object.values(state.playbooks).map((p) => `<button class="pbitem ${p.id === pb.id ? "is-on" : ""}" data-pb="${esc(p.id)}">${esc(p.name)}</button>`).join("")}</nav>
      <section class="panel pbedit">
        <div class="pbedit__top">
          <input class="input input--title" data-name value="${esc(pb.name)}" aria-label="Playbook name" />
          ${isTemplate ? `<button class="link" data-reset>Reset to template</button>` : `<button class="link link--danger" data-remove>Delete</button>`}
        </div>
        <div class="tabs" role="tablist">${Object.entries(TABS).map(([k, v]) => `<button role="tab" class="tab ${tab === k ? "is-on" : ""}" aria-selected="${tab === k}" data-tabk="${k}">${v}${k === "rules" && pb.rules?.length ? `<span>${pb.rules.length}</span>` : k === "categories" ? `<span>${pb.categories.length}</span>` : k === "decisions" ? `<span>${pb.decisions.length}</span>` : ""}</button>`).join("")}</div>
        <div class="pbbody">${tab === "rules" ? rulesEditor() : tab === "test" ? testEditor() : labelEditor()}</div>
      </section>
    </div>`;
    if (tab === "test") runTest();
  }

  root.addEventListener("click", (e) => {
    const t = e.target;
    const pick = t.closest("[data-pb]");
    if (pick) {
      open = 0;
      return setActive(pick.dataset.pb);
    }
    const k = t.closest("[data-tabk]");
    if (k) {
      tab = k.dataset.tabk;
      open = 0;
      return paint();
    }
    if (t.closest("[data-new]")) {
      tab = "categories";
      open = 0;
      return newPlaybook();
    }
    if (t.closest("[data-reset]") && confirm("Discard your changes to this template?")) return resetPlaybook(active().id), paint();
    if (t.closest("[data-remove]") && confirm(`Delete ${active().name}?`)) return removePlaybook(active().id);
    if (t.closest("[data-export-pb]")) {
      const { sample, sampleName, ...pb } = active();
      const url = URL.createObjectURL(new Blob([JSON.stringify({ app: "classify", version: 3, playbook: pb }, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `${pb.name.replace(/\W+/g, "-").toLowerCase()}.playbook.json` });
      a.click();
      return setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    const lab = t.closest(".lab");
    if (t.closest("[data-toggle]") && lab) {
      const i = Number(lab.dataset.i);
      open = open === i ? -1 : i;
      return paint();
    }
    if (t.closest("[data-del]") && lab) {
      labelsOf().splice(Number(lab.dataset.i), 1);
      open = -1;
      touchPlaybook();
      return paint();
    }
    if (t.closest("[data-add]")) {
      labelsOf().push(blankLabel());
      open = labelsOf().length - 1;
      touchPlaybook();
      paint();
      return $('.lab.is-open [data-f="name"]', root)?.focus();
    }
    if (t.closest("[data-radd]")) {
      active().rules.push({ category: "", column: "", op: "contains", value: "", decision: "" });
      touchPlaybook();
      return paint();
    }
    const rdel = t.closest("[data-rdel]");
    if (rdel) {
      active().rules.splice(Number(rdel.closest("[data-r]").dataset.r), 1);
      touchPlaybook();
      return paint();
    }
  });
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches("[data-name]")) {
      active().name = t.value;
      savePlaybooks();
      const item = $(".pbitem.is-on", root);
      if (item) item.textContent = t.value;
      return;
    }
    if (t.dataset.f) {
      const lab = t.closest(".lab");
      const l = labelsOf()[Number(lab.dataset.i)];
      l[t.dataset.f] = t.dataset.f === "examples" ? t.value.split("\n") : t.value;
      if (t.dataset.f === "name") lab.querySelector(".lab__head b").textContent = t.value || "Untitled";
      return touchPlaybook();
    }
    if (t.dataset.q) {
      active()[t.dataset.q] = t.value;
      return savePlaybooks();
    }
    if (t.matches("[data-test]")) {
      testText = t.value;
      clearTimeout(runTest.t);
      runTest.t = setTimeout(runTest, 200);
    }
  });
  root.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.rf) {
      const r = active().rules[Number(t.closest("[data-r]").dataset.r)];
      r[t.dataset.rf] = t.value;
      touchPlaybook();
      if (t.dataset.rf === "op") paint();
      return;
    }
    if (t.matches("[data-import]") && t.files[0]) {
      try {
        const j = JSON.parse(await t.files[0].text());
        const raw = j.playbook || (Array.isArray(j.labels) ? { name: "Imported labels", categories: j.labels } : null);
        if (!raw) throw new Error("not a playbook file");
        const id = newPlaybook();
        const fix = (ls = []) => ls.map((l) => ({ ...blankLabel(), ...l, examples: [].concat(l.examples || []) }));
        Object.assign(state.playbooks[id], raw, { id, categories: fix(raw.categories), decisions: fix(raw.decisions), rules: raw.rules || [] });
        savePlaybooks();
        paint();
      } catch (err) {
        alert(`Could not import: ${err.message}`);
      }
    }
  });
  paint();
  // Only repaint when another screen changed things; typing here must keep focus.
  return subscribe((what) => {
    if (what === "all") paint();
  });
}
