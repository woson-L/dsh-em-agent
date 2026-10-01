/* ============================================================================
 *  用 CDP 精确测量页面布局：两栏等高、拖拽手柄、图表刻度
 *  在子进程里运行 headless Chrome，通过 Runtime.evaluate 读取真实几何值，
 *  并用 Input.dispatchMouseEvent 模拟一次真实鼠标拖拽。
 * ========================================================================== */
const { spawn } = require('node:child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9333;
const UD = require('node:path').join(require('node:os').tmpdir(), 'dsh-antenna-measure');
const WIDTH = Number(process.argv[3] || 1600);
const HEIGHT = Number(process.argv[4] || 1080);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEASURE = `(() => {
  const r = (el) => el ? el.getBoundingClientRect() : null;
  const L = r(document.querySelector('.col-left'));
  const R = r(document.querySelector('.col-right'));
  const cards = [...document.querySelectorAll('.col-right > .card')].map((c) => ({
    title: (c.querySelector('h2') || {}).textContent || '(?)',
    h: Math.round(r(c).height * 100) / 100,
  }));
  const cs = getComputedStyle(document.querySelector('.col-right'));
  const gap = parseFloat(cs.rowGap || cs.gap || '0');
  const chat = r(document.getElementById('chatView'));
  const handle = r(document.getElementById('chatResize'));
  if (!document.querySelector('#chartBox svg')) { try { drawChart(); } catch (e) {} }
  const svgTexts = [...document.querySelectorAll('#chartBox svg text')].map((t) => t.textContent);
  const vLines = [...document.querySelectorAll('#chartBox svg line')]
      .filter((l) => l.getAttribute('x1') === l.getAttribute('x2')).length;
  return {
    leftH: L ? Math.round(L.height * 100) / 100 : null,
    rightH: R ? Math.round(R.height * 100) / 100 : null,
    leftBottom: L ? Math.round(L.bottom * 100) / 100 : null,
    rightBottom: R ? Math.round(R.bottom * 100) / 100 : null,
    cards, gap,
    cardsSum: Math.round((cards.reduce((a, c) => a + c.h, 0) + gap * (cards.length - 1)) * 100) / 100,
    leftContentBottom: (() => {
      const kids = [...document.querySelector('.col-left').children];
      return kids.length ? Math.round(kids[kids.length - 1].getBoundingClientRect().bottom * 100) / 100 : null;
    })(),
    leftLastCardMarginBottom: (() => {
      const kids = [...document.querySelector('.col-left').children];
      return kids.length ? parseFloat(getComputedStyle(kids[kids.length - 1]).marginBottom) : 0;
    })(),
    firstCardFreeSpace: (() => {
      const card = document.querySelector('.col-right > .card');
      const kids = [...card.children];
      const used = kids.reduce((a, k) => a + k.getBoundingClientRect().height, 0);
      const cs = getComputedStyle(card);
      return Math.round((card.getBoundingClientRect().height
        - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
        - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth) - used) * 100) / 100;
    })(),
    chatH: chat ? Math.round(chat.height * 100) / 100 : null,
    chatMinHeight: document.getElementById('chatView').style.minHeight || '(未设置)',
    handle: handle ? { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, w: handle.width, h: handle.height } : null,
    btnRecoverDisabled: document.getElementById('btnRecover').disabled,
    chartTexts: svgTexts,
    chartVerticalGridLines: vLines,
    hasSvg: !!document.querySelector('#chartBox svg'),
  };
})()`;

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`,
    `--window-size=${WIDTH},${HEIGHT}`, 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  const target = (targets || []).find((t) => t.type === 'page');
  if (!target) { console.log(JSON.stringify({ error: 'CDP 页面目标未就绪' })); chrome.kill(); return; }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });

  // 等页面就绪并渲染出两栏
  for (let i = 0; i < 60; i++) {
    try {
      const ok = await evalJs("document.readyState === 'complete' && !!document.querySelector('.col-right > .card')");
      if (ok) break;
    } catch (e) {}
    await sleep(250);
  }
  await sleep(700); // 等字体与布局稳定

  // 首次配置弹层会盖住整页，鼠标事件会打在遮罩上 —— 不关掉的话，
  // 后面的拖拽「什么也没发生」，而 equalAfterDrag 会因「两边都没变」
  // 空洞地通过。之前就是这样漏掉了「只能向下拖大」这个 bug。
  await evalJs("(() => { const s = document.getElementById('setupOverlay'); if (s) s.hidden = true; return true; })()");
  await sleep(200);

  const before = await evalJs(MEASURE);

  // ---- 模拟真实鼠标拖拽（双向） ----
  let drag = null;
  if (before.handle) {
    const mouse = (type, cx, cy, buttons) => send('Input.dispatchMouseEvent', {
      type, x: cx, y: cy, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
    });
    // 每次拖拽前把手柄滚回视野：拖到上限时它会掉到视口下方，
    // 此时鼠标事件落在屏幕外，测出来会是「无反应」的假象。
    const handlePos = async () => {
      await evalJs("document.getElementById('chatResize').scrollIntoView({block:'center'})");
      await sleep(120);
      return evalJs("(() => { const r = document.getElementById('chatResize').getBoundingClientRect(); const cx = r.x + r.width/2, cy = r.y + r.height/2; const t = document.elementFromPoint(cx, cy); return { x: cx, y: cy, inView: cy >= 0 && cy <= window.innerHeight, onHandle: !!(t && t.closest && t.closest('#chatResize')) }; })()");
    };
    const doDrag = async (total, step = 30) => {
      const h = await handlePos();
      if (!h.inView || !h.onHandle) return { ok: false, why: h };
      await mouse('mousePressed', h.x, h.y, 1);
      let cy = h.y, done = 0;
      while (Math.abs(done) < Math.abs(total)) {
        const d = Math.sign(total) * Math.min(step, Math.abs(total - done));
        cy += d; done += d;
        await mouse('mouseMoved', h.x, cy, 1); await sleep(20);
      }
      await mouse('mouseReleased', h.x, cy, 0);
      await sleep(350);
      return { ok: true };
    };

    const g1 = await doDrag(240);            // 向下 240
    const after = await evalJs(MEASURE);
    const g2 = await doDrag(-240);           // 向上 240，应回到初始
    const afterBack = await evalJs(MEASURE);
    const g3 = await doDrag(-120);           // 再向上 120：必须能低于初始高度
    const afterBelow = await evalJs(MEASURE);

    // 键盘微调与双击复位
    await evalJs("document.getElementById('chatResize').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
    await sleep(150);
    const afterKey = await evalJs(MEASURE);
    await evalJs("document.getElementById('chatResize').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
    await sleep(250);
    const afterReset = await evalJs(MEASURE);

    const round = (n) => Math.round(n * 100) / 100;
    drag = {
      dragReachedHandle: g1.ok,               // 若为 false，下面所有结论都不成立
      chatH_before: before.chatH, chatH_after: after.chatH,
      delta: round(after.chatH - before.chatH),
      grewOnDragDown: g1.ok && after.chatH - before.chatH > 200,
      left_after: after.leftH, right_after: after.rightH,
      equalAfterDrag: Math.abs(after.leftH - after.rightH) < 0.6,
      cardsSum_after: after.cardsSum,
      chatH_afterDragBack: afterBack.chatH,
      backToStart: Math.abs(afterBack.chatH - before.chatH) < 2,
      chatH_afterDragBelow: afterBelow.chatH,
      // 关键回归：修复前这里会等于初始高度（缩小被 min-height 卡住）
      shrinksBelowStart: afterBelow.chatH < before.chatH - 20,
      chatH_afterKey: afterKey.chatH,
      chatH_afterReset: afterReset.chatH,
      resetToAuto: Math.abs(afterReset.chatH - before.chatH) < 2,
      left_afterReset: afterReset.leftH, right_afterReset: afterReset.rightH,
    };
  }

  console.log(JSON.stringify({ url: URL, viewport: [WIDTH, HEIGHT], before, drag }, null, 2));

  ws.close();
  chrome.kill();
}
main().catch((e) => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(1); });
