"""Fill structures that have no description in Startup.blend with the lead section of their English Wikipedia article.

  python tools/fetch_wiki_descriptions.py            # writes tools/desc_supplement.json (review it, then)
  python tools/postprocess_knowledge.py              # merges it into web/data/desc/*.json

Same source and licence as the scene's own descriptions (Wikipedia, CC BY-SA); every entry ends with its article URL.
An article is accepted only if it is a real article (not a disambiguation page) whose title - after redirects - still
names the same structure: a redirect to a broader article ("Anterior region of arm" -> "Arm") is rejected, because the
text would then describe something else. Rejections are listed so they can be written by hand.
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "data")
OUT = os.path.join(ROOT, "tools", "desc_supplement.json")
API = "https://en.wikipedia.org/w/api.php"
UA = {"User-Agent": "Z-Anatomy-Atlas/1.0 (open educational anatomy atlas; CC BY-SA)"}
STOP = {"of", "the", "and", "to", "in", "for", "with", "a", "an", "on", "muscle", "muscles", "artery", "vein", "nerve",
        "branch", "branches", "node", "nodes", "ligament", "human"}

manifest = json.load(io.open(os.path.join(DATA, "manifest.json"), encoding="utf-8"))
keys = [s["key"] for s in manifest["systems"]]
desc = {k: json.load(io.open(os.path.join(DATA, "desc", f"{k}.json"), encoding="utf-8")) for k in keys}
old = json.load(io.open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}

want = {}  # (system, name) for every structure / group without a description
for s in manifest["structures"]:
    if s["name"] not in desc[s["system"]]:
        want[(s["system"], s["name"])] = 1
for g in manifest["groups"]:
    if g["system"] in desc and g["name"] not in desc[g["system"]]:
        want[(g["system"], g["name"])] = 1
want = [w for w in want if w[1] not in old.get(w[0], {})]


def candidates(name):
    n = name.strip().rstrip("*").strip()
    out = [n]
    if n.startswith("(") and n.endswith(")"):
        out.append(n[1:-1])
    base = re.sub(r"\s*\([^)]*\)\s*$", "", out[-1]).strip()   # "Abducens nerve (VI)" -> "Abducens nerve"
    if base and base not in out:
        out.append(base)
    return out


def tokens(t):
    return {w for w in re.findall(r"[a-z0-9]+", t.lower()) if w not in STOP}


# Reviewed synonyms: the scene's (TA-style) name and the Wikipedia article title name the same structure.
SYNONYMS = {
    ("Anterior interventricular artery", "Left anterior descending artery"),
    ("Left atrioventricular valve", "Mitral valve"), ("Right atrioventricular valve", "Tricuspid valve"),
    ("Inferior transverse scapular ligament", "Inferior transverse ligament of scapula"),
    ("Biventral lobule", "Biventer lobule"), ("Commissural fibres of telencephalon", "Commissural fiber"),
    ("Inferior subscapular nerve", "Lower subscapular nerve"), ("Superior subscapular nerve", "Upper subscapular nerve"),
    ("Posterior femoral cutaneous nerve", "Posterior cutaneous nerve of thigh"),
    ("Tonsil of cerebellum", "Cerebellar tonsil"), ("Zonular fibres", "Zonule of Zinn"),
    ("Auricular tubercle", "Darwin's tubercle"), ("Gluteal fold", "Gluteal sulcus"),
    ("Accessory branch of middle meningeal artery", "Accessory meningeal artery"),
    ("Inferior deep lateral cervical nodes", "Inferior deep cervical lymph nodes"),
    ("Supreme intercostal artery", "Highest intercostal artery"), ("Ganglia", "Ganglion"),
    ("Left superior pulmonary vein", "Pulmonary vein"), ("Left inferior pulmonary vein", "Pulmonary vein"),
    ("Right superior pulmonary vein", "Pulmonary vein"), ("Right inferior pulmonary vein", "Pulmonary vein"),
}
# Titles that match by name but are about something else entirely (e.g. "Perionyx" is a genus of earthworms).
REJECT = {"Perionyx"}
SIDE = {"left", "right"}
SPELL = (("mamill", "mammill"), ("fibre", "fiber"), ("aemia", "emia"), ("oesoph", "esoph"), ("haem", "hem"))


def squash(t):
    t = t.lower()
    for a, b in SPELL:
        t = t.replace(a, b)
    return re.sub(r"[^a-z0-9]", "", t)


def same_topic(cand, title):
    if (cand, title) in SYNONYMS or squash(cand) == squash(title):
        return True
    a, b = tokens(cand) - SIDE, tokens(title)   # "Left testicular vein" is described by "Testicular vein"
    if not a:
        return cand.lower() == title.lower()
    singular = lambda ws: {w[:-1] if w.endswith("s") and len(w) > 3 else w for w in ws}
    a, b = {squash(w) for w in singular(a)}, {squash(w) for w in singular(b)}
    return (a <= b and len(b - a) <= 2) or squash(" ".join(sorted(a))) == squash(" ".join(sorted(b)))


def query(titles):
    q = {"action": "query", "format": "json", "formatversion": "2", "redirects": "1", "prop": "extracts|pageprops",
         "exintro": "1", "explaintext": "1", "ppprop": "disambiguation", "titles": "|".join(titles)}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(q), headers=UA)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # network hiccup / 429 rate limit: honour Retry-After, else back off
            wait = int(getattr(e, "headers", {}).get("Retry-After", 0) or 0) if hasattr(e, "headers") and e.headers else 0
            time.sleep(max(wait, 10 * 2 ** attempt))
            last = e
    raise last


def clean(text):
    text = re.sub(r"\s*\(\s*[;,]?\s*\)", "", text)          # "( )" left where pronunciations were stripped
    text = re.sub(r"\n{2,}", "\n\n", text).strip()
    return text


found, rejected = {}, []
todo = {}
for sysk, name in want:
    for c in candidates(name):
        todo.setdefault(c, []).append((sysk, name))
cands = list(todo)
results = {}
for i in range(0, len(cands), 20):
    batch = cands[i:i + 20]
    d = query(batch)
    norm = {x["from"]: x["to"] for x in d["query"].get("normalized", [])}
    redir = {x["from"]: x["to"] for x in d["query"].get("redirects", [])}
    pages = {p["title"]: p for p in d["query"]["pages"]}
    for c in batch:
        t = norm.get(c, c)
        t = redir.get(t, t)
        p = pages.get(t)
        if not p or p.get("missing") or "disambiguation" in p.get("pageprops", {}) or p["title"] in REJECT:
            continue
        ext = (p.get("extract") or "").strip()
        if len(ext) < 60:
            continue
        results[c] = (p["title"], ext)
    time.sleep(2)
    print(f"  {min(i + 20, len(cands))}/{len(cands)} candidate titles queried", flush=True)

for sysk, name in want:
    got = None
    for c in candidates(name):
        if c in results:
            title, ext = results[c]
            if same_topic(c, title):
                got = (title, ext)
                break
            rejected.append(f"{sysk}: {name!r} -> broader article {title!r}")
    if got:
        title, ext = got
        url = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
        found.setdefault(sysk, {})[name] = f"{name.upper()}\n\n\n{clean(ext)}\n\n\n\n{url}"
    else:
        rejected.append(f"{sysk}: {name!r} -> no matching article")

merged = old
for sysk, d in found.items():
    merged.setdefault(sysk, {}).update(d)
io.open(OUT, "w", encoding="utf-8", newline="\n").write(json.dumps(merged, ensure_ascii=False, indent=1, sort_keys=True))
print(f"wanted {len(want)}, found {sum(len(v) for v in found.values())}, total in supplement {sum(len(v) for v in merged.values())}")
print("still missing / rejected:")
print("  " + "\n  ".join(sorted(rejected)))
