"""Explicit offline-capable model experiment; never part of routine DIP capture."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import threading
import time

parser = argparse.ArgumentParser()
parser.add_argument("--protocol", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--cache", required=True)
parser.add_argument("--preflight", action="store_true")
args = parser.parse_args()
protocol = json.loads(Path(args.protocol).read_text(encoding="utf-8"))
cache = str(Path(args.cache).resolve())
os.environ["HF_HOME"] = cache
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["USE_TF"] = "0"
os.environ.pop("HF_TOKEN", None)
os.environ.pop("HUGGING_FACE_HUB_TOKEN", None)

import psutil
import torch
import laya

torch.set_num_threads(protocol["threads"])
torch.set_num_interop_threads(1)
torch.manual_seed(protocol["seed"])
out = {"protocol": protocol, "preflight": args.preflight,
       "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
       "platform": platform.system(), "python": platform.python_version(),
       "packages": {name: importlib.metadata.version(name) for name in
                    ["laya", "torch", "transformers", "huggingface_hub", "numpy", "psutil"]},
       "threads": torch.get_num_threads(), "interopThreads": torch.get_num_interop_threads(),
       "device": "cpu", "availableRamAtStartBytes": psutil.virtual_memory().available,
       "rows": []}
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
mutex = threading.RLock()
def save():
    with mutex:
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, output)
save()
running = True
peak_rss = 0
def sample():
    global peak_rss
    process = psutil.Process()
    low_count = 0
    while running:
        peak_rss = max(peak_rss, process.memory_info().rss)
        low_count = low_count + 1 if psutil.virtual_memory().available < 128 * 2**20 else 0
        if peak_rss > 4 * 2**30 or low_count >= 30:
            out["resourceAbort"] = "4 GiB process RSS cap or sustained <128 MiB host available RAM"
            out["peakRssBytes"] = peak_rss
            save()
            os._exit(3)
        time.sleep(0.1)
sampler = threading.Thread(target=sample, daemon=True)
sampler.start()

try:
    started = time.perf_counter()
    from huggingface_hub import snapshot_download
    prefix = protocol["subfolder"] + "/"
    snapshot = snapshot_download(protocol["modelRepo"], revision=protocol["modelRevision"],
                                 allow_patterns=[prefix + name for name in
                                                 ["rl_agent_config.json", "model.safetensors", "tokenizer/*", "encoder/*"]],
                                 token=False, max_workers=1)
    assert Path(snapshot).name == protocol["modelRevision"]
    # Sequential download avoids the Hub 0.36.2 symlink-probe race on non-admin Windows.
    agent = laya.load(snapshot, subfolder=protocol["subfolder"], device="cpu", backend="eager")
    out["loadSeconds"] = time.perf_counter() - started
    out["loadedRevision"] = agent.revision or Path(snapshot).name
    out["modelConfig"] = agent.cfg
    out["parameterCount"] = sum(p.numel() for p in agent.model.parameters())
    out["dtype"] = str(next(agent.model.parameters()).dtype)
    save()
    # Infrastructure-only readback/warmup; not a scored task-pair example.
    started = time.perf_counter()
    out["warmup"] = agent.predict({"message": "The color is blue."}, {
        "color": {"type": "choice", "instructions": "Which color is stated?",
                  "criteria": {"A": "Blue", "B": "Red"}}},
        max_len=protocol["maxLen"], head_max_len=protocol["headMaxLen"])
    out["warmupSeconds"] = time.perf_counter() - started
    save()
    if not args.preflight:
        for case in protocol["cases"]:
            relation = protocol["relationQuestion"]
            names = list(relation["descriptions"])
            rotation = case["optionRotation"]
            names = names[rotation:] + names[:rotation]
            key_to_relation = dict(zip("ABCD", names))
            identity_names = ["no", "yes"] if case["family"] % 2 else ["yes", "no"]
            key_to_identity = dict(zip("AB", identity_names))
            questions = {
                "relation": {"type": "choice", "instructions": relation["instructions"],
                             "criteria": {k: relation["descriptions"][v] for k, v in key_to_relation.items()}},
                "identity": {"type": "choice", "instructions": protocol["identityQuestion"]["instructions"],
                             "criteria": {k: protocol["identityQuestion"]["descriptions"][v] for k, v in key_to_identity.items()}},
            }
            started = time.perf_counter()
            row = {"id": case["id"], "family": case["family"], "language": case["language"],
                   "optionMap": key_to_relation, "identityMap": key_to_identity}
            try:
                prediction = agent.predict(case["state"], questions,
                                           max_len=protocol["maxLen"], head_max_len=protocol["headMaxLen"])
                row["prediction"] = prediction
                row["relation"] = key_to_relation[prediction["answers"]["relation"]["choice"]]
                row["identity"] = key_to_identity[prediction["answers"]["identity"]["choice"]] == "yes"
            except Exception as error:
                row["error"] = type(error).__name__ + ": " + str(error)
            row["wallSeconds"] = time.perf_counter() - started
            with mutex:
                out["rows"].append(row)
                save()
            print(json.dumps({"id": row["id"], "seconds": round(row["wallSeconds"], 3),
                              "relation": row.get("relation"), "identity": row.get("identity"),
                              "error": row.get("error")}), flush=True)
    out["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
except Exception as error:
    out["infrastructureError"] = type(error).__name__ + ": " + str(error).replace(cache, "<model-cache>")
    save()
    raise
finally:
    running = False
    sampler.join(timeout=1)
    out["peakRssBytes"] = peak_rss
    save()
