"""Bake joint-motion geometry from the real Z-Anatomy scene into web/data/motions.json.

  blender -b Startup.blend --python tools/export_motions.py -- [--out web/data/motions.json] [--only elbow,hip] [--check] [--render DIR]

Everything is measured on the actual skeletal meshes (loaded once, converted to the web frame: metres, +X = body's left,
+Y up, +Z anterior - the same frame as the glTF files and manifest.json):

  * joint centres / axes  - sphere fits to the articular contact patches (a bone's vertices that lie within a few mm of the
                            partner bone), two-sphere axes for hinges (trochlea+capitulum, medial+lateral condyle, ...),
                            PCA long axes of bones, anatomical priors when a fit disagrees with them (logged as FALLBACK)
  * segment membership    - which skeletal structures move with each joint (explicit lists, or "everything with level <= b"
                            for the spine, see LEVEL)
  * rotation sign         - resolved per movement and per side by a probe point: the sign is chosen so that a chosen point of
                            the moving segment moves in the anatomically expected direction (e.g. forearm moves anterior in
                            elbow flexion). This is what makes "flexion closes the forearm onto the arm" true by construction.
  * validation            - each movement is swung through its range and tested against the neighbouring bones with a BVH
                            overlap test (--check); optional Blender renders of extreme poses (--render).

Output schema (all coordinates in the web frame, angles in degrees):
  { "version": 1,
    "levels": { "<structure id>": <vertebral level number> },          # spine bookkeeping, see LEVEL
    "joints": { "<slug from vocab.json>": {
        "sites": { "<site key>": { "l": SITE, "r": SITE }  or  { "m": SITE } },     # m = midline
        "moves": { "<movement slug>": MOVE } } } }
  SITE = { "p": [x,y,z]            pivot (centre of rotation),
           "ml"|"ap"|"lg"|"vt": [x,y,z]   unit axes: mediolateral, anteroposterior, segment long axis, vertical,
           "ct": [x,y,z]           centre of the articular contact patch on the fixed bone,
           "r": metres             radius of the convex articular surface,
           "mov": [ids] | "upTo": level      structures that move with this site,
           "fix": [ids]            structures shown as the fixed partner,
           "reach": metres          largest pivot->moving-bone distance (label / arc sizing) }
  MOVE = { "ops": [[site key, axis name, weight, sign_l, sign_r], ...]    ordered proximal -> distal,
           "pre": [[site key, axis name, degrees, sign_l, sign_r], ...],  constant pre-pose (applied first)
           "range": [from, to], "mag": display magnification, "axis": "Mediolateral", "plane": "Sagittal",
           "ref": {l: [x,y,z], r: [...]}, "arth": {...}, "note": "...", "hit": degrees at which a neighbouring bone is hit }
"""
import bpy, sys, os, json, math, argparse, zlib
import numpy as np
from mathutils import Vector, kdtree, Matrix
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zcommon

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "data", "motions.json"))
ap.add_argument("--only", default="")
ap.add_argument("--check", action="store_true", help="collision-test every movement over its range")
ap.add_argument("--render", default="", help="write Blender validation renders of extreme poses to this folder")
ap.add_argument("--dump", default="", help="write a debug json with fitted values")
args = ap.parse_args(argv)
RNG = np.random.default_rng(7)
LOG = []


def log(*a):
    s = " ".join(str(x) for x in a)
    LOG.append(s)
    print("[motions]", s)


# ------------------------------------------------------------------ bones ----
def to_web(p):  # blender (x,y,z) z-up, front = -y  ->  web (x, z, -y)
    return np.array([p[0], p[2], -p[1]], dtype=float)


class Bone:
    def __init__(self, obj):
        self.obj = obj
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        co = co.reshape(n, 3)
        mw = np.array(obj.matrix_world)
        w = co @ mw[:3, :3].T + mw[:3, 3]
        self.V = np.stack([w[:, 0], w[:, 2], -w[:, 1]], axis=1)
        tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
        me.loop_triangles.foreach_get("vertices", tri)
        self.F = tri.reshape(-1, 3)
        ev.to_mesh_clear()
        self.c = self.V.mean(0)
        self.lo, self.hi = self.V.min(0), self.V.max(0)
        a, b, c = (self.V[self.F[:, i]] for i in range(3))
        cr = np.cross(b - a, c - a)
        self.area = np.linalg.norm(cr, axis=1) * 0.5
        self._S = {}
        self._bvh = None
        self.rng = np.random.default_rng(zlib.crc32(obj.name.encode()))   # deterministic per bone: same fits on every run

    def samples(self, n=12000):
        """n points spread over the surface, area weighted"""
        if n not in self._S:
            if self.area.sum() <= 0:
                self._S[n] = self.V.copy()
            else:
                idx = self.rng.choice(len(self.F), size=n, p=self.area / self.area.sum())
                u, v = self.rng.random(n), self.rng.random(n)
                m = u + v > 1
                u[m], v[m] = 1 - u[m], 1 - v[m]
                a, b, c = (self.V[self.F[idx, i]] for i in range(3))
                self._S[n] = a + (b - a) * u[:, None] + (c - a) * v[:, None]
        return self._S[n]

    def bvh(self):
        if self._bvh is None:
            self._bvh = BVHTree.FromPolygons([tuple(v) for v in self.V], [tuple(f) for f in self.F], epsilon=0.0)
        return self._bvh


scene = bpy.context.scene
B = {}
for o in zcommon.system_geometry(scene, "skeletal"):
    if o.type == "MESH" and len(o.data.vertices):
        B[o.name] = Bone(o)
log("loaded", len(B), "skeletal meshes")


def sided(base):
    return (base + ".l") in B


def bid(base, side):
    """structure id of a base name on a side ('l'/'r'); midline names are returned unchanged."""
    if sided(base):
        return base + (".l" if side == "l" else ".r")
    return base


def bones(bases, side):
    return [bid(b, side) for b in bases]


SIGN = {"l": 1.0, "r": -1.0}   # +1 for the body's left (+X)


