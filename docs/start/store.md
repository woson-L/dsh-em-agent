# 从 DSH Store 下载后的启动说明

> **文档索引** › [开始使用](../README.md) › 从 DSH Store 下载后的启动说明


---

## 概要

```bash
# 1) 装进 web profile
dsh plugin --profile web add "git+https://github.com/woson-L/dsh-em-agent.git#path:plugin"

# 2) 在 ~/.dsh/profiles/web/cordis.patch.yml 末尾追加这一行（见第 2 节原文）
#    - insert:
#        - id: em-agent-panel
#          name: dsh-em-agent

# 3) 启动
dsh web

# 4) 打开
#    http://127.0.0.1:3080/em-agent
```

页面打开后按第 3 节填 CST 路径与 MCP 地址即可。

> 不想自己敲这些命令？见下一节「让 AI 代做」——把那段提示词整段贴给 AI 即可。

---

## 让 AI 代做（可直接复制的提示词）

不想自己敲命令，可以把下面整段贴给任意 AI（DSH 里的 agent，或别的助手），由它带你装完
并验证。提示词写清了目标、命令，以及几个会让「装了却没挂上」的坑，也要求 AI 先只读探测、
改动前备份、用真实输出回报。

> ⚠️ **它会让 AI 改动 `~/.dsh/profiles/web/` 下的文件**（安装包与 profile 里登记的那一行）。
> 提示词已要求先备份再改；不接受 AI 动这些文件，就按上面「概要」里的步骤自己走。

```text
我在本机用 DSH（DeepSeek Harness）。请帮我安装并验证 DSH EM Agent 插件，
成功标准是这条地址返回 HTTP 200：http://127.0.0.1:3080/em-agent

仓库 https://github.com/woson-L/dsh-em-agent 的 docs/start/store.md 是完整说明，
能联网就先读它；读不到就按下面的步骤做。

【工作方式，请严格遵守】
1. 先只做只读探测并把结果列给我；我确认之前不要改动 ~/.dsh 下任何文件。
2. 要改 cordis.patch.yml 时，先在同目录备份一份（后缀 .bak-<时间戳>）。
3. 每条命令都把真实输出贴给我，不要复述预期结果，也不要用「应该可以」代替执行。
4. 除非你实际跑过验证并看到 200，否则不要声称安装成功。
5. 需要重启 dsh web 的动作先提醒我，它会中断当前会话。
6. 失败先读错误原文；你自己没验证过的判断要标注「未验证」。

【第一步：只读探测，把结果报给我】
dsh --version；DSH_HOME（%DSH_HOME%，未设置则为 %USERPROFILE%\.dsh）；
~/.dsh/profiles/web/ 下 package.json 与 cordis.patch.yml 的现状；
node_modules/dsh-em-agent 是否已存在；pnpm --version；
以及 127.0.0.1:3080 是否已有进程在监听（dsh web 可能正在运行）。

【第二步：安装】
dsh plugin --profile web add "git+https://github.com/woson-L/dsh-em-agent.git#path:plugin"
装完核对 ~/.dsh/profiles/web/node_modules/dsh-em-agent/ 里能看到 index.js 与 panel.html。

【第三步：启用】
插件自带 dsh.bundle.patch，安装时可能已自动登记进 dsh.profile.bundles。先看 profile 的
package.json 里有没有 dsh-em-agent：
- 有 → 不要再手工加行，直接进第四步。
- 没有 → 在 ~/.dsh/profiles/web/cordis.patch.yml 顶层数组末尾追加：
    - insert:
        - id: em-agent-panel
          name: dsh-em-agent
  三条硬约束：
  · 必须用 insert: 形式。带 id: 指向不存在条目的覆盖形式只告警然后静默跳过，
    表现是「按说明做了，插件却没挂上」，而且没有任何报错。
  · id 不能省，必须是 em-agent-panel（与插件自带的 cordis.patch.yml 一致）。
  · 只能登记一次。自动登记与手工行并存会以同一 id 插入两次，loader 抛
    duplicate loader entry id，DSH 直接起不来。
保存该文件是热生效的，不用重启；但改插件代码（index.js）必须重启。

【第四步：启动并验证】
没有在跑就 dsh web 启动（默认 127.0.0.1:3080；它会自动开浏览器，同时给我种下登录 cookie）。
验证：curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/em-agent → 必须 200。
若是 404：先查缩进与 insert 形式，再重启一次 dsh web 确认。

【第五步：把结果报给我】
/em-agent 的状态码与响应字节数；浏览器打开后是否自动弹出「首次配置」面板；
没做到的项逐条说明原因，不要含糊过去。

【边界：这些不要做】
- 不要把页面复制进 DSH 安装目录 <dsh-web-frontend>/dist/，那条静态部署路径已退役。
- 不要往 desktop profile 装：它由 DSH 桌面版（Electron）独占，CLI 会直接拒绝。
- 不要改插件自身的 index.js / panel.html；装不上就如实报告。
- 页面能开但点「启动仿真」报 401，不是插件坏了：先访问一次主界面
  （形如 http://127.0.0.1:3080/?token=…）种下登录 cookie 即可。
- CST Studio Suite 与 CST MCP 都是可选的，装不上不影响页面打开，别为此卡住。
```

