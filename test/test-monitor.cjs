/* ============================================================================
 *  运行监控 / 对话输入 / 端口坐标系约束 测试（补丁 P67）
 *
 *  背景：2026-10-01 用户提的三点，都由这个套件锁住：
 *    ① 激励端口经常被建在局部坐标系 local WCS(uvw) 上 —— 指令里原来一个字都没提
 *       坐标系。现在「任务指令 / 预检项 5 / 预检补齐轮」三处必须口径一致。
 *    ② 对话输入框按回车不发送（只有「发送」按钮），而且「清空对话」会把 chatSession
 *       丢掉、状态改成 idle —— 正在跑的迭代从此无从跟踪。发送必须是队列模式（不打断）。
 *    ③ 运行监控的 S11 曲线原来把全部采集点连成一条线，多轮多候选混在一起，
 *       看不出哪一轮最好。现在按轮次分桶、每轮每频点取最优，一轮一条曲线。
 *    ④（2026-10-02）迭代中覆盖旧工程时 CST 弹「删除旧结果」确认框，要人工点掉。
 *       覆盖口径现在写进指令三处，并禁止模型自行删工程文件、禁止依赖确认框。
 *
 *  用法： node test/test-monitor.cjs [URL]
 * ========================================================================== */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9410;
const UD = path.join(os.tmpdir(), 'dsh-antenna-monitor-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const all = {}; const fails = [];
  const expect = (k, v) => { if (all[k] !== v) fails.push(`${k}: 期望 ${JSON.stringify(v)}，实际 ${JSON.stringify(all[k])}`); };

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
  for (let i = 0; i < 60; i++) {
    try { if (await evalJs("document.readyState==='complete' && typeof chartRoundTraces === 'function'")) break; } catch (e) {}
    await sleep(250);
  }
  await sleep(400);

  /* ---------- ① 端口坐标系约束（指令 / 预检 / 补齐三处一致） ---------- */
  all.portRuleText = await evalJs('PORT_CS_RULE');
  const instr = await evalJs('buildInstruction(readConfig())');
  all.instrHasPortCs = instr.indexOf('馈电端口坐标系：' + all.portRuleText) >= 0;
  all.instrHasNotePortCs = instr.indexOf('【坐标系硬性要求】') >= 0;
  all.instrBansUvwLiteral = instr.indexOf('禁止把 uvw 下的数值直接当作 xyz 填入') >= 0;
  all.instrRequiresRebuild = instr.indexOf('必须删除并按全局 xyz 重建后再求解') >= 0;
  all.instrLocksPortCs = instr.indexOf('- 端口坐标系：必须为全局坐标系 xyz') >= 0;
  const pre = await evalJs('buildPrecheckInstruction()');
  all.precheckChecksPortCs = pre.indexOf('全局坐标系 xyz 下（不是局部 WCS/uvw）') >= 0;
  all.precheckNamesFailReason = pre.indexOf('端口位于局部坐标系（uvw）') >= 0;
  const rem = await evalJs('buildPrecheckRemediationInstruction("5) 端口坐标系 — FAIL：端口位于局部坐标系（uvw）")');
  all.remediationFixesPortCs = rem.indexOf('端口必须在全局坐标系 xyz 下建立') >= 0 && rem.indexOf('按全局 xyz 重建') >= 0;

  /* ---------- ①b 工作副本覆盖口径 ----------
     实测问题：迭代中覆盖旧工程时 CST 弹「删除旧结果」确认框，必须人工点掉。
     根因在 CST-MCP 的 save_project 只删 .cst、留下非空的伴随目录。口径必须
     出现在「7.1 刚性约束 / # 10 每轮流程 / 预检补齐轮」三处，且明确禁止
     自行删除工程文件与依赖确认框。 */
  all.saveRuleText = await evalJs('SAVE_OVERWRITE_RULE');
  all.instrLocksOverwrite = instr.indexOf('- 工程覆盖：' + all.saveRuleText) >= 0;
  all.instrPerRoundOverwrite = instr.indexOf('→保存（覆盖已存在的路径必须带 {"overwrite": true}，见 7.1）→') >= 0;
  all.instrBansDiyDelete = instr.indexOf('不得自行删除工程文件') >= 0;
  all.instrBansDialog = instr.indexOf('不得依赖任何 CST 交互式确认框') >= 0;
  all.remediationFixesOverwrite = rem.indexOf('工程覆盖：' + all.saveRuleText) >= 0;

  /* ---------- ② 对话输入：回车发送 / 不打断 / 清空不丢会话 ---------- */
  const enter = await evalJs(`(() => {
    const out = {};
    const input = document.getElementById('chatInput');
    let calls = 0;
    const orig = window.sendChatMessageManually;
    window.sendChatMessageManually = () => { calls++; };
    const mk = (init) => new KeyboardEvent('keydown', Object.assign({ key: 'Enter', bubbles: true, cancelable: true }, init));
    const plain = mk({});
    input.dispatchEvent(plain);
    out.enterCalls = calls;
    out.enterPrevented = plain.defaultPrevented;
    const shift = mk({ shiftKey: true });
    input.dispatchEvent(shift);
    out.shiftCalls = calls;
    out.shiftNotPrevented = !shift.defaultPrevented;
    // 中文输入法选字的回车：isComposing=true 时必须放行
    input.dispatchEvent(mk({ isComposing: true }));
    out.composingCalls = calls;
    // keyCode 229 是「输入法正在处理」的另一个信号（init 字典里设不了，用 defineProperty 造）
    const ime = mk({});
    Object.defineProperty(ime, 'keyCode', { get: () => 229 });
    input.dispatchEvent(ime);
    out.imeCalls = calls;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    out.otherKeyCalls = calls;
    window.sendChatMessageManually = orig;
    return out;
  })()`);
  Object.assign(all, enter);
  const sendSrc = await evalJs('String(sendToChat)');
  all.sendUsesQueue = sendSrc.indexOf('"queue"') >= 0;
  all.sendNeverSteer = sendSrc.indexOf('steer') < 0;
  const manSrc = await evalJs('String(sendChatMessageManually)');
  all.manualNoCancel = manSrc.indexOf('cancel') < 0;
  all.manualKeepsInputOnFail = manSrc.indexOf('内容已保留在输入框') >= 0;
  all.manualQueuedHint = manSrc.indexOf('不打断当前任务') >= 0;
  all.hintInDom = await evalJs(`document.querySelectorAll('section.card').length > 0 && document.body.innerHTML.indexOf('不会打断正在运行的预检或迭代') >= 0`);

  const clear = await evalJs(`(() => {
    const out = {};
    const origConfirm = window.confirm;
    chatSession = 'S-TEST'; chatLastSeq = 42; setRunState('running');
    window.confirm = () => false;
    document.getElementById('btnClearChat').click();
    out.declinedKeepsSession = chatSession;
    out.declinedKeepsState = runState;
    window.confirm = () => true;
    document.getElementById('chatView').innerHTML = '<div class="chat-msg">x</div>';
    document.getElementById('btnClearChat').click();
    out.clearedView = document.getElementById('chatView').innerHTML === '';
    out.keptSessionWhileRunning = chatSession;
    out.keptStateWhileRunning = runState;
    window.confirm = origConfirm;
    setRunState('completed');
    document.getElementById('btnClearChat').click();
    out.idleDetachedSession = String(chatSession);
    out.idleState = runState;
    return out;
  })()`);
  Object.assign(all, clear);

  /* ---------- ③ 每轮最佳曲线 ---------- */
  const chart = await evalJs(`(() => {
    const out = {};
    chartData = [
      { f: 2.40, db: -8,  round: 1 }, { f: 2.45, db: -9,  round: 1 }, { f: 2.50, db: -10, round: 1 },
      { f: 2.40, db: -12, round: 1 },
      { f: 2.40, db: -11, round: 2 }, { f: 2.45, db: -13, round: 2 }, { f: 2.50, db: -15, round: 2 },
    ];
    const tr = chartRoundTraces();
    out.traceCount = tr.length;
    out.rounds = tr.map((t) => t.round).join(',');
    out.round1Points = tr[0].pts.length;
    out.round1At240 = tr[0].pts.filter((p) => p.f === 2.4)[0].db;
    out.round1Worst = tr[0].worst;
    out.round2Worst = tr[1].worst;
    out.bestRound = chartBestRound(tr).round;
    drawChart();
    const html = document.getElementById('chartBox').innerHTML;
    out.polylines = (html.match(/<polyline/g) || []).length;
    out.bestLineWidths = (html.match(/stroke-width="2.8"/g) || []).length;
    out.dots = (html.match(/<circle/g) || []).length;
    out.noteHasBest = html.indexOf('★ 当前最佳：第 2 轮') >= 0;
    out.noteRoundCount = html.indexOf('共 2 轮曲线') >= 0;
    updateResultTable();
    out.footerHasBest = document.getElementById('resultTable').innerHTML.indexOf('当前最佳为第 2 轮') >= 0;
    return out;
  })()`);
  Object.assign(all, chart);

  /* 轮次归属：同一条消息里先看到回传的 round，后面的频点必须落到本轮（旧实现落到上一轮） */
  const attrib = await evalJs(`(() => {
    resetRunMonitor();
    // 反引号用 fromCharCode 造，免得在模板字面量里互相打架
    const f = String.fromCharCode(96).repeat(3);
    const text = '第 7 轮结果：' + f + 'dsh-block-data\\n' +
      '{"channel":"c1","round":7,"title":"第 7 轮","columns":["项目","值"],"rows":[["最差 S11","-9.5 dB"]]}\\n' +
      f + '\\n2.45 GHz 处 S11 = -21 dB';
    processSessionEvent({ seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: text }] } } });
    const out = {};
    out.pointCount = chartData.length;
    out.pointRound = chartData.length ? chartData[0].round : null;
    out.kIter = document.getElementById('kIter').textContent;
    out.tracesAfterAttrib = chartRoundTraces().length;
    return out;
  })()`);
  Object.assign(all, attrib);

  /* 无轮次信息时归到第 0 轮（基线），而不是丢掉；reset 后必须真的没有曲线 */
  const baseline = await evalJs(`(() => {
    resetRunMonitor();
    collectFreqDbFromText('2.4 GHz 处 S11 = -6 dB');
    const out = { round: chartData.length ? chartData[0].round : null, traces: chartRoundTraces().length };
    resetRunMonitor();
    out.afterReset = chartRoundTraces().length;
    const html = document.getElementById('chartBox').innerHTML;
    out.emptyNoLine = (html.match(/<polyline/g) || []).length === 0;
    out.emptyNote = html.indexOf('暂无曲线数据') >= 0;
    chartData = [];
    return out;
  })()`);
  Object.assign(all, baseline);

  /* ---------- 断言 ---------- */
  expect('portRuleText', '全局坐标系（Global WCS，xyz）——禁止局部坐标系 local WCS(uvw)');
  expect('instrHasPortCs', true);
  expect('instrHasNotePortCs', true);
  expect('instrBansUvwLiteral', true);
  expect('instrRequiresRebuild', true);
  expect('instrLocksPortCs', true);
  expect('precheckChecksPortCs', true);
  expect('precheckNamesFailReason', true);
  expect('remediationFixesPortCs', true);

  expect('saveRuleText', '覆盖已存在的工程路径必须带 {"overwrite": true}：cst_save_project_tool 会先关闭仍占用该路径的工程，再由 CST 覆盖 .cst 与其 Result/ 目录；不得自行删除工程文件，也不得依赖任何 CST 交互式确认框');
  expect('instrLocksOverwrite', true);
  expect('instrPerRoundOverwrite', true);
  expect('instrBansDiyDelete', true);
  expect('instrBansDialog', true);
  expect('remediationFixesOverwrite', true);

  expect('enterCalls', 1);
  expect('enterPrevented', true);
  expect('shiftCalls', 1);
  expect('shiftNotPrevented', true);
  expect('composingCalls', 1);
  expect('imeCalls', 1);
  expect('otherKeyCalls', 1);
  expect('sendUsesQueue', true);
  expect('sendNeverSteer', true);
  expect('manualNoCancel', true);
  expect('manualKeepsInputOnFail', true);
  expect('manualQueuedHint', true);
  expect('hintInDom', true);
  expect('declinedKeepsSession', 'S-TEST');
  expect('declinedKeepsState', 'running');
  expect('clearedView', true);
  expect('keptSessionWhileRunning', 'S-TEST');
  expect('keptStateWhileRunning', 'running');
  expect('idleDetachedSession', 'null');
  expect('idleState', 'idle');

  expect('traceCount', 2);
  expect('rounds', '1,2');
  expect('round1Points', 3);
  expect('round1At240', -12);
  expect('round1Worst', -9);
  expect('round2Worst', -11);
  expect('bestRound', 2);
  expect('polylines', 2);
  expect('bestLineWidths', 1);
  expect('dots', 3);
  expect('noteHasBest', true);
  expect('noteRoundCount', true);
  expect('footerHasBest', true);
  expect('pointCount', 1);
  expect('pointRound', 7);
  expect('kIter', '7 / ' + (await evalJs('document.getElementById("inpMaxIter").value || 15')));
  expect('tracesAfterAttrib', 1);
  expect('round', 0);
  expect('traces', 1);
  expect('afterReset', 0);
  expect('emptyNoLine', true);
  expect('emptyNote', true);

  console.log(JSON.stringify({ url: URL, results: all, failures: fails, passed: fails.length === 0 }, null, 2));
  ws.close(); chrome.kill();
  if (fails.length > 0) process.exit(1);
}
main().catch((e) => { console.log(JSON.stringify({ error: String((e && e.stack) || e) })); process.exit(1); });
