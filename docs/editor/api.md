# 可调用 API 清单

> **文档索引** › [页面编辑器](../README.md) › 可调用 API 清单

区块脚本运行在页面全局作用域，可直接按名调用下列接口。

> **注意**：`function` 声明同时挂在 `window` 上（`window.toast(...)` 可用）；
> 而 `const` / `let` 只在全局词法作用域内 —— **按名访问可以，`window.xxx` 取不到**。

### 提示与日志

| 接口 | 说明 |
| --- | --- |
| `toast(msg, type?, ms?)` | 顶部提示。`type`：`"ok"` / `"warn"` / `"err"`，默认 `"info"` |
| `addLog(text)` | 写入左栏「操作日志」（保留最近 5 条） |

### 配置与任务

| 接口 | 说明 |
| --- | --- |
| `readConfig()` | 读取当前表单配置对象 |
| `readSetup()` | 读取首次配置（CST 路径与 MCP 地址） |
| `validate()` | 校验表单，返回 `{ errors, warnings }` |
| `buildInstruction(cfg)` | 由配置生成完整任务指令文本（含 7.2 天线仿真固定约束） |
| `fixedConstraintLines(cfg)` | 生成 7.2 天线仿真固定约束段落；任务指令、预检、补齐轮共用，改文案只改这一处 |
| `startSimulation()` | 启动：预检 →（未通过则按 ⑤ 的轮次自动补齐；用尽后也会继续）→ 运行（异步，**不阻断**） |
| `pauseSimulation()` / `resumeSimulation()` / `cancelSimulation()` / `recoverSimulation()` | 任务控制（异步） |
| `generateOnly()` | 只生成指令并复制到剪贴板 |
| `sendProbeInstruction()` | 发送环境探测指令（异步） |

### DSH 通信

| 接口 | 说明 |
| --- | --- |
| `dshRpc(method, payload)` | 直接调用 DSH RPC，返回 `Promise` |
| `isDSHSameOrigin()` | 是否处于同源模式（`file://` 下为 `false`） |
| `copyToClipboard(text)` | 复制到剪贴板，返回 `Promise<boolean>` |

### 对话与图表

| 接口 | 说明 |
| --- | --- |
| `appendChatMsg(role, text)` | 往事件流插入消息，`role` 为 `"user"` / `"assistant"` |
| `sendChatMessageManually()` | 发送输入框内容（Enter 键与「发送」按钮都走它）。队列模式，**不打断**正在跑的任务 |
| `drawChart()` | 重绘 S11 曲线（按轮次分桶，一轮一条，最佳轮次高亮） |
| `chartRoundTraces()` | 返回按轮次分桶后的曲线数据 `[{ round, pts, worst, best }]`，`pts` 已按频点取该轮最优 |
| `chartBestRound(traces)` | 从分桶结果里取「最差频点值」最小的那一轮（并列取更靠后的轮） |
| `collectFreqDbFromText(text)` | 从文本里启发式采集「频率–S11」点，归到当前轮次 |
| `resetRunMonitor()` | 清空曲线与结果表 |
| `updateResultTable()` | 刷新结果汇总表 |
| `isRunActive()` | 当前是否处于运行中（含预检 / 暂停 / 恢复）——运行中的状态不允许丢会话 |

### 区块系统自身

| 接口 | 说明 |
| --- | --- |
| `pageBlocks` | 当前全部区块数组（可变；改完自行 `saveBlocks()` + `renderBlocks()`） |
| `blockDataHistory` | `{ blockId: [payload, ...] }` 内存历史 |
| `deliverBlockData(block, payload)` | 手动向某个区块投递数据 |
| `routeBlockDataFromText(text)` | 扫描文本中的回传块并路由 |
| `parseBlockConfig(text)` | `key=value` 文本 → 对象 |
| `normalizePayload(obj)` | 把任意数据形状归一化为 `{ columns, rows, ... }` |
| `samplePayloadFor(block, round?)` | 生成该区块的测试数据 |
| `saveBlocks()` / `renderBlocks()` / `renderBlockList()` | 保存并重绘 |

### 常用状态变量

