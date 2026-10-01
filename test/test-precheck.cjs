/* ============================================================================
 *  工程预检逻辑测试
 *
 *  背景：2026-10-01 实际发生一次误阻断——模型返回的预检报告四项全 PASS，
 *  却被判「工程预检未通过」。根因是判定器的失败正则里含「阻断原因」，
 *  而预检指令自己就要求模型 FAIL 时「列出全部阻断原因」：只要报告里出现
 *  这四个字，无论结论如何都判失败。
 *
 *  这个套件锁住三件事：
 *    1 判定器：取最后出现的判定词作为结论；提到「阻断原因」不等于失败；
 *      读不出判定词时按失败处理（宁可让人看一眼，也不放行没读懂的结果）
 *    2 未通过时先自动补齐再重检；轮次用尽后**不再阻断**（只留一条可见警告，照常开启仿真）
 *    3 场监视器已从「禁止修改」里移出（可自行决定是否添加）
 *
 *  用法： node test/test-precheck.cjs [URL]
 * ========================================================================== */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9404;
const UD = path.join(os.tmpdir(), 'dsh-antenna-precheck-test');
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
    try { if (await evalJs("document.readyState==='complete' && typeof precheckVerdictOf === 'function'")) break; } catch (e) {}
    await sleep(250);
  }
  await sleep(400);

  /* ---------- 1. 判定器 ---------- */
  const verdicts = await evalJs(`(() => {
    // 真实误判场景的形状：四项全 PASS，文末又提到「阻断原因」这四个字
    const passReport =
      "## 1) CST Studio Suite 2026 与 MCP — PASS\\n" +
      "## 2) 源工程存在且可读取（只读） — PASS\\n" +
      "## 3) 工作副本拷贝 + 锁文件 — PASS\\n" +
      "## 4) 天线 / 基板对象路径 — PASS（路径完全一致）\\n" +
      "> 附注：后续处理要求：若工程预检未通过，则自动补充所需条件；阻断原因届时列出。\\n";
    const failReport =
      "## 1) 环境 — PASS\\n## 2) 工程 — PASS\\n" +
      "## 5) 端口配置 — FAIL：未发现内激励端口\\n最终结论：FAIL（并列出全部阻断原因）\\n";
    const failLast =
      "检查项 1 PASS\\n检查项 2 PASS\\n检查项 3 PASS\\n阻断原因：内激励端口缺失\\n结论：预检未通过\\n";
    const noVerdict = "我把工程看了一遍，细节如下。工作副本已就绪，源工程未改动。\\n";
    const passShort = "全部检查完成。\\nPASS\\n";
    return {
      passReport: precheckVerdictOf(passReport),
      failReport: precheckVerdictOf(failReport),
      failLast: precheckVerdictOf(failLast),
      noVerdict: precheckVerdictOf(noVerdict),
      passShort: precheckVerdictOf(passShort),
      empty: precheckVerdictOf(''),
    };
  })()`);
  all.verdictPassReport = verdicts.passReport;      // 关键回归：含「阻断原因」但结论是 PASS
  all.verdictFailReport = verdicts.failReport;
  all.verdictFailLast = verdicts.failLast;
  all.verdictNoVerdict = verdicts.noVerdict;
  all.verdictPassShort = verdicts.passShort;
  all.verdictEmpty = verdicts.empty;

  /* ---------- 3. 政策：场监视器不再锁定 ---------- */
  // 注意：这里用**全文**而不是前 N 个字符。早先断言的是 slice(0, 400)，
  // 于是往补齐指令里加一行（2026-10-02 的覆盖口径）就把「边界条件」挤出了窗口，
  // 断言失败而指令其实完全正确——窗口长度不是被测行为。
  const policy = await evalJs(`(() => ({
    forbidden: FIXED_CONFIG.forbiddenModifications.slice(),
    boxText: (document.querySelector('#secAdvance .blocked-box') || {}).textContent || '',
    remediationText: buildPrecheckRemediationInstruction('端口缺失'),
    conclusionEvidence: precheckJudge('## 1) — PASS\\n最终结论：PASS（可启动仿真）\\n').evidence,
    countEvidence: precheckJudge('## 1) — PASS\\n## 2) — PASS\\n').evidence,
  }))()`);
  all.forbiddenExcludesMonitor = policy.forbidden.indexOf('场监视器') < 0;
  all.forbiddenStillBlocksBoundary = policy.forbidden.indexOf('边界条件') >= 0;
  all.lockedBoxSaysMonitorOptional = policy.boxText.indexOf('场监视器') >= 0 && policy.boxText.indexOf('不锁定') >= 0;
  all.remediationMentionsPort = policy.remediationText.indexOf('内激励端口') >= 0;
  all.remediationMentionsMonitorOptional = policy.remediationText.indexOf('场监视器') >= 0 && policy.remediationText.indexOf('不强制') >= 0;
  all.remediationKeepsForbidden = policy.remediationText.indexOf('边界条件') >= 0;
  all.evidenceIsConclusionLine = policy.conclusionEvidence.indexOf('结论行：') === 0;
  all.evidenceIsCountsWhenNoLine = policy.countEvidence.indexOf('判定词计数') >= 0;

  /* ---------- 2. 补齐轮次流程（2026-10-01 起：永不阻断） ---------- */
  const flow = await evalJs(`(async () => {
    const saved = sendToChat;
    const sent = [];
    sendToChat = async (t) => { sent.push(t); };
    const out = {};
    const R = () => document.getElementById('inpPrecheckRetries');
    const reset = (rounds) => { if (rounds !== undefined) R().value = rounds;
                                precheckRetries = 0; window.__b.hidden = true; sent.length = 0; };
    try {
      const failText = "## 5) 端口 — FAIL：未发现内激励端口\\n结论：FAIL\\n";
      const passText = "## 1) — PASS\\n最终输出：PASS（可启动仿真）\\n";
      window.__b = document.getElementById('precheckBlocked');
      out.defaultRounds = precheckMaxRetries();

      // —— 默认 2 轮：两次补齐，第三次**直接开启仿真**（不再阻断）
      reset('2');
      judgePrecheck(failText);
      out.afterFirst = { retries: precheckRetries, runState: runState, sent: sent.length,
                         listSays: document.getElementById('precheckList').textContent.slice(0, 30),
                         blocked: __b.hidden === false };
      out.remediationHasPort = sent[0].indexOf('内激励端口') >= 0;
      judgePrecheck(failText);
      out.afterSecond = { retries: precheckRetries, sent: sent.length };
      judgePrecheck(failText);
      out.afterThird = { retries: precheckRetries, runState: runState, sent: sent.length,
                         blocked: __b.hidden === false, noteText: __b.textContent,
                         lastSentIsTask: sent[sent.length - 1].indexOf('【预检未通过 → 自动补齐所需条件】') < 0 };

      // —— 读不出结论：同样不阻断，直接开启
      reset('2');
      judgePrecheck('我检查了一下，大概没问题。');
      out.unknown = { blocked: __b.hidden === false, runState: runState, sent: sent.length,
                      noteText: __b.textContent.slice(0, 60) };

      // —— 轮次可配：1 → 只补齐一次
      reset('1');
      judgePrecheck(failText);
      out.rounds1First = { retries: precheckRetries, runState: runState, sent: sent.length };
      judgePrecheck(failText);
      out.rounds1Second = { retries: precheckRetries, runState: runState, sent: sent.length };

      // —— 轮次 0 → 不补齐，直接开启
      reset('0');
      judgePrecheck(failText);
      out.rounds0 = { retries: precheckRetries, runState: runState, sent: sent.length,
                      sentIsTask: sent.length === 1 && sent[0].indexOf('自动补齐所需条件') < 0 };

      // —— 非法/越界值回落
      R().value = '';
      out.roundsInvalid = precheckMaxRetries();
      R().value = '9';
      out.roundsClampedHigh = precheckMaxRetries();
      R().value = '-1';
      out.roundsNegative = precheckMaxRetries();
      R().value = '2';

      // —— 通过路径
      reset('2');
      judgePrecheck(passText);
      out.passPath = { retries: precheckRetries, runState: runState,
                       listItems: document.querySelectorAll('#precheckList .precheck-item').length,
                       blocked: __b.hidden === false, sent: sent.length };
    } finally { sendToChat = saved; }
    return out;
  })()`);
  all.defaultRounds = flow.defaultRounds;
  all.firstRoundRetries = flow.afterFirst.retries;
  all.firstRoundStillPrechecking = flow.afterFirst.runState === 'prchecking';
  all.firstRoundSent = flow.afterFirst.sent;
  all.firstRoundNotBlocked = flow.afterFirst.blocked === false;
  all.secondRoundRetries = flow.afterSecond.retries;
  // 关键：轮次用尽后**不再阻断**（runState 仍进 running），只留一条可见的警告
  all.thirdRoundWarns = flow.afterThird.noteText.indexOf('仍继续开启仿真') >= 0 &&
                        flow.afterThird.noteText.indexOf('阻断原因') < 0;
  all.thirdRoundRetriesReset = flow.afterThird.retries === 0;
  all.thirdRoundIsRunning = flow.afterThird.runState === 'running';
  all.thirdRoundSentTask = flow.afterThird.lastSentIsTask === true;
  all.unknownVerdictWarns = flow.unknown.noteText.indexOf('仍继续开启仿真') >= 0;
  all.unknownVerdictRuns = flow.unknown.runState === 'running';
  all.rounds1OnlyOneRemediation = flow.rounds1First.retries === 1 && flow.rounds1First.sent === 1;
  // 第 2 次调用时轮次已用尽 → 发的是任务指令（共 2 条：1 次补齐 + 1 次任务）
  all.rounds1ThenRuns = flow.rounds1Second.runState === 'running' && flow.rounds1Second.sent === 2;
  all.rounds0SkipsRemediation = flow.rounds0.retries === 0 && flow.rounds0.sent === 1 && flow.rounds0.sentIsTask;
  all.rounds0Runs = flow.rounds0.runState === 'running';
  all.roundsInvalidFallsBack = flow.roundsInvalid === 2;
  all.roundsClampedHigh = flow.roundsClampedHigh === 5;
  all.roundsNegativeFallsBack = flow.roundsNegative === 2;
  all.passPathRunState = flow.passPath.runState;
  all.passPathRetriesReset = flow.passPath.retries === 0;
  all.passPathListFilled = flow.passPath.listItems;
  all.passPathNotBlocked = flow.passPath.blocked === false;
  all.remediationHasPort = flow.remediationHasPort;

  /* ---------- 断言 ---------- */
  expect('verdictPassReport', 'pass');      // ← 本次误判的直接回归
  expect('verdictFailReport', 'fail');
  expect('verdictFailLast', 'fail');
  expect('verdictNoVerdict', 'unknown');
  expect('verdictPassShort', 'pass');
  expect('verdictEmpty', 'unknown');
  expect('forbiddenExcludesMonitor', true);
  expect('forbiddenStillBlocksBoundary', true);
  expect('lockedBoxSaysMonitorOptional', true);
  expect('remediationMentionsPort', true);
  expect('remediationMentionsMonitorOptional', true);
  expect('remediationKeepsForbidden', true);
  expect('evidenceIsConclusionLine', true);
  expect('evidenceIsCountsWhenNoLine', true);
  expect('firstRoundRetries', 1);
  expect('firstRoundStillPrechecking', true);
  expect('firstRoundSent', 1);
  expect('firstRoundNotBlocked', true);
  expect('secondRoundRetries', 2);
  // 2026-10-01 起：轮次用尽不再阻断，而是照常开启仿真（只留警告）
  expect('thirdRoundWarns', true);
  expect('thirdRoundRetriesReset', true);
  expect('thirdRoundIsRunning', true);
  expect('thirdRoundSentTask', true);
  expect('unknownVerdictWarns', true);
  expect('unknownVerdictRuns', true);
  expect('defaultRounds', 2);
  expect('rounds1OnlyOneRemediation', true);
  expect('rounds1ThenRuns', true);
  expect('rounds0SkipsRemediation', true);
  expect('rounds0Runs', true);
  expect('roundsInvalidFallsBack', true);
  expect('roundsClampedHigh', true);
  expect('roundsNegativeFallsBack', true);
  expect('passPathRunState', 'running');
  expect('passPathRetriesReset', true);
  expect('passPathListFilled', 5);
  expect('passPathNotBlocked', true);
  expect('remediationHasPort', true);

  console.log(JSON.stringify({ url: URL, results: all, failures: fails, passed: fails.length === 0 }, null, 2));
  ws.close(); chrome.kill();
  if (fails.length > 0) process.exit(1);
}
main().catch((e) => { console.log(JSON.stringify({ error: String((e && e.stack) || e) })); process.exit(1); });
