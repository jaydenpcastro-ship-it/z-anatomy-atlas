"""Classification of Z-Anatomy objects, shared by the Blender Anatomy Navigator (__init__.py)
and the web-export tools (tools/).

Nothing here guesses from free text in collection names: every object sits in many
collections (a muscle is also linked into its "...nerve" supply collection), so substring
matching gives wrong systems. Instead we use two authoritative sources in the scene:

  * the numbered top-level collections ("1: Skeletal system" ... "9: Regions of human body")
  * the `.g` group objects, which form the anatomical hierarchy through `object.parent`
    (e.g. Lungs.g < Respiratory system.g < Visceral systems.g)

Object naming conventions in Startup.blend:
  Name.l / Name.r        sided structure (geometry)          Name            midline structure (geometry)
  Name.ol/.or/.el/.er... muscle origin / end (insertion geometry)
  Name.g                 group heading (a FONT object, gives the hierarchy)
  Name.t / Name.s        label text of a landmark
  Name.j / Name.i        0-poly pin anchor of a landmark, parented to its label
"""
import re

LABEL_SUFFIXES = (".g", ".s", ".t", ".i", ".j")

TOP_SYSTEM = {  # leading digit of the numbered top-level collection -> system key
    "1": "skeletal", "2": "insertions", "3": "joints", "4": "muscular", "5": "cardiovascular",
    "6": "lymphoid", "7": "nervous", "8": "visceral", "9": "regions",
}
SYSTEM_LABEL = {
    "skeletal": "Skeletal system", "insertions": "Muscular insertions", "joints": "Joints",
    "muscular": "Muscular system", "cardiovascular": "Cardiovascular system", "lymphoid": "Lymphoid organs",
    "nervous": "Nervous system & sense organs", "visceral": "Visceral systems", "regions": "Regions of human body",
    "reference": "Reference lines, planes & movements",
    "fascia": "Fascia & body envelope",
}

_SIDE_RE = re.compile(r"\.(l|r|ol|or|el|er|[oe]\d+[lr])$")
_ANY_SUFFIX_RE = re.compile(r"\.(l|r|ol|or|el|er|[oe]\d+[lr]|g|s|t|i|j|st)$")

# sub-system tags taken from the group hierarchy: tag -> group names (without ".g") that mark it
GROUP_TAGS = {
    "CNS": {"Central nervous system"},
    "PNS": {"Peripheral nervous system"},
    "SENSE": {"Sense organs"},
    "RESPIRATORY": {"Respiratory system"},
    "DIGESTIVE": {"Digestive system"},
    "URINARY": {"Urinary system"},
    "REPRODUCTIVE": {"Genital systems", "Male genital system", "Female genital system"},
    "ENDOCRINE": {"Endocrine glands"},
    "INTEGUMENTARY": {"Hairs", "Skin"},
}
SYSTEM_TAGS = {  # top-level system key -> tags it always carries
    "skeletal": {"SKELETAL"}, "insertions": {"MUSCULAR"}, "muscular": {"MUSCULAR"}, "joints": {"JOINTS"},
    "cardiovascular": {"CARDIOVASCULAR"}, "lymphoid": {"LYMPHOID"}, "nervous": {"NERVOUS"},
    "visceral": {"VISCERAL"}, "regions": {"REGIONS"}, "reference": {"REFERENCE"},
    "fascia": {"MUSCULAR", "FASCIA"},
}

# joint kind (from the hierarchy) and joint type (curated: the scene's own type groups are empty)
JOINT_KIND_WORDS = (("SYNOVIAL", "synovial"), ("FIBROUS", "fibrous"), ("FIBROUS", "suture"), ("FIBROUS", "syndesmo"),
                    ("CARTILAGINOUS", "cartilaginous"), ("CARTILAGINOUS", "symphysis"), ("CARTILAGINOUS", "synchondros"))
JOINT_TYPE_RULES = (  # first match wins; matched against the lower-cased structure name + path
    ("BALL_AND_SOCKET", ("hip joint", "glenohumeral", "shoulder joint")),
    ("HINGE", ("knee joint", "elbow", "humero-ulnar", "humeroulnar", "ankle joint", "talocrural", "interphalangeal")),
    ("PIVOT", ("atlanto-axial", "atlantoaxial", "radio-ulnar", "radioulnar", "median atlanto")),
    ("SADDLE", ("sternoclavicular", "carpometacarpal joint of thumb", "first carpometacarpal", "carpometacarpal joint of first")),
    ("CONDYLOID", ("radiocarpal", "wrist joint", "metacarpophalangeal", "metatarsophalangeal", "atlanto-occipital", "temporomandibular")),
    ("PLANE", ("acromioclavicular", "intercarpal", "intertarsal", "zygapophysial", "costotransverse", "subtalar",
               "talocalcaneo", "tarsometatarsal", "sacro-iliac", "sacroiliac", "carpometacarpal", "costovertebral", "plane joint")),
)

ELASTIC_WORDS = ("epiglott", "auricular cartilage", "corniculate", "cuneiform cartilage", "elastic")
FIBRO_WORDS = ("menisc", "intervertebral disc", "labrum", "articular disc", "interpubic", "fibrocartilage",
               "annulus fibrosus", "nucleus pulposus", "pubic symphysis")


def is_label(o):
    return o.name.endswith(LABEL_SUFFIXES)


def is_geometry(o):
    """Real anatomy geometry (meshes with faces, curves with bevel/extrude); False for labels, pins and helpers."""
    if o.type not in {"MESH", "CURVE"} or is_label(o):
        return False
    if o.type == "MESH":
        return len(o.data.polygons) > 0
    d = o.data
    return d.bevel_depth > 0 or d.bevel_object is not None or d.extrude > 0


