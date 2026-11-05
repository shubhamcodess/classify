import { $, esc } from "../ui.js";
import { state, subscribe, saveProject, openProject, deleteProject, renameProject, projects, refreshProjects } from "./store.js";

const when = (t) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export function projectsScreen(root) {
  let error = "";
  const paint = () => {
    const list = projects();
    const canSave = state.data && state.run.status !== "running";
    root.innerHTML = `
    <header class="head"><div><h1>Projects</h1><p class="muted">Saved work: the file, its results and your corrections. Stored only in this browser, so clearing site data removes it.</p></div>
      ${canSave && !state.projectId ? `<button class="btn btn--solid btn--sm" data-save>Save current work</button>` : ""}</header>
    ${error ? `<p class="alert" role="alert">${esc(error)}</p>` : ""}
    ${list.length
      ? `<section class="panel panel--flush"><div class="tablewrap"><table class="tbl tbl--models">
        <thead><tr><th>Project</th><th>File</th><th class="c">Rows</th><th class="c">To review</th><th>Saved</th><th></th></tr></thead>
        <tbody>${list.map((p) => `<tr data-p="${esc(p.id)}">
          <td><input class="input input--title input--cell" data-rename value="${esc(p.name)}" aria-label="Project name" />${p.id === state.projectId ? '<div class="muted small">Open now, saves automatically</div>' : ""}</td>
          <td class="muted">${esc(p.fileName)}<div class="small">${size(p.bytes)}</div></td>
          <td class="c">${p.rows.toLocaleString()}</td>
          <td class="c">${p.review ? `<span class="flag">${p.review.toLocaleString()}</span>` : "–"}</td>
          <td class="muted nowrap">${when(p.savedAt)}</td>
          <td class="right nowrap">${p.id === state.projectId ? "" : `<button class="btn btn--line btn--sm" data-open>Open</button>`}<button class="btn btn--ghost btn--sm" data-del>Delete</button></td>
        </tr>`).join("")}</tbody></table></div></section>`
      : `<div class="blank"><b>No saved projects yet</b><span class="muted">Run a file, then press Save project to keep it and come back later.</span><a class="btn btn--solid btn--sm" href="#/app">New run</a></div>`}`;
  };
  const guard = async (fn) => {
    error = "";
    try {
      await fn();
    } catch (e) {
      error = `That did not work: ${e.message}`;
      paint();
    }
  };
  root.addEventListener("click", (e) => {
    const row = e.target.closest("[data-p]");
    const id = row?.dataset.p;
    if (e.target.closest("[data-save]")) return guard(() => saveProject());
    if (e.target.closest("[data-open]")) return guard(async () => {
      await openProject(id);
      location.hash = "#/app/review";
    });
    if (e.target.closest("[data-del]")) {
      const name = projects().find((p) => p.id === id)?.name;
      if (confirm(`Delete "${name}" from this browser? This cannot be undone.`)) guard(() => deleteProject(id));
    }
  });
  root.addEventListener("change", (e) => {
    if (e.target.matches("[data-rename]")) guard(() => renameProject(e.target.closest("[data-p]").dataset.p, e.target.value.trim() || "Untitled"));
  });
  paint();
  refreshProjects().catch((e) => ((error = e.message), paint()));
  return subscribe((w) => w !== "progress" && paint());
}
