/* ============================================================================
 *  shell.cjs —— 外壳合成（单行顶栏），由 build.ps1 在内容构建之后调用。
 *
 *  背景：内容（显示偏好条、运行记录、扩展区…）由 build.ps1 的补丁生成到
 *  dist/antenna-optimizer-panel.html；而「单行顶栏 + 版本徽标 + 任务操作上移」
 *  属于版式重排，用补丁改基线锚点代价过高。所以这里做**确定性后处理**：
 *  只重排既有节点，不改任何脚本与文案。
 *
 *  关键约束：
 *    - 只做 DOM 剪切/重排，不新增业务逻辑；
 *    - 所有既有 id 必须原样保留（钩子门禁在 build.ps1 阶段已通过）；
 *    - 幂等：对同一输入重复运行结果一致；
 *    - 输入缺失或锚点找不到时**必须失败**，不能产出半成品。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'dist', 'antenna-optimizer-panel.html');
const OUT = path.join(ROOT, 'plugin', 'panel.html');
const CSS2 = fs.readFileSync(path.join(ROOT, 'src', 'app', 'v2.css'), 'utf8');

if (!fs.existsSync(SRC)) throw new Error('缺少内容产物，先跑 build.ps1: ' + SRC);

const html = fs.readFileSync(SRC, 'utf8');
const headEnd = html.indexOf('</head>');
const bodyStart = html.indexOf('<body>');
const bodyEnd = html.lastIndexOf('</body>');
if (headEnd < 0 || bodyStart < 0 || bodyEnd < 0) throw new Error('无法定位 head/body');

const head = html.slice(0, headEnd);
const body = html.slice(bodyStart + 6, bodyEnd);
const scriptStart = body.lastIndexOf('<script>');
if (scriptStart < 0) throw new Error('找不到内联脚本');
const script = body.slice(scriptStart);
const dom = body.slice(0, scriptStart);

const cut = (from, to) => {
  const a = dom.indexOf(from);
  const b = dom.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error('定位失败: ' + from + ' .. ' + to);
  return dom.slice(a, b);
};

const strip = (s) => s.replace(/<\/div>\s*$/, '');
const meta = strip(cut('<div class="meta">', '</header>').replace('<div class="meta">', ''));
const taskbar = cut('<section class="taskbar">', '</section>');
const row1 = strip(taskbar.slice(taskbar.indexOf('<div class="row1">'), taskbar.indexOf('<div class="row2">')).replace('<div class="row1">', ''));
const row2 = strip(taskbar.slice(taskbar.indexOf('<div class="row2">'), taskbar.indexOf('<div class="task-controls">')).replace('<div class="row2">', ''));
const controls = strip(taskbar.slice(taskbar.indexOf('<div class="task-controls">'), taskbar.indexOf('<div class="blocked-box"')).replace('<div class="task-controls">', ''));
const blocked = taskbar.slice(taskbar.indexOf('<div class="blocked-box"'));
const ubBar = cut('<div class="ub-bar" id="ubBar">', '<main');
const columnsOn = dom.indexOf('<div class="columns">');
if (columnsOn < 0) throw new Error('找不到列容器');

/* 只在页脚出现一次的交互入口：编辑器 / 扩展 / 说明 */
const v2Script = `
<script>
(function () {
  "use strict";
  var editor = document.getElementById("editorCard");
  var toggle = document.getElementById("v2ToggleEditor");
  if (toggle && editor) {
    toggle.addEventListener("click", function () {
      editor.hidden = !editor.hidden;
      toggle.textContent = editor.hidden ? "页面编辑器" : "收起编辑器";
    });
  }
  var help = document.getElementById("v2Help");
  if (help) help.addEventListener("click", function () {
    var b = document.getElementById("btnHelp");
    if (b) b.click();
  });
  var ext = document.getElementById("v2Ext");
  if (ext) ext.addEventListener("click", function () {
    var s = document.getElementById("ubExtension");
    if (s) s.scrollIntoView({ block: "start", behavior: "smooth" });
  });
})();
</script>`;

let shell = `<!DOCTYPE html>
<html lang="zh-CN">
<head>${head.slice(head.indexOf('<meta charset'))}
<style>${CSS2}</style>
</head>
<body>
<a class="skip-link" href="#mainContent">跳到主要内容</a>
<header class="v2-top">
  <div class="v2-brand"><span class="v2-mark" aria-hidden="true"></span><b>DSH EM Agent</b><span class="v2-ver">0.3.0</span></div>
  <div class="v2-meta">${meta}</div>
  <div class="v2-actions">${controls}</div>
</header>
<div class="v2-status">${row1}</div>
<div class="v2-kpis">${row2}</div>
${ubBar}
<main class="main" id="mainContent">
${blocked}
${dom.slice(columnsOn)}
<footer class="v2-foot">
  <button type="button" class="ub-link" id="v2ToggleEditor">页面编辑器</button>
  <span class="v2-foot-sep" aria-hidden="true">·</span>
  <button type="button" class="ub-link" id="v2Ext">扩展</button>
  <span class="v2-foot-sep" aria-hidden="true">·</span>
  <button type="button" class="ub-link" id="v2Help">说明</button>
</footer>
${script}
${v2Script}
</body>
</html>`;

