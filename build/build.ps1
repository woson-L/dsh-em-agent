# ============================================================================
#  build.ps1 —— 由基线 + 样式 + 补丁 构建 dist/antenna-optimizer-panel.html
#
#  用法（两选一，多数机器只有后者）：
#    powershell -NoProfile -ExecutionPolicy Bypass -File build\build.ps1
#    pwsh -File build/build.ps1
#  说明：  所有路径都相对仓库根目录（本文件的上一级），换机器无需修改。
#
#  本脚本内置多道硬门禁，任何一条不通过即中止构建：
#    1) 补丁精确命中：每处补丁必须在基线中恰好命中 1 次
#    2) 反向还原校验：产物里的补丁还原回去必须与基线脚本逐字节相同
#    3) 钩子校验（双向）：原有 id 一个不少、已退役 id 不得复活，新增量与补丁推导值一致
#    4) 结构断言：style / head / body / script 标签配对
#    5) 自定义属性完整性：用到的 CSS 变量都有定义
#    6) WCAG 对比度门禁
#    7) 内联脚本语法门禁：内联 <script> 过一遍 node --check
# ============================================================================
param([string]$RepoRoot = "")

$ErrorActionPreference = 'Stop'

# 仓库根目录：默认取本文件的上一级；以内存脚本方式运行时可用 -RepoRoot 指定
if (-not $RepoRoot) {
  if ($PSScriptRoot) { $RepoRoot = Split-Path $PSScriptRoot -Parent }
  else { throw "无法确定仓库根目录，请用 -RepoRoot 显式指定" }
}
if (-not (Test-Path $RepoRoot)) { throw "仓库根目录不存在: $RepoRoot" }
$Baseline = Join-Path $RepoRoot "src\baseline\antenna-optimizer-config-panel.original.html"
$StyleSrc = Join-Path $RepoRoot "src\styles.css"
$OutFile  = Join-Path $RepoRoot "dist\antenna-optimizer-panel.html"

$enc = New-Object System.Text.UTF8Encoding($false)
foreach ($f in @($Baseline, $StyleSrc)) {
  if (-not (Test-Path $f)) { throw "缺少输入文件: $f" }
}

$htmlRaw = [System.IO.File]::ReadAllText($Baseline, $enc)
$cssRaw  = [System.IO.File]::ReadAllText($StyleSrc, $enc)

$srcCRLF = ([regex]::Matches($htmlRaw, "`r`n")).Count
$srcLF   = ([regex]::Matches($htmlRaw, "(?<!`r)`n")).Count
$nl = if ($srcCRLF -ge $srcLF) { "`r`n" } else { "`n" }

# --- 1. 归一 CSS 换行 ---
$css = $cssRaw -replace "`r`n", "`n"
if ($nl -eq "`r`n") { $css = $css -replace "`n", "`r`n" }
if (-not $css.EndsWith($nl)) { $css += $nl }

# --- 2. 替换 <style> 块 ---
$openTag, $closeTag = "<style>", "</style>"
$i = $htmlRaw.IndexOf($openTag); if ($i -lt 0) { throw "基线中未找到 <style>" }
$j = $htmlRaw.IndexOf($closeTag, $i); if ($j -lt 0) { throw "基线中未找到 </style>" }
$before = $htmlRaw.Substring(0, $i + $openTag.Length)
# 注意：$after 必须从 </style> 起始处开始，否则会丢掉闭合标签（会导致整页空白）
$after  = $htmlRaw.Substring($j)
$new = $before + $nl + $css + $after
Write-Output "样式块: $($j - $i - $openTag.Length) → $($css.Length) 字节"

# --- 3. 修正基线中唯一的硬编码颜色（深色主题下会变成亮色块） ---
$oldInline = 'style="background:#f4f6fa;border-color:var(--border);color:var(--text-sub);"'
$newInline = 'style="background:var(--surface-3);border-color:var(--border);color:var(--text-sub);"'
if (([regex]::Matches($new, [regex]::Escape($oldInline))).Count -ne 1) { throw "硬编码颜色替换目标命中数不为 1" }
$new = $new.Replace($oldInline, $newInline)

# --- 4. 行为补丁（每处必须精确命中 1 次） ---
$script:patchLog = @()
$script:patches  = @()

# 显式退役的 id。基线不可变，门禁 6 要求原有 id 一个不少；当某个界面元素被
# 有意移除时，必须在这里登记，门禁随即做双向校验：既不能悄悄丢失未被登记的 id，
# 也不能让已登记的 id 悄悄复活。这样「删除」是声明式的，而不是削弱门禁。
#   spEfficiencySuppress / spEffTarget —— 「4.80 GHz 效率抑制」项按设计自 ③ 特殊任务移除
#   （该项属内部约束，不应出现在配置界面上）
#   stStub —— 「增加短截线」按设计自 ⑤ 异常处理策略移除，只保留缩放重试与强制细化网格
$script:retiredIds = @('spEfficiencySuppress', 'spEffTarget', 'stStub')

function Count-Pat([string]$t, [string]$p) { ([regex]::Matches($t, $p)).Count }
function Apply-Patch([string]$text, [string]$old, [string]$new, [string]$label) {
  $o = $old -replace "`r`n", "`n"
  $n = $new -replace "`r`n", "`n"
  $c = ([regex]::Matches($text, [regex]::Escape($o))).Count
  if ($c -ne 1) { throw "补丁 [$label] 命中 $c 次（应为 1 次）——基线可能已变动" }
  $script:patchLog += "  OK  $label"
  $script:patches  += [pscustomobject]@{ Old = $o; New = $n; Label = $label }
  return $text.Replace($o, $n)
}

# P1 ── 坐标轴刻度常量（网格线与标签的唯一数据源）
$new = Apply-Patch $new @'
/* S11 曲线：SVG 折线 + 频段区间带 + 阈值线 + 数据点 */
function drawChart() {
'@ @'
/* 坐标轴主刻度：网格线与轴标签共用同一组数组，避免标签落在网格线之间 */
const CHART_X_TICKS = [2, 3, 4, 5, 6, 7];        // GHz
const CHART_Y_TICKS = [0, -10, -20, -30, -40];   // dB

/* S11 曲线：SVG 折线 + 频段区间带 + 阈值线 + 数据点 */
function drawChart() {
'@ 'P1 刻度常量'

# P2 ── gridLines 改用刻度数组
$new = Apply-Patch $new @'
  for (let f = 2; f <= 7; f += 1) s += '<line x1="' + X(f) + '" y1="' + padT + '" x2="' + X(f) + '" y2="' + (padT + plotH) + '" stroke="#eef1f5" stroke-width="1"/>';
  for (let d = -10; d >= -30; d -= 10) s += '<line x1="' + padL + '" y1="' + Y(d) + '" x2="' + (padL + plotW) + '" y2="' + Y(d) + '" stroke="#eef1f5" stroke-width="1"/>';
'@ @'
  // 竖网格线：每个 X 刻度一条（与轴标签一一对应）
  CHART_X_TICKS.forEach((f) => { s += '<line x1="' + X(f) + '" y1="' + padT + '" x2="' + X(f) + '" y2="' + (padT + plotH) + '" stroke="#eef1f5" stroke-width="1"/>'; });
  // 横网格线：跳过首尾（与绘图区边框重合）
  CHART_Y_TICKS.slice(1, -1).forEach((d) => { s += '<line x1="' + padL + '" y1="' + Y(d) + '" x2="' + (padL + plotW) + '" y2="' + Y(d) + '" stroke="#eef1f5" stroke-width="1"/>'; });
'@ 'P2 网格线改用刻度'

# P3 ── 轴标签改由刻度数组生成
$new = Apply-Patch $new @'
    '<text x="' + padL + '" y="' + (H - 8) + '" font-size="11" fill="#5b6b7f">1.8</text>' +
    '<text x="' + X(2.4) + '" y="' + (H - 8) + '" font-size="11" fill="#5b6b7f" text-anchor="middle">2.4</text>' +
    '<text x="' + X(5.5) + '" y="' + (H - 8) + '" font-size="11" fill="#5b6b7f" text-anchor="middle">5.5</text>' +
    '<text x="' + X(6.8) + '" y="' + (H - 8) + '" font-size="11" fill="#5b6b7f" text-anchor="middle">6.8</text>' +
    '<text x="' + (W - 4) + '" y="' + (H - 8) + '" font-size="11" fill="#5b6b7f" text-anchor="end">GHz</text>' +
    '<text x="8" y="' + (padT + 6) + '" font-size="10" fill="#5b6b7f">0</text>' +
    '<text x="8" y="' + (Y(-20) + 3) + '" font-size="10" fill="#5b6b7f">-20</text>' +
    '<text x="8" y="' + (H - 30) + '" font-size="10" fill="#5b6b7f">-40</text>' +
'@ @'
    // 轴标签由刻度数组生成，与网格线一一对应
    CHART_X_TICKS.map((f) => '<text x="' + X(f) + '" y="' + (H - 8) + '" font-size="11" fill="#5b6b7f" text-anchor="middle">' + f + '</text>').join("") +
    '<text x="' + (W - 4) + '" y="' + (H - 8) + '" font-size="11" fill="#5b6b7f" text-anchor="end">GHz</text>' +
    CHART_Y_TICKS.map((d) => '<text x="' + (padL - 8) + '" y="' + (Y(d) + 3.5) + '" font-size="10" fill="#5b6b7f" text-anchor="end">' + d + '</text>').join("") +
'@ 'P3 轴标签改用刻度'

# P4 ── 修正「断线恢复」可用条件（原判定恰好在无需恢复时点亮按钮）
$new = Apply-Patch $new @'
  document.getElementById("btnRecover").disabled = !(chatSession === null);
'@ @'
  document.getElementById("btnRecover").disabled = (chatSession === null);
'@ 'P4 断线恢复可用条件'

# P5 ── 事件流卡新增高度拖拽手柄标记
$new = Apply-Patch $new @'
        <div class="chat-view" id="chatView"><div class="chat-msg assistant"><div class="chat-body">尚未启动。配置左栏 → 启动仿真，此处实时显示大模型输出与阶段。</div></div></div>
'@ @'
        <div class="chat-view" id="chatView"><div class="chat-msg assistant"><div class="chat-body">尚未启动。配置左栏 → 启动仿真，此处实时显示大模型输出与阶段。</div></div></div>
        <div class="chat-resize" id="chatResize" role="separator" aria-orientation="horizontal" aria-label="拖拽调整事件流高度，双击复位" tabindex="0" title="拖拽调整高度 · 双击复位"><span class="chat-resize-grip"></span></div>
'@ 'P5 拖拽手柄标记'

# P6 ── 事件流高度拖拽实现
$new = Apply-Patch $new @'
/* ============================================================
   init
   ============================================================ */
function init() {
'@ @'
/* ============================================================
   事件流高度：鼠标拖拽扩展（双击复位，方向键微调）
   ============================================================ */
const CHAT_H_KEY = "chatview-height";
const CHAT_H_MIN = 110;      // 与 .chat-view 的基础 min-height 一致，避免设了却被 CSS 顶回
const CHAT_H_MAX = 1400;     // 兜底值；实际上限取 CSS 的 max-height（62vh）

/* 上限必须取「当前 CSS 算出来的 max-height」，不能用常量。
   .chat-view 有 max-height:62vh，视口越矮它越小。若按常量累积，min-height
   会一路涨到上千而元素仍被钳在六百多，之后反向拖拽得先把这段看不见的余量
   「倒空」，表现为拖了很久毫无反应。 */
function chatHeightBounds() {
  const el = document.getElementById("chatView");
  if (!el) return { min: CHAT_H_MIN, max: CHAT_H_MAX };
  const m = parseFloat(getComputedStyle(el).maxHeight);
  return { min: CHAT_H_MIN, max: isFinite(m) && m > 0 ? Math.round(m) : CHAT_H_MAX };
}
function setChatViewHeight(px, persist) {
  const el = document.getElementById("chatView");
  const card = document.getElementById("eventflowCard");
  if (!el) return;
  const bb = chatHeightBounds();
  const h = Math.max(bb.min, Math.min(bb.max, Math.round(px)));
  /* 关键：写确定的 height 并取消 flex 拉伸。
     只写 min-height 时，高度是由 flex 布局算出来的（#eventflowCard 是
     flex-grow:1，吃掉左栏的剩余高度），而 min-height 只能把这个结果撑大、
     永远压不小 —— 这正是「只有向下拖才会变大」的原因。取消拉伸后，
     高度才真正双向可控。 */
  el.style.flex = "0 0 " + h + "px";
  el.style.height = h + "px";
  if (card) card.style.flex = "0 0 auto";
  if (persist) { try { localStorage.setItem(CHAT_H_KEY, String(h)); } catch (e) {} }
  return h;
}
function initChatResize() {
  const handle = document.getElementById("chatResize");
  const view = document.getElementById("chatView");
  if (!handle || !view) return;

  try {
    const saved = localStorage.getItem(CHAT_H_KEY);
    if (saved !== null && isFinite(Number(saved))) setChatViewHeight(Number(saved), false);
  } catch (e) {}

  let dragging = false, pointerId = null, startY = 0, startH = 0;
  const endDrag = (ev) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.classList.remove("col-resizing");
    if (ev) { try { handle.releasePointerCapture(ev.pointerId); } catch (e) {} }
    setChatViewHeight(view.getBoundingClientRect().height, true);
  };
  handle.addEventListener("pointerdown", (ev) => {
    dragging = true; pointerId = ev.pointerId;
    startY = ev.clientY; startH = view.getBoundingClientRect().height;
    handle.classList.add("dragging");
    document.body.classList.add("col-resizing");
    try { handle.setPointerCapture(ev.pointerId); } catch (e) {}
    ev.preventDefault();
  });
  handle.addEventListener("pointermove", (ev) => {
    if (!dragging || ev.pointerId !== pointerId) return;
    setChatViewHeight(startH + (ev.clientY - startY), false);
    ev.preventDefault();
  });
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
    const step = ev.shiftKey ? 48 : 16;
    setChatViewHeight(view.getBoundingClientRect().height + (ev.key === "ArrowDown" ? step : -step), true);
    ev.preventDefault();
  });
  handle.addEventListener("dblclick", () => {
    /* 复位 = 回到「自动填满剩余高度」的默认布局，所以三样都要清掉：
       height / flex 是拖拽写上的，min-height 是旧版本可能残留的。 */
    view.style.flex = "";
    view.style.height = "";
    view.style.minHeight = "";
    const card = document.getElementById("eventflowCard");
    if (card) card.style.flex = "";
    try { localStorage.removeItem(CHAT_H_KEY); } catch (e) {}
    toast("事件流高度已复位", "ok", 2000);
  });
}

/* ============================================================
   init
   ============================================================ */
function init() {
'@ 'P6 拖拽实现'

# P7 ── init 中调用拖拽初始化
$new = Apply-Patch $new @'
  renderBands();
  refreshDynamic();
  setRunState("idle");
  renderLogs();
'@ @'
  renderBands();
  refreshDynamic();
  setRunState("idle");
  renderLogs();
  initChatResize();          // 事件流高度拖拽手柄
  initBlockEditor();         // 页面编辑器：自定义区块
  initSetup();               // 首次配置：CST 路径与 MCP 地址
'@ 'P7 init 调用'

# P8 ── 事件流卡加 id（供 flex 增长规则稳定选中）
$new = Apply-Patch $new @'
      <section class="card">
        <h2>事件流 / 状态可视化</h2>
'@ @'
      <section class="card" id="eventflowCard">
        <h2>事件流 / 状态可视化</h2>
'@ 'P8 事件流卡 id'

# P9 ── 操作日志卡加 id + 左栏自定义区块落点
$new = Apply-Patch $new @'
      <section class="card">
        <h2>操作日志 <span class="tag">最近 5 次</span></h2>
        <div class="log-list" id="logList"></div>
      </section>
    </div>
'@ @'
      <section class="card" id="logCard">
        <h2>操作日志 <span class="tag">最近 5 次</span></h2>
        <div class="log-list" id="logList"></div>
      </section>
      <div class="custom-zone" id="customZoneLeft"></div>
    </div>
'@ 'P9 日志卡 id + 左栏落点'

# P10 ── 右栏落点 + 通栏落点 + 页面编辑器卡片
$new = Apply-Patch $new @'
      <section class="card">
        <h2>特殊约束说明</h2>
        <div class="evidence-line" style="line-height:1.8;">· 4.80 GHz 效率抑制、隔离度要求、自定义指标为<b>特殊任务</b>（橙色标识），仅按需启用；隔离度越大越好（S21 越负越优）。</div>
        <div class="evidence-line" style="line-height:1.8;">· 所有 CST 操作<b>默认通过 cst-studio-suite MCP</b> 驱动 CST Studio Suite 2026 执行。</div>
      </section>
    </div>
  </div>
</main>
'@ @'
      <section class="card">
        <h2>特殊约束说明</h2>
        <div class="evidence-line" style="line-height:1.8;">· 4.80 GHz 效率抑制、隔离度要求、自定义指标为<b>特殊任务</b>（橙色标识），仅按需启用；隔离度越大越好（S21 越负越优）。</div>
        <div class="evidence-line" style="line-height:1.8;">· 所有 CST 操作<b>默认通过 cst-studio-suite MCP</b> 驱动 CST Studio Suite 2026 执行。</div>
      </section>
      <div class="custom-zone" id="customZoneRight"></div>
    </div>
  </div>

  <div class="custom-zone" id="customZoneFull"></div>

  <!-- ============ 页面编辑器：自定义 HTML 区块 ============ -->
  <section class="card" id="editorCard">
    <h2>页面编辑器 <span class="tag">自定义区块</span> <span class="tag lock" id="blockCount">0 个区块</span></h2>
    <div class="desc">
      用 HTML 自由新增内容区块，按需扩展页面功能。区块保存在<b>本机浏览器（localStorage）</b>，不会写回页面源码文件；
      可用「导出 JSON」分享给他人导入。新增的 HTML 默认<b>不执行脚本</b>（浏览器本身就不会运行 innerHTML 里的脚本），
      需要交互时再为单个区块勾选「允许执行脚本」。
    </div>

    <div class="editor-toolbar">
      <button type="button" class="btn primary" id="btnBlockNew">新增区块</button>
      <button type="button" class="btn" id="btnBlockExport">导出 JSON</button>
      <button type="button" class="btn" id="btnBlockImport">导入 JSON</button>
      <button type="button" class="btn" id="btnBlockClear">清空全部</button>
      <input type="file" id="blockImportFile" accept=".json,application/json" hidden aria-hidden="true">
    </div>

    <div class="block-list" id="blockList"></div>

    <div class="block-editor" id="blockEditor" hidden>
      <div class="be-title" id="beTitle">新增区块</div>
      <div class="f-row">
        <label class="f-label" for="beName">区块标题</label>
        <div class="f-control"><input type="text" id="beName" style="flex:1 1 260px;" placeholder="如：我的自定义面板"></div>
      </div>
      <div class="f-row">
        <label class="f-label" for="beZone">放置区域</label>
        <div class="f-control">
          <select id="beZone" style="min-width:180px;">
            <option value="full">通栏（两栏下方）</option>
            <option value="left">左栏底部</option>
            <option value="right">右栏底部</option>
          </select>
          <label class="be-inline"><input type="checkbox" id="beEnabled" checked> 启用</label>
          <label class="be-inline"><input type="checkbox" id="beScripts"> 允许执行脚本</label>
        </div>
      </div>
      <div class="f-row">
        <label class="f-label" for="beChannel">数据回传</label>
        <div class="f-control">
          <input type="text" id="beChannel" style="width:150px;" placeholder="通道名，如 stats">
          <select id="beRender" style="min-width:170px;">
            <option value="auto">内置表格渲染</option>
            <option value="custom">仅派发事件（自己写脚本）</option>
          </select>
          <label class="be-inline"><input type="checkbox" id="beHistory"> 累积各轮</label>
          <span class="unit">通道名留空 = 不接收数据</span>
        </div>
        <div class="f-help">通道名会写进模型任务书；模型按「数据回传协议」回传后，数据自动落到本区块。</div>
      </div>
      <div class="f-row">
        <label class="f-label" for="beDemand">数据要求</label>
        <div class="f-control"><input type="text" id="beDemand" style="flex:1 1 320px;" placeholder="如：每轮仿真后输出该轮增益（dBi）与效率（dB）"></div>
        <div class="f-help">用自然语言写清你要什么数据，这段文字会随指令一起发给模型。</div>
      </div>
      <div class="f-row">
        <label class="f-label" for="beConfig">自定义配置</label>
        <div class="f-control"><textarea id="beConfig" style="width:100%;min-height:64px;" spellcheck="false" placeholder="每行一条 key=value，脚本里用 block.config 读取，如：&#10;precision=2&#10;unit=dBi"></textarea></div>
      </div>
      <div class="f-row">
        <label class="f-label" for="beHtml">HTML 源码</label>
        <div class="f-control"><textarea id="beHtml" class="code-editor" spellcheck="false" placeholder="在此编写或粘贴 HTML…"></textarea></div>
        <div class="f-help">「内置表格渲染」写入标记了 <code>data-block-slot</code> 的元素；没有该元素时追加到区块内容末尾。</div>
      </div>
      <div class="be-actions">
        <button type="button" class="btn primary" id="btnBlockSave">保存区块</button>
        <button type="button" class="btn" id="btnBlockCancel">取消</button>
      </div>

      <details class="be-api">
        <summary>可调用的页面接口 / 可复用的样式</summary>
        <div class="be-api-body">
          <div>勾选「允许执行脚本」后，脚本运行在页面全局作用域，可直接调用已有函数：</div>
          <ul>
            <li><code>toast(msg, type)</code> —— 顶部提示，type 取 <code>ok</code> / <code>warn</code> / <code>err</code></li>
            <li><code>addLog(text)</code> —— 写入左栏「操作日志」</li>
            <li><code>readConfig()</code> —— 读取当前表单配置对象</li>
            <li><code>readSetup()</code> —— 读取首次配置（CST 路径与 MCP 地址）</li>
            <li><code>startSimulation()</code> / <code>pauseSimulation()</code> / <code>resumeSimulation()</code> / <code>cancelSimulation()</code> —— 任务控制</li>
            <li><code>dshRpc(method, payload)</code> —— 直接调用 DSH 接口</li>
            <li>状态变量：<code>runState</code>、<code>runId</code>、<code>bandState</code>、<code>actionLogs</code>、<code>FIXED_CONFIG</code></li>
          </ul>
          <div>直接复用页面设计令牌，自动跟随浅色 / 深色主题：</div>
          <ul>
            <li>现成类名：<code>card</code>、<code>btn</code>、<code>pill</code>、<code>tag</code>、<code>mono</code>、<code>result-table</code></li>
            <li>颜色变量：<code>var(--primary)</code>、<code>var(--text)</code>、<code>var(--text-sub)</code>、<code>var(--text-mute)</code>、<code>var(--ok)</code>、<code>var(--warn)</code>、<code>var(--err)</code>、<code>var(--surface)</code>、<code>var(--surface-2)</code>、<code>var(--border)</code>、<code>var(--mono)</code></li>
          </ul>
          <div>⚠ 自定义区块的 HTML 会在本页上下文里渲染，请只粘贴你信任的来源；导入他人 JSON 前请先看一遍内容。</div>
        </div>
      </details>

      <div class="be-preview-label">实时预览（预览只渲染 HTML，不执行脚本）：</div>
      <div class="block-preview" id="blockPreview"></div>
    </div>
  </section>
</main>
'@ 'P10 右栏/通栏落点 + 编辑器'

# P11 ── 页面编辑器实现（区块 CRUD + 数据回传）
$new = Apply-Patch $new @'
/* ============================================================
   init
   ============================================================ */
function init() {
'@ @'
/* ============================================================
   页面编辑器：自定义 HTML 区块
   ------------------------------------------------------------
   区块仅存在于本机 localStorage，不改动页面源码文件。
   innerHTML 插入的 script 标签浏览器不会执行，所以默认即安全；
   只有区块显式勾选「允许执行脚本」时才把脚本重新挂载执行。
   ============================================================ */
const BLOCK_STORE_KEY = "page-blocks-v1";
const BLOCK_ZONE_IDS = { full: "customZoneFull", left: "customZoneLeft", right: "customZoneRight" };
const BLOCK_ZONE_LABELS = { full: "通栏", left: "左栏底部", right: "右栏底部" };
const DEFAULT_BLOCK_TEMPLATE = [
  '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">',
  '  <strong>我的自定义面板</strong>',
  '  <button type="button" class="btn" id="demoBtn">点我</button>',
  '  <span class="pill" id="demoOut">等待操作</span>',
  '</div>',
  '<scr' + 'ipt>',
  '  document.getElementById("demoBtn").addEventListener("click", function () {',
  '    document.getElementById("demoOut").textContent = "已点击 " + new Date().toLocaleTimeString();',
  '    toast("自定义区块脚本已生效", "ok");',
  '  });',
  '</scr' + 'ipt>',
].join("\n");

let pageBlocks = [];
let editingBlockId = null;
let blockPreviewTimer = null;

function makeBlockId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return "blk-" + crypto.randomUUID().slice(0, 8);
  return "blk-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function normalizeBlock(b) {
  const src = (b && typeof b === "object") ? b : {};
  return {
    id: (typeof src.id === "string" && src.id) ? src.id : makeBlockId(),
    name: typeof src.name === "string" ? src.name : "",
    zone: BLOCK_ZONE_IDS[src.zone] ? src.zone : "full",
    html: typeof src.html === "string" ? src.html : "",
    enabled: src.enabled !== false,
    allowScripts: src.allowScripts === true,
    channel: typeof src.channel === "string" ? src.channel.trim() : "",
    demand: typeof src.demand === "string" ? src.demand : "",
    renderMode: src.renderMode === "custom" ? "custom" : "auto",
    keepHistory: src.keepHistory === true,
    config: typeof src.config === "string" ? src.config : "",
  };
}
/* 自定义配置：每行 key=value → 对象，供区块脚本读取 */
function parseBlockConfig(text) {
  const out = {};
  String(text || "").split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s || s.charAt(0) === "#") return;
    const i = s.indexOf("=");
    if (i <= 0) return;
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  });
  return out;
}
function loadBlocks() {
  let raw = null;
  try { raw = localStorage.getItem(BLOCK_STORE_KEY); } catch (e) {}
  let arr = [];
  if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch (e) {} }
  pageBlocks = arr.map(normalizeBlock);
}
function saveBlocks() {
  try { localStorage.setItem(BLOCK_STORE_KEY, JSON.stringify(pageBlocks)); } catch (e) {}
}
/* innerHTML 插入的 script 标签不会被执行，必须重建元素才会运行 */
function mountBlockScripts(container) {
  const olds = container.querySelectorAll("script");
  for (let i = 0; i < olds.length; i++) {
    const old = olds[i];
    const fresh = document.createElement("script");
    for (let j = 0; j < old.attributes.length; j++) {
      fresh.setAttribute(old.attributes[j].name, old.attributes[j].value);
    }
    fresh.textContent = old.textContent;
    old.parentNode.replaceChild(fresh, old);
  }
}
function makeBlockBtn(label, id, action) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-xs";
  btn.textContent = label;
  btn.setAttribute("data-block-id", id);
  btn.setAttribute("data-block-action", action);
  return btn;
}
function dumpBlockBtn(label, id, action, disabled) {
  const b = makeBlockBtn(label, id, action);
  b.disabled = !!disabled;
  return b;
}
function renderBlocks() {
  Object.keys(BLOCK_ZONE_IDS).forEach((z) => {
    const el = document.getElementById(BLOCK_ZONE_IDS[z]);
    if (el) el.innerHTML = "";
  });
  pageBlocks.forEach((b) => {
    if (!b.enabled) return;
    const zone = document.getElementById(BLOCK_ZONE_IDS[b.zone]);
    if (!zone) return;
    const card = document.createElement("section");
    card.className = "card custom-block";
    card.setAttribute("data-block-id", b.id);

    const head = document.createElement("h2");
    head.appendChild(document.createTextNode(b.name || "自定义区块"));
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = b.allowScripts ? "自定义 · 脚本" : "自定义";
    head.appendChild(tag);
    if (b.channel) {
      const ctag = document.createElement("span");
      ctag.className = "tag chan";
      ctag.textContent = "通道 " + b.channel;
      head.appendChild(ctag);
    }
    const acts = document.createElement("span");
    acts.className = "block-actions";
    acts.appendChild(makeBlockBtn("编辑", b.id, "edit"));
    acts.appendChild(makeBlockBtn("删除", b.id, "delete"));
    head.appendChild(acts);
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "custom-body";
    body.innerHTML = b.html;              // 默认只渲染，不执行脚本
    card.appendChild(body);
    zone.appendChild(card);

    if (b.allowScripts) mountBlockScripts(body);
  });
  rehydrateBlockData();
  updateBlockCount();
}
/* renderBlocks() 会重建整个区块 DOM，已收到的数据会随之消失。
   这里用内存中的历史回填，避免「编辑任意一个区块，其它区块的数据就被清空」。 */
