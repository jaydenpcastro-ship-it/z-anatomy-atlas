// Isolate framing test: after isolating a structure, its projected bounds must sit inside the frame and fill most of it.
const CASES = [
  ['skeletal', 'Stapes.l'], ['skeletal', 'Femur.l'], ['skeletal', 'Vertebra L3'], ['skeletal', 'Scapula.r'],
  ['muscular', 'Long head of biceps brachii.l'], ['muscular', 'Gluteus maximus muscle.l'], ['muscular', 'Diaphragm'],
  ['muscular', 'Lateral head of gastrocnemius.l'], ['muscular', 'Deep head of pronator teres.r'], ['muscular', 'Superficial part of masseter.l'],
  ['muscular', 'Clavicular part of deltoid muscle.l'], ['muscular', 'Transverse part of trapezius muscle.l'],
];
const EXPECT = { 'Long head of biceps brachii.l': 4, 'Lateral head of gastrocnemius.l': 4, 'Deep head of pronator teres.r': 4, 'Superficial part of masseter.l': 4,
  'Clavicular part of deltoid muscle.l': 6, 'Transverse part of trapezius muscle.l': 6, 'Gluteus maximus muscle.l': 2, 'Femur.l': 2, 'Diaphragm': 1 };
export default async function (page, h) {
  for (const [sys, id] of CASES) {
    const r = await page.evaluate(async (sys, id) => {
      const a = window.atlas, THREE = a.THREE;
      const rec = a.S.M.structures.find((x) => x.id === id);
      if (!rec) return { id, error: 'not found' };
      await a.selectRec(rec);
      await new Promise((res) => setTimeout(res, 300));
      a.setIso(true);
      await new Promise((res) => setTimeout(res, 1400));   // camera tween is 600 ms
      const box = new THREE.Box3();
      for (const r2 of a.selectionRecs()) for (const m of a.meshesOf(r2.id)) if (m.visible) box.expandByObject(m);
      const c = [], v = new THREE.Vector3();
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) c.push(v.set(x, y, z).project(a.camera).clone());
      const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
      return { id, dist: +a.camera.position.distanceTo(a.controls.target).toFixed(3), near: +a.camera.near.toFixed(4),
        x: [+Math.min(...xs).toFixed(2), +Math.max(...xs).toFixed(2)], y: [+Math.min(...ys).toFixed(2), +Math.max(...ys).toFixed(2)],
        size: a.selectionRecs().length, names: [...new Set(a.selectionRecs().map((q) => q.name))].join(' + ') };
    }, sys, id);
    const inside = r.x && r.x[0] >= -1 && r.x[1] <= 1 && r.y[0] >= -1 && r.y[1] <= 1;
    const fill = r.x ? Math.max(r.x[1] - r.x[0], r.y[1] - r.y[0]) / 2 : 0;
    console.log(EXPECT[id] != null && EXPECT[id] !== r.size ? `SIZE MISMATCH expected ${EXPECT[id]}` : 'size ok', JSON.stringify(r), inside ? 'INSIDE' : 'CROPPED', 'fill=' + fill.toFixed(2));
    await h.shot(`_shots/iso_${id.replace(/[^a-z0-9]/gi, '_')}.png`);
  }
}
