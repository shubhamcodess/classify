import { $ } from "../ui.js";
import { subscribe, summary, openFile, projects, refreshProjects } from "./store.js";
import { runScreen } from "./run-screen.js";
import { reviewScreen } from "./review-screen.js";
import { projectsScreen } from "./projects-screen.js";
import { playbooksScreen } from "./playbooks-screen.js";
import { modelsScreen } from "./models-screen.js";

const SCREENS = {
  run: { title: "New run", render: runScreen },
  review: { title: "Review", render: reviewScreen, count: "review" },
  projects: { title: "Projects", render: projectsScreen, count: "projects" },
  playbooks: { title: "Playbooks", render: playbooksScreen },
  models: { title: "Models", render: modelsScreen },
};

export function appShell(view, screen) {
  const name = SCREENS[screen] ? screen : "run";
  view.innerHTML = `<div class="app">
    <nav class="appnav" aria-label="App">
      ${Object.entries(SCREENS).map(([k, s]) => `<a class="appnav__link ${k === name ? "is-on" : ""}" href="#/app${k === "run" ? "" : `/${k}`}" ${k === name ? 'aria-current="page"' : ""}>${s.title}${s.count ? `<span class="count" data-count="${s.count}" hidden></span>` : ""}</a>`).join("")}
    </nav>
    <div class="main" id="screen"></div>
    <div class="dropveil" data-veil hidden><div>Drop to load this file</div></div>
  </div>`;
  document.title = `${SCREENS[name].title} · classify`;

  const unmount = SCREENS[name].render($("#screen", view)) || (() => {});
  const counts = () => {
    const set = (key, n) => {
      const el = $(`[data-count="${key}"]`, view);
      el.hidden = !n;
      el.textContent = n.toLocaleString();
    };
    set("review", summary().review);
    set("projects", projects().length);
  };
  counts();
  const off = subscribe(counts);
  refreshProjects().catch(() => {});

  // drop a file anywhere in the app
  const veil = $("[data-veil]", view);
  let depth = 0;
  const isFile = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const enter = (e) => isFile(e) && (depth++, (veil.hidden = false));
  const leave = (e) => isFile(e) && (depth = Math.max(0, depth - 1)) === 0 && (veil.hidden = true);
  const over = (e) => isFile(e) && e.preventDefault();
  const drop = (e) => {
    if (!isFile(e)) return;
    e.preventDefault();
    depth = 0;
    veil.hidden = true;
    const f = e.dataTransfer.files[0];
    if (!f) return;
    openFile(f);
    if (name !== "run") location.hash = "#/app";
  };
  const on = [["dragenter", enter], ["dragleave", leave], ["dragover", over], ["drop", drop]];
  on.forEach(([t, f]) => addEventListener(t, f));
  return () => {
    unmount();
    off();
    on.forEach(([t, f]) => removeEventListener(t, f));
  };
}
