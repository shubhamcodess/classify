import { state, openFile, setActive, openSample } from "./app/store.js";
import { PLAYBOOKS } from "./playbooks.js";
import { $, $$, esc, BENCH } from "./ui.js";
import { mountDemo } from "./demo.js";

const ACCEPT = ".csv,.tsv,.tab,.xlsx,.xlsm,.xls,.ods,.json,.jsonl,.ndjson,.log,.txt";

export function landing(view) {
  const T = BENCH.decisions.test;
  const rows = [["Words", "Fast, no download", T.words], ["Words + meaning", "34 MB, once", T.hybrid], ...(T.all != null ? [["Words + meaning + Laya", "847 MB, once", T.all]] : [])];
  const auto = T.coverage?.[1];
  view.innerHTML = `
  <section class="hero rise">
    <h1>Hand it the spreadsheet. <span class="hl">Get the decisions back.</span></h1>
    <p class="sub">Teach it your categories and decisions with a few examples. It goes through your file row by row, fills in the answers, and flags the rows a person should check. Nothing leaves your device.</p>
    <label class="dropzone dropzone--hero" data-zone>
      <input type="file" accept="${ACCEPT}" data-file aria-label="Choose a file" />
      <b>Drop a ticket export, a log, or any table</b>
      <span class="muted">Excel, CSV, JSON or text</span>
    </label>
    <p class="hint">No file to hand? <button class="link" data-sample>Try a sample of messy support tickets</button></p>
  </section>
  <div class="demo__wrap" data-demo></div>

  <section class="sec" id="how">
    <h2>Teach it once. Use it on every export.</h2>
    <div class="grid grid--3">
      <div><span class="num">1</span><h3>Write a playbook</h3><p class="muted">Categories, the decisions you take, and rules that must always hold, like “billing over $500 goes to a person”.</p></div>
      <div><span class="num">2</span><h3>Drop the file</h3><p class="muted">Title rows, blank lines and odd separators are handled. Every row gets a category, a decision and a reason.</p></div>
      <div><span class="num">3</span><h3>Check only what matters</h3><p class="muted">Unsure rows are queued for you. Your corrections become training examples, and you download the same file with new columns.</p></div>
    </div>
  </section>

  <section class="sec" id="examples">
    <h2>What comes out</h2>
    <p class="sub">Real output from the sample files, produced by the same code the app runs.</p>
    <div class="tabs" data-tabs>${Object.entries(BENCH.examples).map(([k, e], i) => `<button class="tab ${i ? "" : "is-on"}" data-ex="${k}">${esc(e.name)}</button>`).join("")}</div>
    <div class="panel panel--flush tablewrap" data-extable></div>
  </section>

  <section class="sec" id="accuracy">
    <h2>Measured, not claimed</h2>
    <p class="sub">Correct decisions on ${T.n} ticket lines kept aside from all tuning. It is a small, hand-labelled set; your own data is the real test.</p>
    <div class="bench">${rows.map(([name, note, v], i) => `<div class="bench__row ${i === rows.length - 1 ? "is-best" : ""}"><div>${esc(name)}<small>${esc(note)}</small></div><div class="bar__track"><i style="--k:${v / 100}"></i></div><b>${Math.round(v)}%</b></div>`).join("")}</div>
    ${auto ? `<p class="sub">When it is at least 80% sure, it was right ${Math.round(auto.accuracy)}% of the time on ${Math.round(auto.autoDecided)}% of rows. Everything else is flagged for a person.</p>` : ""}
    <p><a class="link" href="#/app/models">The models, what they do, and what leaves your device - Nothing</a></p>
  </section>

  <section class="sec cta">
    <h2>Try it on a real export.</h2>
    <a class="btn btn--solid" href="#/app">Open the app</a>
  </section>`;

  const go = () => (location.hash = "#/app");
  $("[data-file]", view).addEventListener("change", (e) => {
    if (e.target.files[0]) openFile(e.target.files[0]).then(go);
  });
  const zone = $("[data-zone]", view);
  zone.addEventListener("dragover", (e) => (e.preventDefault(), zone.classList.add("is-over")));
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-over");
    if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]).then(go);
  });
  $("[data-sample]", view).addEventListener("click", (e) => {
    e.preventDefault();
    setActive("support");
    openSample().then(go);
  });
  const paintEx = (key) => {
    const ex = BENCH.examples[key];
    const pb = PLAYBOOKS[key];
    $("[data-extable]", view).innerHTML = `<table class="tbl"><thead><tr><th>Record</th><th>Category</th><th>Decision</th><th>Decided by</th><th>Review</th></tr></thead><tbody>${ex.rows.slice(0, 10).map((r) => `<tr><td class="rec">${esc(r.text.slice(0, 90))}</td><td class="muted nowrap">${esc(r.category)}</td><td class="dec nowrap">${esc(r.decision)}</td><td class="muted nowrap">${esc(r.decided_by)}</td><td class="${r.needs_review === "yes" ? "flag" : "muted"}">${r.needs_review === "yes" ? "Needs review" : "–"}</td></tr>`).join("")}</tbody></table>`;
    $$("[data-ex]", view).forEach((b) => b.classList.toggle("is-on", b.dataset.ex === key));
    return pb;
  };
  $$("[data-ex]", view).forEach((b) => b.addEventListener("click", () => paintEx(b.dataset.ex)));
  paintEx(Object.keys(BENCH.examples)[0]);
  return mountDemo($("[data-demo]", view), () => {
    setActive("support");
    openSample().then(go);
  });
}
