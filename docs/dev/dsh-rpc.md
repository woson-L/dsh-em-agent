# 与 DSH 的 RPC 契约

> **文档索引** › [开发](../README.md) › 与 DSH 的 RPC 契约

页面没有后端，它靠同源的 `/api/*` 与宿主 DSH 通信。**这层协议不是稳定的公开 API**：
两版 DSH 之间的形状差异会让页面「界面完全正常、一按按钮就报错」。这份文档记下在本机
安装版本上**实测过**的契约，以及改动前该先读哪里。

> 2026-10-01 的一次真实故障就是这里来的：面板按旧协议发点号式端点，每次都被判 404，
> 而当时没有任何测试覆盖这条路径。现在由 [`test-rpc.cjs`](tests.md) 锁住。

## 三条硬约束

| # | 约束 | 违反的后果 |
| --- | --- | --- |
| 1 | 路径必须**两段式**：`POST /api/<namespace>/<method>` | 点号式 `/api/session.create` 按 `/` 切只有 1 段，网关在任何业务逻辑之前就判「不认领」→ **HTTP 404 `not found`** |
| 2 | body 是 `client-request` 信封，`payload` 必须是 `{ args: { <wire>: 值 } }` | 少了 `args` 这一层 → `gateway/arguments-invalid` |
| 3 | 信封里的 `method` 必须与 URL 末段**完全一致** | 不一致 → `gateway/bad-request`，报文里会同时写出两者 |

`<wire>` 是该接口的**命名参数名**，不是固定值：`session/create`、`session/prompt`、
`session/cancel` 都是 `request`，而 `session/list` 是 `_request`。

## 依据：改之前先读这四处

| 位置 | 看什么 |
| --- | --- |
| `dsh-api-gateway/lib/index.js:510` | `claimsEndpoint()` —— `segments.length !== 2` 直接 `false` |
| `dsh-api-gateway/lib/index.js:990` | `endpointOf()` —— 拼法就是 `${namespace}/${method}` |
| `dsh-client-connection/lib/index.js:635` | `rpcFetchHandler()` —— 信封校验与 `method === endpoint` 检查 |
| `<pkg>/lib/typert.remote-client.js` | 每个端点的 `namespace` / `method` / 参数 `wire` 名 / 请求 zod schema |

> **不要凭记忆写这层。** 端点和必填字段都会变：`session.history` 在现版本根本不存在，
> `host.pickDirectory` 也不存在（目录选择器是客户端插件 API，不是主机端点）。

## 页面用到的端点

| 页面里的名字 | 线上端点 | 参数名 | 请求必填字段 |
| --- | --- | --- | --- |
| `session.create` | `session/create` | `request` | 无（`cwd` / `workspaceId` / `sessionId` / `agentPreset` 全可选；`workspaceId` 与 `cwd` 不能同时给） |
| `session.prompt` | `session/prompt` | `request` | `requestId`、`sessionId`、`mode`、`content` |
| `session.cancel` | `session/cancel` | `request` | `sessionId` |

映射表就是产物里的 `RPC_ENDPOINTS`。**加接口必须同时登记**，否则 `dshRpc` 会直接抛
「未登记的 DSH 接口」——宁可当场报错，也不要发一个必然失败的请求。

### `session.prompt` 的 `mode`：面板只许用 `queue`

`mode` 的取值**只有两个**，写在请求 schema 里：

```js
// dsh-api-session-controller/lib/typert.host.js
session_prompt_parameter_0$schema = z.object({
  requestId: …,
  mode: z.union([z.literal("queue"), z.literal("steer")]),
  …
})
```

两个值的行为差在**插到哪一段**（`dsh-agent-loop/lib/index.js`、`…/types/commands.js`）：

```js
followup(input) { this.send(input, "next-turn", true); }   // 排到下一轮
steer(input)    { this.send(input, "next-step", true); }   // 插到下一步（打断当前步）

if (request.mode === 'steer') agent.steer(message);
else                          agent.followup(message);      // ← "queue" 走这条
```

