// Contact sheet of screenshots:  node tools/browser/sheet.mjs <out.png> <cols> <thumbW> file1.png file2.png ...
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const [out, cols, tw, ...files] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const cells = files.map((f) => `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><figcaption>${path.basename(f, '.png').replace(/^(bone|surface)_/, '').replace(/__/g, ' · ')}</figcaption></figure>`).join('');
const html = `<style>body{margin:0;background:#0d1117;display:grid;grid-template-columns:repeat(${cols},${tw}px);gap:6px;padding:6px;font:12px system-ui;color:#ddd}figure{margin:0}img{width:${tw}px;display:block;border-radius:4px}figcaption{padding:3px 2px;font-weight:600}</style>${cells}`;
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: Number(cols) * (Number(tw) + 6) + 6, height: 800 } });
const p = await b.newPage(); await p.setContent(html); await new Promise((r) => setTimeout(r, 400));
await p.screenshot({ path: out, fullPage: true }); await b.close(); console.log('wrote', out);
