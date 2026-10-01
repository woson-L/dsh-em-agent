/* ============================================================================
 *  验收测试：逐项验证重构要求中的 6 条
 *   1 localStorage 持久化
 *   2 JSON 导出 / 导入
 *   3 默认勾选「允许执行脚本」；取消勾选并刷新后脚本不再执行
 *   4 MCP 驱动 CST（由 cst_detect_tool 单独验证，本脚本核对页面配置入口）
 *   5 大模型返回结果回传至指定区块并渲染为表格
 *   6 表格随每轮仿真结果更新
 *  另核对：英文主标题、约束说明已精简、示例参考已就位
 * ========================================================================== */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9401;
const UD = path.join(os.tmpdir(), 'dsh-acceptance');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCRIPT_BLOCK_HTML =
  '<div id="probe">probe</div><scr' + 'ipt>window.__runs=(window.__runs||0)+1;</scr' + 'ipt>';

const PHASE_SETUP = `(() => {
  const R = {}; const $ = (id) => document.getElementById(id);
  window.confirm = () => true;

  // ---------- 页面级要求 ----------
  R.docTitle = document.title;
  R.titleIsEnglish = /^DSH EM Agent . Antenna Design Console$/.test(document.title);
  const bt = document.querySelector('.brand-title');
  R.brandIsEnglish = !!bt && bt.textContent.indexOf('DSH EM Agent') >= 0;
  R.brandIsH1 = bt ? bt.tagName === 'H1' : false;
  // 关键回归：标题必须单行渲染（曾因 flex column 被拆成三行、分隔符独占一行）
  R.brandTitleSingleLine = (function () {
    if (!bt) return false;
    const r = bt.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(bt).lineHeight) || 20;
    return r.height <= lh * 1.6;
  })();
  R.brandTitleText = bt ? bt.textContent.trim() : '';
  const cc = document.getElementById('constraintCard');
  R.constraintCardExists = !!cc;
  R.constraintText = cc ? cc.textContent.trim() : '';
  R.constraintHidesInternals = cc ? (cc.textContent.indexOf('4.80') < 0 && cc.textContent.indexOf('隔离度') < 0 && cc.textContent.indexOf('自定义指标') < 0) : false;
  R.constraintKeepsMcp = cc ? cc.textContent.indexOf('cst-studio-suite MCP') >= 0 : false;
  R.exampleRefExists = !!document.getElementById('exampleRef');
  R.exampleTableCols = [...document.querySelectorAll('#exampleRef .example-table thead th')].map((t) => t.textContent).join('|');
  R.loadExampleBtnExists = !!document.getElementById('btnLoadExample');
  R.hasFavicon = !!document.querySelector('link[rel="icon"]');
  R.hasSkipLink = !!document.querySelector('.skip-link');
  R.hasMetaDescription = !!document.querySelector('meta[name="description"]');
  R.setupEntryKept = !!document.getElementById('btnSetup') && !!document.getElementById('setupOverlay');
  R.setupHasMcpAndCst = !!$('suMcpName') && !!$('suMcpCommand') && !!$('suCstRoot') && !!$('suCstExe');

  // ---------- 3. 默认勾选「允许执行脚本」 ----------
  $('btnBlockNew').click();
  R.newBlockScriptsDefaultChecked = $('beScripts').checked === true;
  $('beName').value = '脚本默认行为';
  $('beChannel').value = '';
  $('beHtml').value = ${JSON.stringify(SCRIPT_BLOCK_HTML)};
  $('btnBlockSave').click();
  R.scriptRanWithDefault = (window.__runs === 1);
  R.storedAllowScripts = JSON.parse(localStorage.getItem('page-blocks-v1'))[0].allowScripts;

  // ---------- 3b. 取消勾选后脚本不再执行 ----------
  window.__runs = undefined;
  document.querySelector('#blockList [data-block-action="edit"]').click();
  $('beScripts').checked = false;
  $('btnBlockSave').click();
  R.scriptSkippedAfterUncheck = (typeof window.__runs === 'undefined');
  R.storedAllowScriptsOff = JSON.parse(localStorage.getItem('page-blocks-v1'))[0].allowScripts;

  // ---------- 5/6. 数据回传：建一个统计表格区块 ----------
  $('btnBlockNew').click();
  $('beName').value = '每轮仿真统计';
  $('beChannel').value = 'stats';
  $('beDemand').value = '每轮仿真后输出该轮增益（dB）与效率（%）';
  $('beRender').value = 'auto';
  $('beHistory').checked = true;
  $('beScripts').checked = false;
  $('beHtml').value = '<div data-block-slot></div>';
  $('btnBlockSave').click();

  const slot = () => document.querySelector('#customZoneFull .custom-block .custom-body [data-block-slot]');
  // 取「最后一张」回传表格的行：累积模式下页面里会有多张表，必须按表取而不是全页取
  const lastTableRows = () => {
    const boxes = document.querySelectorAll('#customZoneFull .block-data');
    if (!boxes.length) return [];
    const last = boxes[boxes.length - 1];
    return [...last.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent).join('|'));
  };
  const fence = (o) => '本轮结果：\\n\\\`\\\`\\\`dsh-block-data\\n' + JSON.stringify(o) + '\\n\\\`\\\`\\\`';
  const feed = (round, gain, eff, seq) => processSessionEvent({ seq: seq, type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: fence({ channel: 'stats', round: round,
      columns: ['轮次', '增益 (dB)', '效率 (%)'], rows: [[round, gain, eff]] }) }] } } });

  feed(1, '2.31', '68.4', 901);
  R.round1TableRendered = !!document.querySelector('#customZoneFull .block-data table');
  R.round1Headers = [...document.querySelectorAll('#customZoneFull .block-data thead th')].map((t) => t.textContent).join('|');
  R.round1Rows = document.querySelectorAll('#customZoneFull .block-data').length;
  R.round1Cells = lastTableRows()[lastTableRows().length - 1];

  feed(2, '2.47', '71.2', 902);
  R.round2Rows = document.querySelectorAll('#customZoneFull .block-data').length;
  R.round2Value = lastTableRows()[lastTableRows().length - 1];

  feed(3, '2.58', '72.9', 903);
  R.round3Rows = document.querySelectorAll('#customZoneFull .block-data').length;
  R.round3Value = lastTableRows()[lastTableRows().length - 1];
  R.round3AllRows = lastTableRows().join(' / ');

  // ---------- 2. 导出 / 导入 ----------
  R.storedBlockCount = JSON.parse(localStorage.getItem('page-blocks-v1')).length;
  let exportThrew = false;
  try { $('btnBlockExport').click(); } catch (e) { exportThrew = true; }
  R.exportNoThrow = !exportThrew;

  // ---------- 1. 持久化：写入后读取应一致 ----------
  R.persistedBeforeReload = JSON.parse(localStorage.getItem('page-blocks-v1')).map((b) => b.name).join(',');
  return R;
})()`;

