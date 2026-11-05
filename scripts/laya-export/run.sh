#!/usr/bin/env bash
# Export laya-typed-decisions to a browser-ready folder (fp16 ONNX, about 847 MB).
set -euo pipefail
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-.venv/bin/python}"
CK="$("$PY" -c 'from huggingface_hub import snapshot_download as s; print(s("convaiinnovations/laya-typed-decisions"))')"
PYTHONPATH="$HERE" "$PY" - "$CK" "$OUT" <<'PY'
import sys, runpy
import laya_export as L, run_cases
L.verification_cases = run_cases.cases
ck, out = sys.argv[1:3]
sys.argv = ["x", "--ckpt", ck, "--out", out]
L.main()
sys.argv = ["laya_fp16.py", ck, out]
runpy.run_path(run_cases.__file__.replace("run_cases.py", "laya_fp16.py"), run_name="__main__")
PY
"$PY" "$HERE/laya_package.py" "$CK" "$OUT" convaiinnovations/laya-typed-decisions
rm -f "$OUT"/onnx/model.onnx "$OUT"/onnx/model.onnx_data; rm -rf "$OUT/conversion"
