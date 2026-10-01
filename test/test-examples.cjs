/* ============================================================================
 *  示例区块导入测试
 *  通过真实的 <input type="file"> 路径导入 examples/*.json，
 *  确认随仓库分发的示例可直接使用（JSON 合法、字段可识别、脚本可挂载）。
 * ========================================================================== */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const EXAMPLES = process.argv.slice(3);
if (!EXAMPLES.length) EXAMPLES.push(path.join(__dirname, '..', 'examples', 'blocks-stats-window.json'));
const PORT = 9381;
const UD = path.join(os.tmpdir(), 'dsh-antenna-examples-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (const f of EXAMPLES) {
    if (!fs.existsSync(f)) { console.log(JSON.stringify({ error: `示例文件不存在: ${f}` })); return; }
    JSON.parse(fs.readFileSync(f, 'utf8'));   // 先做纯 JSON 合法性检查
  }

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`,
    '--window-size=1600,1080', 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
          if (targets.some((t) => t.type === 'page')) break; } catch (e) {}
    await sleep(250);
  }
  const target = (targets || []).find((t) => t.type === 'page');
  if (!target) { console.log(JSON.stringify({ error: 'CDP 未就绪' })); chrome.kill(); return; }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  };
  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      try { if (await evalJs("document.readyState==='complete' && !!document.getElementById('editorCard')")) return; } catch (e) {}
      await sleep(250);
    }
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Page.navigate', { url: URL });
  await waitReady();
  await evalJs("(() => { try { localStorage.clear(); } catch (e) {} return true; })()");
  await send('Page.reload', {});
  await waitReady();
  await sleep(700);

  const results = {};
  for (const f of EXAMPLES) {
    const doc = await send('DOM.getDocument', { depth: -1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#blockImportFile' });
    if (!node || !node.nodeId) { results[f] = { error: '未找到 #blockImportFile' }; continue; }
    await send('DOM.setFileInputFiles', { files: [f], nodeId: node.nodeId });
    await sleep(900);
    results[path.basename(f)] = await evalJs(`(() => {
      const rows = [...document.querySelectorAll('#blockList .block-row')];
      return {
        blockCount: rows.length,
        names: rows.map((r) => (r.querySelector('.br-name') || {}).textContent),
        channels: rows.map((r) => (r.querySelector('.br-chan') || {}).textContent),
        renderedCards: document.querySelectorAll('.custom-zone .custom-block').length,
        scriptBlockMounted: !!document.querySelector('.custom-block .custom-body script'),
        sampleTableRendered: document.querySelectorAll('.custom-zone .block-data table').length,
        toasts: [...document.querySelectorAll('#toastBox .toast')].map((t) => t.textContent),
      };
    })()`);
  }

  console.log(JSON.stringify({ exampleFiles: EXAMPLES.map((f) => path.basename(f)), results }, null, 2));
  ws.close(); chrome.kill();
}
main().catch((e) => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(1); });
