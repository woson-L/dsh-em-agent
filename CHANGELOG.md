# 变更记录

本项目的版本号以 `plugin/package.json` 的 `version` 字段为准。
**仓库首个公开发布版本为 `0.1.0`**：在此之前项目从未对外发布过（内部编号不构成发布记录）。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

---

## [0.3.0] — 2026-11-14

界面 v2：显示层重构。**唯一构建仍是 `build/build.ps1`**（176 处补丁、七道门禁），
`plugin/panel.html` 就是它的产物；不存在第二套构建或第二份面板。

### 变更

- 顶栏压缩：品牌 + DSH/CST 状态 + 任务操作在一条；五个 KPI 收为一行统计
- 显示偏好条：布局（配置 + 结果 / 专注结果）、比例 40/45/50、密度舒适/紧凑、主题三态；
  偏好存 `dsh-em-agent-display-v1`，与仿真配置分离
- 运行记录改为日志行：模型输出 / 工具步（可展开结果）/ 面板事件按「时间 · 来源 · 内容」追加；
  表头有阶段胶囊、来源筛选（全部 / 模型 / 工具 / 面板）、跟随最新、诊断（事件 seq）
- 追加指令改为命令条：`›` 前缀、三行文本域、可拖高；复制 / 仅生成 / 清空收进条上方
- 频段改为紧凑行；图表与结果表统一取 `allBands()`，开关与阈值改动即时重绘
- 常驻解释性小字清零（移入「说明」面板或删除），规则改由控件本身表达
- 扩展区 `UBExtensions.register/show`，带 `dispose` 生命周期
- 工程预检、操作日志、页面编辑器默认收起

### 验证

- v1 构建 176 处补丁、七道门禁全过；产物 278,707 字节
- `test-manifest` 27 条、`test-ui` 26 条、`test-controls` 15 条，均在 `panel.html` 上通过
- 8 张截图：1440 / 1024 / 768 / 390 × 浅深主题

### 运行桥接（headless 入口）

- 面板「启动仿真」改为走宿主 `POST /em-agent/run`：以 `dsh --profile headless --json`
  起子进程，JSONL 事件流经 SSE 回到「运行记录」渲染，**不再依赖 DSH 的对话 surface**
- 新增运行设置：MCP 包目录（自动派生 python / mcp_server.py，运行时生成临时
  `dsh.patch.yml` 并在结束后删除，不写任何 profile 文件）+ 审批二选一
  （`workspace-write` / `danger-full-access`，默认后者）
- 并发默认 1，读 `DSH_EM_AGENT_MAX_CONCURRENT`（1–8），超限 429；多并发仿真留作路线图
- 安全：所有运行路由要求 `x-em-token`（宿主每次 apply 重生成，仅注入同源面板）；
  patch 以 JSON 标量序列化，不做字符串拼接
- 新增测试：`test/test-runhost.cjs`（17 条，假 dsh 桩）、`test/test-runloop.cjs`（浏览器端到端）
- 新增工具：`tools/restart-web.ps1`（可复现重启 + 自验）、`tools/verify-runhost.ps1`
- **会话隔离**：每次 run 的 patch 把 `session-persistence-jsonl.root` 指向插件私有目录
  （默认 `%TEMP%\dsh-em-agent-sessions`），headless 不再往 `~/.dsh/sessions` 写，
  工作区侧栏不会多出会话，也就不存在「点进会话回不来」
- **权限钉死**：patch 显式设置 `sandbox-policy.mode` 与 `approval.policy`，
  不依赖 `DSH_PERMISSION_MODE` 传导（该变量在 0.2.0 安装包里只由 profile 的 `!!js` 读取）
- 单测扩到 24 条，覆盖 session root、approval policy 与 MCP 派生
- **运行设置落盘到宿主**：`%LOCALAPPDATA%\dsh-em-agent\settings.json`，解决桌面版端口每次
  变化导致 localStorage 失效、「重开插件页面设置丢失」的问题；localStorage 降级为缓存
