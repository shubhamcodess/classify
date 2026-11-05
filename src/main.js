import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "./style.css";
import "./app.css";
import { classify, selfTest, topFeatures, train } from "./model.js";
import { guessTextColumns, parseCSV, parseFile, parseLines, toCSV } from "./parse.js";
import { PRESETS } from "./presets.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pct = (x) => `${Math.round(x * 100)}%`;
const COLORS = ["#f7703f", "#7fd4a0", "#9db4ff", "#e8c46a", "#c39bff", "#f38ba8", "#6fd3c4", "#d7c9a7"];
const STORE = "classify-state-v1";
const SHOW = 500; // rows rendered in the table; downloads include everything

/* ---------------- state ---------------- */
const blank = () => ({ name: "", description: "", keywords: "", examples: [""] });
const clone = (x) => JSON.parse(JSON.stringify(x));
let state = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s?.labels?.length) return s;
  } catch {}
  return { preset: "logs", labels: clone(PRESETS.logs.labels) };
})();
let model = train(state.labels);
let data = null; // { name, columns, rows }
let textCols = [];
let results = []; // per row: classify() output
let filter = null;
let unsureOnly = false;
let selected = -1;
let runToken = 0;

const colorOf = (label) => COLORS[Math.max(0, model.classes.findIndex((c) => c.name === label)) % COLORS.length];
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
    $("[data-saved]").textContent = "saved in this browser";
  } catch {
    $("[data-saved]").textContent = "not saved (storage blocked)";
  }
};

/* ---------------- teach ---------------- */
let openLab = 0; // one label expanded at a time keeps the list compact
const exCount = (l) => l.examples.filter((x) => x.trim()).length;
const labMeta = (l) => `${exCount(l)} example${exCount(l) === 1 ? "" : "s"}${l.keywords.trim() ? " · rules" : ""}`;
function renderLabels() {
  $("[data-labels]").innerHTML = state.labels
    .map((l, i) => {
      const open = i === openLab;
      return `
    <div class="lab ${open ? "is-open" : ""}" data-i="${i}" style="--c:${COLORS[i % COLORS.length]}">
      <button type="button" class="lab__head" data-toggle aria-expanded="${open}">
        <i class="dot"></i><span class="lab__title">${esc(l.name) || "<em>untitled</em>"}</span>
        <span class="cap lab__meta">${labMeta(l)}</span>
        <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      ${
        open
          ? `<div class="lab__body">
        <input class="input lab__name" data-f="name" value="${esc(l.name)}" placeholder="label name" aria-label="Label name" />
        <textarea class="input" data-f="examples" rows="6" placeholder="Examples, one per line" aria-label="Examples">${esc(l.examples.join("\n"))}</textarea>
        <input class="input mono" data-f="keywords" value="${esc(l.keywords)}" placeholder="keyword rules, comma separated" aria-label="Keyword rules" />
        <input class="input" data-f="description" value="${esc(l.description)}" placeholder="description (optional)" aria-label="Description" />
        <button type="button" class="lab__del" data-del>Remove label</button>
      </div>`
          : ""
      }
    </div>`;
    })
    .join("");
}

function steps() {
  $('[data-step="1"]').classList.toggle("is-done", model.classes.length >= 2);
  $('[data-step="2"]').classList.toggle("is-done", Boolean(data));
  $('[data-step="3"]')?.classList.toggle("is-done", Boolean(data) && results.length > 0 && results.every(Boolean));
}

let retrainTimer = 0;
function retrain({ rerun = true } = {}) {
  clearTimeout(retrainTimer);
  retrainTimer = setTimeout(() => {
    model = train(state.labels);
    save();
    renderState();
    runTry();
    steps();
    if (rerun && data) run();
  }, 180);
}

