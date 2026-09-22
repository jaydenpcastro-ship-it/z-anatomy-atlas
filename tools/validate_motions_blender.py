"""Blender-side cross-check of web/data/motions.json, independent of the three.js runtime.

Poses a handful of representative joints at their end range directly in Blender (same scene, same bone meshes
the bake was fitted from) using nothing but the baked pivot/axis/sign, renders each, and writes the pose angle
into the filename so a human can confirm flexion closes the joint the right way, nothing interpenetrates, etc.
This is a sanity check on the DATA (does the baked geometry make an anatomically correct pose?), separate from
the three.js runtime test suite (does the web app reproduce that pose correctly?) in tools/browser/t_motion*.mjs.

  blender -b Startup.blend --python tools/validate_motions_blender.py -- [--out _shots/motion/blender] [--only elbow.flexion]
"""
import bpy, sys, os, json, math, argparse
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zcommon

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_shots", "motion", "blender"))
ap.add_argument("--only", default="")
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MO = json.load(open(os.path.join(ROOT, "web", "data", "motions.json"), encoding="utf-8"))

# a representative, single-site (non-spine) case per region: (joint, movement, side, end-of-range fraction u)
CASES = [
    ("glenohumeral", "abduction", "l", 1.0), ("glenohumeral", "extension", "l", 1.0),
    ("elbow", "flexion", "l", 1.0), ("radioulnar", "pronation", "l", 1.0),
    ("wrist", "flexion", "l", 1.0), ("hip", "flexion", "l", 1.0), ("hip", "abduction", "l", 1.0),
    ("knee", "flexion", "l", 1.0), ("ankle", "dorsiflexion", "l", 1.0), ("subtalar", "inversion", "l", 1.0),
    ("atlanto-axial", "rotation", "l", 1.0), ("temporomandibular", "depression", "l", 1.0),
]
only = {tuple(x.split(".")) for x in args.only.split(",") if x}

# web (x,y,z) -> Blender (x,y,z): the exporter used blender(x,y,z) -> web(x, z, -y); invert it.
def to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def to_blender_dir(v):
    return Vector((v[0], -v[2], v[1])).normalized()


# ---- scene: skeletal only, palette materials, flat studio background ----
scene = bpy.context.scene
vl = scene.view_layers[0]
objs = zcommon.system_geometry(scene, "skeletal")
wanted = set(objs)
# visibility for render needs three things set together (this mirrors tools/render_views.py's set_visible):
# per-object hide_render, the containing collections' hide_render, and the view layer's own exclude flag (the
# scene ships with most top-level system collections excluded from the view layer to keep the editor light).
def walk(c):
    yield c
    for ch in c.children:
        yield from walk(ch)
for c in scene.collection.children:
    for cc in walk(c):
        cc.hide_render = c.name != zcommon.SYSTEMS["skeletal"]
    lc = vl.layer_collection.children.get(c.name)
    if lc:
        lc.exclude = c.name != zcommon.SYSTEMS["skeletal"]
for o in bpy.data.objects:
    if o.type not in {"LIGHT", "CAMERA"}:
        o.hide_render = o not in wanted
zcommon.apply_palette(objs)
world = bpy.data.worlds.new("ValWorld")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.04, 0.045, 0.06, 1)
scene.world = world
for o in list(bpy.data.objects):
    if o.type in {"LIGHT", "CAMERA"}:
        o.hide_render = True


def add_light(name, loc, energy=800, size=2.0):
    d = bpy.data.lights.new(name, "AREA")
    d.energy, d.size = energy, size
    o = bpy.data.objects.new(name, d)
    o.location = loc
    scene.collection.objects.link(o)
    return o


