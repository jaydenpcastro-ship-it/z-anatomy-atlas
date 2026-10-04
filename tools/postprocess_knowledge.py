"""Clean and complete the exported descriptions (web/data/desc/*.json). Runs at the end of tools/export_web.py and can be
run on its own (plain Python, no Blender):

  python tools/postprocess_knowledge.py [--out web]

  1. cleans artefacts left in the scene's Wikipedia-derived text: citation marks "[1]", stray template code "((cn}}",
     empty pronunciation brackets "()" and accidental doubled words ("the the")
  2. adds descriptions for structures the scene has none for, never overriding the scene's own text:
       tools/desc_supplement.json   lead sections of matching Wikipedia articles (tools/fetch_wiki_descriptions.py)
       tools/desc_handwritten.json  short textbook definitions written for the atlas
Idempotent.
"""
import io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOUBLED = re.compile(r"\b(the|to|a|of|and|in|is|Latin)\s+\1\b")
NOTE = "Z-Anatomy Atlas note (written for this atlas from standard anatomy references)"


def clean(t):
    t = re.sub(r"\[\d+\]", "", t)
    t = re.sub(r"\(\(cn\}\}", "", t)
    t = re.sub(r"\s*\(\s*(?:[;,]\s*)*\)", "", t)
    t = re.sub(r"\(\s*[;,]\s*", "(", t)                 # "(; also called ..." where a pronunciation was cut
    t = DOUBLED.sub(r"\1", t)
    return t


def load(path):
    return json.load(io.open(path, encoding="utf-8")) if os.path.exists(path) else {}


def main(out):
    ddir = os.path.join(out, "data", "desc")
    manifest = load(os.path.join(out, "data", "manifest.json"))
    known = {}  # system -> names the site can show (structures, groups, landmarks)
    for k in ("structures", "groups", "landmarks"):
        for r in manifest.get(k, []):
            known.setdefault(r["system"], set()).add(r["name"])
    wiki, hand = load(os.path.join(HERE, "desc_supplement.json")), load(os.path.join(HERE, "desc_handwritten.json"))
    stats = {"cleaned": 0, "wiki": 0, "handwritten": 0}
    for fn in sorted(os.listdir(ddir)):
        if not fn.endswith(".json"):
            continue
        sysk = fn[:-5]
        path = os.path.join(ddir, fn)
        d = load(path)
        for n, t in list(d.items()):
            c = clean(t)
            if c != t:
                d[n] = c
                stats["cleaned"] += 1
        for src, key, fmt in ((wiki, "wiki", None), (hand, "handwritten", NOTE)):
            for n, t in src.get(sysk, {}).items():
                if n in d or n not in known.get(sysk, ()):
                    continue
                d[n] = t if fmt is None else f"{n.upper()}\n\n\n{t}\n\n\n\n{fmt}"
                stats[key] += 1
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    print("postprocess_knowledge:", stats)
    return stats


if __name__ == "__main__":
    a = sys.argv[1:]
    main(os.path.abspath(a[a.index("--out") + 1] if "--out" in a else os.path.join(os.path.dirname(HERE), "web")))
