/* ============================================================================
 *  首次配置（CST 路径 + MCP 地址）回归测试
 *  覆盖：首次自动弹出 / 字段持久化 / 本机自检 / 写入任务指令 /
 *        工作区回填 cwd / 顶栏入口 / http 模式 / 恢复默认
 * ========================================================================== */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9371;
const UD = path.join(os.tmpdir(), 'dsh-antenna-setup-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLE = {
  cstRoot: 'C:\\Program Files\\CST Studio Suite 2026',
  cstExe: 'C:\\Program Files\\CST Studio Suite 2026\\AMD64\\CST DESIGN ENVIRONMENT_AMD64.exe',
  mcpName: 'cst-studio-suite',
  mcpTransport: 'stdio',
  mcpCommand: 'C:\\Python311\\python.exe',
  mcpArgs: 'C:\\CST-MCP\\mcp_server.py',
  workspace: 'C:\\cst_runs',
};

const PHASE = `(() => {
  const R = {};
  const $ = (id) => document.getElementById(id);
  const S = ${JSON.stringify(SAMPLE)};

  // ---------- 首次访问应自动弹出 ----------
  R.autoOpened = !$('setupOverlay').hidden;
  R.overlayHasFields = !!$('suCstRoot') && !!$('suCstExe') && !!$('suMcpName') && !!$('suMcpCommand') && !!$('suWorkspace');
  R.checksRendered = document.querySelectorAll('#setupChecks .setup-check').length;
  R.emptyFormAllPending = document.querySelectorAll('#setupChecks .setup-check.fail').length === 0
                       && document.querySelectorAll('#setupChecks .setup-check.pending').length > 0;
  R.hasCloseButton = !!$('setupClose');
  R.evidenceFieldRemoved = !$('suEvidence') && document.querySelector('label[for="suEvidence"]') === null;
  R.setupButtonIsGear = (function () {
    const b = $('btnSetup');
    if (!b) return false;
    return !!b.querySelector('svg') && b.textContent.trim() === '' && !!b.getAttribute('aria-label');
  })();
  // 关键：首屏必须能看到保存按钮（面板曾在视口内溢出导致主操作不可达）
  R.saveButtonInViewport = (function () {
    const b = $('setupSave');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0;
  })();
  R.panelFitsViewport = $('setupOverlay').querySelector('.setup-panel').getBoundingClientRect().height <= window.innerHeight;
  // 自检清单不应被吸底操作栏永久遮挡：滚到底后最后一条必须完整露出
  R.lastCheckReachable = (function () {
    const f = document.getElementById('setupForm');
    f.scrollTop = f.scrollHeight;                 // 滚到底
    const rows = document.querySelectorAll('#setupChecks .setup-check');
    const act = document.querySelector('.setup-actions');
    if (!rows.length || !act) return false;
    const last = rows[rows.length - 1].getBoundingClientRect();
    const bar = act.getBoundingClientRect();
    const ok = last.bottom <= bar.top + 1;
    f.scrollTop = 0;
    return ok;
  })();
  R.__diag = (function () {
    const f = document.getElementById('setupForm');
    const p = document.querySelector('.setup-panel');
    const act = document.querySelector('.setup-actions');
    const chk = document.getElementById('setupChecks');
    const rows = document.querySelectorAll('#setupChecks .setup-check');
    return {
      winH: window.innerHeight,
      panelH: Math.round(p.getBoundingClientRect().height),
      formClient: f.clientHeight, formScroll: f.scrollHeight,
      overflow: f.scrollHeight - f.clientHeight,
      actionsH: Math.round(act.getBoundingClientRect().height),
      checksH: Math.round(chk.getBoundingClientRect().height),
      checkRows: rows.length,
      cols: getComputedStyle(chk).gridTemplateColumns,
    };
  })();

  // ---------- 填写并保存 ----------
  $('suCstRoot').value = S.cstRoot;
  $('suCstExe').value = S.cstExe;
  $('suMcpName').value = S.mcpName;
  $('suMcpCommand').value = S.mcpCommand;
  $('suMcpArgs').value = S.mcpArgs;
  $('suWorkspace').value = S.workspace;
  ['suCstRoot','suCstExe','suMcpCommand','suMcpArgs','suWorkspace'].forEach(function (id) {
    $(id).dispatchEvent(new Event('input', { bubbles: true }));
  });
  R.validFormAllOk = document.querySelectorAll('#setupChecks .setup-check.fail').length === 0
                  && document.querySelectorAll('#setupChecks .setup-check.pending').length === 0;

  $('setupForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  R.closedAfterSave = $('setupOverlay').hidden;
  R.storedOk = (function () {
    try { const p = JSON.parse(localStorage.getItem('page-setup-v1')); return p && p.configured === true && p.cstRoot === S.cstRoot; } catch (e) { return false; }
  })();
  R.readSetupOk = readSetup().cstExe === S.cstExe && readSetup().mcpName === 'cst-studio-suite';

  // ---------- 写入任务指令 ----------
  let instr = '';
  try { instr = buildInstruction(readConfig()); } catch (e) { instr = 'ERR:' + e.message; }
  R.instructionHasSection = instr.indexOf('# 0. 运行环境') >= 0;
  R.instructionHasCstRoot = instr.indexOf(S.cstRoot) >= 0;
  R.instructionHasMcpName = instr.indexOf('cst-studio-suite') >= 0;
  R.instructionHasWorkspace = instr.indexOf(S.workspace) >= 0;
  R.envBeforeTaskGoal = instr.indexOf('# 0. 运行环境') < instr.indexOf('# 任务目标');

  // ---------- 工作区回填 cwd ----------
  R.cwdFilled = $('inpCwd').value === S.workspace;

  // ---------- 顶栏入口可重新打开 ----------
  $('btnSetup').click();
  R.reopenedFromTopbar = !$('setupOverlay').hidden;
  R.reopenedWithValues = $('suCstRoot').value === S.cstRoot;

  // ---------- http 模式隐藏启动参数行 ----------
  $('suMcpTransport').value = 'http';
  $('suMcpTransport').dispatchEvent(new Event('change', { bubbles: true }));
  R.httpHidesArgs = $('suMcpArgsRow').hidden === true;
  R.httpChangesLabel = $('suMcpCommandLabel').textContent.indexOf('地址') >= 0;
  $('suMcpTransport').value = 'stdio';
  $('suMcpTransport').dispatchEvent(new Event('change', { bubbles: true }));
  R.stdioShowsArgs = $('suMcpArgsRow').hidden === false;

  // ---------- 自检能抓出错误值 ----------
  $('suCstExe').value = 'not-an-exe.txt';
  $('suCstExe').dispatchEvent(new Event('input', { bubbles: true }));
  R.badExeCaught = document.querySelectorAll('#setupChecks .setup-check.fail').length > 0;
  $('suCstExe').value = S.cstExe;
  $('suCstExe').dispatchEvent(new Event('input', { bubbles: true }));
  R.goodExeClears = document.querySelectorAll('#setupChecks .setup-check.fail').length === 0;

  $('setupDismiss').click();
  R.dismissed = $('setupOverlay').hidden;
  return R;
})()`;

