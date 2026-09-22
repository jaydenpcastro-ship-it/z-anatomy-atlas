export default async function (page, h) {
  await page.evaluate(async () => {
    const r = atlas.S.M.structures.find((x) => x.id === 'Long head of biceps brachii.l');
    await atlas.selectRec(r); window.__r = r;
  });
  await h.sleep(3500);
  await h.shot('_shots/facts_biceps.png');
  console.log('tabs', await page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.textContent + (t.classList.contains('on') ? '*' : ''))));
  console.log('facts', await page.evaluate(() => document.querySelector('.facts')?.innerText));
}
