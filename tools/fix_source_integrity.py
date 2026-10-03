"""Repair naming / side errors in Startup.blend found by the knowledge-integrity audit (2026-10).

  blender -b Startup.blend --python tools/fix_source_integrity.py            # dry run: report only
  blender -b Startup.blend --python tools/fix_source_integrity.py -- --apply # fix and save (back the .blend up first)

Fixes, all decided from the geometry itself (web/Blender frame: +X = the body's left):
  1. Sided objects (Name.l/.r, insertion markers .ol/.er/.e2l ...) whose whole bounding box lies on the opposite side
     of the midline from their suffix are renamed to the other side. Swapped pairs are swapped through a temp name.
  2. Landmark labels (.s/.t) and pins (.i/.j) that sit on the opposite side of the midline from the bone they are
     parented to are mirrored in X (only X flips sign, as in the earlier landmark repair).
  3. Names that lost their characters ("????????", "?x") are renamed to honest "Unidentified ..." names that keep
     the geometry, and leading/trailing spaces are stripped from object names.
  4. Structures filed under the wrong group heading (REPARENT) are moved, keeping their world position.
Idempotent: a second run reports nothing to do.
"""
import bpy, sys, os, re
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import zclassify

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
APPLY = "--apply" in argv
EPS = 0.001  # metres: a structure counts as "across the midline" only if its whole bbox is past this

RENAME = {  # unrecoverable names -> honest placeholders (the parent says what they belong to)
    "????????": "Unidentified cardiac veins",
    "?x.l": "Unidentified branch of artery of pterygoid canal.l",
    "?x.r": "Unidentified branch of artery of pterygoid canal.r",
    "Inferior vein of left ventricle (//Posterior '')": "Inferior vein of left ventricle (posterior vein of left ventricle)",
}
REPARENT = {  # object -> the group heading it belongs under
    "Superior subscapular nerve.r": "Branches of posterior cord of brachial plexus.g",     # was under the lumbar plexus
    "Posterior leaflet of left atrioventricular valve": "Left atrioventricular valve.g",   # was under the tricuspid valve
}


def xrange_of(o):
    xs = [(o.matrix_world @ Vector(c)).x for c in o.bound_box]
    return min(xs), max(xs)


def flip_side(name):
    return re.sub(r"([lr])$", lambda m: "r" if m.group(1) == "l" else "l", name)


bpy.context.view_layer.update()
changes = []

# 1. sided geometry on the wrong side ---------------------------------------------------------------
wrong = {}
sided = {}
for o in bpy.data.objects:
    if o.type not in ("MESH", "CURVE") or o.name.endswith(zclassify.LABEL_SUFFIXES):
        continue
    _, suffix = zclassify.split_name(o.name)
    side = zclassify.side_of(suffix)
    if not side:
        continue
    lo, hi = xrange_of(o)
    sided[o.name] = (side, lo, hi)
    if (side == "l" and hi < -EPS) or (side == "r" and lo > EPS):
        wrong[o.name] = flip_side(o.name)
# structures touching the midline (e.g. procerus origins on the nasal bones): swap a pair when BOTH twins have their
# centre more than 5 mm past the midline on the wrong side - one twin alone may legitimately cross (vagus nerve)
for name, (side, lo, hi) in sided.items():
    twin = flip_side(name)
    if name in wrong or twin not in sided:
        continue
    c, tc = (lo + hi) / 2, (sided[twin][1] + sided[twin][2]) / 2
    if (side == "l" and c < -0.005 and tc > 0.005) or (side == "r" and c > 0.005 and tc < -0.005):
        wrong[name] = twin
renames = []
for old, new in wrong.items():
    other = bpy.data.objects.get(new)
    if other is not None and new not in wrong:
        print(f"CONFLICT {old!r} -> {new!r}: target exists and is on its correct side; left alone")
        continue
    renames.append((old, new))
    changes.append(f"side   {old!r} -> {new!r}" + (" (swap)" if other is not None else ""))

# 2. mirrored landmark labels / pins ----------------------------------------------------------------
mirror = []
for o in bpy.data.objects:
    if not o.name.endswith((".s", ".t")) or o.parent is None:
        continue
    _, psuf = zclassify.split_name(o.parent.name)
    pside = zclassify.side_of(psuf)
    if not pside:
        continue
    x = o.matrix_world.translation.x
    if (pside == "l" and x < -0.005) or (pside == "r" and x > 0.005):
        mirror.append(o)
        changes.append(f"mirror {o.name!r} (on {o.parent.name!r}) x {x:+.4f} -> {-x:+.4f}")

# 3. lost / padded names ----------------------------------------------------------------------------
fixnames = [(n, RENAME[n]) for n in RENAME if n in bpy.data.objects]
for o in bpy.data.objects:
    if o.name != o.name.strip() and o.name not in RENAME:
        fixnames.append((o.name, o.name.strip()))
for old, new in fixnames:
    changes.append(f"name   {old!r} -> {new!r}")

# 4. wrong group heading ------------------------------------------------------------------------------
moves = []
for name, gname in REPARENT.items():
    o, g = bpy.data.objects.get(name), bpy.data.objects.get(gname)
    if o is None or g is None:
        print(f"REPARENT skipped, missing: {name if o is None else gname!r}")
        continue
    if o.parent is not g:
        moves.append((o, g))
        changes.append(f"parent {name!r}: {o.parent.name if o.parent else None!r} -> {gname!r}")

print("\n".join(changes) or "nothing to fix")
print(f"FIX_SUMMARY sides={len(renames)} mirrored_landmarks={len(mirror)} names={len(fixnames)} reparent={len(moves)} apply={APPLY}")

if APPLY and changes:
    for old, _ in renames:  # two phases so swapped pairs never collide
        bpy.data.objects[old].name = old + ".__tmp__"
    for old, new in renames:
        o = bpy.data.objects[old + ".__tmp__"]
        o.name = new
        assert o.name == new, (old, new, o.name)
    for lab in mirror:
        pins = [c for c in lab.children if c.name.endswith((".i", ".j"))]
        pin_world = {p.name: p.matrix_world.copy() for p in pins}
        mw = lab.matrix_world.copy()
        mw.translation.x = -mw.translation.x
        lab.matrix_world = mw
        bpy.context.view_layer.update()
        for p in pins:
            pw = pin_world[p.name]
            pw.translation.x = -pw.translation.x
            p.matrix_world = pw
    for old, new in fixnames:
        o = bpy.data.objects[old]
        o.name = new
        if o.data is not None and o.data.name == old.split(".")[0]:
            o.data.name = new.split(".")[0] if new.endswith((".l", ".r")) else new
        assert o.name == new, (old, new, o.name)
    for o, g in moves:
        mw = o.matrix_world.copy()
        o.parent = g
        o.matrix_world = mw
    bpy.context.view_layer.update()
    bpy.ops.wm.save_mainfile()
    print("FIX_SAVED", bpy.data.filepath)
