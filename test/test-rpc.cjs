/* ============================================================================
 *  DSH RPC 契约测试
 *
 *  背景：面板原来按旧协议发请求（点号式端点 /api/session.create、裸 payload），
 *  在当前 DSH 版本上每次都被网关判 404，而当时没有任何测试覆盖这条路径，
 *  所以一直没被发现。这个套件专门锁住三件事：
 *
 *    1 请求形状：两段式端点 /api/<namespace>/<method> + { args: { request: … } }
 *    2 网关判据：把 dsh-api-gateway 的 claimsEndpoint 规则本地复刻一遍，
 *      证明点号式端点确实会被拒（负向对照），防止有人改回去
 *    3 端点存在性：拿本机安装的 DSH 的 typert 清单交叉核对，页面用到的
 *      每个端点都必须真实存在（session.history / host.pickDirectory 就是
 *      这样被查出来的：它们根本不在清单里）
 *
 *  用法： node test/test-rpc.cjs [URL] [DSH 安装目录]
 *     URL 默认 http://127.0.0.1:3080/em-agent
 *     DSH 安装目录默认自动探测；找不到时第 3 组断言记为 SKIP（不判失败），
 *     因为本仓库要能在没装 DSH 的机器上跑。
 * ========================================================================== */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9402;
const UD = path.join(os.tmpdir(), 'dsh-antenna-rpc-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 本机 DSH 安装目录的候选位置 */
function findDshDir(explicit) {
  const cands = [];
  if (explicit) cands.push(explicit);
  if (process.env.DSH_INSTALL_DIR) cands.push(process.env.DSH_INSTALL_DIR);
  if (process.env.APPDATA) cands.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'));
  cands.push(path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh'));
  for (const c of cands) {
    try { if (c && fs.existsSync(path.join(c, 'node_modules', '@deepseek-ai'))) return c; } catch (e) {}
  }
  return null;
}

/* 复刻 dsh-api-gateway 的 claimsEndpoint 第一道判据：
   端点按 '/' 切必须正好 2 段，否则网关在任何业务逻辑之前就回 404。 */
function gatewayClaims(endpoint) {
  if (endpoint === '$events/result') return true;
  const segments = String(endpoint).split('/');
  if (segments.length !== 2 || segments[0] === '' || segments[1] === '') return false;
  return true;
}

/* 从已安装 DSH 的 typert 清单里收集全部 <namespace>/<method> 端点 */
function collectInstalledEndpoints(dshDir) {
  const scope = path.join(dshDir, 'node_modules', '@deepseek-ai');
  const found = new Set();
  for (const pkg of fs.readdirSync(scope)) {
    const f = path.join(scope, pkg, 'lib', 'typert.remote-client.js');
    if (!fs.existsSync(f)) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    let ns = null;
    for (const line of lines) {
      const mn = line.match(/namespace: '([^']+)'/);
      if (mn) { ns = mn[1]; continue; }
      const mm = line.match(/^\s+method: '([^']+)'/);
      if (mm && ns) found.add(`${ns}/${mm[1]}`);
    }
  }
  return found;
}

