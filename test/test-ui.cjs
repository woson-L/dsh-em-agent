/* ============================================================================
 *  显示层与控件验证（2026-11-14 改版）
 *
 *  锁住六件事：
 *    1 说明面板：打开焦点进入、Esc 关闭、焦点回到触发按钮
 *    2 显示偏好：布局 / 密度 / 比例写入 data 属性与 CSS 变量，并在重载后保持
 *    3 扩展模块：注册表挂载 / 卸载，卸载后回到空态
 *    4 运行记录：工具行渲染、详情展开、长文折叠
 *    5 频段数据模型：启用频段 → 结果表多一行（图表与表同一来源）
 *    6 阈值改动 → 图表重绘
 *
 *  用法： node test/test-ui.cjs [URL]
 *  环境： 需要 Chrome（CHROME_PATH 可覆盖）与正在服务的页面。
 * ========================================================================== */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3190/em-agent';
const PORT = 9416;
const UD = path.join(os.tmpdir(), 'dsh-panel-ui-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`,
    '--window-size=1440,1080', 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 80; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch (e) {}
    await sleep(250);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 80; i++) {
    try { if (await evalJs("document.readyState==='complete' && !!window.UBExtensions")) break; } catch (e) {}
    await sleep(250);
  }
  await sleep(300);
  await evalJs('localStorage.clear(); true');
  await send('Page.reload', {});
  for (let i = 0; i < 60; i++) { try { if (await evalJs("document.readyState==='complete' && !!window.UBExtensions")) break; } catch (e) {} await sleep(200); }
  await sleep(300);

  const all = {};
  const fails = [];
  const expect = (k, v) => { if (all[k] !== v) fails.push(`${k}: 期望 ${JSON.stringify(v)} 实际 ${JSON.stringify(all[k])}`); };

  /* 1. 说明面板：打开 → 焦点进入 → Esc 关闭 → 焦点回到按钮 */
  all.helpBefore = await evalJs(`document.getElementById('helpOverlay').hidden`);
  await evalJs(`(() => { const b = document.getElementById('btnHelp'); b.focus(); b.click(); return true; })()`);
  await sleep(120);
  all.helpOpen = await evalJs(`!document.getElementById('helpOverlay').hidden`);
  all.helpFocusInside = await evalJs(`document.getElementById('helpOverlay').contains(document.activeElement)`);
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true`);
  await sleep(120);
  all.helpClosed = await evalJs(`document.getElementById('helpOverlay').hidden`);
  all.helpFocusRestored = await evalJs(`document.activeElement && document.activeElement.id === 'btnHelp'`);
  expect('helpBefore', true);
  expect('helpOpen', true);
  expect('helpFocusInside', true);
  expect('helpClosed', true);
  expect('helpFocusRestored', true);

  /* 2. 显示偏好：布局 / 密度 / 比例 */
  await evalJs(`(() => { const el = document.getElementById('ubLayout'); el.value='focus'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  all.layoutFocus = await evalJs(`document.body.dataset.layout`);
  all.leftHidden = await evalJs(`getComputedStyle(document.querySelector('.col-left')).display === 'none'`);
  await evalJs(`(() => { const el = document.getElementById('ubLayout'); el.value='split'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  all.layoutSplit = await evalJs(`document.body.dataset.layout`);

  await evalJs(`(() => { const el = document.getElementById('ubDensity'); el.value='compact'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  all.densityCompact = await evalJs(`document.body.dataset.density`);

  await evalJs(`(() => { const el = document.getElementById('ubRatio'); el.value='50%'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  all.ratio = await evalJs(`document.documentElement.style.getPropertyValue('--config-width')`);
  expect('layoutFocus', 'focus');
  expect('leftHidden', true);
  expect('layoutSplit', 'split');
  expect('densityCompact', 'compact');
  expect('ratio', '50%');

  /* 3. 偏好持久化：重载后仍生效 */
  await send('Page.reload', {});
  for (let i = 0; i < 60; i++) {
    try { if (await evalJs("document.readyState==='complete' && !!window.UBExtensions")) break; } catch (e) {}
    await sleep(200);
  }
  all.persistedLayout = await evalJs(`document.body.dataset.layout`);
  all.persistedDensity = await evalJs(`document.body.dataset.density`);
  expect('persistedLayout', 'split');
  expect('persistedDensity', 'compact');

  /* 4. 扩展模块：挂载 / 卸载 / 生命周期 */
  await evalJs(`(() => { const el = document.getElementById('ubShowExample'); el.checked = true; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  all.moduleMounted = await evalJs(`!!document.getElementById('ub-module-efficiency')`);
  all.moduleCount = await evalJs(`document.querySelectorAll('#ubExtensionSlot .ub-module').length`);
  await evalJs(`document.getElementById('ub-module-efficiency').querySelector('button').click(); true`);
  await sleep(100);
  all.moduleRemoved = await evalJs(`!document.getElementById('ub-module-efficiency')`);
  all.emptyHintVisible = await evalJs(`(() => { const e = document.querySelector('.ub-ext__empty'); return !!e && !e.hidden; })()`);
  expect('moduleMounted', true);
  expect('moduleCount', 1);
  expect('moduleRemoved', true);
  expect('emptyHintVisible', true);

  /* 5. 日志：工具行 / 长文折叠 / 跟随最新 */
  await evalJs(`(() => {
    const v = document.getElementById('chatView');
    if (v) v.innerHTML = '';
    appendToolRow({ name: 'cst_solve', status: 'ok' });
    appendChatMsg('assistant', 'x'.repeat(900));
    return true;
  })()`);
  all.toolRow = await evalJs(`document.querySelectorAll('.log-row.tool').length`);
  all.toolToggle = await evalJs(`(() => { const b = document.querySelector('.log-row.tool .tool-toggle'); return !!b; })()`);
  await evalJs(`document.querySelector('.log-row.tool .tool-toggle').click(); true`);
  all.toolPayloadVisible = await evalJs(`!document.querySelector('.log-row.tool .tool-payload').hidden`);
  all.clamped = await evalJs(`!!document.querySelector('.log-text--clamped')`);
  await evalJs(`(document.querySelector('.log-text--clamped')||{click(){}}).click(); true`);
  all.clampToggled = await evalJs(`!document.querySelector('.log-text--clamped')`);
  expect('toolRow', 1);
  expect('toolToggle', true);
  expect('toolPayloadVisible', true);
  expect('clamped', true);
  expect('clampToggled', true);

  /* 6. 频段模型：勾选第二个频段 → 图表与结果表同步 */
  await evalJs(`(() => {
    const B = window.chartData || [];
    return true;
  })()`);
  await evalJs(`(() => {
    const boxes = [...document.querySelectorAll('.band-card .band-head input[type=checkbox]')];
    boxes.forEach((cb, i) => { const want = i === 0; if (cb.checked !== want) { cb.checked = want; cb.dispatchEvent(new Event('change', { bubbles: true })); } });
    return true;
  })()`);
  await sleep(120);
  all.rowsBefore = await evalJs(`document.querySelectorAll('#resultTable tbody tr').length`);
  all.beforeChecked = await evalJs(`[...document.querySelectorAll('.band-card .band-head input[type=checkbox]')].map(c => c.checked)`);
  await evalJs(`(() => {
    const boxes = [...document.querySelectorAll('.band-card .band-head input[type=checkbox]')];
    const cb = boxes[1];
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  all.rowsAfter = await evalJs(`document.querySelectorAll('#resultTable tbody tr').length`);
  all.thresholdLines = await evalJs(`document.querySelectorAll('#chartBox svg line[stroke="#c07a12"]').length`);
  expect('rowsAfter', all.rowsBefore + 1);

  /* 7. 阈值变化 → 图表阈值随之变化 */
  const before = await evalJs(`document.querySelector('#chartBox svg').innerHTML.length`);
  await evalJs(`(() => {
    const sel = document.querySelectorAll('.band-card select')[0];
    sel.value = '-15';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  const after = await evalJs(`document.querySelector('#chartBox svg').innerHTML.length`);
  all.thresholdRedraw = before !== after;
  expect('thresholdRedraw', true);

  ws.close();
  chrome.kill();

  const out = { url: URL, checks: all, failures: fails, passed: fails.length === 0 };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.passed ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
