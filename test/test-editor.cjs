/* ============================================================================
 *  页面编辑器功能测试（CDP）
 *  覆盖：新增/编辑/区域切换/复制/排序/删除/持久化，
 *        以及「脚本默认执行、取消勾选后不再执行」这一语义。
 * ========================================================================== */
const { spawn } = require('node:child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9345;
const UD = require('node:path').join(require('node:os').tmpdir(), 'dsh-antenna-editor-test');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHASE1 = `(() => {
  const R = {};
  const $ = (id) => document.getElementById(id);
  window.confirm = () => true;              // 自动确认删除/清空
  try { localStorage.removeItem('page-blocks-v1'); } catch (e) {}
  window.__ran = undefined;

  R.editorCardExists = !!$('editorCard');
  R.emptyHintShown = !!document.querySelector('#blockList .block-empty');
  R.zoneFullHiddenWhenEmpty = getComputedStyle($('customZoneFull')).display === 'none';

  // ---- 新增区块（脚本开关关闭）----
  $('btnBlockNew').click();
  R.editorOpened = !$('blockEditor').hidden;
  R.previewHookWorks = !!$('blockPreview');
  $('beName').value = '测试区块';
  $('beZone').value = 'full';
  $('beHtml').value = '<div id="probe">hello</div><scr' + 'ipt>window.__ran=(window.__ran||0)+1;</scr' + 'ipt>';
  $('beScripts').checked = false;
  $('btnBlockSave').click();

  R.blocksAfterAdd = document.querySelectorAll('#blockList .block-row').length;
  R.probeRendered = !!document.querySelector('#customZoneFull #probe');
  R.zoneFullVisible = getComputedStyle($('customZoneFull')).display !== 'none';
  R.scriptSkippedWhenOff = (typeof window.__ran === 'undefined');

  // ---- 打开编辑，勾选脚本后再存 ----
  document.querySelector('#blockList [data-block-action="edit"]').click();
  R.editorReopened = !$('blockEditor').hidden;
  R.reloadedName = $('beName').value === '测试区块';
  $('beScripts').checked = true;
  $('btnBlockSave').click();
  R.scriptRanWhenOn = (window.__ran === 1);

  // ---- 切到左栏，检查两栏仍等高 ----
  document.querySelector('#blockList [data-block-action="edit"]').click();
  $('beZone').value = 'left';
  $('btnBlockSave').click();
  R.movedToLeft = !!document.querySelector('#customZoneLeft #probe');
  const lh = document.querySelector('.col-left').getBoundingClientRect().height;
  const rh = document.querySelector('.col-right').getBoundingClientRect().height;
  R.columnsEqualAfterBlock = Math.abs(lh - rh) < 0.6;
  R.leftH = Math.round(lh * 100) / 100;
  R.rightH = Math.round(rh * 100) / 100;

  // ---- 复制 ----
  document.querySelector('#blockList [data-block-action="dup"]').click();
  R.blocksAfterDup = document.querySelectorAll('#blockList .block-row').length;

  // ---- 导出（只验证不抛错 + 存储内容正确）----
  let exportThrew = false;
  try { $('btnBlockExport').click(); } catch (e) { exportThrew = true; }
  R.exportNoThrow = !exportThrew;
  R.storedOk = (() => {
    try {
      const p = JSON.parse(localStorage.getItem('page-blocks-v1'));
      return Array.isArray(p) && p.length === 2 && p[0].name === '测试区块' && p[0].zone === 'left';
    } catch (e) { return false; }
  })();

  // ---- 排序 ----
  const namesBefore = JSON.parse(localStorage.getItem('page-blocks-v1')).map(b => b.name).join('|');
  const downBtn = [...document.querySelectorAll('#blockList [data-block-action="down"]')].find(b => !b.disabled);
  if (downBtn) downBtn.click();
  const namesAfter = JSON.parse(localStorage.getItem('page-blocks-v1')).map(b => b.name).join('|');
  R.reorderWorks = namesBefore !== namesAfter;

  return R;
})()`;

const PHASE2 = `(() => {
  const R = {};
  R.persistedRows = document.querySelectorAll('#blockList .block-row').length;
  R.persistedRendered = document.querySelectorAll('#customZoneLeft .custom-block').length;
  R.scriptRanAfterReload = window.__ran;
  const lh = document.querySelector('.col-left').getBoundingClientRect().height;
  const rh = document.querySelector('.col-right').getBoundingClientRect().height;
  R.columnsEqualAfterReload = Math.abs(lh - rh) < 0.6;
  return R;
})()`;

const PHASE3 = `(() => {
  const R = {};
  const $ = (id) => document.getElementById(id);
  window.confirm = () => true;
  // 删除一个
  document.querySelector('#blockList [data-block-action="delete"]').click();
  R.blocksAfterDelete = document.querySelectorAll('#blockList .block-row').length;
  // 清空全部
  $('btnBlockClear').click();
  R.blocksAfterClearAll = document.querySelectorAll('#blockList .block-row').length;
  R.emptyHintBackAgain = !!document.querySelector('#blockList .block-empty');
  R.zonesCleared = document.querySelectorAll('.custom-zone .custom-block').length === 0;
  R.storageEmpty = localStorage.getItem('page-blocks-v1') === '[]';
  return R;
})()`;

async function main() {
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 60; i++) {
    try { if (await evalJs("document.readyState==='complete' && !!document.getElementById('editorCard')")) break; } catch (e) {}
    await sleep(250);
  }
  await sleep(600);

  const p1 = await evalJs(PHASE1);
  await send('Page.reload', { ignoreCache: false });
  for (let i = 0; i < 60; i++) {
    try { if (await evalJs("document.readyState==='complete' && !!document.getElementById('editorCard')")) break; } catch (e) {}
    await sleep(250);
  }
  await sleep(700);
  const p2 = await evalJs(PHASE2);
  const p3 = await evalJs(PHASE3);

  const all = Object.assign({}, p1, p2, p3);
  const fails = [];
  const expect = (k, v) => { if (all[k] !== v) fails.push(`${k}: 期望 ${v}，实际 ${all[k]}`); };
  expect('editorCardExists', true);
  expect('emptyHintShown', true);
  expect('zoneFullHiddenWhenEmpty', true);
  expect('editorOpened', true);
  expect('blocksAfterAdd', 1);
  expect('probeRendered', true);
  expect('zoneFullVisible', true);
  expect('scriptSkippedWhenOff', true);     // 关键：默认不执行脚本
  expect('editorReopened', true);
  expect('reloadedName', true);
  expect('scriptRanWhenOn', true);          // 关键：勾选后执行
  expect('movedToLeft', true);
  expect('columnsEqualAfterBlock', true);
  expect('blocksAfterDup', 2);
  expect('exportNoThrow', true);
  expect('storedOk', true);
  expect('reorderWorks', true);
  expect('persistedRows', 2);
  expect('persistedRendered', 2);
  // 刷新后两个「已允许脚本」的区块各执行一次，计数器应为 2（等于渲染出的区块数）
  expect('scriptRanAfterReload', 2);
  expect('columnsEqualAfterReload', true);
  expect('blocksAfterDelete', 1);
  expect('blocksAfterClearAll', 0);
  expect('emptyHintBackAgain', true);
  expect('zonesCleared', true);
  expect('storageEmpty', true);

  console.log(JSON.stringify({ results: all, failures: fails, passed: fails.length === 0 }, null, 2));
  ws.close(); chrome.kill();
  // 断言失败必须让退出码非零（见 docs/dev/tests.md 的约定）
  if (fails.length > 0) process.exit(1);
}
main().catch((e) => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(1); });