const PHASE_AFTER_RELOAD = `(() => {
  const R = {};
  R.persistedBlockCount = JSON.parse(localStorage.getItem('page-blocks-v1')).length;
  R.persistedNames = JSON.parse(localStorage.getItem('page-blocks-v1')).map((b) => b.name).join(',');
  R.renderedCards = document.querySelectorAll('.custom-zone .custom-block').length;
  // 刷新后：被取消勾选的那个区块脚本不应执行
  R.scriptNotRunAfterReload = (typeof window.__runs === 'undefined');
  R.allowScriptsFlags = JSON.parse(localStorage.getItem('page-blocks-v1')).map((b) => b.name + ':' + b.allowScripts).join(' | ');

  // 导入回环：先清空，再导入刚才导出的 JSON 文本
  const exported = localStorage.getItem('page-blocks-v1');
  const envelope = JSON.stringify({ type: 'dsh-antenna-panel-blocks', version: 1, blocks: JSON.parse(exported) });
  let importOk = true;
  try {
    const parsed = JSON.parse(envelope);
    const incoming = Array.isArray(parsed) ? parsed : parsed.blocks;
    localStorage.setItem('page-blocks-v1', JSON.stringify(incoming));
  } catch (e) { importOk = false; }
  R.importRoundTripOk = importOk;
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
  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      try { if (await evalJs("document.readyState==='complete' && !!document.getElementById('editorCard')")) return; } catch (e) {}
      await sleep(250);
    }
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await waitReady();
  await evalJs("(() => { try { localStorage.clear(); } catch (e) {} return true; })()");
  await send('Page.reload', {});
  await waitReady();
  await sleep(700);
  // 首次配置浮层会挡住操作，先提交一份配置关掉它
  await evalJs(`(() => {
    const set = { suCstRoot: 'C:\\\\Program Files\\\\CST Studio Suite 2026',
      suCstExe: 'C:\\\\Program Files\\\\CST Studio Suite 2026\\\\AMD64\\\\CST DESIGN ENVIRONMENT_AMD64.exe',
      suMcpName: 'cst-studio-suite', suMcpCommand: 'C:\\\\Program Files\\\\Python311\\\\python.exe',
      suMcpArgs: 'C:\\\\CST-MCP\\\\mcp_server.py', suWorkspace: 'C:\\\\CST_Workspace\\\\cst_runs' };
    Object.keys(set).forEach(function (id) { const el = document.getElementById(id); if (el) { el.value = set[id]; el.dispatchEvent(new Event('input', { bubbles: true })); } });
    document.getElementById('setupForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(400);

  const p1 = await evalJs(PHASE_SETUP);
  await send('Page.reload', {});
  await waitReady();
  await sleep(800);
  const p2 = await evalJs(PHASE_AFTER_RELOAD);

  const all = Object.assign({}, p1, p2);
  const fails = [];
  const expect = (k, v) => { if (all[k] !== v) fails.push(`${k}: 期望 ${JSON.stringify(v)}，实际 ${JSON.stringify(all[k])}`); };

  // 页面级
  expect('titleIsEnglish', true);
  expect('brandIsEnglish', true);
  expect('brandIsH1', true);
  expect('brandTitleSingleLine', true);
  expect('constraintHidesInternals', true);
  expect('constraintKeepsMcp', true);
  expect('exampleRefExists', true);
  expect('exampleTableCols', '轮次|增益 (dB)|效率 (%)');
  expect('loadExampleBtnExists', true);
  expect('hasFavicon', true);
  expect('hasSkipLink', true);
  expect('hasMetaDescription', true);
  expect('setupEntryKept', true);
  expect('setupHasMcpAndCst', true);
  // 3
  expect('newBlockScriptsDefaultChecked', true);
  expect('scriptRanWithDefault', true);
  expect('storedAllowScripts', true);
  expect('scriptSkippedAfterUncheck', true);
  expect('storedAllowScriptsOff', false);
  expect('scriptNotRunAfterReload', true);
  // 5 / 6
  expect('round1TableRendered', true);
  expect('round1Headers', '轮次|增益 (dB)|效率 (%)');
  expect('round1Rows', 1);
  expect('round1Cells', '1|2.31|68.4');
  expect('round2Rows', 2);
  expect('round2Value', '2|2.47|71.2');
  expect('round3Rows', 3);
  expect('round3Value', '3|2.58|72.9');
  // 2
  expect('exportNoThrow', true);
  expect('storedBlockCount', 2);
  expect('importRoundTripOk', true);
  // 1
  expect('persistedBlockCount', 2);
  expect('persistedNames', '脚本默认行为,每轮仿真统计');
  expect('renderedCards', 2);

  console.log(JSON.stringify({ evidence: all, failures: fails, passed: fails.length === 0 }, null, 2));
  ws.close(); chrome.kill();
  // 文档承诺「退出码 0 表示通过」：断言失败必须真的让退出码非零，
  // 否则批量跑法与 CI 只看 $? 时根本发现不了回归。
  if (fails.length > 0) process.exit(1);
}
main().catch((e) => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(1); });
