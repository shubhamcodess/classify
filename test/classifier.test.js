import { test } from "node:test";
import assert from "node:assert/strict";
import { train } from "../src/model.js";
import { classifyRow, neighbours, NB_ONLY, WEIGHTS, exampleTexts } from "../src/classifier.js";
import { PRESETS } from "../src/presets.js";

// Deterministic fake embeddings: each label owns one axis; the example text decides the axis.
const axis = (n) => Float32Array.from({ length: 4 }, (_, i) => (i === n ? 1 : 0));
const fakeSem = (labels, model) => ({
  names: model.classes.map((c) => c.name),
  items: exampleTexts(labels).map((x) => ({
    label: x.label,
    text: x.text,
    vec: axis(model.classes.findIndex((c) => c.name === x.label)),
    ci: model.classes.findIndex((c) => c.name === x.label),
  })),
});

test("exampleTexts includes examples and the description, skipping blanks", () => {
  const out = exampleTexts([{ name: "a", description: "d", keywords: "", examples: ["x", " ", ""] }]);
  assert.deepEqual(out.map((o) => o.text), ["x", "d"]);
});

test("NB-only rows carry no semantic data and report mode 'nb'", () => {
  const m = train(PRESETS.tickets.labels);
  const r = classifyRow(m, null, "I was charged twice", null, NB_ONLY);
  assert.equal(r.mode, "nb");
  assert.equal(r.nearest, null);
  assert.equal(r.label, "billing");
});

test("semantic similarity can override word evidence when it is strong", () => {
  const labels = [
    { name: "a", description: "", keywords: "", examples: ["alpha words"] },
    { name: "b", description: "", keywords: "", examples: ["beta words"] },
  ];
  const m = train(labels);
  const sem = fakeSem(labels, m);
  // text shares words with "a", but its vector points at "b"
  const vec = axis(1);
  const r = classifyRow(m, sem, "alpha", vec, { nb: 0, sem: 10 });
  assert.equal(r.label, "b");
  assert.equal(r.mode, "hybrid");
  assert.equal(r.nearest.text, "beta words");
  assert.ok(r.nearest.sim > 0.99);
});

test("neighbours returns the best example per label", () => {
  const labels = [
    { name: "a", description: "", keywords: "", examples: ["one", "two"] },
    { name: "b", description: "", keywords: "", examples: ["three"] },
  ];
  const m = train(labels);
  const sem = fakeSem(labels, m);
  const { sims, nearest } = neighbours(sem, axis(0));
  assert.deepEqual(sims.map((s) => Math.round(s)), [1, 0]);
  assert.equal(nearest[0].text, "one");
});

test("app default weights blend both signals", () => {
  assert.ok(WEIGHTS.nb > 0 && WEIGHTS.sem > 0);
});
