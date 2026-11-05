// In-browser text classifier: multinomial Naive Bayes over word, word-bigram and
// character-trigram features, plus explicit keyword rules per label.
// Training is a single counting pass, so it re-trains instantly on every edit.

const WORD = /[\p{L}\p{N}_]+(?:[.'-][\p{L}\p{N}_]+)*/gu;

/** Turn text into weighted features. Explanations use the "w:" (word) and "b:" (bigram) ones. */
export function features(text) {
  const out = new Map();
  const add = (k, v = 1) => out.set(k, (out.get(k) || 0) + v);
  const words = String(text ?? "").toLowerCase().match(WORD) || [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // numbers vary (ids, timestamps); keep their shape instead of the value
    const tok = /^\d+$/.test(w) ? (w.length >= 3 ? `#${w.length}` : w) : w;
    add(`w:${tok}`);
    if (i > 0) add(`b:${words[i - 1]} ${tok}`, 0.5);
    if (tok.length >= 4) {
      const g = `^${tok}$`;
      for (let j = 0; j + 3 <= g.length; j++) add(`c:${g.slice(j, j + 3)}`, 0.25);
    }
  }
  return out;
}

/** Keywords from a "rules" field: comma or newline separated, case-insensitive substrings. */
export function parseKeywords(s) {
  return String(s || "")
    .split(/[,\n]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Train from label definitions:
 *   [{ name, description, keywords, examples: string[] }]
 * The description counts as one extra (half-weight) example.
 */
export function train(labels) {
  const usable = labels.filter((l) => l.name.trim() && (l.examples.some((e) => e.trim()) || l.description.trim()));
  const vocab = new Set();
  const classes = usable.map((l) => {
    const counts = new Map();
    let total = 0;
    let docs = 0;
    const absorb = (text, weight) => {
      for (const [k, v] of features(text)) {
        counts.set(k, (counts.get(k) || 0) + v * weight);
        total += v * weight;
        vocab.add(k);
      }
    };
    for (const e of l.examples) if (e.trim()) (absorb(e, 1), docs++);
    if (l.description.trim()) absorb(l.description, 0.5);
    return { name: l.name.trim(), counts, total, docs, keywords: parseKeywords(l.keywords) };
  });
  const allDocs = classes.reduce((a, c) => a + c.docs, 0) || 1;
  for (const c of classes) c.prior = Math.log((c.docs + 1) / (allDocs + classes.length));
  return { classes, vocabSize: vocab.size, examples: allDocs };
}

const ALPHA = 0.5; // smoothing

// Too common to explain anything; still used for scoring.
const STOP = new Set("a an the and or but of to in on at by for with from is are was were be been it its this that i you we my your our as if then so not no".split(" "));

function logLik(c, k, V) {
  return Math.log(((c.counts.get(k) || 0) + ALPHA) / (c.total + ALPHA * V));
}

/**
 * Classify one text. Returns label, confidence (0..1), per-label probabilities,
 * the rule that fired (if any) and the features that pushed it toward the label.
 */
export function classify(model, text, { ruleBoost = 6, sims = null, nbWeight = 1, simWeight = 0 } = {}) {
  const { classes } = model;
  if (!classes.length) return null;
  const V = Math.max(model.vocabSize, 1);
  const feats = features(text);
  const lower = String(text ?? "").toLowerCase();
  const scores = classes.map((c) => {
    let s = c.prior;
    for (const [k, v] of feats) s += v * logLik(c, k, V);
    const hit = c.keywords.find((kw) => lower.includes(kw));
    return { s, hit };
  });
  // Logit per label. The Naive Bayes part is scaled by text length so long rows don't saturate;
  // the optional embedding similarity (cosine, 0..1) is added with its own weight; a keyword rule
  // is a fixed boost on top.
  const n = Math.max(1, Math.sqrt([...feats.values()].reduce((a, b) => a + b, 0)));
  const z = scores.map((x, i) => nbWeight * (x.s / n) + (sims ? simWeight * sims[i] : 0) + (x.hit ? ruleBoost / n : 0));
  const max = Math.max(...z);
  const exps = z.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / sum);
  let best = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;

  // why: features whose likelihood favours the winner over the average other class
  const why = [];
  if (classes.length > 1) {
    for (const [k, v] of feats) {
      if (k.startsWith("c:") || STOP.has(k.slice(2))) continue;
      const mine = logLik(classes[best], k, V);
      let others = 0;
      for (let i = 0; i < classes.length; i++) if (i !== best) others += logLik(classes[i], k, V);
      others /= classes.length - 1;
      const w = v * (mine - others);
      if (Math.abs(w) > 0.05) why.push({ token: k.slice(2), weight: w });
    }
    why.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  }
  return {
    label: classes[best].name,
    confidence: probs[best],
    probs: classes.map((c, i) => ({ label: c.name, p: probs[i] })),
    rule: scores[best].hit || null,
    why: why.slice(0, 8),
  };
}

/** Leave-one-out accuracy on the examples: a quick honesty check of the current state. */
export function selfTest(labels) {
  let total = 0;
  let correct = 0;
  labels.forEach((l, li) => {
    l.examples.forEach((ex, ei) => {
      if (!ex.trim()) return;
      const held = labels.map((m, mi) => (mi === li ? { ...m, examples: m.examples.filter((_, k) => k !== ei) } : m));
      const r = classify(train(held), ex);
      total++;
      if (r && r.label === l.name.trim()) correct++;
    });
  });
  return { total, correct, accuracy: total ? correct / total : null };
}

/** The words that most distinguish each label: what the model "learned". */
export function topFeatures(model, n = 6) {
  const { classes } = model;
  const V = Math.max(model.vocabSize, 1);
  return classes.map((c, ci) => {
    const scored = [];
    for (const k of c.counts.keys()) {
      if (!k.startsWith("w:") || STOP.has(k.slice(2)) || k.length < 4) continue;
      let others = 0;
      for (let i = 0; i < classes.length; i++) if (i !== ci) others += logLik(classes[i], k, V);
      others /= Math.max(1, classes.length - 1);
      scored.push({ token: k.slice(2), weight: logLik(c, k, V) - others });
    }
    scored.sort((a, b) => b.weight - a.weight);
    return { label: c.name, tokens: scored.slice(0, n), keywords: c.keywords };
  });
}