| 变量 | 说明 |
| --- | --- |
| `runState` | `idle` / `prchecking` / `running` / `paused` / `resuming` / `completed` / `failed` / `cancelled` / `recovering` |
| `runId` | 当前 run 标识 |
| `chatSession` | 当前 DSH 会话 id（未启动时为 `null`） |
| `bandState` / `bandEnabled` | 各频段的阈值与启用状态 |
| `actionLogs` | 操作日志数组 |
| `pageSetup` | 首次配置对象 |
| `FIXED_CONFIG` / `BANDS` / `THRESHOLD_OPTIONS` | 固定配置与频段常量 |
| `ANTENNA_THICKNESS_MM` / `FC1_TITLE` / `FC2_TITLE` | 天线仿真固定约束的常量与标题（FC1 厚度、两条约束的展示名） |

### 工具函数

`todayStr()`、`nowStamp()`、`pad2(n)`、`joinPath(dir, file)`、`baseNameOf(file)`、
`configCopyPath(cfg)`、`cellText(v)`、`cellClass(text)`、`extractBlocksText(blocks)`

常量：`FIXED_CONFIG`、`BANDS`、`THRESHOLD_OPTIONS`、`PORT_CS_RULE`（端口坐标系口径，
任务指令与预检三处共用同一句话）、`ANTENNA_THICKNESS_MM` / `FC1_TITLE` / `FC2_TITLE`
（[天线仿真固定约束](../constraints/README.md)的文案来源）、`STATE_FIXED_IDS`
（不从 `localStorage` 恢复的固定约束字段）、`RUN_ACTIVE_STATES`（算作「运行中」的状态集合）。

## 运行桥接（0.3.0）

面板的「启动仿真」不再把任务投进 DSH 会话，而是由插件宿主以
`dsh --profile headless --json` 起子进程，事件流（JSONL → SSE）交给面板的「运行记录」渲染。
因此渲染不依赖 DSH 的对话 surface。

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/em-agent/run` | POST | 启动一次 headless 运行（需 `x-em-token`） |
| `/em-agent/runs` | GET | 列出运行与并发状态 |
| `/em-agent/run/<id>` | GET | 单次运行快照 |
| `/em-agent/run/<id>/events` | GET | SSE 事件流（支持 `Last-Event-ID` 续传） |
| `/em-agent/run/<id>/cancel` | POST | 取消（Windows 杀进程树） |
| `/em-agent/run-bridge.js` | GET | 注入面板的桥接脚本 |

`x-em-token` 由宿主每次 apply 生成，只注入同源面板；跨源请求会被 CORS 预检挡住。
并发上限取环境变量 `DSH_EM_AGENT_MAX_CONCURRENT`（默认 1，范围 1–8），超限返回 429。
### 会话隔离与权限钉死（0.3.0 追加）

headless 默认会把会话写进 `~/.dsh/sessions`，于是 DSH 侧栏会多出一条会话——
看起来像「在 Harness 里新建了会话」，而且点进去后是**另一个 profile 的策略**在跑，
插件页授予的权限不沿用。

因此每次 run 生成的 `dsh.patch.yml` 固定包含三条覆盖，不依赖环境变量传导：

```yaml
- id: session-persistence-jsonl     # 会话写插件私有目录，不进工作区
  config: { root: "<私有目录>" }
- id: sandbox-policy                # 沙箱档位
  config: { mode: "danger-full-access" | "workspace-write" }
- id: approval                      # 审批策略：完全访问 → never，其余 → ask
  config: { policy: "never" | "ask" }
```

私有目录默认 `%TEMP%\dsh-em-agent-sessions`，可用 `DSH_EM_AGENT_SESSION_ROOT` 覆盖。
这样插件页跑的任务**不会在工作区产生会话**，也就不存在「点进会话回不来」的路径。
## 运行设置的路由与落盘（0.3.0 追加）

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/em-agent/settings` | GET | 读取运行设置（需 `x-em-token`） |
| `/em-agent/settings` | POST | 合并写入；只接受 `mcpDir`(≤500 字符) 与 `policy`(枚举)，其余键丢弃 |

**为什么存在宿主侧而不是只用 localStorage**：桌面版的宿主端口每次启动都变
（`http://127.0.0.1:<动态端口>`），而 `localStorage` 按 origin（含端口）隔离，
按 origin 存的设置会在下次启动时读不到。因此落盘在：

```
%LOCALAPPDATA%\dsh-em-agent\settings.json
```

可用 `DSH_EM_AGENT_SETTINGS` 覆盖路径。`localStorage` 只作为离线缓存，
宿主的文件是唯一权威来源。