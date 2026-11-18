/* ============================================================================
 *  run-host.js —— headless 运行引擎（插件宿主半）
 *
 *  为什么要有它：
 *    面板是浏览器页面，不能 spawn 进程、也读不到子进程 stdout。而 dsh 的 UI
 *    本身就是可替换的一层：用 `dsh --profile headless --json` 跑同一个 agent loop，
 *    把 JSONL 事件流交给面板自己的「运行记录」渲染，就不再依赖 DSH 的对话 surface。
 *
 *  与参考实现（AI-eval）对齐的三点：
 *    1) 命令形态：dsh --profile headless [--patch p.yml] --json <instruction-file>
 *    2) 每个 run 一个工作目录；patch 在 run 目录内生成，结束即删
 *    3) 只读事件流、不改写事件；映射集中在 classify() 一处
 *
 *  安全：
 *    - 所有写路由要求 x-em-token（与页面同源，跨源会被 CORS 预检挡住）
 *    - patch 用 JSON 序列化标量（JSON 是合法 YAML），不拼字符串
 *    - 并发上限来自插件 Config（默认 1），超限明确拒绝
 * ========================================================================== */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stat as statFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

/** 单个 run 的事件缓冲上限，避免长任务把内存吃满。 */
const MAX_EVENTS = 5000
/** 运行设置落盘位置：桌面版端口每次启动都变，localStorage 会按 origin 失效，只能存宿主侧。 */
const SETTINGS_FILE = process.env.DSH_EM_AGENT_SETTINGS ||
  join(process.env.LOCALAPPDATA || tmpdir(), 'dsh-em-agent', 'settings.json')
/**
 * Windows 上 dsh 子进程的 stderr 通常是 GBK（代码页 936）。
 * 直接按 UTF-8 解码会得到 `ϵͳ�Ҳ���ָ����·��` 这类乱码，
 * 所以先按 UTF-8 试，出现替换符再回退 GBK。
 */
export function decodeMaybeGbk(buffer) {
  const utf8 = buffer.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try { return new TextDecoder('gbk').decode(buffer) } catch (error) { return utf8 }
}