async function main() {
  const all = {};
  const fails = [];
  const expect = (k, v) => { if (all[k] !== v) fails.push(`${k}: 期望 ${JSON.stringify(v)}，实际 ${JSON.stringify(all[k])}`); };

  /* ---------- 第 3 组：端点存在性（纯文件检查，先做，不依赖浏览器） ---------- */
  const dshDir = findDshDir(process.argv[3]);
  let installed = null;
  if (dshDir) {
    installed = collectInstalledEndpoints(dshDir);
    all.installedEndpointCount = installed.size;
  }
  const usedEndpoints = ['session/create', 'session/prompt', 'session/cancel'];
  if (installed) {
    for (const e of usedEndpoints) all['exists_' + e.replace('/', '_')] = installed.has(e);
    // 已被移除的旧端点必须确实不存在——否则我们删错了功能
    all.sessionHistoryIsGone = !installed.has('session/history');
    all.hostPickDirectoryIsGone = !installed.has('host/pickDirectory');
  } else {
    all.installedEndpointCount = 'SKIP(未找到本机 DSH 安装目录)';
  }

  /* ---------- 第 2 组：网关判据的负向对照 ---------- */
  all.gatewayAcceptsDotted = gatewayClaims('session.create');
  all.gatewayAcceptsSlashed = gatewayClaims('session/create');

  /* ---------- 第 1 组：真实页面里抓请求 ---------- */
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
    try { if (await evalJs("document.readyState==='complete' && typeof dshRpc === 'function'")) break; } catch (e) {}
    await sleep(250);
  }
  await sleep(400);

  // 用桩替换 fetch，收集页面自己构造的请求
  await evalJs(`(() => {
    window.__rpc = [];
    window.fetch = (url, init) => {
      window.__rpc.push({ url: String(url), init: init || null, body: init && init.body ? JSON.parse(init.body) : null });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result: { ok: true, value: { sessionId: 'session-stub', accepted: true } } }) });
    };
    return true;
  })()`);

  const captured = await evalJs(`(async () => {
    await dshRpc('session.create', { cwd: 'X:\\\\probe' });
    await dshRpc('session.prompt', { requestId: 'r1', sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] });
    await dshRpc('session.cancel', { sessionId: 's1' });
    let unknownThrew = '';
    try { await dshRpc('session.history', {}); } catch (e) { unknownThrew = e.message; }
    return { rpc: window.__rpc, unknownThrew };
  })()`);

  const call = (n) => captured.rpc[n] || { body: {} };
  all.createUrl = call(0).url;
  all.createMethod = call(0).body && call(0).body.method;
  all.createHasArgsEnvelope = !!(call(0).body && call(0).body.payload && call(0).body.payload.args);
  all.createArgsKey = call(0).body && call(0).body.payload && call(0).body.payload.args && Object.keys(call(0).body.payload.args)[0];
  all.createCwd = call(0).body && call(0).body.payload && call(0).body.payload.args && call(0).body.payload.args.request && call(0).body.payload.args.request.cwd;
  all.promptUrl = call(1).url;
  all.promptEndpoint = call(1).body && call(1).body.method;
  all.cancelUrl = call(2).url;
  all.unknownMethodThrew = captured.unknownThrew.indexOf('未登记') >= 0;
  all.noDottedEndpointAnywhere = captured.rpc.every((r) => r.body && typeof r.body.method === 'string' && r.body.method.indexOf('.') < 0);

  // 发送路径必须带 requestId（曾因缺失被 gateway/input-invalid 拒绝）
  const sent = await evalJs(`(async () => {
    window.__rpc = [];
    chatSession = 'session-stub';
    try { await sendToChat('probe text'); } catch (e) { return { err: String(e.message) }; }
    const p = window.__rpc.find((r) => r.body && r.body.method === 'session/prompt');
    return { hasRequestId: !!(p && p.body.payload.args.request.requestId), endpoint: p && p.body.method };
  })()`);
  all.sendToChatHasRequestId = !!(sent && sent.hasRequestId);

  // 源码级：不应再残留旧写法。
  // 注意只查「调用点」——注释里保留 session.history / host.pickDirectory 的名字
  // 是刻意的（要说明它们为什么被移除），不能把它们当成残留。
  const src = await evalJs(`[...document.querySelectorAll('script')].map(s => s.textContent).join('\\n')`);
  const callPattern = (name) => new RegExp('dshRpc\\(\\s*["\']' + name.replace(/\./g, '\\.') + '["\']');
  all.srcHasDottedFetch = src.indexOf('"/api/" + method') >= 0;
  all.srcHasSessionHistoryCall = callPattern('session.history').test(src);
  all.srcHasHostPickDirectoryCall = callPattern('host.pickDirectory').test(src);

  /* ---------- 断言 ---------- */
  expect('createUrl', '/api/session/create');
  expect('createMethod', 'session/create');
  expect('createHasArgsEnvelope', true);
  expect('createArgsKey', 'request');
  expect('createCwd', 'X:\\probe');
  expect('promptUrl', '/api/session/prompt');
  expect('promptEndpoint', 'session/prompt');
  expect('cancelUrl', '/api/session/cancel');
  expect('unknownMethodThrew', true);
  expect('noDottedEndpointAnywhere', true);
  expect('sendToChatHasRequestId', true);
  expect('srcHasDottedFetch', false);
  expect('srcHasSessionHistoryCall', false);
  expect('srcHasHostPickDirectoryCall', false);
  expect('gatewayAcceptsSlashed', true);
  expect('gatewayAcceptsDotted', false);          // 负向对照：点号式必须被拒
  if (installed) {
    expect('exists_session_create', true);
    expect('exists_session_prompt', true);
    expect('exists_session_cancel', true);
    expect('sessionHistoryIsGone', true);
    expect('hostPickDirectoryIsGone', true);
  }

  console.log(JSON.stringify({ url: URL, dshDir: dshDir || null, results: all, failures: fails, passed: fails.length === 0 }, null, 2));
  ws.close(); chrome.kill();
  if (fails.length > 0) process.exit(1);
}
main().catch((e) => { console.log(JSON.stringify({ error: String((e && e.stack) || e) })); process.exit(1); });
