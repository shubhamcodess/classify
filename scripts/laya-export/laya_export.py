"""Export a Laya checkpoint to one fused ONNX graph for Transformers.js / open-jev.

Inputs  input_ids [b, s] int64, attention_mask [b, s] int64,
        marker_pos [b, k] int64, marker_mask [b, k] bool, qtype [b] int64
Outputs logits [b, k] float32 (one per option marker; masked slots -1e4),
        act_logits [b, 2] float32 (Laya's act/escalate head)

This is `DecisionModel.forward` from laya.common, unchanged. Upstream's laya-ts
splits it into encoder.onnx + head.onnx; one graph is simpler to serve and
lets the browser keep the hidden states on the GPU.

Verification builds real sequences with laya's own `build_sequence` from
typed-decisions questions and compares ONNX Runtime (CPU) with torch at
several lengths, including past the 128-token sliding window.
"""
import argparse
import json
import os
import shutil
from pathlib import Path

import numpy as np
import torch
from safetensors.torch import load_file
from transformers import AutoTokenizer

from laya.common import QTYPES, build_model, build_sequence

HERE = Path(__file__).parent


class Fused(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
        return self.model(input_ids, attention_mask, marker_pos, marker_mask, qtype)


def load(ckpt: Path):
    cfg = json.loads((ckpt / "rl_agent_config.json").read_text())
    model = build_model(cfg, encoder_dir=str(ckpt / "encoder"), pretrained=False)
    missing, unexpected = model.load_state_dict(load_file(str(ckpt / "model.safetensors")), strict=False)
    real_missing = [k for k in missing if not k.endswith("temperature")]
    assert not real_missing and not unexpected, (real_missing[:5], unexpected[:5])
    model.eval().float()
    tok = AutoTokenizer.from_pretrained(str(ckpt / "tokenizer"))
    return cfg, model, tok


def batch_from(tok, cfg, state, questions, max_len):
    """One row per question, padded, exactly as laya's Agent collates them."""
    rows = []
    for q in questions:
        ids, markers = build_sequence(tok, state, q, max_len=max_len, head_max_len=cfg["head_max_len"])
        rows.append((ids, markers, QTYPES[q["t"]]))
    s = max(len(r[0]) for r in rows)
    k = max(len(r[1]) for r in rows)
    b = len(rows)
    ids = torch.full((b, s), tok.pad_token_id, dtype=torch.long)
    att = torch.zeros((b, s), dtype=torch.long)
    mpos = torch.zeros((b, k), dtype=torch.long)
    mmask = torch.zeros((b, k), dtype=torch.bool)
    for i, (r_ids, r_markers, _) in enumerate(rows):
        ids[i, : len(r_ids)] = torch.tensor(r_ids)
        att[i, : len(r_ids)] = 1
        mpos[i, : len(r_markers)] = torch.tensor(r_markers)
        mmask[i, : len(r_markers)] = True
    qtype = torch.tensor([r[2] for r in rows], dtype=torch.long)
    return ids, att, mpos, mmask, qtype


def internal_questions(raw):
    """typed-decisions question JSON -> laya's internal {t, ins, crit} form."""
    out = []
    for q in raw.values():
        crit = q.get("criteria")
        out.append({"t": q["type"], "ins": q["instructions"], "crit": crit})
    return out


def verification_cases(tok, cfg, max_len):
    rows = json.load(open(HERE / "julia" / "typed-test.json"))
    cases = []
    # A short and a long state from different workflows, plus a synthetic long one.
    by_len = sorted(rows, key=lambda r: len(r["state"]))
    for row in (by_len[0], by_len[len(by_len) // 2], by_len[-1]):
        cases.append((row["state"], internal_questions(json.loads(row["questions"]))))
    long_state = " ".join([by_len[-1]["state"]] * 4)
    cases.append((long_state, internal_questions(json.loads(by_len[-1]["questions"]))))
    return [batch_from(tok, cfg, s, qs, max_len) for s, qs in cases]


def compare(session, model, batches, label):
    worst = 0.0
    for ids, att, mpos, mmask, qtype in batches:
        with torch.inference_mode():
            ref_logits, _ = model(ids, att, mpos, mmask, qtype)
        feeds = {"input_ids": ids.numpy(), "attention_mask": att.numpy(), "marker_pos": mpos.numpy(),
                 "marker_mask": mmask.numpy(), "qtype": qtype.numpy()}
        logits, _ = session.run(None, feeds)
        valid = mmask.numpy()
        diff = float(np.abs(logits[valid] - ref_logits.numpy()[valid]).max())
        same = bool((np.where(valid, logits, -1e9).argmax(-1) == np.where(valid, ref_logits.numpy(), -1e9).argmax(-1)).all())
        worst = max(worst, diff)
        print(f"  {label} seq {ids.shape[1]:5d} rows {ids.shape[0]}: max |dlogit| {diff:.2e} argmax equal {same}")
    return worst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--opset", type=int, default=18)
    args = ap.parse_args()

    cfg, model, tok = load(args.ckpt)
    onnx_dir = args.out / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    fp32 = onnx_dir / "model.onnx"

    ids, att, mpos, mmask, qtype = batch_from(
        tok, cfg, "Hi, we were billed twice for March.",
        [{"t": "choice", "ins": "Which department?", "crit": {"billing": "payments", "technical": "bugs", "other": ""}},
         {"t": "noul", "ins": "Does the user ask for a refund?", "crit": None}],
        cfg["max_len"])
    batch, seq, markers = torch.export.Dim("batch", min=1, max=256), torch.export.Dim("seq", min=8, max=8192), torch.export.Dim("markers", min=2, max=256)
    torch.onnx.export(
        Fused(model).eval(), (ids, att, mpos, mmask, qtype), str(fp32),
        input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
        output_names=["logits", "act_logits"],
        dynamic_shapes=({0: batch, 1: seq}, {0: batch, 1: seq}, {0: batch, 1: markers}, {0: batch, 1: markers}, {0: batch}),
        opset_version=args.opset, external_data=True, dynamo=True,
    )
    import onnxruntime as ort
    session = ort.InferenceSession(str(fp32), providers=["CPUExecutionProvider"])
    batches = verification_cases(tok, cfg, cfg["max_len"])
    worst = compare(session, model, batches, "fp32")
    if cfg["max_len"] < 2048:
        worst = max(worst, compare(session, model, verification_cases(tok, cfg, 2048), "fp32@2048"))
    assert worst < 1e-3, f"fp32 parity failed: {worst}"

    for name in ("tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"):
        src = args.ckpt / "tokenizer" / name
        if src.exists():
            shutil.copy(src, args.out / name)
    shutil.copy(args.ckpt / "rl_agent_config.json", args.out / "rl_agent_config.json")
    print("fp32 ok, worst", worst)


if __name__ == "__main__":
    main()