function renderState() {
  const st = selfTest(state.labels);
  const labelsOk = model.classes.length;
  $("[data-stats]").innerHTML = `
    <div><dt>labels</dt><dd>${labelsOk}</dd></div>
    <div><dt>examples</dt><dd>${model.examples}</dd></div>
    <div><dt>features</dt><dd>${model.vocabSize.toLocaleString()}</dd></div>
    <div><dt>self-test</dt><dd title="leave-one-out accuracy on your examples">${st.accuracy == null ? "–" : `${pct(st.accuracy)} <small>${st.correct}/${st.total}</small>`}</dd></div>`;
  $("[data-learned]").innerHTML =
    labelsOk < 2
      ? `<p class="cap">Add at least two labels with examples to start.</p>`
      : `<p class="cap">what each label learned</p>` +
        topFeatures(model, 6)
          .map(
            (t) => `<div class="learned__row"><span class="tag" style="--c:${colorOf(t.label)}">${esc(t.label)}</span><span class="learned__toks">${t.keywords
              .slice(0, 3)
              .map((k) => `<code class="kw" title="keyword rule">${esc(k)}</code>`)
              .join("")}${t.tokens
              .filter((x) => !t.keywords.slice(0, 3).includes(x.token))
              .map((x) => `<code>${esc(x.token)}</code>`)
              .join("")}</span></div>`,
          )
          .join("");
}

function explain(r) {
  if (!r) return "";
  return `
    <div class="why__head"><span class="tag tag--big" style="--c:${colorOf(r.label)}">${esc(r.label)}</span><b>${pct(r.confidence)}</b>${r.rule ? `<span class="rule">rule: “${esc(r.rule)}”</span>` : ""}</div>
    <div class="probs">${r.probs
      .slice()
      .sort((a, b) => b.p - a.p)
      .map((p) => `<div class="prob"><span>${esc(p.label)}</span><div class="prob__bar"><i style="--k:${p.p};--c:${colorOf(p.label)}"></i></div><b>${pct(p.p)}</b></div>`)
      .join("")}</div>
    ${
      r.why.length
        ? `<p class="cap">words that pushed it toward <b>${esc(r.label)}</b></p><div class="toks">${r.why
            .map((w) => `<span class="tok ${w.weight < 0 ? "tok--neg" : ""}" style="--w:${Math.min(1, Math.abs(w.weight) / 3)}">${esc(w.token)}<small>${w.weight > 0 ? "+" : ""}${w.weight.toFixed(1)}</small></span>`)
            .join("")}</div>`
        : ""
    }`;
}

function runTry() {
  const v = $("[data-try]").value.trim();
  $("[data-try-out]").innerHTML = v && model.classes.length >= 2 ? explain(classify(model, v)) : "";
}

$("[data-labels]").addEventListener("input", (e) => {
  const lab = e.target.closest(".lab");
  const f = e.target.dataset.f;
  if (!lab || !f) return;
  const l = state.labels[Number(lab.dataset.i)];
  l[f] = f === "examples" ? e.target.value.split("\n") : e.target.value;
  lab.querySelector(".lab__title").textContent = l.name || "untitled";
  lab.querySelector(".lab__meta").textContent = labMeta(l);
  retrain();
});
$("[data-labels]").addEventListener("click", (e) => {
  const lab = e.target.closest(".lab");
  if (!lab) return;
  const i = Number(lab.dataset.i);
  if (e.target.closest("[data-toggle]")) {
    openLab = openLab === i ? -1 : i;
    renderLabels();
  } else if (e.target.closest("[data-del]")) {
    state.labels.splice(i, 1);
    openLab = -1;
    renderLabels();
    retrain();
  }
});
$("[data-add-label]").addEventListener("click", () => {
  state.labels.push(blank());
  openLab = state.labels.length - 1;
  renderLabels();
  $$(".lab__name").at(-1).focus();
});
$$("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    const p = b.dataset.preset;
    state = { preset: p, labels: p === "blank" ? [blank(), blank()] : clone(PRESETS[p].labels) };
    openLab = 0;
    $$("[data-preset]").forEach((x) => x.classList.toggle("is-on", x === b));
    renderLabels();
    model = train(state.labels); // synchronously, so the sample runs on the new labels
    save();
    renderState();
    runTry();
    if (p !== "blank") loadSample();
    else clearData();
  }),
);
$("[data-try]").addEventListener("input", runTry);
$("[data-export]").addEventListener("click", () =>
  download("classify-model.json", JSON.stringify({ app: "classify", version: 1, labels: state.labels }, null, 2), "application/json"),
);
$("[data-import]").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!Array.isArray(j.labels)) throw new Error("no labels");
    state = { preset: "imported", labels: j.labels.map((l) => ({ ...blank(), ...l, examples: [].concat(l.examples || []) })) };
    renderLabels();
    retrain();
  } catch (err) {
    alert(`Could not import: ${err.message}`);
  }
  e.target.value = "";
});

