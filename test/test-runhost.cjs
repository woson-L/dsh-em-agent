/* ============================================================================
 *  run-host 单测（不依赖模型、不依赖 DSH）
 *
 *  用 test/fixtures/fake-dsh.cjs 冒充 headless，锁住四件事：
 *    1 鉴权：缺 token / 错 token 一律 403
 *    2 并发门：上限 1 时第二个 run 返回 429
 *    3 事件流：SSE 收齐事件并收敛为 done；Last-Event-ID 只补发后续事件
 *    4 取消：挂起的子进程被终止，状态收敛且不留 running
 *
 *  用法：node test/test-runhost.cjs
 * ========================================================================== */
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake-dsh.cjs');
process.env.DSH_BIN = FAKE; // run-host 在 spawn 时读取
// 设置落盘指向临时文件，避免污染真实用户配置
process.env.DSH_EM_AGENT_SETTINGS = path.join(require('node:os').tmpdir(), 'dsh-em-agent-test-settings.json');
try { require('node:fs').rmSync(process.env.DSH_EM_AGENT_SETTINGS, { force: true }); } catch (e) {}

const TOKEN = 'unit-token';
const PORT = 9451;

const checks = [];
const fails = [];
function eq(name, got, want) {
  checks.push({ name, got, want, ok: got === want });
  if (got !== want) fails.push(`${name}: 期望 ${JSON.stringify(want)} 实际 ${JSON.stringify(got)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(p, body, tok = TOKEN) {
  return fetch(`http://127.0.0.1:${PORT}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(tok ? { 'x-em-token': tok } : {}) },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
}

function sse(runId, lastId) {
  return new Promise((resolve) => {
    const events = [];
    const headers = { 'x-em-token': TOKEN };
    if (lastId !== undefined) headers['last-event-id'] = String(lastId);
    const req = http.get(`http://127.0.0.1:${PORT}/em-agent/run/${runId}/events`, { headers }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
          if (!data) continue;
          try { const o = JSON.parse(data); if (o && o.kind) events.push(o); } catch (e) {}
        }
      });
      res.on('end', () => resolve(events));
    });
    req.on('error', () => resolve(events));
    setTimeout(() => { try { req.destroy(); } catch (e) {} resolve(events); }, 20000);
  });
}