/* 结构收敛：去掉卡片编号；诊断类卡片默认收起；折叠卡加摘要 */
shell = shell.replace(/[①②③④⑤⑥]\s*/g, '');
shell = shell.replace('<section class="card"><h2>工程预检</h2>', '<section class="card" hidden><h2>工程预检</h2>');
shell = shell.replace('<section class="card" id="logCard">', '<section class="card" id="logCard" hidden>');
shell = shell.replace('<section class="card" id="editorCard">', '<section class="card" id="editorCard" hidden>');
shell = shell.replace('<details class="card" id="secIter">', '<details class="card" id="secIter" open>');
shell = shell.replace(/(<details class="card" id="secSpecial">\s*<summary>)([\s\S]*?)(<\/summary>)/, '$1$2<span class="v2-note">隔离度、自定义指标</span>$3');
shell = shell.replace(/(<details class="card" id="secAdvance"[^>]*>\s*<summary>)([\s\S]*?)(<\/summary>)/, '$1$2<span class="v2-note">厚度 0.035 mm · 网格 0.1 mm</span>$3');
shell = shell.replace(/(<details class="card" id="secCommands"[^>]*>\s*<summary>)([\s\S]*?)(<\/summary>)/, '$1$2<span class="v2-note">附加要求文本</span>$3');

/* 区块标题：语义图标 + 标题 + 可折叠卡片末尾的独立箭头。
   图标是装饰（aria-hidden），不承担交互；箭头与图标是两个元素。 */
const SEC_ICONS = {
  '工程配置': '<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  '频段与指标': '<path d="M4 18V9"/><path d="M10 18V5"/><path d="M16 18v-6"/><path d="M22 18V11"/>',
  '特殊任务': '<path d="M12 3v18"/><path d="M5 8h14"/><path d="M5 16h14"/>',
  '迭代控制': '<path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/>',
  '高级设置 / 锁定项': '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="18" r="2"/>',
  '命令与目标': '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  '工程预检': '<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="9"/>',
  '操作日志': '<path d="M9 4h6v3H9z"/><path d="M7 5H5v15h14V5h-2"/>',
  '运行记录': '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/>',
  '运行监控': '<path d="M3 17l5-6 4 4 3-4 6 7"/><path d="M3 21h18"/>',
  '追加指令': '<path d="M4 12h13"/><path d="m13 6 6 6-6 6"/><path d="M4 6v12"/>',
  '结果证据': '<path d="M12 3l8 4v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7z"/>',
  '执行方式': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/>',
  '页面编辑器': '<path d="M4 20h16"/><path d="M6 16l9-9 4 4-9 9z"/>',
};

function decorateSectionTitles(html) {
  let out = html;
  for (const [title, paths] of Object.entries(SEC_ICONS)) {
    const icon = '<span class="sec-ico" aria-hidden="true"><svg viewBox="0 0 24 24">' + paths + '</svg></span>';
    const label = '<span class="sec-ttl">' + title + '</span>';
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const summaryRe = new RegExp('<summary>' + escaped + '(?=[\\s<])', 'g');
    const h2Re = new RegExp('<h2>' + escaped + '(?=[\\s<])', 'g');
    const before = out.length;
    out = out.replace(summaryRe, '<summary>' + icon + label);
    out = out.replace(h2Re, '<h2>' + icon + label);
    if (out.length === before) throw new Error('标题图标未命中: ' + title);
  }
  // 可折叠卡片：箭头追加到 summary 末尾（与语义图标分离，且位于右端）
  out = out.replace(/(<details class="card"[^>]*>\s*<summary>[\s\S]*?)<\/summary>/g,
    '$1<span class="sec-chev" aria-hidden="true"></span></summary>');
  const chevCount = (out.match(/class="sec-chev"/g) || []).length;
  if (chevCount !== 6) throw new Error('折叠箭头数量异常: ' + chevCount + '（应为 6）');
  return out;
}

shell = decorateSectionTitles(shell);

/* 自检：脚本必须仍是一整段，且关键 id 未丢失 */
const requiredIds = ['btnStart', 'btnPause', 'chatView', 'chatInput', 'ubLayout', 'ubDensity', 'ubRatio', 'btnBlockNew'];
for (const id of requiredIds) {
  if (!shell.includes('id="' + id + '"')) throw new Error('外壳合成后丢失关键元素: ' + id);
}
if (!shell.includes('UBExtensions')) throw new Error('外壳合成后丢失脚本内容');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, shell, 'utf8');
console.log('外壳合成完成: plugin/panel.html', shell.length, '字节');