const PHASE_AFTER_RELOAD = `(() => {
  const R = {};
  R.notAutoOpenedAgain = document.getElementById('setupOverlay').hidden === true;
  R.persisted = readSetup().cstRoot.indexOf('CST Studio Suite 2026') >= 0;
  let instr = '';
  try { instr = buildInstruction(readConfig()); } catch (e) { instr = 'ERR'; }
  R.instructionStillHasEnv = instr.indexOf('# 0. 运行环境') >= 0;

  // ---------- 未保存的改动必须被丢弃 ----------
  // 写盘只发生在「保存配置」；光输入不落盘，关闭浮层时改动应被静默丢弃，
  // 下次打开显示上次保存的值。这条语义容易被误解成「改了就会记住」。
  const savedRoot = readSetup().cstRoot;
  const inp = document.getElementById('suCstRoot');
  const openAndEdit = (val) => {
    document.getElementById('btnSetup').click();
    inp.value = val;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  };
  openAndEdit('X:\\\\UNSAVED-PROBE');
  document.getElementById('setupClose').click();                 // ✕ 关闭
  R.unsavedNotPersisted = readSetup().cstRoot === savedRoot;
  document.getElementById('btnSetup').click();
  R.formShowsSavedNotEdit = inp.value === savedRoot;             // 重开显示的是已保存值
  inp.value = 'Y:\\\\UNSAVED-PROBE-2';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('setupDismiss').click();               // 「稍后再说」关闭
  R.unsavedNotPersisted2 = readSetup().cstRoot === savedRoot;
  document.getElementById('btnSetup').click();
  R.formShowsSavedNotEdit2 = inp.value === savedRoot;
  document.getElementById('setupClose').click();
  return R;
})()`;