/** 解释器派生：用户只给目录时，按存在性挑一个，最后回退 PATH 上的 python。 */
function pickPython(mcpDir, explicit) {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  const candidates = [
    join(mcpDir, '.venv', 'Scripts', 'python.exe'),
    join(mcpDir, 'venv', 'Scripts', 'python.exe'),
    join(mcpDir, 'python.exe'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'python'
}

/**
 * 宿主模块的构建戳：取本文件 mtime。
 * 用途：模块是启动时导入的，改了 run-host.js 必须重启才生效；
 * 页面据此判断「宿主是否比桥接旧」，而不是让用户面对无声失效。
 */
const HOST_BUILD = (() => {
  try { return String(Math.round(statSync(fileURLToPath(import.meta.url)).mtimeMs)) } catch (error) { return '0' }
})()

/** 插件私有的会话存储根：headless 的会话写到这里，不进 ~/.dsh/sessions。 */
const SESSION_ROOT = process.env.DSH_EM_AGENT_SESSION_ROOT || join(tmpdir(), 'dsh-em-agent-sessions')
/** 子进程超时兜底（毫秒）：默认 2 小时。 */
const RUN_TIMEOUT_MS = Number(process.env.DSH_EM_AGENT_RUN_TIMEOUT_MS || 2 * 60 * 60 * 1000)

/** 解析 dsh 入口：优先环境变量，其次全局 npm 安装。 */
function resolveDsh() {
  const explicit = process.env.DSH_BIN
  if (explicit) return { node: process.execPath, bin: explicit }
  const appData = process.env.APPDATA
  if (appData) {
    const guessed = join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    return { node: process.execPath, bin: guessed }
  }
  return { node: process.execPath, bin: 'dsh' }
}

/**
 * 生成每次 run 的 patch（YAML）。
 *
 * 三件事：
 *   1 会话存储改到插件私有目录 —— 否则 headless 的会话会写进 ~/.dsh/sessions，
 *     并被 DSH 侧栏列出，用户会以为「在 Harness 里新建了会话」。
 *   2 显式钉死沙箱与审批 —— 不依赖 env 能否传导到子进程。
 *   3 可选地注册 CST MCP（用户只填包目录，这里派生解释器与入口）。
 */
export function buildPatch(options) {
  const mcp = options && options.mcp
  const policy = options && options.policy === 'workspace-write' ? 'workspace-write' : 'danger-full-access'
  const sessionRoot = (options && options.sessionRoot) || ''
  const q = (v) => JSON.stringify(String(v))
  const lines = []

  if (sessionRoot) {
    lines.push(
      '- id: session-persistence-jsonl',
      '  config:',
      '    root: ' + q(sessionRoot),
    )
  }
  lines.push(
    '- id: sandbox-policy',
    '  config:',
    '    mode: ' + q(policy),
    '- id: approval',
    '  config:',
    '    policy: ' + q(policy === 'danger-full-access' ? 'never' : 'ask'),
  )

  if (mcp) {
    const dir = typeof mcp.dir === 'string' ? mcp.dir.trim() : ''
    if (dir) {
      const python = pickPython(dir, mcp.python)
      const entry = (typeof mcp.entry === 'string' && mcp.entry.trim()) || join(dir, 'mcp_server.py')
      const name = (typeof mcp.serverName === 'string' && mcp.serverName.trim()) || 'cst-studio-suite'
      const env = (mcp.env && typeof mcp.env === 'object' && !Array.isArray(mcp.env)) ? mcp.env : {}
      lines.push(
        '- insert:',
        '    - id: mcp-cst-studio-suite',
        "      name: '@deepseek-ai/dsh-mcp-client'",
        '      config:',
        '        serverName: ' + q(name),
        '        transport: stdio',
        '        command: ' + q(python),
        '        args:',
        '          - ' + q(entry),
        '        cwd: ' + q(dir),
      )
      const envKeys = Object.keys(env).filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
      if (envKeys.length) {
        lines.push('        env:')
        for (const k of envKeys) lines.push('          ' + k + ': ' + q(env[k]))
      }
    }
  }

  lines.push('')
  return lines.join('\n')
}
/** 事件分类：只做保守归一，不改写原始内容。 */
function classify(raw) {
  let evt = null
  try { evt = JSON.parse(raw) } catch (e) { return { kind: 'raw', text: raw } }
  const type = String(evt.type || evt.kind || (evt.event && evt.event.type) || '')
  let kind = 'event'
  if (/error|fail/i.test(type)) kind = 'error'
  else if (/tool/i.test(type)) kind = 'tool'
  else if (/assistant|message|text|token|delta/i.test(type)) kind = 'assistant'
  else if (/think|reason/i.test(type)) kind = 'think'
  else if (/step|turn|phase|stage/i.test(type)) kind = 'phase'
  return { kind, type, text: extractText(evt), event: evt }
}

function extractText(evt) {
  const candidates = [evt.text, evt.delta, evt.content, evt.message,
    evt.event && evt.event.text, evt.event && evt.event.content,
    evt.data && evt.data.text, evt.data && evt.data.content]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.slice(0, 8000)
    if (c && typeof c === 'object' && typeof c.text === 'string') return c.text.slice(0, 8000)
  }
  return ''
}

/** 只保留已知键并做类型校验，避免设置文件成为注入面。 */
function sanitizeSettings(input) {
  const out = {}
  if (input && typeof input === 'object') {
    if (typeof input.mcpDir === 'string') out.mcpDir = input.mcpDir.trim().slice(0, 500)
    if (input.policy === 'workspace-write' || input.policy === 'danger-full-access') out.policy = input.policy
  }
  return out
}

async function readSettings() {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return sanitizeSettings(parsed)
  } catch (error) {
    return {}
  }
}

async function writeSettings(patch) {
  const current = await readSettings()
  const next = Object.assign({}, current, sanitizeSettings(patch))
  await mkdir(dirname(SETTINGS_FILE), { recursive: true })
  await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8')
  return next
}
/**
 * @param {{ routePath: string, token: string, maxConcurrent: () => number, onWarn?: (m: string)=>void }} opts
 */
