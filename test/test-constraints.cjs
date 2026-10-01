/* ============================================================================
 *  天线仿真固定约束（FC1 / FC2）回归测试
 *
 *  背景：用户把两条约束定死，并要求「每一轮 CST 仿真都严格执行」：
 *    FC1 —— 只改天线 antenna 的形状，不得改变天线所在平面；
 *           厚度恒为 0.035 mm（厚度方向即高度方向）、必须坐在 substrate 的上/下表面、
 *           必须与激励端口 port 处于平行且同一高度的平面。
 *    FC2 —— 只允许改天线形状与馈电点位置；不得修改或删除其它 Component。
 *
 *  这个套件锁住的是「约束有没有被真的发出去」，不是「模型有没有听话」：
 *    ① 指令 7.2 节的存在与**路径插值**（改了配置，指令要跟着变）
 *    ② FC1 / FC2 的每一条要件都在指令里
 *    ③ 每一轮：7.2 自检写进了 # 10 的流程，并在预检、预检补齐轮各重申一次
 *    ④ 天线厚度字段只读，且改 DOM / 恢复老存档都顶不掉 0.035
 *
 *  用法： node test/test-constraints.cjs [URL]
 * ========================================================================== */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9411;
const UD = path.join(os.tmpdir(), 'dsh-antenna-constraints-test');
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
    try { if (await evalJs("document.readyState==='complete' && typeof buildInstruction === 'function'")) break; } catch (e) {}
    await sleep(250);
  }
  await sleep(400);

  /* ---------- ① 指令：FC1 / FC2 必须逐条出现，且路径来自配置 ---------- */
  const instr = await evalJs(`(() => {
    document.getElementById('inpProjectDir').value = 'E:/DeepSeek/DATA/CST2026';
    document.getElementById('inpProjectFile').value = 'demo.cst';
    document.getElementById('inpAntennaPath').value = 'Components/ANT/antenna/';
    document.getElementById('inpSubstratePath').value = 'Components/substrate/SUB';
    return buildInstruction(readConfig());
  })()`);
  const has = (s) => instr.indexOf(s) >= 0;
  all.has71 = has('## 7.1 通用刚性约束');
  all.has72 = has('## 7.2 天线仿真固定约束（FC1 / FC2 —— 每一轮 CST 仿真都必须严格执行，违反即该轮结果无效）');
  all.fc1Title = has('【FC1 只改形状、不改平面】');
  all.fc2Title = has('【FC2 只改天线与馈电点、不动其它 Component】');
  all.fc1NamesCard = has('只允许修改「① 工程配置 · 天线对象路径」');
  all.fc1AntPath = has('（Components/ANT/antenna/）');
  all.fc1SubPath = has('（Components/substrate/SUB）');
  all.fc1Thickness = has('天线厚度固定为 0.035 mm');
  all.fc1Surface = has('substrate 的上表面或下表面之一');
  all.fc1NoHop = has('不得在两个面之间跳变');
  all.fc1PortPlane = has('平行且同一高度');
  all.fc1SamePlane = has('端口所在的高度平面与天线所在的高度平面是同一个平面');
  all.fc1ShapeInPlane = has('形状变化只发生在该平面内');
  all.fc1Pifa = has('改成 PIFA 等其它平面形式');
  all.fc2Whitelist = has('每一轮的写入白名单只有两项');
  all.fc2FeedPoint = has('移动馈电点位置');
  all.fc2NoOtherComponent = has('不得修改、不得删除、不得重命名工程内任何其它 Component');
  all.fc2NoBypass = has('不得用「新建 Component / 新建实体再删掉旧的」绕过');
  all.fc2EveryRound = has('本约束在**每一轮** CST 仿真中严格执行');
  all.perRoundSelfCheck = has('`FC1: PASS|FAIL`、`FC2: PASS|FAIL`');
  all.selfCheckEvidence = has('坐落表面（上 / 下）、端口所在平面、本轮改动过的对象清单');
  all.failRoundVoid = has('该轮不得计入候选，必须回退到上一个合规状态');
  all.thicknessInSection6 = has('- 天线厚度：0.035 mm（固定约束 FC1，不可更改）');
  all.designFreedomBounded = has('- 设计自由度：以 7.2 的天线仿真固定约束为界');
  all.perRoundInFlow = instr.indexOf('2) 每轮：写参数→rebuild→7.2 固定约束自检') >= 0;
  all.count72Refs = (instr.match(/7\.2/g) || []).length;

  /* 路径插值：换了配置，7.2 里引用的路径必须跟着换（不是印死的默认值） */
  const instr2 = await evalJs(`(() => {
    document.getElementById('inpAntennaPath').value = 'Components/ANT2/ant2/';
    document.getElementById('inpSubstratePath').value = 'Components/sub2/SUB2';
    return buildInstruction(readConfig());
  })()`);
  all.instr2AntPath = instr2.indexOf('（Components/ANT2/ant2/）') >= 0;
  all.instr2SubPath = instr2.indexOf('（Components/sub2/SUB2）') >= 0;
  all.instr2NoStalePath = instr2.indexOf('（Components/ANT/antenna/）') < 0;

  /* ---------- ② 预检与预检补齐轮：约束同样在生效 ---------- */
  await evalJs(`(() => {
    document.getElementById('inpAntennaPath').value = 'Components/ANT/antenna/';
    document.getElementById('inpSubstratePath').value = 'Components/substrate/SUB';
    return true;
  })()`);
  const pre = await evalJs('buildPrecheckInstruction()');
  all.precheckHasFc = pre.indexOf('- 固定约束（7.2 节 FC1 / FC2）在本任务全程有效') >= 0;
  all.precheckScopesWrites = pre.indexOf('只动天线形状与馈电点，不动其它 Component') >= 0;
  all.precheckStillReadOnly = pre.indexOf('不要开始优化或求解，仅返回检测结果') >= 0;

  const rem = await evalJs('buildPrecheckRemediationInstruction("5) 端口坐标系 — FAIL：端口位于局部坐标系（uvw）")');
  all.remediationHasFc = rem.indexOf('固定约束（7.2 节 FC1 / FC2）在本轮同样有效') >= 0;
  all.remediationNoOtherComponent = rem.indexOf('不得修改或删除其它 Component') >= 0;
  all.remediationKeepsOldBan = rem.indexOf('仍然禁止：修改源工程、') >= 0;

  /* ---------- ③ 天线厚度：只读，且改 DOM / 老存档都顶不掉 ---------- */
  const th = await evalJs(`(() => {
    const out = {};
    const el = document.getElementById('inpThickness');
    out.exists = !!el;
    out.readOnlyProp = el.readOnly === true;
    out.readonlyAttr = el.hasAttribute('readonly');
    out.ariaReadonly = el.getAttribute('aria-readonly');
    out.value = el.value;
    out.cfgThickness = readConfig().thickness;
    out.lockedHint = document.getElementById('secAdvance').textContent.indexOf('固定约束，不可更改') >= 0;
    // 绕过只读直接改 DOM：配置与指令都不能跟着走
    el.value = '0.050';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    out.cfgAfterDomEdit = readConfig().thickness;
    out.instrHonoursDomEdit = buildInstruction(readConfig()).indexOf('0.050') >= 0;
    out.instrPinned = buildInstruction(readConfig()).indexOf('- 天线厚度：0.035 mm（固定约束 FC1，不可更改）') >= 0;
    // 老存档里存过别的厚度：恢复时也不能顶掉固定约束
    // 先把 DOM 复位成 0.035，再种一个 0.080 的存档：恢复若真跑了就会变成 0.080，
    // 所以这一条能区分「跳过了」和「碰巧没变」。
    el.value = '0.035';
    localStorage.setItem('cst-console-config-v1', JSON.stringify({ fields: { inpThickness: '0.080' } }));
    loadPanelState();
    out.valueAfterRestore = document.getElementById('inpThickness').value;
    out.cfgAfterRestore = readConfig().thickness;
    localStorage.removeItem('cst-console-config-v1');
    return out;
  })()`);
  Object.assign(all, th);

  /* 固定约束不是配置项：界面上不该出现能改 FC1/FC2 的控件 */
  all.noFcControls = await evalJs(
    "document.querySelectorAll('input[id*=fc],select[id*=fc],textarea[id*=fc],input[id*=FC]').length === 0");

  /* 常量口径：面板里那份文案与指令里的是同一份（不是各写一遍） */
  all.constThickness = await evalJs('ANTENNA_THICKNESS_MM');
  all.constFc1 = await evalJs('FC1_TITLE');
  all.constFc2 = await evalJs('FC2_TITLE');
  all.linesFromFunction = await evalJs(
    "fixedConstraintLines({ antennaPath: 'A/', substratePath: 'B/' }).indexOf('（A/）') >= 0 && " +
    "fixedConstraintLines({ antennaPath: 'A/', substratePath: 'B/' }).indexOf('（B/）') >= 0");

  /* ---------- 断言 ---------- */
  expect('has71', true);
  expect('has72', true);
  expect('fc1Title', true);
  expect('fc2Title', true);
  expect('fc1NamesCard', true);
  expect('fc1AntPath', true);
  expect('fc1SubPath', true);
  expect('fc1Thickness', true);
  expect('fc1Surface', true);
  expect('fc1NoHop', true);
  expect('fc1PortPlane', true);
  expect('fc1SamePlane', true);
  expect('fc1ShapeInPlane', true);
  expect('fc1Pifa', true);
  expect('fc2Whitelist', true);
  expect('fc2FeedPoint', true);
  expect('fc2NoOtherComponent', true);
  expect('fc2NoBypass', true);
  expect('fc2EveryRound', true);
  expect('perRoundSelfCheck', true);
  expect('selfCheckEvidence', true);
  expect('failRoundVoid', true);
  expect('thicknessInSection6', true);
  expect('designFreedomBounded', true);
  expect('perRoundInFlow', true);
  expect('count72Refs', 3);
  expect('instr2AntPath', true);
  expect('instr2SubPath', true);
  expect('instr2NoStalePath', true);
  expect('precheckHasFc', true);
  expect('precheckScopesWrites', true);
  expect('precheckStillReadOnly', true);
  expect('remediationHasFc', true);
  expect('remediationNoOtherComponent', true);
  expect('remediationKeepsOldBan', true);
  expect('exists', true);
  expect('readOnlyProp', true);
  expect('readonlyAttr', true);
  expect('ariaReadonly', 'true');
  expect('value', '0.035');
  expect('cfgThickness', '0.035');
  expect('lockedHint', true);
  expect('cfgAfterDomEdit', '0.035');
  expect('instrHonoursDomEdit', false);
  expect('instrPinned', true);
  expect('valueAfterRestore', '0.035');
  expect('cfgAfterRestore', '0.035');
  expect('noFcControls', true);
  expect('constThickness', '0.035');
  expect('constFc1', 'FC1 只改形状、不改平面');
  expect('constFc2', 'FC2 只改天线与馈电点、不动其它 Component');
  expect('linesFromFunction', true);

  console.log(JSON.stringify({ url: URL, results: all, failures: fails, passed: fails.length === 0 }, null, 2));
  ws.close(); chrome.kill();
  if (fails.length > 0) process.exit(1);
}
main().catch((e) => { console.log(JSON.stringify({ error: String((e && e.stack) || e) })); process.exit(1); });
