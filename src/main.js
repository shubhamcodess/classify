import { landing } from "./landing.js";
import { appShell } from "./app/shell.js";

let unmount = null;

function route() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, anchor] = raw.split("#");
  const parts = (path || "/").split("/").filter(Boolean);
  const inApp = parts[0] === "app";
  unmount?.();
  unmount = null;
  const view = document.getElementById("view");
  view.innerHTML = "";
  document.body.classList.toggle("in-app", inApp);
  if (inApp) unmount = appShell(view, parts[1] || "run");
  else {
    document.title = "classify: decisions for every row of your file";
    unmount = landing(view);
  }
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
  else window.scrollTo({ top: 0, behavior: "instant" });
}
addEventListener("hashchange", route);
route();

document.addEventListener("click", (e) => {
  if (!e.target.closest(".theme, [data-theme-toggle]")) return;
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("cl-theme", next);
  } catch {}
});
