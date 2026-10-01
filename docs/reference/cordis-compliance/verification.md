# 合规审阅 · 补验与复现

> **文档索引** › [参考](../../README.md) › 合规审阅 › 补验与复现

> 返回 [合规审阅总览](../cordis-compliance.md)

首轮审阅列出的四项未验证项，全部补做了实验。方法：隔离 profile + 探针插件，
生产实例全程未受影响。复现步骤在各节内。

## 未验证项 → 补验结果（2026-09-29）

首轮审阅列出的四项未验证项已全部补做实验。方法：在隔离 profile（`webverify`）中放入一个"探针插件"，每次 `apply` 调用都向日志追加一行，并配合自毁定时器实现免 kill 退出；生产实例全程未受影响。

### ✅ 补验 1：`id` vs 无 `id` —— 官方说法成立

**实验**：在同一次启动中放两条配置**完全相同、只差 `id`** 的探针条目（`probe-a` 带 `id`，`probe-b` 不带），然后只向 `cordis.patch.yml` 追加一行**无关注释**，不触碰任何条目。

**结果**：

```
改动前 APPLY 行数: 4
已追加一行无关注释 ...
改动后 APPLY 行数: 5  (新增 1)

新增行: APPLY ... json={"route":"/probe-b","marker":"without-id"} route=/probe-b

带 id 的 probe-a 被重挂: 0 次
无 id 的 probe-b 被重挂: 1 次
```

**结论**：教程第 6 章「只要配置文件发生任何编辑，即使自身文本未变，它也会被视为先删除再添加并重新挂载」**完全成立**。带 `id` 的条目纹丝不动。这确认了本插件那一行带 `id` 是必要而非多余的。

另注：启动后约 543ms 还观察到一次**自发的** probe-b 重挂，说明 patch 列表在启动流程中会被再读一次——无 `id` 的条目在启动阶段就已经多挂了一次。

### ✅ 补验 2：HMR 文件保存重载 + effect dispose —— 通过

**实验**：先通过 id 定向覆盖把 bundle 那条 `disabled: true` 的 hmr 打开（`disabled: false` + `root: ['./probe']`），使 HMR 真正监视源码目录；然后修改 `probe/probe-plugin.js`。

**结果**：

```
改动前 APPLY 行数: 5
已修改 probe-plugin.js, 等待 HMR 重载...
改动后 APPLY 行数: 8  (新增 3)

  APPLY ... json={"route":"/probe-a",...} route=/probe-a
  APPLY ... json={"route":"/probe-b",...} route=/probe-b
  APPLY ... json=undefined route=/probe-default

/probe-a -> HTTP 200   /probe-b -> HTTP 200   /probe-default -> HTTP 200
stderr 含 duplicate: False   含 Error: False
```

**结论**：HMR 确实"先卸载、再加载"——三个条目全部重新 `apply`。**且这构成 dispose 的强证据**：三条路由都重新注册了**同一个** `(kind, path)`，如果旧注册未被释放，`webServer.register` 会因重复注册直接抛错。stderr 干净、路由全部正常，说明 `ctx.effect` 的 disposer 在 HMR 卸载路径上确实执行了。

这条与首轮 4.1 的 `disabled` 往返互补：两条卸载路径（loader 决策 / HMR 文件重载）都验证过了。

### ✅ 补验 3：`apply` 的第二个参数 —— `undefined`，不是 `{}`

**结果**：

```
APPLY ... typeof=object    json={"route":"/probe-a","marker":"with-id"}
APPLY ... typeof=object    json={"route":"/probe-b","marker":"without-id"}
APPLY ... typeof=undefined json=undefined
```

**结论**：**没有 `config:` 块时，`apply` 收到的是 `undefined`**，不是空对象。而**有** `config:` 块时原样传入。

这一点对 3.1 的修复方案很重要，且印证了我选择的做法：**没有 `Config` schema 时 Cordis 不做任何解析**，`apply` 拿到什么完全取决于 YAML 里写没写。加上 Standard Schema 后，`validate` 会解析出完整对象（含默认值），`apply` **永远**收到一个字段齐全的对象——这正是教程第 5 章「显式优于隐式」所要求的 resolve 步骤。

