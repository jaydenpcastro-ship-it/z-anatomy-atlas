"""Export Startup.blend to web assets: Draco GLB chunks per body system + navigation manifest + descriptions.

  blender -b Startup.blend --python tools/export_web.py -- --out web/public [--only skeletal,joints] [--chunk-polys 600000]

Output (under --out):
  models/<system>[-N].glb      one node per structure; node.extras.zid == the Blender object name (== manifest id)
  data/manifest.json           systems, group tree, structures (with bbox/centre), landmarks (with 3D anchor)
  data/desc/<system>.json      {name: description} loaded lazily by the site
  data/i18n.json               {english name lower-case: {latin, fr, es, ...}} from the file's Translations text
  data/license.txt             BodyParts3D / Z-Anatomy licence text (CC BY-SA, attribution required)
Coordinates are glTF-style: metres, Y up, the body faces +Z.
"""
import bpy, sys, os, json, argparse, collections, time
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zcommon, zclassify

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", default="web/public")
ap.add_argument("--only", default="")
ap.add_argument("--chunk-polys", type=int, default=600000)
ap.add_argument("--draco-level", type=int, default=7)
ap.add_argument("--no-glb", action="store_true", help="only rebuild manifest/descriptions")
args = ap.parse_args(argv)

OUT = os.path.abspath(args.out)
for sub in ("models", "data/desc"):
    os.makedirs(os.path.join(OUT, sub), exist_ok=True)

scene = bpy.context.scene
vl = scene.view_layers[0]
t0 = time.time()


def log(*a):
    print(f"[{time.time() - t0:6.1f}s]", *a, flush=True)


def gl(v):  # blender (x, y, z) z-up, front = -y  ->  glTF y-up, front = +z
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


# ---------------------------------------------------------------- index ----
records = zclassify.build_index(bpy.data.objects, scene.collection)
structures = [r for r in records if r["kind"] == "structure"]
landmarks = [r for r in records if r["kind"] == "landmark"]
top_map = zclassify.top_system_map(scene.collection)
log(f"{len(structures)} structures, {len(landmarks)} landmarks")

# ------------------------------------------------------------- materials ----
geo_objs = [bpy.data.objects[r["id"]] for r in structures]
zcommon.apply_palette(geo_objs)
log("palette applied to", len(geo_objs), "objects")

# ---------------------------------------------------------------- groups ----
groups = {}
for o in bpy.data.objects:
    if o.name.endswith(".g") and o.type == "FONT":
        groups[o.name] = {"id": o.name, "name": o.name[:-2].strip(), "parent": "", "system": top_map.get(o.name, "")}
for gid, g in groups.items():
    p = bpy.data.objects[gid].parent
    while p is not None and not (p.name.endswith(".g") and p.name in groups):
        p = p.parent
    g["parent"] = p.name if p is not None else ""


def nearest_group(o):
    p = o.parent
    while p is not None:
        if p.name in groups:
            return p.name
        p = p.parent
    return ""


# ---------------------------------------------------------- descriptions ----
texts = {t.name: t.as_string().strip() for t in bpy.data.texts}
license_text = texts.get("1.Licence", "")
desc = collections.defaultdict(dict)
for r in structures + landmarks:
    t = texts.get(r["name"])
    if t:
        desc[r["system"] or "reference"][r["name"]] = t
for g in groups.values():
    t = texts.get(g["name"])
    if t:
        desc[g["system"] or "reference"][g["name"]] = t
for sysk, d in desc.items():
    with open(os.path.join(OUT, "data", "desc", f"{sysk}.json"), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(OUT, "data", "license.txt"), "w", encoding="utf-8") as f:
    f.write(license_text)
log("descriptions:", {k: len(v) for k, v in desc.items()})

# ---------------------------------------------------------------- i18n ------
names_needed = {r["name"].lower() for r in structures + landmarks} | {g["name"].lower() for g in groups.values()}
i18n = {}
tr = texts.get("Translations", "").splitlines()
if tr:
    header = [h.strip() for h in tr[0].split(";")]
    keymap = {"English": "en", "Latin": "la", "Français": "fr", "Español": "es", "Portugues": "pt",
              "Nederlands": "nl", "Deutsch": "de", "Polski": "pl"}
    for line in tr[1:]:
        cols = [c.strip() for c in line.split(";")]
        if not cols or not cols[0]:
            continue
        key = cols[0].lower()
        if key in names_needed:
            i18n[key] = {keymap.get(h, h): c for h, c in zip(header[1:], cols[1:]) if c}
with open(os.path.join(OUT, "data", "i18n.json"), "w", encoding="utf-8") as f:
    json.dump(i18n, f, ensure_ascii=False, separators=(",", ":"))
log("translations kept:", len(i18n), "header:", tr[0] if tr else None)

# ----------------------------------------------------- geometry per system --
def world_bounds(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    return lo, hi


def npolys(o):
    return len(o.data.polygons) if o.type == "MESH" else 2000  # curves: rough estimate


by_system = collections.defaultdict(list)
for r in structures:
    by_system[r["system"] or "reference"].append(r)

only = {s for s in args.only.split(",") if s}
gltf_props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())


