import { $, $$, esc, pct, BENCH, mb } from "../ui.js";
import { MODELS, getStatus, onStatus, loadModel, clearModel, refreshCache } from "../engine/client.js";

const fmt = (b) => (b > 1e8 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e6)} MB`);
const STEPS = [
  ["Rules", "Your rules are checked first and always win. They can use any column, such as an amount or a plan."],
  ["Words", "Naive Bayes over your examples. It runs instantly and can name the words that mattered."],
  ["Meaning", "Compares the row with your examples by meaning, so “billed after I cancelled” matches “charged twice”."],
  ["Laya", "A decision model reads the row and scores each option. Used as a second opinion on rows that are still unsure."],
  ["Confidence", "If the final answer is below your threshold, the row goes to a person instead of being decided silently."],
];

function statusLine(s, m) {
  if (s.state === "ready") return ["ok", `Ready on ${s.device || "this device"}`];
  if (s.state === "downloading") return ["run", `Downloading ${pct(s.progress)} · ${fmt(s.loaded)} of ${fmt(s.total || m.bytes)}`];
  if (s.state === "loading") return ["run", "Starting"];
  if (s.state === "error") return ["err", "Could not load"];
  if (s.cached) return ["ok", "Downloaded"];
  return ["", "Not downloaded"];
}

export function modelsScreen(root) {
  const T = BENCH.decisions.test;
  root.innerHTML = `
    <header class="head"><div><h1>Models</h1><p class="muted">Everything runs in this browser. Models download once, only when you ask, and then work offline.</p></div></header>
    <section class="panel panel--flush"><table class="tbl tbl--models">
      <thead><tr><th>Model</th><th>What it does</th><th>Size</th><th>Status</th><th></th></tr></thead>
      <tbody data-models></tbody>
    </table></section>
    <p class="alert" data-error hidden role="alert"></p>

    <section class="section"><h2>How a row is decided</h2>
      <ol class="steps">${STEPS.map(([a, b]) => `<li><b>${a}</b><span class="muted">${b}</span></li>`).join("")}</ol>
    </section>

    <section class="section"><h2>Measured accuracy</h2>
      <p class="muted">Share of correct decisions on ${T.n} ticket lines kept aside and never used to choose any setting. Labels are hand-written, so treat small differences as noise. Measured ${esc(BENCH.generatedAt)}; reproduce with <code>npm run bench</code>.</p>
      <div class="panel panel--flush"><table class="tbl">
        <thead><tr><th>Task</th><th>Lines</th><th>Words</th><th>+ Meaning</th><th>Laya alone</th><th>All three</th></tr></thead>
        <tbody>
          ${[["Ticket decisions", T], ["Ticket categories", BENCH.categories.tickets], ["Log severity", BENCH.categories.logs], ["Review sentiment", BENCH.categories.sentiment]]
            .map(([name, r]) => `<tr><td>${name}</td><td>${r.n}</td><td>${Math.round(r.words)}%</td><td>${Math.round(r.hybrid)}%</td><td>${r.laya != null ? `${Math.round(r.laya)}%` : "–"}</td><td>${r.all != null ? `<b>${Math.round(r.all)}%</b>` : "–"}</td></tr>`).join("")}
        </tbody>
      </table></div>
      ${T.coverage ? `<p class="muted small">With all three models on ticket decisions: at 60% confidence or above, ${Math.round(T.coverage[0].autoDecided)}% of rows are decided automatically at ${Math.round(T.coverage[0].accuracy)}% accuracy. At 80%, ${Math.round(T.coverage[1].autoDecided)}% at ${Math.round(T.coverage[1].accuracy)}%. The rest go to review.</p>` : ""}
    </section>

    <section class="section"><h2>What leaves your device - Nothing</h2>
      <p class="muted">Your files and rows never leave this tab. The only network requests are the downloads you ask for: model files from Hugging Face and the runtime that executes them from jsDelivr. Models, projects and playbooks are stored in this browser.</p>
      <p class="muted">Rows are untrusted input. A row can try to talk a model into an answer, but it can only pick from your options, and your rules always run first. Use rules for anything that must never be wrong.</p>
    </section>`;

  const paint = () => {
    const rows = Object.values(MODELS).map((m) => {
      const s = getStatus(m.key);
      const [tone, text] = statusLine(s, m);
      const busy = s.state === "downloading" || s.state === "loading";
      const have = s.cached || s.state === "ready";
      return `<tr>
        <td><b>${m.title}</b><div class="muted small"><a href="https://huggingface.co/${esc(m.original)}" target="_blank" rel="noopener">${esc(m.original)}</a> · ${esc(m.licence)}</div></td>
        <td class="muted">${esc(m.purpose)}</td>
        <td class="nowrap">${fmt(m.bytes)}</td>
        <td class="nowrap"><span class="status status--${tone}"><i></i>${esc(text)}</span>${s.state === "downloading" ? `<div class="progress"><i style="--k:${s.progress}"></i></div>` : ""}</td>
        <td class="right nowrap">${busy ? "" : have ? `<button class="btn btn--ghost btn--sm" data-clear="${m.key}">Remove</button>` : `<button class="btn btn--line btn--sm" data-get="${m.key}">Download</button>`}</td>
      </tr>`;
    });
    $("[data-models]", root).innerHTML = `<tr><td><b>Words</b><div class="muted small">Built in</div></td><td class="muted">Matches your examples by their words, and always runs.</td><td>–</td><td><span class="status status--ok"><i></i>Ready</span></td><td></td></tr>${rows.join("")}`;
    const errs = Object.values(MODELS).filter((m) => getStatus(m.key).state === "error");
    const e = $("[data-error]", root);
    e.hidden = !errs.length;
    e.textContent = errs.map((m) => `${m.title}: ${getStatus(m.key).error}`).join(" ");
  };
  root.addEventListener("click", (ev) => {
    const g = ev.target.closest("[data-get]");
    if (g) loadModel(g.dataset.get).catch(() => {});
    const c = ev.target.closest("[data-clear]");
    if (c && confirm(`Remove ${MODELS[c.dataset.clear].title} from this browser? You can download it again later.`)) clearModel(c.dataset.clear).catch(() => {});
  });
  paint();
  refreshCache().then(paint).catch(() => {});
  return onStatus(paint);
}
