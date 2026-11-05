"""Turn an exported Laya folder into the onnx-community layout:
onnx/model{,_fp16}.onnx + .onnx_data, config.json (encoder config + "laya"
section + transformers.js_config), tokenizer files, conversion/ scripts."""
import json
import shutil
import sys
from pathlib import Path

import onnx

HERE = Path(__file__).parent
ckpt, folder, source_repo = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]

for stem in ("model", "model_fp16"):
    path = folder / "onnx" / f"{stem}.onnx"
    if (folder / "onnx" / f"{stem}.onnx_data").exists():
        continue
    model = onnx.load(str(path))
    onnx.save(model, str(path), save_as_external_data=True, all_tensors_to_one_file=True,
              location=f"{stem}.onnx_data", size_threshold=1024)
    old = folder / "onnx" / f"{stem}.onnx.data"
    if old.exists():
        old.unlink()
    assert onnx.load(str(path), load_external_data=False)  # references resolve
    print("rewrote", path.name)

agent = json.loads((ckpt / "rl_agent_config.json").read_text())
encoder = json.loads((ckpt / "encoder" / "config.json").read_text())
multilingual = "mmBERT" in agent["encoder"]
config = {
    **{k: v for k, v in encoder.items() if not k.startswith("_")},
    "laya": {
        "description": "Laya decision model: one sequence per question, "
                       "[CLS] {type} question: {question} [SEP] [MASK] opt … [SEP] state [SEP]; "
                       "one logit per [MASK] marker.",
        "source": source_repo,
        "encoder": agent["encoder"],
        "max_len": agent["max_len"],
        "head_max_len": agent["head_max_len"],
        "max_option_tokens": 48,
        "qtypes": {"choice": 0, "score": 1, "noul": 2},
        "temperature": agent["temperature"],
        "temperature_by_options": agent.get("temperature_by_options", {}),
        "temperature_clamp": [0.5, 5.0],
        # mmBERT's Metaspace tokenizer: Transformers.js merges runs of spaces
        # differently from Rust tokenizers; encode one word at a time.
        "split_words": multilingual,
        "inputs": "input_ids, attention_mask, marker_pos, marker_mask (bool), qtype",
        "outputs": "logits (batch, markers; masked slots -1e4), act_logits (batch, 2)",
    },
    "transformers.js_config": {
        "use_external_data_format": {"model.onnx": 1, "model_fp16.onnx": 1},
        "dtype": "fp16",
    },
}
(folder / "config.json").write_text(json.dumps(config, indent=2) + "\n")
if (folder / "rl_agent_config.json").exists():
    (folder / "rl_agent_config.json").unlink()

conv = folder / "conversion"
conv.mkdir(exist_ok=True)
for name in ("laya_export.py", "laya_fp16.py", "laya_package.py", "run_cases.py"):
    shutil.copy(HERE / name, conv / name)
print("packaged", folder)