const PHASE_RESET = `(() => {
  const R = {};
  window.confirm = () => true;
  document.getElementById('btnSetup').click();
  document.getElementById('setupReset').click();
  R.afterResetCleared = readSetup().cstRoot === '' && readSetup().configured === false;
  R.overlayStillOpen = document.getElementById('setupOverlay').hidden === false;
  document.getElementById('setupDismiss').click();
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
      try { if (await evalJs("document.readyState==='complete' && !!document.getElementById('setupOverlay')")) return; } catch (e) {}
      await sleep(250);
    }
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await waitReady();
  // 清空全部本地存储后重载，模拟「首次下载打开」
  await evalJs("(() => { try { localStorage.clear(); } catch (e) {} return true; })()");
  await send('Page.reload', {});
  await waitReady();
  await sleep(700);

  const p1 = await evalJs(PHASE);
  await send('Page.reload', {});
  await waitReady();
  await sleep(700);
  const p2 = await evalJs(PHASE_AFTER_RELOAD);
  const p3 = await evalJs(PHASE_RESET);

  const all = Object.assign({}, p1, p2, p3);
  const fails = [];
  const expect = (k, v) => { if (all[k] !== v) fails.push(`${k}: 期望 ${JSON.stringify(v)}，实际 ${JSON.stringify(all[k])}`); };
  expect('autoOpened', true);
  expect('overlayHasFields', true);
  expect('checksRendered', 7);
  expect('emptyFormAllPending', true);
  expect('hasCloseButton', true);
  expect('evidenceFieldRemoved', true);
  expect('setupButtonIsGear', true);
  expect('saveButtonInViewport', true);
  expect('panelFitsViewport', true);
  expect('lastCheckReachable', true);
  expect('validFormAllOk', true);
  expect('closedAfterSave', true);
  expect('storedOk', true);
  expect('readSetupOk', true);
  expect('instructionHasSection', true);
  expect('instructionHasCstRoot', true);
  expect('instructionHasMcpName', true);
  expect('instructionHasWorkspace', true);
  expect('envBeforeTaskGoal', true);
  expect('cwdFilled', true);
  expect('reopenedFromTopbar', true);
  expect('reopenedWithValues', true);
  expect('httpHidesArgs', true);
  expect('httpChangesLabel', true);
  expect('stdioShowsArgs', true);
  expect('badExeCaught', true);
  expect('goodExeClears', true);
  expect('dismissed', true);
  expect('notAutoOpenedAgain', true);
  expect('persisted', true);
  expect('unsavedNotPersisted', true);
  expect('formShowsSavedNotEdit', true);
  expect('unsavedNotPersisted2', true);
  expect('formShowsSavedNotEdit2', true);
  expect('instructionStillHasEnv', true);
  expect('afterResetCleared', true);
  expect('overlayStillOpen', true);

  console.log(JSON.stringify({ results: all, failures: fails, passed: fails.length === 0 }, null, 2));
  ws.close(); chrome.kill();
  // 断言失败必须让退出码非零（见 docs/dev/tests.md 的约定）
  if (fails.length > 0) process.exit(1);
}
main().catch((e) => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(1); });
