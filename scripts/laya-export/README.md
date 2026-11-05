# Publishing Laya for the browser

The app's Thorough engine needs `convaiinnovations/laya-typed-decisions` as ONNX, which nobody publishes yet. These scripts come from `onnx-community/laya-multilingual-ONNX` (conversion by @shreyask); `run.sh` adds verification cases, because the original test file is not published.

```bash
python3 -m venv .venv && .venv/bin/pip install laya onnx onnxruntime onnxscript onnxconverter-common huggingface_hub
bash scripts/laya-export/run.sh out/laya-typed-decisions-ONNX
.venv/bin/hf auth login
.venv/bin/hf upload shubhamcodess/laya-typed-decisions-ONNX out/laya-typed-decisions-ONNX .
```

The app downloads from `shubhamcodess/laya-typed-decisions-ONNX` by default. To use another repo, set `VITE_LAYA_REPO` at build time. To test without uploading, copy the folder to `public/models/laya-typed-decisions-ONNX` and set `VITE_LAYA_LOCAL=/models/` and `VITE_LAYA_REPO=laya-typed-decisions-ONNX` in `.env.local`.

Checked on export: fp32 logits match PyTorch within 7e-6, and fp16 probabilities within 4e-4 with the same top answer. The model is Apache-2.0 by Convai Innovations; keep that credit on the Hugging Face page.
