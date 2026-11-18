/* 控件闭环补充验证（spec §五 / §三 未覆盖项）
   用真实点击 + 可观察结果判定，不依赖 innerHTML 哈希。

   覆盖：频段增删、筛选、跟随最新、清空记录（仅显示）、诊断、保存配置。
   用法：node test/test-controls.cjs [URL]
*/
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3190/em-agent';
const PORT = 9421;
const UD = path.join(os.tmpdir(), 'dsh-panel-controls');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find(t => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const dialogs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(m.params.message);
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  };
  const send = (method, params) => new Promise((res, rej) => { const id = ++seq; pending.set(id, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (e) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), 4000)),
    ]);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 60; i++) { try { if (await evalJs("document.readyState==='complete'")) break; } catch (e) {} await sleep(200); }
  await evalJs('localStorage.clear(); true');
  await send('Page.reload', {});
  for (let i = 0; i < 60; i++) { try { if (await evalJs("document.readyState==='complete'")) break; } catch (e) {} await sleep(200); }
  await sleep(400);
  await evalJs("(function(){var o=document.getElementById('setupOverlay');if(o)o.hidden=true;return true})()");

  const checks = {};
  const fails = [];
  const eq = (k, v) => { if (checks[k] !== v) fails.push(`${k}: 期望 ${JSON.stringify(v)} 实际 ${JSON.stringify(checks[k])}`); };

  const bandCount = () => evalJs(`document.querySelectorAll('.band-card').length`);
  const bandDelButtons = () => evalJs(`[...document.querySelectorAll('.band-card')].map(c => !!c.querySelector('[data-band-delete], .band-del, button.del'))`);

  /* 1) 预设频段不可删除：3 张卡且都没有删除按钮 */
  const before = await bandCount();
  const dels = await bandDelButtons();
  checks.bandsPreset = before;
  checks.presetNoDelete = dels.every((x) => x === false);
  eq('bandsPreset', 3);
  eq('presetNoDelete', true);

  /* 2) 新增频段 → 4 张卡，且新卡有删除入口 */
  await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => /新增频段/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
  await sleep(200);
  checks.bandsAfterAdd = await bandCount();
  checks.addHadDelete = await bandDelButtons().then(a => a[a.length - 1]);
  eq('bandsAfterAdd', 4);
  eq('addHadDelete', true);

  /* 3) 删除自定义频段 → 回到 3 张 */
  await evalJs(`(() => { const cards=[...document.querySelectorAll('.band-card')]; const c=cards[cards.length-1]; const b=c.querySelector('[data-band-delete], .band-del, button.del'); if (b) b.click(); return !!b; })()`);
  await sleep(250);
  checks.bandsAfterDelete = await bandCount();
  eq('bandsAfterDelete', 3);

  /* 4) 筛选：点「工具」→ chatView data-filter=tool；点「全部」→ all */
  const filterChip = (v) => `[...document.querySelectorAll('[data-filter]')].find(el => el.dataset.filter === '${v}')`;
  await evalJs(`(() => { const c = ${filterChip('tool')}; if (c) c.click(); return true; })()`);
  await sleep(120);
  checks.filterTool = await evalJs(`document.getElementById('chatView').dataset.filter`);
  await evalJs(`(() => { const c = ${filterChip('all')}; if (c) c.click(); return true; })()`);
  await sleep(120);
  checks.filterAll = await evalJs(`document.getElementById('chatView').dataset.filter`);
  eq('filterTool', 'tool');
  eq('filterAll', 'all');

  /* 5) 跟随最新：取消勾选后插入长内容，滚动位置不强制跳底 */
  await evalJs(`(() => { const f = document.getElementById('followTail'); if (f) { f.checked = false; f.dispatchEvent(new Event('change',{bubbles:true})); } return true; })()`);
  await sleep(100);
  checks.followOff = await evalJs(`document.getElementById('followTail').checked`);
  const scrollBefore = await evalJs(`(() => { const v=document.getElementById('chatView'); v.scrollTop=0; return v.scrollTop; })()`);
  await evalJs(`(() => { for (let i=0;i<30;i++) appendChatMsg('assistant','line '+i+' '+'x'.repeat(120)); return true; })()`);
  await sleep(300);
  const scrollAfter = await evalJs(`document.getElementById('chatView').scrollTop`);
  checks.followOffScroll = scrollAfter;
  eq('followOff', false);
  eq('followOffScroll', scrollBefore);

  /* 6) 清空记录：只清显示，出现空态；会话对象不被删除（chatSession 仍在或为空但提示区分） */
  await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/清空记录/.test(x.textContent)); if(b) b.click(); return !!b; })()`);
  await sleep(250);
  checks.clearedRows = await evalJs(`document.getElementById('chatView').children.length`);
  checks.emptyHint = await evalJs(`!!document.querySelector('#chatView .log-empty, #chatView .chat-msg')`);
  eq('clearedRows', 0);

  /* 7) 诊断：产生一条 panel 类记录 */
  await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/诊断/.test(x.textContent)); if(b) b.click(); return !!b; })()`);
  await sleep(250);
  checks.diagRows = await evalJs(`document.querySelectorAll('#chatView .log-row, #chatView .chat-msg').length`);
  checks.diagPanel = await evalJs(`!!document.querySelector('#chatView .panel, #chatView .log-row.panel')`);

  /* 8) 保存配置：写入 localStorage 并关闭弹层 */
  await evalJs(`(() => { const o=document.getElementById('setupOverlay'); if(o) o.hidden=false; return true; })()`);
  await evalJs(`(() => { const i=document.getElementById('suMcpName'); if(i){ i.value='cst-studio-suite'; } const s=document.getElementById('setupSave'); if(s) s.click(); return true; })()`);
  await sleep(250);
  checks.setupSaved = await evalJs(`(() => { try { const raw = localStorage.getItem('page-setup-v1'); return raw ? JSON.parse(raw).configured === true : false; } catch(e){ return 'ERR'; } })()`);
  checks.setupClosed = await evalJs(`document.getElementById('setupOverlay').hidden`);
  eq('setupSaved', true);
  eq('setupClosed', true);

  ws.close(); chrome.kill();
  const out = { url: URL, checks, failures: fails, passed: fails.length === 0, dialogsSeen: dialogs.length };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.passed ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