(async () => {
  const { createRunHost, buildPatch, decodeMaybeGbk } = await import(pathToFileURL(path.join(ROOT, 'plugin', 'run-host.js')).href);
  const host = createRunHost({ routePath: '/em-agent', token: TOKEN, maxConcurrent: () => 1 });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    host.handle(req, res, url).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } })
      .catch((e) => { if (!res.headersSent) { res.writeHead(500); res.end(String(e)); } });
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  // 0) 运行 patch：会话隔离 + 权限钉死 + MCP 派生
  const pDanger = buildPatch({ mcp: null, policy: 'danger-full-access', sessionRoot: '/tmp/priv' });
  eq('patch 重定向会话存储', pDanger.includes('- id: session-persistence-jsonl'), true);
  eq('patch 写入私有 root', pDanger.includes('root: "/tmp/priv"'), true);
  eq('danger-full-access → approval never', pDanger.includes('policy: "never"'), true);
  eq('patch 钉死 sandbox mode', pDanger.includes('mode: "danger-full-access"'), true);
  const pWrite = buildPatch({ mcp: { dir: 'C:\\CST-MCP' }, policy: 'workspace-write', sessionRoot: '' });
  eq('workspace-write → approval ask', pWrite.includes('policy: "ask"'), true);
  eq('MCP 注册含 command 字段', pWrite.includes('command: '), true);
  eq('MCP 注册为 mcp-cst-studio-suite', pWrite.includes('mcp-cst-studio-suite'), true);
  // 0c) stderr 解码与解释器派生（2026-11-14 修复的两个真实 bug）
  const gbkBytes = Buffer.from([0xCF,0xB5,0xCD,0xB3,0xD5,0xD2,0xB2,0xBB,0xB5,0xBD,0xD6,0xB8,0xB6,0xA8,0xB5,0xC4,0xC2,0xB7,0xBE,0xB6,0xA1,0xA3]);
  eq('GBK 的 stderr 能正确解码', decodeMaybeGbk(gbkBytes), '系统找不到指定的路径。');
  eq('UTF-8 内容不被误转', decodeMaybeGbk(Buffer.from('正常', 'utf8')), '正常');
  const noVenv = buildPatch({ mcp: { dir: 'C:\\definitely-not-exist' }, policy: 'workspace-write', sessionRoot: '' });
  eq('venv 不存在时回退 PATH 上的 python', noVenv.includes('command: "python"'), true);
  const fakeRoot = path.join(require('node:os').tmpdir(), 'dsh-fake-mcp');
  const fakePython = path.join(fakeRoot, '.venv', 'Scripts', 'python.exe');
  require('node:fs').mkdirSync(path.dirname(fakePython), { recursive: true });
  require('node:fs').writeFileSync(fakePython, '');
  const withVenv = buildPatch({ mcp: { dir: fakeRoot }, policy: 'workspace-write', sessionRoot: '' });
  eq('存在 .venv 时优先使用它', withVenv.includes('python.exe') && withVenv.includes('dsh-fake-mcp'), true);
  // 0b) 设置持久化：宿主侧文件，跨页面/跨端口有效
  const sNoTok = await fetch(`http://127.0.0.1:${PORT}/em-agent/settings`);
  eq('settings 缺 token → 403', sNoTok.status, 403);
  const put = await post('/em-agent/settings', { mcpDir: 'E:\\CST-MCP', policy: 'danger-full-access' });
  eq('settings 写入 → 200', put.status, 200);
  eq('settings 回显 mcpDir', put.body && put.body.mcpDir, 'E:\\CST-MCP');
  const got = await fetch(`http://127.0.0.1:${PORT}/em-agent/settings`, { headers: { 'x-em-token': TOKEN } }).then((r) => r.json());
  eq('settings 读回 mcpDir', got.mcpDir, 'E:\\CST-MCP');
  eq('settings 读回 policy', got.policy, 'danger-full-access');
  const bad = await post('/em-agent/settings', { policy: 'bogus', evil: 'x' });
  eq('非法 policy 被忽略（保留原值）', bad.body && bad.body.policy, 'danger-full-access');
  eq('未知键被丢弃', bad.body && bad.body.evil, undefined);
  // 1) 鉴权
  const noTok = await fetch(`http://127.0.0.1:${PORT}/em-agent/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"instruction":"x"}',
  });
  eq('run 缺 token → 403', noTok.status, 403);
  const badTok = await post('/em-agent/run', { instruction: 'x' }, 'nope');
  eq('run 错 token → 403', badTok.status, 403);
  const listNoTok = await fetch(`http://127.0.0.1:${PORT}/em-agent/runs`);
  eq('runs 缺 token → 403', listNoTok.status, 403);

  // 2) 启动 + 并发门
  const first = await post('/em-agent/run', { instruction: 'hello' });
  eq('首个 run → 200', first.status, 200);
  eq('返回 runId', typeof (first.body && first.body.runId), 'string');
  const runId = first.body.runId;

  const second = await post('/em-agent/run', { instruction: 'x' });
  eq('并发上限 1 时第二个 → 429', second.status, 429);
  eq('429 带 cap', second.body && second.body.cap, 1);

  // 3) 事件流
  const events = await sse(runId);
  eq('SSE 收到 done', events.some((e) => e.kind === 'done'), true);
  eq('SSE 收到工具事件', events.some((e) => e.kind === 'tool'), true);
  eq('SSE 收到 assistant 事件', events.some((e) => e.kind === 'assistant'), true);
  const doneEvt = events.find((e) => e.kind === 'done');
  eq('done 的 exitCode 为 0', doneEvt && doneEvt.exitCode, 0);

  // 3b) Last-Event-ID 只补发后续
  const after = await sse(runId, 2);
  eq('Last-Event-ID=2 后补发的事件 seq 全 > 2', after.every((e) => e.seq > 2), true);
  eq('补发仍能到 done', after.some((e) => e.kind === 'done'), true);

  // 4) 取消：挂起的子进程
  process.env.FAKE_DSH_HANG = '1';
  const hangRun = await post('/em-agent/run', { instruction: 'hang' });
  eq('挂起 run 启动 → 200', hangRun.status, 200);
  await sleep(600);
  const cancelRes = await post('/em-agent/run/' + hangRun.body.runId + '/cancel', {});
  eq('取消 → 200', cancelRes.status, 200);
  let settled = null;
  for (let i = 0; i < 25; i++) {
    const snap = await fetch(`http://127.0.0.1:${PORT}/em-agent/run/${hangRun.body.runId}`, { headers: { 'x-em-token': TOKEN } }).then((r) => r.json());
    if (snap.status !== 'running') { settled = snap; break; }
    await sleep(200);
  }
  eq('取消后不再 running', settled !== null, true);
  delete process.env.FAKE_DSH_HANG;

  // 5) 未知 run → 404
  const missing = await fetch(`http://127.0.0.1:${PORT}/em-agent/run/run-nope`, { headers: { 'x-em-token': TOKEN } });
  eq('未知 run → 404', missing.status, 404);

  host.dispose();
  server.close();

  const out = {
    passed: fails.length === 0,
    total: checks.length,
    failed: fails.length,
    failures: fails,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.passed ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
