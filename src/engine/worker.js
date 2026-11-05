// All model inference runs here, so a big file never freezes the page.
import { createRuntime } from "./models.js";

const rt = createRuntime((name, patch) => postMessage({ type: "status", name, patch }));

onmessage = async ({ data: { id, op, args } }) => {
  try {
    let result;
    if (op === "embed") {
      result = await rt.embed(args.texts, args.batch, (done, total) => postMessage({ type: "tick", id, done, total }));
    } else result = await rt[op](...(args || []));
    postMessage({ type: "done", id, result });
  } catch (e) {
    postMessage({ type: "fail", id, error: e?.message || String(e) });
  }
};
