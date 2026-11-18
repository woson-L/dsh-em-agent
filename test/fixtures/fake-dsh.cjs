/* 假 dsh：模拟 headless 的 JSONL 输出，用于 run-host 单测。
   FAKE_DSH_HANG=1 时输出一行后挂起，供取消/超时测试。 */
const hang = process.env.FAKE_DSH_HANG === '1';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

out({ type: 'session', sessionId: 'session-fake-1', cwd: process.cwd() });
out({ type: 'status', phase: 'turn_start', turn: 1 });
out({ type: 'thinking', text: '先看看 instruction。' });
out({ type: 'tool_call', callId: 'c1', tool: 'read', input: { file_path: 'instruction.md' } });
out({ type: 'tool_result', callId: 'c1', status: 'completed', result: 'OK' });
out({ type: 'text', text: 'OK' });
out({ type: 'final', text: 'OK' });

if (hang) {
  // 不退出：等待被 taskkill/kill 掉
  setInterval(() => {}, 1000);
} else {
  process.exit(0);
}
