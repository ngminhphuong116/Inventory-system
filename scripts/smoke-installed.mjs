// Connect only to an explicitly launched local test instance; never access a user's normal profile.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] || 19341);
const login = process.argv.includes('--login');
const screenshotDir = join(root, 'docs', 'screenshots');
await mkdir(screenshotDir, { recursive: true });
let target;
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find(item => item.type === 'page' && item.url.startsWith('file:'));
    if (target) break;
  } catch { /* Startup polling, bounded to 20 seconds. */ }
  await new Promise(done => setTimeout(done, 200));
}
if (!target) throw new Error('Packaged application did not expose its test renderer');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done, reject) => { ws.addEventListener('open', done); ws.addEventListener('error', reject); });
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.id && pending.has(message.id)) {
    const { done, reject, timer } = pending.get(message.id);
    clearTimeout(timer); pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error))); else done(message.result);
  }
});
function send(method, params = {}) {
  return new Promise((done, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(requestId, { done, reject, timer });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await evaluate(`document.fonts.ready.then(() => true)`);
  let text = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    text = await evaluate('document.body.innerText');
    if (text.includes(login ? 'Đăng nhập' : 'Thiết lập cơ sở dữ liệu')) break;
    await new Promise(done => setTimeout(done, 100));
  }
  if (!text.includes(login ? 'Đăng nhập' : 'Thiết lập cơ sở dữ liệu')) throw new Error(`Expected screen missing: ${text.slice(0, 120)}`);
  const metrics = await evaluate(`({title:document.title,url:location.href,preload:typeof window.electronAPI?.saveBackupFile,hasNode:typeof window.require,overflow:document.documentElement.scrollWidth>innerWidth})`);
  if (metrics.preload !== 'function' || metrics.hasNode !== 'undefined' || metrics.overflow || errors.length) throw new Error(JSON.stringify({metrics,errors}));
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.fonts.ready.then(() => true)');
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(join(screenshotDir, login ? 'login.png' : 'firebase-setup.png'), Buffer.from(shot.data, 'base64'));
  if (!login) {
    // Synthetic config solely to view login; no credentials, sign-in or business API calls.
    await evaluate(`localStorage.setItem('release-acceptance-marker','preserve-on-reinstall');localStorage.setItem('firebase_config',JSON.stringify({apiKey:'demo-release-key',authDomain:'demo-inventory.firebaseapp.com',databaseURL:'https://demo-inventory-default-rtdb.firebaseio.com',projectId:'demo-inventory',storageBucket:'demo-inventory.appspot.com',messagingSenderId:'123456789',appId:'1:123456789:web:demo'}));true`);
  } else {
    if (await evaluate(`localStorage.getItem('release-acceptance-marker')`) !== 'preserve-on-reinstall') throw new Error('Profile persistence failed');
  }
  console.log(JSON.stringify({screen:login?'login':'setup',metrics,errors,profilePersisted:login}, null, 2));
  await send('Browser.close').catch(() => {});
} finally { ws.close(); }
