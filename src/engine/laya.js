// Laya: an open decision model (Convai Innovations, Apache-2.0). It reads text and answers a typed
// question (pick one option, rate on a scale, yes/no) in one forward pass, with no text generation.
// This is a port of `build_sequence` from github.com/NandhaKishorM/laya, following the Transformers.js
// implementation in github.com/shreyaskarnik/open-jev (MIT). Each question is its own sequence:
//   [CLS] {type} question: {instructions} [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] {state} [SEP]
// and the graph returns one logit per [MASK].
import { softmax } from "./math.js";

const QTYPE = { choice: 0, score: 1, noul: 2 };
const MAX_OPTION_TOKENS = 48;

export function optionTexts(q) {
  if (q.type === "noul") return ["false: no, the statement does not hold", "true: yes, the statement holds"];
  if (q.type === "score") return q.options.map((o, i) => `level ${i}: ${o.name}`);
  return q.options.map((o) => (o.description ? `${o.name}: ${o.description}` : o.name));
}

const NAMES = ["choice", "score", "noul"];
const bucket = (qtype, k) => `${NAMES[qtype]}:${k <= 2 ? "2" : k <= 5 ? "3-5" : k <= 10 ? "6-10" : "11+"}`;
const clampT = (t) => Math.min(5, Math.max(0.5, Number.isFinite(t) ? t : 1));

export function createLaya({ tokenizer, model, section, Tensor, tokens = {} }) {
  const headMax = section.head_max_len ?? 256;
  const maxLen = section.max_len ?? 1024;
  const raw = (text) => Array.from(tokenizer(text, { add_special_tokens: false }).input_ids.data, Number);
  const maskText = tokens.mask ?? "[MASK]";
  const single = (t) => raw(t)[0];
  const sp = { cls: single(tokens.cls ?? "[CLS]"), sep: single(tokens.sep ?? "[SEP]"), mask: single(maskText), pad: single(tokens.pad ?? "[PAD]"), space: raw(" ")[0] };
  const temperature = (qtype, k) => clampT(section.temperature_by_options?.[bucket(qtype, k)] ?? section.temperature?.[qtype] ?? 1);

  // The multilingual tokenizer (Metaspace) needs one word at a time to match the reference; ModernBERT does not.
  const wordCache = new Map();
  const encode = (input) => {
    const text = String(input).split(maskText).join(" ");
    if (!text) return [];
    if (!section.split_words) return raw(text);
    const spaced = text.startsWith(" ") ? text : ` ${text}`;
    const ids = [];
    for (const piece of spaced.split(/(?= )/)) {
      const word = piece.slice(1);
      if (!word) {
        ids.push(sp.space);
        continue;
      }
      let w = wordCache.get(word);
      if (!w) {
        w = raw(word);
        if (wordCache.size > 200000) wordCache.clear();
        wordCache.set(word, w);
      }
      for (const id of w) ids.push(id);
    }
    return ids;
  };

  const headCache = new Map();
  function head(q) {
    const key = JSON.stringify(q);
    let h = headCache.get(key);
    if (h) return h;
    let options = optionTexts(q).map((t) => [sp.mask, ...encode(` ${t}`).slice(0, MAX_OPTION_TOKENS)]);
    const size = () => options.reduce((a, o) => a + o.length, 0);
    let budget = headMax - size();
    if (budget < 16) {
      const per = Math.max(4, Math.floor((headMax - 16) / options.length));
      options = options.map((o) => o.slice(0, per));
      budget = headMax - size();
    }
    const ins = encode(`${q.type} question: ${q.instructions}`).slice(0, Math.max(8, budget));
    const ids = [sp.cls, ...ins, sp.sep];
    const markers = [];
    for (const o of options) {
      markers.push(ids.length);
      ids.push(...o);
    }
    ids.push(sp.sep);
    h = { ids, markers };
    headCache.set(key, h);
    return h;
  }

  /** Answer one question for many states at once. Returns a probability array per state. */
  async function decideBatch(states, q) {
    const h = head(q);
    const room = Math.max(0, maxLen - h.ids.length - 1);
    const seqs = states.map((s) => [...h.ids, ...encode(s).slice(0, room), sp.sep]);
    const b = seqs.length;
    const len = Math.max(...seqs.map((x) => x.length));
    const k = h.markers.length;
    const ids = new BigInt64Array(b * len).fill(BigInt(sp.pad));
    const att = new BigInt64Array(b * len);
    const pos = new BigInt64Array(b * k);
    const mm = new Uint8Array(b * k).fill(1);
    const qt = new BigInt64Array(b).fill(BigInt(QTYPE[q.type]));
    seqs.forEach((seq, r) => {
      seq.forEach((id, c) => {
        ids[r * len + c] = BigInt(id);
        att[r * len + c] = 1n;
      });
      h.markers.forEach((m, c) => (pos[r * k + c] = BigInt(m)));
    });
    const { logits } = await model({
      input_ids: new Tensor("int64", ids, [b, len]),
      attention_mask: new Tensor("int64", att, [b, len]),
      marker_pos: new Tensor("int64", pos, [b, k]),
      marker_mask: new Tensor("bool", mm, [b, k]),
      qtype: new Tensor("int64", qt, [b]),
    });
    const vals = Array.from(logits.data, Number);
    const width = logits.dims[1];
    const t = temperature(QTYPE[q.type], k);
    return states.map((_, r) => softmax(vals.slice(r * width, r * width + k).map((v) => v / t)));
  }
  return { decideBatch };
}
