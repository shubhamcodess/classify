"""fp16 variant of an exported Laya graph (fp32 inputs/outputs kept), checked
against the fp32 graph on the same typed-decisions batches."""
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxconverter_common import float16

sys.path.insert(0, str(Path(__file__).parent))
from laya_export import load, verification_cases  # noqa: E402

ckpt, out = Path(sys.argv[1]), Path(sys.argv[2])
src = out / "onnx" / "model.onnx"
dst = out / "onnx" / "model_fp16.onnx"

model = onnx.load(str(src))
# Keep numerically touchy ops in fp32: softmax/log/exp feed the act head, and
# the logits are compared across options, so the final scorer stays fp16 but
# reductions that span the sequence do not overflow.
fp16 = float16.convert_float_to_float16(model, keep_io_types=True, disable_shape_infer=True,
                                        op_block_list=["Softmax", "Log", "Exp", "ReduceSum", "ReduceMean", "Pow", "Sqrt", "Erf", "TopK"])
# The model's own `.float()` calls export as Cast(to=FLOAT); the converter retypes
# their outputs to fp16 but leaves the cast, so align the cast with its output.
fp16_outputs = {vi.name for vi in fp16.graph.value_info
                if vi.type.tensor_type.elem_type == onnx.TensorProto.FLOAT16}
fixed = 0
for node in fp16.graph.node:
    if node.op_type == "Cast" and node.output[0] in fp16_outputs:
        for attr in node.attribute:
            if attr.name == "to" and attr.i == onnx.TensorProto.FLOAT:
                attr.i = onnx.TensorProto.FLOAT16
                fixed += 1
print("retyped casts:", fixed)
onnx.save(fp16, str(dst), save_as_external_data=True, all_tensors_to_one_file=True,
          location="model_fp16.onnx.data", size_threshold=1024)

cfg, _, tok = load(ckpt)
a = ort.InferenceSession(str(src), providers=["CPUExecutionProvider"])
b = ort.InferenceSession(str(dst), providers=["CPUExecutionProvider"])
for max_len in (cfg["max_len"], 2048):
    for ids, att, mpos, mmask, qtype in verification_cases(tok, cfg, max_len):
        feeds = {"input_ids": ids.numpy(), "attention_mask": att.numpy(), "marker_pos": mpos.numpy(),
                 "marker_mask": mmask.numpy(), "qtype": qtype.numpy()}
        la, _ = a.run(None, feeds)
        lb, _ = b.run(None, feeds)
        valid = mmask.numpy()
        pa = np.where(valid, la, -1e9)
        pb = np.where(valid, lb, -1e9)
        sm = lambda z: np.exp(z - z.max(-1, keepdims=True)) / np.exp(z - z.max(-1, keepdims=True)).sum(-1, keepdims=True)
        print(f"  fp16 seq {ids.shape[1]:5d}: max |dlogit| {np.abs(la[valid] - lb[valid]).max():.3e} "
              f"max |dprob| {np.abs(sm(pa) - sm(pb)).max():.3e} argmax equal {bool((pa.argmax(-1) == pb.argmax(-1)).all())}")
