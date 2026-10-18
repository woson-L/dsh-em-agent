/**
 * dsh-em-agent — 把「DSH EM Agent」天线设计控制台挂成 DSH Web 的路由。
 *
 * 为什么不做成「往 DSH 静态目录里拷 HTML」：
 *   <dsh-web-frontend>/dist/ 是 DSH 的安装目录，升级或重装时会被整体替换，
 *   放在里面的页面会全部消失（表现为 URL 突然 404）。
 *   本插件安装在 profile 目录（~/.dsh/profiles/web/），属于用户数据，
 *   不随 DSH 升级丢失；页面本体也随包分发，不再依赖任何绝对路径。
 *
 * 路由契约来自 @deepseek-ai/dsh-host-webserver：
 *   webServer.register({ kind: 'exact' | 'prefix', path, handler }) => disposer
 *   重复的 (kind, path) 会抛错；匹配顺序为 exact → 最长 prefix → fallback。
 *
 * 配置（可选，全部有默认值）：
 *   routePath  页面挂载路径，默认 '/em-agent'
 *              - 必须是对象；不是对象直接报错
 *              - routePath 必须是字符串、以 '/' 开头、不以 '/' 结尾，否则报错
 *              - 未知键**不报错**，只在挂载时告警一次
 *   不写 config 块时 apply 收到的是解析后的完整对象，等价于全默认值。
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis 插件名。 */
export const name = 'dsh-em-agent'

/** webServer 是硬依赖：没有它这个插件没有意义。 */
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const PANEL = join(HERE, 'panel.html')

/** 默认挂载路径。 */
export const DEFAULT_ROUTE_PATH = '/em-agent'

/**
 * 面板响应头标记。
 * 客户端半边（client.js）用它区分「真的是面板」与「SPA 的 fallback 页」：
 * 桌面版渲染层是 dsh-app:// 自定义协议，相对路径能不能到后端要看该 scheme
 * 是否透传，所以客户端会先 HEAD 一次，只有带上这个头才认定相对路径可用。
 */
export const MARKER_HEADER = 'x-dsh-em-agent'

/** 宿主注入的 origin meta 名，与 client.js 约定一致。 */
export const ORIGIN_META = 'dsh-em-agent-origin'

/**
 * 旧路径兼容别名。
 * 本插件原名 dsh-antenna-optimizer、页面挂在 /antenna-optimizer；
 * 更名后旧链接（书签、脚本、文档）仍应可用，所以两个路径同时提供。
 * 想只保留新路径，把这里设为 null 即可。
 */
export const LEGACY_ROUTE_PATH = '/antenna-optimizer'

/**
 * 配置校验器（Standard Schema，零依赖）。
 *
 * 为什么不用 @deepseek-ai/schemastery：它只存在于 DSH 安装树的 node_modules，
 * 而插件是以 git/link 方式装进 profile 的，Node 默认按真实路径解析，够不到那里。
 * Cordis 接受任意 Standard Schema 验证器，所以这里手写一个。
 *
 * 关于严格度：只校验**类型与格式**，不拒绝未知键。
 * 理由是爆炸半径 —— 严格拒绝未知键时，配置里一个拼写错误会让整个
 * `dsh web` 启动失败，而不只是这条路由失效。未知键改为在 apply 里告警一次。
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-em-agent',
    validate(value) {
      const input = value === undefined || value === null ? {} : value
      if (typeof input !== 'object' || Array.isArray(input)) {
        return { issues: [{ message: `expected an object but got ${Array.isArray(input) ? 'array' : typeof input}`, path: [] }] }
      }

      const issues = []
      let routePath = DEFAULT_ROUTE_PATH

      if (input.routePath !== undefined) {
        const raw = input.routePath
        if (typeof raw !== 'string') {
          issues.push({ message: `expected string but got ${typeof raw}`, path: ['routePath'] })
        } else if (!raw.startsWith('/')) {
          issues.push({ message: 'must start with "/"', path: ['routePath'] })
        } else if (raw.length > 1 && raw.endsWith('/')) {
          issues.push({ message: 'must not end with "/"', path: ['routePath'] })
        } else {
          routePath = raw
        }
      }

      if (issues.length > 0) return { issues }

      const unknownKeys = Object.keys(input).filter((key) => key !== 'routePath')
      return { value: { routePath, unknownKeys } }
    },
  },
}

/**
 * 请求处理器：读取 panel.html 并回送。两个路径共用同一份实现。
 *
 * @param {string | null} origin 由 {@link panelOrigin} 算出的真实 origin
 */
