import { test } from "node:test";
import assert from "node:assert/strict";
import { runPlaybook, ruleMatches, finishRow, outputFields, missingRuleColumns } from "../src/engine/run.js";
import { fuseLaya, classifyRow, trainNB } from "../src/classifier.js";
import { PLAYBOOKS } from "../src/playbooks.js";
import { fromMatrix, delimitedToMatrix } from "../src/parse.js";

const fake = (pick) => ({
  embed: async (texts) => texts.map(() => Float32Array.from([1, 0])),
  decide: async (states, q) => states.map(() => q.options.map((o) => (o.name === pick ? 0.97 : 0.03 / (q.options.length - 1)))),
});
const support = PLAYBOOKS.support;
const sample = fromMatrix(delimitedToMatrix(support.sample, ","));

test("rules parse money and compare numbers, and bad numbers never match", () => {
  const r = { column: "amount", op: ">", value: "500", decision: "x" };
  assert.equal(ruleMatches(r, { amount: "$1,200.50" }), true);
  assert.equal(ruleMatches(r, { amount: "90" }), false);
  assert.equal(ruleMatches(r, { amount: "n/a" }), false);
  assert.equal(ruleMatches({ column: "plan", op: "is", value: "PRO" }, { plan: "pro " }), true);
  assert.equal(ruleMatches({ category: "billing" }, {}, "billing"), true);
  assert.equal(ruleMatches({ category: "billing", column: "plan", op: "is", value: "pro" }, { plan: "pro" }, "bug"), false);
});

test("a rule beats the model, and a reviewer beats the rule", () => {
  const pb = { rules: [{ column: "amount", op: ">", value: "100", decision: "Escalate" }] };
  const dec = { label: "Refund", confidence: 0.2, probs: [], why: [], signals: ["words"] };
  const a = finishRow({ amount: "500" }, null, dec, pb, 0.6);
  assert.equal(a.decision.label, "Escalate");
  assert.equal(a.decision.by, "rule");
  assert.equal(a.needsReview, false);
  const b = finishRow({ amount: "500" }, null, dec, pb, 0.6, { decision: "Refund" });
  assert.equal(b.decision.label, "Refund");
  assert.equal(b.decision.by, "you");
  assert.equal(finishRow({ amount: "5" }, null, dec, pb, 0.6).needsReview, true);
});

test("the whole playbook produces a category and decision for every row", async () => {
  const results = [];
  const ok = await runPlaybook({ playbook: support, rows: sample.rows, textCols: ["message"], engine: { meaning: true, laya: false }, backend: fake(), results });
  assert.equal(ok, true);
  assert.equal(results.length, sample.rows.length);
  for (const r of results) {
    assert.ok(r.category.label);
    assert.ok(r.decision.label);
    assert.ok(r.reason.length > 0);
    assert.ok(["yes", "no"].includes(outputFields(r).needs_review));
  }
});

test("Laya only sees rows that are unsure and never overrides a rule", async () => {
  const seen = [];
  const backend = fake("Refund");
  const inner = backend.decide;
  backend.decide = async (s, q) => (seen.push(...s), inner(s, q));
  const pb = { ...support, categories: [], rules: [{ column: "message", op: "contains", value: "lawyer", decision: "Escalate to a person" }] };
  const rows = [{ message: "my lawyer is calling" }, { message: "some vague remark" }];
  const results = [];
  await runPlaybook({ playbook: pb, rows, textCols: ["message"], engine: { meaning: false, laya: true }, backend, results });
  assert.equal(results[0].decision.by, "rule");
  assert.ok(!seen.includes("my lawyer is calling"));
  assert.ok(seen.includes("some vague remark"));
  assert.ok(results[1].decision.signals.includes("Laya"));
});

test("cancelling stops the run", async () => {
  const results = [];
  const ok = await runPlaybook({ playbook: support, rows: sample.rows, textCols: ["message"], engine: {}, backend: fake(), results, cancelled: () => true });
  assert.equal(ok, false);
});

test("fuseLaya moves the answer when Laya strongly disagrees and reports it", () => {
  const labels = [
    { name: "a", description: "", keywords: "", examples: ["alpha beta"] },
    { name: "b", description: "", keywords: "", examples: ["gamma delta"] },
  ];
  const m = trainNB(labels);
  const r = classifyRow(m, null, "alpha", null);
  const f = fuseLaya(r, [1e-6, 1 - 1e-6]);
  assert.equal(f.laya.label, "b");
  assert.ok(f.signals.includes("Laya"));
  assert.ok(Math.abs(f.probs.reduce((x, p) => x + p.p, 0) - 1) < 1e-9);
});

test("a footer row with nothing to read stays blank and is never sent to review", async () => {
  const results = [];
  await runPlaybook({ playbook: support, rows: [{ message: "I was charged twice", id: "1" }, { message: "", id: "Total" }], textCols: ["message"], engine: { meaning: true, laya: true }, backend: fake("Refund"), results });
  assert.equal(results[1].skipped, true);
  assert.equal(results[1].needsReview, false);
  assert.equal(outputFields(results[1]).decision, "");
  assert.equal(outputFields(results[1]).needs_review, "");
  assert.ok(results[0].decision.label);
});

test("rules find columns regardless of capitalisation, and missing columns are reported", () => {
  assert.equal(ruleMatches({ column: "amount", op: ">", value: "500" }, { Amount: "$1,400" }), true);
  assert.equal(ruleMatches({ column: "plan", op: "is", value: "enterprise" }, { " Plan ": "Enterprise" }), true);
  assert.equal(ruleMatches({ column: "nope", op: "is empty" }, { a: "" }), false);
  assert.deepEqual(missingRuleColumns([{ column: "amount", decision: "x" }, { column: "region", decision: "x" }, { column: "skip" }], ["Amount"]), ["region"]);
});
