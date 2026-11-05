// The home page's motion demo: a replay of real output (src/bench-results.json), not invented numbers.
import { $, esc, BENCH } from "./ui.js";

const FILE = "tickets.xlsx";
const ICON = '<svg class="s" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/></svg>';

function pickRows() {
  const all = BENCH.examples.support.rows;
  const flagged = all.find((r) => r.needs_review === "yes" && /weird/.test(r.text)) || all.find((r) => r.needs_review === "yes");
  const rest = all.filter((r) => r !== flagged);
  const rule = rest.filter((r) => r.decided_by === "rule").slice(0, 2);
  const plain = rest.filter((r) => r.decided_by !== "rule" && r.needs_review === "no").slice(0, 4);
  const rows = [plain[0], rule[0], plain[1], plain[2], rule[1], plain[3]].filter(Boolean);
  rows.splice(4, 0, flagged);
  return rows.slice(0, 7);
}

export function mountDemo(root, onTry) {
  const rows = pickRows();
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.innerHTML = `<figure class="demo" style="margin:0" aria-label="Demo: a ticket export is dropped in, each row gets a category and a decision, an unsure row is reviewed, and the same file downloads with new columns">
    <div class="demo__bar"><span class="demo__dots"><i></i><i></i><i></i></span><span data-title>Support ticket triage</span><span class="demo__stat" data-stat></span></div>
    <div class="demo__stage" aria-hidden="true">
      <div class="demo__drop" data-drop>${ICON}<span>Drop a file</span></div>
      <div class="demo__file" data-file>${ICON}${FILE}</div>
      <div class="demo__table" data-table>
        <table class="tbl"><colgroup><col /><col class="col-cat" style="width:17%" /><col style="width:25%" /><col style="width:15%" /></colgroup>
          <thead><tr><th>message</th><th class="col-cat demo__col">category</th><th class="demo__col">decision</th><th class="demo__col">decided by</th></tr></thead>
          <tbody>${rows.map((r, i) => `<tr data-r="${i}"><td>${esc(r.text)}</td><td class="col-cat muted"></td><td class="dec"></td><td class="muted"></td></tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="demo__card" data-card></div>
      <div class="demo__done" data-done>${ICON}<span data-done-text></span></div>
    </div>
    <figcaption class="demo__foot"><span>Replay of real output from the sample tickets, sped up.</span>
      <span class="row"><button class="btn btn--ghost btn--sm" data-pause>Pause</button><button class="btn btn--ghost btn--sm" data-replay>Replay</button><button class="btn btn--line btn--sm" data-try>Try this file</button></span></figcaption>
  </figure>`;
  const q = (s) => $(s, root);
  let token = 0;
  let paused = false;
  let visible = true;

  const wait = (ms, my) =>
    new Promise((resolve, reject) => {
      let left = ms;
      let last = performance.now();
      const tick = (now) => {
        if (my !== token) return reject(new Error("stop"));
        if (!paused && visible && !document.hidden) left -= now - last;
        last = now;
        if (left <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  const reset = () => {
    q("[data-drop]").className = "demo__drop";
    q("[data-file]").className = "demo__file";
    q("[data-table]").className = "demo__table";
    q("[data-card]").className = "demo__card";
    q("[data-done]").className = "demo__done";
    q("[data-stat]").innerHTML = "";
    root.querySelectorAll("[data-r]").forEach((tr) => {
      tr.className = "";
      [...tr.cells].slice(1).forEach((c) => (c.textContent = ""));
    });
  };
  const fill = (i, animate = true) => {
    const r = rows[i];
    const cells = q(`[data-r="${i}"]`).cells;
    const put = (c, t) => (c.innerHTML = `<span class="${animate ? "demo__new" : ""}">${esc(t)}</span>`);
    put(cells[1], r.category);
    put(cells[2], r.decision);
    put(cells[3], r.needs_review === "yes" ? "needs review" : r.decided_by);
    q(`[data-r="${i}"]`).classList.toggle("is-flag", r.needs_review === "yes");
  };
  const stat = (done, flagged) => (q("[data-stat]").innerHTML = `<b>${done}</b> of ${rows.length} rows${flagged ? ` · <b>${flagged}</b> to review` : ""}`);
  const flagIdx = () => rows.findIndex((r) => r.needs_review === "yes");
  const fixedDecision = "Send to engineering";

  const cardHtml = (i) => {
    const r = rows[i];
    const options = ["Reply with help article", "Send to engineering", "Add to backlog"];
    return `<dl style="margin:0;display:grid;gap:3px"><dt>message</dt><dd>${esc(r.text)}</dd></dl>
      <div style="color:var(--text-2)">Unsure: ${Math.round(Number(r.decision_confidence) * 100)}% confidence, so it asks you.</div>
      <div class="demo__opts">${options.map((o) => `<span data-opt="${esc(o)}">${esc(o)}</span>`).join("")}</div>`;
  };

  async function play(my) {
    for (;;) {
      reset();
      await wait(500, my);
      q("[data-file]").classList.add("is-in");
      await wait(500, my);
      q("[data-drop]").classList.add("is-over");
      await wait(600, my);
      q("[data-file]").classList.add("is-out");
      q("[data-drop]").classList.add("is-gone");
      q("[data-table]").classList.add("is-on");
      await wait(500, my);
      let flagged = 0;
      for (let i = 0; i < rows.length; i++) {
        const tr = q(`[data-r="${i}"]`);
        tr.classList.add("is-scan");
        await wait(280, my);
        fill(i);
        if (rows[i].needs_review === "yes") flagged++;
        stat(i + 1, flagged);
        await wait(240, my);
        tr.classList.remove("is-scan");
      }
      await wait(900, my);
      const f = flagIdx();
      if (f >= 0) {
        const card = q("[data-card]");
        card.innerHTML = cardHtml(f);
        card.classList.add("is-on");
        q(`[data-r="${f}"]`).classList.add("is-scan");
        await wait(1500, my);
        card.querySelector(`[data-opt="${fixedDecision}"]`)?.classList.add("is-on");
        await wait(800, my);
        const cells = q(`[data-r="${f}"]`).cells;
        cells[2].innerHTML = `<span class="demo__new">${esc(fixedDecision)}</span>`;
        cells[3].innerHTML = `<span class="demo__new">reviewer</span>`;
        q(`[data-r="${f}"]`).classList.remove("is-flag", "is-scan");
        card.classList.remove("is-on");
        stat(rows.length, 0);
        await wait(700, my);
      }
      q("[data-done-text]").textContent = "tickets-classified.xlsx, same file with new columns";
      q("[data-done]").classList.add("is-on");
      await wait(3200, my);
      q("[data-table]").classList.remove("is-on");
      q("[data-done]").classList.remove("is-on");
      await wait(400, my);
    }
  }
  const start = () => {
    const my = ++token;
    paused = false;
    q("[data-pause]").textContent = "Pause";
    play(my).catch(() => {});
  };
  const finalFrame = () => {
    q("[data-drop]").classList.add("is-gone");
    q("[data-table]").classList.add("is-on");
    rows.forEach((_, i) => fill(i, false));
    stat(rows.length, rows.filter((r) => r.needs_review === "yes").length);
    q("[data-pause]").hidden = true;
    q("[data-replay]").hidden = true;
  };

  q("[data-pause]").addEventListener("click", (e) => {
    paused = !paused;
    e.target.textContent = paused ? "Resume" : "Pause";
  });
  q("[data-replay]").addEventListener("click", start);
  q("[data-try]").addEventListener("click", onTry);
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(root);
  if (still) finalFrame();
  else start();
  return () => {
    token++;
    io.disconnect();
  };
}
