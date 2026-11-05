// Takes a playbook and rows, and produces a category and a decision for every row.
// Rules are checked first and always win. Then words, meaning and optionally Laya score the options.
// Rows the engine is not confident about are flagged for a person instead of being silently decided.
import { trainNB, buildSemantic, classifyRow, fuseLaya, NB_ONLY, WEIGHTS } from "../classifier.js";

export const DEFAULT_THRESHOLD = 0.6;
const CHUNK = 128;
const LAYA_BATCH = 8;
const LAYA_UNSURE_BELOW = 0.9;

const toNumber = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return String(v ?? "").trim() === "" || Number.isNaN(n) ? null : n;
};

export function ruleMatches(rule, row, category) {
  if (rule.category && rule.category !== category) return false;
  if (!rule.column) return Boolean(rule.category);
  // Exports vary in capitalisation: "amount" in a rule must find an "Amount" column.
  const wanted = rule.column.trim().toLowerCase();
  const key = rule.column in row ? rule.column : Object.keys(row).find((k) => k.trim().toLowerCase() === wanted);
  if (key === undefined) return false;
  const raw = row[key];
  const a = String(raw ?? "").trim().toLowerCase();
  const b = String(rule.value ?? "").trim().toLowerCase();
  switch (rule.op) {
    case "contains": return a.includes(b);
    case "not contains": return !a.includes(b);
    case "is": return a === b;
    case "is not": return a !== b;
    case "is empty": return a === "";
    case ">": case "<": case ">=": case "<=": {
      const x = toNumber(raw);
      const y = toNumber(rule.value);
      if (x === null || y === null) return false;
      return rule.op === ">" ? x > y : rule.op === "<" ? x < y : rule.op === ">=" ? x >= y : x <= y;
    }
    default: return false;
  }
}

/** Columns that rules refer to but this file does not have. Such a rule can never fire, so we say so. */
export function missingRuleColumns(rules = [], columns = []) {
  const have = new Set(columns.map((c) => c.trim().toLowerCase()));
  return [...new Set(rules.filter((r) => r.column?.trim() && r.decision && !have.has(r.column.trim().toLowerCase())).map((r) => r.column.trim()))];
}

export function describeRule(rule) {
  const parts = [];
  if (rule.category) parts.push(`category is ${rule.category}`);
  if (rule.column) parts.push(`${rule.column} ${rule.op}${rule.op === "is empty" ? "" : ` ${rule.value}`}`);
  return parts.join(" and ");
}

export const usableLabels = (labels = []) => labels.filter((l) => l.name.trim() && (l.examples.some((e) => e.trim()) || l.description?.trim()));

export const rowText = (row, cols) => cols.map((c) => row[c]).filter((v) => v !== "" && v != null).join(" · ");

function reasonFor(d) {
  if (!d) return "";
  if (d.by === "you") return "Set by reviewer";
  if (d.by === "rule") return `Rule: ${d.ruleText}`;
  const bits = [];
  if (d.rule) bits.push(`keyword "${d.rule}"`);
  if (d.nearest) bits.push(`closest example "${d.nearest.text.slice(0, 90)}"`);
  else if (d.why?.length) bits.push(`words ${d.why.filter((w) => w.weight > 0).slice(0, 3).map((w) => w.token).join(", ")}`);
  if (d.laya) bits.push(d.laya.label === d.label ? "Laya agrees" : `Laya preferred ${d.laya.label}`);
  return bits.join("; ");
}

/** Combine a row's two answers, apply rules and reviewer overrides, and decide if a person should look. */
export function finishRow(row, cat, dec, playbook, threshold, override) {
  let category = cat;
  if (override?.category) category = { label: override.category, confidence: 1, by: "you", probs: cat?.probs || [], why: [], signals: [] };
  let decision = dec;
  let usedCategoryRule = false;
  for (const rule of playbook.rules || []) {
    if (!rule.decision || !ruleMatches(rule, row, category?.label)) continue;
    decision = { label: rule.decision, confidence: 1, by: "rule", ruleText: describeRule(rule), probs: dec?.probs || [], why: [], signals: ["rule"] };
    usedCategoryRule = Boolean(rule.category);
    break;
  }
  if (override?.decision) decision = { label: override.decision, confidence: 1, by: "you", probs: dec?.probs || [], why: [], signals: [] };
  const low = (x) => x && x.by !== "rule" && x.by !== "you" && x.confidence < threshold;
  const decidedByRule = decision?.by === "rule";
  const needsReview = Boolean(decidedByRule ? usedCategoryRule && low(category) : low(decision) || low(category));
  return { category, decision, needsReview, reviewed: Boolean(override), reason: reasonFor(decision || category) };
}

export const OUTPUT_COLUMNS = ["category", "category_confidence", "decision", "decision_confidence", "decided_by", "reason", "needs_review"];
export function outputFields(r) {
  const by = (d) => (!d ? "" : d.by === "you" ? "reviewer" : d.by === "rule" ? "rule" : (d.signals || []).join(" + "));
  return {
    category: r?.category?.label ?? "",
    category_confidence: r?.category ? r.category.confidence.toFixed(2) : "",
    decision: r?.decision?.label ?? "",
    decision_confidence: r?.decision ? r.decision.confidence.toFixed(2) : "",
    decided_by: by(r?.decision || r?.category),
    reason: r?.reason ?? "",
    needs_review: r && !r.skipped ? (r.needsReview ? "yes" : "no") : "",
  };
}

