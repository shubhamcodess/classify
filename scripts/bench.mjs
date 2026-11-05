// Reproduce every accuracy figure on the site: `npm run bench`. Needs Laya's ONNX export, via LAYA_REPO
// (Hugging Face repo) or LAYA_LOCAL (a folder of models). Without one, Laya columns are left out.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRESETS } from "../src/presets.js";
import { PLAYBOOKS } from "../src/playbooks.js";
import { BENCH } from "../src/bench-data.js";
import { DECISIONS, DEV, TEST } from "../src/bench-decisions.js";
import { trainNB, buildSemantic, classifyRow, fuseLaya, NB_ONLY, WEIGHTS, LAYA_WEIGHT } from "../src/classifier.js";
import { createRuntime, MODELS } from "../src/engine/models.js";
import { runPlaybook, outputFields, DEFAULT_THRESHOLD } from "../src/engine/run.js";
import { parseFile } from "../src/parse.js";

const rt = createRuntime((name, p) => p.state === "ready" && console.log(`${name} ready`));
await rt.load("meaning");
let hasLaya = true;
try {
  await rt.load("laya");
} catch (e) {
  hasLaya = false;
  console.log("Laya not available, skipping it:", e.message);
}
const embed = (t) => rt.embed(t);
const pc = (x) => Math.round(x * 1000) / 10;

async function evaluate(labels, instructions, rows) {
  const model = trainNB(labels);
  const sem = await buildSemantic(model, labels, embed);
  const texts = rows.map((r) => r[1]);
  const gold = rows.map((r) => r[0]);
  const vecs = await embed(texts);
  const names = model.classes.map((c) => c.name);
  const words = texts.map((t) => classifyRow(model, null, t, null, NB_ONLY));
  const hybrid = texts.map((t, i) => classifyRow(model, sem, t, vecs[i], WEIGHTS));
  const score = (xs) => xs.filter((x, i) => x.label === gold[i]).length / gold.length;
  const out = { n: rows.length, words: pc(score(words)), hybrid: pc(score(hybrid)) };
  if (hasLaya) {
    const q = { type: "choice", instructions, options: labels.map((l) => ({ name: l.name, description: l.description })) };
    const opt = q.options.map((o) => o.name);
    const probs = [];
    const t0 = performance.now();
    for (let i = 0; i < texts.length; i += 8) probs.push(...(await rt.decide(texts.slice(i, i + 8), q)));
    out.layaMsPerRow = Math.round((performance.now() - t0) / texts.length);
    const inOrder = probs.map((p) => names.map((n) => p[opt.indexOf(n)]));
    out.laya = pc(inOrder.filter((p, i) => names[p.indexOf(Math.max(...p))] === gold[i]).length / gold.length);
    const all = hybrid.map((h, i) => fuseLaya(h, inOrder[i], LAYA_WEIGHT));
    out.all = pc(score(all));
    out.coverage = [0.6, 0.8].map((th) => {
      const kept = all.map((x, i) => [x, gold[i]]).filter(([x]) => x.confidence >= th);
      return { threshold: th, autoDecided: pc(kept.length / gold.length), accuracy: kept.length ? pc(kept.filter(([x, g]) => x.label === g).length / kept.length) : null };
    });
  }
  return out;
}

const INS = { logs: "What is the severity of this log line?", tickets: "Which category does this support ticket belong to?", sentiment: "What is the sentiment of this review?" };
const decisionQ = PLAYBOOKS.support.decisionQuestion;
const results = {
  decisions: { dev: await evaluate(DECISIONS, decisionQ, DEV), test: await evaluate(DECISIONS, decisionQ, TEST) },
  categories: {},
};
for (const k of Object.keys(BENCH)) results.categories[k] = await evaluate(PRESETS[k].labels, INS[k], BENCH[k]);

// One worked example per playbook, produced by the real pipeline.
const backend = { embed: (t, tick) => rt.embed(t, 16, tick), decide: (s, q) => rt.decide(s, q) };
const fileOf = (name, text) => ({ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
const examples = {};
for (const [id, pb] of Object.entries(PLAYBOOKS)) {
  const d = await parseFile(fileOf(pb.sampleName, pb.sample));
  const col = d.columns.includes("message") ? "message" : d.columns[d.columns.length - 1];
  const res = [];
  await runPlaybook({ playbook: pb, rows: d.rows, textCols: [col], engine: { meaning: true, laya: hasLaya }, backend, results: res, threshold: DEFAULT_THRESHOLD });
  examples[id] = { name: pb.name, rows: d.rows.map((r, i) => ({ text: r[col], ...outputFields(res[i]) })) };
}

const out = { generatedAt: new Date().toISOString().slice(0, 10), laya: hasLaya ? MODELS.laya.original : null, ...results, examples };
writeFileSync(fileURLToPath(new URL("../src/bench-results.json", import.meta.url)), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ decisions: results.decisions, categories: results.categories }, null, 1));