def split_name(name):
    """-> (display name, suffix). '(Adductor minimus).l' -> ('(Adductor minimus)', '.l')."""
    m = _ANY_SUFFIX_RE.search(name)
    if m:
        return name[:m.start()].strip(), m.group(0)
    return name.strip(), ""


def side_of(suffix):
    if suffix in {".l", ".ol", ".el"} or re.fullmatch(r"\.[oe]\d+l", suffix):
        return "l"
    if suffix in {".r", ".or", ".er"} or re.fullmatch(r"\.[oe]\d+r", suffix):
        return "r"
    return ""


def top_system_map(scene_collection):
    """object name -> system key, from the numbered top-level collections. One pass over ~10 collections;
    much faster than asking every object for `users_collection` (which scans all ~1900 collections each time)."""
    out = {}
    for c in scene_collection.children:
        if c.name[:1].isdigit() and c.name[1:2] == ":":
            key = TOP_SYSTEM.get(c.name[0])
        elif c.name.startswith("Reference lines"):
            key = "reference"  # movement arrows, reference planes and lines
        else:
            continue
        for o in c.all_objects:
            out.setdefault(o.name, key)
    return out


def top_system(o):
    """System key from the numbered top-level collection the object is linked into (slow path)."""
    for c in o.users_collection:
        if c.name[:1].isdigit() and c.name[1:2] == ":":
            return TOP_SYSTEM.get(c.name[0])
    return None


def group_path(o):
    """Names of the `.g` ancestors, root first (excluding the system root group itself)."""
    path, p = [], o.parent
    while p is not None:
        if p.name.endswith(".g"):
            path.append(p.name[:-2].strip())
        p = p.parent
    path.reverse()
    return path


def _has(text, words):
    return any(w in text for w in words)


def classify(o, top_map=None):
    """Return a record dict for a geometry or landmark object, or None for objects that aren't navigable."""
    display, suffix = split_name(o.name)
    if is_geometry(o):
        kind, target = "structure", o
    elif o.type == "MESH" and suffix in {".i", ".j"}:
        kind = "landmark"
        target = o
        p = o.parent
        while p is not None and not is_geometry(p):
            p = p.parent
        target = p if p is not None else o  # frame the structure the pin sits on
    else:
        return None
    if top_map is not None:
        system = top_map.get(o.name) or top_map.get(target.name)
    else:
        system = top_system(o) or top_system(target)
    # fascia / body-envelope shells are filed under the muscular system but wrap the whole body and hide everything
    # beneath them, so they become their own toggleable layer
    first_mat = next((s.material.name for s in target.material_slots if s.material), "")
    if system == "muscular" and first_mat == "Fascia":
        system = "fascia"
    path = group_path(o)
    text = " ".join(path + [display]).lower()
    tags = set(SYSTEM_TAGS.get(system, ()))
    for tag, names in GROUP_TAGS.items():
        if any(p in names for p in path):
            tags.add(tag)
    joint_kind = joint_type = ""
    if system == "joints" or "JOINTS" in tags:
        for k, w in JOINT_KIND_WORDS:
            if w in text:
                joint_kind = k
                break
        for t, words in JOINT_TYPE_RULES:
            if _has(text, words):
                joint_type = t
                break
    cartilage = ""
    # bones often carry a small "Cartilage" patch for their articular surface; only count objects that ARE cartilage
    lower = display.lower()
    if first_mat == "Cartilage" or "cartilage" in lower or _has(lower, FIBRO_WORDS):
        if _has(lower, ELASTIC_WORDS):
            cartilage = "ELASTIC"
        elif _has(lower, FIBRO_WORDS) or "fibrocartilage" in text:
            cartilage = "FIBROCARTILAGE"
        else:
            cartilage = "HYALINE"
    return {
        "id": o.name,
        "target": target.name,
        "name": display,
        "kind": kind,
        "side": side_of(suffix),
        "system": system or "",
        "path": path,
        "tags": sorted(tags),
        "joint_kind": joint_kind,
        "joint_type": joint_type,
        "cartilage": cartilage,
        "search": (display + " " + " ".join(path) + " " + SYSTEM_LABEL.get(system, "")).lower(),
    }


def build_index(objects, scene_collection=None):
    """List of records for every navigable object in `objects`.

    Pass `scene.collection` for a fast system lookup. Landmarks are de-duplicated: every landmark has a `.s/.i`
    and a `.t/.j` label pair, which would otherwise show up twice."""
    top_map = top_system_map(scene_collection) if scene_collection is not None else None
    out, seen = [], set()
    for o in objects:
        rec = classify(o, top_map)
        if rec is None or not rec["system"]:  # no system = template/instruction objects such as "HOW TO ..."
            continue
        if rec["kind"] == "landmark":
            key = (rec["name"], rec["side"], rec["target"])
            if key in seen:
                continue
            seen.add(key)
        out.append(rec)
    return out


def rank(rec, query):
    """0 = exact name match, 1 = name starts with the query, 2 = the query is inside the name, 3 = only in the path."""
    if not query:
        return 0
    n = rec["name"].lower()
    if n == query:
        return 0
    if n.startswith(query):
        return 1
    return 2 if query in n else 3


def matches(rec, query="", tag="ALL", joint_kind="ALL", joint_type="ALL", cartilage="ALL", kinds=("structure", "landmark")):
    if rec["kind"] not in kinds:
        return False
    if query and query not in rec["search"]:
        return False
    if tag != "ALL" and tag not in rec["tags"]:
        return False
    if joint_kind != "ALL" and rec["joint_kind"] != joint_kind:
        return False
    if joint_type != "ALL" and rec["joint_type"] != joint_type:
        return False
    if cartilage != "ALL" and rec["cartilage"] != cartilage:
        return False
    return True
