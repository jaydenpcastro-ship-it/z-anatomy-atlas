# Regression test for the Anatomy Navigator. Run: blender -b Startup.blend --python tools/test_navigator.py
import bpy, sys, importlib.util, time, collections, traceback
print("=== NAVTEST2 ===")
import os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("z_anatomy_addon", os.path.join(root, "__init__.py"), submodule_search_locations=[root])
mod = importlib.util.module_from_spec(spec)
sys.modules["z_anatomy_addon"] = mod
try:
    spec.loader.exec_module(mod)
    mod.register()
except Exception:
    traceback.print_exc(); raise SystemExit
S = bpy.context.scene
props = S.zanatomy
print("register OK, panel classes:", mod.ZANATOMY_PT_Navigator.bl_label, mod.OBJECT_OT_navigator_refresh.bl_idname)

t = time.perf_counter(); idx = mod._navigator_index(force=True); build_ms = (time.perf_counter() - t) * 1000
print(f"index build: {len(idx)} records in {build_ms:.0f} ms (once, not per redraw)")
print("  kinds:", dict(collections.Counter(r['kind'] for r in idx)))
print("  systems:", dict(collections.Counter(r['system'] for r in idx)))

nosys = [r for r in idx if not r['system']]
print("  no-system records:", len(nosys), [(r['name'], r['kind'][0]) for r in nosys[:14]])
print("  duplicate (name,side,target) among landmarks:", len([1 for r in idx if r['kind']=='landmark']) - len({(r['name'], r['side'], r['target']) for r in idx if r['kind']=='landmark'}))

def run(**kw):
    props.navigator_search = kw.get("search", "")
    props.navigator_system = kw.get("system", "ALL")
    props.navigator_joint_type = kw.get("joint", "ALL")
    props.navigator_cartilage = kw.get("cart", "ALL")
    props.navigator_sort = kw.get("sort", "MESH_FIRST")
    props.navigator_landmarks = kw.get("landmarks", True)
    t = time.perf_counter()
    r = mod._navigator_objects(props)
    return r, (time.perf_counter() - t) * 1000

r, ms = run()
print(f"ALL filter+sort per redraw: {len(r)} results in {ms:.1f} ms")

expect = {"SKELETAL": {"skeletal"}, "JOINTS": {"joints"}, "MUSCULAR": {"muscular", "insertions", "fascia"}, "FASCIA": {"fascia"}, "CARDIOVASCULAR": {"cardiovascular"},
          "LYMPHOID": {"lymphoid"}, "NERVOUS": {"nervous"}, "CNS": {"nervous"}, "PNS": {"nervous"}, "SENSE": {"nervous"},
          "VISCERAL": {"visceral"}, "RESPIRATORY": {"visceral"}, "DIGESTIVE": {"visceral"}, "URINARY": {"visceral"},
          "REPRODUCTIVE": {"visceral"}, "ENDOCRINE": {"visceral"}, "INTEGUMENTARY": {"regions"}, "REGIONS": {"regions"}}
for key, allowed in expect.items():
    r, ms = run(system=key, landmarks=False)
    bad = [x for x in r if x["system"] not in allowed]
    print(f"SYS {key:14s} structures={len(r):5d} wrong-system={len(bad)}  sample={[x['name'] for x in r[:3]]}")
for key in ("SYNOVIAL", "FIBROUS", "CARTILAGINOUS", "BALL_AND_SOCKET", "HINGE", "PIVOT", "SADDLE", "PLANE", "CONDYLOID"):
    r, ms = run(joint=key, landmarks=False)
    print(f"JOINT {key:16s} n={len(r):4d} sample={[x['name'] + x['side'] for x in r[:5]]}")
for key in ("HYALINE", "FIBROCARTILAGE", "ELASTIC"):
    r, ms = run(cart=key, landmarks=False)
    print(f"CART  {key:16s} n={len(r):4d} sample={[x['name'] + x['side'] for x in r[:5]]}")
for q in ("scapula", "acromion", "femur", "hippocampus", "biceps", "aorta", "kidney"):
    r, ms = run(search=q)
    print(f"SEARCH {q:12s} n={len(r):4d} first={[(x['name'], x['kind'][0], x['side']) for x in r[:5]]}")

print("--- select operator: reveal objects whose system collection starts hidden ---")
picks = [("Biceps brachii muscle", "muscular"), ("Femur", "skeletal"), ("Left lung", "visceral"), ("Aorta", "cardiovascular"), ("Hippocampus", "nervous"), ("Acromion", "landmark")]
vl = bpy.context.view_layer
for q, _ in picks:
    r, _ms = run(search=q.lower())
    if not r:
        print(q, "-> no result"); continue
    rec = r[0]
    o = bpy.data.objects[rec["target"]]
    before = o.visible_get()
    try:
        res = bpy.ops.object.anatomy_navigator_select(object_name=rec["target"])
        print(f"{q!r}: picked {rec['id']!r} ({rec['kind']}, system={rec['system']}) op={res} visible before={before} after={o.visible_get()} selected={o.select_get()} active={vl.objects.active == o}")
    except Exception as e:
        print(f"{q!r}: op RAISED {type(e).__name__}: {str(e)[:150]}")