/* ---------------- data ---------------- */
function setData(d, name) {
  data = { ...d, name };
  textCols = guessTextColumns(d.columns, d.rows);
  if (!textCols.length) textCols = d.columns.slice(0, 1);
  selected = -1;
  filter = null;
  $("[data-dataset]").hidden = false;
  $("[data-paste]").hidden = true;
  $("[data-ds-name]").textContent = name;
  $("[data-ds-meta]").textContent = `${d.rows.length.toLocaleString()} rows · ${d.columns.length} column${d.columns.length === 1 ? "" : "s"}${d.sheet ? ` · sheet “${d.sheet}”` : ""}`;
  $("[data-cols]").innerHTML = d.columns
    .map((c) => `<label class="colpick"><input type="checkbox" value="${esc(c)}" ${textCols.includes(c) ? "checked" : ""} /> ${esc(c)}</label>`)
    .join("");
  run();
}
function clearData() {
  data = null;
  results = [];
  $("[data-dataset]").hidden = true;
  $("[data-results]").hidden = true;
  $("[data-empty]").hidden = false;
}
function loadSample() {
  const p = PRESETS[state.preset] || PRESETS.logs;
  const name = p.sampleName || "sample.log";
  setData(name.endsWith(".csv") ? parseCSV(p.sample, ",") : parseLines(p.sample), name);
}
async function openFile(file) {
  if (!file) return;
  $("[data-ds-meta]").textContent = "reading…";
  try {
    setData(await parseFile(file), file.name);
  } catch (err) {
    alert(`Could not read ${file.name}: ${err.message}`);
  }
}
$("[data-cols]").addEventListener("change", () => {
  textCols = $$("[data-cols] input:checked").map((i) => i.value);
  run();
});
$("[data-file]").addEventListener("change", (e) => openFile(e.target.files[0]));
const drop = $("[data-drop]");
drop.addEventListener("dragover", (e) => (e.preventDefault(), drop.classList.add("drop--over")));
drop.addEventListener("dragleave", () => drop.classList.remove("drop--over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("drop--over");
  openFile(e.dataTransfer.files[0]);
});
$("[data-sample]").addEventListener("click", (e) => (e.preventDefault(), loadSample()));
$("[data-paste-toggle]").addEventListener("click", (e) => {
  e.preventDefault();
  $("[data-paste]").hidden = !$("[data-paste]").hidden;
});
$("[data-paste-go]").addEventListener("click", () => {
  const t = $("[data-paste-text]").value;
  if (t.trim()) setData(parseLines(t), "pasted text");
});

/* ---------------- classify (live) ---------------- */
const rowText = (r) => textCols.map((c) => r[c]).filter((v) => v !== "" && v != null).join(" · ");

