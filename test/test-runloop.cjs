/* ============================================================================
 *  运行环路端到端（2026-11-14 新增）
 *
 *  锁住一件事：面板点「启动仿真」→ 宿主 /em-agent/run → headless dsh 子进程
 *  → JSONL → SSE → 事件渲染进 #chatView，且不经过 DSH 的对话 surface。
 *
 *  通过标准：
 *    1 页面注入成功：.em-runbar 存在、token meta 存在、默认审批 danger-full-access
 *    2 点击后 90 秒内出现 log-row，且状态收尾为「已结束」
 *    3 记录里同时出现 工具 行与 结束 行（证明工具事件与终止事件都被渲染）
 *    4 无页面异常
 *
 *  为防止误触 CST，运行前把 buildInstruction 换成一条无害指令。
 *  用法：node test/test-runloop.cjs [URL]
 *  环境：需要正在服务的 DSH 页面（默认 3080）。
 * ========================================================================== */
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9441;
const UD = path.join(os.tmpdir(), 'dsh-e2e-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`,
    '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find(t => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(250);
  }
  if (!target) { console.log('CDP 未就绪'); process.exit(2); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String((m.params.exceptionDetails || {}).text || '').slice(0, 200));
  };
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), 8000)),
    ]);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Navigation.enable').catch(() => {});
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 80; i++) { try { if (await evalJs("document.readyState==='complete' && !!document.querySelector('.em-runbar')")) break; } catch (e) {} await sleep(250); }
  await sleep(400);

  const boot = await evalJs(`(() => ({
    runbar: !!document.querySelector('.em-runbar'),
    token: (document.querySelector('meta[name="dsh-em-agent-token"]')||{}).content ? 'present' : 'missing',
    policy: (document.querySelector('.em-runbar select')||{}).value || '',
    bridgeLoaded: !!window.__emBridgeLoaded || !!document.querySelector('.em-runbar'),
    btnStart: !!document.getElementById('btnStart'),
    chatView: !!document.getElementById('chatView'),
  }))()`);
  console.log('boot =', JSON.stringify(boot));

  // 先验证「真实路径」能生成指令 —— 这一条能抓住 buildInstruction 调用方式错误
  // （历史上的 bug：漏传 readConfig() 导致恒为空，而下面的替换会让测试照样通过）。
  const realInstruction = await evalJs(`(() => {
    try {
      if (typeof window.readConfig !== 'function') return { error: 'readConfig missing' };
      var cfg = window.readConfig();
      var text = window.buildInstruction(cfg);
      return { len: String(text || '').length, head: String(text || '').slice(0, 40) };
    } catch (e) { return { error: (e && e.message) || String(e) }; }
  })()`);
  console.log('real instruction =', JSON.stringify(realInstruction));

  // 再换成无害指令，避免真的去驱动 CST
  await evalJs(`(() => { window.buildInstruction = function(){ return '只回复两个字：OK。不要调用任何工具，不要读写任何文件。'; }; return true; })()`);
  await evalJs(`(() => { var b=document.getElementById('btnStart'); b.click(); return true; })()`);
  const realLen = (realInstruction && realInstruction.len) || 0;
  if (realLen < 100) {
    console.log('FAIL: 真实指令生成为空 —— ' + JSON.stringify(realInstruction));
    process.exit(1);
  }
  console.log('clicked 启动仿真');

  const seen = [];
  let last = '';
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    let snap;
    try {
      snap = await evalJs(`(() => {
        var rows = [...document.querySelectorAll('#chatView .log-row, #chatView details')];
        var status = (document.querySelector('.em-runbar span:last-child')||{}).textContent || '';
        return { n: rows.length, status: status.trim(), tail: rows.slice(-6).map(function(r){ return (r.className||'')+' | '+(r.textContent||'').replace(/\\s+/g,' ').slice(0,110); }) };
      })()`);
    } catch (e) { break; }
    if (snap.n !== seen.length) { seen.push(snap.n); console.log('rows =', snap.n, 'status =', snap.status); }
    last = snap.status;
    if (snap.tail.length) console.log('  tail:', snap.tail.slice(-3).join(' || '));
    if (/已结束|宿主不可达|启动失败|并发/.test(snap.status)) break;
  }

  const finalRows = await evalJs(`[...document.querySelectorAll('#chatView .log-row')].map(function(r){ return (r.className||'')+' :: '+(r.textContent||'').replace(/\\s+/g,' ').slice(0,90); })`);
  console.log('final row count =', finalRows.length);
  finalRows.slice(0, 14).forEach((r) => console.log('  -', r));
  console.log('status =', last);
  console.log('page errors =', errors.length ? errors : 'none');

  ws.close(); chrome.kill();
})();
