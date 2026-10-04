"""Build web/data/relations.json (nerve / blood supply links and key facts) from tools/relations_src.json + muscles.json.

  python tools/build_relations.py

  muscles  {muscle: {"nerves": [...], "arteries": [...]}}   nerves parsed from muscles.json "n" (NERVE_MAP), overridable
  nerves   {nerve: {roots, from, course, sensory, clinical, branches, muscles (derived)}}
  vessels  {vessel: {from, branches, supplies, drains, into, clinical, muscles (derived)}}
  bones    {bone: {type, articulates (made symmetric), features, clinical}}
Every structure name is checked against manifest.json; names not in the model are kept as plain text and listed, so a
typo shows up here instead of as a dead link.
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "data")
src = json.load(io.open(os.path.join(ROOT, "tools", "relations_src.json"), encoding="utf-8"))
muscles = json.load(io.open(os.path.join(DATA, "muscles.json"), encoding="utf-8"))
manifest = json.load(io.open(os.path.join(DATA, "manifest.json"), encoding="utf-8"))
names = {s["name"] for s in manifest["structures"]} | {g["name"] for g in manifest["groups"]}

# muscles.json innervation text -> nerve structures in the model (first match wins per pattern; all patterns are tried)
NERVE_MAP = [
    (r"Accessory n", "Accessory nerve (XI)"), (r"Dorsal scapular n", "Dorsal scapular nerve"),
    (r"Long thoracic n", "Long thoracic nerve"), (r"Medial pectoral n|medial pectoral nn", "Medial pectoral nerve"),
    (r"Lateral (and medial )?pectoral n", "Lateral pectoral nerve"), (r"Axillary n", "Axillary nerve"),
    (r"Suprascapular n", "Suprascapular nerve"), (r"Thoracodorsal n", "Thoracodorsal nerve"),
    (r"Lower subscapular n", "Inferior subscapular nerve"), (r"Musculocutaneous n", "Musculocutaneous nerve"),
    (r"Deep branch of radial n", "Deep branch of radial nerve"), (r"(?<!of )Radial n", "Radial nerve"),
    (r"Posterior interosseous n", "Posterior interosseous nerve of forearm"),
    (r"Anterior interosseous n", "Anterior interosseous nerve of forearm"), (r"Median n", "Median nerve"),
    (r"Ulnar n\., deep branch", "Deep branch of ulnar nerve"), (r"Ulnar n(?!\., deep)", "Ulnar nerve"),
    (r"Femoral n", "Femoral nerve"), (r"Obturator n", "Obturator nerve"), (r"Superior gluteal n", "Superior gluteal nerve"),
    (r"Nerve to piriformis", "Nerve to piriformis muscle"), (r"Nerve to quadratus femoris", "Nerve to quadratus femoris muscle"),
    (r"Tibial n", "Tibial nerve"), (r"Common fibular n", "Common fibular nerve"), (r"Deep fibular n", "Deep fibular nerve"),
    (r"Superficial fibular n", "Superficial fibular nerve"), (r"Medial plantar n", "Medial plantar nerve"),
    (r"Lateral plantar n", "Lateral plantar nerve"), (r"Intercostal nn|Thoracoabdominal nn", "Intercostal nerves"),
    (r"iliohypogastric", "Iliohypogastric nerve"), (r"ilioinguinal", "Ilio-inguinal nerve"), (r"Pudendal n", "Pudendal nerve"),
    (r"Facial n", "Facial nerve (VII)"), (r"Nerve to mylohyoid", "Nerve to mylohyoid muscle"),
    (r"Oculomotor n", "Oculomotor nerve (III)"), (r"Trochlear n", "Trochlear nerve (IV)"), (r"Abducens n", "Abducens nerve (VI)"),
    (r"Hypoglossal n|via hypoglossal", "Hypoglossal nerve (XII)"), (r"Glossopharyngeal n", "Glossopharyngeal nerve (IX)"),
    (r"Recurrent laryngeal n|External laryngeal n|Pharyngeal plexus", "Vagus nerve (X)"),
    (r"Inferior gluteal n", "Inferior gluteal nerve"), (r"Nerve to obturator internus", "Nerve to obturator internus"),
    (r"Phrenic n", "Phrenic nerve"), (r"Subcostal n", "Subcostal nerve"), (r"Ansa cervicalis", "Ansa cervicalis"),
    (r"Suboccipital n", "Suboccipital nerve"), (r"Dorsal rami", "Posterior rami of spinal nerves"),
    (r"Anterior rami|Ventral rami", "Anterior rami of spinal nerves"), (r"Nerve to levator ani", "Nerve to levator ani"),
    (r"Upper and lower subscapular", "Superior subscapular nerve"),
]

warn = []
out = {"muscles": {}, "nerves": {}, "vessels": {}, "bones": {}}


def check(n, where):
    if n not in names:
        warn.append(f"{where}: {n!r} is not in the model (plain text)")
    return n


for m, f in muscles.items():
    if not isinstance(f, dict):
        continue
    nerves = src["muscle_nerves"].get(m)
    if nerves is None:
        nerves = []
        for pat, nerve in NERVE_MAP:
            if re.search(pat, f.get("n", "")) and nerve not in nerves:
                nerves.append(nerve)
    rec = {"nerves": [check(n, f"{m} nerve") for n in nerves]}
    arts = src["muscle_arteries"].get(m)
    if arts is None:
        warn.append(f"{m}: no blood supply listed")
    else:
        rec["arteries"] = [check(a, f"{m} artery") for a in arts]
    out["muscles"][m] = rec
for m, f in muscles.items():  # aliases ("Long head of X" = "X") share their target's supply
    if isinstance(f, str) and f in out["muscles"]:
        out["muscles"][m] = out["muscles"][f]
for m in src["muscle_arteries"]:
    if m not in muscles:
        warn.append(f"muscle_arteries: {m!r} is not a curated muscle in muscles.json")

for kind in ("nerves", "vessels", "bones"):
    for n, facts in src[kind].items():
        check(n, kind)
        rec = dict(facts)
        for k in ("branches", "articulates"):
            for x in rec.get(k, []):
                check(x, f"{n} {k}")
        out[kind][n] = rec

# reverse links: nerve / artery -> muscles it supplies; bone articulations made symmetric
for m, r in out["muscles"].items():
    if isinstance(muscles.get(m), str):
        continue
    for n in r.get("nerves", []):
        out["nerves"].setdefault(n, {}).setdefault("muscles", []).append(m)
    for a in r.get("arteries", []):
        out["vessels"].setdefault(a, {}).setdefault("muscles", []).append(m)
for b, r in list(out["bones"].items()):
    for o in r.get("articulates", []):
        if o != b and o in out["bones"] and b not in out["bones"][o].setdefault("articulates", []):
            out["bones"][o]["articulates"].append(b)
# parent links from "branches": a branch knows where it comes from
for kind in ("nerves", "vessels"):
    for n, r in list(out[kind].items()):
        for b in r.get("branches", []):
            if b in out[kind] and "from" not in out[kind][b]:
                out[kind][b]["from"] = n

# keep only names the model can show for the derived (link-only) entries
out["nerves"] = {k: v for k, v in out["nerves"].items() if k in names or set(v) - {"muscles"}}
out["vessels"] = {k: v for k, v in out["vessels"].items() if k in names or set(v) - {"muscles"}}

path = os.path.join(DATA, "relations.json")
io.open(path, "w", encoding="utf-8", newline="\n").write(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
print(f"wrote {path}: {len(out['muscles'])} muscles, {len(out['nerves'])} nerves, {len(out['vessels'])} vessels, "
      f"{len(out['bones'])} bones, {os.path.getsize(path) // 1024} KB")
unlinked = sorted({w.split(': ', 1)[1] for w in warn if 'not in the model' in w})
print(f"{len(unlinked)} names stay plain text (not modelled):", ", ".join(u.split("'")[1] for u in unlinked))
for w in warn:
    if "not in the model" not in w:
        print("WARN", w)