- 新增 `GET/POST /em-agent/settings`，只接受 `mcpDir` 与 `policy`，其余键丢弃
## [Unreleased]

界面改版（《外观与交互设计修改意见书》）。只改样式与事件渲染，配置字段与下发指令不变。

### 变更

- **视觉减法**：纯 `#F8FAFC` 底 + 白卡细边，取消背景渐变、颗粒纹理、卡片阴影与装饰渐变线；
  圆角统一为卡片 12px / 控件 6px，控件高度统一 38px，字号改为 14px 正文阶梯
- **频段改紧凑行**：三个预设频段从卡片改为行（启用 / 频段 / S11 阈值 / 谐振），未启用行降为次要色
- **右栏顺序调整**：运行监控（曲线 + 结果表）→ 事件流 → 对话输入 → 结果证据 → 执行方式
- **运行记录改为日志行**：模型输出、工具步与阶段按「时间 / 来源 / 内容」追加，取代对话气泡；
  流式片段继续追加到同一行
- **首次配置面板**：标签列 118px、细边分区、自检项改为紧凑网格，去掉底部投影
- **顶部任务台压缩**：五个 KPI 大块改为一行统计（迭代 / 对话轮次 / 最差 S11 / 最佳候选 / 状态）
- **左栏字段改为标签在上**，路径输入获得整行宽度；「选择文件…」为主入口，扫描与浏览降为次要
- **运行记录表头**：阶段胶囊 + 来源筛选（全部 / 模型 / 工具 / 面板）+ 跟随最新 + 诊断（事件 seq）
- **追加指令改为命令条**：`›` 前缀、三行文本域、上方拖高把手（76–320px），复制 / 仅生成 / 清空收进条上方

- **显示层**：布局（配置 + 结果 / 专注结果）、比例 40/45/50、密度舒适/紧凑、主题三态；
  偏好存 `dsh-em-agent-display-v1`，与仿真配置分离
- **说明面板**：常驻解释性文案移入「说明」；主界面只留字段、单位与错误
- **运行记录**：新增工具结果行（`tool/result`）、超长消息折叠、手动上滚暂停跟随、「复制记录」
- **频段模型**：图表与结果表统一取 `allBands()`，开关与阈值改动即时重绘
- **扩展区**：`UBExtensions.register/show`，带 `dispose` 生命周期；示例模块只显示空态
- **页面编辑器**：长说明移入「说明」面板；脚本执行风险提示保留在主界面
- **说明面板**：补充队列发送与页面编辑器规则
- **焦点管理**：说明面板与首次配置弹窗支持焦点进入、Tab 循环、关闭恢复

### 文档

- [配置区字段说明](docs/panel/sections.md)：频段行、右栏顺序与日志行说明
- [构建与硬门禁](docs/dev/build.md)：补丁数 133 → 135

## [0.1.0] — 2026-10-01

首次公开发布。DSH EM Agent 把「CST 电磁仿真优化」的全流程做成一个 DSH 插件页面：
在单文件控制台里配置任务、把指令下发给大模型、经 CST Studio Suite MCP 驱动 CST 求解，
并实时回看 S11 曲线与逐轮结果。

### 包含的能力

- **配置与指令**：①–⑥ 六张配置卡 → `buildInstruction()` 生成结构化任务指令（含频段指标、
  迭代控制、高级设置、刚性约束、馈电端口注意事项、数据回传协议）
- **固定约束 FC1 / FC2**：厚度与平面、可改动范围两条用户约束，在指令、预检与补齐轮逐轮重申
- **工程预检**：只读预检 → 结论由结论行判定 → 未通过时自动补齐（轮次可配 0–5，默认 2）→
  轮次用尽后**仍照常开启仿真**，只留一条可见警告
- **运行监控**：S11 曲线按轮次分桶、每轮取该轮最优，最佳轮次高亮；结果汇总表按全部采集点保守汇总
- **会话事件流**：`/api/remote.mux` 上的 `session/follow`，右栏实时显示对话与工具步
- **页面编辑器**：不改源码新增 HTML 区块，接收模型回传的结构化数据（`dsh-block-data`）
- **双主题**：跟随系统 `prefers-color-scheme`

