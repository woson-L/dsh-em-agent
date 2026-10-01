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