def export_glb(path, objs):
    for o in bpy.data.objects:
        o.select_set(False) if o.visible_get() else None
    for o in objs:
        for k in list(o.keys()):
            if k != "zid":
                del o[k]
        o["zid"] = o.name
    numbered = {c.name for c in scene.collection.children if c.name[:1].isdigit() or c.name.startswith("Reference lines")}

    def walk(lc):
        yield lc
        for ch in lc.children:
            yield from walk(ch)

    for lc in walk(vl.layer_collection):
        if lc.name in numbered:
            lc.exclude = False
            lc.hide_viewport = False
    skipped = []
    for o in objs:
        try:
            o.hide_viewport = False
            o.hide_select = False
            o.hide_set(False)
            o.select_set(True)
        except RuntimeError as e:  # e.g. template objects that live in no view-layer collection
            skipped.append(o.name)
            log("skipping", o.name, "-", str(e).strip()[:90])
    kw = dict(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_materials="EXPORT", export_image_format="NONE", export_cameras=False, export_lights=False,
        export_animations=False, export_skins=False, export_morph=False, export_texcoords=False,
        export_normals=True, export_attributes=False, export_extras=True, export_hierarchy_flatten_objs=True,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=args.draco_level,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
    )
    dropped = [k for k in kw if k not in gltf_props]
    kw = {k: v for k, v in kw.items() if k in gltf_props}
    if dropped:
        log("gltf exporter has no options:", dropped)
    bpy.ops.export_scene.gltf(**kw)
    for o in objs:
        if o.name not in skipped:
            o.select_set(False)
    return skipped


systems_out = []
chunk_of = {}  # object name -> glb file
for sysk in ("skeletal", "joints", "insertions", "muscular", "fascia", "cardiovascular", "lymphoid", "nervous", "visceral", "regions", "reference"):
    recs = by_system.get(sysk, [])
    if not recs:
        continue
    # pack whole top-level groups into chunks of <= chunk_polys so a chunk maps to one anatomical region
    recs = sorted(recs, key=lambda r: (r["path"][:1], r["name"], r["side"]))
    chunks, cur, cur_polys = [], [], 0
    for r in recs:
        p = npolys(bpy.data.objects[r["id"]])
        if cur and cur_polys + p > args.chunk_polys:
            chunks.append(cur)
            cur, cur_polys = [], 0
        cur.append(r)
        cur_polys += p
    if cur:
        chunks.append(cur)
    files = []
    total_bytes = 0
    for i, chunk in enumerate(chunks):
        fname = f"{sysk}.glb" if len(chunks) == 1 else f"{sysk}-{i + 1}.glb"
        for r in chunk:
            chunk_of[r["id"]] = fname
        if args.no_glb or (only and sysk not in only):
            fpath = os.path.join(OUT, "models", fname)
            size = os.path.getsize(fpath) if os.path.exists(fpath) else 0
        else:
            fpath = os.path.join(OUT, "models", fname)
            skipped = export_glb(fpath, [bpy.data.objects[r["id"]] for r in chunk])
            for name in skipped:
                chunk_of.pop(name, None)
            chunk = [r for r in chunk if r["id"] not in skipped]
            size = os.path.getsize(fpath)
        files.append({"file": fname, "bytes": size, "structures": len(chunk)})
        total_bytes += size
        log(f"{fname}: {len(chunk)} structures, {size / 1e6:.1f} MB")
    systems_out.append({
        "key": sysk, "label": zclassify.SYSTEM_LABEL.get(sysk, sysk), "files": files,
        "structures": len(recs), "polys": sum(npolys(bpy.data.objects[r["id"]]) for r in recs), "bytes": total_bytes,
    })

# ---------------------------------------------------------- manifest --------
def rec_out(r):
    o = bpy.data.objects[r["id"]]
    lo, hi = world_bounds(o)
    # blender (x, y, z) -> glTF (x, z, -y): the y range flips sign, so min/max of glTF z come from hi/lo of blender y
    gmin = [round(lo.x, 4), round(lo.z, 4), round(-hi.y, 4)]
    gmax = [round(hi.x, 4), round(hi.z, 4), round(-lo.y, 4)]
    return {
        "id": r["id"], "name": r["name"], "side": r["side"], "system": r["system"] or "reference",
        "group": nearest_group(o), "tags": r["tags"], "glb": chunk_of.get(r["id"], ""),
        "joint_kind": r["joint_kind"], "joint_type": r["joint_type"], "cartilage": r["cartilage"],
        "c": gl((lo + hi) / 2), "min": gmin, "max": gmax,
    }


def lm_out(r):
    o = bpy.data.objects[r["id"]]
    return {
        "id": r["id"], "name": r["name"], "side": r["side"], "system": r["system"] or "reference",
        "group": nearest_group(o), "target": r["target"], "pos": gl(o.matrix_world.translation),
    }


# world-space positions of Blender objects can be stale in background mode; refresh once
bpy.context.view_layer.update()
manifest = {
    "version": 1,
    "source": "Z-Anatomy (Startup.blend), derived from BodyParts3D, CC BY-SA 2.1 JP - see data/license.txt",
    "coords": "glTF: metres, Y up, body faces +Z",
    "systems": systems_out,
    "groups": [g for g in groups.values() if g["system"]],
    "structures": [rec_out(r) for r in structures if r["id"] in chunk_of],
    "landmarks": [lm_out(r) for r in landmarks if r["target"] in chunk_of],
}
with open(os.path.join(OUT, "data", "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
log("manifest:", len(manifest["structures"]), "structures,", len(manifest["landmarks"]), "landmarks,",
    len(manifest["groups"]), "groups,", os.path.getsize(os.path.join(OUT, "data", "manifest.json")) // 1024, "KB")
print("EXPORT_DONE")