function makeHandler(origin) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // RFC 9110 §15.5.6：405 响应必须生成 Allow 头字段
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    let body
    try {
      body = await readFile(PANEL)
      // 面板自身也需要知道真实 origin：桌面版渲染层是 dsh-app://，它要靠这个
      // meta 把「自定义协议」与「file:// 降级」区分开，并用绝对地址拼事件流的
      // WebSocket（自定义协议下 location.host 不是后端地址）。
      if (typeof origin === 'string' && origin !== '') {
        body = Buffer.from(injectOriginMeta(body.toString('utf8'), origin), 'utf8')
      }
    } catch (error) {
      // 保留真实错误码：EACCES / EISDIR 与 ENOENT 的修复方向并不相同，
      // 一律报「不在包内」会把排查引向错误的方向。
      const code = (error && error.code) || (error && error.message) || 'unknown'
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`dsh-em-agent: cannot read panel.html (${code})`)
      return
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(body.length),
      [MARKER_HEADER]: 'panel',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}

/**
 * 算出面板对客户端可见的 origin。
 *
 * 桌面版后端端口每次启动都不同（实测 6222 / 9385 / 9530），所以必须从
 * webServer 的真实监听状态取，不能写死；`0.0.0.0` 对浏览器不可点击，
 * 归一成回环地址。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {string | null} 形如 `http://127.0.0.1:<port>`，取不到返回 null
 */
function panelOrigin(ctx) {
  const port = ctx.webServer.port
  const host = ctx.webServer.host
  if (typeof port !== 'number' || typeof host !== 'string') return null
  const display = host === '0.0.0.0' ? '127.0.0.1' : host
  return `http://${display}:${port}`
}

/**
 * 往宿主 index.html 里注入一个 meta，把真实 origin 交给客户端。
 * 客户端优先用相对路径；只有在相对路径拿不到面板时才用它兜底。
 *
 * @param {string} html 宿主渲染好的 index.html
 * @param {string} origin 见 {@link panelOrigin}
 * @returns {string} 注入后的 html（已存在则原样返回，避免重复注入）
 */
export function injectOriginMeta(html, origin) {
  if (typeof html !== 'string' || !origin) return html
  const tag = `<meta name="${ORIGIN_META}" content="${origin}">`
  // 幂等判断必须认「整个 meta 标签」，不能只认名字：面板自己的脚本里就带着
  // `meta[name="dsh-em-agent-origin"]` 这个选择器字面量，只查名字会误判成
  // 「已经注入过」而直接跳过，桌面版于是又掉回 file:// 降级。
  const existing = new RegExp(`<meta name="${ORIGIN_META}" content="[^"]*">`)
  if (existing.test(html)) return html.replace(existing, tag)
  const at = html.indexOf('</head>')
  return at < 0 ? tag + html : html.slice(0, at) + tag + html.slice(at)
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ routePath: string, unknownKeys: string[] }} config
 */
export function apply(ctx, config) {
  const routePath = config.routePath

  // 配置里写了插件不认识的键。不失败，但要可见 —— 否则拼错键名会表现为
  // 「配置写了却毫无效果」，正是最坏的那类失败模式。
  // 本机 DSH 的合成树里没有 logger 条目，所以 console.warn 是必要的兜底。
  if (config.unknownKeys.length > 0) {
    const detail = `dsh-em-agent: ignoring unknown config key(s): ${config.unknownKeys.join(', ')}`
    const logger = ctx.get('logger')
    if (logger !== undefined && typeof logger.warn === 'function') logger.warn(detail)
    else console.warn(detail)
  }

  ctx.effect(() => {
    const origin = panelOrigin(ctx)
    const disposers = [ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler: makeHandler(origin),
    })]
    // 旧路径别名：与主路径各自注册、各自释放
    if (LEGACY_ROUTE_PATH !== null && LEGACY_ROUTE_PATH !== routePath) {
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: LEGACY_ROUTE_PATH,
        handler: makeHandler(origin),
      }))
    }
    // 把真实 origin 注入宿主 index.html，供客户端半边兜底。
    // tapIndex 与 register 一样返回 disposer，必须一并释放，否则热重载会叠加。
    if (origin !== null && typeof ctx.webServer.tapIndex === 'function') {
      disposers.push(ctx.webServer.tapIndex((html) => injectOriginMeta(html, origin)))
    }
    return () => {
      disposers.forEach((dispose) => { try { dispose() } catch (e) { /* 已释放 */ } })
    }
  }, 'dsh-em-agent: panel route')
}