所以：**`mode:"queue"` = 追加到会话收件箱，当前这一轮继续跑，不会被取消**；
`mode:"steer"` 才是插话打断。面板的 `sendToChat()` 固定用 `queue`，
「对话输入」的手动发送因此不打断正在运行的预检或迭代（回归覆盖见 `test/test-monitor.cjs`）。

## 流式通道：会话事件从哪来

面板右栏要「实时看到模型在干什么」，就得开一条推送流。当前 DSH 的做法是：
**在 `/api/remote.mux` 这条 WebSocket 上开逻辑流**，而不是每个用途一个专用端点。
旧版本用的 `/api/events.mux` 在当前版本已完全不存在（全库 0 处命中）。

帧格式（`dsh-api-gateway/lib/types/stream-protocol.js`）：

| 方向 | 帧 |
| --- | --- |
| 发 → | `{ type:'open', streamId, endpoint, payload }` |
| 发 → | `{ type:'cancel', streamId }` |
| 收 ← | `{ type:'item', streamId, value }` |
| 收 ← | `{ type:'end', streamId }` |
| 收 ← | `{ type:'error', streamId, error:{ code, message, details } }` |

`streamId` 由客户端自起（本页用 `"follow-" + makeRpcId()`），所有帧按它路由。

**会话事件用 `session/follow`**——`mode: 'stream'`，全库只有 `session/control` 与它两个流式端点。
它的 `value` 是三选一：

| `value.type` | 内容 |
| --- | --- |
| `snapshot` | `{ header, cursor, records:[{ event }], hasMore, projections }` —— 开流时的历史基线 |
| `event` | `{ event:{ type, seq, time, data, … } }` —— 之后每一条增量 |
| `assistant-stream` | `{ frame:{ revision, … } }` —— **仅当 opt-in `assistantStream:true`** |

本页**不** opt-in `assistantStream`：它要求客户端按 `revision` 连续性自校验，而我们只需要
journal 事件。代价是拿不到逐字流式输出（记在 [roadmap](roadmap.md)）。

> **去重规则**：快照与后续增量可能重叠，一律按 `seq` 比较。`chatLastSeq` 是已处理到的最大 seq；
> 断线重连会重发快照，靠它避免重复渲染。`test/test-eventstream.cjs` 锁住了这套语义。
>
> **别把 `$events` 与它搞混。** `$events` / `$events/result` 是另一条通道，用来给 Cordis
> 客户端插件转发宿主事件（带 waterfall 回执）。本页不用它。
>
> **不要在本地预画消息。** `sendToChat` 曾经自己 `appendChatMsg` 一条用户消息，事件流接通后
> journal 又回推同一条，于是同一句话出现两遍；现在渲染只有一个来源——事件流。

## 怎么验

```bash
node test/test-rpc.cjs "http://127.0.0.1:3080/em-agent"
```

它桩掉 `fetch` 抓页面真实构造的请求、用本机 DSH 的 typert 清单核对端点确实存在，
并把 `claimsEndpoint` 的判据本地复刻做**负向对照**（点号式必须被拒）。本机没装 DSH 时，
端点核对那组记 SKIP。

### 起一个隔离实例做真端到端

不想拿正在用的 3080 冒险时，用独立 `DSH_HOME` 起一个实例——它有自己的 profile 与存储，
与你在用的实例互不影响：

```powershell
$env:DSH_HOME = "$env:TEMP\dsh-e2e-home"        # 独立家目录，不碰 ~/.dsh
dsh plugin --profile web add "<仓库>\plugin"     # 会自动从随附模板初始化该 profile
dsh web --port 8099 --no-open                    # --no-open：别在桌面上弹窗
```

启动时会打印带 token 的地址（`printUrl` 默认为 `true`）。`/api/*` 需要登录 cookie
（`Path=/; HttpOnly`，按 authority 命名）：**先访问一次那个带 token 的地址**把 cookie 种下，
之后的请求就带上了——这正是真实用户被 `dsh web` 自动打开浏览器时发生的事。