function rehydrateBlockData() {
  pageBlocks.forEach((b) => {
    const hist = blockDataHistory[b.id];
    if (!hist || !hist.length || b.renderMode !== "auto") return;
    const card = document.querySelector('.custom-block[data-block-id="' + b.id + '"]');
    if (!card) return;
    const host = card.querySelector(".custom-body");
    if (host) renderAutoBlockData(host, b, hist[hist.length - 1], hist);
  });
}
function updateBlockCount() {
  const el = document.getElementById("blockCount");
  if (el) el.textContent = pageBlocks.length + " 个区块";
}
function renderBlockList() {
  const list = document.getElementById("blockList");
  if (!list) return;
  list.innerHTML = "";
  if (!pageBlocks.length) {
    const empty = document.createElement("div");
    empty.className = "block-empty";
    empty.textContent = "还没有自定义区块。点「新增区块」开始，或用「导入 JSON」载入他人分享的区块。";
    list.appendChild(empty);
    return;
  }
  pageBlocks.forEach((b, i) => {
    const row = document.createElement("div");
    row.className = "block-row" + (b.enabled ? "" : " off") + (b.id === editingBlockId ? " editing" : "");

    const name = document.createElement("span");
    name.className = "br-name";
    name.textContent = b.name || "（未命名区块）";
    row.appendChild(name);

    const zone = document.createElement("span");
    zone.className = "br-zone";
    zone.textContent = BLOCK_ZONE_LABELS[b.zone];
    row.appendChild(zone);

    const chan = document.createElement("span");
    chan.className = "br-chan" + (b.channel ? "" : " off");
    chan.textContent = b.channel ? "通道 " + b.channel : "无数据";
    row.appendChild(chan);

    const flags = document.createElement("span");
    flags.className = "br-flags";
    const fl = [];
    if (!b.enabled) fl.push("已停用");
    if (b.allowScripts) fl.push("执行脚本");
    if (b.keepHistory) fl.push("累积");
    if (b.renderMode === "custom") fl.push("自绘");
    flags.textContent = fl.join(" · ");
    row.appendChild(flags);

    const acts = document.createElement("span");
    acts.className = "br-actions";
    acts.appendChild(dumpBlockBtn("上移", b.id, "up", i === 0));
    acts.appendChild(dumpBlockBtn("下移", b.id, "down", i === pageBlocks.length - 1));
    if (b.channel) acts.appendChild(makeBlockBtn("测试", b.id, "test"));
    acts.appendChild(makeBlockBtn("编辑", b.id, "edit"));
    acts.appendChild(makeBlockBtn("复制", b.id, "dup"));
    acts.appendChild(makeBlockBtn("删除", b.id, "delete"));
    row.appendChild(acts);

    list.appendChild(row);
  });
}
function openBlockEditor(id) {
  const b = id ? pageBlocks.filter((x) => x.id === id)[0] : null;
  editingBlockId = b ? b.id : null;
  document.getElementById("beTitle").textContent = b ? "编辑区块" : "新增区块";
  document.getElementById("beName").value = b ? b.name : "";
  document.getElementById("beZone").value = b ? b.zone : "full";
  document.getElementById("beEnabled").checked = b ? b.enabled : true;
  document.getElementById("beScripts").checked = b ? b.allowScripts : false;
  document.getElementById("beHtml").value = b ? b.html : DEFAULT_BLOCK_TEMPLATE;
  document.getElementById("beChannel").value = b ? b.channel : "";
  document.getElementById("beDemand").value = b ? b.demand : "";
  document.getElementById("beRender").value = b ? b.renderMode : "auto";
  document.getElementById("beHistory").checked = b ? b.keepHistory : false;
  document.getElementById("beConfig").value = b ? b.config : "";
  document.getElementById("blockEditor").hidden = false;
  updateBlockPreview();
  renderBlockList();                     // 高亮正在编辑的那一行
  const nameEl = document.getElementById("beName");
  if (nameEl && nameEl.focus) nameEl.focus();
}
function closeBlockEditor() {
  editingBlockId = null;
  const box = document.getElementById("blockEditor");
  if (box) box.hidden = true;
  // 预览区是区块 HTML 的第二份拷贝，里面的 id 会与真实区块重复；
  // 关闭编辑器时必须清空，否则 getElementById 可能命中预览里的那份。
  const pv = document.getElementById("blockPreview");
  if (pv) pv.innerHTML = "";
  renderBlockList();
}
function updateBlockPreview() {
  const box = document.getElementById("blockPreview");
  const src = document.getElementById("beHtml");
  if (!box || !src) return;
  box.innerHTML = src.value;   // 预览不执行脚本
  // 内置渲染模式的区块靠 data-block-slot 承载运行时数据，
  // 不填一次测试数据的话预览永远是空的，用户无法预判效果。
  const mode = document.getElementById("beRender");
  if (mode && mode.value === "auto") {
    const slot = box.querySelector("[data-block-slot]");
    if (slot) {
      slot.innerHTML = "";
      const spec = {
        channel: document.getElementById("beChannel").value,
        config: document.getElementById("beConfig").value,
      };
      // 勾了「累积各轮」就演示两轮，否则用户看不出累积的实际效果
      const multi = document.getElementById("beHistory").checked;
      slot.appendChild(buildDataTable(samplePayloadFor(spec, 1)));
      if (multi) slot.appendChild(buildDataTable(samplePayloadFor(spec, 2)));
    }
  }
}
function saveBlockFromEditor() {
  const name = document.getElementById("beName").value.trim();
  const zone = document.getElementById("beZone").value;
  const html = document.getElementById("beHtml").value;
  const enabled = document.getElementById("beEnabled").checked;
  const allowScripts = document.getElementById("beScripts").checked;
  const channel = document.getElementById("beChannel").value.trim();
  const demand = document.getElementById("beDemand").value.trim();
  const renderMode = document.getElementById("beRender").value;
  const keepHistory = document.getElementById("beHistory").checked;
  const config = document.getElementById("beConfig").value;
  if (!html.trim()) { toast("HTML 内容为空，未保存", "warn"); return; }
  if (channel && !/^[A-Za-z0-9_.\-*]+$/.test(channel)) {
    toast("通道名只能用字母、数字、下划线、点、短横线或 *", "warn", 4200); return;
  }
  const fields = {
    name: name, zone: zone, html: html, enabled: enabled, allowScripts: allowScripts,
    channel: channel, demand: demand, renderMode: renderMode, keepHistory: keepHistory, config: config,
  };
  if (editingBlockId) {
    const b = pageBlocks.filter((x) => x.id === editingBlockId)[0];
    if (b) Object.keys(fields).forEach((k) => { b[k] = fields[k]; });
  } else {
    pageBlocks.push(normalizeBlock(Object.assign({ id: makeBlockId() }, fields)));
  }
  saveBlocks(); renderBlocks(); renderBlockList(); closeBlockEditor();
  toast("区块已保存", "ok");
}
function exportBlocks() {
  if (!pageBlocks.length) { toast("还没有区块可导出", "warn"); return; }
  const data = JSON.stringify({ type: "dsh-antenna-panel-blocks", version: 1, blocks: pageBlocks }, null, 2);
  try {
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "antenna-panel-blocks-" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("已导出 " + pageBlocks.length + " 个区块", "ok");
  } catch (e) {
    copyToClipboard(data).then(function (ok) { toast(ok ? "下载不可用，已复制 JSON 到剪贴板" : "导出失败：" + e.message, ok ? "ok" : "err", 5200); });
  }
}
function importBlocksFromFile(file) {
  const reader = new FileReader();
  reader.onload = function () {
    let incoming = [];
    try {
      const p = JSON.parse(String(reader.result));
      incoming = Array.isArray(p) ? p : (p && Array.isArray(p.blocks) ? p.blocks : []);
    } catch (e) { toast("JSON 解析失败：" + e.message, "err", 4200); return; }
    if (!incoming.length) { toast("文件里没有可用区块", "warn"); return; }
    let added = 0, updated = 0;
    incoming.map(normalizeBlock).forEach((nb) => {
      const idx = pageBlocks.map((x) => x.id).indexOf(nb.id);
      if (idx >= 0) { pageBlocks[idx] = nb; updated++; } else { pageBlocks.push(nb); added++; }
    });
    saveBlocks(); renderBlocks(); renderBlockList();
    toast("导入完成：新增 " + added + " 个，更新 " + updated + " 个", "ok", 4600);
  };
  reader.onerror = function () { toast("读取文件失败", "err"); };
  reader.readAsText(file);
}
function moveBlock(id, delta) {
  const idx = pageBlocks.map((x) => x.id).indexOf(id);
  if (idx < 0) return;
  const to = idx + delta;
  if (to < 0 || to >= pageBlocks.length) return;
  const tmp = pageBlocks[to];
  pageBlocks[to] = pageBlocks[idx];
  pageBlocks[idx] = tmp;
  saveBlocks(); renderBlocks(); renderBlockList();
}
function onBlockActionClick(ev) {
  const t = ev.target;
  if (!t || typeof t.closest !== "function") return;
  const btn = t.closest("[data-block-action]");
  if (!btn) return;
  const id = btn.getAttribute("data-block-id");
  const action = btn.getAttribute("data-block-action");
  const idx = pageBlocks.map((x) => x.id).indexOf(id);
  if (idx < 0) return;
  ev.preventDefault();
  if (action === "edit") { openBlockEditor(id); return; }
  if (action === "up") { moveBlock(id, -1); return; }
  if (action === "down") { moveBlock(id, 1); return; }
  if (action === "test") {
    const tb = pageBlocks[idx];
    if (!tb.channel) { toast("该区块没有配置数据通道", "warn"); return; }
    if (!tb.enabled) { toast("区块已停用，请先启用再测试", "warn"); return; }
    const okDeliver = deliverBlockData(tb, samplePayloadFor(tb));
    toast(okDeliver ? "已向「" + (tb.name || "未命名") + "」发送测试数据" : "该区块未渲染到页面，无法接收数据",
          okDeliver ? "ok" : "warn", 3600);
    return;
  }
  if (action === "dup") {
    const copy = normalizeBlock(Object.assign({}, pageBlocks[idx], { id: makeBlockId(), name: (pageBlocks[idx].name || "未命名") + " 副本" }));
    pageBlocks.splice(idx + 1, 0, copy);
    saveBlocks(); renderBlocks(); renderBlockList();
    toast("已复制区块", "ok");
    return;
  }
  if (action === "delete") {
    if (!confirm("确认删除区块「" + (pageBlocks[idx].name || "未命名") + "」？")) return;
    pageBlocks.splice(idx, 1);
    saveBlocks(); renderBlocks(); renderBlockList();
    if (editingBlockId === id) closeBlockEditor();
    toast("区块已删除", "err");
  }
}
/* ------------------------------------------------------------
   数据回传：把模型输出里的结构化数据路由到对应区块并渲染
   ------------------------------------------------------------
   协议（写在指令里，模型每轮输出一个 fenced 代码块）：
     ```dsh-block-data
     {"channel":"stats","round":3,"title":"第 3 轮","columns":[...],"rows":[[...]]}
     ```
   支持三种数据形状，都会归一化成 columns + rows：
     rows: [...]           二维数组
     values: {k:v}         键值对
     metrics: [{name,value,unit,status}]
   ------------------------------------------------------------ */
const BLOCK_DATA_RE = /```dsh-block-data\s*([\s\S]*?)```/g;
const blockDataHistory = {};    // { blockId: [payload, ...] } —— 仅内存，刷新后清空
const routedSignatures = {};    // 去重：同一条 JSON 只路由一次

function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") { try { return JSON.stringify(v); } catch (e) { return String(v); } }
  return String(v);
}
function cellClass(text) {
  const t = String(text).trim().toLowerCase();
  if (/^(pass|ok|达标|通过|合格|yes|true)$/.test(t)) return "cell-ok";
  if (/^(fail|未达标|不通过|不合格|no|false)$/.test(t)) return "cell-fail";
  if (/^(warn|警告|注意|pending)$/.test(t)) return "cell-warn";
  return "";
}
function normalizePayload(p) {
  const src = (p && typeof p === "object") ? p : {};
  const out = {
    channel: String(src.channel || "default"),
    round: (typeof src.round === "number" || typeof src.round === "string") ? src.round : null,
    title: typeof src.title === "string" ? src.title : "",
    note: typeof src.note === "string" ? src.note : "",
    columns: Array.isArray(src.columns) ? src.columns.map(cellText) : null,
    rows: [],
  };
  if (Array.isArray(src.rows)) {
    out.rows = src.rows.map((r) => Array.isArray(r) ? r.map(cellText) : [cellText(r)]);
  } else if (Array.isArray(src.metrics)) {
    out.columns = out.columns || ["指标", "数值", "单位", "判定"];
    out.rows = src.metrics.map((m) => {
      const o = (m && typeof m === "object") ? m : { name: m };
      return [cellText(o.name), cellText(o.value), cellText(o.unit), cellText(o.status)];
    });
  } else if (src.values && typeof src.values === "object") {
    out.columns = out.columns || ["指标", "数值"];
    out.rows = Object.keys(src.values).map((k) => [k, cellText(src.values[k])]);
  }
  if (!out.columns && out.rows.length) out.columns = out.rows[0].map((_, i) => "列 " + (i + 1));
  return out;
}
function parseBlockDataText(text) {
  const found = [];
  if (!text) return found;
  BLOCK_DATA_RE.lastIndex = 0;
  let m;
  while ((m = BLOCK_DATA_RE.exec(text)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") found.push({ raw: raw, payload: normalizePayload(parsed) });
    } catch (e) { /* 格式不合法就跳过，不影响对话显示 */ }
  }
  return found;
}
function buildDataTable(payload) {
  const wrap = document.createElement("div");
  wrap.className = "block-data";
  if (payload.title || payload.round !== null) {
    const t = document.createElement("div");
    t.className = "block-data-title";
    const title = payload.title || "";
    const dup = title && payload.round !== null && title.indexOf(String(payload.round)) >= 0;
    t.textContent = title
      ? title + ((payload.round !== null && !dup) ? "（第 " + payload.round + " 轮）" : "")
      : "第 " + payload.round + " 轮";
    wrap.appendChild(t);
  }
  const table = document.createElement("table");
  if (payload.columns && payload.columns.length) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    payload.columns.forEach((c) => { const th = document.createElement("th"); th.textContent = c; tr.appendChild(th); });
    thead.appendChild(tr); table.appendChild(thead);
  }
  const tbody = document.createElement("tbody");
  payload.rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = c;
      const cls = cellClass(c);
      if (cls) td.className = cls;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  if (payload.note) {
    const n = document.createElement("div");
    n.className = "block-data-note";
    n.textContent = payload.note;
    wrap.appendChild(n);
  }
  return wrap;
}
function renderAutoBlockData(host, block, payload, history) {
  let slot = host.querySelector("[data-block-slot]");
  if (!slot) {
    slot = document.createElement("div");
    slot.setAttribute("data-block-slot", "");
    host.appendChild(slot);
  }
  slot.innerHTML = "";
  const list = block.keepHistory ? history : [payload];
  list.forEach((p) => slot.appendChild(buildDataTable(p)));
  if (!list.length) slot.textContent = "";
}
function dispatchBlockData(block, host, payload, history) {
  try {
    host.dispatchEvent(new CustomEvent("block-data", {
      detail: {
        payload: payload,
        history: history,
        round: payload.round,
        block: {
          id: block.id, name: block.name, channel: block.channel,
          config: parseBlockConfig(block.config),
        },
      },
    }));
  } catch (e) { /* 自定义脚本出错不应影响页面 */ }
}
function deliverBlockData(block, payload) {
  const card = document.querySelector('.custom-block[data-block-id="' + block.id + '"]');
  if (!card) return false;
  const host = card.querySelector(".custom-body");
  if (!host) return false;
  if (!blockDataHistory[block.id]) blockDataHistory[block.id] = [];
  const hist = blockDataHistory[block.id];
  hist.push(payload);
  if (hist.length > 200) hist.shift();
  if (block.renderMode === "auto") renderAutoBlockData(host, block, payload, hist);
  if (block.allowScripts) dispatchBlockData(block, host, payload, hist);
  return true;
}
function routeBlockDataFromText(text) {
  const found = parseBlockDataText(text);
  if (!found.length) return 0;
  let delivered = 0;
  found.forEach((item) => {
    const sig = item.payload.channel + "\u0000" + item.raw;
    if (routedSignatures[sig]) return;      // 流式输出会重复解析同一段，去重
    routedSignatures[sig] = true;
    const ch = item.payload.channel;
    pageBlocks.forEach((b) => {
      if (!b.enabled || !b.channel) return;
      if (b.channel !== ch && b.channel !== "*") return;
      if (deliverBlockData(b, item.payload)) delivered++;
    });
    if (delivered) addLog("区块数据回传：通道 " + ch + " → " + delivered + " 个区块");
  });
  return delivered;
}
function buildBlockDataProtocol() {
  const chans = {};
  pageBlocks.forEach((b) => {
    if (b.enabled && b.channel) (chans[b.channel] = chans[b.channel] || []).push(b);
  });
  const keys = Object.keys(chans);
  if (!keys.length) return "";
  let s = "\n# 16. 数据回传协议（页面自定义区块）\n";
  s += "页面已配置以下数据通道。请在**每轮迭代结束时**按下面的格式回传结构化数据，页面会自动渲染到对应区块；缺一轮会导致该区块该轮为空。\n\n";
  s += "```dsh-block-data\n";
  s += '{"channel":"<通道名>","round":<轮次数字>,"title":"<可选标题>","columns":["列1","列2"],"rows":[["值1","值2"]]}\n';
  s += "```\n\n";
  s += "要求：JSON 必须单行合法、用 ```dsh-block-data 围栏包裹；数值不要带单位（单位单独放一列）；判定列写 PASS / FAIL。\n";
  s += "已配置的通道：\n";
  keys.forEach((k) => {
    chans[k].forEach((b) => {
      s += "- `" + k + "`" + (b.name ? "（区块：" + b.name + "）" : "");
      if (b.demand) s += "，数据要求：" + b.demand;
      s += "\n";
    });
  });
  return s;
}
function samplePayloadFor(block, round) {
  const ch = block.channel || "default";
  const cfg = parseBlockConfig(block.config);
  const r = (round === 2) ? 2 : 1;
  const rows = (r === 1)
    ? [["增益", "2.41", "dBi", "PASS"], ["效率", "-1.82", "dB", "PASS"], ["最差 S11", "-6.7", "dB", "FAIL"]]
    : [["增益", "2.58", "dBi", "PASS"], ["效率", "-1.61", "dB", "PASS"], ["最差 S11", "-9.4", "dB", "PASS"]];
  return normalizePayload({
    channel: ch,
    round: r,
    title: cfg.title || "测试数据",
    columns: ["指标", "数值", "单位", "判定"],
    rows: rows,
    note: (r === 1)
      ? "这是「测试数据」，不代表真实仿真结果（示例阈值 -8 dB：-6.7 未达标、-9.4 达标）。"
      : "",
  });
}

