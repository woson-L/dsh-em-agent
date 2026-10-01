/* ============================================================================
 *  区块数据回传测试（CDP）
 *  覆盖：指令协议注入 / 消息级与流式路由 / 去重 / 三种数据形状 /
 *        累积与覆盖模式 / 自定义脚本事件派发 / 测试数据按钮 / 通道隔离
 * ========================================================================== */
const { spawn } = require('node:child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9361;
const UD = require('node:path').join(require('node:os').tmpdir(), 'dsh-antenna-blockdata-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHASE = `(() => {
  const R = {};
  const $ = (id) => document.getElementById(id);
  window.confirm = () => true;
  try { localStorage.removeItem('page-blocks-v1'); } catch (e) {}

  const msg = (text, seq) => processSessionEvent({
    seq: seq, type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: text }] } },
  });
  const fence = (obj) => '本轮结果：\\n\\\`\\\`\\\`dsh-block-data\\n' + JSON.stringify(obj) + '\\n\\\`\\\`\\\`\\n完成。';
  const slotTable = () => {
    const s = document.querySelector('#customZoneFull .custom-block .custom-body [data-block-slot]');
    return s ? s.querySelector('table') : null;
  };
  const slotBoxes = () => document.querySelectorAll('#customZoneFull .custom-block .custom-body .block-data').length;

  // ---------- 建一个「内置表格渲染」的统计区块 ----------
  $('btnBlockNew').click();
  $('beName').value = '增益效率统计';
  $('beZone').value = 'full';
  $('beChannel').value = 'stats';
  $('beDemand').value = '每轮输出增益(dBi)与效率(dB)';
  $('beRender').value = 'auto';
  $('beHistory').checked = false;
  $('beConfig').value = 'precision=2';
  $('beHtml').value = '<div data-block-slot></div>';
  $('btnBlockSave').click();

  R.blockSaved = document.querySelectorAll('#blockList .block-row').length === 1;
  R.chanPill = (document.querySelector('#blockList .br-chan') || {}).textContent;
  R.testBtnShown = !!document.querySelector('#blockList [data-block-action="test"]');
  R.previewClearedOnClose = $('blockPreview').innerHTML === '';

  // ---------- 指令协议注入 ----------
  const proto = buildBlockDataProtocol();
  R.protocolHasFence = proto.indexOf('dsh-block-data') >= 0;
  R.protocolHasChannel = proto.indexOf('stats') >= 0;
  R.protocolHasDemand = proto.indexOf('每轮输出增益(dBi)与效率(dB)') >= 0;
  let instr = '';
  try { instr = buildInstruction(readConfig()); } catch (e) { instr = 'ERR:' + e.message; }
  R.protocolInInstruction = instr.indexOf('dsh-block-data') >= 0 && instr.indexOf('stats') >= 0;
  R.protocolSectionNumbered = instr.indexOf('# 16. 数据回传协议') >= 0;

  // ---------- 消息级路由：rows 形状 ----------
  msg(fence({ channel: 'stats', round: 1, title: '第 1 轮',
              columns: ['指标', '数值', '单位', '判定'],
              rows: [['增益', '2.41', 'dBi', 'PASS'], ['效率', '-1.82', 'dB', 'PASS']] }), 901);
  const t1 = slotTable();
  R.tableRendered = !!t1;
  R.rowCount = t1 ? t1.querySelectorAll('tbody tr').length : 0;
  R.headerTexts = t1 ? [...t1.querySelectorAll('thead th')].map((x) => x.textContent).join('|') : '';
  R.okCellColored = !!(t1 && t1.querySelector('td.cell-ok'));
  R.titleText = (document.querySelector('.block-data-title') || {}).textContent || '';

  // ---------- 去重：同一段文本再解析一次不应重复渲染 ----------
  msg(fence({ channel: 'stats', round: 1, title: '第 1 轮',
              columns: ['指标', '数值', '单位', '判定'],
              rows: [['增益', '2.41', 'dBi', 'PASS'], ['效率', '-1.82', 'dB', 'PASS']] }), 902);
  R.dedupWorks = slotBoxes() === 1;

  // ---------- 覆盖模式：第 2 轮替换第 1 轮 ----------
  msg(fence({ channel: 'stats', round: 2, title: '第 2 轮', columns: ['指标', '数值'], rows: [['增益', '2.55']] }), 903);
  R.replaceMode = slotBoxes() === 1;
  R.replaceContent = (document.querySelector('.block-data-title') || {}).textContent || '';

  // ---------- 打开累积模式后，第 3 轮 ----------
  document.querySelector('#blockList [data-block-action="edit"]').click();
  // 内置渲染模式下预览应填入测试数据，否则 data-block-slot 区块预览永远是空的
  R.previewShowsSample = !!document.querySelector('#blockPreview table');
  $('beHistory').checked = true;
  $('btnBlockSave').click();
  msg(fence({ channel: 'stats', round: 3, title: '第 3 轮', columns: ['指标', '数值'], rows: [['增益', '2.60']] }), 904);
  // 历史是「运行记录」，与显示模式无关：到此刻已累计 1、2、3 三轮
  const n3 = slotBoxes();
  R.historyMode = n3 === 3;

  // ---------- values / metrics 两种形状 ----------
  msg(fence({ channel: 'stats', round: 4, values: { '增益': '2.7 dBi', '效率': '-1.5 dB' } }), 905);
  R.valuesShape = slotBoxes() === n3 + 1;
  R.valuesTwoCols = document.querySelectorAll('.block-data thead th').length >= 2;
  msg(fence({ channel: 'stats', round: 5, metrics: [{ name: '增益', value: 2.8, unit: 'dBi', status: 'PASS' }] }), 906);
  R.metricsShape = slotBoxes() === n3 + 2;

  // ---------- 通道隔离：无关通道不应投递 ----------
  const before = slotBoxes();
  msg(fence({ channel: 'other', round: 9, rows: [['x']] }), 907);
  R.channelIsolation = slotBoxes() === before;

  // ---------- 自定义脚本：事件派发 ----------
  $('btnBlockNew').click();
  $('beName').value = '自绘区块';
  $('beZone').value = 'left';
  $('beChannel').value = 'custom1';
  $('beRender').value = 'custom';
  $('beScripts').checked = true;
  $('beConfig').value = 'precision=3';
  $('beHtml').value = '<div id="out">等待数据</div><scr' + 'ipt>' +
    'document.currentScript.closest(".custom-body").addEventListener("block-data", function (e) {' +
    'document.getElementById("out").textContent = "round=" + e.detail.round + " rows=" + e.detail.payload.rows.length' +
    ' + " cfg=" + JSON.stringify(e.detail.block.config) + " hist=" + e.detail.history.length; });</scr' + 'ipt>';
  $('btnBlockSave').click();
  R.customBlockSaved = document.querySelectorAll('#blockList .block-row').length === 2;

  msg(fence({ channel: 'custom1', round: 7, rows: [['a', 'b'], ['c', 'd']] }), 908);
  R.customEventFired = ($('out') || {}).textContent || '';

  // ---------- 内置渲染不应出现在 custom 模式 ----------
  R.customModeNoAutoTable = !document.querySelector('#customZoneLeft .custom-block .block-data');

  // ---------- 测试数据按钮 ----------
  const testBtns = [...document.querySelectorAll('#blockList [data-block-action="test"]')];
  R.testBtnCount = testBtns.length;          // 两个区块都配了通道，故为 2
  const beforeTest = slotBoxes();
  if (testBtns.length) testBtns[0].click();
  R.testDataRendered = slotBoxes() === beforeTest + 1;
  R.testDataNote = (document.querySelector('.block-data-note') || {}).textContent || '';

  // ---------- 持久化：新字段应写进 localStorage ----------
  R.storedFieldsOk = (() => {
    try {
      const p = JSON.parse(localStorage.getItem('page-blocks-v1'));
      const b = p.filter((x) => x.channel === 'stats')[0];
      return !!b && b.renderMode === 'auto' && b.keepHistory === true && b.config === 'precision=2'
             && b.demand.indexOf('每轮输出增益') >= 0;
    } catch (e) { return false; }
  })();

  // ---------- 通道名校验 ----------
  $('btnBlockNew').click();
  $('beName').value = '非法通道';
  $('beChannel').value = 'bad channel!';
  $('beHtml').value = '<div>x</div>';
  $('btnBlockSave').click();
  R.invalidChannelRejected = document.querySelectorAll('#blockList .block-row').length === 2;
  $('btnBlockCancel').click();

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

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      try { if (await evalJs("document.readyState==='complete' && !!document.getElementById('editorCard')")) return; } catch (e) {}
      await sleep(250);
    }
  };
  await waitReady();
  // 先清掉上一轮遗留的区块并重新加载，确保初始状态干净
  // （只清 localStorage 不够：页面加载时已经把旧区块读进内存了）
  await evalJs("(() => { try { localStorage.removeItem('page-blocks-v1'); } catch (e) {} return true; })()");
  await send('Page.reload', {});
  await waitReady();
  await sleep(700);

  const res = await evalJs(PHASE);

  const fails = [];
  const expect = (k, v) => { if (res[k] !== v) fails.push(`${k}: 期望 ${JSON.stringify(v)}，实际 ${JSON.stringify(res[k])}`); };
  expect('blockSaved', true);
  expect('chanPill', '通道 stats');
  expect('testBtnShown', true);
  expect('previewClearedOnClose', true);
  expect('protocolHasFence', true);
  expect('protocolHasChannel', true);
  expect('protocolHasDemand', true);
  expect('protocolInInstruction', true);
  expect('protocolSectionNumbered', true);
  expect('tableRendered', true);
  expect('rowCount', 2);
  expect('headerTexts', '指标|数值|单位|判定');
  expect('okCellColored', true);
  expect('dedupWorks', true);
  expect('previewShowsSample', true);
  expect('replaceMode', true);
  expect('historyMode', true);
  expect('valuesShape', true);
  expect('valuesTwoCols', true);
  expect('metricsShape', true);
  expect('channelIsolation', true);
  expect('customBlockSaved', true);
  expect('customModeNoAutoTable', true);
  expect('testBtnCount', 2);
  expect('testDataRendered', true);
  expect('storedFieldsOk', true);
  expect('invalidChannelRejected', true);
  // 标题不应出现「第 N 轮（第 N 轮）」这种重复
  if (/第\s*\d+\s*轮（第\s*\d+\s*轮）/.test(String(res.titleText))) {
    fails.push('titleText 轮次重复：' + JSON.stringify(res.titleText));
  }
  if (String(res.customEventFired).indexOf('round=7 rows=2') !== 0) {
    fails.push('customEventFired: 期望以 "round=7 rows=2" 开头，实际 ' + JSON.stringify(res.customEventFired));
  }
  if (String(res.customEventFired).indexOf('precision') < 0) {
    fails.push('customEventFired 未携带自定义配置：' + JSON.stringify(res.customEventFired));
  }

  console.log(JSON.stringify({ results: res, failures: fails, passed: fails.length === 0 }, null, 2));
  ws.close(); chrome.kill();
  // 断言失败必须让退出码非零（见 docs/dev/tests.md 的约定）
  if (fails.length > 0) process.exit(1);
}
main().catch((e) => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(1); });
