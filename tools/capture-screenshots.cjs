/* ============================================================================
 *  给页面编辑器截图：注入两个演示区块并打开编辑表单，然后截屏
 * ========================================================================== */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const OUT = path.join(__dirname, '..', 'dist', 'shots');
const PORT = 9351;
const UD = path.join(require('node:os').tmpdir(), 'dsh-antenna-shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const DEMO_FULL = `<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
  <div style="flex:1 1 260px;">
    <div style="font-weight:700;font-size:15px;margin-bottom:4px;">自定义指标看板</div>
    <div style="color:var(--text-sub);font-size:12.5px;">这是一段由用户自行编写的 HTML，复用了页面设计令牌，因此自动跟随浅色 / 深色主题。</div>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;">
    <span class="pill ok"><span class="dot"></span>回波损耗 -18.4 dB</span>
    <span class="pill warn"><span class="dot"></span>效率 -2.1 dB</span>
    <span class="pill">VSWR 1.28</span>
  </div>
</div>
<table style="width:100%;margin-top:14px;font-size:12.5px;">
  <thead><tr><th>频段</th><th>目标</th><th>实测</th><th>结论</th></tr></thead>
  <tbody>
    <tr><td>2.40 – 2.48 GHz</td><td>-8 dB</td><td>-18.4 dB</td><td style="color:var(--ok);font-weight:700;">达标</td></tr>
    <tr><td>5.15 – 5.85 GHz</td><td>-8 dB</td><td>-9.2 dB</td><td style="color:var(--ok);font-weight:700;">达标</td></tr>
    <tr><td>6.425 – 7.125 GHz</td><td>-8 dB</td><td>-6.7 dB</td><td style="color:var(--err);font-weight:700;">未达标</td></tr>
  </tbody>
</table>`;

const DEMO_LEFT = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
  <strong style="font-size:13px;">快捷操作</strong>
  <button type="button" class="btn btn-xs" id="demoGo">重新预检</button>
  <span class="pill" id="demoTip">未执行</span>
</div>`;

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
  if (!target) { console.log('CDP 未就绪'); chrome.kill(); return; }

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
      try { if (await evalJs("document.readyState==='complete' && !!document.getElementById('editorCard')")) return; } catch (e) {}
      await sleep(250);
    }
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await waitReady();

  // ---- 先截「首次配置」浮层：清空本地存储后重载，它会自动弹出 ----
  await evalJs("(() => { try { localStorage.clear(); } catch (e) {} return true; })()");
  await send('Page.reload', {});
  await waitReady();
  await sleep(700);
  // 填入一套示例值，让自检与字段都处于「已填写」状态
  await evalJs(`(() => {
    const map = {
      suCstRoot: 'C:\\\\Program Files\\\\CST Studio Suite 2026',
      suCstExe: 'C:\\\\Program Files\\\\CST Studio Suite 2026\\\\AMD64\\\\CST DESIGN ENVIRONMENT_AMD64.exe',
      suMcpName: 'cst-studio-suite',
      suMcpCommand: 'C:\\\\Program Files\\\\Python311\\\\python.exe',
      suMcpArgs: 'C:\\\\CST-MCP\\\\mcp_server.py',
      suWorkspace: 'C:\\\\CST_Workspace\\\\cst_runs',
      suEvidence: 'C:\\\\CST_Workspace\\\\cst_runs\\\\evidence'
    };
    Object.keys(map).forEach(function (id) {
      const el = document.getElementById(id);
      if (el) { el.value = map[id]; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    return true;
  })()`);
  await sleep(400);
  const shotSetup = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'shot-setup.png'), Buffer.from(shotSetup.data, 'base64'));
  // 提交表单（而非仅关闭），这样 configured=true，重载后不会再自动弹出，
  // 后面的整页截图才不会被遮罩糊住顶栏
  await evalJs("document.getElementById('setupForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))");
  await sleep(400);

  // 注入演示区块：一个内置表格统计窗口（带数据回传），一个自定义脚本区块
  await evalJs(`(() => {
    localStorage.setItem('page-blocks-v1', JSON.stringify([
      { id:'blk-demo1', name:'增益效率统计', zone:'full', enabled:true, allowScripts:false,
        channel:'stats', demand:'每轮仿真后输出该轮增益（dBi）与效率（dB）', renderMode:'auto',
        keepHistory:true, config:'precision=2', html:'<div data-block-slot></div>' },
      { id:'blk-demo2', name:'快捷操作', zone:'left', enabled:true, allowScripts:true,
        channel:'', demand:'', renderMode:'auto', keepHistory:false, config:'',
        html:${JSON.stringify(DEMO_LEFT)} }
    ]));
    return true;
  })()`);

  await send('Page.reload', {});
  await waitReady();
  await sleep(800);

  // 投递两轮演示数据，展示数据回传渲染（形状与页面示例一致：轮次 / 增益 / 效率）
  await evalJs(`(() => {
    const b = pageBlocks.filter(function (x) { return x.id === 'blk-demo1'; })[0];
    if (!b) return false;
    deliverBlockData(b, normalizePayload({ channel:'stats', round:1, title:'第 1 轮',
      columns:['轮次','增益 (dB)','效率 (%)'], rows:[[1,'2.31','68.4']] }));
    deliverBlockData(b, normalizePayload({ channel:'stats', round:2, title:'第 2 轮',
      columns:['轮次','增益 (dB)','效率 (%)'], rows:[[2,'2.47','71.2']] }));
    return true;
  })()`);
  await sleep(400);

  // 打开编辑表单并填入内容（展示新增的数据回传配置项）
  await evalJs(`(() => {
    const edit = document.querySelector('#blockList [data-block-action="edit"]');
    if (edit) edit.click();
    return true;
  })()`);
  await sleep(600);

  // 截两张：编辑器区域（含区块与编辑表单）与整页
  // 先把编辑器卡片滚到合适位置，让标题/工具栏/列表/表单同时入镜
  const bottom = await evalJs("(() => { const c = document.getElementById('editorCard'); window.scrollTo(0, c.offsetTop - 90); return document.body.scrollHeight; })()");
  await sleep(450);
  const shotA = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'shot-editor-open.png'), Buffer.from(shotA.data, 'base64'));

  // 整页截图前先回到顶部，否则 sticky 顶栏会在滚动位置被重复渲染
  await evalJs("window.scrollTo(0, 0)");
  await sleep(350);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 1080, deviceScaleFactor: 1, mobile: false,
  });
  const metrics = await send('Page.getLayoutMetrics');
  const shotB = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1600, height: Math.min(metrics.cssContentSize.height, 8000), scale: 1 },
  });
  fs.writeFileSync(path.join(OUT, 'shot-editor-full.png'), Buffer.from(shotB.data, 'base64'));

  // 量化：自定义区块表格是否撑满卡片内容区（曾因 display:block 塌缩成 292px）
  const tableInfo = await evalJs(`(() => {
    const blk = document.querySelector('#customZoneFull .custom-block');
    const t = blk ? blk.querySelector('.custom-body table') : null;
    const body = blk ? blk.querySelector('.custom-body') : null;
    const p = document.querySelector('#blockPreview table');
    const pv = document.getElementById('blockPreview');
    const r = (el) => el ? Math.round(el.getBoundingClientRect().width * 10) / 10 : null;
    return { blockTableW: r(t), blockBodyW: r(body), previewTableW: r(p), previewBoxW: r(pv) };
  })()`);

  // ---- 浅色 / 深色整页对照图：先收起编辑器表单，顶栏才不会被浮层遮住 ----
  await evalJs("(() => { const b = document.getElementById('btnBlockCancel'); if (b) b.click(); window.scrollTo(0, 0); return true; })()");
  await sleep(400);
  for (const theme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await evalJs("window.scrollTo(0, 0)");
    await sleep(400);
    const m2 = await send('Page.getLayoutMetrics');
    const s2 = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1600, height: Math.min(m2.cssContentSize.height, 8000), scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, `shot-${theme}.png`), Buffer.from(s2.data, 'base64'));
  }
  await send('Emulation.setEmulatedMedia', { features: [] });

  console.log(JSON.stringify({
    pageHeight: bottom,
    contentSize: metrics.cssContentSize,
    tableInfo: tableInfo,
    wrote: ['shot-editor-open.png', 'shot-editor-full.png'],
  }, null, 2));

  ws.close(); chrome.kill();
}
main().catch((e) => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(1); });