function initBlockEditor() {
  loadBlocks();
  renderBlocks();
  renderBlockList();
  const btnNew = document.getElementById("btnBlockNew");
  const btnCancel = document.getElementById("btnBlockCancel");
  const btnSave = document.getElementById("btnBlockSave");
  const btnExport = document.getElementById("btnBlockExport");
  const btnImport = document.getElementById("btnBlockImport");
  const btnClear = document.getElementById("btnBlockClear");
  const fileInput = document.getElementById("blockImportFile");
  const htmlInput = document.getElementById("beHtml");
  if (!btnNew || !htmlInput) return;

  btnNew.addEventListener("click", function () { openBlockEditor(null); });
  btnCancel.addEventListener("click", closeBlockEditor);
  btnSave.addEventListener("click", saveBlockFromEditor);
  btnExport.addEventListener("click", exportBlocks);
  btnImport.addEventListener("click", function () { fileInput.click(); });
  btnClear.addEventListener("click", function () {
    if (!pageBlocks.length) { toast("还没有区块", "warn"); return; }
    if (!confirm("确认清空全部 " + pageBlocks.length + " 个自定义区块？此操作不可撤销。")) return;
    pageBlocks = [];
    saveBlocks(); renderBlocks(); renderBlockList(); closeBlockEditor();
    toast("已清空全部自定义区块", "err");
  });
  fileInput.addEventListener("change", function (e) {
    const f = e.target.files && e.target.files[0];
    if (f) importBlocksFromFile(f);
    e.target.value = "";
  });
  htmlInput.addEventListener("input", function () {
    clearTimeout(blockPreviewTimer);
    blockPreviewTimer = setTimeout(updateBlockPreview, 260);
  });
  const renderSel = document.getElementById("beRender");
  if (renderSel) renderSel.addEventListener("change", updateBlockPreview);
  const histChk = document.getElementById("beHistory");
  if (histChk) histChk.addEventListener("change", updateBlockPreview);
  const chanInput = document.getElementById("beChannel");
  if (chanInput) chanInput.addEventListener("input", updateBlockPreview);
  document.addEventListener("click", onBlockActionClick);
}

/* ============================================================
   首次配置：CST 安装路径 + MCP 地址
   ------------------------------------------------------------
   这些值会写入任务指令，模型据此调用 MCP 与 CST。
   只存本机浏览器（localStorage），不会写回源码文件。
   ============================================================ */
const SETUP_KEY = "page-setup-v1";
const MCP_TOOLS_RE = /mcp__([A-Za-z0-9_\-]+)__/;
let pageSetup = null;

function defaultSetup() {
  return {
    cstRoot: "", cstExe: "",
    mcpName: "cst-studio-suite", mcpTransport: "stdio",
    mcpCommand: "", mcpArgs: "",
    workspace: "",
    configured: false,
  };
}
function normalizeSetup(s) {
  const d = defaultSetup();
  const src = (s && typeof s === "object") ? s : {};
  Object.keys(d).forEach((k) => {
    if (k === "configured") { d[k] = src[k] === true; return; }
    if (typeof src[k] === "string") d[k] = src[k];
  });
  if (d.mcpTransport !== "http") d.mcpTransport = "stdio";
  return d;
}
function loadSetup() {
  let raw = null;
  try { raw = localStorage.getItem(SETUP_KEY); } catch (e) {}
  let parsed = null;
  if (raw) { try { parsed = JSON.parse(raw); } catch (e) {} }
  pageSetup = normalizeSetup(parsed);
  return pageSetup;
}
function saveSetup(s) {
  pageSetup = normalizeSetup(s);
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(pageSetup)); } catch (e) {}
  return pageSetup;
}
function readSetup() { return pageSetup || defaultSetup(); }

/* 本机自检：只判断「填了没 / 格式对不对」，不谎称能验证 MCP 是否真的可用。
   三态：ok 通过 / fail 填错 / pending 尚未填写 —— 空值必须是 pending，
   否则会出现「已填写 ✗」与「为绝对路径 ✓」并存这种自相矛盾。 */
function checkSetup(s) {
  const items = [];
  const abs = (v) => /^[A-Za-z]:[\\/]/.test(String(v || "")) || /^\\\\/.test(String(v || ""));
  const tri = (filled, valid) => (!filled ? "pending" : (valid ? "ok" : "fail"));
  const push = (name, state, hint) => items.push({ name: name, state: state, hint: hint });

  push("页面与 DSH 同源可达", isDSHSameOrigin() ? "ok" : "fail",
       "需通过 http(s) 打开；file:// 下无法调用 MCP");
  push("CST 安装根目录", tri(!!s.cstRoot, abs(s.cstRoot)),
       "应为绝对路径，如 C:\\Program Files\\CST Studio Suite 2026");
  push("CST 可执行文件", tri(!!s.cstExe, /\.exe$/i.test(s.cstExe.trim())),
       "应指向 .exe，通常是 <根目录>\\AMD64\\CST DESIGN ENVIRONMENT_AMD64.exe");
  push("MCP 服务名", tri(!!s.mcpName, /^[A-Za-z0-9_.\-]+$/.test(s.mcpName)),
       "需与 DSH 配置中的 serverName 一致；工具名前缀为 mcp__<服务名>__");
  if (s.mcpTransport === "http") {
    push("MCP 服务地址", tri(!!s.mcpCommand, /^https?:\/\//i.test(s.mcpCommand)),
         "应为 http(s):// 开头的地址");
  } else {
    push("MCP 启动命令", tri(!!s.mcpCommand, true),
         "如 C:\\Program Files\\Python311\\python.exe");
    push("MCP 启动参数", tri(!!s.mcpArgs, true),
         "如 C:\\CST-MCP\\mcp_server.py");
  }
  push("工作区目录", tri(!!s.workspace, abs(s.workspace)),
       "MCP 生成的工程与 cst_runs/ 工作副本保存在此");
  return items;
}
function setupCompleteness(s) {
  const items = checkSetup(s);
  return {
    ok: items.filter((x) => x.state === "ok").length,
    pending: items.filter((x) => x.state === "pending").length,
    fail: items.filter((x) => x.state === "fail").length,
    total: items.length,
  };
}

function renderSetupChecks() {
  const box = document.getElementById("setupChecks");
  if (!box) return;
  const s = normalizeSetup({
    cstRoot: document.getElementById("suCstRoot").value.trim(),
    cstExe: document.getElementById("suCstExe").value.trim(),
    mcpName: document.getElementById("suMcpName").value.trim(),
    mcpTransport: document.getElementById("suMcpTransport").value,
    mcpCommand: document.getElementById("suMcpCommand").value.trim(),
    mcpArgs: document.getElementById("suMcpArgs").value.trim(),
    workspace: document.getElementById("suWorkspace").value.trim(),
  });
  const items = checkSetup(s);
  box.innerHTML = "";
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "setup-check " + it.state;
    const st = document.createElement("span");
    st.className = "st";
    st.textContent = it.state === "ok" ? "✓" : (it.state === "fail" ? "✗" : "○");
    const nm = document.createElement("span");
    nm.textContent = it.name + (it.state === "pending" ? "：尚未填写" : "");
    row.appendChild(st);
    row.appendChild(nm);
    if (it.state !== "ok") {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = it.hint;
      row.appendChild(hint);
    }
    box.appendChild(row);
  });
}

function openSetup(force) {
  const box = document.getElementById("setupOverlay");
  if (!box) return;
  const s = readSetup();
  document.getElementById("suCstRoot").value = s.cstRoot;
  document.getElementById("suCstExe").value = s.cstExe;
  document.getElementById("suMcpName").value = s.mcpName;
  document.getElementById("suMcpTransport").value = s.mcpTransport;
  document.getElementById("suMcpCommand").value = s.mcpCommand;
  document.getElementById("suMcpArgs").value = s.mcpArgs;
  document.getElementById("suWorkspace").value = s.workspace;
  document.getElementById("setupDismiss").textContent = force ? "稍后再说" : "取消";
  box.hidden = false;
  syncSetupLabels();
  renderSetupChecks();
  const first = document.getElementById("suCstRoot");
  if (first && first.focus) first.focus();
}
function closeSetup() {
  const box = document.getElementById("setupOverlay");
  if (box) box.hidden = true;
}
function syncSetupLabels() {
  const http = document.getElementById("suMcpTransport").value === "http";
  document.getElementById("suMcpCommandLabel").textContent = http ? "MCP 服务地址" : "MCP 启动命令";
  document.getElementById("suMcpArgsRow").hidden = http;
  document.getElementById("suMcpCommand").placeholder = http ? "如 http://127.0.0.1:8788/mcp" : "如 C:\\Program Files\\Python311\\python.exe";
  document.getElementById("suMcpArgs").placeholder = "如 C:\\CST-MCP\\mcp_server.py";
}
function collectSetupForm() {
  return normalizeSetup({
    cstRoot: document.getElementById("suCstRoot").value.trim(),
    cstExe: document.getElementById("suCstExe").value.trim(),
    mcpName: document.getElementById("suMcpName").value.trim(),
    mcpTransport: document.getElementById("suMcpTransport").value,
    mcpCommand: document.getElementById("suMcpCommand").value.trim(),
    mcpArgs: document.getElementById("suMcpArgs").value.trim(),
    workspace: document.getElementById("suWorkspace").value.trim(),
    configured: true,
  });
}
function applySetupToForm() {
  // 工作区作为「任务工作目录」的默认值（用户已手填则不动）
  const cwd = document.getElementById("inpCwd");
  const s = readSetup();
  if (cwd && s.workspace && !cwd.value.trim()) cwd.value = s.workspace;
}
/* 把本机配置写进任务指令，模型据此调用 MCP 与 CST */
function buildEnvironmentSection() {
  const s = readSetup();
  const filled = s.cstRoot || s.cstExe || s.mcpCommand || s.workspace;
  if (!filled) return "";
  const lines = [];
  if (s.cstRoot) lines.push("- CST 安装根目录：" + s.cstRoot);
  if (s.cstExe) lines.push("- CST Design Environment 可执行文件：" + s.cstExe);
  if (s.mcpName) lines.push("- CST MCP 服务名：" + s.mcpName + "（工具名前缀 mcp__" + s.mcpName + "__）");
  lines.push("- MCP 传输方式：" + (s.mcpTransport === "http" ? "http" : "stdio"));
  if (s.mcpCommand) lines.push("- MCP " + (s.mcpTransport === "http" ? "服务地址" : "启动命令") + "：" + s.mcpCommand);
  if (s.mcpTransport !== "http" && s.mcpArgs) lines.push("- MCP 启动参数：" + s.mcpArgs);
  if (s.workspace) lines.push("- MCP 工作区：" + s.workspace);
  return "\n# 0. 运行环境（本机配置，由页面首次配置提供）\n" + lines.join("\n") +
         "\n- 若上述 MCP 工具不可用，请先明确报告不可用，不要改用其它途径伪造结果。\n\n";
}
/* 环境探测：交给模型实际调用 MCP 工具，结果经事件流回来 */
async function sendProbeInstruction() {
  if (!isDSHSameOrigin()) { toast("需通过 http(s) 同源访问才能探测", "warn", 4200); return; }
  const s = readSetup();
  const text = "【环境探测】只做检测，不要建模或求解。\n" +
    (s.mcpName ? "MCP 服务名：" + s.mcpName + "\n" : "") +
    (s.cstRoot ? "CST 安装根目录：" + s.cstRoot + "\n" : "") +
    "请按顺序执行并逐项返回 PASS / FAIL：\n" +
    "1) 调用 cst_detect_tool，确认 MCP 可用并列出检测到的 CST 版本与路径；\n" +
    "2) 与上面配置的 CST 安装根目录比对，不一致则指出差异；\n" +
    "3) 报告是否能在本机启动 CST Design Environment（不必真正启动，只看探测结果）。\n" +
    "最后给出一行结论：ENV_OK 或 ENV_FAIL。";
  try {
    await ensureChatSession();
    await sendToChat(text);
    toast("已发送环境探测指令，结果见右栏事件流", "ok", 4200);
    closeSetup();
  } catch (e) { toast("探测失败：" + e.message, "err", 4200); }
}
function initSetup() {
  loadSetup();
  const overlay = document.getElementById("setupOverlay");
  if (!overlay) return;
  const form = document.getElementById("setupForm");
  const bind = (id, ev) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev || "input", () => { syncSetupLabels(); renderSetupChecks(); });
  };
  ["suCstRoot", "suCstExe", "suMcpCommand", "suMcpArgs", "suWorkspace"].forEach((id) => bind(id, "input"));
  bind("suMcpName", "input");
  bind("suMcpTransport", "change");

  if (form) form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const s = collectSetupForm();
    const c = setupCompleteness(s);
    saveSetup(s);
    applySetupToForm();
    refreshDynamic();
    closeSetup();
    toast("配置已保存：自检通过 " + c.ok + "/" + c.total +
          (c.pending ? "，尚有 " + c.pending + " 项未填写" : "") +
          (c.fail ? "，" + c.fail + " 项需修正" : ""),
          c.fail ? "err" : (c.pending ? "warn" : "ok"), 4600);
  });
  const dismiss = document.getElementById("setupDismiss");
  if (dismiss) dismiss.addEventListener("click", () => { closeSetup(); });
  const closeBtn = document.getElementById("setupClose");
  if (closeBtn) closeBtn.addEventListener("click", () => { closeSetup(); });
  document.addEventListener("keydown", (ev) => {
    const ov = document.getElementById("setupOverlay");
    if (ev.key === "Escape" && ov && !ov.hidden) closeSetup();
  });
  const resetBtn = document.getElementById("setupReset");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    if (!confirm("恢复默认？将清空本机保存的 CST 路径与 MCP 地址。")) return;
    saveSetup(defaultSetup());
    openSetup(true);
    toast("已恢复默认", "ok");
  });
  const probe = document.getElementById("setupProbe");
  if (probe) probe.addEventListener("click", sendProbeInstruction);
  const btn = document.getElementById("btnSetup");
  if (btn) btn.addEventListener("click", () => openSetup(false));

  applySetupToForm();
  if (!readSetup().configured) openSetup(true);   // 首次访问自动弹出
}

/* ============================================================
   init
   ============================================================ */
function init() {
'@ 'P11 页面编辑器 + 首次配置'

# P12 ── 顶栏「设置」入口
$new = Apply-Patch $new @'
    <span class="pill" id="cwdPill" title="工作副本路径">副本：—</span>
  </div>
</header>
'@ @'
    <span class="pill" id="cwdPill" title="工作副本路径">副本：—</span>
    <button type="button" class="btn btn-icon" id="btnSetup" aria-label="设置：CST 路径与 MCP 地址" title="设置：CST 路径与 MCP 地址">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="3.1"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>
  </div>
</header>
'@ 'P12 顶栏设置入口（齿轮图标）'

# P13 ── 首次配置浮层
$new = Apply-Patch $new @'
  <section class="card" id="editorCard">
'@ @'
  <!-- ============ 首次配置：CST 路径 + MCP 地址 ============ -->
  <div class="setup-overlay" id="setupOverlay" hidden>
    <div class="setup-panel" role="dialog" aria-modal="true" aria-labelledby="setupTitle">
      <h2 id="setupTitle">首次配置 <span class="tag">本机环境</span></h2>
      <button type="button" class="setup-close" id="setupClose" aria-label="关闭" title="关闭">×</button>
      <div class="desc">
        填写本机的 CST 安装路径与 MCP 地址。这些值会写入任务指令，模型据此调用 MCP 与 CST；
        只保存在本机浏览器（localStorage），不会写回源码文件。可在顶栏右上角的<b>齿轮按钮</b>中随时修改。
      </div>
      <form id="setupForm">
        <div class="setup-group">CST 软件</div>
        <div class="f-row">
          <label class="f-label" for="suCstRoot">CST 安装根目录<span class="req">*</span></label>
          <div class="f-control"><input type="text" id="suCstRoot" style="flex:1 1 320px;" placeholder="如 C:\Program Files\CST Studio Suite 2026"></div>
          <div class="f-help">含 <code>AMD64\</code>、<code>Library\</code> 的目录。</div>
        </div>
        <div class="f-row">
          <label class="f-label" for="suCstExe">CST 可执行文件<span class="req">*</span></label>
          <div class="f-control"><input type="text" id="suCstExe" style="flex:1 1 320px;" placeholder="如 …\AMD64\CST DESIGN ENVIRONMENT_AMD64.exe"></div>
        </div>

        <div class="setup-group">CST MCP 服务</div>
        <div class="f-row">
          <label class="f-label" for="suMcpName">MCP 服务名<span class="req">*</span></label>
          <div class="f-control"><input type="text" id="suMcpName" style="width:220px;" placeholder="cst-studio-suite"></div>
          <div class="f-help">需与 DSH 配置中的 <code>serverName</code> 一致；工具名前缀为 <code>mcp__&lt;服务名&gt;__</code>。</div>
        </div>
        <div class="f-row">
          <label class="f-label" for="suMcpTransport">MCP 传输方式</label>
          <div class="f-control">
            <select id="suMcpTransport" style="min-width:150px;"><option value="stdio">stdio（启动本地进程）</option><option value="http">http（连接服务地址）</option></select>
          </div>
        </div>
        <div class="f-row">
          <label class="f-label" id="suMcpCommandLabel" for="suMcpCommand">MCP 启动命令<span class="req">*</span></label>
          <div class="f-control"><input type="text" id="suMcpCommand" style="flex:1 1 320px;" placeholder="如 C:\Program Files\Python311\python.exe"></div>
        </div>
        <div class="f-row" id="suMcpArgsRow">
          <label class="f-label" for="suMcpArgs">MCP 启动参数</label>
          <div class="f-control"><input type="text" id="suMcpArgs" style="flex:1 1 320px;" placeholder="如 C:\CST-MCP\mcp_server.py"></div>
        </div>
        <div class="f-row">
          <label class="f-label" for="suWorkspace">工作区目录</label>
          <div class="f-control"><input type="text" id="suWorkspace" style="flex:1 1 320px;" placeholder="如 C:\CST_Workspace\cst_runs"></div>
          <div class="f-help">MCP 生成的工程与 <code>cst_runs/</code> 工作副本保存在此。证据目录由 MCP 自身的 <code>.env</code>（<code>CST_MCP_EVIDENCE</code>）决定，不在本页配置。</div>
        </div>

        <div class="setup-group">本机自检<span class="setup-note">（只校验配置填写，不代表 MCP 已连通）</span></div>
        <div class="setup-checks" id="setupChecks"></div>

        <div class="setup-actions">
          <button type="submit" class="btn primary" id="setupSave">保存配置</button>
          <button type="button" class="btn" id="setupProbe">发送环境探测指令</button>
          <button type="button" class="btn" id="setupReset">恢复默认</button>
          <button type="button" class="btn" id="setupDismiss">稍后再说</button>
        </div>
      </form>
    </div>
  </div>

  <section class="card" id="editorCard">
'@ 'P13 首次配置浮层'

# P14 ── 整条消息到达时路由区块数据
$new = Apply-Patch $new @'
    updateS11FromText(text);
    collectFreqDbFromText(text);   // 运行监控：采集 频率–S11 数据点
'@ @'
    updateS11FromText(text);
    collectFreqDbFromText(text);   // 运行监控：采集 频率–S11 数据点
    routeBlockDataFromText(text);  // 自定义区块：回传结构化数据
'@ 'P14 消息级数据路由'

# P15 ── 流式分片到达时也路由（按累积文本解析，内部已按 JSON 去重）
$new = Apply-Patch $new @'
    if (body) { body.textContent += text; view.scrollTop = view.scrollHeight; return; }
  }
  appendChatMsg("assistant", text);
}
'@ @'
    if (body) {
      body.textContent += text;
      view.scrollTop = view.scrollHeight;
      routeBlockDataFromText(body.textContent);
      return;
    }
  }
  appendChatMsg("assistant", text);
  routeBlockDataFromText(text);
}
'@ 'P15 流式数据路由'

# P16 ── 指令里注入「运行环境」与本机配置
$new = Apply-Patch $new @'
  return "【DSH 任务指令】板载天线自动化仿真优化\n" +
'@ @'
  return "【DSH 任务指令】板载天线自动化仿真优化\n" +
    buildEnvironmentSection() +
'@ 'P16 指令注入运行环境'

# P17 ── 指令里注入「数据回传协议」
$new = Apply-Patch $new @'
    commandsBlock + "\n";
'@ @'
    commandsBlock + buildBlockDataProtocol() + "\n";
'@ 'P17 指令注入回传协议'

# P18 ── 文档标题英文
$new = Apply-Patch $new @'
<title>AI 全流程板载天线设计 · DSH 插件</title>
'@ @'
<title>DSH EM Agent · Antenna Design Console</title>
'@ 'P18 文档标题英文'

# P19 ── 顶栏主标题英文（真正的 h1；标题与副标题各占一行，不再被 flex 拆散）
$new = Apply-Patch $new @'
  <div class="brand">AI 全流程板载天线设计 · DSH 插件<small>需求 → 设计 → 仿真 → 优化 → 验证 → 交付全流程控制台 · DSH + CST MCP</small></div>
'@ @'
  <div class="brand"><h1 class="brand-title">DSH EM Agent <span class="brand-sep">·</span> Antenna Design Console</h1><small>需求 → 设计 → 仿真 → 优化 → 验证 → 交付全流程控制台 · DSH + CST MCP</small></div>
'@ 'P19 顶栏主标题英文'

# P20 ── 特殊约束说明：只保留对外可见的 MCP 说明
#        （4.80 GHz 效率抑制 / 隔离度 / 自定义指标属内部约束，不在页面展示）
$new = Apply-Patch $new @'
      <section class="card">
        <h2>特殊约束说明</h2>
        <div class="evidence-line" style="line-height:1.8;">· 4.80 GHz 效率抑制、隔离度要求、自定义指标为<b>特殊任务</b>（橙色标识），仅按需启用；隔离度越大越好（S21 越负越优）。</div>
        <div class="evidence-line" style="line-height:1.8;">· 所有 CST 操作<b>默认通过 cst-studio-suite MCP</b> 驱动 CST Studio Suite 2026 执行。</div>
      </section>
'@ @'
      <section class="card" id="constraintCard">
        <h2>执行方式</h2>
        <div class="evidence-line">所有 CST 操作<b>默认通过 cst-studio-suite MCP</b> 驱动 CST Studio Suite 2026 执行。</div>
      </section>
'@ 'P20 约束说明精简'

# P21 ── 自定义区块默认允许执行脚本（三处：数据层 / 新建默认 / 表单默认勾选）
$new = Apply-Patch $new @'
    allowScripts: src.allowScripts === true,
'@ @'
    allowScripts: src.allowScripts !== false,
'@ 'P21 区块脚本默认开启（数据层）'

$new = Apply-Patch $new @'
  document.getElementById("beScripts").checked = b ? b.allowScripts : false;
'@ @'
  document.getElementById("beScripts").checked = b ? b.allowScripts : true;
'@ 'P22 区块脚本默认开启（新建）'

$new = Apply-Patch $new @'
          <label class="be-inline"><input type="checkbox" id="beScripts"> 允许执行脚本</label>
'@ @'
          <label class="be-inline"><input type="checkbox" id="beScripts" checked> 允许执行脚本</label>
'@ 'P23 区块脚本默认勾选（表单）'

# P24 ── 区块说明区：默认行为说明 + 示例参考
$new = Apply-Patch $new @'
    <div class="desc">
      用 HTML 自由新增内容区块，按需扩展页面功能。区块保存在<b>本机浏览器（localStorage）</b>，不会写回页面源码文件；
      可用「导出 JSON」分享给他人导入。新增的 HTML 默认<b>不执行脚本</b>（浏览器本身就不会运行 innerHTML 里的脚本），
      需要交互时再为单个区块勾选「允许执行脚本」。
    </div>
'@ @'
    <div class="desc">
      用 HTML 自由新增内容区块，按需扩展页面功能。区块保存在<b>本机浏览器（localStorage）</b>，不会写回页面源码文件；
      可用「导出 JSON」分享给他人导入。
    </div>
    <div class="callout">
      <span class="callout-mark" aria-hidden="true"></span>
      <div>新增区块<b>默认允许交互并执行脚本</b>（每个区块默认勾选「允许执行脚本」）。若不需要交互，取消勾选即可；<b>已运行过的脚本需要刷新本页面才会彻底停止</b>，因为已经注册的计时器与事件监听不会因取消勾选而自动解除。</div>
    </div>

    <div class="example-ref" id="exampleRef">
      <div class="example-head">
        <span class="example-title">示例参考：每轮仿真增益 / 效率统计</span>
        <button type="button" class="btn btn-xs" id="btnLoadExample">一键载入此示例</button>
      </div>
      <div class="example-body">
        <p>新增区块时，<b>数据回传通道</b>填 <code>stats</code>，<b>HTML 源码</b>填 <code>&lt;div data-block-slot&gt;&lt;/div&gt;</code>，<b>渲染方式</b>选「内置表格渲染」。运行指令后，大模型每轮回传的仿真结果会写进该区块，按下表逐轮更新。</p>
        <table class="example-table">
          <caption>示例数据，非真实仿真结果</caption>
          <thead><tr><th scope="col">轮次</th><th scope="col">增益 (dB)</th><th scope="col">效率 (%)</th></tr></thead>
          <tbody><tr><td>1</td><td>2.31</td><td>68.4</td></tr><tr><td>2</td><td>2.47</td><td>71.2</td></tr><tr><td>3</td><td>2.58</td><td>72.9</td></tr></tbody>
        </table>
      </div>
    </div>
