# Z-Anatomy Atlas

Interactive 3D human anatomy atlas built from the Z-Anatomy Blender scene (`Startup.blend`):
7,184 objects, ~3,900 anatomical structures across 9 body systems, ~1,100 landmarks, 3,800 descriptions.

```
Startup.blend ──(tools/export_web.py, Blender 5.2)──▶ web/models/*.glb  web/data/*.json
              ──(tools/render_views.py)────────────▶ renders/*.png      web/img/*.png
web/  = the static site (index.html + js/ + css/ + models/ + data/ + img/), no build step
```

## Folder map

| Path | What |
|---|---|
| `Startup.blend` | Source scene (≈300 MB, **git-ignored**: over GitHub's 100 MB file limit) |
| `__init__.py`, `Anatomy-shortcuts.py`, `Anatomy_*.xml`, `splash.png` | The Z-Anatomy Blender add-on, keymap and themes |
| `zclassify.py` | Shared classifier: system / CNS-PNS / joint type / cartilage from the scene's own group hierarchy. Used by the Blender **Anatomy Navigator** panel *and* the web export, so both navigate identically |
| `tools/render_views.py` | Studio renders (every system × front/back/¾/side, coloured, dark background) |
| `tools/export_web.py` | Draco GLB per system (+ manifest, descriptions, translations) |
| `tools/zcommon.py` | Colour palette (Z-Anatomy's comic-shader materials can't be exported, so each is mapped to a Principled colour) |
| `tools/test_navigator.py` | Regression test for the Blender navigator against the real scene |
| `tools/fix_source_integrity.py` | Repairs the scene from its geometry: left/right names on the wrong side, mirrored landmark pins, lost names, structures under the wrong group (dry run by default) |
| `tools/muscle_facts.txt` → `build_muscle_facts.py` | Curated origin / insertion / action / nerve + joint actions → `web/data/muscles.json` (`@mcp1` limits an animation to one digit) |
| `tools/relations_src.json` → `build_relations.py` | Nerve and blood supply of every curated muscle, key facts and clinical notes for nerves, vessels and bones → `web/data/relations.json` |
| `tools/fetch_wiki_descriptions.py`, `desc_handwritten.json`, `postprocess_knowledge.py` | Fill structures the scene has no text for (matching Wikipedia leads, or short atlas notes) and clean citation / markup leftovers; run automatically at the end of the export |
| `tools/browser/` | Headless-Chrome tests (`t_quiz`, `t_motion*`, `t_knowledge`, `t_section`, `t_views`, `t_study`, `t_lessons`, `t_digits`, …) |
| `renders/` | Rendered PNGs (1200×1800) |
| `web/` | The deployable site |

## Run the site locally

```
python -m http.server 8765 --directory web      # then open http://127.0.0.1:8765
```
Deep links: `#s=skeletal,nervous&sel=Femur.l&lang=la`, plus `g=1` / `i=1` (ghost / isolate), `cut=y0.620` (cross-section), `cam=…`, `note=…`, `pins=…` (saved views) and `lesson=knee.3`.
Keys: `/` search · `G` ghost others · `I` isolate · `F` focus · `X` cross-section · `←` `→` lesson steps · `Esc` clear.

Browser tests: serve on port 8770, then `node tools/browser/run.mjs --script tools/browser/t_lessons.mjs --logs errors` (see the header of `run.mjs`).

## Site features (web/js)

| Module | What |
|---|---|
| `app.js` | Viewer, navigation tree, search, selection, info panel, export, text-to-speech; the public `window.atlas` API the other modules use |
| `knowledge.js` | **Key facts** tab for nerves, vessels and bones (roots, course, branches, supply, articulations, clinical relevance), nerve / blood supply rows on muscles with *Show nerve supply* / *Show blood supply* tracing on the model, and a data-derived summary for structures without a description |
| `section.js` | Sagittal / coronal / transverse **cross-section** with a slider; picking ignores the cut-away side |
| `views.js` | **Saved views** (systems, selection, cut, camera, note) and shareable links, labelled **note pins** on the model |
| `lessons.js` + `data/lessons.json` | **Guided lessons** (shoulder, upper-limb nerves, knee, heart, trunk sections, cranial nerves) that end in a quiz on the same topic |
| `quiz.js` | Study mode: label / identify / locate / facts / movements quizzes; **spaced review** (due after 1, 3, 7, 16 days), Today panel with streak and weakest topics, **exam mode** with a 70 % pass mark |
| `motion.js` | Joint motion animations, including muscle-specific digit movement |

## Rebuild the assets

```
blender -b Startup.blend --python tools/export_web.py -- --out web
blender -b Startup.blend --python tools/render_views.py -- --out renders            # all systems, 4 views
blender -b Startup.blend --python tools/render_views.py -- --out web/img --views front --scale 0.3 --only skeletal,muscular
blender -b Startup.blend --python tools/test_navigator.py                           # Blender navigator regression test
blender -b Startup.blend --python tools/fix_source_integrity.py [-- --apply]          # scene integrity repair (back up the .blend first)
python tools/build_muscle_facts.py && python tools/build_relations.py               # curated muscle facts, then relations (needs muscles.json)
python tools/fetch_wiki_descriptions.py && python tools/postprocess_knowledge.py    # optional: refresh the Wikipedia supplement
```
`export_web.py` rewrites `web/data/desc/*.json` from the scene and then runs `postprocess_knowledge.py`, so the supplements survive a re-export.
Blender 5.2 lives at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.

## Deploy: GitHub → Vercel (→ Supabase optional)

The whole `web/` folder is ~32 MB (largest single file 3.5 MB), so it deploys as-is.

1. Push this folder to a **new public GitHub repo** (the `.gitignore` already excludes `Startup.blend`).
2. Vercel → *Add New Project* → import the repo → **Root Directory: `web`**, Framework Preset **Other**, no build command. Auto-deploys on push to `main`.
3. Use the **production** URL; Vercel per-deployment URLs return 302 (deployment protection).

**Supabase is optional here.** The models are small enough to ship with the site. If you still want them in Supabase Storage, upload `web/models/*.glb` to a *public* bucket and set `modelBase` in `web/config.js` to
`https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/models/`. Free plan limits: 1 GB storage, 5 GB egress/month, 50 MB per file, and only 2 active projects (both are used by musclequiz / aclquiz, so a bucket would have to live in one of those).

## Blender: Anatomy Navigator (N-panel → Z-Anatomy)

Search, body-system filter (CNS/PNS/respiratory/digestive/…), joint-type filter, cartilage filter and sorting. Clicking a result reveals its (hidden) system collection, selects and frames it. Landmarks are included and frame the structure they sit on. The index is built once (78 ms) and each redraw filters in ~5 ms.

## Known limits

- Vessels and nerves are bevelled curves: cardiovascular ≈ 2.5 M and nervous ≈ 1.5 M triangles. With every system on the scene is ≈ 8 M triangles: fine on a desktop GPU, heavy on phones. Systems load on demand and only the skeleton is on at start. A decimated LOD tier for curves is the next optimisation.
- Hover names use CPU raycasting; on slow machines the site switches hover off automatically (click still works).
- Joint *types* (hinge, pivot…) come from a curated name list because the scene's own type groups are empty.
- About 300 minor structures (small vessel branches, lymph nodes, bursae, ligament parts) still have no written description; they show a summary built from the atlas's own data. Three unnamed vessels in the scene are labelled *Unidentified …* until an expert names them.
- Relationship data covers the 229 curated muscles and the main nerves, vessels and bones; 17 referenced structures (e.g. phrenic nerve, lingual artery) are not modelled and appear as plain text.

## Licence & attribution

Anatomy geometry: BodyParts3D © The Database Center for Life Science, **CC BY-SA 2.1 JP**, modified by Z-Anatomy; descriptions from Wikipedia (**CC BY-SA**), except entries marked as Z-Anatomy Atlas notes. Key facts, lessons and clinical notes are written for this atlas from standard references and are educational, not medical advice. Derived works must carry the same licence and attribution (shown in the site and in `web/data/license.txt`).
