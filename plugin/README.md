# DSH EM Agent（`dsh-em-agent` 插件包）

把 DSH EM Agent 的控制台挂成 DSH Web 的一条路由，访问地址：

```
http://127.0.0.1:3080/em-agent
```

> 📄 **从 DSH Store 下载后想直接照做一遍？** 看仓库里的
> [`docs/start/store.md`](../docs/start/store.md)：
> 安装 → 启用 → 启动 → 页面首次配置 → CST / CST MCP 依赖 → 卸载 → 排查，
> 线性写完整。下面是同一流程的简版。

---

## 为什么是插件包，而不是拷 HTML

早期做法是把 `panel.html` 拷进 DSH 的 Web 静态目录：

```
<dsh>/node_modules/@deepseek-ai/dsh-web-frontend/dist/
```

这个目录**属于 DSH 的安装目录**，升级或重装 DSH 时会被整体替换，放进去的页面会一起消失
（表现为访问突然 404）。本插件改为安装在 **profile 目录**：

```
~/.dsh/profiles/web/          # Windows: C:\Users\<你>\.dsh\profiles\web\
```

profile 属于用户数据，不随 DSH 升级丢失；页面本体随包分发，不再依赖任何绝对路径。

---

## 安装

### 1. 取得包

从 DSH Store 安装，或本地使用仓库里的 `plugin/` 目录（该目录已包含构建好的 `panel.html`）。

### 2. 装进 web profile

```bash
dsh plugin --profile web add <本插件目录或包名>
```

该命令会把参数转发给 profile 目录下的 pnpm，装进 `~/.dsh/profiles/web/node_modules`。

### 3. 在 profile 里登记插件行

编辑 `~/.dsh/profiles/web/cordis.patch.yml`，追加：

```yaml
- insert:
    - id: em-agent-panel
      name: dsh-em-agent
```

> **必须用 `insert:` 形式，且不要给它加 `id` 指向已有条目。**
> 指向不存在的 `id` 时 DSH 只会告警并**静默跳过**，表现为「插件根本没挂上」。

### 4. 重启 DSH

```bash
dsh web
```

插件随 profile 一起挂载，无需其它步骤。

> **如果只是改了 `cordis.patch.yml`，可以不重启。** 当 profile 的
> `package.json` 中 `dsh.profile.patchReload` 为 `"live"` 时，DSH 会监听该文件，
> 保存即热挂载（本仓库已实测：保存后直接访问路由返回 200，`dsh web` 未重启）。
> 冷启动则用于首次安装或升级后确认。
>
> ⚠️ **但改了 `index.js` 本身必须重启。** 已实测：用热重载把条目卸载再挂载，
> 运行中的进程拿到的仍是**旧代码**——此 profile 下实际生效的 HMR 是以 `root: []`
> 创建的（bundle 里那条带 `root: ['.']` 的 HMR 行是 `disabled: true` 的），
> 且 loader 重新 import 的是同一模块 URL，Node 的模块缓存不会失效。
> 想确认是否真的加载了新代码，一个简便判据：`POST` 到页面路由，
> 看 405 响应是否带 `Allow: GET, HEAD` 头（当前代码有，早期版本没有）。
>
> 改 `panel.html` 则**无需任何重载**——插件每次请求都重新读文件，刷新浏览器即可。

---

## 启动

```bash
dsh web
```

然后打开 `http://127.0.0.1:3080/em-agent`。

`dsh web` 的常用参数：

| 参数 | 说明 |
| --- | --- |
| `--port <n>` | 换端口（默认 3080） |
| `--host <h>` | 绑定地址（默认 `127.0.0.1`） |
| `--no-open` | 启动后不自动开浏览器 |

页面**必须**通过这个 http(s) 地址访问。直接双击 `panel.html`（`file://`）会降级为
「复制指令」模式，无法调用 CST MCP。

---

## 配置

插件行可以带一个可选的 `config` 块。**不写就是默认值**，与早期版本行为完全一致。

```yaml
- insert:
    - id: em-agent-panel
      name: dsh-em-agent
      config:
        routePath: /my-antenna        # 默认 /em-agent
```

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `routePath` | string | `/em-agent` | 页面挂载路径。必须以 `/` 开头，且不带尾斜杠 |

**要临时关掉这个页面，用 `disabled` 而不是删行。** 在插件行上加 `disabled: true`：
路由立刻撤销（该路径返回 404），**改回原值即恢复，全程不需要重启**；
因为 id 不变，也不会触发一次无谓的卸载重挂。本插件是纯消费者（没有任何插件依赖它），
所以关掉它不会波及其它插件。

**报错行为**（宽严取舍是刻意的，已逐项实测）：

| 配置 | 结果 |
| --- | --- |
| 不写 `config` | 用默认路径，正常启动 |
| `routePath: /my-antenna` | 挂到该路径，正常启动 |
| `routePath: 123` | **拒绝启动**：`invalid config: - expected string but got number (at routePath)` |
| `routePath: no-slash` | **拒绝启动**：`invalid config: - must start with "/" (at routePath)` |
| `routePath: /trailing/` | **拒绝启动**：`invalid config: - must not end with "/" (at routePath)` |
| 未知键如 `routepath: x` | **正常启动**，挂载时告警一次：`dsh-em-agent: ignoring unknown config key(s): routepath` |

> 为什么未知键不报错：严格拒绝虽然更「正确」，但配置里一个拼写错误会让
> **整个 `dsh web` 启动失败**（实测 `plugin tree failed to load`），而不只是
> 这条路由失效。爆炸半径太大，所以降级为告警，保证「配置写了却毫无效果」
> 这种情况至少是可见的。

> 校验器是手写的 **Standard Schema**，不引入 `@deepseek-ai/schemastery`：
> 后者只存在于 DSH 安装树的 `node_modules`，而本插件以 `link:` 方式装进 profile，
> Node 按真实路径解析，够不到那里。

---

## 卸载

1. 从 `cordis.patch.yml` 删掉上面那段 `insert`；
2. `dsh plugin --profile web remove dsh-em-agent`；
3. 重启 `dsh web`。

---

## 依赖

本插件只依赖 DSH 自带的 `webServer` 服务，不引入任何第三方运行时依赖。

页面本身要用起来还需要（**均不随本插件分发**）：

- **CST Studio Suite 2026**：商业软件，需自行安装授权
- **CST MCP 服务端**（`cst-studio-suite-mcp`）：独立 Python 包，需另行安装并注册到 DSH
- 页面内的「首次配置」中填写 CST 路径与 MCP 地址

---

## 页面内的扩展能力

页面自带「页面编辑器」，可以写 HTML 自由新增区块并按需扩展功能：

- 区块保存在浏览器 `localStorage`，不写回源码文件
- 支持「导出 JSON / 导入 JSON」分享区块
- 新增区块**默认允许执行脚本**（默认勾选「允许执行脚本」）；
  取消勾选后不会再次执行，但已运行脚本注册的定时器与监听需要**刷新页面**才彻底停止
- 大模型可按「数据回传协议」把每轮仿真结果回传进指定区块并渲染成表格

详见仓库根目录 `README.md` 与 `docs/`。