### 工程约束

- 单文件产物（内联全部 CSS 与图标），约 223 KB，运行时零依赖
- 构建模型：不可变基线 + 编号补丁 → 产物可**逐字节**证明等于「基线 + 恰好这些改动」
- 七道硬门禁 + 十一个真浏览器回归套件（见 [构建与硬门禁](docs/dev/build.md)、[回归测试](docs/dev/tests.md)）

### 公开发布前的脱敏与整理

首次公开的代码树做过一次脱敏，改动仅限「暴露作者本机环境」的字符串，不涉及任何行为：

| 处理 | 说明 |
| --- | --- |
| 本机绝对路径 | 作者工作区、仓库路径、MCP 路径、测试夹具里的盘符统一改为 `C:\` 惯用示例（`C:\CST_Workspace`、`C:\CST-MCP` 等） |
| 基线内的两处默认路径 | 直接改为中性值；对应的两处补丁随之成为空操作（保留编号以避免后续补丁重编号） |
| 进程号 | 文档中的 `PID <数字>` 改为 `PID <已隐去>` |
| 一次性验证日志 | `docs/reference/history/` 整目录不入库（`.gitignore` 已排除），索引中不再登记 |
| 发布流程类文档 | 三份元文档（发布计划、上架手册、就绪度评估）留在本地开发仓库，不随公开仓库分发 |
| 截图 | `dist/shots/` 不入库；如需展示请用脱敏后的示例值重新生成 |
| 许可证文件 | `LICENSE` 保持原样 MIT 正文，第三方组件声明拆到 `THIRD_PARTY_NOTICES.md` —— 混在同一文件会让 GitHub 把许可证判为 `NOASSERTION` |

脱敏后重新构建，产物与脱敏前**逐字节相同**（SHA256 一致），七道门禁全过 —— 这是
「只改示例、不改行为」的可验证证据。

### 已知限制

见 [README · 已知限制](README.md#已知限制) 与 [排查](docs/dev/troubleshooting.md)。

---

## [0.2.0] — 2026-10-18

### 新增：DSH 桌面版支持（与 Web 端同一份产物）

桌面版是**独立的 profile**（`~/.dsh/profiles/desktop`），也是**独立的更新通道**
（本次为 `0.2.1-rc.2`，同期 Web 侧 CLI 为 `0.2.0-rc.2`）。但它和 Web 用的是**同一套
`dsh-web-app` 组合**，所以宿主的 `webServer` 与 `/em-agent` 路由在两端行为一致：

| 断言 | Web（3080） | 桌面版（每次启动端口不同） |
| --- | --- | --- |
| `GET /em-agent` | 200 / 229026 | 200 / 229026 |
| `POST /em-agent` | 405 + `Allow: GET, HEAD` | 405 + `Allow: GET, HEAD` |
| 与 `plugin/panel.html` | 逐字节一致 | 逐字节一致 |

安装必须走**桌面版自带的载体 CLI**——npm 装的 `dsh` 会硬拒 desktop profile
（`profile "desktop" is managed exclusively by the Electron application`）：

```
<安装目录>\resources\runtime\cli\bin\dsh.cmd plugin --profile desktop add "link:<仓库>/plugin"
```

### 新增：打开应用即自动弹出的模态入口

`plugin/client.js` 是本插件的**客户端半边**，由我们自己的 `plugin/package.json` 的
`dsh.client` 段声明（不是官方文件）。它注册三处：

| 位置 | Slot | 作用 |
| --- | --- | --- |
| 模态弹窗 | `shell.overlay`（id `em-agent-modal`） | **每次打开应用自动弹出**；5cm 高、宽度自适应、遮罩 + 焦点约束 + 右上角关闭 |
| 顶栏胶囊 | `conversation.header.leading` | 关掉弹窗后再打开；28px 高、发丝边框 |
| 整页 | `main`（keyed = `em-agent`） | `<iframe>` 承载控制台，是「开启 EM 仿真」的落点；右上角「返回对话」 |

弹窗内容是 `EM Agent` / `硬件设计控制台` / 一行前置条件，加两个动作：
`开启 EM 仿真`（实心，调 `ctx.layout.selectPanel('em-agent')`）与 `稍后再说`（仅关闭）。
高度用 CSS 物理单位写成 `5cm`（1cm = 96/2.54 px，实测 188.97px）；宽度
`clamp(320px, 100vw - 48px, 560px)`；Tab 在弹窗内循环、Esc 关闭、点遮罩关闭、
关闭后焦点回到触发处。

**为什么弹窗挂 `shell.overlay` 而不是顶栏**：那是「整帧浮层，盖住所有列、在滚动容器
之外」的 seat；塞进顶栏会被列的层叠与滚动裁掉，换个面板还会消失。

**为什么顶栏入口不用 `shell.leading`**：那是「整窗左上角」的 seat，但官方
`dsh-client-ui-layout` 只在 `darwin && sidebarCollapsed` 时才把它挂到 DOM 上
（`leadingMounted = darwin && sidebarCollapsed`），Windows 上永远不渲染。

**配色不硬编码**：一律取宿主主题令牌（`--dsw-alias-bg-overlay`、`--dsw-alias-border-l1`、
`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`），明暗两套随宿主切换；
样式只注入本插件自己的 `dsh-em-agent-*` 类名，卸载时一并移除。

**端口不写死**：桌面版后端端口每次启动都不同（实测 `6222 → 9385 → 9530 → 13502`）。
宿主用 `ctx.webServer.port` / `.host` 算出真实 origin，经 `tapIndex` 注入
`<meta name="dsh-em-agent-origin">`；客户端优先用相对路径 `/em-agent`，并靠 `HEAD`
响应里的 `x-dsh-em-agent: panel` 标记判断相对路径是否真的命中面板，未命中才退到绝对 origin。

> **为什么是 iframe 而不是重写前端**：面板是 228 KB 单文件产物，靠「同源」拿 cookie、
> localStorage 与 `/api/*`；重写等于再造一个前端，还会破坏「单文件、零依赖」的构建模型。
> iframe 让产物保持一份、两端共用。

### 修复：桌面版里「DSH 离线（file:// 降级）」

桌面版打开控制台时，顶栏显示 `DSH: 离线（file:// 降级）`、`CST MCP: 需同源地址`，
依赖同源的按钮全部退化成「复制指令」，而同一份页面在 Web 端完全正常。原因是面板里
两处**把「同源」等同于 http(s)**，而桌面版渲染层是 `dsh-app://` 自定义协议：

| 基线里的写法 | 在 `dsh-app://` 下的结果 |
| --- | --- |
| `isDSHSameOrigin()` 只认 `http:` / `https:` | 整页判定为离线，MCP 与事件流一起失效 |
| 事件流地址用 `ws://` + `location.host` | host 是 scheme 的 host，连不到后端 |

修复（两处都写进 `build/build.ps1` 的补丁，基线仍然只读）：

- **P70**：`isDSHSameOrigin()` 改为「http(s) 直接算同源；其余协议下，只要宿主注入过
  `<meta name="dsh-em-agent-origin">` 就算同源」
- **P71**：事件流 WebSocket 优先用注入的 origin 拼绝对地址，没有才回落到相对写法
- 宿主侧把真实 origin 也注入**面板 HTML 本身**（不只有 `index.html`），面板因此
  才知道后端端口；注入按「整个 meta 标签」做幂等判断

> 顺带修掉一个真 bug：`injectOriginMeta` 原先用「页面里有没有这个字符串」判幂等，
> 而 P70 之后面板脚本自己就含该字面量，注入被跳过、桌面版继续掉回降级 —— 现在改为
> 匹配 `<meta ...>` 标签本身。`test/test-manifest.cjs` 增加「注入 meta 后其余字节
> 与 `panel.html` 逐字节一致」的断言，防止路由私自改动产物。

### 已知限制：两端的存储不共享

两端 **origin 不同**（Web 是 `127.0.0.1:3080`，桌面版是它自己那个端口），所以
`page-setup-v1`（首次配置）与 `page-blocks-v1`（自定义区块）**各存一份**，需要各填一次；
迁移用页面自带的「导出 / 导入 JSON」。

### 测试

`test/test-manifest.cjs` 24 → **27 条**：新增 `dsh.client` 段与 `./client` 导出、客户端工厂
id 必须等于包名、`x-dsh-em-agent` 标记头、以及 `tapIndex` 注入 meta
（端口取自 `webServer`、且重复注入幂等）。

---

## [0.1.2] — 2026-10-18

### 变更：peer range 放宽到 DSH 0.1 与 0.2 全线

`0.1.1` 的 `^0.1.1-rc.2 || ^0.2.0-rc.1` 能装 0.2 线，却把 `0.1.0`、`0.1.1-rc.0`
这些更老的宿主挡在外面 —— 用老版本 DSH 的用户同样只会看到 404。改为显式区间：

```json
"@deepseek-ai/dsh-host-webserver": ">=0.1.0-0 <0.3.0-0"
```

- **下界带 `-0`**：`>=0.1.0` 会把 `0.1.0-rc.x` 排除在外，加 `-0` 才收得下预发布
- **上界带 `-0`**：`<0.3.0` 会误收 `0.3.0-rc.1`，`<0.3.0-0` 才是干净的边界
- **上界故意保留**：完全去掉 peer 门虽再也不会被跳过，但 0.3 一旦改了
  `webServer.register`，插件会被装上去、再在启动阶段抛错 —— 那是**起不来**，
  比静默的 404 更糟

实测矩阵（已固化进 `test/test-manifest.cjs`）：接受 `0.1.0`、`0.1.0-rc.1`、
`0.1.1-rc.0`、`0.1.1-rc.2`、`0.1.5`、`0.2.0-rc.1`、`0.2.0-rc.2`、`0.2.0`、
`0.2.1-rc.2`、`0.2.9`；拒绝 `0.0.9`、`0.3.0-0`、`0.3.0-rc.1`、`0.3.0`、`0.4.0`、`1.0.0`。

> 桌面版与 CLI 是两条独立的更新通道（当时分别是 `0.2.1-rc.2` 与 `0.2.0-rc.2`），
> 所以「支持一个区间」不是写得宽松，而是唯一能同时覆盖两者的写法。

### 变更：删除 `build/deploy.ps1`，像素检测迁到 `tools/render-check.ps1`

`deploy.ps1` 走的是**已退役**的静态部署路径（把产物复制进 `<dsh-web-frontend>/dist/`，
DSH 升级即整体消失），而它同时是「空白页像素检测」这道门的唯一执行者。删除时把这道门
原样迁出：

| 项 | 旧（`deploy.ps1`） | 新（`render-check.ps1`） |
| --- | --- | --- |
| 检测目标 | 静态目录里复制出来的副本 | **插件路由 `/em-agent`**，与真实交付路径一致 |
| 何时执行 | 构建之后顺带跑 | 独立脚本，按需跑（需要 `dsh web` 在服务） |
| 浏览器位置 | 写死默认值，可用 `-Chrome` 覆盖 | `-Chrome` → `CHROME_PATH` → 由环境变量推出的安装根 → `PATH`，**不含任何绝对路径** |
| 字符集 | 含中文，依赖 BOM | **纯 ASCII**，永不踩 BOM 这个坑 |
| 失败形态 | 抛异常 | `0` 通过 / `1` 判定空白 / `2` 跳过（无浏览器或图形 API）/ `3` 路由不可达 |

判定口径未改：截图后按「最大梯度 + 边缘像素占比」判空白。已实测真实页面
`maxGrad≈667`、`edge≈3.2%` → PASS；空白 fixture `maxGrad=0` → 退出码 `1`；
不可达 URL → 退出码 `3`。**门禁仍然能真的失败**，不是摆设。

仓库里因此**不再有任何往 DSH 安装目录写文件的路径**。

### 变更：`test-manifest.cjs` 增加版本矩阵（21 → 24 条断言）

矩阵不依赖本机是否装了 DSH，只要拿得到 `semver` 就运行；并保留一条负向对照，证明旧的
`^0.1.1-rc.2` 会**同时**拒掉 `0.1.0` 与 `0.2.x`，避免 range 写宽之后断言空转。

### 修复：`tools/capture-screenshots.cjs` 支持 `CHROME_PATH`

原来只有一个写死的 Chrome 路径，装在非默认位置的机器上会直接失败。现在与 `test/`
下的套件同口径：`CHROME_PATH` 优先，默认值仅作兜底。

---

## [0.1.1] — 2026-10-18

### 修复：DSH 升到 0.2 线后 `/em-agent` 返回 404

**现象。** DSH 升级到 `0.2.0-rc.2` 之后，原本正常的 `/em-agent` 变成 404，
旧路径别名 `/antenna-optimizer` 同样 404，页面完全进不去。profile 配置、插件行的
`insert`、`panel.html` 都没有被改动过。

**根因（在插件自己身上，不在 DSH）。** `plugin/package.json` 把宿主声明为：

```json
"peerDependencies": {
  "@deepseek-ai/dsh-host-webserver": "^0.1.1-rc.2"
}
```

0.x 的 caret 上界是 `<0.2.0-0` —— 注意结尾那个 `-0`。带预发布下界的 range 会把上界
也钉成预发布版本，于是 `^0.1.1-rc.2` **不接受** `0.2.0-rc.2`。DSH 在 boot 阶段做 peer
兼容性检查，判定不兼容后**整包跳过**：

```
dsh: skipping profile bundle "dsh-em-agent": Error: Plugin dsh-em-agent@2.0.0 is
incompatible with dsh 0.2.0-rc.2: peerDependencies {"@deepseek-ai/dsh-host-webserver":"^0.1.1-rc.2"}.
```

（错误里那个 `2.0.0` 是当时本机旧安装副本的版本号，与仓库版本号无关 —— 关键是它后面引用的
peer range。）

loader 树里因此根本没有 `em-agent-panel` 这一行，路由不存在，请求落到 fallback 回 404。
这条失败是**静默**的：查 patch 文件、查 profile、查 `panel.html` 全部正常，
唯一会喊出来的地方是 `dsh --profile web --dump-config` 的 stderr。

**修复。** peer range 改为 `^0.1.1-rc.2 || ^0.2.0-rc.1`，0.1 线与 0.2 线同时支持。
宿主侧的 `webServer.register({ kind, path, handler })` 契约在 0.2.0-rc.2 未变，
插件代码本身不需要改。

### 新增：`test/test-manifest.cjs`（插件契约测试）

21 条断言，**不需要浏览器，也不需要 DSH 在跑**。它锁住两件此前无人看守的事：

- 声明的 peer range 必须被本机 DSH 运行时接受 —— 带一条**负向对照**：证明旧的
  `^0.1.1-rc.2` 会被判为不兼容。没有这条对照，断言可能在 range 写宽后空转
- 真实 `import` 插件，用真实 `http.Server` 挂上它注册的路由，断言 200 / HEAD /
  405 + `Allow` / 旧路径别名 / 释放后消失，并逐字节比对响应体与 `plugin/panel.html`

十一套浏览器回归在「整包被跳过」这类故障下只会**一起失败**，指向不了清单元数据这个
真正的原因。本套件补上了这一环，见[回归测试](docs/dev/tests.md)。

### 修复：`build/deploy.ps1` 丢失 UTF-8 BOM

该脚本含 432 个中文字符；缺 BOM 时 Windows PowerShell 5.1 会按 GBK 解码并吞掉引号，
产生 **9 处语法错误**，`powershell -File build\deploy.ps1` 根本无法解析 ——
与[构建与硬门禁](docs/dev/build.md)记录的形态完全一致，属于文档已经写明「必须保留」
却再次被编辑器静默去掉的情况。已补回 BOM，其余字节未动。

---

## 未发布

后续版本的改动记录在此。