key = add_light("key", (2, -3, 3), 260, 2.5)
fill = add_light("fill", (-2.5, -1, 1.5), 90, 3)
cam_data = bpy.data.cameras.new("ValCam")
cam_data.lens = 50
cam = bpy.data.objects.new("ValCam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 900, 900
scene.render.resolution_percentage = 100
scene.render.film_transparent = False      # Startup.blend ships with this on (for exports); a flat-grey render is the tell
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.view_settings.view_transform = "Standard"
scene.render.use_freestyle = False
scene.render.use_compositing = False
scene.render.use_sequencer = False
try:
    scene.eevee.light_threshold = 0.001
except Exception:
    pass


def look_at(obj, target, up=Vector((0, 0, 1))):
    d = (target - obj.location).normalized()
    right = d.cross(up).normalized()
    true_up = right.cross(d).normalized()
    obj.matrix_world = Matrix((right, -true_up, -d)).transposed().to_4x4()
    obj.location = obj.location  # keep translation set separately below


def frame(pivot_b, radius, azim_deg, elev_deg=18):
    r = max(radius * 5.5, 0.4)
    az, el = math.radians(azim_deg), math.radians(elev_deg)
    off = Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el))) * r
    loc = pivot_b + off
    d = (pivot_b - loc).normalized()
    right = d.cross(Vector((0, 0, 1)))
    if right.length < 1e-6:
        right = Vector((1, 0, 0))
    right.normalize()
    true_up = right.cross(d).normalized()
    # build rotation + translation in one matrix: `obj.matrix_world.translation = x` mutates a throwaway copy, not the object
    M = Matrix((right, true_up, -d)).transposed().to_4x4()
    M.translation = loc
    cam.matrix_world = M
    key.location = loc + Vector((1, -1, 1.5))
    fill.location = loc + Vector((-1.5, 0.5, 0.5))


done, skipped = [], []
for joint, move, side, u in CASES:
    if only and (joint, move) not in only:
        continue
    J = MO["joints"].get(joint)
    mv = J["moves"].get(move) if J else None
    if not mv or not mv.get("ops"):
        skipped.append(f"{joint}.{move}: no simple ops (circumduction/etc, skipped)")
        continue
    si = 4 if side == "l" else 5
    orig = {}     # object -> its TRUE rest-pose matrix, captured only the first time an op touches it this case
    pivot_b = radius = None
    for key_, axis, kind, w, sign_l, sign_r in mv["ops"]:
        s = J["sites"][key_].get(side) or J["sites"][key_].get("m")
        sign = sign_l if side == "l" else sign_r
        disp = mv["range"][0] + (mv["range"][1] - mv["range"][0]) * u
        val = sign * w * (disp - mv.get("off", 0)) * mv.get("mag", 1)
        p_b = to_blender(s["p"])
        if pivot_b is None:
            pivot_b, radius = p_b, s.get("reach", 0.3)
        if kind == "c":
            val = sign * w
        ax_b = to_blender_dir(s["ax"][axis])
        R = Matrix.Rotation(math.radians(val), 4, ax_b)
        T = Matrix.Translation(p_b)
        M = T @ R @ T.inverted()
        for oid in s.get("mov") or []:
            o = bpy.data.objects.get(oid)
            if not o:
                continue
            if o not in orig:
                orig[o] = o.matrix_world.copy()     # a later op in this same movement may touch the same bone again (coupled joints); only its ORIGINAL matrix must be kept for the restore
            o.matrix_world = M @ o.matrix_world
    if pivot_b is None:
        skipped.append(f"{joint}.{move}: no site")
        continue
    bpy.context.view_layer.update()
    frame(pivot_b, radius, azim_deg=35 if side == "l" else -35)
    fname = os.path.join(args.out, f"{joint}__{move}__{side}_u{u}.png")
    scene.render.filepath = fname
    bpy.ops.render.render(write_still=True)
    print("[validate]", fname)
    done.append(fname)
    for o, m0 in orig.items():
        o.matrix_world = m0
    bpy.context.view_layer.update()

print(f"[validate] rendered {len(done)}, skipped {len(skipped)}")
for s in skipped:
    print("[validate] skip:", s)