'@ 'P24 区块示例参考'

# P25 ── 内置示例数据改为「轮次 / 增益 / 效率」形状
$new = Apply-Patch $new @'
  const rows = (r === 1)
    ? [["增益", "2.41", "dBi", "PASS"], ["效率", "-1.82", "dB", "PASS"], ["最差 S11", "-6.7", "dB", "FAIL"]]
    : [["增益", "2.58", "dBi", "PASS"], ["效率", "-1.61", "dB", "PASS"], ["最差 S11", "-9.4", "dB", "PASS"]];
  return normalizePayload({
    channel: ch,
    round: r,
    title: cfg.title || "测试数据",
    columns: ["指标", "数值", "单位", "判定"],
    rows: rows,
    note: (r === 1)
      ? "这是「测试数据」，不代表真实仿真结果（示例阈值 -8 dB：-6.7 未达标、-9.4 达标）。"
      : "",
  });
'@ @'
  const rows = (r === 1) ? [[1, "2.31", "68.4"], [2, "2.47", "71.2"]] : [[3, "2.58", "72.9"]];
  return normalizePayload({
    channel: ch,
    round: r,
    title: cfg.title || "每轮仿真统计",
    columns: ["轮次", "增益 (dB)", "效率 (%)"],
    rows: rows,
    note: (r === 1) ? "示例数据，非真实仿真结果；真实数据由大模型按数据回传协议逐轮写入。" : "",
  });
'@ 'P25 示例数据形状'

# P26 ── 「一键载入示例」按钮行为
$new = Apply-Patch $new @'
  document.addEventListener("click", onBlockActionClick);
}
'@ @'
  document.addEventListener("click", onBlockActionClick);
  const loadEx = document.getElementById("btnLoadExample");
  if (loadEx) loadEx.addEventListener("click", function () {
    openBlockEditor(null);
    document.getElementById("beName").value = "每轮仿真统计";
    document.getElementById("beZone").value = "full";
    document.getElementById("beChannel").value = "stats";
    document.getElementById("beDemand").value = "每轮仿真后输出该轮增益（dB）与效率（%）";
    document.getElementById("beRender").value = "auto";
    document.getElementById("beHistory").checked = true;
    document.getElementById("beScripts").checked = true;
    document.getElementById("beHtml").value = '<div data-block-slot></div>';
    updateBlockPreview();
    toast("示例已载入编辑器，确认后点「保存区块」", "ok", 4200);
  });
}
'@ 'P26 一键载入示例'

# P27 ── 补齐 head 元信息与品牌 favicon（内联 SVG，无外部请求）
$new = Apply-Patch $new @'
<title>DSH EM Agent · Antenna Design Console</title>
'@ @'
<title>DSH EM Agent · Antenna Design Console</title>
<meta name="description" content="DSH 插件：板载天线全流程设计控制台，通过 CST Studio Suite MCP 驱动 CST Studio Suite 2026 完成仿真优化，并支持自定义 HTML 区块扩展。">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='8'%20fill='%232d4fd6'/%3E%3Cg%20fill='none'%20stroke='%23fff'%20stroke-width='2.1'%20stroke-linecap='round'%3E%3Cpath%20d='M16%2024v-7'/%3E%3Cpath%20d='M11.4%2016.2a6.4%206.4%200%200%201%209.2%200'/%3E%3Cpath%20d='M8%2012.6a11%2011%200%200%201%2016%200'/%3E%3C/g%3E%3Ccircle%20cx='16'%20cy='26'%20r='1.9'%20fill='%23fff'/%3E%3C/svg%3E">
'@ 'P27 head 元信息与 favicon'

# P28 ── 键盘跳转入口
$new = Apply-Patch $new @'
<body>

<!-- ============ 顶栏（真实运行状态） ============ -->
'@ @'
<body>

<a class="skip-link" href="#mainContent">跳到主要内容</a>

<!-- ============ 顶栏（真实运行状态） ============ -->
'@ 'P28 跳转入口'

$new = Apply-Patch $new @'
<main class="main">
'@ @'
<main class="main" id="mainContent">
'@ 'P29 main 锚点'

# P30 ── KPI 不再对空占位符预设语义色：无数据时保持中性，出数才着色
$new = Apply-Patch $new @'
      <div class="kpi"><div class="k-label">最差 S11</div><div class="k-value warn" id="kWorst">—</div></div>
      <div class="kpi"><div class="k-label">最佳候选</div><div class="k-value ok" id="kBest">—</div></div>
'@ @'
      <div class="kpi"><div class="k-label">最差 S11</div><div class="k-value" id="kWorst">—</div></div>
      <div class="kpi"><div class="k-label">最佳候选</div><div class="k-value" id="kBest">—</div></div>
'@ 'P30 KPI 空态中性'

$new = Apply-Patch $new @'
    document.getElementById("kWorst").textContent = worstS11.toFixed(1) + " dB";
    document.getElementById("kBest").textContent = bestS11.toFixed(1) + " dB";
'@ @'
    const _wEl = document.getElementById("kWorst"), _bEl = document.getElementById("kBest");
    _wEl.textContent = worstS11.toFixed(1) + " dB"; _wEl.className = "k-value warn";
    _bEl.textContent = bestS11.toFixed(1) + " dB"; _bEl.className = "k-value ok";
'@ 'P31 KPI 出数着色'

$new = Apply-Patch $new @'
  document.getElementById("kWorst").textContent = "—";
  document.getElementById("kBest").textContent = "—";
'@ @'
  document.getElementById("kWorst").textContent = "—";
  document.getElementById("kWorst").className = "k-value";
  document.getElementById("kBest").textContent = "—";
  document.getElementById("kBest").className = "k-value";
'@ 'P32 KPI 复位去色'

# P33 ── 主操作统一走唯一强调色（绿/红只留给「状态」与「破坏性操作」）
$new = Apply-Patch $new @'
      <button type="button" class="btn ok" id="btnStart">启动仿真</button>
'@ @'
      <button type="button" class="btn primary" id="btnStart">启动仿真</button>
'@ 'P33 启动按钮用强调色'

# P34 ── 汇总表「最佳候选」列同属空占位着色问题：无值时不加 ok 类
$new = Apply-Patch $new @'
      '<td class="ok">' + (best === null ? "—" : best.toFixed(1) + " dB") + '</td>' +
'@ @'
      '<td class="' + (best === null ? "" : "ok") + '">' + (best === null ? "—" : best.toFixed(1) + " dB") + '</td>' +
'@ 'P34 汇总表空值去色'

# ============================================================================
# P35–P51 ── ② 频段与指标 / ③ 特殊任务：新增、编辑、删除
#
# 设计约束（改这一段之前先读）：
#   1. 基线不可变，一切 HTML/JS 改动都以「精确命中 1 次」的补丁表达；
#   2. 自定义项与预设项走同一条链路（读取 -> 指令 -> 存储 -> 恢复），
#      预设 BANDS 视为常量，自定义项单独存放，读取处一律 allBands() 合并；
#   3. 「移除 4.80 GHz 效率抑制」的 id 已在 $script:retiredIds 显式登记。
# ============================================================================

# P35 ── ② 频段与指标：新增入口按钮
$new = Apply-Patch $new @'
        <div id="bandCards"></div>
        </div><!-- /card-body -->
'@ @'
        <div id="bandCards"></div>
        <div class="add-row">
          <button type="button" class="btn btn-xs" id="btnAddBand" title="新增一个自定义频段：频率范围、S11 阈值与谐振约束均可编辑，可随时删除">+ 新增频段</button>
        </div>
        </div><!-- /card-body -->
'@ 'P35 频段新增入口'

# P36 ── ③ 特殊任务：移除 4.80 GHz 抑制项，新增自定义特殊需求列表与入口
$new = Apply-Patch $new @'
        <div class="special-item">
          <label style="display:inline-flex;align-items:center;gap:6px;"><input type="checkbox" id="spEfficiencySuppress"> 4.80 GHz 效率抑制</label>
          <span class="s-label">目标（dB）</span>
          <input type="number" id="spEffTarget" step="1" min="-40" max="0" value="-20" style="width:90px" disabled>
          <span class="unit">带外效率 ≤ 目标值</span>
        </div>
        <div class="special-item">
          <label style="display:inline-flex;align-items:center;gap:6px;"><input type="checkbox" id="spIsolation"> 隔离度要求</label>
          <span class="s-label">阈值（dB）</span>
          <input type="number" id="spIsoMax" step="1" min="-60" max="0" value="-25" style="width:90px" disabled>
          <span class="unit">S21 / S12 ≤ 该值（越负越好，隔离度越大：如 -35 dB 优于 -25 dB；多端口时）</span>
        </div>
        <div class="special-item">
          <label style="display:inline-flex;align-items:center;gap:6px;width:100%;"><input type="checkbox" id="spCustom"> 自定义性能指标（勾选后填写下方指标）</label>
        </div>
'@ @'
        <div class="special-item">
          <label style="display:inline-flex;align-items:center;gap:6px;"><input type="checkbox" id="spIsolation"> 隔离度要求</label>
          <span class="s-label">阈值（dB）</span>
          <input type="number" id="spIsoMax" step="1" min="-60" max="0" value="-25" style="width:90px" disabled>
          <span class="unit">S21 / S12 ≤ 该值（越负越好，隔离度越大：如 -35 dB 优于 -25 dB；多端口时）</span>
        </div>
        <div id="customSpecList"></div>
        <div class="add-row">
          <button type="button" class="btn btn-xs" id="btnAddSpec" title="新增一条自定义特殊需求：名称、比较方向、目标值、单位与备注都可编辑，可随时删除">+ 新增特殊需求</button>
        </div>
        <div class="special-item">
          <label style="display:inline-flex;align-items:center;gap:6px;width:100%;"><input type="checkbox" id="spCustom"> 自定义性能指标（勾选后填写下方指标）</label>
        </div>
'@ 'P36 移除 4.8GHz 项 + 特殊需求入口'

# P37 ── 自定义项状态与纯函数工具
$new = Apply-Patch $new @'
let bandState = {};
let bandEnabled = new Set(["band-24"]);
'@ @'
let bandState = {};
let bandEnabled = new Set(["band-24"]);
/* 用户自定义频段与特殊需求：与预设项并存，走同一条读取 / 指令 / 存储链路。
   预设 BANDS 视为常量不改动，自定义项单独存放，读取处一律用 allBands() 合并。 */
let customBands = [];
let customSpecs = [];
let seqBand = 0;
let seqSpec = 0;
function allBands() { return BANDS.concat(customBands); }
function fmtBandNum(n) { return String(Number(n)); }
function bandKeyOf(lo, hi) { return fmtBandNum(lo) + "-" + fmtBandNum(hi); }
function bandLabelOf(lo, hi) { return fmtBandNum(lo) + " – " + fmtBandNum(hi) + " GHz"; }
function nextBandId() { seqBand += 1; return "band-c" + seqBand; }
function nextSpecId() { seqSpec += 1; return "spec-c" + seqSpec; }
/* 存档里的值可能被手工改坏，非字符串一律归一为空串，避免渲染出 [object Object] */
function asText(v) { return typeof v === "string" ? v : ""; }
'@ 'P37 自定义项状态与工具'

# P38 ── 频段卡片：范围编辑控件与新增逻辑
$new = Apply-Patch $new @'
/* ============================================================
   频段卡片（三频段独立阈值 + 谐振约束）
   ============================================================ */
