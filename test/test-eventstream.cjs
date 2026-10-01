/* ============================================================================
 *  会话事件流测试（/api/remote.mux + session/follow）
 *
 *  背景：面板原来连的是 /api/events.mux —— 那个端点在当前 DSH 版本已经完全不存在，
 *  所以右栏从来没有收到过任何东西（「启动仿真」和「发送环境探测指令」都看不到结果）。
 *  现在改成在 /api/remote.mux 上开一条 session/follow 逻辑流。
 *
 *  这个套件不需要真实会话，锁住三件事：
 *    1 源码形状：走 remote.mux 与 session/follow，且不再有旧端点 / 本地乐观追加
 *    2 帧消费语义：快照按 seq 排序、重复 seq 去重、重连重发快照不重复渲染
 *    3 渲染：processSessionEvent 对 user/message、assistant/message、step/end 的反应
 *
 *  端到端的活体验证（真 WS 帧）需要真实实例，做法见 docs/dev/dsh-rpc.md。
 *  用法： node test/test-eventstream.cjs [URL]
 * ========================================================================== */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9403;
const UD = path.join(os.tmpdir(), 'dsh-antenna-eventstream-test');
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
    try { if (await evalJs("document.readyState==='complete' && typeof consumeFollowItem === 'function'")) break; } catch (e) {}
    await sleep(250);
  }
  await sleep(400);

  /* ---------- 1. 源码形状 ---------- */
  const src = await evalJs(`[...document.querySelectorAll('script')].map(s => s.textContent).join('\\n')`);
  all.srcUsesRemoteMux = src.indexOf('REMOTE_MUX_PATH = "/api/remote.mux"') >= 0;
  all.srcHasLegacyEventsMuxCall = src.indexOf('location.host + "/api/events.mux"') >= 0;
  all.srcOpensSessionFollow = src.indexOf('endpoint: "session/follow"') >= 0;
  all.srcFollowSendsArgsEnvelope = src.indexOf('payload: { args: { request: {') >= 0;
  all.srcHandlesItemEndError = src.indexOf('frame.type === "item"') >= 0 && src.indexOf('frame.type === "end"') >= 0 && src.indexOf('frame.type === "error"') >= 0;

  /* ---------- 3. 渲染（先做，用的是真函数） ---------- */
  const render = await evalJs(`(() => {
    const view = document.getElementById('chatView');
    view.innerHTML = '';
    const toolsBefore = Number(document.getElementById('evTools').textContent) || 0;
    processSessionEvent({ type: 'user/message', seq: 9001, time: 0, data: { content: [{ type: 'text', text: 'HELLO_USER' }] } });
    processSessionEvent({ type: 'assistant/message', seq: 9002, time: 0, data: { message: { content: [{ type: 'text', text: 'HELLO_ASSISTANT' }] } } });
    processSessionEvent({ type: 'step/end', seq: 9003, time: 0, data: {} });
    const msgs = [...view.querySelectorAll('.chat-msg')].map(m => ({
      assistant: m.className.indexOf('assistant') >= 0,
      text: (m.querySelector('.chat-body') || {}).textContent
    }));
    return {
      count: msgs.length,
      firstIsUser: msgs[0] ? !msgs[0].assistant : null,
      firstText: msgs[0] ? msgs[0].text : null,
      secondIsAssistant: msgs[1] ? msgs[1].assistant : null,
      secondText: msgs[1] ? msgs[1].text : null,
      toolsBefore: toolsBefore,
      toolsAfter: Number(document.getElementById('evTools').textContent) || 0,
      evSeqShown: Number(document.getElementById('evSeq').textContent) || 0,
    };
  })()`);
  all.renderTwoMessages = render.count === 2;
  all.renderUserRole = render.firstIsUser === true;
  all.renderUserText = render.firstText === 'HELLO_USER';
  all.renderAssistantRole = render.secondIsAssistant === true;
  all.renderAssistantText = render.secondText === 'HELLO_ASSISTANT';
  all.renderToolCounterIncremented = render.toolsAfter === render.toolsBefore + 1;
  all.renderSeqCounterAdvanced = render.evSeqShown >= 9003;

  /* ---------- 1b. 顶栏语义：迭代进度 ≠ 对话轮次 ----------
     曾经的 bug：kIter 显示的是 step/end 计数 + " / " + 最大迭代次数，
     分子是对话步数、分母是优化上限、标签写「迭代进度」，于是出现「25 / 5」。
     这里锁住：步数只动「对话轮次」，迭代进度只认模型回传的 round。 */
  const kpi = await evalJs(`(() => {
    const TI = document.getElementById('kIter');
    const DL = document.getElementById('kDialog');
    const PL = document.getElementById('evTools');
    const max = Number(document.getElementById('inpMaxIter').value) || 15;
    resetRunMonitor();
    const afterReset = { iter: TI.textContent, dialog: DL.textContent, pill: PL.textContent };
    processSessionEvent({ type: 'step/end', seq: 9101, time: 0, data: {} });
    processSessionEvent({ type: 'step/end', seq: 9102, time: 0, data: {} });
    const afterSteps = { iter: TI.textContent, dialog: DL.textContent, pill: PL.textContent };
    updateIterationKPI(3);
    const afterExplicit = TI.textContent;
    // 真实来源：模型回传的数据块里带 round
    routeBlockDataFromText('\\u0060\\u0060\\u0060dsh-block-data\\n{"channel":"stats","round":4,"columns":["轮次"],"rows":[[4]]}\\n\\u0060\\u0060\\u0060');
    const afterFence = TI.textContent;
    updateIterationKPI(2);          // 轮次应单调，不回退
    const afterSmaller = TI.textContent;
    resetRunMonitor();
    const resetAgain = { iter: TI.textContent, dialog: DL.textContent };
    return { max: max, afterReset: afterReset, afterSteps: afterSteps, afterExplicit: afterExplicit,
             afterFence: afterFence, afterSmaller: afterSmaller, resetAgain: resetAgain };
  })()`);
  all.kpiResetIter = kpi.afterReset.iter;
  all.kpiResetDialog = kpi.afterReset.dialog;
  all.kpiResetPill = kpi.afterReset.pill;
  all.stepsOnlyMoveDialogue = kpi.afterSteps.dialog === '2' && kpi.afterSteps.iter === '—';   // ← 核心回归
  all.stepsAlsoMovePill = kpi.afterSteps.pill === '2';
  all.explicitRoundSetsIter = kpi.afterExplicit === '3 / ' + kpi.max;
  all.fenceRoundSetsIter = kpi.afterFence === '4 / ' + kpi.max;
  all.roundIsMonotonic = kpi.afterSmaller === '4 / ' + kpi.max;
  all.kpiResetAgain = kpi.resetAgain.iter === '—' && kpi.resetAgain.dialog === '0';
  all.srcHasOldUpdateKPI = src.indexOf('updateKPI(') >= 0;
  all.srcHasDialogueKPI = src.indexOf('function updateDialogueKPI') >= 0;
  // 标签在 HTML 里，不在 <script> 里 —— 要查 outerHTML
  const html = await evalJs('document.documentElement.outerHTML');
  all.srcKpiLabelIsDialogue = html.indexOf('>对话轮次</div>') >= 0;
  all.srcHasIterLabel = html.indexOf('>迭代进度</div>') >= 0;
  all.noStale25Over5Wiring = html.indexOf('工具调用：') < 0;

  /* ---------- 2. 帧消费语义（把 processSessionEvent 换成记录桩） ---------- */
  const consume = await evalJs(`(() => {
    const saved = processSessionEvent;
    window.__calls = [];
    processSessionEvent = (e) => { window.__calls.push(e.seq); };
    let out = {};
    try {
      chatLastSeq = 0;
      consumeFollowItem({ type: 'snapshot', cursor: 3, records: [
        { event: { seq: 3 } }, { event: { seq: 1 } }, { event: { seq: 2 } }
      ] });
      out.afterSnapshot = window.__calls.slice();
      consumeFollowItem({ type: 'event', event: { seq: 3 } });      // 与快照重叠 → 不应重复
      out.afterDuplicate = window.__calls.slice();
      consumeFollowItem({ type: 'event', event: { seq: 4 } });      // 新事件 → 应追加
      out.afterNewEvent = window.__calls.slice();
      consumeFollowItem({ type: 'snapshot', cursor: 4, records: [    // 重连重发快照 → 不应重复
        { event: { seq: 1 } }, { event: { seq: 4 } }
      ] });
      out.afterReconnectSnapshot = window.__calls.slice();
      consumeFollowItem(null);
      consumeFollowItem({ type: 'assistant-stream', frame: { revision: 1 } });  // 未 opt-in → 忽略
      out.afterGarbage = window.__calls.slice();
      out.lastSeq = chatLastSeq;
    } finally { processSessionEvent = saved; }
    return out;
  })()`);
  all.snapshotSorted = JSON.stringify(consume.afterSnapshot) === JSON.stringify([1, 2, 3]);
  all.duplicateSkipped = JSON.stringify(consume.afterDuplicate) === JSON.stringify([1, 2, 3]);
  all.newEventAppended = JSON.stringify(consume.afterNewEvent) === JSON.stringify([1, 2, 3, 4]);
  all.reconnectSnapshotSkipped = JSON.stringify(consume.afterReconnectSnapshot) === JSON.stringify([1, 2, 3, 4]);
  all.garbageIgnored = JSON.stringify(consume.afterGarbage) === JSON.stringify([1, 2, 3, 4]);
  all.lastSeqTracked = consume.lastSeq === 4;

  /* ---------- 断言 ---------- */
  expect('srcUsesRemoteMux', true);
  expect('srcHasLegacyEventsMuxCall', false);
  expect('srcOpensSessionFollow', true);
  expect('srcFollowSendsArgsEnvelope', true);
  expect('srcHandlesItemEndError', true);
  expect('renderTwoMessages', true);
  expect('renderUserRole', true);
  expect('renderUserText', true);
  expect('renderAssistantRole', true);
  expect('renderAssistantText', true);
  expect('renderToolCounterIncremented', true);
  expect('renderSeqCounterAdvanced', true);
  expect('snapshotSorted', true);
  expect('duplicateSkipped', true);
  expect('newEventAppended', true);
  expect('reconnectSnapshotSkipped', true);
  expect('garbageIgnored', true);
  expect('lastSeqTracked', true);
  // 顶栏语义（迭代进度 ≠ 对话轮次）
  expect('kpiResetIter', '—');
  expect('kpiResetDialog', '0');
  expect('kpiResetPill', '0');
  expect('stepsOnlyMoveDialogue', true);     // ← 曾经的「25 / 5」就是这里错了
  expect('stepsAlsoMovePill', true);
  expect('explicitRoundSetsIter', true);
  expect('fenceRoundSetsIter', true);
  expect('roundIsMonotonic', true);
  expect('kpiResetAgain', true);
  expect('srcHasOldUpdateKPI', false);
  expect('srcHasDialogueKPI', true);
  expect('srcKpiLabelIsDialogue', true);
  expect('srcHasIterLabel', true);
  expect('noStale25Over5Wiring', true);

  console.log(JSON.stringify({ url: URL, results: all, failures: fails, passed: fails.length === 0 }, null, 2));
  ws.close(); chrome.kill();
  if (fails.length > 0) process.exit(1);
}
main().catch((e) => { console.log(JSON.stringify({ error: String((e && e.stack) || e) })); process.exit(1); });