/**
 * 读取一次 run 的 evidence，转成面板能直接吃的结构。
 * 纯函数，便于离线测试；不做网络、不依赖 run 状态。
 *
 * 时间戳闸门：s11.json 的 mtime 早于本次 run 启动 → 判为上次残留，拒绝使用。
 */
export async function readEvidence(workDir, startedAt) {
  const evidenceDir = join(workDir, 'evidence')
  const s11Path = join(evidenceDir, 's11.json')
  // 注意：变量不要叫 stat —— 会遮蔽同名导入函数，调用变成 undefined。
  let info
  try {
    info = await statFile(s11Path)
  } catch (error) {
    // 只有「不存在」才算 missing；其它错误必须原样暴露，不能被吞成 missing。
    const code = (error && error.code) || 'unknown'
    const reason = code === 'ENOENT' ? 'missing' : 'unreadable'
    return { ok: false, reason, detail: '读取 evidence/s11.json 失败（' + code + '）', path: s11Path }
  }
  if (typeof startedAt === 'number' && info.mtimeMs < startedAt - 2000) {
    return {
      ok: false, reason: 'stale', path: s11Path,
      detail: '结果文件早于本次运行，可能是上次残留',
      mtime: new Date(info.mtimeMs).toISOString(),
      startedAt: new Date(startedAt).toISOString(),
    }
  }

  let parsed
  try {
    parsed = JSON.parse(await readFile(s11Path, 'utf8'))
  } catch (error) {
    return { ok: false, reason: 'bad-json', detail: 's11.json 不是合法 JSON', path: s11Path }
  }
  const points = Array.isArray(parsed && parsed.data) ? parsed.data : null
  if (!points || !points.length) {
    return { ok: false, reason: 'bad-shape', detail: 's11.json 缺少 data 数组', path: s11Path }
  }

  let summary = null
  try {
    summary = JSON.parse(await readFile(join(evidenceDir, 'result_summary.json'), 'utf8'))
  } catch (error) { summary = null }

  const band = (summary && summary.band) ? summary.band : {}
  return {
    ok: true,
    path: s11Path,
    mtime: new Date(info.mtimeMs).toISOString(),
    rounds: [{ round: 1, points }],
    worst: typeof band.worst_db === 'number' ? band.worst_db : null,
    best: typeof band.best_db === 'number' ? band.best_db : null,
    verdict: band.verdict || null,
    points: points.length,
  }
}
export function createRunHost(opts) {
  const routePath = opts.routePath
  const token = opts.token
  const runs = new Map()

  const runsOf = () => Array.from(runs.values())
  const activeCount = () => runsOf().filter((r) => r.status === 'running').length

  function json(res, status, body) {
    const text = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(Buffer.byteLength(text)),
    })
    res.end(text)
  }

  /** 允许同机任意来源调用：路由本身靠 x-em-token 鉴权，跨源方拿不到 token。 */
  function allowCors(req, res) {
    const origin = req.headers.origin
    res.setHeader('access-control-allow-origin', origin || '*')
    res.setHeader('vary', 'origin')
    res.setHeader('access-control-allow-headers', 'x-em-token, content-type')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-max-age', '600')
  }

  function authorized(req) {
    const got = req.headers['x-em-token']
    return typeof got === 'string' && got.length > 0 && got === token
  }

  async function readBody(req, limit = 256 * 1024) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) throw new Error('body too large')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  function emit(run, event) {
    run.events.push(event)
    if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS)
    for (const listener of run.listeners) {
      try { listener(event) } catch (e) { /* 单个订阅者出错不拖累其它 */ }
    }
  }

  function finish(run, status, exitCode, note) {
    if (run.status !== 'running') return
    run.status = status
    run.exitCode = exitCode
    run.finishedAt = Date.now()
    emit(run, { seq: run.seq++, kind: 'done', type: 'run/done', status, exitCode, note: note || '' })
    try { run.child && run.child.kill() } catch (e) { /* 已退出 */ }
    for (const l of run.listeners) { try { l(null) } catch (e) {} }
    run.listeners.clear()
  }

  function startRun(body) {
    const runId = 'run-' + randomUUID().slice(0, 8)
    const dir = join(tmpdir(), 'dsh-em-agent-runs', runId)
    const instruction = typeof body.instruction === 'string' ? body.instruction : ''
    if (!instruction.trim()) return { error: 'instruction is empty' }

    const policy = body.policy === 'workspace-write' ? 'workspace-write' : 'danger-full-access'
    const mcp = body.mcp || null
    const run = {
      runId, dir, policy, status: 'running', exitCode: null,
      startedAt: Date.now(), finishedAt: null,
      events: [], seq: 0, listeners: new Set(), child: null,
    }
    runs.set(runId, run)

    ;(async () => {
      try {
        await mkdir(dir, { recursive: true })
        const instrFile = join(dir, 'instruction.md')
        await writeFile(instrFile, instruction, 'utf8')

        const patch = buildPatch({ mcp, policy, sessionRoot: SESSION_ROOT })
        const patchFile = join(dir, 'dsh.patch.yml')
        await writeFile(patchFile, patch, 'utf8')

        const dsh = resolveDsh()
        const args = ['--profile', 'headless', '--patch', patchFile, '--json', instrFile]

        emit(run, { seq: run.seq++, kind: 'phase', type: 'run/start', runId, policy, mcp: (mcp && mcp.dir) || '', python: (mcp && mcp.dir) ? pickPython(mcp.dir, mcp.python) : '', dir })

        const child = spawn(dsh.node, [dsh.bin, ...args], {
          cwd: typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd : dir,
          env: { ...process.env, DSH_PERMISSION_MODE: policy },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
        run.child = child

        let buf = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk) => {
          buf += chunk
          let idx
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim()
            buf = buf.slice(idx + 1)
            if (!line) continue
            const c = classify(line)
            emit(run, { seq: run.seq++, kind: c.kind, type: c.type, text: c.text, raw: line.slice(0, 8000) })
          }
        })
        let errBuf = Buffer.alloc(0)
        child.stderr.on('data', (chunk) => {
          errBuf = Buffer.concat([errBuf, chunk])
          let cut
          while ((cut = errBuf.indexOf(10)) >= 0) {
            const line = decodeMaybeGbk(errBuf.subarray(0, cut)).trim()
            errBuf = errBuf.subarray(cut + 1)
            if (line) emit(run, { seq: run.seq++, kind: 'error', type: 'stderr', text: line.slice(0, 4000) })
          }
        })
        child.on('error', (err) => finish(run, 'failed', null, String(err && err.message || err)))
        child.on('close', (code) => {
          if (buf.trim()) {
            const c = classify(buf.trim())
            emit(run, { seq: run.seq++, kind: c.kind, type: c.type, text: c.text, raw: buf.trim().slice(0, 8000) })
            buf = ''
          }
          finish(run, code === 0 ? 'done' : 'failed', code, '')
        })

        const timer = setTimeout(() => {
          emit(run, { seq: run.seq++, kind: 'error', type: 'timeout', text: '运行超时，已终止' })
          cancelRun(runId)
        }, RUN_TIMEOUT_MS)
        child.on('close', () => clearTimeout(timer))
      } catch (err) {
        finish(run, 'failed', null, String(err && err.message || err))
      }
    })()

    return { runId }
  }

  function cancelRun(runId) {
    const run = runs.get(runId)
    if (!run || run.status !== 'running') return { ok: false, reason: 'not running' }
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(run.child && run.child.pid || 0), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
      } else if (run.child) {
        run.child.kill('SIGTERM')
      }
    } catch (e) { /* 进程可能已退出 */ }
    emit(run, { seq: run.seq++, kind: 'phase', type: 'run/cancel', text: '已请求取消' })
    return { ok: true }
  }

  /** 返回 true 表示该请求已被处理。 */
  async function handle(req, res, url) {
    const p = url.pathname
    if (!p.startsWith(routePath + '/')) return false

    const sub = p.slice(routePath.length) // 形如 /run、/run/<id>/events
    allowCors(req, res)
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true }

    if (sub === '/runs' && req.method === 'GET') {
      if (!authorized(req)) return json(res, 403, { error: 'forbidden' }), true
      return json(res, 200, {
        maxConcurrent: opts.maxConcurrent(),
        active: activeCount(),
        runs: runsOf().map((r) => ({
          runId: r.runId, status: r.status, policy: r.policy,
          startedAt: r.startedAt, finishedAt: r.finishedAt, exitCode: r.exitCode, events: r.events.length,
        })),
      }), true
    }

    if (sub === '/version' && req.method === 'GET') {
      return json(res, 200, {
        build: HOST_BUILD,
        capabilities: ['settings', 'ingest', 'cors', 'gbk-stderr'],
      }), true
    }

    if (sub === '/ingest' && req.method === 'POST') {
      if (!authorized(req)) return json(res, 403, { error: 'forbidden' }), true
      let body
      try { body = JSON.parse(await readBody(req, 64 * 1024)) } catch (e) {
        return json(res, 400, { error: 'invalid json' }), true
      }
      const workDir = typeof body.workDir === 'string' ? body.workDir.trim() : ''
      if (!workDir) return json(res, 400, { error: 'workDir is required' }), true
      const run = body.runId ? runs.get(body.runId) : null
      const startedAt = run ? run.startedAt : (typeof body.startedAt === 'number' ? body.startedAt : null)
      const result = await readEvidence(workDir, startedAt)
      return json(res, result.ok ? 200 : 200, result), true
    }
    if (sub === '/settings') {
      if (!authorized(req)) return json(res, 403, { error: 'forbidden' }), true
      if (req.method === 'GET') return json(res, 200, await readSettings()), true
      if (req.method === 'POST') {
        let patch
        try { patch = JSON.parse(await readBody(req, 64 * 1024)) } catch (e) {
          return json(res, 400, { error: 'invalid json' }), true
        }
        return json(res, 200, await writeSettings(patch)), true
      }
      return json(res, 405, { error: 'method not allowed' }), true
    }
    if (sub === '/run' && req.method === 'POST') {
      if (!authorized(req)) return json(res, 403, { error: 'forbidden' }), true
      const cap = opts.maxConcurrent()
      if (activeCount() >= cap) {
        return json(res, 429, { error: 'concurrency limit reached', cap, active: activeCount() }), true
      }
      let body
      try { body = JSON.parse(await readBody(req)) } catch (e) {
        return json(res, 400, { error: 'invalid json' }), true
      }
      const started = startRun(body)
      if (started.error) return json(res, 400, started), true
      return json(res, 200, { runId: started.runId, events: 0 }), true
    }

    const m = sub.match(/^\/run\/([A-Za-z0-9-]+)(\/events|\/cancel)?$/)
    if (m) {
      const run = runs.get(m[1])
      if (!run) return json(res, 404, { error: 'unknown run' }), true
      if (!authorized(req)) return json(res, 403, { error: 'forbidden' }), true

      if (m[2] === '/cancel' && req.method === 'POST') {
        return json(res, 200, cancelRun(m[1])), true
      }

      if (m[2] === '/events' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        const send = (evt) => {
          if (!evt) { res.write('event: end\ndata: {}\n\n'); try { res.end() } catch (e) {} return }
          res.write('id: ' + evt.seq + '\nevent: run-event\ndata: ' + JSON.stringify(evt) + '\n\n')
        }
        const last = Number(req.headers['last-event-id'] || 0)
        for (const evt of run.events) if (Number.isFinite(last) ? evt.seq > last : true) send(evt)
        if (run.status !== 'running') { send(null); return true }
        run.listeners.add(send)
        req.on('close', () => run.listeners.delete(send))
        return true
      }

      if (!m[2] && req.method === 'GET') {
        return json(res, 200, {
          runId: run.runId, status: run.status, exitCode: run.exitCode,
          policy: run.policy, startedAt: run.startedAt, finishedAt: run.finishedAt,
          events: run.events.length,
        }), true
      }
    }

    return json(res, 404, { error: 'not found' }), true
  }

  /** 插件卸载时清理：杀掉所有仍运行的子进程与临时目录。 */
  function dispose() {
    for (const run of runs.values()) {
      if (run.status === 'running') cancelRun(run.runId)
      try { run.listeners.clear() } catch (e) {}
      rm(run.dir, { recursive: true, force: true }).catch(() => {})
    }
    runs.clear()
  }

  return { handle, dispose, startRun, cancelRun, activeCount }
}