const questionFor = (labels, instructions) => ({ type: "choice", instructions, options: usableLabels(labels).map((l) => ({ name: l.name.trim(), description: l.description || "" })) });

/**
 * Fill `results` in place, reporting progress. engine: { meaning: bool, laya: bool, layaAll: bool }.
 * backend: { embed(texts, onTick), decide(states, question) }.
 */
export async function runPlaybook({ playbook, rows, textCols, engine, backend, results, overrides = {}, threshold = DEFAULT_THRESHOLD, onProgress = () => {}, cancelled = () => false }) {
  const categories = usableLabels(playbook.categories);
  const decisions = usableLabels(playbook.decisions);
  const hasCat = categories.length >= 2;
  const hasDec = decisions.length >= 2;
  const catModel = hasCat ? trainNB(categories) : null;
  const decModel = hasDec ? trainNB(decisions) : null;
  const n = rows.length;
  const texts = rows.map((r) => rowText(r, textCols));
  const pause = () => new Promise((r) => setTimeout(r, 0));
  // Footer rows such as "Total" have nothing to read in the chosen columns: leave them blank, never guess.
  const skip = texts.map((t) => !t.trim());
  const finish = (i, c, d) => (results[i] = skip[i] ? { category: null, decision: null, needsReview: false, reviewed: false, reason: "", skipped: true } : { ...finishRow(rows[i], c, d, playbook, threshold, overrides[i]), _c: c, _d: d });

  for (let i = 0; i < n; i += 400) {
    if (cancelled()) return false;
    const end = Math.min(i + 400, n);
    for (let j = i; j < end; j++) finish(j, skip[j] ? null : hasCat ? classifyRow(catModel, null, texts[j], null, NB_ONLY) : null, !skip[j] && hasDec ? classifyRow(decModel, null, texts[j], null, NB_ONLY) : null);
    onProgress({ stage: "words", done: end, total: n });
    await pause();
  }

  if (engine.meaning) {
    const catSem = hasCat ? await buildSemantic(catModel, categories, (t) => backend.embed(t)) : null;
    const decSem = hasDec ? await buildSemantic(decModel, decisions, (t) => backend.embed(t)) : null;
    for (let i = 0; i < n; i += CHUNK) {
      if (cancelled()) return false;
      const end = Math.min(i + CHUNK, n);
      const vs = await backend.embed(texts.slice(i, end), (d) => onProgress({ stage: "meaning", done: i + Math.min(d, end - i), total: n, silent: true }));
      for (let j = i; j < end; j++) finish(j, skip[j] ? null : hasCat ? classifyRow(catModel, catSem, texts[j], vs[j - i], WEIGHTS) : null, !skip[j] && hasDec ? classifyRow(decModel, decSem, texts[j], vs[j - i], WEIGHTS) : null);
      onProgress({ stage: "meaning", done: end, total: n });
      await pause();
    }
  }

  if (engine.laya) {
    const catQ = hasCat ? questionFor(categories, playbook.categoryQuestion || "Which category does this record belong to?") : null;
    const decQ = hasDec ? questionFor(decisions, playbook.decisionQuestion || "What action should be taken for this record?") : null;
    const unsure = (x) => x && (engine.layaAll || x.confidence < LAYA_UNSURE_BELOW);
    const seen = new Map();
    const todo = (q, key, model) => {
      const idx = [];
      for (let i = 0; i < n; i++) {
        const r = results[i];
        if (r.skipped) continue;
        if (key === "_d" && r.decision?.by === "rule") continue;
        if (unsure(r[key])) idx.push(i);
      }
      return { q, key, model, idx };
    };
    const jobs = [hasCat && todo(catQ, "_c", catModel), hasDec && todo(decQ, "_d", decModel)].filter(Boolean);
    const total = jobs.reduce((a, j) => a + j.idx.length, 0);
    let done = 0;
    for (const job of jobs) {
      const order = job.model.classes.map((c) => c.name);
      const optNames = job.q.options.map((o) => o.name);
      for (let k = 0; k < job.idx.length; k += LAYA_BATCH) {
        if (cancelled()) return false;
        const slice = job.idx.slice(k, k + LAYA_BATCH);
        const need = [...new Set(slice.map((i) => texts[i]))].filter((t) => !seen.has(job.key + t));
        if (need.length) {
          const out = await backend.decide(need, job.q);
          need.forEach((t, x) => seen.set(job.key + t, out[x]));
        }
        for (const i of slice) {
          const p = seen.get(job.key + texts[i]);
          const inOrder = order.map((name) => p[optNames.indexOf(name)]);
          const r = results[i];
          const fused = fuseLaya(r[job.key], inOrder);
          finish(i, job.key === "_c" ? fused : r._c, job.key === "_d" ? fused : r._d);
        }
        done += slice.length;
        onProgress({ stage: "laya", done, total });
        await pause();
      }
    }
  }
  onProgress({ stage: "done", done: n, total: n });
  return true;
}

/** Re-apply reviewer corrections and rules without re-scoring. */
export function refreshRow(i, rows, results, playbook, overrides, threshold = DEFAULT_THRESHOLD) {
  const r = results[i];
  if (r.skipped) return;
  results[i] = { ...finishRow(rows[i], r._c, r._d, playbook, threshold, overrides[i]), _c: r._c, _d: r._d };
}
