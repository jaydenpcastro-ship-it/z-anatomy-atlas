"""Headless studio renders of the Z-Anatomy model.

Usage (from the project folder):
  blender -b Startup.blend --python tools/render_views.py -- --out renders [--only skeletal,muscular] [--views front,back] [--scale 1.0] [--engine EEVEE|CYCLES]

Every system is rendered in isolation with the same camera framing so the
images can be used as consistent thumbnails / hero images in the navigation site.
"""
import bpy, sys, os, math, argparse
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zcommon

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", default="renders")
ap.add_argument("--only", default="")
ap.add_argument("--views", default="front,back,threequarter,side")
ap.add_argument("--scale", type=float, default=1.0)
ap.add_argument("--engine", default="EEVEE")
ap.add_argument("--samples", type=int, default=64)
args = ap.parse_args(argv)

os.makedirs(args.out, exist_ok=True)
scene = bpy.context.scene
vl = scene.view_layers[0]

# ---- presets: name -> system keys from zcommon.SYSTEMS ----
PRESETS = {
    "skeletal": ["skeletal"],
    "skeletal_joints": ["skeletal", "joints"],
    "muscular": ["muscular"],
    "fascia": ["muscular"],  # only the fascia/envelope shells of the muscular system
    "muscles_on_skeleton": ["skeletal", "insertions", "muscular"],
    "cardiovascular": ["cardiovascular"],
    "nervous": ["nervous"],
    "visceral": ["visceral"],
    "lymphoid": ["lymphoid"],
    "regions_head_neck": ["regions"],
    "all_systems": ["skeletal", "joints", "cardiovascular", "lymphoid", "nervous", "visceral"],
}
# view -> (azimuth degrees; 0 = looking at the body's front, from -Y)
VIEWS = {"front": 0, "back": 180, "side": 90, "threequarter": 35}
# framing: centre of body and visible height in metres (skeleton spans z 0.01..1.71)
CENTER = Vector((0.0, 0.0, 0.87))
HEIGHT = 1.86
W, H = int(1200 * args.scale), int(1800 * args.scale)

# ---- scene setup ----
scene.render.engine = "BLENDER_EEVEE" if args.engine.upper().startswith("EEVEE") else "CYCLES"
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.view_settings.view_transform = "Standard"
# Z-Anatomy ships as Freestyle line art + a compositor; we want shaded colour renders
scene.render.use_freestyle = False
scene.render.use_compositing = False
scene.render.use_sequencer = False
if scene.render.engine == "CYCLES":
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception as e:
        print("cycles gpu setup failed:", e)
else:
    try:
        scene.eevee.taa_render_samples = args.samples
        # the file ships with light_threshold=0.756 (default 0.01) which culls every non-sun light
        scene.eevee.light_threshold = 0.001
        scene.eevee.use_shadows = True
        scene.eevee.use_raytracing = False
    except Exception as e:
        print("eevee setup failed:", e)

# world: dark studio gradient-ish flat colour
world = bpy.data.worlds.new("StudioWorld")
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.035, 0.042, 0.055, 1)
bg.inputs["Strength"].default_value = 1.0
scene.world = world

# remove the file's own lights/camera from rendering, we make a studio rig
for o in bpy.data.objects:
    if o.type in {"LIGHT", "CAMERA"}:
        o.hide_render = True

def add_area(name, loc, target, energy, size, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.size, data.color = energy, size, color
    ob = bpy.data.objects.new(name, data)
    scene.collection.objects.link(ob)
    ob.location = loc
    d = target - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob

cam_data = bpy.data.cameras.new("StudioCam")
cam_data.lens = 100
cam_data.sensor_fit = "VERTICAL"
cam_data.sensor_height = 36
cam_data.clip_start, cam_data.clip_end = 0.1, 50
cam = bpy.data.objects.new("StudioCam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
fov = 2 * math.atan(cam_data.sensor_height / 2 / cam_data.lens)
DIST = (HEIGHT / 2) / math.tan(fov / 2)

lights = []
def place_rig(az_deg):
    """key/fill/rim lights rotate with the camera so every angle is lit alike."""
    for l in lights:
        bpy.data.objects.remove(l, do_unlink=True)
    lights.clear()
    a = math.radians(az_deg)
    def rot(x, y):  # rotate an offset around Z by the camera azimuth
        return (x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a))
    for name, off, z, energy, size, col in [
        ("Key", (-2.2, -2.8), 2.6, 230, 3.0, (1.0, 0.96, 0.9)),
        ("Fill", (2.6, -2.2), 1.2, 90, 4.0, (0.85, 0.92, 1.0)),
        ("Rim", (0.5, 3.2), 2.4, 220, 2.5, (0.75, 0.85, 1.0)),
        ("Top", (0.0, -0.6), 4.0, 70, 3.5, (1, 1, 1)),
    ]:
        x, y = rot(*off)
        lights.append(add_area(name, (CENTER.x + x, CENTER.y + y, z), CENTER, energy, size, col))

def point_camera(az_deg):
    a = math.radians(az_deg)
    cam.location = (CENTER.x + DIST * math.sin(a), CENTER.y - DIST * math.cos(a), CENTER.z)
    d = CENTER - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

# ---- visibility control ----
top_by_name = {c.name: c for c in scene.collection.children}
def walk_collections(c):
    yield c
    for ch in c.children:
        yield from walk_collections(ch)

palette_done = set()

def set_visible(system_keys, preset_name=""):
    """Show only real anatomy geometry of the given systems (ignoring the add-on's per-object hide flags)."""
    names = [zcommon.SYSTEMS[k] for k in system_keys]
    wanted = set()
    for k in system_keys:
        for c in walk_collections(top_by_name[zcommon.SYSTEMS[k]]):
            c.hide_render = False
        objs = zcommon.system_geometry(scene, k, include_fascia=(preset_name == "fascia"))
        if preset_name == "fascia":
            objs = [o for o in objs if zcommon.is_fascia(o)]
        new = [o for o in objs if o.name not in palette_done]
        zcommon.apply_palette(new)
        palette_done.update(o.name for o in new)
        wanted.update(objs)
    for o in bpy.data.objects:
        if o.type in {"LIGHT", "CAMERA"}:
            continue
        o.hide_render = o not in wanted
    for c in scene.collection.children:
        lc = vl.layer_collection.children.get(c.name)
        if lc:
            lc.exclude = c.name not in names

want = [p for p in (args.only.split(",") if args.only else PRESETS) if p]
views = [v for v in args.views.split(",") if v]
for preset in want:
    set_visible(PRESETS[preset], preset)
    for v in views:
        az = VIEWS[v]
        point_camera(az)
        place_rig(az)
        path = os.path.join(args.out, f"{preset}_{v}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("RENDERED", path, flush=True)