async function run() {
  if (!data || model.classes.length < 2) {
    if (data) $("[data-progress-text]").textContent = "add at least two labels with examples";
    return;
  }
  const my = ++runToken;
  results = new Array(data.rows.length);
  $("[data-empty]").hidden = true;
  $("[data-results]").hidden = false;
  const t0 = performance.now();
  const CHUNK = 400;
  for (let i = 0; i < data.rows.length; i += CHUNK) {
    if (my !== runToken) return;
    const end = Math.min(i + CHUNK, data.rows.length);
    for (let j = i; j < end; j++) results[j] = classify(model, rowText(data.rows[j]));
    progress(end, performance.now() - t0);
    if (i === 0 || end === data.rows.length || (i / CHUNK) % 5 === 0) renderResults();
    await new Promise((r) => setTimeout(r, 16)); // let the page breathe: rows appear live
  }
  renderResults();
}

function progress(done, ms) {
  const n = data.rows.length;
  $("[data-progress]").style.setProperty("--k", n ? done / n : 1);
  $("[data-progress]").parentElement.classList.toggle("is-done", done === n);
  $("[data-progress-text]").textContent = `${done.toLocaleString()} / ${n.toLocaleString()} rows · ${Math.round(ms)} ms${done === n ? " · done" : ""}`;
}

function renderResults() {
  const done = results.filter(Boolean);
  const counts = new Map(model.classes.map((c) => [c.name, 0]));
  for (const r of done) counts.set(r.label, (counts.get(r.label) || 0) + 1);
  const total = done.length || 1;
  const entries = [...counts];
  $("[data-dist]").innerHTML =
    `<div class="stack">${entries
      .filter(([, n]) => n)
      .map(([label, n]) => `<i style="flex:${n};--c:${colorOf(label)}" title="${esc(label)}: ${n}"></i>`)
      .join("")}</div><div class="legend">${entries
      .map(
        ([label, n]) => `<button class="leg ${filter === label ? "is-on" : ""} ${filter && filter !== label ? "is-dim" : ""}" data-filter="${esc(label)}">
        <i class="dot" style="--c:${colorOf(label)}"></i>${esc(label)}<b>${n.toLocaleString()}</b><span>${pct(n / total)}</span></button>`,
      )
      .join("")}</div>`;

  const idx = [];
  for (let i = 0; i < results.length && idx.length < SHOW; i++) {
    const r = results[i];
    if (!r || (filter && r.label !== filter) || (unsureOnly && r.confidence >= 0.6)) continue;
    idx.push(i);
  }
  $("[data-rows]").innerHTML = idx
    .map((i) => {
      const r = results[i];
      return `<tr data-row="${i}" class="${i === selected ? "is-sel" : ""} ${r.confidence < 0.6 ? "is-unsure" : ""}">
        <td class="num">${i + 1}</td>
        <td class="txt">${esc(rowText(data.rows[i]).slice(0, 220))}</td>
        <td><span class="tag" style="--c:${colorOf(r.label)}">${esc(r.label)}</span>${r.rule ? '<span class="rule-dot" title="keyword rule matched">rule</span>' : ""}</td>
        <td><span class="conf"><i style="--k:${r.confidence}"></i></span><span class="cap">${pct(r.confidence)}</span></td></tr>`;
    })
    .join("");
  const matching = results.filter((r) => r && (!filter || r.label === filter) && (!unsureOnly || r.confidence < 0.6)).length;
  $("[data-note]").textContent = matching > SHOW ? `Showing the first ${SHOW} of ${matching.toLocaleString()} rows. Downloads include all rows.` : "";
  if (selected >= 0 && results[selected]) showWhy(selected);
  steps();
}

function showWhy(i) {
  selected = i;
  const r = results[i];
  $("[data-why]").innerHTML = `
    <p class="cap">row ${i + 1}</p>
    <p class="why__text">${esc(rowText(data.rows[i]))}</p>
    ${explain(r)}
    <p class="cap">wrong? teach it:</p>
    <div class="fix">${model.classes.map((c) => `<button class="tag tag--btn" style="--c:${colorOf(c.name)}" data-teach="${esc(c.name)}">${esc(c.name)}</button>`).join("")}</div>`;
  $$("[data-row]").forEach((tr) => tr.classList.toggle("is-sel", Number(tr.dataset.row) === i));
}