---

## 前置条件

| 项 | 必需 | 说明 |
| --- | --- | --- |
| DSH | ✅ | 提供 `dsh` 命令。`dsh --version` 能出版本号即可 |
| pnpm | ✅ | `dsh plugin` 会把参数转发给 profile 目录下的 pnpm |
| CST Studio Suite 2026 | ⬜ | **不装也能打开页面**，只是不能真正跑仿真（商业软件，需自行授权） |
| CST MCP 服务端 | ⬜ | 同上。不装则页面停在「MCP 未连接」，其余配置功能照常可用 |
| Python ≥ 3.10 | ⬜ | 仅 CST MCP 需要 |

> **本插件包不包含 CST，也不包含 CST MCP。** 二者都是独立软件。
> 页面本体、配置记忆、指令生成、页面编辑器都不依赖它们，可以先跑起来看。

---

## 安装与启用

### 安装

```bash
dsh plugin --profile web add "git+https://github.com/woson-L/dsh-em-agent.git#path:plugin"
```

这条命令在 `~/.dsh/profiles/web/` 下执行 pnpm，把包装进该 profile 的
`node_modules`。装完可以核对：

```bash
ls ~/.dsh/profiles/web/node_modules/dsh-em-agent     # 应能看到 index.js / panel.html
```

### 启用

插件不会自己挂上，需要在 profile 的补丁层里登记一行。编辑
`~/.dsh/profiles/web/cordis.patch.yml`，在**顶层数组末尾**追加：

```yaml
- insert:
    - id: em-agent-panel
      name: dsh-em-agent
```

三个容易踩的点：

1. **必须用 `insert:` 形式**。写成带 `id:` 指向已有条目的覆盖形式，DSH 找不到该 id
   时会**只告警然后静默跳过** —— 表现就是「按说明做了，插件却没挂上」，且没有报错。
2. **`id` 不要省**。没有 `id` 的条目在每次读取配置时都会被分配一个新 id，
   于是配置文件里任何一处改动（哪怕与这一行无关）都会把它当成「先删后加」重新挂载一次。
3. **`name` 填包名 `dsh-em-agent`**（即 `package.json` 里的 `name`）。
   当前版本插件内部的 `export const name` 也是 `dsh-em-agent`，两者一致；
   更早的内部名是 `antenna-optimizer`，那时才对不上。

> **改完这一行不需要重启。** profile 默认 `patchReload: "live"`，DSH 会监听该文件，
> 保存即热挂载。但**改插件代码（`index.js`）必须重启** —— 热重载不会让 Node
> 的模块缓存失效，重新挂载拿到的仍是旧代码。

### （可选）省掉第 2.2 步的自动挂载

如果你在维护本插件并希望 `dsh plugin add` 一步到位，可以给包的 `package.json` 加：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

