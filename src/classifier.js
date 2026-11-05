// Scores one row against a set of labels, using up to three signals:
//   words   Naive Bayes over your examples. Instant, and it can name the words that mattered.
//   meaning Cosine similarity to the closest example of each label (sentence embeddings).
//   Laya    A decision model's own probability per option, multiplied in as a second opinion.
// The mixing weights were chosen on the dev lines in src/bench-decisions.js, before the test lines were run.
import { classify, train } from "./model.js";
import { dot, softmax } from "./engine/math.js";

export const WEIGHTS = { nb: 1, sem: 25 };
export const NB_ONLY = { nb: 1, sem: 0 };
export const LAYA_WEIGHT = 0.5;

/** Every example text (and the description, as one more example) with its label name. */
export function exampleTexts(labels) {
  const out = [];
  for (const l of labels) {
    const name = l.name.trim();
    if (!name) continue;
    for (const e of l.examples) if (e.trim()) out.push({ label: name, text: e.trim() });
    if (l.description?.trim()) out.push({ label: name, text: l.description.trim() });
  }
  return out;
}

export const trainNB = (labels) => train(labels);

export async function buildSemantic(model, labels, embed) {
  const names = model.classes.map((c) => c.name);
  const items = exampleTexts(labels).filter((x) => names.includes(x.label));
  if (!items.length) return null;
  const vecs = await embed(items.map((i) => i.text));
  return { names, items: items.map((it, i) => ({ label: it.label, text: it.text, vec: vecs[i], ci: names.indexOf(it.label) })) };
}

export function neighbours(sem, vec) {
  const sims = sem.names.map(() => -1);
  const nearest = sem.names.map(() => null);
  for (const it of sem.items) {
    const s = dot(vec, it.vec);
    if (s > sims[it.ci]) {
      sims[it.ci] = s;
      nearest[it.ci] = { text: it.text, sim: s };
    }
  }
  return { sims, nearest };
}

/** Classify one row. `vec` is its embedding, or null when the meaning model is off. */
export function classifyRow(model, sem, text, vec, weights = WEIGHTS) {
  const useSem = Boolean(sem && vec && weights.sem);
  const nb = useSem ? neighbours(sem, vec) : null;
  const r = classify(model, text, { nbWeight: weights.nb, simWeight: useSem ? weights.sem : 0, sims: useSem ? nb.sims : null });
  if (!r) return null;
  const best = model.classes.findIndex((c) => c.name === r.label);
  return { ...r, mode: useSem ? "hybrid" : "nb", signals: useSem ? ["words", "meaning"] : ["words"], nearest: useSem ? nb.nearest[best] : null, allNearest: useSem ? nb.nearest : null, names: model.classes.map((c) => c.name) };
}

/** Multiply in Laya's probabilities (given in `names` order) and recompute the winner. */
export function fuseLaya(r, layaProbs, weight = LAYA_WEIGHT) {
  const base = r.names.map((n) => r.probs.find((p) => p.label === n).p);
  const probs = softmax(base.map((p, i) => Math.log(p + 1e-9) + weight * Math.log(layaProbs[i] + 1e-9)));
  let best = 0;
  probs.forEach((p, i) => {
    if (p > probs[best]) best = i;
  });
  const layaBest = layaProbs.indexOf(Math.max(...layaProbs));
  return {
    ...r,
    label: r.names[best],
    confidence: probs[best],
    probs: r.names.map((label, i) => ({ label, p: probs[i] })),
    nearest: r.allNearest ? r.allNearest[best] : r.nearest,
    rule: r.label === r.names[best] ? r.rule : null,
    why: r.label === r.names[best] ? r.why : [],
    signals: [...r.signals, "Laya"],
    laya: { label: r.names[layaBest], p: layaProbs[layaBest] },
  };
}