# ------------------------------------------------------------ vector maths ---
def unit(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def nearest_dist(A, Bpts):
    kd = kdtree.KDTree(len(Bpts))
    for i, p in enumerate(Bpts):
        kd.insert(Vector(p), i)
    kd.balance()
    return np.array([kd.find(Vector(p))[2] for p in A])


def patch(a, b, tol=0.006, n=12000, lo=0.0):
    """points of bone a (dense samples) that lie within `tol` of the closest approach to bone b -> the articular contact patch"""
    A = B[a].samples(n)
    d = nearest_dist(A, B[b].samples(n))
    m = d < d.min() + tol
    return A[m], float(d.min())


def fit_sphere(P, iters=3):
    P = np.asarray(P, dtype=float)
    keep = np.ones(len(P), bool)
    c, r = P.mean(0), 0.02
    for _ in range(iters):
        Q = P[keep]
        if len(Q) < 6:
            break
        A = np.c_[2 * Q, np.ones(len(Q))]
        y = (Q ** 2).sum(1)
        sol, *_ = np.linalg.lstsq(A, y, rcond=None)
        c = sol[:3]
        r = math.sqrt(max(sol[3] + c @ c, 1e-9))
        res = np.abs(np.linalg.norm(P - c, axis=1) - r)
        keep = res < max(2.0 * np.median(res[keep]), 0.0008)
    return c, r


def pca_axis(P):
    P = np.asarray(P, dtype=float)
    u, s, vt = np.linalg.svd(P - P.mean(0), full_matrices=False)
    return vt[0], s


def long_axis(base_id, toward=None):
    """principal axis of a bone; oriented so it points toward `toward` (a point) when given, else upward"""
    ax, _ = pca_axis(B[base_id].V)
    ref = (toward - B[base_id].c) if toward is not None else np.array([0, 1.0, 0])
    return ax if ax @ ref >= 0 else -ax


def clamp_axis(fit, prior, tol_deg, what):
    """use the fitted axis unless it deviates from the anatomical prior by more than tol_deg"""
    fit, prior = unit(fit), unit(prior)
    if fit @ prior < 0:
        fit = -fit
    ang = math.degrees(math.acos(max(-1, min(1, fit @ prior))))
    if ang > tol_deg:
        log(f"FALLBACK {what}: fitted axis is {ang:.0f} deg from the prior, using the prior")
        return prior
    return fit


def r3(v):
    return [round(float(x), 4) for x in v]


# ------------------------------------------------------------ bone sets ------
FING = ["first", "second", "third", "fourth", "fifth"]
CARPALS = ["Scaphoid bone", "Lunate bone", "Triquetrum bone", "Pisiform bone", "Trapezium bone", "Trapezoid bone", "Capitate bone", "Hamate bone"]
META = [f"{n.capitalize()} metacarpal bone" for n in FING]
FORE = ["Radius", "Ulna"]


def hand_phal(f, parts=("Proximal", "Middle", "Distal")):
    return [f"{p} phalanx of {f} finger of hand" for p in parts if not (f == "first" and p == "Middle")]


def foot_phal(f, parts=("Proximal", "Middle", "Distal")):
    return [f"{p} phalanx of {f} finger of foot" for p in parts if not (f == "first" and p == "Middle")]


HAND = CARPALS + META + [x for f in FING for x in hand_phal(f)]
TARS = ["Calcaneus", "Cuboid bone", "Intermediate cuneiform bone", "Lateral cuneiform bone", "Medial cuneiform bone", "Navicular bone", "Talus"]
METAT = [f"{n.capitalize()} metatarsal bone" for n in FING]
FOOT = TARS + METAT + [x for f in FING for x in foot_phal(f)] + ["Sesamoid bones of foot"]
FOOT_NO_TALUS = [b for b in FOOT if b != "Talus"]
UL_HUM = ["Humerus"] + FORE + HAND
UL_SCAP = ["Scapula"] + UL_HUM
UL_CLAV = ["Clavicle"] + UL_SCAP
LL_FEM = ["Femur", "Patella", "Tibia", "Fibula"] + FOOT
LL_TIB = ["Tibia", "Fibula"] + FOOT
SKULL_GROUPS = ("Bones of cranium.g", "Extracranial bones of head.g", "Auditory ossicles.g", "Nasal cartilages.g", "Anterior teeth.g", "Posterior teeth.g")


def load_groups():
    m = json.load(open(os.path.join(os.path.dirname(args.out), "manifest.json"), encoding="utf-8"))
    return {r["id"]: r for r in m["structures"] if r["system"] == "skeletal"}


MAN = load_groups()

# vertebral LEVEL: a structure with level <= b moves when the spine flexes/rotates at the joint just below level b.
# skull 0, C1..C7 = 1..7, T1..T12 = 8..19, L1..L5 = 20..24, everything caudal (sacrum, pelvis, legs) = 25.
LEVEL = {}
for sid_, r in MAN.items():
    g, n = r["group"], r["name"]
    lvl = 25
    if g in SKULL_GROUPS and n != "Hyoid bone":
        lvl = 0
    elif n in ("Hyoid bone",) or g == "Laryngeal cartilages.g":
        lvl = 3.5
    elif n == "Atlas (C1)":
        lvl = 1
    elif n == "Axis (C2)":
        lvl = 2
    elif n.startswith("Vertebra C"):
        lvl = int(n[10:])
    elif n.startswith("Vertebra T"):
        lvl = 7 + int(n[10:])
    elif n.startswith("Vertebra L"):
        lvl = 19 + int(n[10:])
    elif g in ("True ribs.g", "False ribs.g", "Floating ribs.g"):
        lvl = 7 + ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"].index(n.split(" rib")[0].lower())
    elif g == "Costal cartilages.g":
        lvl = 7 + ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"].index(n.split(" of ")[1].split(" rib")[0])
    elif g == "Sternum.g":
        lvl = 12
    elif g in ("Bones of pectoral girdle.g", "Bones of free part of upper limb.g"):
        lvl = 10
    LEVEL[sid_] = lvl
LEVELS_OUT = {k: v for k, v in LEVEL.items() if v < 25}


def vertebra_id(lv):
    """structure id of the vertebra with level number lv (1..24)"""
    if lv == 1:
        return "Atlas (C1)"
    if lv == 2:
        return "Axis (C2)"
    if lv <= 7:
        return f"Vertebra C{lv}"
    if lv <= 19:
        return f"Vertebra T{lv - 7}"
    return f"Vertebra L{lv - 19}"


def body_centre(vid):
    """centre of a vertebral body: mean of the vertices in the anterior 45% of the vertebra's AP extent"""
    V = B[vid].V
    z0, z1 = V[:, 2].min(), V[:, 2].max()
    m = V[:, 2] > z1 - 0.45 * (z1 - z0)
    return V[m].mean(0)


def rib_group_centre(lvls):
    return np.mean([body_centre(vertebra_id(l)) for l in lvls], axis=0)


X, Y, Z = np.array([1.0, 0, 0]), np.array([0, 1.0, 0]), np.array([0, 0, 1.0])


def axes(ml=X, ap=Z, vt=Y, lg=None, **extra):
    d = {"ml": unit(ml), "ap": unit(ap), "vt": unit(vt), "lg": unit(lg if lg is not None else vt)}
    d.update({k: unit(v) for k, v in extra.items()})
    return d


def mk_site(p, ax, mov=(), fix=(), upTo=None, ct=None, r=0.0, sd=None, extra_mov=None):
    s = {"p": np.asarray(p, float), "ax": ax, "mov": list(mov), "fix": list(fix), "ct": np.asarray(ct if ct is not None else p, float), "r": float(r)}
    if upTo is not None:
        s["upTo"] = upTo
    if sd:
        s["sd"] = sd
    return s


def ball(convex, partner, tol=0.006):
    """centre + radius of the convex articular surface, and the centre of the partner's contact patch"""
    Pc, _ = patch(convex, partner, tol)
    c, r = fit_sphere(Pc)
    Pp, _ = patch(partner, convex, tol)
    return c, r, Pp.mean(0)


def dist_end(bone_id, top=False, frac=0.12):
    """mean of the lowest (or highest) `frac` of a bone's vertices along Y"""
    V = B[bone_id].V
    k = max(int(len(V) * frac), 8)
    idx = np.argsort(V[:, 1])
    return V[idx[-k:] if top else idx[:k]].mean(0)


SITES = {}   # joint -> site key -> { "l": site, "r": site } or { "m": site }
MOVES = {}   # joint -> movement -> MOVE
NOTES = {}   # joint -> label info


def put(joint, key, side, site):
    SITES.setdefault(joint, {}).setdefault(key, {})[side] = site


def diag(name, c, r=None, extra=""):
    log(f"site {name}: p={np.round(c, 4).tolist()}" + (f" r={r * 1000:.1f}mm" if r else "") + (" " + extra if extra else ""))


# ------------------------------------------------------------ site builders --
def two_sphere_axis(pa, pb, prior, tol_deg, what):
    """axis through the centres of two fitted spheres; falls back to `prior` when the fit is implausible"""
    ca, ra = fit_sphere(pa)
    cb, rb = fit_sphere(pb)
    ax = cb - ca
    if np.linalg.norm(ax) < 0.012:
        log(f"FALLBACK {what}: sphere centres only {np.linalg.norm(ax) * 1000:.0f} mm apart, using the prior axis")
        return (ca + cb) / 2, unit(prior), (ra + rb) / 2
    ax = clamp_axis(ax, prior, tol_deg, what)
    return (ca + cb) / 2, unit(ax + prior), (ra + rb) / 2      # half fit, half prior: the two centres are only ~15 mm apart, so the fit alone is noisy


def blade_normal(bone_id):
    """normal of the flat body of a scapula-like bone: plane fit that repeatedly discards the points that stick out (spine, acromion, coracoid)"""
    V = B[bone_id].samples(8000)
    c, n = V.mean(0), Z
    for _ in range(4):
        _, _, vt = np.linalg.svd(V - c, full_matrices=False)
        n = vt[2]
        d = (V - c) @ n
        V = V[np.abs(d) < 1.5 * d.std()]
        c = V.mean(0)
    return n


def build_upper_limb(side):
    s = SIGN[side]
    H, Sc, Cl, Ra, Ul = bid("Humerus", side), bid("Scapula", side), bid("Clavicle", side), bid("Radius", side), bid("Ulna", side)
    # --- glenohumeral: humeral head sphere, long axis = head centre -> epicondylar midpoint
    c, r, ct = ball(H, Sc)
    elbow_mid = dist_end(H)
    lg = elbow_mid - c
    put("glenohumeral", "gh", side, mk_site(c, axes(lg=lg), bones(UL_HUM, side), [Sc], ct=ct, r=r))
    diag(f"gh.{side}", c, r, f"arm hangs {math.degrees(math.acos(unit(lg)[1] * -1)):.0f} deg from vertical")
    # --- acromioclavicular: patch centroid, axis normal to the scapular blade
    Pc, _ = patch(Cl, Sc, 0.005)
    acp = Pc.mean(0)
    n_s = blade_normal(Sc)
    prior = np.array([-0.55 * s, 0.0, 0.83])   # scapular plane: its normal points anterior and medial
    n_ax = clamp_axis(n_s, prior, 40, f"scapular normal {side}")
    Pf, _ = patch(Sc, Cl, 0.005)
    put("acromioclavicular", "ac", side, mk_site(acp, axes(lg=n_ax, ob=n_ax), bones(UL_SCAP, side), [Cl], ct=Pf.mean(0), r=0.012))
    diag(f"ac.{side}", acp)
    # --- sternoclavicular
    Pm, _ = patch(Cl, "Manubrium of sternum", 0.006)
    scp = Pm.mean(0)
    Pf, _ = patch("Manubrium of sternum", Cl, 0.006)
    put("sternoclavicular", "sc", side, mk_site(scp, axes(lg=B[Cl].c - scp), bones(UL_CLAV, side), ["Manubrium of sternum"], ct=Pf.mean(0), r=0.012))
    diag(f"sc.{side}", scp)
    # thoracic centre for scapular gliding: vertical axis through the middle of the rib cage at scapular height
    ribs = [B[b].c for b in B if b.endswith(" rib.l") or b.endswith(" rib.r") or b.endswith(" rib")]
    thx = np.array([0.0, B[Sc].c[1], np.mean([p[2] for p in ribs])])
    put("scapulothoracic", "thx", side, mk_site(thx, axes(), bones(UL_CLAV, side), ["Vertebra T4"], ct=B[Sc].c, r=0.1))
    put("scapulothoracic", "sc", side, SITES["sternoclavicular"]["sc"][side])
    put("scapulothoracic", "ac", side, SITES["acromioclavicular"]["ac"][side])
    put("scapulothoracic", "gh", side, SITES["glenohumeral"]["gh"][side])
    diag(f"thx.{side}", thx)
    # --- elbow: trochlea (ulna) + capitulum (radius) spheres define the flexion axis
    Pt, _ = patch(H, Ul, 0.005)
    Pcap, _ = patch(H, Ra, 0.005)
    p, ax, r = two_sphere_axis(Pt, Pcap, X, 30, f"elbow axis {side}")
    forearm_lg = unit(dist_end(Ul) - p)
    _, _, ctr = ball(H, Ul, 0.005)
    put("elbow", "elb", side, mk_site(p, axes(ml=ax, lg=forearm_lg), bones(FORE + HAND, side), [H], ct=ctr, r=r))
    diag(f"elbow.{side}", p, r, f"axis {np.round(ax, 2).tolist()}")
    # --- radio-ulnar: axis from radial-head centre to distal ulnar head
    rh, _, _ = ball(Ra, H, 0.005)
    ud = dist_end(Ul, frac=0.06)
    axis_ru = unit(ud - rh)
    Pu, _ = patch(Ul, Ra, 0.005)
    put("radioulnar", "ru", side, mk_site(rh, axes(lg=axis_ru), bones(["Radius"] + CARPALS + META + [x for f in FING for x in hand_phal(f)], side), [Ul], ct=Pu.mean(0), r=0.012))
    diag(f"radioulnar.{side}", rh, None, f"axis {np.round(axis_ru, 2).tolist()}")
    # --- wrist: sphere on the proximal carpal row facing the radius
    Psc, _ = patch(bid("Scaphoid bone", side), Ra, 0.004)
    Plu, _ = patch(bid("Lunate bone", side), Ra, 0.004)
    c, r = fit_sphere(np.vstack([Psc, Plu]))
    Pr, _ = patch(Ra, bid("Lunate bone", side), 0.004)
    tip = B[bid("Third metacarpal bone", side)].c
    put("wrist", "wr", side, mk_site(c, axes(lg=tip - c), bones(CARPALS + META + [x for f in FING for x in hand_phal(f)], side), bones(FORE, side), ct=Pr.mean(0), r=r))
    diag(f"wrist.{side}", c, r)
    # --- thumb carpometacarpal (saddle)
    Tm, T1 = bid("Trapezium bone", side), bid("First metacarpal bone", side)
    Pt1, _ = patch(T1, Tm, 0.004)
    c1 = Pt1.mean(0)
    Pp, _ = patch(Tm, T1, 0.004)
    put("carpometacarpal-1", "cmc1", side, mk_site(c1, axes(lg=B[T1].c - c1), bones(["First metacarpal bone"] + hand_phal("first"), side), ["Trapezium bone"], ct=Pp.mean(0), r=0.012))
    diag(f"cmc1.{side}", c1)
    # MCP: one site per finger (thumb = mcp1); interphalangeal: PIP (thumb: IP) and DIP per finger
    for i, f in enumerate(FING):
        Mb, P1 = bid(META[i], side), bid(hand_phal(f)[0], side)
        c, r, ct = ball(Mb, P1, 0.0035)
        put("metacarpophalangeal", f"mcp{i + 1}", side, mk_site(c, axes(lg=B[P1].c - c), bones(hand_phal(f), side), [META[i]], ct=ct, r=r))
        ph = [bid(x, side) for x in hand_phal(f)]
        if f == "first":
            c2, r2, ct2 = ball(ph[0], ph[1], 0.0035)
            put("interphalangeal-hand", "ip1", side, mk_site(c2, axes(lg=B[ph[1]].c - c2), ph[1:], [hand_phal(f)[0]], ct=ct2, r=r2))
        else:
            c2, r2, ct2 = ball(ph[0], ph[1], 0.0035)
            put("interphalangeal-hand", f"pip{i + 1}", side, mk_site(c2, axes(lg=B[ph[1]].c - c2), ph[1:], [hand_phal(f)[0]], ct=ct2, r=r2))
            c3, r3, ct3 = ball(ph[1], ph[2], 0.0035)
            put("interphalangeal-hand", f"dip{i + 1}", side, mk_site(c3, axes(lg=B[ph[2]].c - c3), ph[2:], [hand_phal(f)[1]], ct=ct3, r=r3))
    diag(f"fingers.{side}", B[bid(META[2], side)].c)


def build_lower_limb(side):
    s = SIGN[side]
    Fe, Hb, Ti, Fi, Pa, Ta, Ca = (bid(n, side) for n in ("Femur", "Hip bone", "Tibia", "Fibula", "Patella", "Talus", "Calcaneus"))
    # --- hip: femoral head sphere, long (mechanical) axis head centre -> knee centre
    c, r, ct = ball(Fe, Hb)
    knee_mid = dist_end(Fe, frac=0.05)
    lg = knee_mid - c
    put("hip", "hip", side, mk_site(c, axes(lg=lg), bones(LL_FEM, side), [Hb], ct=ct, r=r))
    diag(f"hip.{side}", c, r, f"femur {math.degrees(math.acos(-unit(lg)[1])):.0f} deg from vertical")
    # --- knee: posterior condylar spheres (medial + lateral) -> flexion axis
    Vd = B[Fe].V
    dis = Vd[Vd[:, 1] < B[Fe].lo[1] + 0.06]
    xm = np.median(dis[:, 0])
    zm = np.median(dis[:, 2])
    post = dis[dis[:, 2] < zm]
    med = post[(post[:, 0] - xm) * s < 0]
    lat = post[(post[:, 0] - xm) * s >= 0]
    p, ax, r = two_sphere_axis(med, lat, X, 20, f"knee axis {side}")
    Pk, _ = patch(Fe, Ti, 0.008)
    tib_lg = unit(dist_end(Ti) - B[Ti].c)
    put("knee", "knee", side, mk_site(p, axes(ml=ax, lg=tib_lg), bones(["Tibia", "Fibula"] + FOOT, side), [Fe], ct=Pk.mean(0), r=r))
    put("knee", "pat", side, mk_site(p, axes(ml=ax), [Pa], [Fe], ct=B[Pa].c, r=r))
    diag(f"knee.{side}", p, r, f"axis {np.round(ax, 2).tolist()}")
    # --- ankle: talar dome, medial + lateral halves
    Pd, _ = patch(Ta, Ti, 0.006)
    xt = np.median(Pd[:, 0])
    pm, pl = Pd[(Pd[:, 0] - xt) * s < 0], Pd[(Pd[:, 0] - xt) * s >= 0]
    p, ax, r = two_sphere_axis(pm, pl, X, 25, f"ankle axis {side}")
    if side == "r" and "ank" in SITES.get("ankle", {}) and "l" in SITES["ankle"]["ank"]:
        axl = SITES["ankle"]["ank"]["l"]["ax"]["ml"]      # the model is mirror-symmetric: reuse the left fit, mirrored, for a stable pair
        ax = unit(np.array([axl[0], -axl[1], -axl[2]]))      # mirror across the sagittal plane, as an (unsigned) line
        log("ankle axis r taken from the mirrored left fit")
    Pt2, _ = patch(Ti, Ta, 0.006)
    put("ankle", "ank", side, mk_site(p, axes(ml=ax, lg=B[bid("Third metatarsal bone", side)].c - p), bones(FOOT, side), [Ti, Fi], ct=Pt2.mean(0), r=r))
    diag(f"ankle.{side}", p, r, f"axis {np.round(ax, 2).tolist()}")
    # --- subtalar: contact-patch centre; oblique Henke axis (42 deg up, 16 deg medial of the sagittal plane)
    Ps, _ = patch(Ca, Ta, 0.004)
    stp = Ps.mean(0)
    henke = np.array([-s * math.sin(math.radians(16)) * math.cos(math.radians(42)), math.sin(math.radians(42)), math.cos(math.radians(16)) * math.cos(math.radians(42))])
    Pt3, _ = patch(Ta, Ca, 0.004)
    put("subtalar", "st", side, mk_site(stp, axes(lg=henke, ob=henke), bones(FOOT_NO_TALUS, side), [Ta], ct=Pt3.mean(0), r=0.015))
    diag(f"subtalar.{side}", stp)
    # --- metatarsophalangeal + interphalangeal of the toes
    for i, f in enumerate(FING):
        Mb, P1 = bid(METAT[i], side), bid(foot_phal(f)[0], side)
        c, r, ct = ball(Mb, P1, 0.0035)
        put("metatarsophalangeal", f"mtp{i + 1}", side, mk_site(c, axes(lg=B[P1].c - c), bones(foot_phal(f), side), [METAT[i]], ct=ct, r=r))
        ph = [bid(x, side) for x in foot_phal(f)]
        if f == "first":
            c2, r2, ct2 = ball(ph[0], ph[1], 0.0035)
            put("interphalangeal-foot", "ip1", side, mk_site(c2, axes(lg=B[ph[1]].c - c2), ph[1:], [foot_phal(f)[0]], ct=ct2, r=r2))
        else:
            c2, r2, ct2 = ball(ph[0], ph[1], 0.0035)
            put("interphalangeal-foot", f"pip{i + 1}", side, mk_site(c2, axes(lg=B[ph[1]].c - c2), ph[1:], [foot_phal(f)[0]], ct=ct2, r=r2))
            c3, r3, ct3 = ball(ph[1], ph[2], 0.0035)
            put("interphalangeal-foot", f"dip{i + 1}", side, mk_site(c3, axes(lg=B[ph[2]].c - c3), ph[2:], [foot_phal(f)[1]], ct=ct3, r=r3))
    diag(f"toes.{side}", B[bid(METAT[1], side)].c)


for sd_ in ("l", "r"):
    build_upper_limb(sd_)
    build_lower_limb(sd_)
for j_, k_ in (("elbow", "elb"), ("knee", "knee"), ("knee", "pat"), ("ankle", "ank")):     # the model is mirror-symmetric: one hinge fit, mirrored, keeps both sides consistent
    axl = SITES[j_][k_]["l"]["ax"]["ml"]
    SITES[j_][k_]["r"]["ax"]["ml"] = unit(np.array([axl[0], -axl[1], -axl[2]]))


# --------------------------------------------------- axial / midline sites ---
SKULL = [k for k, v in LEVEL.items() if v == 0]
LOWER_TEETH = [k for k in B if k.startswith("Lower ")]
RIB_NAMES = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth"]
CART_NAMES = [n.lower() for n in RIB_NAMES[:10]]


def build_axial():
    # atlanto-occipital: centre of the two occipital-condyle contact patches
    Po, _ = patch("Occipital bone", "Atlas (C1)", 0.006)
    Pa, _ = patch("Atlas (C1)", "Occipital bone", 0.006)
    put("atlanto-occipital", "ao", "m", mk_site(Po.mean(0), axes(), SKULL, ["Atlas (C1)"], ct=Pa.mean(0), r=0.014))
    diag("ao", Po.mean(0))
    # atlanto-axial: dens of the axis; its long axis is the rotation axis
    V = B["Axis (C2)"].V
    dens = V[(V[:, 1] > V[:, 1].max() - 0.016) & (np.abs(V[:, 0]) < 0.008)]
    dp = dens.mean(0)
    dax, _ = pca_axis(dens)
    dax = clamp_axis(dax, Y, 20, "dens axis")
    Pd, _ = patch("Atlas (C1)", "Axis (C2)", 0.005)
    put("atlanto-axial", "aa", "m", mk_site(dp, axes(lg=dax, vt=dax), SKULL + ["Atlas (C1)"], ["Axis (C2)"], ct=Pd.mean(0), r=0.008))
    diag("aa", dp)
    # spinal joints: one site per intervertebral level b (between the vertebra of level b and level b+1); everything <= b moves
    sacrum_top = B["Sacrum"].V[B["Sacrum"].V[:, 1] > B["Sacrum"].V[:, 1].max() - 0.02]
    sacrum_c = sacrum_top[sacrum_top[:, 2] > sacrum_top[:, 2].max() - 0.45 * np.ptp(sacrum_top[:, 2])].mean(0)
    site_of = {}
    for b in range(2, 25):
        a = body_centre(vertebra_id(b))
        c = body_centre(vertebra_id(b + 1)) if b < 24 else sacrum_c
        p = (a + c) / 2
        # move the pivot to the middle of the disc (the vertebral-body centres are the anterior column, so keep it as is)
        site_of[b] = mk_site(p, axes(lg=a - c), upTo=b, fix=[vertebra_id(b + 1)] if b < 24 else ["Sacrum"], ct=p, r=0.02)
    for b, st in site_of.items():
        key = ("c" if b <= 7 else "t" if b <= 19 else "l") + str(b)
        put({"c": "cervical-spine", "t": "thoracic-spine", "l": "lumbar-spine"}[key[0]], key, "m", st)
    for j in ("cervical-spine",):
        put(j, "c0", "m", SITES["atlanto-occipital"]["ao"]["m"])
        put(j, "c1", "m", SITES["atlanto-axial"]["aa"]["m"])
    diag("spine", site_of[10]["p"], None, f"T3/T4 lg={np.round(site_of[10]['ax']['lg'], 2).tolist()}")
    # thoracic cage: pump handle (ribs 1-7 + sternum about a mediolateral axis) and bucket handle (ribs 7-10 about an AP axis, per side)
    ribs_up = [f"{n} rib{sfx}" for n in RIB_NAMES[:7] for sfx in (".l", ".r")]
    cart_up = [f"Costal cartilage of {n} rib{sfx}" for n in CART_NAMES[:7] for sfx in (".l", ".r")]
    stern = ["Manubrium of sternum", "Body of sternum", "Xiphoid process"]
    put("thoracic-cage", "pump", "m", mk_site(rib_group_centre(range(9, 15)), axes(), ribs_up + cart_up + stern, ["Vertebra T5"], ct=B["Body of sternum"].c, r=0.05))
    for sd, sfx in (("l", ".l"), ("r", ".r")):
        mov = [f"{n} rib{sfx}" for n in RIB_NAMES[6:10]] + [f"Costal cartilage of {n} rib{sfx}" for n in CART_NAMES[6:10]]
        put("thoracic-cage", "bucket" + sd, "m", mk_site(rib_group_centre(range(14, 18)), axes(), mov, ["Vertebra T9"], ct=B[f"Eighth rib{sfx}"].c, r=0.05, sd=sd))
    diag("cage", rib_group_centre(range(9, 15)))
    # sacro-iliac: centre of the two auricular contact patches, transverse axis; the sacrum carries L5 with it
    Pl, _ = patch("Sacrum", "Hip bone.l", 0.006)
    Pr, _ = patch("Sacrum", "Hip bone.r", 0.006)
    Ph, _ = patch("Hip bone.l", "Sacrum", 0.006)
    sip = (Pl.mean(0) + Pr.mean(0)) / 2
    put("sacroiliac", "si", "m", mk_site(sip, axes(), ["Sacrum", "Coccyx", "Vertebra L5"], ["Hip bone.l", "Hip bone.r"], ct=Ph.mean(0), r=0.03))
    diag("si", sip)
    # temporomandibular: condyle spheres; both-sides site for opening/protrusion, one per side for the lateral excursion
    cond = {}
    for sd, sfx in (("l", ".l"), ("r", ".r")):
        Pm, _ = patch("Mandible", "Temporal bone" + sfx, 0.004)
        xs = Pm[:, 0]
        Pm = Pm[np.abs(xs) > 0.02]
        c, r = fit_sphere(Pm)
        Pt, _ = patch("Temporal bone" + sfx, "Mandible", 0.004)
        cond[sd] = (c, r, Pt.mean(0))
    mid = (cond["l"][0] + cond["r"][0]) / 2
    axm = clamp_axis(cond["l"][0] - cond["r"][0], X, 20, "condylar axis")
    mov = ["Mandible"] + LOWER_TEETH
    put("temporomandibular", "tmj", "m", mk_site(mid, axes(ml=axm), mov, ["Temporal bone.l", "Temporal bone.r"], ct=(cond["l"][2] + cond["r"][2]) / 2, r=cond["l"][1]))
    for sd in ("l", "r"):
        c, r, ct = cond[sd]
        put("temporomandibular", "tmjw", sd, mk_site(c, axes(), mov, ["Temporal bone" + (".l" if sd == "l" else ".r")], ct=ct, r=r, sd=sd))
    diag("tmj", mid, cond["l"][1], f"condylar axis {np.round(axm, 2).tolist()}")


build_axial()


# ============================================================== movements ====
# Each movement is a chain of ops, ordered proximal -> distal (outer -> inner: the last op is applied to the bones first).
#   R(site, axis, w)   rotation about the site's axis by  w * (disp - off)  degrees      (disp = the displayed angle)
#   T(site, axis, w)   translation along the site's axis by  w * (disp - off)  metres
#   C(site, axis, deg) constant rotation (a pre-pose, e.g. the knee flexed while the hip flexes)
# `probe` = (where, direction): the point of the moving segment named by `where` must move in `direction` for a positive
# angle; this fixes the sign of the rotation for each side. where: cent | ant post sup inf lat med (extreme point of the
# moving set) | low:<Bone> high:<Bone>. direction: ant post sup inf lat med (lat/med relative to the side).
def R(site, ax, w=1.0, probe=None):
    return {"k": "r", "s": site, "ax": ax, "v": w, "pr": probe}


def T(site, ax, w, probe=None):
    return {"k": "t", "s": site, "ax": ax, "v": w, "pr": probe}


def C(site, ax, deg, probe=None):
    return {"k": "c", "s": site, "ax": ax, "v": deg, "pr": probe}


def A(k, cv="", **kw):
    """arthrokinematics: k = rg (roll+glide) | spin | slide | rs (rotation + glide) | rgs; cv = which bone is convex: m(oving) | f(ixed)"""
    d = {"k": k, "cv": cv}
    d.update(kw)
    return d


MOVES_DEF = []   # (joint, name, dict)


def mv(joint, name, ops, rng, plane, probe=None, off=0.0, mag=1.0, unit="deg", arth=None, note="", circ=None, axis=None, main=None):
    MOVES_DEF.append((joint, name, dict(ops=ops, rng=rng, plane=plane, probe=probe, off=off, mag=mag, unit=unit, arth=arth or {}, note=note, circ=circ, axis=axis, main=main)))


AXIS_NAME = {"ml": "Mediolateral axis", "ap": "Anteroposterior axis", "vt": "Vertical axis", "lg": "Longitudinal axis", "ob": "Oblique axis"}
PLANE_OF = {"ml": "Sagittal plane", "ap": "Frontal plane", "vt": "Transverse plane", "lg": "Transverse plane", "ob": "Oblique plane"}

# ---- shoulder girdle -------------------------------------------------------------------------------------------
SCAP_UP = [R("sc", "ap", 0.11, ("lat", "sup")), R("ac", "ob", 0.22, ("low:Scapula", "lat"))]   # scapular upward rotation in the 2:1 scapulohumeral rhythm
mv("glenohumeral", "flexion", SCAP_UP + [R("gh", "ml", 0.67, ("cent", "ant"))], [0, 180], "Sagittal plane", main="gh", arth=A("spin", "m"),
   note="Arm elevation 0-180 deg = about 120 deg at the glenohumeral joint + 60 deg of scapular upward rotation (2:1 scapulohumeral rhythm). At the glenohumeral joint flexion is a spin of the humeral head in the glenoid.")
mv("glenohumeral", "abduction", SCAP_UP + [R("gh", "ap", 0.67, ("cent", "lat"))], [10, 180], "Frontal plane", off=10, main="gh", arth=A("rg", "m"),
   note="Arm-trunk angle 10-180 deg = about 115 deg at the glenohumeral joint + 55 deg of scapular upward rotation (2:1 scapulohumeral rhythm). The head rolls up the glenoid while gliding down.")
mv("glenohumeral", "extension", [R("gh", "ml", 1.0, ("cent", "post"))], [0, 60], "Sagittal plane", main="gh", arth=A("spin", "m"))
mv("glenohumeral", "adduction", [R("gh", "ap", 1.0, ("cent", "med"))], [10, -10], "Frontal plane", off=10, main="gh", arth=A("rg", "m"),
   note="Adduction below the vertical is limited by the trunk; the head rolls down and glides up.")
mv("glenohumeral", "medial-rotation", [R("gh", "lg", 1.0, ("ant", "med"))], [0, 70], "Transverse plane", main="gh", arth=A("spin", "m"))
mv("glenohumeral", "lateral-rotation", [R("gh", "lg", 1.0, ("ant", "lat"))], [0, 90], "Transverse plane", main="gh", arth=A("spin", "m"))
mv("glenohumeral", "horizontal-abduction", [R("gh", "vt", 1.0, ("lat", "post")), C("gh", "ap", 90, ("cent", "lat"))], [0, 45], "Transverse plane", main="gh", arth=A("rg", "m"),
   note="Starts with the arm abducted to 90 deg; the arm sweeps backward in the horizontal plane.")
mv("glenohumeral", "horizontal-adduction", [R("gh", "vt", 1.0, ("lat", "ant")), C("gh", "ap", 90, ("cent", "lat"))], [0, 130], "Transverse plane", main="gh", arth=A("rg", "m"),
   note="Starts with the arm abducted to 90 deg; the arm sweeps forward across the chest.")
mv("glenohumeral", "circumduction", [], [0, 360], "Cone (all planes)", main="gh", arth=A("rgs", "m"), unit="cone",
   circ={"a": ("gh", "ap", ("cent", "lat")), "b": ("gh", "ml", ("cent", "ant")), "amp": 55},
   note="A cone sweep combining flexion, abduction, extension and adduction in sequence; the humeral head rolls and spins on the glenoid.")
# scapulothoracic (functional joint): the clavicle carries the scapula; protraction/retraction slide the scapula around the ribs
mv("scapulothoracic", "elevation", [R("sc", "ap", 1.0, ("lat", "sup"))], [0, 25], "Frontal plane", main="sc", arth=A("slide"))
mv("scapulothoracic", "depression", [R("sc", "ap", 1.0, ("lat", "inf"))], [0, 10], "Frontal plane", main="sc", arth=A("slide"))
mv("scapulothoracic", "protraction", [R("thx", "vt", 1.0, ("lat", "ant"))], [0, 20], "Transverse plane", main="thx", arth=A("slide"),
   note="The scapula glides forward around the curve of the rib cage (drawn as a rotation about the centre of the thorax).")
mv("scapulothoracic", "retraction", [R("thx", "vt", 1.0, ("lat", "post"))], [0, 20], "Transverse plane", main="thx", arth=A("slide"))
mv("scapulothoracic", "upward-rotation", [R("sc", "ap", 0.4, ("lat", "sup")), R("ac", "ob", 0.6, ("low:Scapula", "lat"))], [0, 60], "Frontal plane (scapular plane)", main="ac", arth=A("slide"),
   note="Scapular upward rotation = clavicular elevation at the sternoclavicular joint + rotation at the acromioclavicular joint.")
mv("scapulothoracic", "downward-rotation", [R("sc", "ap", 0.4, ("lat", "sup")), R("ac", "ob", 0.6, ("low:Scapula", "lat"))], [60, 0], "Frontal plane (scapular plane)", main="ac", arth=A("slide"),
   note="Return from full upward rotation: the glenoid turns back to face laterally.")
mv("sternoclavicular", "elevation", [R("sc", "ap", 1.0, ("lat", "sup"))], [0, 40], "Frontal plane", main="sc", arth=A("rg", "m"),
   note="Clavicle (convex in the vertical direction) on the concave manubrium: roll and glide are opposite.")
mv("sternoclavicular", "depression", [R("sc", "ap", 1.0, ("lat", "inf"))], [0, 10], "Frontal plane", main="sc", arth=A("rg", "m"))
mv("sternoclavicular", "protraction", [R("sc", "vt", 1.0, ("lat", "ant"))], [0, 20], "Transverse plane", main="sc", arth=A("rg", "f"),
   note="In the horizontal direction the concave clavicular end moves on the convex manubrium: roll and glide are the same direction.")
mv("sternoclavicular", "retraction", [R("sc", "vt", 1.0, ("lat", "post"))], [0, 20], "Transverse plane", main="sc", arth=A("rg", "f"))
mv("acromioclavicular", "upward-rotation", [R("ac", "ob", 1.0, ("low:Scapula", "lat"))], [0, 30], "Frontal plane (scapular plane)", main="ac", arth=A("slide"))
mv("acromioclavicular", "downward-rotation", [R("ac", "ob", 1.0, ("low:Scapula", "med"))], [0, 15], "Frontal plane (scapular plane)", main="ac", arth=A("slide"))

# ---- elbow and forearm -----------------------------------------------------------------------------------------
mv("elbow", "flexion", [R("elb", "ml", 1.0, ("cent", "ant"))], [0, 145], "Sagittal plane", main="elb", arth=A("rg", "f"),
   note="Concave trochlear notch of the ulna (and radial head) moves on the convex trochlea and capitulum: roll and glide are the same direction (anterior).")
mv("elbow", "extension", [R("elb", "ml", 1.0, ("cent", "ant"))], [145, 0], "Sagittal plane", main="elb", arth=A("rg", "f"),
   note="Roll and glide are both posterior; the olecranon enters its fossa at the end of extension.")
mv("radioulnar", "pronation", [R("ru", "lg", 1.0, ("ant", "med"))], [0, 80], "Transverse plane (around the forearm)", main="ru", arth=A("rs", "f"),
   note="The radial head spins in the annular ligament while the concave distal radius rolls and glides over the convex ulnar head; the radius crosses in front of the ulna.")
mv("radioulnar", "supination", [R("ru", "lg", 1.0, ("ant", "med"))], [80, 0], "Transverse plane (around the forearm)", main="ru", arth=A("rs", "f"),
   note="Return to the anatomical position: the radius uncrosses and the palm turns forward.")
# ---- wrist and hand ---------------------------------------------------------------------------------------------
mv("wrist", "flexion", [R("wr", "ml", 1.0, ("cent", "ant"))], [0, 80], "Sagittal plane", main="wr", arth=A("rg", "m"))
mv("wrist", "extension", [R("wr", "ml", 1.0, ("cent", "post"))], [0, 70], "Sagittal plane", main="wr", arth=A("rg", "m"))
mv("wrist", "radial-deviation", [R("wr", "ap", 1.0, ("cent", "lat"))], [0, 20], "Frontal plane", main="wr", arth=A("rg", "m"))
mv("wrist", "ulnar-deviation", [R("wr", "ap", 1.0, ("cent", "med"))], [0, 30], "Frontal plane", main="wr", arth=A("rg", "m"))
mv("wrist", "circumduction", [], [0, 360], "Cone (all planes)", main="wr", arth=A("rg", "m"), unit="cone",
   circ={"a": ("wr", "ml", ("cent", "ant")), "b": ("wr", "ap", ("cent", "lat")), "amp": 22})
mv("carpometacarpal-1", "flexion", [R("cmc1", "ap", 1.0, ("cent", "med"))], [0, 20], "Frontal plane (plane of the palm)", main="cmc1", arth=A("rg", "f"),
   note="Saddle joint: in this direction the concave metacarpal base moves on the convex trapezium.")
mv("carpometacarpal-1", "extension", [R("cmc1", "ap", 1.0, ("cent", "lat"))], [0, 20], "Frontal plane (plane of the palm)", main="cmc1", arth=A("rg", "f"))
mv("carpometacarpal-1", "abduction", [R("cmc1", "ml", 1.0, ("cent", "ant"))], [0, 70], "Sagittal plane (palmar abduction)", main="cmc1", arth=A("rg", "m"),
   note="In the other direction of the saddle the convex metacarpal base moves on the concave trapezium.")
mv("carpometacarpal-1", "adduction", [R("cmc1", "ml", 1.0, ("cent", "post"))], [0, 20], "Sagittal plane", main="cmc1", arth=A("rg", "m"))
mv("carpometacarpal-1", "opposition", [R("cmc1", "ml", 1.0, ("cent", "ant")), R("cmc1", "ap", 0.7, ("cent", "med"))], [0, 45], "Combined (abduction + flexion)", main="cmc1", arth=A("rgs", "m"),
   note="Opposition = palmar abduction + flexion (axial rotation of the thumb is not drawn).")
FINGERS = (2, 3, 4, 5)
mv("metacarpophalangeal", "flexion", [R("mcp1", "ap", 0.55, ("cent", "med"))] + [R(f"mcp{i}", "ml", 1.0, ("cent", "ant")) for i in FINGERS], [0, 90], "Sagittal plane", main="mcp2", arth=A("rg", "f"),
   note="Concave base of the proximal phalanx on the convex metacarpal head: roll and glide are the same direction (palmar).")
mv("metacarpophalangeal", "extension", [R("mcp1", "ap", 0.35, ("cent", "lat"))] + [R(f"mcp{i}", "ml", 1.0, ("cent", "post")) for i in FINGERS], [0, 30], "Sagittal plane", main="mcp2", arth=A("rg", "f"))
mv("metacarpophalangeal", "abduction", [R(f"mcp{i}", "ap", 1.0, ("cent", "lat" if i <= 3 else "med")) for i in FINGERS], [0, 20], "Frontal plane", main="mcp2", arth=A("rg", "f"),
   note="Fingers spread away from the middle finger.")
mv("metacarpophalangeal", "adduction", [R(f"mcp{i}", "ap", 1.0, ("cent", "med" if i <= 3 else "lat")) for i in FINGERS], [0, 20], "Frontal plane", main="mcp2", arth=A("rg", "f"),
   note="Fingers close toward the middle finger.")
mv("interphalangeal-hand", "flexion", [R("ip1", "ap", 1.0, ("cent", "med"))] + [x for i in FINGERS for x in (R(f"pip{i}", "ml", 1.0, ("cent", "ant")), R(f"dip{i}", "ml", 0.7, ("cent", "ant")))], [0, 100], "Sagittal plane", main="pip2", arth=A("rg", "f"))
mv("interphalangeal-hand", "extension", [R("ip1", "ap", 1.0, ("cent", "med"))] + [x for i in FINGERS for x in (R(f"pip{i}", "ml", 1.0, ("cent", "ant")), R(f"dip{i}", "ml", 0.7, ("cent", "ant")))], [100, 0], "Sagittal plane", main="pip2", arth=A("rg", "f"))

# ---- hip and leg -----------------------------------------------------------------------------------------------
mv("hip", "flexion", [R("hip", "ml", 1.0, ("cent", "ant")), C("knee", "ml", 90, ("cent", "post"))], [0, 120], "Sagittal plane", main="hip", arth=A("spin", "m"),
   note="Shown with the knee bent (a straight leg is limited to ~90 deg by the hamstrings). The femoral head spins in the acetabulum.")
mv("hip", "extension", [R("hip", "ml", 1.0, ("cent", "post"))], [0, 30], "Sagittal plane", main="hip", arth=A("spin", "m"))
mv("hip", "abduction", [R("hip", "ap", 1.0, ("cent", "lat"))], [0, 45], "Frontal plane", main="hip", arth=A("rg", "m"),
   note="Femoral head rolls up the acetabulum while gliding down.")
mv("hip", "adduction", [R("hip", "ap", 1.0, ("cent", "med"))], [0, 30], "Frontal plane", main="hip", arth=A("rg", "m"))
mv("hip", "medial-rotation", [R("hip", "lg", 1.0, ("ant", "med"))], [0, 40], "Transverse plane", main="hip", arth=A("spin", "m"))
mv("hip", "lateral-rotation", [R("hip", "lg", 1.0, ("ant", "lat"))], [0, 45], "Transverse plane", main="hip", arth=A("spin", "m"))
mv("hip", "circumduction", [], [0, 360], "Cone (all planes)", main="hip", arth=A("rgs", "m"), unit="cone",
   circ={"a": ("hip", "ap", ("cent", "lat")), "b": ("hip", "ml", ("cent", "ant")), "amp": 30})
mv("knee", "flexion", [R("knee", "ml", 1.0, ("cent", "post")), R("pat", "ml", 0.5, ("cent", "inf"))], [0, 135], "Sagittal plane", main="knee", arth=A("rg", "f"),
   note="Open chain: the concave tibial plateau rolls and glides posteriorly on the convex femoral condyles (same direction). The patella slides down the trochlear groove.")
mv("knee", "extension", [R("knee", "ml", 1.0, ("cent", "post")), R("pat", "ml", 0.5, ("cent", "inf"))], [135, 0], "Sagittal plane", main="knee", arth=A("rg", "f"),
   note="Roll and glide are both anterior. In the last ~20 deg the tibia rotates laterally ~10 deg (screw-home) to lock the knee.")
mv("knee", "medial-rotation", [C("knee", "ml", 90, ("cent", "post")), R("knee", "lg", 1.0, ("inf", "med"))], [0, 10], "Transverse plane (knee flexed 90 deg)", main="knee", arth=A("spin", "f"),
   note="Only possible with the knee flexed; the tibia spins under the femoral condyles.")
mv("knee", "lateral-rotation", [C("knee", "ml", 90, ("cent", "post")), R("knee", "lg", 1.0, ("inf", "lat"))], [0, 30], "Transverse plane (knee flexed 90 deg)", main="knee", arth=A("spin", "f"))
mv("ankle", "dorsiflexion", [R("ank", "ml", 1.0, ("ant", "sup"))], [0, 20], "Sagittal plane", main="ank", arth=A("rg", "m"),
   note="Convex talar dome in the concave mortise: the talus rolls anteriorly and glides posteriorly.")
mv("ankle", "plantarflexion", [R("ank", "ml", 1.0, ("ant", "inf"))], [0, 50], "Sagittal plane", main="ank", arth=A("rg", "m"),
   note="The talus rolls posteriorly and glides anteriorly.")
mv("subtalar", "inversion", [R("st", "ob", 1.0, ("med", "sup"))], [0, 35], "Oblique (triplanar)", main="st", arth=A("slide"),
   note="Calcaneus glides on the talus about the oblique subtalar axis; the sole turns inward.")
mv("subtalar", "eversion", [R("st", "ob", 1.0, ("med", "inf"))], [0, 15], "Oblique (triplanar)", main="st", arth=A("slide"))
mv("metatarsophalangeal", "flexion", [R(f"mtp{i}", "ml", 1.0, ("cent", "inf")) for i in (1, 2, 3, 4, 5)], [0, 40], "Sagittal plane", main="mtp1", arth=A("rg", "f"))
mv("metatarsophalangeal", "extension", [R(f"mtp{i}", "ml", 1.0, ("cent", "sup")) for i in (1, 2, 3, 4, 5)], [0, 70], "Sagittal plane", main="mtp1", arth=A("rg", "f"),
   note="Extension of the great toe is needed for the push-off phase of walking.")
mv("metatarsophalangeal", "abduction", [R(f"mtp{i}", "vt", 1.0, ("cent", "med" if i <= 2 else "lat")) for i in (1, 2, 3, 4, 5)], [0, 15], "Transverse plane", main="mtp1", arth=A("rg", "f"),
   note="Toes spread away from the second toe.")
mv("metatarsophalangeal", "adduction", [R(f"mtp{i}", "vt", 1.0, ("cent", "lat" if i <= 2 else "med")) for i in (1, 2, 3, 4, 5)], [0, 15], "Transverse plane", main="mtp1", arth=A("rg", "f"))
TOE_FLEX = [R("ip1", "ml", 1.0, ("cent", "inf"))] + [x for i in (2, 3, 4, 5) for x in (R(f"pip{i}", "ml", 1.0, ("cent", "inf")), R(f"dip{i}", "ml", 0.6, ("cent", "inf")))]
mv("interphalangeal-foot", "flexion", TOE_FLEX, [0, 60], "Sagittal plane", main="pip2", arth=A("rg", "f"))
mv("interphalangeal-foot", "extension", TOE_FLEX, [60, 0], "Sagittal plane", main="pip2", arth=A("rg", "f"))

# ---- head, neck, trunk -------------------------------------------------------------------------------------------
mv("atlanto-occipital", "flexion", [R("ao", "ml", 1.0, ("ant", "inf"))], [0, 15], "Sagittal plane", main="ao", arth=A("rg", "m"),
   note="'Yes' nodding: the convex occipital condyles roll forward on the concave atlas facets while gliding backward.")
mv("atlanto-occipital", "extension", [R("ao", "ml", 1.0, ("ant", "sup"))], [0, 20], "Sagittal plane", main="ao", arth=A("rg", "m"))
mv("atlanto-occipital", "lateral-flexion", [R("ao", "ap", 1.0, ("sup", "lat"))], [0, 8], "Frontal plane", main="ao", arth=A("rg", "m"))
mv("atlanto-axial", "rotation", [R("aa", "vt", 1.0, ("ant", "lat"))], [0, 45], "Transverse plane", main="aa", arth=A("spin", ""),
   note="'No' shaking: the atlas ring pivots around the dens of the axis, carrying the skull.")


def spine_moves(joint, keys, tot, w_flex, w_ext, w_lat, w_rot):
    """chain of level sites; keys sorted from caudal (outer) to cranial (inner); weights are the share of the total ROM per site"""
    keys = sorted(keys, key=lambda k: -int(k[1:]))
    for name, ax, probe, rng_, ws in (
            ("flexion", "ml", ("sup", "ant"), [0, tot["flexion"]], w_flex), ("extension", "ml", ("sup", "post"), [0, tot["extension"]], w_ext),
            ("lateral-flexion", "ap", ("sup", "lat"), [0, tot["lateral-flexion"]], w_lat), ("rotation", "vt", ("ant", "lat"), [0, tot["rotation"]], w_rot)):
        ops = [R(k, ax, ws[k], probe) for k in keys if ws.get(k, 0) > 0]
        mv(joint, name, ops, rng_, {"ml": "Sagittal plane", "ap": "Frontal plane", "vt": "Transverse plane"}[ax], main=keys[len(keys) // 2], arth=A("slide"),
           note="Zygapophyseal (facet) joints glide; the sum of the small movements at every level gives the total range.")


def even(keys, total=1.0):
    return {k: total / len(keys) for k in keys}


CER = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]
spine_moves("cervical-spine", CER, dict(flexion=50, extension=60, **{"lateral-flexion": 40}, rotation=75),
            dict(zip(CER, [0.10, 0.06, 0.10, 0.14, 0.17, 0.17, 0.14, 0.12])), dict(zip(CER, [0.14, 0.06, 0.10, 0.14, 0.16, 0.16, 0.12, 0.12])),
            dict(zip(CER, [0.08, 0.05, 0.14, 0.17, 0.17, 0.17, 0.14, 0.08])), dict(zip(CER, [0.0, 0.55, 0.09, 0.09, 0.09, 0.08, 0.06, 0.04])))
THO = [f"t{b}" for b in range(8, 20)]
spine_moves("thoracic-spine", THO, dict(flexion=40, extension=25, **{"lateral-flexion": 30}, rotation=35), even(THO), even(THO), even(THO), even(THO))
LUM = [f"l{b}" for b in range(20, 25)]
spine_moves("lumbar-spine", LUM, dict(flexion=60, extension=25, **{"lateral-flexion": 25}, rotation=12), even(LUM), even(LUM), even(LUM), even(LUM))
mv("thoracic-cage", "pump-handle", [R("pump", "ml", 1.0, ("ant", "sup"))], [0, 15], "Sagittal plane", main="pump", arth=A("spin", ""),
   note="Upper ribs (1-6) rotate about their neck axis (mostly transverse): the sternum rises and moves forward, increasing the AP diameter of the thorax.")
mv("thoracic-cage", "bucket-handle", [R("bucketl", "ap", 1.0, ("lat", "sup")), R("bucketr", "ap", 1.0, ("lat", "sup"))], [0, 12], "Frontal plane", main="bucketl", arth=A("spin", ""),
   note="Lower ribs (7-10) rotate about an axis nearer anteroposterior: the lateral margin rises like a bucket handle, increasing the transverse diameter.")
mv("sacroiliac", "nutation", [R("si", "ml", 1.0, ("sup", "ant"))], [0, 3], "Sagittal plane", mag=4, main="si", arth=A("slide"),
   note="Real range is only 2-4 deg; drawn 4x so it can be seen. The sacral promontory moves forward and down.")
mv("sacroiliac", "counternutation", [R("si", "ml", 1.0, ("sup", "post"))], [0, 3], "Sagittal plane", mag=4, main="si", arth=A("slide"),
   note="Real range is only 2-4 deg; drawn 4x so it can be seen. The promontory moves backward and up.")
mv("temporomandibular", "depression", [R("tmj", "ml", 1.0, ("ant", "inf")), T("tmj", "ap", 0.0004, ("cent", "ant"))], [0, 25], "Sagittal plane", main="tmj", arth=A("rs", ""),
   note="Opening: the condyle first rotates (spins) in the lower joint space, then glides forward with the disc beneath the articular eminence.")
mv("temporomandibular", "elevation", [R("tmj", "ml", 1.0, ("ant", "inf")), T("tmj", "ap", 0.0004, ("cent", "ant"))], [25, 0], "Sagittal plane", main="tmj", arth=A("rs", ""))
mv("temporomandibular", "protrusion", [T("tmj", "ap", 0.001, ("cent", "ant"))], [0, 10], "Sagittal plane", unit="mm", main="tmj", arth=A("slide"),
   note="Both condyles glide forward with the discs in the upper joint space; no rotation.")
mv("temporomandibular", "retrusion", [T("tmj", "ap", 0.001, ("cent", "post"))], [0, 4], "Sagittal plane", unit="mm", main="tmj", arth=A("slide"))
mv("temporomandibular", "lateral-excursion", [R("tmjw", "vt", 1.0, ("ant", "lat"))], [0, 8], "Transverse plane", main="tmjw", arth=A("rs", ""),
   note="Chin moves toward the working side: that condyle spins while the other (balancing) condyle glides forward and inward.")

# --------------------------------------------------------------- joint info --
INFO = {
    "atlanto-occipital": dict(type="Condyloid", fixed="Atlas (C1)", moving="Skull", cp="Full extension", loose="Neutral"),
    "atlanto-axial": dict(type="Pivot", fixed="Axis (C2)", moving="Atlas + skull", cp="Not well defined (full rotation tightens the alar ligaments)", loose="Neutral"),
    "cervical-spine": dict(type="Facet (plane) joints + discs", fixed="Trunk", moving="Head and cervical vertebrae above each level", cp="Full extension", loose="Midway between flexion and extension"),
    "thoracic-spine": dict(type="Facet (plane) joints + discs", fixed="Lower trunk", moving="Vertebrae, ribs, sternum, shoulder girdle and head above each level", cp="Full extension", loose="Midway between flexion and extension"),
    "lumbar-spine": dict(type="Facet (plane) joints + discs", fixed="Sacrum / pelvis", moving="Everything above each lumbar level", cp="Full extension", loose="Midway between flexion and extension"),
    "thoracic-cage": dict(type="Costovertebral + costotransverse (plane / pivot)", fixed="Vertebral column", moving="Ribs, costal cartilages and sternum", cp="Full inspiration", loose="Resting expiration"),
    "sacroiliac": dict(type="Plane (synovial + fibrous)", fixed="Hip bones", moving="Sacrum with the spine above", cp="Nutation", loose="Counternutation"),
    "temporomandibular": dict(type="Modified hinge (condylar) with a disc", fixed="Temporal bone", moving="Mandible", cp="Teeth clenched", loose="Mouth slightly open, at rest"),
    "sternoclavicular": dict(type="Saddle with a disc", fixed="Manubrium of sternum", moving="Clavicle, scapula and arm", cp="Full shoulder elevation", loose="Arm resting by the side"),
    "acromioclavicular": dict(type="Plane (gliding)", fixed="Clavicle", moving="Scapula and arm", cp="Arm abducted to 90 deg", loose="Arm resting by the side"),
    "scapulothoracic": dict(type="Functional (scapula gliding on the ribs)", fixed="Rib cage", moving="Scapula, clavicle and arm", cp="None (not a synovial joint)", loose="Arm resting by the side"),
    "glenohumeral": dict(type="Ball and socket", fixed="Scapula (glenoid)", moving="Humerus and forearm", cp="Abduction + lateral rotation", loose="55 deg abduction, 30 deg horizontal adduction"),
    "elbow": dict(type="Hinge", fixed="Humerus", moving="Radius, ulna and hand", cp="Extension with supination", loose="70 deg flexion, 10 deg supination"),
    "radioulnar": dict(type="Pivot (proximal and distal)", fixed="Ulna", moving="Radius and hand", cp="5 deg supination", loose="35 deg supination, 70 deg elbow flexion"),
    "wrist": dict(type="Condyloid", fixed="Radius and ulna", moving="Carpals, metacarpals and fingers", cp="Extension with radial deviation", loose="Neutral, slight ulnar deviation"),
    "carpometacarpal-1": dict(type="Saddle", fixed="Trapezium", moving="Thumb metacarpal and phalanges", cp="Full opposition", loose="Midway between abduction/adduction and flexion/extension"),
    "metacarpophalangeal": dict(type="Condyloid", fixed="Metacarpals", moving="Finger phalanges", cp="Full flexion", loose="Slight flexion with ulnar deviation"),
    "interphalangeal-hand": dict(type="Hinge", fixed="Proximal phalanx", moving="Distal phalanges", cp="Full extension", loose="Slight flexion"),
    "hip": dict(type="Ball and socket", fixed="Hip bone (acetabulum)", moving="Femur and leg", cp="Extension + medial rotation + abduction", loose="30 deg flexion, 30 deg abduction, slight lateral rotation"),
    "knee": dict(type="Modified hinge (bicondylar)", fixed="Femur", moving="Tibia, fibula and foot", cp="Full extension with tibial lateral rotation", loose="25 deg flexion"),
    "ankle": dict(type="Hinge (mortise)", fixed="Tibia and fibula", moving="Talus and foot", cp="Full dorsiflexion", loose="10 deg plantarflexion"),
    "subtalar": dict(type="Plane (gliding)", fixed="Talus", moving="Calcaneus and forefoot", cp="Full supination (inversion)", loose="Midway between inversion and eversion"),
    "metatarsophalangeal": dict(type="Condyloid", fixed="Metatarsals", moving="Toe phalanges", cp="Full extension", loose="Neutral"),
    "interphalangeal-foot": dict(type="Hinge", fixed="Proximal phalanx", moving="Distal phalanges", cp="Full extension", loose="Slight flexion"),
}


# =========================================================== sign resolution ==
# cross-joint site links used by coupled movements
SITES["glenohumeral"]["sc"] = SITES["sternoclavicular"]["sc"]
SITES["glenohumeral"]["ac"] = SITES["acromioclavicular"]["ac"]
SITES["hip"]["knee"] = SITES["knee"]["knee"]


def site_lookup(joint, key, side):
    d = SITES[joint][key]
    return d.get(side) or d.get("m")


def ids_of(site):
    ids = set(site["mov"])
    if "upTo" in site:
        ids |= {k for k, l in LEVEL.items() if l <= site["upTo"]}
    return sorted(i for i in ids if i in B)


def rotm(axis, ang):
    a = unit(axis)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * (K @ K)


def dirvec(name, side):
    s = SIGN[side]
    return {"ant": Z, "post": -Z, "sup": Y, "inf": -Y, "lat": s * X, "med": -s * X}[name]


def apply_states(P, lab, states):
    """states: ops ordered outer -> inner, applied to a point cloud (inner first); each state moves only its own segment"""
    P = P.copy()
    for st in reversed(states):
        if st["val"] == 0:
            continue
        m = np.isin(lab, st["ids"])
        if not m.any():
            continue
        if st["kind"] == "t":
            P[m] = P[m] + st["ax"] * st["val"]
        else:
            R = rotm(st["ax"], math.radians(st["val"]))
            P[m] = (P[m] - st["p"]) @ R.T + st["p"]
    return P


def op_state(joint, op, side, val):
    site = site_lookup(joint, op["s"], side)
    return {"kind": op["k"], "p": site["p"], "ax": site["ax"][op["ax"]], "val": val, "ids": ids_of(site)}


def cloud_for(site, per_bone=300):
    P, L = [], []
    for i in ids_of(site):
        S = B[i].samples(2000)[:per_bone]
        P.append(S)
        L += [i] * len(S)
    return np.vstack(P), np.array(L)


def pick(kind, P, L, side):
    """indices of the probe points inside cloud P (already in the base pose)"""
    if kind == "cent":
        return np.arange(len(P))
    if kind.startswith("low:") or kind.startswith("high:"):
        which, base = kind.split(":")
        sel = np.where(L == bid(base, side))[0]
        if not len(sel):
            raise KeyError(f"probe bone {base} not in the moving set")
        order = sel[np.argsort(P[sel, 1])]
        k = max(int(len(order) * 0.08), 5)
        return order[:k] if which == "low" else order[-k:]
    dv = dirvec(kind, side)
    k = max(int(len(P) * 0.02), 6)
    return np.argsort(P @ dv)[-k:]


def resolve(joint, d, side):
    """-> (signs per op, probe start point) for one side (for midline joints `side` is the direction toggle)"""
    ops = d["ops"]
    signs = [1.0] * len(ops)
    resolved = [False] * len(ops)
    default = d["probe"]

    def states(test=None, mag_eps=0.0):
        out = []
        for i, op in enumerate(ops):
            if op["k"] == "c":
                val = signs[i] * op["v"] if resolved[i] else 0.0
            else:
                val = 0.0
            if test is not None and i == test:
                val = mag_eps if op["k"] == "c" else mag_eps
            out.append(op_state(joint, op, side, val))
        return out

    order = [i for i, o in enumerate(ops) if o["k"] == "c"] + [i for i, o in enumerate(ops) if o["k"] != "c"]
    first_pr = None
    for i in order:
        op = ops[i]
        pr = op["pr"] or default
        site = site_lookup(joint, op["s"], side)
        eff_side = site.get("sd") or side
        P, L = cloud_for(site)
        base = apply_states(P, L, states())
        idx = pick(pr[0], base, L, eff_side)
        eps = 0.003 if op["k"] == "t" else 3.0
        moved = apply_states(P[idx], L[idx], states(test=i, mag_eps=eps))
        # displacement of the probe points caused by op i alone (all other ops at their base values)
        disp_v = (moved - apply_states(P[idx], L[idx], states())).mean(0)
        sc = float(disp_v @ dirvec(pr[1], eff_side))
        if abs(sc) < 1e-6:
            log(f"WARN {joint}.{op['s']}: probe {pr} barely moves ({sc:.2e}) - sign is a guess")
        signs[i] = 1.0 if sc >= 0 else -1.0
        resolved[i] = True
        if op["k"] != "c" and first_pr is None:
            first_pr = base[idx].mean(0)
    if first_pr is None:
        first_pr = np.zeros(3)
    return signs, first_pr


def resolve_circ(joint, d, side):
    out = {}
    for tag in ("a", "b"):
        site_key, ax, pr = d["circ"][tag]
        op = R(site_key, ax, 1.0, pr)
        dd = dict(d, ops=[op], probe=pr)
        s_, _ = resolve(joint, dd, side)
        out[tag] = [site_key, ax, s_[0]]
    return out


def reach_of(site):
    ids = ids_of(site)
    if not ids:
        return 0.1
    return float(min(max(np.linalg.norm(B[i].V - site["p"], axis=1).max() for i in ids), 0.6))


def site_out(site):
    o = {"p": r3(site["p"]), "ct": r3(site["ct"]), "r": round(site["r"], 4), "reach": round(reach_of(site), 3),
         "ax": {k: r3(v) for k, v in site["ax"].items() if k in ("ml", "ap", "vt", "lg", "ob")}, "fix": site["fix"]}
    if "upTo" in site:
        o["upTo"] = site["upTo"]
    if site["mov"]:
        o["mov"] = site["mov"]
    if site.get("sd"):
        o["sd"] = site["sd"]
    return o


# ================================================================== output ====
vocab = json.load(open(os.path.join(os.path.dirname(args.out), "vocab.json"), encoding="utf-8"))
only = {j for j in args.only.split(",") if j}
joints_out = {}
missing = []
defined = {(j, n) for j, n, _ in MOVES_DEF}
for j, jd in vocab["joints"].items():
    for m in jd["movements"]:
        if (j, m) not in defined:
            missing.append(f"{j}.{m}")
for j, n, d in MOVES_DEF:
    if j not in vocab["joints"] or n not in vocab["joints"][j]["movements"]:
        log(f"WARN {j}.{n} is not in vocab.json")
if missing:
    log("MISSING movements (defined in vocab.json, no animation):", ", ".join(missing))

used_sites = {}
for joint, name, d in MOVES_DEF:
    if only and joint not in only:
        continue
    jo = joints_out.setdefault(joint, {"info": INFO.get(joint, {}), "sites": {}, "moves": {}})
    ops = d["ops"]
    mo = {"range": d["rng"], "off": d["off"], "mag": d["mag"], "unit": d["unit"], "plane": d["plane"], "note": d["note"], "arth": d["arth"], "main": d["main"]}
    prs, sg = {}, {"l": None, "r": None}
    for side in ("l", "r"):
        if d["circ"]:
            sg[side] = None
            mo.setdefault("circ", {}).update({side: resolve_circ(joint, d, side)})
            mo["circ"]["amp"] = d["circ"]["amp"]
            first = site_lookup(joint, d["circ"]["a"][0], side)
            prs[side] = r3(first["p"])
        else:
            s_, pr = resolve(joint, d, side)
            sg[side] = s_
            prs[side] = r3(pr)
    if not d["circ"]:
        mo["ops"] = [[o["s"], o["ax"], o["k"], o["v"], sg["l"][i], sg["r"][i]] for i, o in enumerate(ops)]
        first_mov = next((o for o in ops if o["s"] == d["main"] and o["k"] != "c"), None) or next(o for o in ops if o["k"] != "c")
        mo["axName"] = first_mov["ax"]         # the axis of the movement at the joint the tab is about (not of a coupled helper joint)
    else:
        mo["ops"] = []
        mo["axName"] = d["circ"]["a"][1]
    mo["axis"] = AXIS_NAME[mo["axName"]]
    mo["pr"] = prs
    for o in ops:
        used_sites.setdefault(joint, set()).add(o["s"])
    if d["circ"]:
        for tag in ("a", "b"):
            used_sites.setdefault(joint, set()).add(d["circ"][tag][0])
    jo["moves"][name] = mo
    log(f"move {joint}.{name}: signs l={sg['l']} r={sg['r']}")

for joint, jo in joints_out.items():
    for key in sorted(used_sites.get(joint, ())):
        jo["sites"][key] = {sd: site_out(st) for sd, st in SITES[joint][key].items()}

# ---- self-check: the displayed axis/plane text must describe the op that actually carries the joint's main movement,
# not just ops[0] (a coupled helper joint, e.g. the scapular contribution to glenohumeral flexion, can come first in
# the op list while the joint's own rotation - what "main" names - comes later). Mirrors the axName derivation above
# exactly, so it also catches a future edit that breaks that derivation. Circumduction has no single op to check.
axis_mismatches = []
for joint, jo in joints_out.items():
    for name, mo in jo["moves"].items():
        if mo.get("circ"):
            continue
        cand = [o for o in mo["ops"] if o[0] == mo["main"] and o[2] != "c"]
        expect = cand[0][1] if cand else next(o[1] for o in mo["ops"] if o[2] != "c")
        if mo["axName"] != expect:
            axis_mismatches.append(f"{joint}.{name}: displayed axName={mo['axName']!r} but the main={mo['main']!r} op uses ax={expect!r}")
n_axis_checked = sum(1 for j in joints_out.values() for m in j["moves"].values() if not m.get("circ"))
if axis_mismatches:
    log(f"AXIS LABEL SELF-CHECK: {len(axis_mismatches)} mismatch(es) of {n_axis_checked} checked:\n  " + "\n  ".join(axis_mismatches))
else:
    log(f"axis-label self-check: {n_axis_checked}/{n_axis_checked} movements OK (circumduction excluded, not applicable)")

OUT = {"version": 1, "about": "Baked by tools/export_motions.py from the Z-Anatomy skeleton; see the header of that script for the schema.",
       "levels": LEVELS_OUT, "joints": joints_out}
if not args.check and not args.render:
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(OUT, f, ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {args.out}: {os.path.getsize(args.out) / 1024:.0f} KB, {sum(len(j['moves']) for j in joints_out.values())} movements in {len(joints_out)} joints")
