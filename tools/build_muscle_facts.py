"""Build web/data/muscles.json from tools/muscle_facts.txt and validate it.

  python tools/build_muscle_facts.py

Checks every name against manifest.json (the muscular system) and every joint.movement against web/data/vocab.json,
then lists muscles in the manifest that still have no curated entry (the site falls back to text extraction for those).
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "muscle_facts.txt")
OUT = os.path.join(ROOT, "web", "data", "muscles.json")
NOT_A_MUSCLE = re.compile(r"bursa|retinaculum|sheath|aponeurosis|tendon|fascia|septum|ligament|membrane|arch\b|tract|linea alba|trochlea|tarsus|pulley|ring", re.I)  # keep in sync with app.js

manifest = json.load(io.open(os.path.join(ROOT, "web", "data", "manifest.json"), encoding="utf-8"))
vocab = json.load(io.open(os.path.join(ROOT, "web", "data", "vocab.json"), encoding="utf-8"))
names = {r["name"] for r in manifest["structures"] if r["system"] == "muscular"}
errors, out = [], {}


def split(field):
    return [p.strip() for p in field.split(";") if p.strip()]


for n, raw in enumerate(io.open(SRC, encoding="utf-8"), 1):
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    if " = " in line and "|" not in line:
        a, b = (x.strip() for x in line.split(" = ", 1))
        out[a] = b
        if a not in names:
            errors.append(f"line {n}: alias name not in manifest: {a!r}")
        continue
    parts = [p.strip() for p in line.split("|")]
    if len(parts) != 6:
        errors.append(f"line {n}: expected 6 fields, got {len(parts)}: {line[:60]}")
        continue
    name, o, i, a, nerve, acts = parts
    if name not in names:
        errors.append(f"line {n}: name not in manifest: {name!r}")
    rec = {"o": split(o), "i": split(i), "a": split(a), "n": nerve}
    for act in [x.strip() for x in acts.split(",") if x.strip()]:
        try:
            j, m, role = act.split(".")
        except ValueError:
            errors.append(f"line {n}: bad act {act!r}"); continue
        if j not in vocab["joints"] or m not in vocab["joints"][j]["movements"] or role not in "PA":
            errors.append(f"line {n}: {name}: act {act!r} is not in vocab.json")
            continue
        rec.setdefault("acts", []).append([j, m, role])
    for k in "oia":
        if not rec[k]:
            errors.append(f"line {n}: {name}: empty {k}")
    if name in out:
        errors.append(f"line {n}: duplicate {name!r}")
    out[name] = rec

for a, b in list(out.items()):
    if isinstance(b, str) and b not in out:
        errors.append(f"alias {a!r} -> unknown {b!r}")

missing = sorted(n for n in names if n not in out and not NOT_A_MUSCLE.search(n))
if errors:
    print("\n".join(errors)); sys.exit(1)
io.open(OUT, "w", encoding="utf-8", newline="\n").write(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
full = sum(isinstance(v, dict) for v in out.values())
acts = sum(len(v.get("acts", [])) for v in out.values() if isinstance(v, dict))
print(f"wrote {OUT}: {full} entries + {len(out) - full} aliases, {acts} joint actions, {os.path.getsize(OUT) / 1024:.0f} KB")
print(f"{len(missing)} muscle-like manifest names still without a curated entry:")
print("  " + "\n  ".join(missing))