并让包自带一个 `cordis.patch.yml`。这样 DSH 在安装时会自动把包名加进
`dsh.profile.bundles`，无需手工登记。

> ⚠️ **两种方式互斥。** 一旦走自动挂载，就**必须**删掉 2.2 里手工加的那一行，
> 否则同一条路由会被注册两次，`webServer.register` 会因重复的 `(kind, path)` 直接抛错。

---

## 启动与验证

```bash
dsh web                      # 默认 127.0.0.1:3080，并自动打开浏览器
dsh web --port 8080          # 换端口
dsh web --no-open            # 不自动开浏览器
dsh web --host 0.0.0.0       # 换绑定地址
```

打开  http://127.0.0.1:3080/em-agent

> 🔑 **`/em-agent` 这个地址本身不需要 token，但它调用的 `/api/*` 需要 DSH 的登录 cookie。**
> 该 cookie（`Path=/`、`HttpOnly`）是 `dsh web` 自动打开主界面时种下的——那次打开的地址
> 形如 `http://127.0.0.1:3080/?token=…`，服务端校验后 303 跳到干净的 `/` 并下发 cookie。
> 所以正常流程（`dsh web` 自动开浏览器）什么都不用做；只开 `/em-agent` 也能看到完整界面，
> 但如果这个浏览器**从没访问过主界面**（换了浏览器、清了 cookie、或用了 `--no-open`），
> 「启动仿真」一类动作会报 401。遇到就先去一次主界面。

一条命令确认服务端确实挂上了：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/em-agent
# 期望 200；404 说明第 2.2 步那一行没生效
```

> ⚠️ **页面必须通过这个 http 地址访问。** 直接双击 `panel.html`（`file://`）只能看到
> 界面：依赖同源的能力（启动仿真、目录选择器、实时订阅、CST MCP 调用）都会降级为
> 「复制指令」模式。

---

## 页面内首次配置

首次打开会自动弹出配置面板（以后点顶栏的齿轮图标可再次打开）。

### 要填什么

| 字段 | 填什么 | 例子 |
| --- | --- | --- |
| **CST 安装根目录** | CST Studio Suite 的安装根，**绝对路径** | `C:\Program Files\CST Studio Suite 2026` |
| **CST 可执行文件** | 上表根目录下的 `AMD64` 子目录里的主程序，**绝对路径** | `C:\Program Files\CST Studio Suite 2026\AMD64\CST DESIGN ENVIRONMENT_AMD64.exe` |
| **MCP 服务名** | 与你在 DSH 里注册的 `serverName` 完全一致 | `cst-studio-suite` |
| **MCP 传输方式** | 本机 Python 起进程用 `stdio` | `stdio（启动本地进程）` |
| **MCP 启动命令** | Python 解释器的绝对路径 | `C:\Program Files\Python311\python.exe` |
| **MCP 启动参数** | MCP 服务端入口脚本的绝对路径 | `C:\CST-MCP\mcp_server.py` |
| **工作区目录** | CST 工程与工作副本的存放目录 | `C:\CST_Workspace\cst_runs` |

> 选择 `stdio` 时，启动命令与参数会**自动以环境变量的形式写进任务指令**
> （这是 DSH 侧 `mcp-client` 的约定），所以你不需要另外手工导出这些变量。
> 选 `http` 只填一个 URL 即可。

### 面板自带的检测

配置面板里的「本机自检」只校验**你填的路径是否真实存在**，它**不代表 MCP 已经连上**。
真正的连通性由任务执行时的 MCP 调用决定。页面顶栏的 `CST MCP：任务内探测` 就是这个含义。

### 这些配置存在哪

存在**浏览器 `localStorage`**（键 `page-setup-v1`），**不写回任何源码文件**，也不发往第三方。

> ⚠️ **localStorage 与 origin 绑定。** 换端口、换 host、换协议都会导致读不到旧配置
> （`http://127.0.0.1:3080` 与 `http://127.0.0.1:8080` 是两份独立存储）。
> 决定换地址之前，先用页面上的导出功能把数据带走。

