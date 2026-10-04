// Cross-section: restored from the link, moves, flips, picking ignores the removed side, link updates.
export default async function (page, h) {
  await page.waitForFunction(() => window.atlas.section && window.atlas.S.sys.get('visceral')?.loaded, { timeout: 90000 });
  await h.sleep(1500);
  const st = await page.evaluate(() => ({ ...window.atlas.section.get(), clip: window.atlas.renderer.clippingPlanes.length, hash: location.hash }));
  console.log('restored', JSON.stringify(st));
  await page.evaluate(() => window.atlas.flyTo(new window.atlas.THREE.Vector3(0, 1.25, 0), 0.35, new window.atlas.THREE.Vector3(0.3, 1, 0.5)));
  await h.sleep(1200);
  await h.shot('_shots/k/sec_transverse.png');
  await page.evaluate(() => window.atlas.section.set({ axis: 'x', pos: 0.5, flip: false }));
  await page.evaluate(() => window.atlas.flyTo(new window.atlas.THREE.Vector3(0, 1.2, 0), 0.5, new window.atlas.THREE.Vector3(1, 0.1, 0.2)));
  await h.sleep(1200);
  await h.shot('_shots/k/sec_sagittal.png');
  // a ray through a point on the removed side must not pick anything there
  const pick = await page.evaluate(() => {
    const a = window.atlas, p = a.S.clipPlane;
    const kept = a.S.M.structures.filter((r) => r.system === 'visceral' && p.distanceToPoint(new a.THREE.Vector3(...r.c)) > 0.03).length;
    const gone = a.S.M.structures.filter((r) => r.system === 'visceral' && p.distanceToPoint(new a.THREE.Vector3(...r.c)) < -0.03).length;
    return { kept, gone, hash: location.hash };
  });
  console.log('pick', JSON.stringify(pick));
  await page.evaluate(() => window.atlas.section.set({ on: false }));
  console.log('off', JSON.stringify(await page.evaluate(() => ({ clip: window.atlas.renderer.clippingPlanes.length, hash: location.hash }))));
}