$("[data-rows]").addEventListener("click", (e) => {
  const tr = e.target.closest("[data-row]");
  if (tr) showWhy(Number(tr.dataset.row));
});
$("[data-why]").addEventListener("click", (e) => {
  const b = e.target.closest("[data-teach]");
  if (!b || selected < 0) return;
  const lab = state.labels.find((l) => l.name.trim() === b.dataset.teach);
  if (!lab) return;
  lab.examples = lab.examples.filter((x) => x.trim()).concat(rowText(data.rows[selected]));
  renderLabels();
  retrain();
});
$("[data-dist]").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  filter = filter === b.dataset.filter ? null : b.dataset.filter;
  renderResults();
});
$("[data-unsure]").addEventListener("change", (e) => {
  unsureOnly = e.target.checked;
  renderResults();
});

function exportRows() {
  return data.rows.map((r, i) => ({
    ...r,
    label: results[i]?.label ?? "",
    confidence: results[i] ? results[i].confidence.toFixed(3) : "",
    rule: results[i]?.rule ?? "",
  }));
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$$("[data-dl]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!data) return;
    const base = (data.name || "data").replace(/\.[^.]+$/, "");
    const rows = exportRows();
    if (b.dataset.dl === "csv") download(`${base}-classified.csv`, toCSV([...data.columns, "label", "confidence", "rule"], rows), "text/csv");
    else download(`${base}-classified.json`, JSON.stringify(rows, null, 2), "application/json");
  }),
);

/* ---------------- theme + background ---------------- */
$(".theme").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("cl-theme", next);
  } catch {}
});
(() => {
  const canvas = $(".bgfield canvas");
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, dot = [237, 236, 232], hot = [247, 112, 63], raf = 0, last = 0;
  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    const p = (v, fb) => {
      const n = v.split(",").map(Number);
      return n.length === 3 && n.every((x) => !isNaN(x)) ? n : fb;
    };
    dot = p(cs.getPropertyValue("--dot"), dot);
    hot = p(cs.getPropertyValue("--dot-cut"), hot);
  };
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth;
    h = innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    const sweep = (((t / 11000) % 1) * 1.5 - 0.25) * (w + h * 0.6);
    for (let y = 13; y < h + 26; y += 26) {
      const fade = 1 - Math.min(1, y / (h * 1.1)) * 0.55;
      for (let x = 13; x < w + 26; x += 26) {
        const s = Math.sin(x * 0.4999 + y * 3.011) * 43758.5453;
        const rnd = s - Math.floor(s);
        let a = (0.1 + rnd * 0.06) * fade * Math.max(0.25, Math.min(1, x / 140, (w - x) / 140));
        let c = dot;
        if (!still) {
          const d = x + y * 0.6 - sweep;
          if (d > -60 && d < 60 && rnd > 0.35) (c = hot), (a += 0.22 * (1 - Math.abs(d) / 60));
        }
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.min(a, 0.75)})`;
        ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
      }
    }
  };
  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    if (t - last > 40) (last = t), draw(t);
  };
  colors();
  size();
  draw(0);
  if (!still) raf = requestAnimationFrame(loop);
  new MutationObserver(() => (colors(), draw(performance.now()))).observe(document.documentElement, { attributes: true });
  addEventListener("resize", () => (size(), draw(performance.now())));
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(raf);
    if (!document.hidden && !still) raf = requestAnimationFrame(loop);
  });
})();

/* ---------------- start ---------------- */
renderLabels();
renderState();
steps();
$$("[data-preset]").forEach((x) => x.classList.toggle("is-on", x.dataset.preset === state.preset));
if (state.preset && PRESETS[state.preset]) loadSample();
