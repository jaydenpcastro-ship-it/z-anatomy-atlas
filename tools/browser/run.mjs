// Headless-Chrome harness for the atlas (no extension needed). Uses the Chrome installed on this machine + SwiftShader WebGL.
//
//   node tools/browser/run.mjs [url] [--eval "js"] [--script file.mjs] [--shot out.png] [--size 1400x900] [--hash "#s=skeletal"]
//                              [--wait 1500] [--no-ready] [--logs all|errors]
//
//  url       default http://127.0.0.1:8770/ (serve with: python -m http.server 8770 --directory web)
//  --eval    JS evaluated in the page after atlas.ready (REPL-style, `await` allowed); result printed as JSON
//  --script  ES module whose default export is async (page, h) => {...}; h = { shot(name), wait(ms), evalJs(src), sleep }
//  --shot    screenshot of the final state
// Console messages and uncaught page errors are echoed as "[console.*]" / "[pageerror]" lines.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const flag = (name) => argv.includes(`--${name}`);
const url = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--no-ready'].includes(argv[i - 1]))) || 'http://127.0.0.1:8770/';
const [W, H] = (opt('size', '1400x900')).split('x').map(Number);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', defaultViewport: { width: W, height: H },
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--disable-background-timer-throttling'],
});
const page = await browser.newPage();
const logs = opt('logs', 'all');
page.on('console', (m) => { if (logs === 'all' || m.type() === 'error') console.log(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await page.goto(url + (opt('hash', '')), { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!flag('no-ready')) await page.waitForFunction('window.atlas && window.atlas.S && window.atlas.S.M', { timeout: 90000 });
  await sleep(Number(opt('wait', 1500)));
  const helpers = {
    sleep, wait: sleep,
    shot: async (name) => { await page.screenshot({ path: name }); console.log(`[shot] ${name}`); },
    evalJs: (src) => page.evaluate(`(async () => { ${src} })()`),
  };
  if (opt('eval')) console.log('[eval]', JSON.stringify(await page.evaluate(`(async () => { return (${opt('eval')}); })()`), null, 1));
  if (opt('script')) await (await import(pathToFileURL(opt('script')).href)).default(page, helpers);
  if (opt('shot')) await helpers.shot(opt('shot'));
} catch (e) {
  console.log('[harness-error]', e.message);
  process.exitCode = 1;
} finally { await browser.close(); }
