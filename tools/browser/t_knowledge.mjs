// Knowledge module: muscle supply rows + trace, key-facts tabs for nerve / vessel / bone, summary fallback.
export default async function (page, h) {
  await page.waitForFunction(() => window.atlas.relations, { timeout: 30000 });
  const pick = (id, tab) => page.evaluate(async (id, tab) => {
    const a = window.atlas, rec = a.S.M.structures.find((r) => r.id === id);
    if (tab) a.S.tab = tab;
    await a.selectRec(rec, { focus: false });
    await new Promise((r) => setTimeout(r, 900));
    const info = document.getElementById('info');
    return { tabs: [...info.querySelectorAll('.tab')].map((t) => t.textContent), rows: [...info.querySelectorAll('.frow dt')].map((d) => d.textContent),
      chips: info.querySelectorAll('.kchip:not(.plain)').length, btns: [...info.querySelectorAll('.ktrace .btn')].map((b) => b.textContent),
      clin: !!info.querySelector('.kclin'), h3: [...info.querySelectorAll('h3')].map((x) => x.textContent) };
  }, id, tab);
  const out = {};
  out.deltoid = await pick('Acromial part of deltoid muscle.l', 'facts');
  await page.evaluate(() => [...document.querySelectorAll('.ktrace .btn')].find((b) => /blood/.test(b.textContent))?.click());
  await h.sleep(2500);
  out.traceSel = await page.evaluate(() => [...window.atlas.S.sel].map((id) => window.atlas.S.byId.get(id)?.name));
  await h.shot('_shots/k/k_deltoid_blood.png');
  out.axillary = await pick('Axillary nerve.l', 'key');
  await h.shot('_shots/k/k_axillary.png');
  out.femoralA = await pick('Femoral artery.l', 'key');
  out.femur = await pick('Femur.l', 'key');
  await h.shot('_shots/k/k_femur.png');
  out.summary = await pick('Accessory hemi-azygos vein', 'text');
  await h.shot('_shots/k/k_summary.png');
  for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v));
}
