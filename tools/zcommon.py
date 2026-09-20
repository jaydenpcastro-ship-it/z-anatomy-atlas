"""Shared helpers for the Z-Anatomy render/export tools (run inside Blender).

Z-Anatomy's own materials are custom "comic shader" node groups built for a Freestyle
line-art look; glTF exporters and a plain Eevee render can't read them. `apply_palette`
swaps every geometry object's materials for plain Principled BSDF equivalents so the
model looks right in renders and in the web viewer.
"""
import bpy, os, sys, re, colorsys, zlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # add-on root: zclassify.py
import zclassify
from zclassify import is_geometry, LABEL_SUFFIXES  # single definition shared with the add-on

SYSTEMS = {  # short key -> top-level collection name in Startup.blend
    "skeletal": "1: Skeletal system",
    "insertions": "2: Muscular insertions",
    "joints": "3: Joints",
    "muscular": "4: Muscular system",
    "cardiovascular": "5: Cardiovascular system",
    "lymphoid": "6: Lymphoid organs",
    "nervous": "7: Nervous system & Sense organs",
    "visceral": "8: Visceral systems",
    "regions": "9: Regions of human body",
}
def is_fascia(o):
    """Fascia / body-envelope shells hide everything underneath them; presets can leave them out."""
    return any(s.material and s.material.name in {"Fascia"} for s in o.material_slots)


def system_geometry(scene, key, include_fascia=True):
    return [o for o in scene.collection.children[SYSTEMS[key]].all_objects
            if is_geometry(o) and (include_fascia or not is_fascia(o))]


# ---------------------------------------------------------------- palette ----
def srgb_to_linear(h):
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def _jitter(name, hex_color, amount=0.05):
    """Deterministic small hue/value variation so neighbouring materials are distinguishable."""
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    seed = zlib.crc32(name.encode()) / 0xFFFFFFFF
    h = (h + (seed - 0.5) * amount) % 1.0
    v = min(1.0, max(0.0, v + ((zlib.crc32(name[::-1].encode()) / 0xFFFFFFFF) - 0.5) * amount * 2))
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return "#%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


LYMPH = ["#74D6A2", "#58C2B0", "#8AD672", "#B0DB5E", "#4FB5C9", "#6FA8DC", "#9CCBA6"]
SKIN = ["#E8B7A0", "#E3A896", "#EDC3A8", "#D99C8A", "#F0CDB2", "#DDAA90", "#E6B2A8", "#D7A488"]
BRAIN = {"Frontal lobe": "#E8A7A0", "Temporal lobe": "#A6C8E8", "Parietal lobe": "#E8D8A0",
         "Occipital lobe": "#B5E0A6", "Interlobar sulci": "#8E7B7B"}


def material_spec(mat):
    """-> (base_color_linear_rgb, roughness, metallic) for an original Z-Anatomy material."""
    n = mat.name
    groups = set()
    bsdf = None
    if mat.use_nodes:
        for node in mat.node_tree.nodes:
            if node.bl_idname == "ShaderNodeGroup" and node.node_tree:
                groups.add(node.node_tree.name)
            elif node.bl_idname == "ShaderNodeBsdfPrincipled":
                bsdf = node

    def rgb(hex_, rough=0.55, metal=0.0, jitter=0.0):
        return srgb_to_linear(_jitter(n, hex_, jitter) if jitter else hex_), rough, metal

    num = re.search(r"-(\d+)'*$", n)
    idx = int(num.group(1)) - 1 if num else 0
    if "Bone-Default" in groups or n.startswith("Bone"):
        return rgb("#E6DCC6", 0.55, 0.0, 0.02)
    if n == "Teeth":
        return rgb("#F4EFE2", 0.3)
    if n == "Teeth-roots":
        return rgb("#CDBF9F", 0.5)
    if n.startswith("Cartilage"):
        return rgb("#BAD5E2", 0.35)
    if n.startswith("Suture"):
        return rgb("#8E7D66", 0.7)
    if n == "Tendon":
        return rgb("#F2E6D3", 0.45)
    if n == "Ligament":
        return rgb("#DDEFE6", 0.4)
    if n in {"Articular capsule", "Fascia"}:
        return rgb("#B9CAD8", 0.5)
    if "Muscle-Default" in groups:
        return rgb("#B8322B", 0.55, 0.0, 0.07)
    if "Origin-default" in groups:
        return rgb("#F0663A", 0.6, 0.0, 0.03)
    if "End-default" in groups:
        return rgb("#3B86E8", 0.6, 0.0, 0.03)
    if "Nerve-default" in groups:
        return rgb("#F3D24E", 0.45, 0.0, 0.03)
    if "Lymph-default" in groups:
        return rgb(LYMPH[idx % len(LYMPH)], 0.5)
    if "Skin_Base-color" in groups:
        return rgb(SKIN[idx % len(SKIN)], 0.6)
    if n == "Skin-in":
        return rgb("#D97B6C", 0.6)
    if "Brain-default" in groups:
        return rgb(BRAIN.get(n, "#D9A7A0"), 0.55)
    if "Lung-base" in groups:
        return rgb("#E9A3A8", 0.5)
    if n == "Bronchi":
        return rgb("#E2CFBE", 0.5)
    if "Organ" in groups:
        return rgb("#C4584B", 0.5, 0.0, 0.08)
    if n == "Artery":
        return rgb("#D93A30", 0.4)
    if n == "Vein":
        return rgb("#3C5FD2", 0.4)
    if n == "Ductus":
        return rgb("#E6C86E", 0.5)
    if bsdf is not None:
        c = bsdf.inputs["Base Color"].default_value
        return (c[0], c[1], c[2]), max(0.3, bsdf.inputs["Roughness"].default_value), 0.0
    return rgb("#CCCCCC", 0.6)


_cache = {}


def palette_material(orig):
    if orig.name in _cache:
        return _cache[orig.name]
    color, rough, metal = material_spec(orig)
    m = bpy.data.materials.new("ZP_" + orig.name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*color, 1.0)
    _cache[orig.name] = m
    return m


def apply_palette(objects):
    """Replace every slot material with its palette equivalent. Call only on a scratch session (not saved)."""
    fallback = None
    for o in objects:
        if not o.material_slots:
            if fallback is None:
                fallback = bpy.data.materials.new("ZP_default")
                fallback.use_nodes = True
                fallback.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.6, 0.6, 0.6, 1)
            o.data.materials.append(fallback)
            continue
        for slot in o.material_slots:
            if slot.material and not slot.material.name.startswith("ZP_"):
                slot.material = palette_material(slot.material)
            elif slot.material is None:
                if fallback is None:
                    fallback = bpy.data.materials.new("ZP_default")
                    fallback.use_nodes = True
                slot.material = fallback
