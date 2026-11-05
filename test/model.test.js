import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, selfTest, train } from "../src/model.js";
import { parseCSV, parseLines, toCSV } from "../src/parse.js";
import { PRESETS } from "../src/presets.js";

test("presets train and classify their own sample data sensibly", () => {
  for (const p of Object.values(PRESETS)) {
    const st = selfTest(p.labels);
    // leave-one-out with 4-6 examples per label is harsh; this guards against regressions
    assert.ok(st.accuracy >= 0.6, `${p.title} self-test ${st.accuracy}`);
  }
  const m = train(PRESETS.logs.labels);
  assert.equal(classify(m, "ERROR redis connection refused").label, "error");
  assert.equal(classify(m, "WARN disk usage at 91%").label, "warning");
  assert.equal(classify(m, "INFO server started on port 80").label, "info");
});

test("keyword rules win and are reported", () => {
  const m = train(PRESETS.tickets.labels);
  const r = classify(m, "I want a refund");
  assert.equal(r.label, "billing");
  assert.equal(r.rule, "refund");
  assert.ok(Math.abs(r.probs.reduce((a, p) => a + p.p, 0) - 1) < 1e-9);
});

test("CSV parsing handles quotes, commas and newlines; export round-trips", () => {
  const d = parseCSV('id,msg\n1,"hello, ""world"""\n2,"two\nlines"\n');
  assert.deepEqual(d.columns, ["id", "msg"]);
  assert.equal(d.rows[0].msg, 'hello, "world"');
  assert.equal(d.rows[1].msg, "two\nlines");
  assert.deepEqual(parseCSV(toCSV(d.columns, d.rows)).rows, d.rows);
  assert.equal(parseLines("a\n\nb\n").rows.length, 2);
});