function renderBands() {
'@ @'
/* ============================================================
   频段卡片（预设三频段 + 用户自定义频段；独立阈值 + 谐振约束）
   ============================================================ */

/* 自定义频段的频率范围可编辑。范围一变 b.key 就变，而 bandState 以 key 为索引，
   所以提交时要把状态迁移到新 key，否则用户已经填好的阈值 / 谐振约束会凭空丢失。 */
function makeBandRangeEditor(b) {
  const wrap = document.createElement("div"); wrap.className = "bf band-range-edit";
  const lb = document.createElement("label"); lb.textContent = "频率范围";
  const lo = document.createElement("input");
  lo.type = "number"; lo.step = "0.01"; lo.min = "0.1"; lo.value = b.range.lo;
  lo.className = "band-lo"; lo.style.width = "78px";
  const dash = document.createElement("span"); dash.className = "unit"; dash.textContent = "–";
  const hi = document.createElement("input");
  hi.type = "number"; hi.step = "0.01"; hi.min = "0.1"; hi.value = b.range.hi;
  hi.className = "band-hi"; hi.style.width = "78px";
  const u = document.createElement("span"); u.className = "unit"; u.textContent = "GHz";
  const commit = () => {
    const nlo = Number(lo.value), nhi = Number(hi.value);
    const bad = !isFinite(nlo) || !isFinite(nhi) || nlo <= 0 || nhi <= nlo;
    lo.classList.toggle("invalid", bad); hi.classList.toggle("invalid", bad);
    if (bad) { toast("频率范围无效：需满足 0 < 下限 < 上限", "warn"); return; }
    const nkey = bandKeyOf(nlo, nhi);
    /* 重复判定必须比数值范围，不能比 key 字符串：预设 key 写作 "2.40-2.48"，
       而 bandKeyOf 产出 "2.4-2.48"，字符串不等却指向同一范围，只比字符串会漏判。 */
    if (allBands().some((x) => x.id !== b.id && Number(x.range.lo) === nlo && Number(x.range.hi) === nhi)) {
      lo.classList.add("invalid"); hi.classList.add("invalid");
      toast("已存在范围相同的频段：" + bandLabelOf(nlo, nhi), "warn"); return;
    }
    const oldKey = b.key;
    b.range = { lo: nlo, hi: nhi };
    b.key = nkey;
    b.label = bandLabelOf(nlo, nhi);
    if (oldKey !== nkey) { bandState[nkey] = bandState[oldKey]; delete bandState[oldKey]; }
    savePanelState(); renderBands(); refreshDynamic();
  };
  lo.addEventListener("change", commit);
  hi.addEventListener("change", commit);
  wrap.append(lb, lo, dash, hi, u);
  return wrap;
}

/* 新增自定义频段：从「已有最高频段上界 + 0.5 GHz」起、占 0.2 GHz，避开既有范围；
   用户可以随后把范围改成任意值。 */
function addCustomBand() {
  const all = allBands();
  const tops = all.map((x) => Number(x.range.hi)).filter((n) => isFinite(n));
  let lo = tops.length ? Math.round((Math.max.apply(null, tops) + 0.5) * 100) / 100 : 3.0;
  let hi = Math.round((lo + 0.2) * 100) / 100;
  let guard = 0;
  while (all.some((x) => Number(x.range.lo) === lo && Number(x.range.hi) === hi) && guard < 200) {
    lo = Math.round((lo + 0.5) * 100) / 100; hi = Math.round((lo + 0.2) * 100) / 100; guard += 1;
  }
  const b = { id: nextBandId(), key: bandKeyOf(lo, hi), label: bandLabelOf(lo, hi), range: { lo: lo, hi: hi }, custom: true };
  customBands.push(b);
  bandEnabled.add(b.id);
  bandState[b.key] = { on: true, threshold: "-8", custom: "", resOn: false, resFreq: "", resS11: "-15", resCustom: "" };
  savePanelState(); renderBands(); refreshDynamic();
  const el = document.querySelector("#bandCards .band-card:last-child .band-lo");
  if (el) el.focus();
  addLog("新增自定义频段 " + b.label);
  toast("已新增频段 " + b.label);
}

function renderBands() {
'@ 'P38 频段范围编辑与新增'

# P39 ── 频段卡片遍历合并列表
$new = Apply-Patch $new @'
  BANDS.forEach((b) => {
    const st = bandState[b.key] = bandState[b.key] || {
'@ @'
  allBands().forEach((b) => {
    const st = bandState[b.key] = bandState[b.key] || {
'@ 'P39 频段卡片遍历合并列表'

# P40 ── 自定义频段的删除按钮（放在卡片头部右侧）
$new = Apply-Patch $new @'
    head.appendChild(cb); head.appendChild(headLabel);
'@ @'
    head.appendChild(cb); head.appendChild(headLabel);
    if (b.custom) {
      const del = document.createElement("button");
      del.type = "button"; del.className = "btn btn-xs band-del"; del.id = "bandDel-" + b.id;
      del.textContent = "删除"; del.title = "删除这个自定义频段";
      del.addEventListener("click", () => {
        customBands = customBands.filter((x) => x.id !== b.id);
        bandEnabled.delete(b.id);
        delete bandState[b.key];
        savePanelState(); renderBands(); refreshDynamic();
        addLog("删除自定义频段 " + b.label);
        toast("已删除频段 " + b.label);
      });
      head.appendChild(del);
    }
'@ 'P40 自定义频段删除按钮'

# P41 ── 自定义频段挂载范围编辑控件
$new = Apply-Patch $new @'
    const fields = document.createElement("div"); fields.className = "band-fields";
'@ @'
    const fields = document.createElement("div"); fields.className = "band-fields";
    if (b.custom) fields.appendChild(makeBandRangeEditor(b));
'@ 'P41 自定义频段范围控件'

# P42 ── 自定义特殊需求：行构造、渲染与新增
$new = Apply-Patch $new @'
/* ============================================================
   指令组装（三个 Skill 声明；显式字段；MCP 执行）
   ============================================================ */
function readConfig() {
'@ @'
/* ============================================================
   自定义特殊需求：与「隔离度要求」同构的一行
   （名称 + 比较方向 + 目标值 + 单位 + 备注），行内始终可编辑。
   输入时只写状态、不重渲染，否则会打断正在输入的光标。
   ============================================================ */
function makeSpecRow(s) {
  const row = document.createElement("div"); row.className = "special-item spec-row"; row.id = "specRow-" + s.id;
  const name = document.createElement("input");
  name.type = "text"; name.className = "spec-name"; name.placeholder = "指标名称，如 增益";
  name.value = s.name; name.style.flex = "1 1 130px"; name.style.minWidth = "110px";
  const op = document.createElement("select"); op.className = "spec-op"; op.style.width = "112px";
  [["<=", "不超过 ≤"], [">=", "不低于 ≥"]].forEach((pair) => {
    const o = document.createElement("option"); o.value = pair[0]; o.textContent = pair[1]; op.appendChild(o);
  });
  op.value = s.op;
  const val = document.createElement("input");
  val.type = "number"; val.step = "any"; val.className = "spec-value";
  val.placeholder = "2"; val.value = s.value; val.style.width = "82px";
  const unit = document.createElement("input");
  unit.type = "text"; unit.className = "spec-unit"; unit.placeholder = "单位，如 dBi";
  unit.value = s.unit; unit.style.width = "104px";
  const note = document.createElement("input");
  note.type = "text"; note.className = "spec-note"; note.placeholder = "备注（可选）";
  note.value = s.note; note.style.flex = "1 1 140px"; note.style.minWidth = "110px";
  const del = document.createElement("button");
  del.type = "button"; del.className = "btn btn-xs spec-del"; del.textContent = "删除";
  del.title = "删除这条特殊需求";
  const sync = () => {
    s.name = name.value; s.op = op.value; s.value = val.value;
    s.unit = unit.value; s.note = note.value;
    savePanelState(); refreshDynamic();
  };
  [name, op, val, unit, note].forEach((el) => {
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
  });
  del.addEventListener("click", () => {
    customSpecs = customSpecs.filter((x) => x.id !== s.id);
    savePanelState(); renderCustomSpecs(); refreshDynamic();
    addLog("删除特殊需求" + (s.name ? "：" + s.name : ""));
    toast("已删除特殊需求" + (s.name ? "：" + s.name : ""));
  });
  row.append(name, op, val, unit, note, del);
  return row;
}

function renderCustomSpecs() {
  const box = document.getElementById("customSpecList");
  if (!box) return;
  box.innerHTML = "";
  if (customSpecs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "spec-empty";
    empty.textContent = "还没有自定义特殊需求。点下方「+ 新增特殊需求」添加一条，例如「增益 不低于 2 dBi」。";
    box.appendChild(empty);
    return;
  }
  customSpecs.forEach((s) => box.appendChild(makeSpecRow(s)));
}

function addCustomSpec() {
  const s = { id: nextSpecId(), name: "", op: "<=", value: "", unit: "", note: "" };
  customSpecs.push(s);
  savePanelState(); renderCustomSpecs(); refreshDynamic();
  const el = document.querySelector("#specRow-" + s.id + " .spec-name");
  if (el) el.focus();
}

/* ============================================================
   指令组装（三个 Skill 声明；显式字段；MCP 执行）
   ============================================================ */
function readConfig() {
'@ 'P42 自定义特殊需求渲染与增删'

# P43 ── readConfig 频段来源改为合并列表
$new = Apply-Patch $new @'
  const bands = BANDS.map((b) => {
'@ @'
  const bands = allBands().map((b) => {
'@ 'P43 readConfig 频段合并'

# P44 ── readConfig 的 special 块：去掉 effSuppress，输出自定义需求
$new = Apply-Patch $new @'
    special: {
      effSuppress: document.getElementById("spEfficiencySuppress").checked ? { target: document.getElementById("spEffTarget").value || "-20" } : null,
      isolation: document.getElementById("spIsolation").checked ? { max: document.getElementById("spIsoMax").value || "-25" } : null,
      custom: document.getElementById("spCustom").checked ? document.getElementById("spCustomText").value.trim() : "",
    },
'@ @'
    special: {
      isolation: document.getElementById("spIsolation").checked ? { max: document.getElementById("spIsoMax").value || "-25" } : null,
      custom: document.getElementById("spCustom").checked ? document.getElementById("spCustomText").value.trim() : "",
      // 自定义特殊需求：只输出填了名称的行，空行不进指令
      specs: customSpecs.filter((s) => s.name.trim()).map((s) => ({
        name: s.name.trim(), op: s.op, value: s.value.trim(),
        unit: s.unit.trim(), note: s.note.trim(),
      })),
    },
'@ 'P44 readConfig 输出自定义需求'

# P45 ── validate 频段查找走合并列表，并对状态残留做保护
$new = Apply-Patch $new @'
    const band = BANDS.find((x) => x.key === b.key);
    if (b.resonance && (b.resonance.freq < band.range.lo || b.resonance.freq > band.range.hi)) {
'@ @'
    const band = allBands().find((x) => x.key === b.key);
    if (band && b.resonance && (b.resonance.freq < band.range.lo || b.resonance.freq > band.range.hi)) {
'@ 'P45 validate 频段查找合并'

# P46 ── 指令文本：移除效率抑制行，加入自定义特殊需求
$new = Apply-Patch $new @'
  if (cfg.special.effSuppress) specialLines.push("- 特殊任务：4.80 GHz 处效率抑制（带外效率 ≤ " + cfg.special.effSuppress.target + " dB）");
  if (cfg.special.isolation) specialLines.push("- 特殊任务：隔离度要求——S21、S12 ≤ " + cfg.special.isolation.max + " dB（隔离度越大越好，越负越优：如 -35 dB 优于 -25 dB；多端口时）");
'@ @'
  if (cfg.special.isolation) specialLines.push("- 特殊任务：隔离度要求——S21、S12 ≤ " + cfg.special.isolation.max + " dB（隔离度越大越好，越负越优：如 -35 dB 优于 -25 dB；多端口时）");
  (cfg.special.specs || []).forEach((s) => {
    specialLines.push("- 特殊任务：" + s.name + (s.op === ">=" ? " 不低于 " : " 不超过 ") + s.value + (s.unit ? " " + s.unit : "") + (s.note ? "（" + s.note + "）" : ""));
  });
'@ 'P46 指令文本去效率抑制、加自定义需求'

# P47 ── 状态字段清单移除已退役 id
$new = Apply-Patch $new @'
  "spEfficiencySuppress", "spEffTarget", "spIsolation", "spIsoMax", "spCustom", "spCustomText"];
'@ @'
  "spIsolation", "spIsoMax", "spCustom", "spCustomText"];
'@ 'P47 状态字段移除退役 id'

# P48 ── 持久化自定义项
$new = Apply-Patch $new @'
    localStorage.setItem(STATE_KEY, JSON.stringify({ fields, bandEnabled: [...bandEnabled], bandState }));
'@ @'
    localStorage.setItem(STATE_KEY, JSON.stringify({
      fields, bandEnabled: [...bandEnabled], bandState, customBands, customSpecs,
    }));
'@ 'P48 持久化自定义项'

# P49 ── 恢复自定义项：兼容老存档、丢弃损坏项、序号接续
$new = Apply-Patch $new @'
    if (Array.isArray(p.bandEnabled)) bandEnabled = new Set(p.bandEnabled);
    if (p.bandState && typeof p.bandState === "object") bandState = p.bandState;
'@ @'
    if (Array.isArray(p.bandEnabled)) bandEnabled = new Set(p.bandEnabled);
    if (p.bandState && typeof p.bandState === "object") bandState = p.bandState;
    /* 老存档没有这两个键 -> 保持空数组（向后兼容）；新存档多出的键被老代码忽略
       （向前兼容）。损坏的条目直接丢弃，不让一条坏数据把整个面板卡死。 */
    if (Array.isArray(p.customBands)) {
      customBands = p.customBands.filter((b) => b && b.id && b.range
        && isFinite(Number(b.range.lo)) && isFinite(Number(b.range.hi))
        && Number(b.range.lo) > 0 && Number(b.range.lo) < Number(b.range.hi)
      ).map((b) => ({
        id: String(b.id),
        key: asText(b.key) || bandKeyOf(b.range.lo, b.range.hi),
        label: asText(b.label) || bandLabelOf(b.range.lo, b.range.hi),
        range: { lo: Number(b.range.lo), hi: Number(b.range.hi) },
        custom: true,
      }));
    }
    if (Array.isArray(p.customSpecs)) {
      customSpecs = p.customSpecs.filter((s) => s && s.id).map((s) => ({
        id: String(s.id), name: asText(s.name), op: s.op === ">=" ? ">=" : "<=",
        value: asText(s.value), unit: asText(s.unit), note: asText(s.note),
      }));
    }
    // 序号接着已保存项的最大值，避免新增时与已存项撞 id
    seqBand = customBands.reduce((m, b) => Math.max(m, Number(String(b.id).replace(/\D/g, "")) || 0), 0);
    seqSpec = customSpecs.reduce((m, s) => Math.max(m, Number(String(s.id).replace(/\D/g, "")) || 0), 0);
'@ 'P49 恢复自定义项（兼容 + 序号接续）'

# P50 ── 绑定新增入口并首次渲染自定义需求
$new = Apply-Patch $new @'
  document.getElementById("spEfficiencySuppress").addEventListener("change", (e) => { document.getElementById("spEffTarget").disabled = !e.target.checked; });
  document.getElementById("spIsolation").addEventListener("change", (e) => { document.getElementById("spIsoMax").disabled = !e.target.checked; });
'@ @'
  document.getElementById("spIsolation").addEventListener("change", (e) => { document.getElementById("spIsoMax").disabled = !e.target.checked; });
  document.getElementById("btnAddBand").addEventListener("click", addCustomBand);
  document.getElementById("btnAddSpec").addEventListener("click", addCustomSpec);
  renderCustomSpecs();
'@ 'P50 绑定新增入口'

# P51 ── 变更监听清单移除已退役 id
$new = Apply-Patch $new @'
  ["spEfficiencySuppress", "spIsolation", "spCustom"].forEach((id) => {
'@ @'
  ["spIsolation", "spCustom"].forEach((id) => {
'@ 'P51 变更监听移除退役 id'

# ============================================================================
# P52–P53 ── ⑤ 异常处理策略：移除「增加短截线」，只保留缩放重试与强制细化网格
#
# 说明：这三个复选框本来就**没有**接入 config 记忆（不在 STATE_FIELD_IDS 里，
# 也没有 savePanelState 监听），页面上始终以 HTML 默认值渲染。因此移除其中一项
# 不涉及任何已存储数据的迁移 —— 没有存档引用过 stStub。
# ============================================================================

# P52 ── 移除「增加短截线」复选框（stStub 已在 $script:retiredIds 登记）
$new = Apply-Patch $new @'
            <label style="display:inline-flex;align-items:center;gap:5px;"><input type="checkbox" id="stScale" checked> 缩放重试</label>
            <label style="display:inline-flex;align-items:center;gap:5px;"><input type="checkbox" id="stStub" checked> 增加短截线</label>
            <label style="display:inline-flex;align-items:center;gap:5px;"><input type="checkbox" id="stMesh" checked> 强制细化网格</label></div></div>
'@ @'
            <label style="display:inline-flex;align-items:center;gap:5px;"><input type="checkbox" id="stScale" checked> 缩放重试</label>
            <label style="display:inline-flex;align-items:center;gap:5px;"><input type="checkbox" id="stMesh" checked> 强制细化网格</label></div></div>
'@ 'P52 ⑤ 移除增加短截线'

# P53 ── readConfig 的策略清单同步去掉 stStub
$new = Apply-Patch $new @'
    strategies: ["stScale", "stStub", "stMesh"].filter((id) => document.getElementById(id).checked).map((id) => ({ stScale: "缩放重试", stStub: "增加短截线", stMesh: "强制细化网格" }[id])),
'@ @'
    strategies: ["stScale", "stMesh"].filter((id) => document.getElementById(id).checked).map((id) => ({ stScale: "缩放重试", stMesh: "强制细化网格" }[id])),
'@ 'P53 策略清单同步'

# P54 ── 修正页面内提示文案：更名后应指向新路由，而非旧的静态部署地址
$new = Apply-Patch $new @'
toast("本地模式无法执行仿真（需同源访问 DSH）：已复制完整指令。请通过 http://127.0.0.1:3080/antenna-optimizer-config-panel.html 打开后启动仿真。", "warn", 8000);
'@ @'
toast("本地模式无法执行仿真（需同源访问 DSH）：已复制完整指令。请通过 http://127.0.0.1:3080/em-agent 打开后启动仿真。", "warn", 8000);
'@ 'P54 页面提示文案指向新路由'



# P55 ── 产物去本机路径：内置默认工作目录改成中性值
#   原值 C:\CST_Workspace 是作者本机的工作区，会随产物一起分发出去。
#   它既是 inpCwd 的兜底值，也是 session.create 的 cwd，属于功能性默认值，
#   所以不能删空；改成一个中性目录，由使用者首次配置时覆盖。
$new = Apply-Patch $new @'
const DEFAULT_CWD = "C:\\CST_Workspace";
'@ @'
const DEFAULT_CWD = "C:\\CST_Workspace";
'@ 'P55 默认工作目录改中性值'

# P55b ── inpCwd 的 placeholder 同步去本机路径
$new = Apply-Patch $new @'
placeholder="默认：C:\CST_Workspace（文件所在区域）"
'@ @'
placeholder="默认：C:\CST_Workspace"
'@ 'P55b inpCwd 占位符去本机路径'


# P56 ── 不再内置默认工作目录（去掉假路径，也去掉「可写目录落在系统盘」的坏默认）
#   原来 DEFAULT_CWD 是一个写死的绝对路径。P55 只是把它换成了中性值，但
#   「写死的可写目录」本身就是坏默认：既占系统盘，又与使用者的真实环境无关。
#   现改为不给默认：空值时把 cwd 整键省略，由 DSH 回落它自己的默认项目目录。
#
#   依据（读实现得到，不是猜测）：
#     dsh-api-session-controller/lib/index.js:579
#       const cwd = workspace?.path ?? request.cwd ?? this.defaultCwd;
#     同文件 :2729  new SessionCommandController(ctx, this.agents, process.cwd())
#     ⇒ defaultCwd 就是启动 `dsh web` 时所在的目录。
#   ⚠️ 判定用的是 ??，空字符串不算 nullish —— 传 cwd:"" 会「指定成功」并绕过
#     DSH 的默认值，所以空值必须整键省略，而不是传空串。
$new = Apply-Patch $new @'
const DEFAULT_CWD = "C:\\CST_Workspace";
'@ @'
// 不内置默认工作目录：留空时整键不带 cwd，由 DSH 用它自己的默认项目目录
// （process.cwd()，即启动 dsh web 时所在目录）。空串在 DSH 侧不算「未指定」，
// 所以空值必须整键省略，不能传 ""。
const DEFAULT_CWD = "";
'@ 'P56 去掉内置默认工作目录'

$new = Apply-Patch $new @'
function configCopyPath(cfg) {
  const cwd = cfg.cwd || DEFAULT_CWD;
  return cwd + "\\cst_runs\\" + baseNameOf(cfg.projectFile) + "_" + todayStr();
}
'@ @'
function configCopyPath(cfg) {
  const cwd = cfg.cwd || DEFAULT_CWD;
  if (!cwd) return "（未设置任务工作目录）";
  return cwd + "\\cst_runs\\" + baseNameOf(cfg.projectFile) + "_" + todayStr();
}
'@ 'P56b 未设置工作目录时不拼假路径'

$new = Apply-Patch $new @'
  const cwd = document.getElementById("inpCwd").value.trim() || DEFAULT_CWD;
  createPayload.cwd = cwd;
'@ @'
  const cwd = document.getElementById("inpCwd").value.trim() || DEFAULT_CWD;
  // 空值整键省略：cwd:"" 会被 DSH 当成「已指定」，绕过它自己的默认项目目录
  if (cwd) createPayload.cwd = cwd;
  else addLog("未设置任务工作目录：本会话使用 DSH 的默认项目目录（启动 dsh web 时所在目录）");
'@ 'P56c 空 cwd 时不带该键并记录实际行为'

$new = Apply-Patch $new @'
placeholder="默认：C:\CST_Workspace"
'@ @'
placeholder="留空则用 DSH 默认项目目录"
'@ 'P56d inpCwd 提示改为真实行为'


# P57 ── 对齐当前 DSH 网关的 RPC wire 契约（旧协议在现版本一律 404）
#   实测根因：dsh-api-gateway 的 claimsEndpoint 要求 endpoint.split("/").length === 2，
#   面板原来发的是点号式 "session.create"（只有一段），在任何业务逻辑之前就被判
#   「不认领」并回 404。另外 payload 必须是 { args: { <wire>: 值 } }，而
#   session.prompt 的请求体里 requestId 是必填字段。三处一起改。
$new = Apply-Patch $new @'
/* ============================================================
   DSH RPC + WebSocket 实时订阅（与 DSH 前端同协议）
   ============================================================ */
async function dshRpc(method, payload) {
  const res = await fetch("/api/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId: makeRpcId(), method, payload }),
  });
  if (!res.ok) throw new Error("DSH 传输失败（HTTP " + res.status + "）");
  const full = await res.json();
  if (!full.result || !full.result.ok) {
    const msg = (full.result && full.result.error && full.result.error.message) || "未知错误";
    throw new Error("DSH 拒绝请求：" + msg);
  }
  return full.result.value;
}
'@ @'
/* ============================================================
   DSH RPC 客户端（对齐当前 DSH 网关的 wire 契约）
   ------------------------------------------------------------
   三条硬约束。改动前先读 dsh-api-gateway 的 claimsEndpoint 与
   dsh-client-connection 的 rpcFetchHandler，不要凭记忆写：
   1) 路径必须两段式：POST /api/<namespace>/<method>。
      网关要求 endpoint.split("/").length === 2；点号写法 "session.create"
      只有一段，会在任何业务逻辑之前被判「不认领」，直接回 404。
   2) body 是 client-request 信封，payload 必须是 { args: { <wire>: 值 } }。
      <wire> 是该接口的命名参数名——本页用到的三个都是 request。
   3) 信封里的 method 必须与 URL 末段完全一致，否则回 gateway/bad-request。
   ============================================================ */
const RPC_ENDPOINTS = {
  "session.create": { endpoint: "session/create", wire: "request" },
  "session.prompt": { endpoint: "session/prompt", wire: "request" },
  "session.cancel": { endpoint: "session/cancel", wire: "request" },
};
async function dshRpc(method, payload) {
  const spec = RPC_ENDPOINTS[method];
  if (!spec) throw new Error("未登记的 DSH 接口：" + method);
  const args = {};
  args[spec.wire] = payload;
  const res = await fetch("/api/" + spec.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId: makeRpcId(),
      method: spec.endpoint,
      payload: { args: args },
    }),
  });
  if (!res.ok) throw new Error("DSH 传输失败（HTTP " + res.status + "，" + spec.endpoint + "）");
  const full = await res.json();
  if (!full.result || !full.result.ok) {
    const msg = (full.result && full.result.error && full.result.error.message) || "未知错误";
    throw new Error("DSH 拒绝请求：" + msg);
  }
  return full.result.value;
}
'@ 'P57a RPC 改为两段式端点 + args 信封'

$new = Apply-Patch $new @'
async function sendToChat(text) {
  await dshRpc("session.prompt", { sessionId: chatSession, mode: "queue", content: [{ type: "text", text }] });
'@ @'
async function sendToChat(text) {
  // requestId 是 SessionPromptRequest 的必填字段，缺了会被严格解码拒绝
  await dshRpc("session.prompt", { requestId: makeRpcId(), sessionId: chatSession, mode: "queue", content: [{ type: "text", text }] });
'@ 'P57b session.prompt 补必填 requestId'

$new = Apply-Patch $new @'
async function pollChatOnce() {
  if (chatSession === null || chatSocket !== null) return;
  try {
    const res = await dshRpc("session.history", { sessionId: chatSession, maxMessages: 50 });
    const events = (res.events || []).filter((e) => e && e.event && e.event.seq > chatLastSeq);
    events.sort((a, b) => a.event.seq - b.event.seq);
    for (const entry of events) { processSessionEvent(entry.event); if (entry.event.seq > chatLastSeq) chatLastSeq = entry.event.seq; }
  } catch (e) { stopChatPolling(); }
}
async function snapshotChatHistory() {
  if (chatSession === null) return;
  try {
    const res = await dshRpc("session.history", { sessionId: chatSession, maxMessages: 30 });
    const events = (res.events || []).slice().sort((a, b) => a.event.seq - b.event.seq);
    for (const entry of events) { processSessionEvent(entry.event); if (entry.event.seq > chatLastSeq) chatLastSeq = entry.event.seq; }
  } catch (e) {}
}
'@ @'
/* 会话事件的取法已变：现在的接口是流式的 session/follow，必须经由
   /api/remote.mux 的流载体打开（网关对 unary 方式调用流式接口会直接抛错）。
   本页尚未实现该载体，而旧接口 session.history 在现版本根本不存在，
   所以这里保持空实现——发一个必然 404 的请求只会制造假故障。 */
async function pollChatOnce() {
  return;
}
async function snapshotChatHistory() {
  return;
}
'@ 'P57c 移除已不存在的 session.history 调用'

$new = Apply-Patch $new @'
/* Win10 目录选择器：同源模式调用 DSH host.pickDirectory；file:// 降级提示 */
function openNativeDirectoryPicker() {
  if (!isDSHSameOrigin()) {
    toast("本地模式请手动输入目录；同源模式（http://127.0.0.1:3080/…）可用本机目录选择器", "warn", 4200);
    return;
  }
  dshRpc("host.pickDirectory", {}).then((val) => {
    const path = (val && val.path) || val;
    if (path) { document.getElementById("inpProjectDir").value = path; refreshDynamic(); }
  }).catch((e) => toast("目录选择失败：" + e.message, "err", 4200));
}
'@ @'
/* 目录选择器：当前 DSH 版本没有对应的主机端点。
   pickDirectory 是客户端插件 API（dsh-client-ui-directory-picker-native 的
   ctx.uiWorkspace.pickDirectory()），独立页面够不到；旧版用过的
   host.pickDirectory 在现版本不存在，调用只会拿到 404。
   所以如实说明，不再发一个注定失败的请求。 */
function openNativeDirectoryPicker() {
  toast("当前 DSH 版本未向本页面开放目录选择器，请手动填写路径（可复制资源管理器地址栏）", "warn", 5200);
}
'@ 'P57d 目录选择器改为如实降级'

$new = Apply-Patch $new @'
    toast("已发送环境探测指令，结果见右栏事件流", "ok", 4200);
'@ @'
    toast("已发送环境探测指令（会话 " + chatSession + "）。本面板尚未接通当前 DSH 版本的事件流，请在 DSH 主界面的该会话里查看结果。", "ok", 7600);
'@ 'P57e 探测成功提示改为如实说明'


# P58 ── 接上会话事件流：/api/remote.mux 上的 session/follow
#   原来用的是 /api/events.mux（旧专用端点，现版本已完全不存在），所以右栏从来收不到东西。
#   现版本的做法是在 /api/remote.mux 这条 WebSocket 上开一条逻辑流。
#   帧格式与 session/follow 的 value 形状都取自 dsh-api-gateway 的 stream-protocol.js
#   与 dsh-api-session-controller 的 follow 结果 schema，不是凭记忆写的。
$new = Apply-Patch $new @'
let chatPollTimer = null;
let chatSocket = null;
'@ @'
let chatPollTimer = null;
let chatSocket = null;
let chatStreamId = null;        // 当前 session/follow 逻辑流的 id
let chatReconnectTimer = null;  // 断线后的重连定时器
let chatReconnectDelay = 500;   // 退避起点 500ms，上限 8s
'@ 'P58a 事件流所需的状态变量'

$new = Apply-Patch $new @'
function connectChatSocket() {
  if (chatSocket !== null || chatSession === null || !isDSHSameOrigin()) return;
  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(wsProtocol + "//" + location.host + "/api/events.mux");
  chatSocket = ws;
  ws.onmessage = (ev) => {
    try {
      const envelope = JSON.parse(ev.data);
      const frame = envelope && envelope.payload;
      if (!frame || typeof frame !== "object") return;
      if (frame.type === "session/event" && frame.sessionId === chatSession) {
        processSessionEvent(frame.event);
        if (frame.event.seq > chatLastSeq) chatLastSeq = frame.event.seq;
      }
    } catch (e) {}
  };
  ws.onclose = () => { if (chatSocket === ws) { chatSocket = null; startChatPolling(); } };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}
function disconnectChatSocket() {
  if (chatSocket !== null) { try { chatSocket.close(); } catch (e) {} chatSocket = null; }
}
'@ @'
/* ============================================================
   会话事件流：/api/remote.mux 上的 session/follow
   ------------------------------------------------------------
   面板要看模型的输出就需要一条推送通道。当前 DSH 的做法是在
   /api/remote.mux 这条 WebSocket 上开一条逻辑流；旧版本用的专用端点
   /api/events.mux 在新版本已完全不存在（全库 0 处命中）。

   帧格式（dsh-api-gateway/lib/types/stream-protocol.js）：
     发 → { type:'open', streamId, endpoint, payload }
          { type:'cancel', streamId }
     收 → { type:'item', streamId, value }
          { type:'end', streamId }
          { type:'error', streamId, error:{ code, message, details } }

   session/follow 的 value 三选一：
     { type:'snapshot', cursor, records:[{ event }], hasMore, projections, … }
     { type:'event', event:{ type, seq, time, data, … } }
     { type:'assistant-stream', frame:{ … } }   仅当 opt-in assistantStream:true

   本页**不** opt-in assistantStream：它要求客户端按 revision 连续性自校验，
   而我们只需要 journal 事件，少一条链路就少一处会出错的地方。代价是看不到
   逐字流式输出（记在 docs/dev/roadmap.md）。
   ============================================================ */
const REMOTE_MUX_PATH = "/api/remote.mux";
const FOLLOW_MAX_MESSAGES = 50;

function connectChatSocket() {
  if (chatSocket !== null || chatSession === null || !isDSHSameOrigin()) return;
  const sessionId = chatSession;
  const streamId = "follow-" + makeRpcId();
  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(wsProtocol + "//" + location.host + REMOTE_MUX_PATH);
  chatSocket = ws;
  chatStreamId = streamId;
  ws.onopen = () => {
    chatReconnectDelay = 500;   // 连上了就把退避重置
    try {
      ws.send(JSON.stringify({
        type: "open",
        streamId: streamId,
        endpoint: "session/follow",
        payload: { args: { request: {
          address: { kind: "session", sessionId: sessionId },
          maxMessages: FOLLOW_MAX_MESSAGES,
        } } },
      }));
    } catch (e) { toast("打开会话事件流失败：" + e.message, "err", 5000); }
  };
  ws.onmessage = (ev) => {
    let frame;
    try { frame = JSON.parse(ev.data); } catch (e) { return; }
    if (!frame || frame.streamId !== streamId) return;
    if (frame.type === "item") { consumeFollowItem(frame.value); return; }
    if (frame.type === "end") { addLog("会话事件流已结束"); scheduleChatReconnect(); return; }
    if (frame.type === "error") {
      addLog("会话事件流出错：" + ((frame.error && frame.error.message) || "未知错误"));
      scheduleChatReconnect();
    }
  };
  ws.onclose = () => {
    if (chatSocket !== ws) return;
    chatSocket = null;
    chatStreamId = null;
    scheduleChatReconnect();
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}
/* 快照与后续增量可能重叠，一律按 seq 去重；chatLastSeq 是已处理到的最大 seq */
function consumeFollowItem(value) {
  if (!value || typeof value !== "object") return;
  if (value.type === "snapshot") {
    const records = Array.isArray(value.records) ? value.records.slice() : [];
    records.sort((a, b) => ((((a || {}).event || {}).seq) || 0) - ((((b || {}).event || {}).seq) || 0));
    for (const record of records) {
      const event = record && record.event;
      if (!event || typeof event.seq !== "number" || event.seq <= chatLastSeq) continue;
      processSessionEvent(event);
      if (event.seq > chatLastSeq) chatLastSeq = event.seq;
    }
    return;
  }
  if (value.type === "event" && value.event && typeof value.event.seq === "number") {
    if (value.event.seq <= chatLastSeq) return;
    processSessionEvent(value.event);
    if (value.event.seq > chatLastSeq) chatLastSeq = value.event.seq;
  }
}
function scheduleChatReconnect() {
  if (chatReconnectTimer !== null || chatSession === null) return;
  const delay = chatReconnectDelay;
  chatReconnectDelay = Math.min(chatReconnectDelay * 2, 8000);
  chatReconnectTimer = setTimeout(() => { chatReconnectTimer = null; connectChatSocket(); }, delay);
}
function disconnectChatSocket() {
  if (chatReconnectTimer !== null) { clearTimeout(chatReconnectTimer); chatReconnectTimer = null; }
  const ws = chatSocket;
  const streamId = chatStreamId;
  chatSocket = null;        // 先清空：onclose 里的守卫看到 chatSocket !== ws 就不会再排重连
  chatStreamId = null;
  if (ws === null) return;
  try {
    if (streamId && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "cancel", streamId: streamId }));
  } catch (e) {}
  try { ws.close(); } catch (e) {}
}
'@ 'P58b 事件流改为 remote.mux + session/follow'

$new = Apply-Patch $new @'
  } else if (event.type === "assistant/chunk") {
    const chunk = event.data && event.data.chunk;
'@ @'
  } else if (event.type === "assistant/chunk") {
    // assistant/chunk 是 v0 会话格式的遗留类型：现版本的 journal 不再产生它，
    // 只剩 dsh-session-format-v0-to-v1 这类迁移包认识它。保留此分支只为兼容旧会话；
    // 逐字流式输出在当前协议里是 session/follow 的 opt-in assistantStream，本页未启用。
    const chunk = event.data && event.data.chunk;
'@ 'P58c 标注 assistant/chunk 为遗留类型'


# P59 ── 去掉本地乐观追加，消除重复气泡
#   事件流接通后发现同一句话出现两次：sendToChat 本地 appendChatMsg 画一遍，
#   会话 journal 又把这条 user/message 原样回推一遍。既然推送通道已经可用，
#   就只保留权威来源（服务端定 seq 的那条），本地不再预画。
$new = Apply-Patch $new @'
  await dshRpc("session.prompt", { requestId: makeRpcId(), sessionId: chatSession, mode: "queue", content: [{ type: "text", text }] });
  appendChatMsg("user", text);
  connectChatSocket();
'@ @'
  await dshRpc("session.prompt", { requestId: makeRpcId(), sessionId: chatSession, mode: "queue", content: [{ type: "text", text }] });
  // 这里不再本地乐观追加：会话 journal 会把这条 user/message 原样回推（seq 由服务端定），
  // 本地再画一遍就会重复。渲染只有一个来源——事件流。
  connectChatSocket();
'@ 'P59 去掉本地乐观追加'


# P60 ── 预检：修掉误判、失败先自动补齐、解除场监视器锁定
#   1) 判定器取「最后出现的判定词」作为结论。旧版把「阻断原因」写进失败正则，
#      而预检指令恰恰要求模型 FAIL 时「列出全部阻断原因」——一份全 PASS 的报告
#      只要提到这四个字就被判失败（2026-10-01 实际发生）。
#   2) 预检未通过时先自动补齐所需条件再重检（有限轮次），而不是直接阻断。
#   3) 场监视器从「禁止修改」里移除：可自行决定是否添加。内激励端口缺失则必须补齐。
$new = Apply-Patch $new @'
  forbiddenModifications: ["边界条件", "全局激励源", "全局求解器类型", "全局网格划分策略", "场监视器"],
'@ @'
  // 场监视器不在禁止之列：可自行决定是否添加，不强制（2026-10-01 起）
  forbiddenModifications: ["边界条件", "全局激励源", "全局求解器类型", "全局网格划分策略"],
'@ 'P60a 场监视器移出禁止清单'

$new = Apply-Patch $new @'
          <div class="blocked-box" style="background:var(--surface-3);border-color:var(--border);color:var(--text-sub);">🔒 以下为<b>默认锁定</b>项，不提供自主设置：边界条件、全局求解器类型、全局网格划分策略、场监视器（沿用源工程有效设置）。</div>
'@ @'
          <div class="blocked-box" style="background:var(--surface-3);border-color:var(--border);color:var(--text-sub);">🔒 以下为<b>默认锁定</b>项，不提供自主设置：边界条件、全局求解器类型、全局网格划分策略（沿用源工程有效设置）。<br>场监视器<b>不锁定</b>：可自行决定是否添加，不强制。</div>
'@ 'P60b ⑤ 锁定说明改为场监视器不锁定'

$new = Apply-Patch $new @'
"\n- 默认锁定：边界条件、全局求解器类型、全局网格划分策略、场监视器不自主设置（沿用源工程有效设置）。\n\n" +
'@ @'
"\n- 默认锁定：边界条件、全局求解器类型、全局网格划分策略（沿用源工程有效设置）。\n- 场监视器：不锁定，可自行决定是否添加，不强制。\n- 内激励端口：工程中若缺失或未连接，必须按第 6 节的馈电类型/阻抗/方向补齐后才可求解。\n\n" +
'@ 'P60c 任务指令同步端口与监视器口径'

$new = Apply-Patch $new @'
let chatReconnectDelay = 500;   // 退避起点 500ms，上限 8s
'@ @'
let chatReconnectDelay = 500;   // 退避起点 500ms，上限 8s
let precheckRetries = 0;        // 预检失败后已自动补齐的轮次
const PRECHECK_MAX_RETRIES = 2; // 补齐轮次上限，用尽仍失败才阻断
'@ 'P60d 预检补齐轮次状态'

$new = Apply-Patch $new @'
/* 预检判定（启发式解析 assistant 文本） */
function judgePrecheck(text) {
  const fail = /\bFAIL\b|预检失败|阻断原因|检查项.*失败|无法打开|路径不一致/.test(text);
  const pass = /^PASS\b|\bPASS\b|预检通过|检查通过|全部通过|可启动/.test(text) && !fail;
  if (fail) {
    setRunState("failed");
    document.getElementById("precheckBlocked").hidden = false;
    document.getElementById("precheckBlocked").innerHTML = "⛔ 工程预检未通过，阻断原因：<br>" + text.replace(/\n/g, "<br>").slice(0, 2000);
    addLog("预检失败（阻断）");
    return;
  }
  if (pass) {
    document.getElementById("precheckBlocked").hidden = true;
    document.getElementById("precheckList").innerHTML = "";
    ["CST MCP 可用", "源工程只读可访问", "工作副本可拷贝", "天线/基板路径一致", "求解配置完整可解"].forEach((n) => {
      const div = document.createElement("div");
      div.className = "precheck-item ok";
      div.innerHTML = "<span class='st'>✓</span>" + n;
      document.getElementById("precheckList").appendChild(div);
    });
    addLog("工程预检通过 → 进入优化迭代");
    setRunState("running");
    sendToChat(buildInstruction(readConfig())).then(() => {
      toast("预检通过，优化迭代已启动（MCP 驱动）", "ok", 4200);
    }).catch((e) => toast("启动失败：" + e.message, "err"));
  }
}
'@ @'
/* 预检判定：取**最后**出现的判定词作为结论。
   预检指令要求模型「最终输出一行 PASS / FAIL」，同时又要求 FAIL 时「列出全部阻断原因」——
   所以「阻断原因」这四个字本身不能当失败信号。旧版把它写进失败正则，于是**一份四项
   全 PASS、只是在文末提了一句「阻断原因」的报告也被判失败并阻断**（2026-10-01 实际发生）。
   判不出任何判定词时按失败处理：宁可让人看一眼，也不要放行一个没读懂的预检结果。 */
function precheckVerdictOf(text) {
  const re = /(FAIL|PASS|预检未通过|预检通过|检查通过|可启动)/g;
  let last = null;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) last = m[1];
  if (last === "PASS" || last === "预检通过" || last === "检查通过" || last === "可启动") return "pass";
  if (last === "FAIL" || last === "预检未通过") return "fail";
  return "unknown";
}
/* 预检未通过后的一轮自动补齐。这一轮是**允许写入工作副本**的，与只读的预检分开写，
   免得模型把「只检测不改动」理解成「永远不许改」。 */
function buildPrecheckRemediationInstruction(reasons) {
  const cfg = readConfig();
  return "【预检未通过 → 自动补齐所需条件】上一轮预检结论为未通过。" +
    "请在**工作副本**上补齐缺失条件，然后重新执行一次预检。\n" +
    "工程（工作副本）：" + joinPath(cfg.projectDir, cfg.projectFile) + "\n\n" +
    "本轮允许的写入范围：\n" +
    "1) 内激励端口：缺失或未连接时按第 6 节补齐——" + FIXED_CONFIG.feedType +
    "，阻抗 " + FIXED_CONFIG.impedance + "（固定，不可更改），方向 " + cfg.portDir +
    "；补齐后确认端口连接正常；\n" +
    "2) 场监视器：可自行决定是否添加，不强制；\n" +
    "3) 其它使工程变为「可求解」所必需的最小改动。\n\n" +
    "仍然禁止：修改源工程、" + FIXED_CONFIG.forbiddenModifications.join("、") + "。\n" +
    "补齐后重新输出一行：PASS（可启动仿真）或 FAIL（并列出全部阻断原因）。\n\n" +
    "上一次的预检结论原文：\n" + String(reasons || "").slice(0, 1500);
}
function judgePrecheck(text) {
  const verdict = precheckVerdictOf(text);

  if (verdict === "pass") {
    precheckRetries = 0;
    document.getElementById("precheckBlocked").hidden = true;
    document.getElementById("precheckList").innerHTML = "";
    ["CST MCP 可用", "源工程只读可访问", "工作副本可拷贝", "天线/基板路径一致", "求解配置完整可解"].forEach((n) => {
      const div = document.createElement("div");
      div.className = "precheck-item ok";
      div.innerHTML = "<span class='st'>✓</span>" + n;
      document.getElementById("precheckList").appendChild(div);
    });
    addLog("工程预检通过 → 进入优化迭代");
    setRunState("running");
    sendToChat(buildInstruction(readConfig())).then(() => {
      toast("预检通过，优化迭代已启动（MCP 驱动）", "ok", 4200);
    }).catch((e) => toast("启动失败：" + e.message, "err"));
    return;
  }

  // 未通过 → 先自动补齐所需条件再重检，而不是立刻阻断
  if (verdict === "fail" && precheckRetries < PRECHECK_MAX_RETRIES) {
    precheckRetries += 1;
    document.getElementById("precheckBlocked").hidden = true;
    document.getElementById("precheckList").innerHTML =
      "<span style='color:var(--text-sub);font-size:12.5px;'>预检未通过，正在自动补齐所需条件（第 " +
      precheckRetries + "/" + PRECHECK_MAX_RETRIES + " 轮）…</span>";
    addLog("预检未通过 → 自动补齐（第 " + precheckRetries + "/" + PRECHECK_MAX_RETRIES + " 轮）");
    setRunState("prchecking");
    sendToChat(buildPrecheckRemediationInstruction(text))
      .catch((e) => toast("自动补齐指令发送失败：" + e.message, "err", 5000));
    return;
  }

  // 补齐轮次用尽，或根本读不出结论 → 阻断，并说明是哪一种
  setRunState("failed");
  const exhausted = verdict === "fail";
  precheckRetries = 0;
  document.getElementById("precheckBlocked").hidden = false;
  document.getElementById("precheckBlocked").innerHTML =
    (exhausted
      ? "⛔ 工程预检未通过（已自动补齐 " + PRECHECK_MAX_RETRIES + " 轮仍失败），阻断原因："
      : "⛔ 工程预检未通过：无法从模型输出判定结论（没有出现 PASS / FAIL 判定词），原文：") +
    "<br>" + String(text || "").replace(/\n/g, "<br>").slice(0, 2000);
  addLog(exhausted ? "预检失败（补齐轮次用尽，阻断）" : "预检失败（无法判定，阻断）");
}
'@ 'P60e 预检判定与自动补齐'

$new = Apply-Patch $new @'
  // 预检阶段
  setRunState("prchecking");
'@ @'
  // 预检阶段
  precheckRetries = 0;
  setRunState("prchecking");
'@ 'P60f 每次启动重置补齐轮次'


# P61 ── 修正 P60e 的判定器：光靠「最后出现的判定词」还不够
#   P60e 取「最后出现的判定词」当结论，但报告里常见的收尾句是
#   「若工程预检未通过，则自动补充所需条件」——这句里的「预检未通过」排在
#   所有 PASS 之后，于是又被判成失败。改成两级判定：
#     ① 结论行：从末尾往前找「整行基本就是结论」的行（可带 结论/判定/最终 前缀，
#        也认整行的中文说法），命中即定论；
#     ② 判定词计数：没有结论行时，按独立出现的 PASS/FAIL 计数——FAIL 优先，
#        再次 PASS。正文里的条件句（若…未通过）不算数。
$new = Apply-Patch $new @'
function precheckVerdictOf(text) {
  const re = /(FAIL|PASS|预检未通过|预检通过|检查通过|可启动)/g;
  let last = null;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) last = m[1];
  if (last === "PASS" || last === "预检通过" || last === "检查通过" || last === "可启动") return "pass";
  if (last === "FAIL" || last === "预检未通过") return "fail";
  return "unknown";
}
'@ @'
function precheckVerdictOf(text) {
  const s = String(text || "");
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);

  // ① 结论行：从末尾往前找「整行基本就是结论」的行（指令要求模型最终输出一行 PASS/FAIL）。
  //    只认行首判定词，所以「## 1) … — PASS」这种小节标题不会被当成结论，
  //    正文里的条件句（若工程预检未通过…）也不会。
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.length > 160) continue;
    const m = /^[#>*\-\s]*(?:(?:最终)?(?:结论|判定|预检结果|verdict)\s*[:：]?\s*)?(PASS|FAIL)\b/i.exec(line);
    if (m) return m[1].toUpperCase() === "PASS" ? "pass" : "fail";
    const bare = line
      .replace(/^[#>*\-\s]+/, "")
      .replace(/^(?:最终)?(?:结论|判定|预检结果)\s*[:：]\s*/, "")
      .replace(/[。.\s]+$/, "");
    if (bare === "预检通过" || bare === "检查通过" || bare === "可启动") return "pass";
    if (bare === "预检未通过" || bare === "失败" || bare === "阻断") return "fail";
  }

  // ② 没有结论行时按判定词计数：FAIL 优先，再次 PASS。中文条件句不参与计数。
  const failCount = (s.match(/(^|[^A-Za-z])FAIL([^A-Za-z]|$)/g) || []).length;
  if (failCount > 0) return "fail";
  const passCount = (s.match(/(^|[^A-Za-z])PASS([^A-Za-z]|$)/g) || []).length;
  if (passCount > 0) return "pass";

  return "unknown";
}
'@ 'P61 判定器改为「结论行 + 判定词计数」两级'


# P62 ── 判定要能自证：把「凭什么这么判」显示出来
#   这次误阻断最难的地方是：盒子只贴了模型原文，没说判定器究竟认了哪一行，
#   于是只能靠猜。现在判定返回 { verdict, evidence }，把命中的结论行（或计数）
#   一起写进阻断提示与操作日志，下次一眼就能看出是「判错」还是「真失败」。
$new = Apply-Patch $new @'
function precheckVerdictOf(text) {
  const s = String(text || "");
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);

  // ① 结论行：从末尾往前找「整行基本就是结论」的行（指令要求模型最终输出一行 PASS/FAIL）。
  //    只认行首判定词，所以「## 1) … — PASS」这种小节标题不会被当成结论，
  //    正文里的条件句（若工程预检未通过…）也不会。
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.length > 160) continue;
    const m = /^[#>*\-\s]*(?:(?:最终)?(?:结论|判定|预检结果|verdict)\s*[:：]?\s*)?(PASS|FAIL)\b/i.exec(line);
    if (m) return m[1].toUpperCase() === "PASS" ? "pass" : "fail";
    const bare = line
      .replace(/^[#>*\-\s]+/, "")
      .replace(/^(?:最终)?(?:结论|判定|预检结果)\s*[:：]\s*/, "")
      .replace(/[。.\s]+$/, "");
    if (bare === "预检通过" || bare === "检查通过" || bare === "可启动") return "pass";
    if (bare === "预检未通过" || bare === "失败" || bare === "阻断") return "fail";
  }

  // ② 没有结论行时按判定词计数：FAIL 优先，再次 PASS。中文条件句不参与计数。
  const failCount = (s.match(/(^|[^A-Za-z])FAIL([^A-Za-z]|$)/g) || []).length;
  if (failCount > 0) return "fail";
  const passCount = (s.match(/(^|[^A-Za-z])PASS([^A-Za-z]|$)/g) || []).length;
  if (passCount > 0) return "pass";

  return "unknown";
}
'@ @'
function precheckJudge(text) {
  const s = String(text || "");
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);

  // ① 结论行：从末尾往前找「整行基本就是结论」的行（指令要求模型最终输出一行 PASS/FAIL）。
  //    只认行首判定词，所以「## 1) … — PASS」这种小节标题不会被当成结论，
  //    正文里的条件句（若工程预检未通过…）也不会。
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.length > 160) continue;
    const m = /^[#>*\-\s]*(?:(?:最终)?(?:结论|判定|预检结果|verdict)\s*[:：]?\s*)?(PASS|FAIL)\b/i.exec(line);
    if (m) return { verdict: m[1].toUpperCase() === "PASS" ? "pass" : "fail", evidence: "结论行：" + line.slice(0, 160) };
    const bare = line
      .replace(/^[#>*\-\s]+/, "")
      .replace(/^(?:最终)?(?:结论|判定|预检结果)\s*[:：]\s*/, "")
      .replace(/[。.\s]+$/, "");
    if (bare === "预检通过" || bare === "检查通过" || bare === "可启动") return { verdict: "pass", evidence: "结论行：" + line.slice(0, 160) };
    if (bare === "预检未通过" || bare === "失败" || bare === "阻断") return { verdict: "fail", evidence: "结论行：" + line.slice(0, 160) };
  }

  // ② 没有结论行时按判定词计数：FAIL 优先，再次 PASS。中文条件句不参与计数。
  const failCount = (s.match(/(^|[^A-Za-z])FAIL([^A-Za-z]|$)/g) || []).length;
  const passCount = (s.match(/(^|[^A-Za-z])PASS([^A-Za-z]|$)/g) || []).length;
  const evidence = "无结论行；判定词计数 PASS " + passCount + " 次 / FAIL " + failCount + " 次";
  if (failCount > 0) return { verdict: "fail", evidence: evidence };
  if (passCount > 0) return { verdict: "pass", evidence: evidence };
  return { verdict: "unknown", evidence: evidence };
}
/* 只要结论字符串的薄包装 */
function precheckVerdictOf(text) { return precheckJudge(text).verdict; }
'@ 'P62a 判定返回结论与依据'

$new = Apply-Patch $new @'
function judgePrecheck(text) {
  const verdict = precheckVerdictOf(text);
'@ @'
function judgePrecheck(text) {
  const judged = precheckJudge(text);
  const verdict = judged.verdict;
'@ 'P62b judgePrecheck 改用带依据的判定'

$new = Apply-Patch $new @'
  document.getElementById("precheckBlocked").innerHTML =
    (exhausted
      ? "⛔ 工程预检未通过（已自动补齐 " + PRECHECK_MAX_RETRIES + " 轮仍失败），阻断原因："
      : "⛔ 工程预检未通过：无法从模型输出判定结论（没有出现 PASS / FAIL 判定词），原文：") +
    "<br>" + String(text || "").replace(/\n/g, "<br>").slice(0, 2000);
  addLog(exhausted ? "预检失败（补齐轮次用尽，阻断）" : "预检失败（无法判定，阻断）");
'@ @'
  document.getElementById("precheckBlocked").innerHTML =
    (exhausted
      ? "⛔ 工程预检未通过（已自动补齐 " + PRECHECK_MAX_RETRIES + " 轮仍失败），阻断原因："
      : "⛔ 工程预检未通过：无法从模型输出判定结论，原文：") +
    "<br><span style='font-size:12px;opacity:.8;'>判定依据：" + judged.evidence + "</span>" +
    "<br>" + String(text || "").replace(/\n/g, "<br>").slice(0, 2000);
  addLog((exhausted ? "预检失败（补齐轮次用尽，阻断）｜" : "预检失败（无法判定，阻断）｜") + judged.evidence);
'@ 'P62c 阻断提示写出判定依据'


# P63 ── 预检四处调整（2026-10-01 用户定稿）
#   ① 只核对配置的两个路径是否存在，不再判断「多出来的实体是否预期」
#   ② ACIS 旧名属性（nantenna: 前缀）不做任何检查、不报告、不阻断
#   ③ 预检未通过不再阻断：补齐后（轮次用尽则直接）自动开启仿真
#   ④ 补齐轮次上限做成可配置（⑤ 新增输入框）
$new = Apply-Patch $new @'
            <span class="unit">Discrete Port（50Ω 固定）</span></div></div>
'@ @'
            <span class="unit">Discrete Port（50Ω 固定）</span></div></div>
          <div class="f-row"><label class="f-label" for="inpPrecheckRetries">预检补齐轮次</label><div class="f-control">
            <input type="number" id="inpPrecheckRetries" min="0" max="5" step="1" value="2" style="width:72px;" title="预检未通过时自动补齐所需条件的轮次上限；用尽后仍会自动开启仿真">
            <span class="unit">轮（用尽后仍自动开启仿真）</span></div></div>
'@ 'P63a ⑤ 新增「预检补齐轮次」'

$new = Apply-Patch $new @'
    portDir: document.getElementById("selPortDir").value,
'@ @'
    portDir: document.getElementById("selPortDir").value,
    precheckRounds: precheckMaxRetries(),
'@ 'P63b readConfig 带上补齐轮次'

$new = Apply-Patch $new @'
let precheckRetries = 0;        // 预检失败后已自动补齐的轮次
const PRECHECK_MAX_RETRIES = 2; // 补齐轮次上限，用尽仍失败才阻断
'@ @'
let precheckRetries = 0;              // 预检失败后已自动补齐的轮次
const PRECHECK_MAX_RETRIES_DEFAULT = 2;
/* 补齐轮次上限来自 ⑤ 的「预检补齐轮次」。越界或非法值回落默认值。
   注意：轮次用尽后**不再阻断**，而是照样开启仿真（见 judgePrecheck）。 */
function precheckMaxRetries() {
  const el = document.getElementById("inpPrecheckRetries");
  const n = el ? Number(el.value) : NaN;
  if (!Number.isFinite(n) || n < 0) return PRECHECK_MAX_RETRIES_DEFAULT;
  return Math.min(5, Math.round(n));
}
'@ 'P63c 补齐轮次改为可配置'

$new = Apply-Patch $new @'
\n- 馈电端口方向：" + cfg.portDir + "（Discrete Port 可沿 X/Y/Z）\n\n" +

'@ @'
\n- 馈电端口方向：" + cfg.portDir + "（Discrete Port 可沿 X/Y/Z）\n- 预检补齐轮次上限：" + precheckMaxRetries() + " 轮（用尽后仍自动开启仿真）\n\n" +

'@ 'P63d 任务指令写明补齐轮次'

$new = Apply-Patch $new @'
    "4) 天线/基板对象路径是否与工程树完全一致（不一致则 FAIL 并给出正确路径）；\n" +
    "5) 端口/边界/求解器/网格/监视器配置是否完整可解。\n\n" +
    "最终输出一行：PASS（可启动仿真）或 FAIL（并列出全部阻断原因）。";
'@ @'
    "4) 天线/基板这两个路径在工程树中是否存在——**只核对其存在**，不要判断工程树里是否还有其它实体；\n" +
    "5) 端口/边界/求解器/网格是否完整可解。\n\n" +
    "不在检查范围内（不要检查、不要报告、不要因此判 FAIL）：\n" +
    "- 工程树中除上述两个路径之外的其它实体（例如 component1/mainpcb）——一律不列为检查项或待确认项；\n" +
    "- ACIS 名称属性残留（例如 nantenna: 前缀的旧名）；\n" +
    "- 场监视器：可加可不加，缺失不算问题。\n\n" +
    "最终输出一行：PASS（可启动仿真）或 FAIL（并列出全部阻断原因）。\n" +
    "说明：**即使结论是 FAIL 也不会中止**——会先自动补齐所需条件，补齐轮次用尽后仍会自动开启仿真。" +
    "所以 FAIL 时请把「缺什么、怎么补」说清楚，而不是只给一个结论。";
'@ 'P63e 预检范围收窄并说明不中止'

$new = Apply-Patch $new @'
    addLog("工程预检通过 → 进入优化迭代");
    setRunState("running");
    sendToChat(buildInstruction(readConfig())).then(() => {
      toast("预检通过，优化迭代已启动（MCP 驱动）", "ok", 4200);
    }).catch((e) => toast("启动失败：" + e.message, "err"));
    return;
'@ @'
    addLog("工程预检通过 → 进入优化迭代");
    startOptimization("预检通过，优化迭代已启动（MCP 驱动）");
    return;
'@ 'P63f 通过路径改用统一的启动函数'

$new = Apply-Patch $new @'
  // 未通过 → 先自动补齐所需条件再重检，而不是立刻阻断
  if (verdict === "fail" && precheckRetries < PRECHECK_MAX_RETRIES) {
    precheckRetries += 1;
    document.getElementById("precheckBlocked").hidden = true;
    document.getElementById("precheckList").innerHTML =
      "<span style='color:var(--text-sub);font-size:12.5px;'>预检未通过，正在自动补齐所需条件（第 " +
      precheckRetries + "/" + PRECHECK_MAX_RETRIES + " 轮）…</span>";
    addLog("预检未通过 → 自动补齐（第 " + precheckRetries + "/" + PRECHECK_MAX_RETRIES + " 轮）");
    setRunState("prchecking");
    sendToChat(buildPrecheckRemediationInstruction(text))
      .catch((e) => toast("自动补齐指令发送失败：" + e.message, "err", 5000));
    return;
  }

  // 补齐轮次用尽，或根本读不出结论 → 阻断，并说明是哪一种
  setRunState("failed");
  const exhausted = verdict === "fail";
  precheckRetries = 0;
  document.getElementById("precheckBlocked").hidden = false;
  document.getElementById("precheckBlocked").innerHTML =
    (exhausted
      ? "⛔ 工程预检未通过（已自动补齐 " + PRECHECK_MAX_RETRIES + " 轮仍失败），阻断原因："
      : "⛔ 工程预检未通过：无法从模型输出判定结论，原文：") +
    "<br><span style='font-size:12px;opacity:.8;'>判定依据：" + judged.evidence + "</span>" +
    "<br>" + String(text || "").replace(/\n/g, "<br>").slice(0, 2000);
  addLog((exhausted ? "预检失败（补齐轮次用尽，阻断）｜" : "预检失败（无法判定，阻断）｜") + judged.evidence);
}
'@ @'
  // 未通过 → 先自动补齐所需条件（轮次上限可配），**不阻断**
  const maxRounds = precheckMaxRetries();
  if (verdict === "fail" && precheckRetries < maxRounds) {
    precheckRetries += 1;
    document.getElementById("precheckBlocked").hidden = true;
    document.getElementById("precheckList").innerHTML =
      "<span style='color:var(--text-sub);font-size:12.5px;'>预检未通过，正在自动补齐所需条件（第 " +
      precheckRetries + "/" + maxRounds + " 轮）…</span>";
    addLog("预检未通过 → 自动补齐（第 " + precheckRetries + "/" + maxRounds + " 轮）");
    setRunState("prchecking");
    sendToChat(buildPrecheckRemediationInstruction(text))
      .catch((e) => toast("自动补齐指令发送失败：" + e.message, "err", 5000));
    return;
  }

  // 轮次用尽（或读不出结论）：按要求**不阻断**——记一条可见的提示，然后照样开启仿真
  precheckRetries = 0;
  const note = document.getElementById("precheckBlocked");
  note.hidden = false;
  note.innerHTML =
    (verdict === "fail"
      ? "⚠️ 工程预检未通过（已自动补齐 " + maxRounds + " 轮）。<b>按要求仍继续开启仿真</b>，请留意前几轮结果："
      : "⚠️ 无法从预检输出判定结论。<b>按要求仍继续开启仿真</b>，原文：") +
    "<br><span style='font-size:12px;opacity:.8;'>判定依据：" + judged.evidence + "</span>" +
    "<br>" + String(text || "").replace(/\n/g, "<br>").slice(0, 2000);
  addLog(
    (verdict === "fail" ? "预检未通过（已补齐 " + maxRounds + " 轮）→ 仍然开启仿真｜" : "预检无法判定 → 仍然开启仿真｜") +
    judged.evidence);
  startOptimization(verdict === "fail" ? "预检未通过，已自动补齐并开启仿真" : "预检无法判定，仍按配置开启仿真");
}

/* 无论预检通过与否，最终都走这里开启优化迭代——轮次用尽时只是换一句提示，不再有「阻断」分支 */
function startOptimization(okMessage) {
  setRunState("running");
  sendToChat(buildInstruction(readConfig())).then(() => {
    toast(okMessage || "优化迭代已启动（MCP 驱动）", "ok", 4200);
  }).catch((e) => toast("启动失败：" + e.message, "err"));
}
'@ 'P63g 预检未通过不再阻断，补齐后照样开启仿真'

$new = Apply-Patch $new @'
  "inpMeshX", "inpMeshY", "inpMeshZ", "selPortDir", "txtCustomCommands",
'@ @'
  "inpMeshX", "inpMeshY", "inpMeshZ", "selPortDir", "inpPrecheckRetries", "txtCustomCommands",
'@ 'P63h 补齐轮次纳入配置记忆'

$new = Apply-Patch $new @'
   "selPortDir", "txtCustomCommands", "spCustomText"].forEach((id) => {
'@ @'
   "selPortDir", "inpPrecheckRetries", "txtCustomCommands", "spCustomText"].forEach((id) => {
'@ 'P63i 补齐轮次纳入输入监听'




# P65 ── 空输入要当「没填」而不是「0 轮」
#   Number("") === 0，直接拿来判会把「清空输入框」误解成「不补齐」。
#   清空（或只打空格）时应回落到默认值 2。
$new = Apply-Patch $new @'
function precheckMaxRetries() {
  const el = document.getElementById("inpPrecheckRetries");
  const n = el ? Number(el.value) : NaN;
  if (!Number.isFinite(n) || n < 0) return PRECHECK_MAX_RETRIES_DEFAULT;
  return Math.min(5, Math.round(n));
}
'@ @'
function precheckMaxRetries() {
  const el = document.getElementById("inpPrecheckRetries");
  // 空输入是「没填」，不是「0 轮」——Number("") 是 0，不先判空串就会把
  // 清空输入框误解成「不补齐」。
  const raw = el ? String(el.value).trim() : "";
  if (raw === "") return PRECHECK_MAX_RETRIES_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return PRECHECK_MAX_RETRIES_DEFAULT;
  return Math.min(5, Math.round(n));
}
'@ 'P65 空输入回落默认轮次'


# P66 ── 顶栏「迭代进度」语义纠错
#   原来 kIter 显示的是 evToolCount + " / " + inpMaxIter：
#     分子 = step/end 事件计数（对话步数，无上限）
#     分母 = 最大迭代次数（CST 优化上限）
#     标签 = 迭代进度
#   三个语义凑成一个假分数，25 / 5 这种显示就是这么来的。现在按真实来源拆成两个 KPI：
#     迭代进度 = 模型回传里的 round / 最大迭代次数（没有 round 就是 —）
#     对话轮次 = step/end 计数（不再给它配一个不属于它的分母）
#   同时把事件流表头那个叫「工具调用」的同源计数统一改称「对话轮次」——
#   同一个数字在页面上有两个名字，正是这次误读的根源。
$new = Apply-Patch $new @'
      <div class="kpi"><div class="k-label">迭代进度</div><div class="k-value" id="kIter">—</div></div>
'@ @'
      <div class="kpi"><div class="k-label">迭代进度</div><div class="k-value" id="kIter">—</div></div>
      <div class="kpi"><div class="k-label">对话轮次</div><div class="k-value" id="kDialog">0</div></div>
'@ 'P66a 顶栏新增「对话轮次」KPI'

$new = Apply-Patch $new @'
          <span class="pill">工具调用：<b id="evTools">0</b></span>
'@ @'
          <span class="pill">对话轮次：<b id="evTools">0</b></span>
'@ 'P66b 事件流表头与顶栏统一称呼'

$new = Apply-Patch $new @'
function updateKPI(iter) {
  if (typeof iter === "number") {
    const max = Number(document.getElementById("inpMaxIter").value) || 15;
    document.getElementById("kIter").textContent = iter + " / " + max;
  }
}
'@ @'
/* 顶栏这两个计数是两件事，别再挤进一个比值里。
   真实来源不同：迭代进度只认模型回传的 round，对话轮次只认 step/end 计数。 */
let lastRunRound = null;
function updateIterationKPI(round) {
  if (typeof round !== "number" || !isFinite(round)) return;
  lastRunRound = Math.max(lastRunRound === null ? round : lastRunRound, round);
  const max = Number(document.getElementById("inpMaxIter").value) || 15;
  document.getElementById("kIter").textContent = lastRunRound + " / " + max;
}
function updateDialogueKPI() {
  const el = document.getElementById("kDialog");
  if (el) el.textContent = String(evToolCount);
}
'@ 'P66c 拆成迭代进度与对话轮次两个更新函数'

$new = Apply-Patch $new @'
  } else if (event.type === "step/end") {
    evToolCount += 1;
    document.getElementById("evTools").textContent = evToolCount;
    updateKPI(evToolCount);
  }
'@ @'
  } else if (event.type === "step/end") {
    evToolCount += 1;
    document.getElementById("evTools").textContent = evToolCount;
    updateDialogueKPI();   // 只动「对话轮次」；迭代进度只认模型回传的 round
  }
'@ 'P66d step/end 只更新对话轮次'

$new = Apply-Patch $new @'
    routedSignatures[sig] = true;
    const ch = item.payload.channel;
'@ @'
    routedSignatures[sig] = true;
    const ch = item.payload.channel;
    // 数据回传里的 round 才是真实的优化轮次——顶栏「迭代进度」认这个数
    const _round = Number(item.payload.round);
    if (item.payload.round !== null && item.payload.round !== undefined && isFinite(_round)) {
      updateIterationKPI(_round);
    }
'@ 'P66e 迭代进度改用回传的 round'

$new = Apply-Patch $new @'
  document.getElementById("kIter").textContent = "—";
'@ @'
  lastRunRound = null;
  document.getElementById("kIter").textContent = "—";
  const _dlg = document.getElementById("kDialog");
  if (_dlg) _dlg.textContent = "0";
  document.getElementById("evTools").textContent = "0";
'@ 'P66f 重置时两个 KPI 一起复位'
# P67 ── 端口坐标系 / 对话输入发送 / 每轮最佳曲线（2026-10-01 用户三点要求）
#   ① 激励端口坐标系：模型经常把端口建在局部坐标系 local WCS(uvw) 上。原指令只写了
#      「馈电端口方向 X/Y/Z」，没有一个字说坐标系——补上硬约束，并让预检项 5 与
#      预检补齐轮都检查/整改它，形成「指令 → 预检 → 补齐」三处一致的约束。
#   ② 对话输入：输入框只有「发送」按钮，回车不发送（看起来像发了，其实只多了个空行）；
#      而「清空对话」会把 chatSession 丢掉、状态改成 idle —— 正在跑的迭代从此无从跟踪。
#      现在回车即发送（Shift+Enter 换行、输入法选字回车放行），发送走队列模式不打断任务，
#      运行中清空只清本地显示、不丢会话。
#   ③ 运行监控曲线：原来把采集到的全部 (f, dB) 点连成一条线，多轮多候选混在一起，
#      既不是任何一次仿真的结果，也看不出哪一轮最好。改成按轮次分桶、每轮每频点取最优，
#      一轮一条曲线，当前最佳轮次高亮。
$new = Apply-Patch $new @'
const PORT_NOTES = [
  "Discrete Port 的两个端点应分别落在信号导体和地平面的相同横向投影位置；",
  "端点不得落在空气、介质、侧壁或无关导体上；",
  "端口位置参与优化时，保持端口类型、参考定义与极性一致；调整后重新执行轻量预检查确认端口连接正常。",
];
'@ @'
const PORT_NOTES = [
  "Discrete Port 的两个端点应分别落在信号导体和地平面的相同横向投影位置；",
  "端点不得落在空气、介质、侧壁或无关导体上；",
  "【坐标系硬性要求】激励端口必须建在全局坐标系（Global WCS，xyz）下：端点坐标一律按全局 xyz 给出，禁止使用局部坐标系（Local WCS / uvw）；",
  "建立端口之前先确认当前坐标系是全局 WCS；若当前处于局部坐标系（local WCS / uvw），必须先切回 Global 再建端口；",
  "禁止把 uvw 下的数值直接当作 xyz 填入——即使两组数值相同也不允许；端口建好后必须回读端点坐标，确认取到的是全局 xyz；",
  "工程中已有端口若经回读确认位于局部坐标系，必须删除并按全局 xyz 重建后再求解，不得带着 uvw 端口做仿真或优化；回读不到坐标系时不要凭猜测删端口，如实说明即可；",
  "端口位置参与优化时，保持端口类型、参考定义与极性一致；调整后重新执行轻量预检查确认端口连接正常。",
];
'@ 'P67a 端口坐标系硬约束（全局 xyz，禁止 local WCS/uvw）'

$new = Apply-Patch $new @'
- 馈电端口方向：" + cfg.portDir + "（Discrete Port 可沿 X/Y/Z）\n- 预检补齐轮次上限：
'@ @'
- 馈电端口方向：" + cfg.portDir + "（Discrete Port 可沿 X/Y/Z）\n- 馈电端口坐标系：" + PORT_CS_RULE + "\n- 预检补齐轮次上限：
'@ 'P67b 任务指令 #6 写明端口坐标系'

$new = Apply-Patch $new @'
- 内激励端口：工程中若缺失或未连接，必须按第 6 节的馈电类型/阻抗/方向补齐后才可求解。\n\n" +
'@ @'
- 内激励端口：工程中若缺失或未连接，必须按第 6 节的馈电类型/阻抗/方向补齐后才可求解。\n- 端口坐标系：必须为全局坐标系 xyz。发现端口建在局部坐标系（local WCS / uvw）上时，必须删除并按全局 xyz 重建；不得只改标注不改坐标，也不得带着 uvw 端口求解。\n\n" +
'@ 'P67c 刚性约束锁定端口坐标系'

$new = Apply-Patch $new @'
    "5) 端口/边界/求解器/网格是否完整可解。\n\n" +
'@ @'
    "5) 端口/边界/求解器/网格是否完整可解，且激励端口建立在全局坐标系 xyz 下（不是局部 WCS/uvw）。本项判定必须有证据：用可用手段（端口列表 / VBA 查询）回读端点坐标或端口所属坐标系；**只有拿到证据表明端口取自局部坐标系时才判 FAIL**，并在结论里写明「端口位于局部坐标系（uvw）」；回读不到时写「端口坐标系未能核对（缺少回读手段）」，既不凭猜测判 PASS，也不凭猜测判 FAIL。\n\n" +
'@ 'P67d 预检项 5 增加端口坐标系检查（有证据才判 FAIL）'

$new = Apply-Patch $new @'
    "；补齐后确认端口连接正常；\n" +
'@ @'
    "；补齐后确认端口连接正常；端口必须在全局坐标系 xyz 下建立——已确认端口落在局部坐标系（local WCS / uvw）时，删除并按全局 xyz 重建，重建后回读端点坐标确认一致；只是无法回读坐标系时不要删端口，如实说明即可；\n" +
'@ 'P67e 预检补齐轮整改端口坐标系（仅在有证据时重建）'

$new = Apply-Patch $new @'
        <h2>对话输入 <span class="tag">同会话内继续</span></h2>
'@ @'
        <h2>对话输入 <span class="tag">同会话内继续 · Enter 发送 / Shift+Enter 换行</span></h2>
'@ 'P67f 输入框标题写明快捷键'

$new = Apply-Patch $new @'
          <button class="btn primary" id="btnChatSend" style="align-self:stretch;">发送</button>
        </div>
'@ @'
          <button class="btn primary" id="btnChatSend" style="align-self:stretch;">发送</button>
        </div>
        <div style="margin-top:8px;font-size:12.5px;color:var(--text-sub);">发送采用队列模式：内容会追加给大模型，不会打断正在运行的预检或迭代。</div>
'@ 'P67g 输入框下方说明：发送不打断任务'

$new = Apply-Patch $new @'
async function sendChatMessageManually() {
  const text = document.getElementById("chatInput").value.trim();
  if (!text) { toast("输入框为空", "warn"); return; }
  if (!isDSHSameOrigin()) { await copyToClipboard(text); toast("本地模式已复制，请改用同源地址发送", "warn", 6000); return; }
  try {
    await ensureChatSession();
    if (runState === "idle") setRunState("running");
    await sendToChat(text);
    document.getElementById("chatInput").value = "";
    toast("已发送，对话窗口实时显示输出", "ok");
  } catch (e) { toast("发送失败：" + e.message, "err"); }
}
'@ @'
async function sendChatMessageManually() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) { toast("输入框为空", "warn"); return; }
  if (!isDSHSameOrigin()) { await copyToClipboard(text); toast("本地模式已复制，请改用同源地址发送", "warn", 6000); return; }
  const wasActive = isRunActive();
  try {
    await ensureChatSession();
    // sendToChat 用 mode:"queue"：这条消息只是**追加**到会话队列，
    // 不会打断当前这一步（"steer" 才是插话打断）。发送失败时输入框内容保留。
    await sendToChat(text);
    input.value = "";
    if (wasActive) {
      addLog("已手动发送补充指令（队列模式，不打断当前任务）");
      toast("已排队发送，当前任务继续运行", "ok", 3600);
    } else {
      setRunState("running");
      toast("已发送，对话窗口实时显示输出", "ok");
    }
  } catch (e) { toast("发送失败：" + e.message + "（内容已保留在输入框）", "err", 5200); }
}
'@ 'P67h 手动发送：排队不打断、失败不清空'

$new = Apply-Patch $new @'
  document.getElementById("btnClearChat").addEventListener("click", () => {
    disconnectChatSocket(); stopChatPolling();
    chatSession = null; chatLastSeq = 0;
    document.getElementById("chatView").innerHTML = "";
    document.getElementById("chatInput").value = "";
    setRunState("idle");
    toast("对话已清空（任务状态保留）", "info", 2200);
  });
'@ @'
  document.getElementById("btnClearChat").addEventListener("click", () => {
    const active = isRunActive();
    if (active && !confirm("任务 " + runId + " 仍在运行。清空只影响本地显示：任务继续跑，事件流继续跟踪。是否继续？")) return;
    document.getElementById("chatView").innerHTML = "";
    document.getElementById("chatInput").value = "";
    if (active) {
      /* 运行中绝不能把 chatSession 丢掉：丢了就再也收不到这个会话的事件，
         面板会显示成「未启动」，正在跑的任务从此无从跟踪（旧版就是这样打断进程的）。 */
      toast("已清空本地显示；任务继续运行，事件流仍在跟踪", "info", 3000);
      return;
    }
    disconnectChatSocket(); stopChatPolling();
    chatSession = null; chatLastSeq = 0;
    setRunState("idle");
    toast("对话已清空", "info", 2200);
  });
'@ 'P67i 运行中清空对话不再丢会话、不再假装任务结束'

$new = Apply-Patch $new @'
  document.getElementById("btnChatSend").addEventListener("click", sendChatMessageManually);
'@ @'
  document.getElementById("btnChatSend").addEventListener("click", sendChatMessageManually);
  /* 回车即发送（Shift+Enter 换行）。以前只有「发送」按钮：输入完按回车只会在框里
     多一个空行，看着像发出去了，其实什么都没发。
     中文输入法选词的回车必须放行（isComposing / keyCode 229），否则选字就被当成发送。 */
  document.getElementById("chatInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.shiftKey) return;
    e.preventDefault();
    sendChatMessageManually();
  });
'@ 'P67j 输入框 Enter 发送、Shift+Enter 换行'

$new = Apply-Patch $new @'
function setRunState(s) {
  runState = s;
'@ @'
/* 「任务在跑」的判定集中在这里：运行状态机新增取值时只需改这一处。
   runState 里既有「运行中」也有「运行中但暂停/恢复」，它们都属于「不能丢会话」的区间。 */
const RUN_ACTIVE_STATES = ["prchecking", "running", "paused", "resuming", "recovering"];
function isRunActive() { return RUN_ACTIVE_STATES.indexOf(runState) >= 0; }
function setRunState(s) {
  runState = s;
'@ 'P67k 运行中状态判定集中一处'

$new = Apply-Patch $new @'
let chartData = [];          // [{f: GHz, db: dB}]
'@ @'
let chartData = [];          // [{f: GHz, db: dB, round: 轮次}]：全量采集点，结果汇总表用
/* 曲线不画全量点。直接连全量点会把不同轮次、不同候选的参数混成一条线——那既不是
   任何一次仿真的结果，也让「哪一轮最好」在图上完全看不出来。曲线一律先按轮次分桶、
   每轮每频点取最优，得到「该轮最佳工程」的一条曲线（见 chartRoundTraces）。 */
'@ 'P67l 采集点带轮次'

$new = Apply-Patch $new @'
      chartData.push({ f: lastF, db: r.db });
'@ @'
      // 同一条消息里若带 round，routeBlockDataFromText 已先更新 lastRunRound，
      // 这些点就落到本轮；一次都没回传过轮次时记为第 0 轮（基线）
      chartData.push({ f: lastF, db: r.db, round: lastRunRound === null ? 0 : lastRunRound });
'@ 'P67m 频点归属轮次'

$new = Apply-Patch $new @'
  const pts = chartData.slice().sort((a, b) => a.f - b.f);
  const N = 60;
  const sampled = [];
  if (pts.length) {
    const minF = pts[0].f, maxF = pts[pts.length - 1].f;
    const span = Math.max(0.001, maxF - minF);
    for (let i = 0; i < N; i++) {
      const tf = minF + (i / (N - 1)) * span;
      const near = pts.filter((p) => Math.abs(p.f - tf) <= span / (N * 2));
      const val = near.length ? Math.max(...near.map((p) => p.db)) : null;
      if (val !== null) sampled.push({ f: tf, db: val });
    }
  }
'@ @'
  // 每轮一条曲线：该轮的最优包络（同频点取最小值 = 该频点上最好的一次）
  const traces = chartRoundTraces();
  const bestTrace = chartBestRound(traces);
  const N = 60;
  function sampleTrace(ptsIn) {
    const minF = ptsIn[0].f, maxF = ptsIn[ptsIn.length - 1].f;
    const span = Math.max(0.001, maxF - minF);
    const out = [];
    for (let i = 0; i < N; i++) {
      const tf = minF + (i / (N - 1)) * span;
      const near = ptsIn.filter((p) => Math.abs(p.f - tf) <= span / (N * 2));
      // 取窗口内最小值：保留陷波形状（取最大值会把谷抹平，看着像没优化）
      if (near.length) out.push({ f: tf, db: Math.min(...near.map((p) => p.db)) });
    }
    return out;
  }
'@ 'P67n 曲线改为按轮次分桶采样'

$new = Apply-Patch $new @'
    // 曲线
    (sampled.length > 1 ? '<polyline points="' + sampled.map((p) => X(p.f).toFixed(1) + "," + Y(p.db).toFixed(1)).join(" ") + '" fill="none" stroke="#1f5fbf" stroke-width="2" stroke-linejoin="round"/>' : "") +
    // 数据点
    pts.map((p) => '<circle cx="' + X(p.f).toFixed(1) + '" cy="' + Y(p.db).toFixed(1) + '" r="2.4" fill="#d64545"/>').join("") +
'@ @'
    // 曲线：每轮一条；当前最佳轮次最后画（压在最上层并加粗）
    traces.filter((t) => bestTrace === null || t.round !== bestTrace.round).concat(bestTrace ? [bestTrace] : []).map((t) => {
      const sp = sampleTrace(t.pts);
      if (sp.length < 2) return "";
      const isBest = bestTrace !== null && t.round === bestTrace.round;
      const isLast = t.round === traces[traces.length - 1].round;
      const stroke = isBest ? "#1a8f5a" : (isLast ? "#1f5fbf" : "#7b93b5");
      const w = isBest ? 2.8 : (isLast ? 2 : 1.4);
      return '<polyline points="' + sp.map((p) => X(p.f).toFixed(1) + "," + Y(p.db).toFixed(1)).join(" ") +
        '" fill="none" stroke="' + stroke + '" stroke-width="' + w + '" stroke-linejoin="round"/>';
    }).join("") +
    // 数据点：只标最佳轮次的实际采集点，多轮点位叠在一起只会糊成一片
    (bestTrace ? bestTrace.pts.map((p) => '<circle cx="' + X(p.f).toFixed(1) + '" cy="' + Y(p.db).toFixed(1) + '" r="2.2" fill="#d64545"/>').join("") : "") +
'@ 'P67o 画每轮最佳曲线并高亮最优轮次'

$new = Apply-Patch $new @'
    '<div class="chart-note">● 数据点（启发式采集）　━ 最优拟合线　┄ 阈值线　▒ 频段区间；黄色为阈值</div>';
'@ @'
    '<div class="chart-note">' +
    (bestTrace ? '★ 当前最佳：第 ' + bestTrace.round + ' 轮（最差频点 ' + bestTrace.worst.toFixed(1) + ' dB）　' : "") +
    (traces.length ? '共 ' + traces.length + ' 轮曲线（每轮取该轮最优）　● 最佳轮次采集点　' : "暂无曲线数据（等待带轮次的结果回传）　") +
    '┄ 阈值线　▒ 频段区间　黄色虚线为阈值</div>';
'@ 'P67p 曲线图例标明当前最佳轮次'

$new = Apply-Patch $new @'
  box.innerHTML = svg;
}
function gridLines() {
'@ @'
  box.innerHTML = svg;
}
/* 按轮次分桶：同轮同频点（0.01 GHz 栅格）只留最小值——dB 越小越好，
   于是每轮得到一条「该轮最佳工程」的包络曲线。
   轮次打分用该轮包络上的最大值（最差频点值），它越小说明整段越好。 */
function chartRoundTraces() {
  const buckets = new Map();
  chartData.forEach((p) => {
    const r = (typeof p.round === "number" && isFinite(p.round)) ? p.round : 0;
    let m = buckets.get(r);
    if (!m) { m = new Map(); buckets.set(r, m); }
    const key = Math.round(p.f * 100);
    const prev = m.get(key);
    if (prev === undefined || p.db < prev) m.set(key, p.db);
  });
  const traces = [];
  buckets.forEach((m, r) => {
    const pts = Array.from(m.entries()).map(([k, db]) => ({ f: k / 100, db })).sort((a, b) => a.f - b.f);
    if (!pts.length) return;
    traces.push({ round: r, pts: pts, worst: Math.max(...pts.map((p) => p.db)), best: Math.min(...pts.map((p) => p.db)) });
  });
  traces.sort((a, b) => a.round - b.round);
  return traces;
}
/* 取最差频点值最小的那一轮；并列时取更靠后的一轮（同样结果下新的更可信） */
function chartBestRound(traces) {
  let best = null;
  traces.forEach((t) => { if (best === null || t.worst <= best.worst) best = t; });
  return best;
}
function gridLines() {
'@ 'P67q 新增 chartRoundTraces / chartBestRound'

$new = Apply-Patch $new @'
    updateS11FromText(text);
    collectFreqDbFromText(text);   // 运行监控：采集 频率–S11 数据点
    routeBlockDataFromText(text);  // 自定义区块：回传结构化数据
'@ @'
    updateS11FromText(text);
    // 先路由数据回传（round 在里面 → 更新 lastRunRound），再采集频点：
    // 这样同一条消息里的频率–S11 点会落到本轮，而不是落到上一轮
    routeBlockDataFromText(text);  // 自定义区块：回传结构化数据
    collectFreqDbFromText(text);   // 运行监控：采集 频率–S11 数据点（按轮次分桶）
'@ 'P67r 先更新轮次再采集频点'

$new = Apply-Patch $new @'
  tbody.innerHTML = html + '<tr><td colspan="6" class="empty-row" style="color:var(--text-sub);text-align:left;">启发式采集数据点：' + chartData.length + " 个 · 已含 " + iterations + " 步工具调用（最终以结果导出为准）</td></tr>";
'@ @'
  const _traces = chartRoundTraces();
  const _best = chartBestRound(_traces);
  tbody.innerHTML = html + '<tr><td colspan="6" class="empty-row" style="color:var(--text-sub);text-align:left;">启发式采集数据点：' + chartData.length + " 个 · 已含 " + iterations + " 步工具调用" +
    (_best ? " · 共 " + _traces.length + " 轮，当前最佳为第 " + _best.round + " 轮（最差频点 " + _best.worst.toFixed(1) + " dB）" : "") +
    "（上表按全部采集点汇总，曲线按每轮最优绘制。最终以结果导出为准）</td></tr>";
'@ 'P67s 汇总表页脚标出当前最佳轮次'

$new = Apply-Patch $new @'
/* S11 曲线：SVG 折线 + 频段区间带 + 阈值线 + 数据点 */
'@ @'
const PORT_CS_RULE = "全局坐标系（Global WCS，xyz）——禁止局部坐标系 local WCS(uvw)";
/* S11 曲线：SVG 折线 + 频段区间带 + 阈值线 + 数据点 */
'@ 'P67t 端口坐标系口径常量（指令与界面同一句话）'

# P68a ── 天线仿真固定约束（FC1 / FC2）：指令、预检、补齐轮共用的唯一文案来源
#   这两条是用户定死的约束，此前只以零散措辞混在「# 7 刚性约束」的一般条目里，
#   也没有「每一轮都要自检」的要求，模型读完就忘也没人拦得住。
#   改这里必须同步改 docs/constraints/ 下的文档（见 AGENTS.md 的改动映射表）。
$new = Apply-Patch $new @'
  forbiddenModifications: ["边界条件", "全局激励源", "全局求解器类型", "全局网格划分策略"],
};
'@ @'
  forbiddenModifications: ["边界条件", "全局激励源", "全局求解器类型", "全局网格划分策略"],
};

/* ============================================================
   天线仿真固定约束（Fixed Constraints，FC1 / FC2）
   —— 每一轮 CST 仿真都必须严格执行；任一轮违反即该轮结果无效。

   这里是**唯一的文案来源**：任务指令 7.2 节、工程预检、预检补齐轮三处都从
   这里取（端口坐标系那条 PORT_CS_RULE 用的是同一手法，别再多写一份）。

   文档：docs/constraints/ ；形状由 test/test-constraints.cjs 锁住。
   ============================================================ */
const ANTENNA_THICKNESS_MM = "0.035";
const FC1_TITLE = "FC1 只改形状、不改平面";
const FC2_TITLE = "FC2 只改天线与馈电点、不动其它 Component";
/* 固定约束管的是几何与写入范围，所以只进指令、不做成配置项：
   用户能改的约束就不是固定约束。 */
function fixedConstraintLines(cfg) {
  return [
    "- 【" + FC1_TITLE + "】只允许修改「① 工程配置 · 天线对象路径」（" + cfg.antennaPath + "）下天线 antenna 的**形状**，不得改变天线所在的平面（高度方向的位置与法向都不许变）：",
    "  · 天线厚度固定为 " + ANTENNA_THICKNESS_MM + " mm，厚度所在方向就是高度方向；厚度不得增减，也不得把天线改成非平面体。",
    "  · 天线必须坐落于「基板对象路径」（" + cfg.substratePath + "）中 substrate 的上表面或下表面之一；同一次任务内一旦选定某个面，就不得在两个面之间跳变。",
    "  · 天线必须位于与激励端口 port **平行且同一高度**的平面内：端口所在的高度平面与天线所在的高度平面是同一个平面。",
    "  · 形状变化只发生在该平面内（二维轮廓变化；改成 PIFA 等其它平面形式同样只改轮廓）。任何跨出该平面的改动都不算「修改形状」。",
    "- 【" + FC2_TITLE + "】每一轮的写入白名单只有两项：① 修改天线 antenna 的形状；② 移动馈电点位置（含随馈电点在天线平面内一起移动的馈线 / 枝节）。",
    "  · 不得修改、不得删除、不得重命名工程内任何其它 Component、实体、材料、端口或求解设置；白名单之外的一切写入都视为违反。",
    "  · 不得用「新建 Component / 新建实体再删掉旧的」绕过：天线必须始终留在原天线对象路径（" + cfg.antennaPath + "）下。",
    "  · 本约束在**每一轮** CST 仿真中严格执行——基线轮、每一轮迭代、预检补齐轮都算在内；任一轮违反即该轮结果无效。",
    "- 每轮自检（必须做，而且必须写进本轮汇报）：每次 rebuild 之后逐项核对 FC1 / FC2，输出 `FC1: PASS|FAIL`、`FC2: PASS|FAIL`，并给出证据——天线所在平面的坐标与法向、实测厚度、坐落表面（上 / 下）、端口所在平面、本轮改动过的对象清单。任一项 FAIL 时该轮不得计入候选，必须回退到上一个合规状态后重做。",
  ].join("\n");
}
'@ 'P68a 天线仿真固定约束常量（FC1 / FC2 唯一文案来源）'

# P68b ── 天线厚度锁成固定约束（FC1）：表单只读，值恒为 0.035 mm
$new = Apply-Patch $new @'
<label class="f-label" for="inpThickness">天线厚度</label><div class="f-control"><input type="number" id="inpThickness" min="0.001" step="0.005" value="0.035" style="width:110px;"><span class="unit">mm</span></div>
'@ @'
<label class="f-label" for="inpThickness">天线厚度</label><div class="f-control"><input type="number" id="inpThickness" min="0.001" step="0.005" value="0.035" style="width:110px;" readonly aria-readonly="true" title="固定约束 FC1：天线厚度恒为 0.035 mm（厚度方向即高度方向），不可更改"><span class="unit">mm（固定约束，不可更改）</span></div>
'@ 'P68b 天线厚度只读（固定约束 FC1）'

# P68c ── 固定约束字段清单（目前只有天线厚度）
$new = Apply-Patch $new @'
  "spIsolation", "spIsoMax", "spCustom", "spCustomText"];
'@ @'
  "spIsolation", "spIsoMax", "spCustom", "spCustomText"];
/* 固定约束字段（FC1 天线厚度）不从存档恢复：老存档里若存过别的值，恢复它就会把
   只读的固定约束推翻，让面板配置与约束互相矛盾。键仍照常保存，便于排查。 */
const STATE_FIXED_IDS = ["inpThickness"];
'@ 'P68c 固定约束字段清单'

# P68d ── 恢复配置时跳过固定约束字段
$new = Apply-Patch $new @'
      const val = p.fields[id];
      if (el.type === "checkbox") el.checked = !!val;
'@ @'
      if (STATE_FIXED_IDS.indexOf(id) >= 0) return;
      const val = p.fields[id];
      if (el.type === "checkbox") el.checked = !!val;
'@ 'P68d 恢复配置时跳过固定约束字段'

# P68e ── readConfig 的厚度取固定约束常量，不再读表单
$new = Apply-Patch $new @'
    thickness: document.getElementById("inpThickness").value || "0.035",
'@ @'
    thickness: ANTENNA_THICKNESS_MM,   // FC1：厚度是固定约束，不读表单（表单已只读）
'@ 'P68e 厚度取固定约束常量'

# P68f ── 指令 # 6：厚度标注为固定约束
$new = Apply-Patch $new @'
- 天线厚度：" + cfg.thickness + " mm\n- 天线材料："
'@ @'
- 天线厚度：" + cfg.thickness + " mm（固定约束 FC1，不可更改）\n- 天线材料："
'@ 'P68f 指令 # 6 标注厚度为固定约束'

# P68g ── 指令 # 7 拆成 7.1 通用刚性约束 / 7.2 天线仿真固定约束
$new = Apply-Patch $new @'
"# 7. 刚性约束（操作权限与固定配置，不得违反）\n- 天线对象路径：" + cfg.antennaPath
'@ @'
"# 7. 刚性约束（操作权限与固定配置，不得违反）\n## 7.1 通用刚性约束\n- 天线对象路径：" + cfg.antennaPath
'@ 'P68g 指令 # 7 拆出 7.1 通用刚性约束'

$new = Apply-Patch $new @'
不得带着 uvw 端口求解。\n\n" +
'@ @'
不得带着 uvw 端口求解。\n\n## 7.2 天线仿真固定约束（FC1 / FC2 —— 每一轮 CST 仿真都必须严格执行，违反即该轮结果无效）\n" + fixedConstraintLines(cfg) + "\n\n" +
'@ 'P68h 指令 7.2 天线仿真固定约束（逐轮强制）'

# P68i ── 指令 # 9：设计自由度以 7.2 为界（白名单口径与 7.2 一致）
$new = Apply-Patch $new @'
- 设计自由度：以源工程既有参数为基准，可调天线几何参数（辐射体尺寸、馈电位置、枝节长度等）；不得改动第 7 节刚性约束所列对象。
'@ @'
- 设计自由度：以 7.2 的天线仿真固定约束为界——只允许改天线 antenna 的形状与馈电点位置（辐射体尺寸、枝节长度、开槽等平面内轮廓变化）；天线所在平面、厚度、以及其它对象一律不动。白名单之外没有「顺手一起改」这回事。
'@ 'P68i 指令 # 9 设计自由度以 7.2 为界'

# P68j ── 指令 # 10：把固定约束自检写进每一轮的固定动作
$new = Apply-Patch $new @'
2) 每轮：写参数→rebuild→轻量预检查（端口连接、材料/边界完整、无致命 CAD/网格错误）→保存→求解→读取结果；
'@ @'
2) 每轮：写参数→rebuild→7.2 固定约束自检（FC1 / FC2，结论必须写进本轮汇报）→轻量预检查（端口连接、材料/边界完整、无致命 CAD/网格错误）→保存→求解→读取结果（FC 自检 FAIL 的轮次不得进入第 3 节判定、不得计入候选，必须回退到上一个合规状态）；
'@ 'P68j 指令 # 10 每轮固定约束自检'

# P68k ── 预检指令：固定约束全程有效（预检只读，但结论与补齐都不得越界）
$new = Apply-Patch $new @'
    "检查项（每项输出 PASS 或 FAIL）：\n" +
'@ @'
    "- 固定约束（7.2 节 FC1 / FC2）在本任务全程有效：预检本身只读，但结论与后续补齐都不得越出该约束范围——只动天线形状与馈电点，不动其它 Component。\n\n" +
    "检查项（每项输出 PASS 或 FAIL）：\n" +
'@ 'P68k 预检指令：固定约束全程有效'

# P68l ── 预检补齐轮：同样受固定约束约束（这一轮是允许写入的，最容易被忽略）
$new = Apply-Patch $new @'
    "仍然禁止：修改源工程、" + FIXED_CONFIG.forbiddenModifications.join("、") + "。\n" +
'@ @'
    "固定约束（7.2 节 FC1 / FC2）在本轮同样有效：只允许改天线形状与馈电点位置，不得修改或删除其它 Component。\n" +
    "仍然禁止：修改源工程、" + FIXED_CONFIG.forbiddenModifications.join("、") + "。\n" +
'@ 'P68l 预检补齐轮：固定约束同样有效'

# P69a ── 每轮覆盖工作副本的口径（一条常量、三处引用，同 PORT_CS_RULE 的手法）
#   用户实测：迭代中覆盖旧工程时 CST 弹出「删除旧结果」确认框，必须人工点掉，
#   无人值守的迭代跑不下去。根因在 CST-MCP：save_project 只删了 .cst、留下非空的
#   伴随目录（Model/ + Result/），CST 便以「工程目录已存在且非空」拒绝保存。
#   那边已改为「先关闭占用该路径的工程 + CST 原生 allow_overwrite=True」。
#   这里固定使用口径，免得模型自己去做文件手术又踩回同一个坑。
$new = Apply-Patch $new @'
const PORT_CS_RULE = "全局坐标系（Global WCS，xyz）——禁止局部坐标系 local WCS(uvw)";
'@ @'
const PORT_CS_RULE = "全局坐标系（Global WCS，xyz）——禁止局部坐标系 local WCS(uvw)";
/* 覆盖工作副本的口径。改这句要同步改 CST-MCP 的 save_project 与 docs/panel/sections.md。 */
const SAVE_OVERWRITE_RULE = "覆盖已存在的工程路径必须带 {\"overwrite\": true}：cst_save_project_tool 会先关闭仍占用该路径的工程，再由 CST 覆盖 .cst 与其 Result/ 目录；不得自行删除工程文件，也不得依赖任何 CST 交互式确认框";
'@ 'P69a 覆盖口径常量'

# P69b ── 指令 7.1：把覆盖口径列进通用刚性约束
$new = Apply-Patch $new @'
不得带着 uvw 端口求解。\n\n## 7.2
'@ @'
不得带着 uvw 端口求解。\n- 工程覆盖：" + SAVE_OVERWRITE_RULE + "。\n\n## 7.2
'@ 'P69b 指令 7.1 加入覆盖口径'

# P69c ── 指令 # 10：每一轮的保存动作写明覆盖方式
$new = Apply-Patch $new @'
→保存→求解→读取结果（FC 自检 FAIL 的轮次不得进入第 3 节判定、不得计入候选，必须回退到上一个合规状态）；
'@ @'
→保存（覆盖已存在的路径必须带 {\"overwrite\": true}，见 7.1）→求解→读取结果（FC 自检 FAIL 的轮次不得进入第 3 节判定、不得计入候选，必须回退到上一个合规状态）；
'@ 'P69c 指令 # 10 写明覆盖方式'

# P69d ── 预检补齐轮：这一轮会回写工作副本，覆盖口径同样适用
$new = Apply-Patch $new @'
    "固定约束（7.2 节 FC1 / FC2）在本轮同样有效：只允许改天线形状与馈电点位置，不得修改或删除其它 Component。\n" +
'@ @'
    "工程覆盖：" + SAVE_OVERWRITE_RULE + "。\n" +
    "固定约束（7.2 节 FC1 / FC2）在本轮同样有效：只允许改天线形状与馈电点位置，不得修改或删除其它 Component。\n" +
'@ 'P69d 预检补齐轮同样适用覆盖口径'

Write-Output "已应用 $($script:patches.Count) 处补丁"

# --- 5. 反向还原校验 ---
$scriptOld = $htmlRaw.Substring($htmlRaw.IndexOf("<script>"))
$scriptNew = $new.Substring($new.IndexOf("<script>"))
# 必须倒序还原：多个补丁可能插在同一锚点前，正序还原会因中间被插入而匹配不到
$reverted = $scriptNew
for ($pi = $script:patches.Count - 1; $pi -ge 0; $pi--) {
  $p = $script:patches[$pi]
  if ($reverted.Contains($p.New)) { $reverted = $reverted.Replace($p.New, $p.Old) }
}
function Get-Sha([string]$text) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  return [BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text))) -replace '-',''
}
if ((Get-Sha $scriptOld) -ne (Get-Sha $reverted)) { throw "脚本存在补丁之外的意外改动" }
Write-Output "反向还原校验: 通过 OK"

# --- 6. id / class 钩子校验 ---
$expId = 0; $expCls = 0
foreach ($p in $script:patches) {
  $expId  += (Count-Pat $p.New 'id="')    - (Count-Pat $p.Old 'id="')
  $expCls += (Count-Pat $p.New 'class="') - (Count-Pat $p.Old 'class="')
}
$idOld = Count-Pat $htmlRaw 'id="'; $idNew = Count-Pat $new 'id="'
$clsOld = Count-Pat $htmlRaw 'class="'; $clsNew = Count-Pat $new 'class="'
if ($idNew  -ne $idOld  + $expId)  { throw "id 数量异常：原 $idOld → 新 $idNew（预期 +$expId）" }
if ($clsNew -ne $clsOld + $expCls) { throw "class 数量异常：原 $clsOld → 新 $clsNew（预期 +$expCls）" }
$origIds = [regex]::Matches($htmlRaw, 'id="([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$gone = @($origIds | Where-Object { $new -notmatch ('id="' + [regex]::Escape($_) + '"') -and $_ -notin $script:retiredIds })
if ($gone.Count -gt 0) { throw ("原有 id 丢失: " + ($gone -join ', ')) }
# 反向校验：登记为「已退役」的 id 不得在产物中复活，否则退役清单与实际不符
$revived = @($script:retiredIds | Where-Object { $new -match ('id="' + [regex]::Escape($_) + '"') })
if ($revived.Count -gt 0) { throw ("已退役 id 不应出现在产物中: " + ($revived -join ', ')) }
Write-Output "钩子校验: id $idOld→$idNew，class $clsOld→$clsNew，原有 $($origIds.Count) 个 id 保留 $($origIds.Count - $script:retiredIds.Count) 个、显式退役 $($script:retiredIds.Count) 个（$(($script:retiredIds) -join ', ')） OK"

# --- 7. 结构断言 ---
$fail = @()
foreach ($pair in @(@('<style>','</style>'), @('<body>','</body>'), @('<script>','</script>'))) {
  $o = Count-Pat $new $pair[0]; $c = Count-Pat $new $pair[1]
  if ($o -ne 1) { $fail += "$($pair[0]) 出现 $o 次（应为 1）" }
  if ($c -ne 1) { $fail += "$($pair[1]) 出现 $c 次（应为 1）" }
}
if ($new.IndexOf('</style>') -gt $new.IndexOf('</head>')) { $fail += "</style> 位于 </head> 之后" }
if ($fail.Count -gt 0) { throw ("结构断言失败: " + ($fail -join '; ')) }
Write-Output "结构断言: 标签配对通过 OK"

# --- 8. 自定义属性完整性 ---
$need = @('--bg','--border','--err','--err-bg','--mono','--ok','--ok-bg','--primary',
          '--primary-dark','--primary-light','--radius','--surface','--surface-2',
          '--text','--text-sub','--warn','--warn-bg')
$missing = @($need | Where-Object { $css -notmatch [regex]::Escape($_ + ":") })
if ($missing.Count -gt 0) { throw ("自定义属性缺失: " + ($missing -join ', ')) }
Write-Output "自定义属性: 全部定义 OK"

# --- 9. WCAG 对比度门禁 ---
$darkAt = $css.IndexOf("@media (prefers-color-scheme: dark)")
if ($darkAt -lt 0) { throw "未找到深色主题媒体查询" }
$lightCss = $css.Substring(0, $darkAt); $darkCss = $css.Substring($darkAt)
function Get-Tok([string]$txt, [string]$n) {
  if ($txt -match ("(?m)^\s*" + [regex]::Escape($n) + "\s*:\s*(#[0-9a-fA-F]{6})\b")) { return $Matches[1] }
  return $null
}
function Lin([double]$c) { $s = $c / 255.0; if ($s -le 0.03928) { return $s / 12.92 } return [Math]::Pow(($s + 0.055) / 1.055, 2.4) }
function Lum([string]$hex) {
  return 0.2126 * (Lin ([Convert]::ToInt32($hex.Substring(1,2),16))) `
       + 0.7152 * (Lin ([Convert]::ToInt32($hex.Substring(3,2),16))) `
       + 0.0722 * (Lin ([Convert]::ToInt32($hex.Substring(5,2),16)))
}
function Ratio([string]$a, [string]$b) {
  $la = Lum $a; $lb = Lum $b
  if ($la -lt $lb) { $t = $la; $la = $lb; $lb = $t }
  return [Math]::Round(($la + 0.05) / ($lb + 0.05), 2)
}
$pairs = @(
  @('light','--control-border','--surface-2', 3.0), @('dark','--control-border','--surface-2', 3.0),
  @('light','--text-sub','--surface', 4.5),   @('light','--text-sub','--surface-2', 4.5),
  @('dark','--text-sub','--surface', 4.5),    @('dark','--text-sub','--surface-2', 4.5),
  @('light','--text-mute','--surface', 4.5),  @('light','--text-mute','--surface-2', 4.5),
  @('dark','--text-mute','--surface', 4.5),   @('dark','--text-mute','--surface-2', 4.5),
  @('light','--text','--surface', 4.5),       @('dark','--text','--surface', 4.5),
  @('light','--on-accent','--primary', 4.5),  @('dark','--on-accent','--primary', 4.5),
  @('light','--chart-label','--surface-2', 4.5), @('dark','--chart-label','--surface-2', 4.5),
  @('light','--chart-thr','--surface-2', 4.5),   @('dark','--chart-thr','--surface-2', 4.5),
  @('light','--err','--err-bg', 4.5),         @('dark','--err','--err-bg', 4.5),
  @('light','--warn','--warn-bg', 4.5),       @('dark','--warn','--warn-bg', 4.5),
  @('light','--ok','--ok-bg', 4.5),           @('dark','--ok','--ok-bg', 4.5)
)
$cfail = @()
foreach ($p in $pairs) {
  $src = if ($p[0] -eq 'light') { $lightCss } else { $darkCss }
  $fv = Get-Tok $src $p[1]; $bv = Get-Tok $src $p[2]
  if (-not $fv -or -not $bv) { $cfail += "$($p[0]) $($p[1])/$($p[2]) 未找到"; continue }
  $r = Ratio $fv $bv
  if ($r -lt $p[3]) { $cfail += "$($p[0]) $($p[1]) on $($p[2]) = ${r}:1 < $($p[3])" }
}
if ($cfail.Count -gt 0) { throw ("对比度门禁未通过: " + ($cfail -join '; ')) }
Write-Output "对比度门禁: $($pairs.Count) 组全部通过 OK"

# --- 10. 内联脚本语法门禁 ---
#   结构断言只查标签配对，查不出 JS 语法错误。2026-10-01 的一次补丁把指令字符串里的引号
#   写错（字符串提前闭合），浏览器里整个内联脚本不执行、页面成了空壳，而构建全绿、
#   前面各道门禁全部通过。这里用 node --check 把内联脚本过一遍；找不到 node 时明确标注未校验。
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
  Write-Output "内联脚本语法: 未找到 node —— 跳过，未校验"
} else {
  $sm = [regex]::Match($new, '(?s)<script>(.*?)</script>')
  if (-not $sm.Success) { throw "语法门禁: 产物里找不到内联 <script> 块" }
  $tmpJs = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-panel-syntax-" + [Guid]::NewGuid().ToString("N") + ".js")
  try {
    [System.IO.File]::WriteAllText($tmpJs, $sm.Groups[1].Value, (New-Object System.Text.UTF8Encoding($false)))
    $syntaxOut = & $nodeCmd.Source --check $tmpJs 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw ("内联脚本语法检查未通过（脚本不执行，页面会是空壳）：`n" + (($syntaxOut | Select-Object -First 12) -join "`n"))
    }
  } finally { Remove-Item -LiteralPath $tmpJs -Force -ErrorAction SilentlyContinue }
  Write-Output "内联脚本语法: node --check 通过 OK"
}

# --- 11. 写出 ---

$outDir = Split-Path $OutFile -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
[System.IO.File]::WriteAllText($OutFile, $new, $enc)
Write-Output ""
Write-Output "构建完成: $OutFile"
Write-Output "  大小: $((Get-Item $OutFile).Length) 字节"
Write-Output "  SHA256: $((Get-FileHash $OutFile -Algorithm SHA256).Hash)"

# --- 12. 同步一份到插件包（DSH 插件包需要页面随包分发） ---

$PluginPanel = Join-Path $RepoRoot "plugin\panel.html"
$pluginDir = Split-Path $PluginPanel -Parent
if (Test-Path $pluginDir) {
  Copy-Item -LiteralPath $OutFile -Destination $PluginPanel -Force
  Write-Output "已同步到插件包: plugin\panel.html ($((Get-Item $PluginPanel).Length) 字节)"
}