---

## 把 CST MCP 注册到 DSH

这一步在 **DSH 侧**做，不在本插件里。编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: mcp-cst-studio-suite
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: cst-studio-suite
        transport: stdio
        command: C:\Program Files\Python311\python.exe
        args:
          - C:\CST-MCP\mcp_server.py
        env:
          CST_INSTALL_ROOT: C:\Program Files\CST Studio Suite 2026
          CST_DESIGN_ENVIRONMENT_EXE: C:\Program Files\CST Studio Suite 2026\AMD64\CST DESIGN ENVIRONMENT_AMD64.exe
          CST_MCP_WORKSPACE: C:\CST_Workspace\cst_runs
          CST_MCP_EVIDENCE: C:\CST_Workspace\cst_runs\evidence
        cwd: C:\CST-MCP
```

`serverName` 必须与第 4.1 节页面里填的**完全一致**，否则页面找不到这个 MCP。

> **进程环境变量优先于 `.env`。** 如果你的 MCP 服务端自带 `.env`，上面 `env:` 块里的
> 键会覆盖它。两边都写了工作区路径时，以这里为准 —— 这是一处曾经踩过的坑：
> 两边不一致会让工程和证据文件落到预期之外的位置。**保持两处一致，或者只留一处。**

---

## 卸载

```bash
# 1) 从 cordis.patch.yml 删掉第 2.2 节那段 insert
# 2) 移除包
dsh plugin --profile web remove dsh-em-agent   # 卸载时用包名即可
# 3) 重启（或保存 patch 文件触发热卸载）
dsh web
```

浏览器里的配置与自定义区块仍在 `localStorage`，不会被卸载动作清掉。
要一并清除，在页面控制台执行 `localStorage.clear()`，或在浏览器站点设置里清除该源的数据。

---

## 排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `/em-agent` 返回 404 | patch 行没生效，或 `id` 指向了不存在的条目被静默跳过 | 检查 patch 文件里的 `insert` 形式与缩进；重启一次 `dsh web` 确认 |
| 保存了 patch 文件但路由没变 | 热加载只覆盖配置文件，不覆盖插件代码 | 路由相关的 patch 改动会热生效；`index.js` 的改动必须重启 |
| 页面能开但按钮都是「复制指令」 | 用了 `file://` 直接打开 | 改用 `http://127.0.0.1:<端口>/em-agent` |
| **页面能开、界面正常，但点「启动仿真」报 401 / 传输失败** | 浏览器还没有 DSH 的登录 cookie（从未访问过主界面，或 cookie 已被清） | 先打开一次 `dsh web` 自动给出的主界面地址（形如 `http://127.0.0.1:3080/?token=…`），cookie 种下后 `/em-agent` 即可正常使用 |
| **点「发送环境探测指令」报 `DSH 传输失败（HTTP 404）`** | 面板与 DSH 之间的 RPC 协议不匹配：旧构建发点号式端点 `session.create`，而当前 DSH 要求两段式 `/api/session/create` | 2026-10-01 已修（补丁 P57）。若仍出现，说明装的是旧包：重装一次并确认 `node_modules/dsh-em-agent/panel.html` 是新的。契约细节见 [与 DSH 的 RPC 契约](../dev/dsh-rpc.md) |
| 右栏一直空着、看不到模型输出 | 会话事件流没连上 | 2026-10-01 起已接通（`/api/remote.mux` 上的 `session/follow`）。若仍为空：确认装的是新构建、刷新页面重连一次，并看左下角操作日志里有没有「会话事件流出错」 |
| 顶栏一直显示 MCP 未连接 | MCP 未注册，或页面里的「MCP 服务名」与 `serverName` 不一致 | 对照第 5 节与第 4.1 节 |
| 换端口后配置全没了 | localStorage 按 origin 隔离 | 回到原地址导出，或重新配置 |
| 想临时关掉页面但保留安装 | — | 在该行加 `disabled: true`，比删行更好：id 不变，不触发无谓的重挂 |
