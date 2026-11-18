/* ============================================================================
 *  run-bridge.js —— 运行桥接（由插件宿主注入面板，不参与面板构建）
 *
 *  职责（只做这四件，不碰仿真规则）：
 *    1  在「运行记录」上方放一条运行设置：MCP 包目录 + 审批策略（二选一）
 *    2  拦截「启动仿真」，改为调用宿主 POST /em-agent/run（headless）
 *    3  订阅 SSE 事件流，把消息 / 工具 / 阶段 / 错误渲染进「运行记录」
 *    4  取消按钮改为取消当前 run
 *
 *  事件映射以 dsh headless 的真实 JSONL 为准（2026-11-14 实测）：
 *    session{sessionId,cwd} · status{phase,turn} · thinking{text}
 *    tool_call{callId,tool,input} · tool_result{callId,status,result}
 *    text{text} · final{text}
 *
 *  与旧行为的关系：
 *    旧「启动仿真」把任务投进 DSH 会话，渲染发生在 DSH 的对话 surface。
 *    这里用 capture 阶段拦下并 stopImmediatePropagation，面板原处理器不再执行，
 *    因此不会出现「同一任务发两次」。若宿主未就绪（取不到 token），保持原行为。
 * ========================================================================== */
(function () {
  'use strict'

  var meta = document.querySelector('meta[name="dsh-em-agent-token"]')
  if (!meta) return // 未注入（例如独立打开文件）→ 保持面板原行为
  var TOKEN = meta.getAttribute('content') || ''
  if (!TOKEN) return

  var STORE_KEY = 'dsh-em-agent-run-v1'
  // 桌面端页面在 dsh-app:// 下，相对路径不可用；宿主会注入真实 origin。
  var originMetaEl = document.querySelector('meta[name="dsh-em-agent-origin"]')
  var PANEL_ORIGIN = originMetaEl ? (originMetaEl.getAttribute('content') || '') : ''
  var API = '/em-agent'

  /** 探测可用的 API 基址：同源相对路径优先，自定义协议/不透明源再退回注入的 origin。 */
  async function resolveApi() {
    var candidates = []
    if (location.protocol === 'http:' || location.protocol === 'https:') candidates.push('')
    if (PANEL_ORIGIN) candidates.push(PANEL_ORIGIN)
    if (candidates.length === 0) candidates.push('')
    for (var i = 0; i < candidates.length; i++) {
      var base = candidates[i] + '/em-agent'
      try {
        var probed = await fetch(base + '/settings', { headers: { 'x-em-token': TOKEN } })
        // 200 或 403 都说明路由存在（403 = token 未被接受，仍是同一宿主）
        if (probed.ok || probed.status === 403) { API = base; return base }
      } catch (e) { /* 换下一个候选 */ }
    }
    return API
  }

  var settings = { policy: 'danger-full-access' }

  function cacheSettings(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch (e) { /* 隐私模式等忽略 */ }
  }

  /** 以宿主文件为准；localStorage 只当离线缓存。
      桌面版端口每次启动都变，按 origin 存的键会失效，所以不能只靠它。 */
  async function loadSettings() {
    try {
      var raw = localStorage.getItem(STORE_KEY)
      if (raw) {
        var cached = JSON.parse(raw)
        if (cached && typeof cached === 'object') settings = Object.assign(settings, cached)
      }
    } catch (e) { /* 忽略损坏缓存 */ }
    try {
      var res = await fetch(API + '/settings', { headers: { 'x-em-token': TOKEN } })
      if (res.ok) {
        var stored = await res.json()
        settings = Object.assign(settings, stored || {})
        cacheSettings(settings)
      }
    } catch (e) { /* 宿主不可达时用缓存 */ }
    if (!settings.policy) settings.policy = 'danger-full-access'
    return settings
  }

  async function saveSettings(patch) {
    settings = Object.assign({}, settings, patch)
    cacheSettings(settings)
    try {
      var res = await fetch(API + '/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-em-token': TOKEN },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        var stored = await res.json()
        settings = Object.assign(settings, stored || {})
        cacheSettings(settings)
      }
    } catch (e) { /* 写失败时至少缓存仍在 */ }
    return settings
  }
  var stamp = function () {
    var d = new Date()
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(function (n) { return n < 10 ? '0' + n : String(n) }).join(':')
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function view() { return document.getElementById('chatView') }
  function clearEmpty() {
    var empty = document.getElementById('chatEmpty')
    if (empty && empty.parentNode) empty.parentNode.removeChild(empty)
  }

  /* ---------------- 日志事件组件 ----------------
     一个组件承担模型 / 工具 / 面板 / 用户四类事件：
       身份色 = 来源（.ev[data-src]），状态色 = 左侧竖线 + 状态文字（.ev[data-status]）
     折叠由按钮语义 + aria-expanded 控制，正文用 grid-template-rows 过渡，
     内容始终留在 DOM 里（不是 display:none 假动画），收起后对键盘不可聚焦。 */
  var evIndex = Object.create(null)
  var evCounter = 0
  var SRC_LABEL = { model: '模型', tool: '工具', panel: '面板', user: '用户' }

  function foldText(s, n) {
    s = String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim()
    return s.length > n ? s.slice(0, n) + ' …' : s
  }

  function chevronSvg() {
    var ns = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('class', 'ev__chev')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    var p = document.createElementNS(ns, 'path')
    p.setAttribute('d', 'm9 6 6 6-6 6')
    svg.appendChild(p)
    return svg
  }

  function setOpen(root, open) {
    root.dataset.open = open ? 'true' : 'false'
    var head = root.querySelector('.ev__head')
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false')
    var inner = root.querySelector('.ev__inner')
    if (inner) {
      if (open) inner.removeAttribute('inert')
      else inner.setAttribute('inert', '')
    }
  }

  function toggleOpen(root) {
    setOpen(root, root.dataset.open !== 'true')
  }

  /** 新建一条事件；同 id 已存在则直接返回（流式合并的入口）。 */
  function appendEvent(opts) {
    var box = view()
    if (!box) return null
    var id = String(opts.id || ('ev-' + (++evCounter)))
    if (evIndex[id]) return evIndex[id]
    clearEmpty()

    var root = el('div', 'ev')
    root.dataset.evid = id
    root.dataset.src = opts.source || 'panel'
    root.dataset.status = opts.status || 'unknown'
    root.dataset.open = 'false'

    var bodyId = 'ev-body-' + (++evCounter)
    var row = el('div', 'ev__row')

    var head = document.createElement('button')
    head.type = 'button'
    head.className = 'ev__head'
    head.setAttribute('aria-expanded', 'false')
    head.setAttribute('aria-controls', bodyId)
    head.appendChild(el('span', 'ev__time', stamp()))
    head.appendChild(el('span', 'ev__src', SRC_LABEL[opts.source] || '面板'))
    head.appendChild(chevronSvg())
    var brief = el('span', 'ev__brief', opts.brief || '')
    head.appendChild(brief)
    var stat = el('span', 'ev__status', opts.statusText || '—')
    head.appendChild(stat)
    head.addEventListener('click', function () { toggleOpen(root) })

    var copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'ev__copy'
    copy.textContent = '复制'
    copy.title = '复制完整内容'
    copy.addEventListener('click', function (e) {
      e.stopPropagation()
      var text = root._fullText || ''
      if (!text) return
      var done = function () { if (typeof window.toast === 'function') window.toast('已复制该条事件全文', 'info', 1800) }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {})
      } else {
        var ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        try { document.execCommand('copy'); done() } catch (e) {}
        document.body.removeChild(ta)
      }
    })

    row.appendChild(head)
    row.appendChild(copy)

    var body = el('div', 'ev__body')
    body.id = bodyId
    var inner = el('div', 'ev__inner')
    inner.setAttribute('inert', '')
    body.appendChild(inner)

    root.appendChild(row)
    root.appendChild(body)
    box.appendChild(root)

    root._fullText = ''
    root._textNode = null
    root._argsNode = null
    evIndex[id] = root

    var follow = document.getElementById('followTail')
    if ((!follow || follow.checked) && box.scrollTop + box.clientHeight >= box.scrollHeight - 40) {
      box.scrollTop = box.scrollHeight
    }
    return root
  }

  /** 追加正文（流式合并用）：不重建节点，也不触发展开动画。 */
  function appendEventText(root, text) {
    if (!root || !text) return
    if (!root._textNode) {
      root._textNode = el('pre', 'ev__text', '')
      root.querySelector('.ev__inner').appendChild(root._textNode)
    }
    root._textNode.textContent = root._fullText ? (root._fullText + '\n' + text) : text
    root._fullText = root._textNode.textContent
    // 只有模型消息的摘要跟随正文；工具事件保留「工具名 · 参数」摘要，
    // 否则结果正文会把摘要覆盖成一段原始输出。
    if (root.dataset.src === 'model') {
      var brief = root.querySelector('.ev__brief')
      if (brief) brief.textContent = foldText(root._fullText, 110)
    }
  }

  function setEventStatus(root, status, statusText) {
    if (!root) return
    root.dataset.status = status
    var stat = root.querySelector('.ev__status')
    if (stat) stat.textContent = statusText || '—'
  }

  /** 兼容旧调用：把 (kind, who, text) 映射到统一组件。 */
  function appendRow(kind, who, text) {
    var map = { assistant: 'model', tool: 'tool', err: 'panel', phase: 'panel' }
    var source = map[kind] || 'panel'
    var status = kind === 'err' ? 'err' : 'unknown'
    var root = appendEvent({
      id: 'legacy-' + (++evCounter),
      source: source,
      status: status,
      brief: String(text || ''),
      statusText: kind === 'err' ? '失败' : '—',
    })
    appendEventText(root, String(text || ''))
    return root
  }

  function appendDetail(row, label, text) {
    if (!text) return
    var root = appendEvent({
      id: 'detail-' + (++evCounter),
      source: 'tool', status: 'unknown',
      brief: label, statusText: '—',
    })
    appendEventText(root, String(text))
  }
  /** 解析模型输出里的 ```dsh-block-data 块，把 s11 通道转成图表点（实时追加）。 */
  var BLOCK_DATA_RE = /```dsh-block-data\s*([\s\S]*?)```/g
  function applyProtocolBlocks(text) {
    if (!text || typeof window.__emAgentAppendRound !== 'function') return 0
    var applied = 0
    var m
    BLOCK_DATA_RE.lastIndex = 0
    while ((m = BLOCK_DATA_RE.exec(text)) !== null) {
      var payload = null
      try { payload = JSON.parse(String(m[1]).trim()) } catch (e) { continue }
      if (!payload || String(payload.channel) !== 's11') continue
      var rows = Array.isArray(payload.rows) ? payload.rows : []
      var points = rows
        .map(function (r) { return [Number(r[0]), Number(r[1])] })
        .filter(function (p) { return isFinite(p[0]) && isFinite(p[1]) })
      if (!points.length) continue
      applied += window.__emAgentAppendRound({ round: payload.round, points: points })
    }
    return applied
  }
  /** 把模型输出交给面板的数据回传路由：通道数据由此进入图表与结果表。 */
  function routeData(text) {
    if (!text) return
    if (typeof window.routeBlockDataFromText === 'function') {
      try { window.routeBlockDataFromText(text) } catch (e) { /* 解析失败不影响日志渲染 */ }
    }
  }

  function clip(s, n) {
    s = String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim()
    return s.length > n ? s.slice(0, n) + ' …' : s
  }

  /* ---------------- 运行设置条 ----------------
     标记由面板构建提供（build.ps1 的 P171）；这里只取值、存值、显示状态。
     若面板里没有该标记（如独立打开预览），退化为按同一结构创建一个，保证可用。 */
  function ensureBar() {
    if (document.getElementById('emRunMcp')) return
    var card = document.getElementById('eventflowCard')
    var host = card ? (card.querySelector('.card-body') || card) : document.body
    var viewEl = document.getElementById('chatView')

    var wrap = el('div', 'em-runbar')
    wrap.id = 'emRunBar'

    function field(labelText, control) {
      var l = el('label', 'em-runbar__field')
      l.appendChild(el('span', 'em-runbar__label', labelText))
      l.appendChild(control)
      return l
    }

    var input = document.createElement('input')
    input.type = 'text'
    input.id = 'emRunMcp'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.placeholder = '如 C:\\CST-MCP；留空则不注册 CST 工具'

    var select = document.createElement('select')
    select.id = 'emRunPolicy'
    ;[['workspace-write', '仅工作区可写'], ['danger-full-access', '完全访问']].forEach(function (pair) {
      var o = document.createElement('option')
      o.value = pair[0]
      o.textContent = pair[1]
      select.appendChild(o)
    })

    var st = el('span', 'em-runbar__status', '待启动')
    st.id = 'emRunStatus'
    st.setAttribute('role', 'status')
    st.setAttribute('aria-live', 'polite')

    wrap.appendChild(field('MCP 包目录', input))
    wrap.appendChild(field('审批', select))
    wrap.appendChild(st)

    if (viewEl && viewEl.parentNode) viewEl.parentNode.insertBefore(wrap, viewEl)
    else host.insertBefore(wrap, host.firstChild)
  }

  var dirInput = null
  var policySel = null
  var status = null

  function bindBar() {
    ensureBar()
    // 标记：本条能从「桥接未加载」改成「待启动」，说明桥接真的跑起来了。
    window.__emAgentBridgeReady = true
    dirInput = document.getElementById('emRunMcp')
    policySel = document.getElementById('emRunPolicy')
    status = document.getElementById('emRunStatus')
    if (!dirInput || !policySel || !status) return

    dirInput.value = settings.mcpDir || ''
    policySel.value = settings.policy
    if (status && status.textContent === '桥接未加载') status.textContent = '待启动'

    dirInput.addEventListener('change', function () {
      saveSettings({ mcpDir: dirInput.value.trim() })
    })
    policySel.addEventListener('change', function () {
      saveSettings({ policy: policySel.value })
    })
  }
  /* ---------------- 事件流 ---------------- */
  var current = { runId: null, ctrl: null }
  var lastText = ''       // 去重：final 常与 text 内容相同

  function setStatus(text) { status.textContent = text }

  async function start() {
    // 面板的 buildInstruction(cfg) 需要 cfg：必须用 readConfig() 组装后传入。
    // 直接调用会抛 "reading 'projectFile'"，早期版本就是因为吞掉异常而误报「先填工程配置」。
    var instruction = ''
    var buildError = ''
    try {
      if (typeof window.buildInstruction === 'function' && typeof window.readConfig === 'function') {
        instruction = String(window.buildInstruction(window.readConfig()) || '')
      } else {
        buildError = '面板未暴露 buildInstruction/readConfig'
      }
    } catch (e) {
      buildError = (e && e.message) ? String(e.message) : String(e)
    }
    if (!instruction.trim()) {
      var box = document.getElementById('chatInput')
      instruction = box ? box.value : ''
    }
    if (!instruction.trim()) {
      if (typeof window.toast === 'function') {
        window.toast(buildError ? ('生成指令失败：' + buildError) : '没有可运行的指令：先填工程配置', 'warn', 4000)
      }
      setStatus(buildError ? '指令生成失败' : '未启动')
      return
    }

    lastText = ''
    var startError = ''
    setStatus('启动中…')
    var res = await fetch(API + '/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-em-token': TOKEN },
      body: JSON.stringify({
        instruction: instruction,
        policy: settings.policy,
        mcp: settings.mcpDir ? { dir: settings.mcpDir } : null,
      }),
    }).catch(function (e) { startError = (e && e.message) ? String(e.message) : String(e); return null })

    if (!res) { setStatus('宿主不可达：' + String(startError).slice(0, 46)); return }
    var payload = await res.json().catch(function () { return null })
    if (res.status === 429) {
      setStatus('并发已满')
      if (typeof window.toast === 'function') window.toast('已有任务在跑：并发上限 ' + ((payload && payload.cap) || 1), 'warn', 3500)
      return
    }
    if (res.status !== 200 || !payload || !payload.runId) {
      setStatus('启动失败')
      if (typeof window.toast === 'function') window.toast('启动失败：' + ((payload && payload.error) || res.status), 'err', 3500)
      return
    }

    current.runId = payload.runId
    setStatus('运行中 · ' + payload.runId)
    if (typeof window.setRunState === 'function') { try { window.setRunState('running') } catch (e) {} }

    await stream(payload.runId)
  }

  async function stream(runId) {
    var ctrl = new AbortController()
    current.ctrl = ctrl
    var res
    try {
      res = await fetch(API + '/run/' + runId + '/events', {
        headers: { 'x-em-token': TOKEN },
        signal: ctrl.signal,
      })
    } catch (e) { setStatus('事件流中断'); return }
    if (!res.ok || !res.body) { setStatus('事件流不可用'); return }

    var reader = res.body.getReader()
    var decoder = new TextDecoder()
    var buf = ''
    try {
      for (;;) {
        var chunk = await reader.read()
        if (chunk.done) break
        buf += decoder.decode(chunk.value, { stream: true })
        var idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          var block = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          handleBlock(block)
        }
      }
    } catch (e) { /* 取消时会抛，属正常 */ }
    // 终态由 handleBlock 的 done 事件决定；这里只在还没有终态时兜底，
    // 否则会把「已完成 / 已失败」覆盖成含糊的「已结束」。
    if (current.runId === runId) {
      var shown = (status && status.textContent) || ''
      if (!/已完成|已失败/.test(shown)) setStatus('已结束')
    }
    current.ctrl = null
  }

  function handleBlock(block) {
    var data = block.split('\n')
      .filter(function (l) { return l.indexOf('data: ') === 0 })
      .map(function (l) { return l.slice(6) })
      .join('')
    if (!data) return
    var evt
    try { evt = JSON.parse(data) } catch (e) { return }
    if (!evt) return

    if (evt.type === 'run/done' || evt.kind === 'done') {
      var ok = evt.status === 'done'
      var doneEvent = appendEvent({
        id: 'done:' + current.runId, source: 'panel', status: ok ? 'ok' : 'err',
        brief: (ok ? '完成' : '失败') + '（exit ' + evt.exitCode + '）' + (evt.note ? ' · ' + evt.note : ''),
        statusText: ok ? '成功' : '失败',
      })
      appendEventText(doneEvent, (ok ? '运行完成' : '运行失败') + '，退出码 ' + evt.exitCode + (evt.note ? '\n' + evt.note : ''))
      if (typeof window.setRunState === 'function') { try { window.setRunState(ok ? 'done' : 'failed') } catch (e) {} }
      setStatus(ok ? '已完成' : '已失败')
      if (ok) ingestResults()
      return
    }
    if (evt.type === 'run/start') {
      var startEvent = appendEvent({
        id: 'start:' + evt.runId, source: 'panel', status: 'unknown',
        brief: evt.runId + ' · ' + evt.policy + (evt.mcp ? ' · MCP ' + evt.mcp : ' · 未配置 MCP'),
        statusText: '—',
      })
      appendEventText(startEvent, 'run_id: ' + evt.runId + '\n审批: ' + evt.policy + '\nMCP: ' + (evt.mcp || '未配置') + '\n解释器: ' + (evt.python || '—') + '\n目录: ' + (evt.dir || '—'))
      return
    }
    if (evt.type === 'run/cancel') {
      var c = appendEvent({ id: 'cancel:' + current.runId, source: 'panel', status: 'unknown', brief: '已请求取消', statusText: '—' })
      appendEventText(c, '已请求取消本次运行')
      return
    }

    var raw = null
    if (typeof evt.raw === 'string') {
      try { raw = JSON.parse(evt.raw) } catch (e) { raw = null }
    }

    switch (evt.type) {
      case 'session': {
        var s = appendEvent({
          id: 'session:' + (raw && raw.sessionId ? raw.sessionId : evt.seq),
          source: 'panel', status: 'unknown',
          brief: (raw && raw.sessionId ? raw.sessionId : '会话') + (raw && raw.cwd ? ' · ' + raw.cwd : ''),
          statusText: '—',
        })
        appendEventText(s, JSON.stringify(raw || {}, null, 2))
        return
      }
      case 'status': {
        var ph = appendEvent({
          id: 'status:' + evt.seq, source: 'panel', status: 'unknown',
          brief: (raw && raw.phase ? raw.phase : '状态') + (raw && raw.turn ? ' · 第 ' + raw.turn + ' 轮' : ''),
          statusText: '—',
        })
        appendEventText(ph, JSON.stringify(raw || {}, null, 2))
        return
      }
      case 'thinking': {
        var thinkText = evt.text || (raw && raw.text) || ''
        if (!String(thinkText).trim()) return      // 空思考不建卡片
        var th = appendEvent({
          id: 'think:' + evt.seq, source: 'model', status: 'ok',
          brief: foldText(thinkText, 110),
          statusText: '—',
        })
        appendEventText(th, thinkText)
        return
      }
      case 'tool_call': {
        var toolName = (raw && raw.tool) || '工具'
        var callId = (raw && raw.callId) || ('call-' + evt.seq)
        var node = appendEvent({
          id: 'tool:' + callId, source: 'tool', status: 'run',
          brief: toolName + (raw && raw.input ? ' · ' + foldText(JSON.stringify(raw.input), 90) : ''),
          statusText: '进行中',
        })
        if (raw && raw.input) {
          var pre = el('pre', 'ev__args', JSON.stringify(raw.input, null, 2))
          node.querySelector('.ev__inner').insertBefore(pre, node.querySelector('.ev__inner').firstChild)
        }
        return
      }
      case 'tool_result': {
        var rid = 'tool:' + ((raw && raw.callId) || ('call-' + evt.seq))
        var target = appendEvent({
          id: rid, source: 'tool', status: 'ok',
          brief: ((raw && raw.callId) || '工具') + ' · 结果', statusText: '成功',
        })
        var bad = raw && raw.status && String(raw.status) !== 'completed'
        setEventStatus(target, bad ? 'err' : 'ok', bad ? '失败' : '成功')
        appendEventText(target, raw && raw.result ? String(raw.result) : '')
        return
      }
      case 'text':
      case 'assistant': {
        var txt = evt.text || (raw && raw.text) || ''
        if (!txt || !String(txt).trim()) return   // 空消息不建卡片
        if (txt === lastText) return
        lastText = txt
        var roundKey = lastRunRoundForBridge()
        var mid = 'msg:' + runKey() + ':' + roundKey + ':' + msgSeq
        var msgNode = appendEvent({
          id: mid, source: 'model', status: 'ok',
          brief: foldText(txt, 110), statusText: '—',
        })
        if (msgNode._consumed) {
          msgSeq += 1
          msgNode = appendEvent({
            id: 'msg:' + runKey() + ':' + roundKey + ':' + msgSeq,
            source: 'model', status: 'ok', brief: foldText(txt, 110), statusText: '—',
          })
        }
        msgNode._consumed = true
        appendEventText(msgNode, txt)
        routeData(txt)
        applyProtocolBlocks(txt)
        return
      }
      case 'final': {
        var ft = evt.text || (raw && raw.text) || ''
        routeData(ft)
        applyProtocolBlocks(ft)
        return
      }
      case 'error': {
        var e2 = appendEvent({
          id: 'err:' + evt.seq, source: 'panel', status: 'err',
          brief: evt.text || (raw && raw.message) || '错误', statusText: '失败',
        })
        appendEventText(e2, evt.text || (raw && raw.message) || '错误')
        return
      }
      default:
        break
    }

    if (evt.kind === 'error') {
      var e3 = appendEvent({ id: 'err:' + evt.seq, source: 'panel', status: 'err', brief: evt.text || evt.type || '错误', statusText: '失败' })
      appendEventText(e3, evt.text || evt.type || '错误')
      return
    }
    if (evt.text) {
      var e4 = appendEvent({ id: 'misc:' + evt.seq, source: 'panel', status: 'unknown', brief: foldText(evt.text, 110), statusText: '—' })
      appendEventText(e4, evt.text)
    }
  }

  var msgSeq = 0
  function runKey() { return current.runId || 'norun' }
  function lastRunRoundForBridge() {
    var el2 = document.getElementById('kIter')
    var m = el2 ? String(el2.textContent || '') : ''
    var n = parseInt(m, 10)
    return isFinite(n) ? n : 0
  }
  /** 从运行目录读取 evidence 并注入图表：有界重试 + 可手动重复调用（幂等）。 */
  async function ingestResults() {
    if (!current.runId) { setStatus('无运行记录'); return 0 }
    var preview = document.getElementById('copyPreview')
    var workDir = preview ? String(preview.textContent || '').trim() : ''
    if (!workDir || workDir.charAt(0) === '（') {
      appendRow('phase', '结果', '未设置工作副本路径，跳过读取')
      return 0
    }
    var delays = [0, 2000, 5000, 10000]
    for (var i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise(function (r) { setTimeout(r, delays[i]) })
      var res = await fetch(API + '/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-em-token': TOKEN },
        body: JSON.stringify({ runId: current.runId, workDir: workDir }),
      }).catch(function () { return null })
      if (!res) continue
      var payload = await res.json().catch(function () { return null })
      if (!payload) continue
      if (payload.ok) {
        var applied = (typeof window.__emAgentApplyResults === 'function') ? window.__emAgentApplyResults(payload) : 0
        appendRow('phase', '结果', '已载入 ' + payload.points + ' 个频点' + (payload.verdict ? ' · ' + payload.verdict : '') + (applied ? '' : '（注入失败）'))
        return applied
      }
      if (payload.reason === 'missing') continue          // 可能仍在写盘 → 继续重试
      appendRow('phase', '结果', payload.detail || payload.reason)
      return 0
    }
    appendRow('phase', '结果', '未找到本次 evidence，可稍后点「读取结果」')
    return 0
  }
  async function cancel() {
    if (!current.runId) return
    try { if (current.ctrl) current.ctrl.abort() } catch (e) {}
    await fetch(API + '/run/' + current.runId + '/cancel', {
      method: 'POST',
      headers: { 'x-em-token': TOKEN },
    }).catch(function () {})
    setStatus('取消中…')
  }

  /* ---------------- 接管按钮 ---------------- */
  function intercept(id, handler) {
    var btn = document.getElementById(id)
    if (!btn) return false
    btn.addEventListener('click', function (e) {
      e.preventDefault()
      e.stopImmediatePropagation()
      handler(e)
    }, true)
    return true
  }

  /** 宿主能力探测：run-host.js 是启动时导入的，旧模块会让 /ingest、GBK 解码等静默失效。 */
  async function checkHostBuild() {
    var res = await fetch(API + '/version', { headers: { 'x-em-token': TOKEN } }).catch(function () { return null })
    if (res && res.ok) {
      var info = await res.json().catch(function () { return null })
      if (info && info.build) return { ok: true, build: info.build }
      return { ok: true, build: 'unknown' }
    }
    // 404 = 宿主模块早于本次桥接：必须提示重启，而不是让它悄悄降级。
    return { ok: false, build: '' }
  }
  async function boot() {
    await resolveApi()
    await loadSettings()
    bindBar()
    var hostInfo = await checkHostBuild()
    if (!hostInfo.ok) {
      if (status) { status.textContent = '宿主版本过旧：请重启应用'; status.style.color = '#c0392b' }
      appendRow('phase', '宿主', '宿主运行的是旧模块（缺少 /version）：GBK 解码与结果读取不会生效，请完全退出应用后重新打开')
    }
    // 供面板的 startSimulation 直接调用（不依赖事件拦截）
    window.__emAgentStartRun = start
    window.__emAgentCancelRun = cancel
    window.__emAgentParseS11Blocks = applyProtocolBlocks   // 测试接缝：纯函数，可离线验证
    var ingestBtn = document.getElementById('emRunIngest')
    if (ingestBtn) ingestBtn.addEventListener('click', function () { ingestResults() })
    intercept('btnCancel', function () { cancel() })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