顺带排除了一个隐患：如果将来有人把 `apply(ctx)` 改成 `apply(ctx, config)` 并直接写 `config.routePath`，在原状态下会因 `undefined` 而**抛错**。

### ✅ 补验 4：并发 `readFile` —— 通过

**实验**：对生产路由 `/antenna-optimizer` 发 60 个真并发请求（Node `fetch` + `Promise.all`）。

**结果**：

```
并发 60 请求  用时 92ms  (1.5ms/请求)
HTTP 200 且 187400 字节: 60/60
响应体哈希种类: 1  5bba26e99c62f9a0
失败: 0
```

**结论**：每请求完整读取 187 KB、无缓存的做法在本地单用户场景下没有并发问题（60×187KB ≈ 11 MB，92ms 内由页缓存消化）。无需为此加缓存；且不加缓存换来了"改页面即时生效、无需任何重载"这个有用特性。

### 仍在验证范围之外的事项

以下三项**仍未经实验**，不做推断性声明：

1. **`disabled` 对 HMR 去抖的具体时序**（例如极短时间内的连续保存是否会被合并）未测量。
2. **`@deepseek-ai/dsh-hmr` 这个包名**：教程第 6 章写的是 `@deepseek-ai/dsh-hmr`，但在本机 npm 安装的 DSH 里**该包不存在**，实际包名是 `@deepseek-ai/cordis-plugin-hmr`。差异原因（教程面向的是 clone 下来的 deepseek-harness 仓库，而本机是 npm 全局安装）未进一步查证。
3. **logger-console 导出器缺失**：本机 DSH 安装树里没有 `@deepseek-ai/cordis-plugin-logger-console`，因此 HMR 自身的日志不可见。本次实验改用探针插件自记录绕开了这一点，但"官方推荐的 HMR 日志可见性"在本环境里是否可达，未验证。


---

## 附录 A：P0 修复代码（已实测验证）

用**零依赖 Standard Schema**替代 schemastery（理由见 3.1）：

```js
/** 默认路由路径。 */
export const DEFAULT_ROUTE_PATH = '/antenna-optimizer'

/**
 * Standard Schema 校验器：未知键与非法值都明确报错，不静默吞掉。
 * 不引入 @deepseek-ai/schemastery：它只在 DSH 安装树里，
 * 软链安装的插件按真实路径解析，够不到 profile 的 node_modules。
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-em-agent',
    validate(value) {
      const issues = []
      const input = value === undefined || value === null ? {} : value
      if (typeof input !== 'object' || Array.isArray(input)) {
        return { issues: [{ message: 'expected an object', path: [] }] }
      }
      for (const key of Object.keys(input)) {
        if (key !== 'routePath') {
          issues.push({ message: `unknown config key "${key}"`, path: [key] })
        }
      }
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
      return { value: { routePath } }
    },
  },
}

export function apply(ctx, config) {
  const routePath = config.routePath
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })   // P0: RFC 9110 §15.5.6
        res.end()
        return
      }
      let body
      try {
        body = await readFile(PANEL)
      } catch (error) {
        const code = error && error.code ? error.code : 'unknown'   // P1: 保留真实错误
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`antenna-optimizer: cannot read panel.html (${code})`)
        return
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': String(body.length),
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  }), 'antenna-optimizer: panel route')
}
```

**实测验证结果**（隔离 profile，生产实例未受影响）：

| 场景 | 配置 | 结果 |
| --- | --- | --- |
| A 错误配置 | `routePath: 123` + `bogusKey: xyz` | ✅ `ValidationError: invalid config:` 并逐条列出两个问题及路径，进程非零退出 |
| B 合法自定义路径 | `routePath: /custom-antenna` | ✅ `/custom-antenna` → 200/187400 字节；`/antenna-optimizer` → 404 |
| C `Allow` 头 | `POST /custom-antenna` | ✅ 405 且 `Allow = 'GET, HEAD'` |

对照修复前同一场景 A：**stderr 完全为空，路由仍挂在硬编码路径上**。

---

## 相关文档

- [合规审阅总览](../cordis-compliance.md)
- [逐条判定](findings.md)
- [回归测试](../../dev/tests.md)
