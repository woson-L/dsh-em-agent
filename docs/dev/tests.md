# 回归测试

> **文档索引** › [开发](../README.md) › 回归测试

所有测试都是**真浏览器测试**：通过 CDP 驱动无头 Chrome 打开真实页面，在页面里执行断言。
不是 DOM 快照比对，也不是 mock。

## 环境

- Chrome（默认 `C:\Program Files\Google\Chrome\Application\chrome.exe`，
  可用环境变量 `CHROME_PATH` 覆盖）
- Node 18+（需要全局 `fetch` 与 `WebSocket`）
- 页面已在跑（`dsh web` 或本地静态服务）

## 怎么跑

```bash
node test/test-acceptance.cjs   "http://127.0.0.1:3080/em-agent"
node test/test-setup.cjs        "http://127.0.0.1:3080/em-agent"
node test/test-editor.cjs       "http://127.0.0.1:3080/em-agent"
node test/test-blockdata.cjs    "http://127.0.0.1:3080/em-agent"
node test/test-examples.cjs     "http://127.0.0.1:3080/em-agent"
node test/test-custom-items.cjs "http://127.0.0.1:3080/em-agent"
node test/test-rpc.cjs          "http://127.0.0.1:3080/em-agent"
node test/test-eventstream.cjs  "http://127.0.0.1:3080/em-agent"
node test/test-precheck.cjs     "http://127.0.0.1:3080/em-agent"
node test/test-monitor.cjs      "http://127.0.0.1:3080/em-agent"
node test/test-constraints.cjs  "http://127.0.0.1:3080/em-agent"
node test/measure-layout.cjs    "http://127.0.0.1:3080/em-agent" 1600 1080
```

不传 URL 时默认指向 `http://127.0.0.1:3080/em-agent`（插件路由）。
静态部署方式已于 2026-10-01 退役，静态地址现在返回 404，不再是可用入口。

带断言的脚本输出一段 JSON：`{ results, failures, passed }`，**退出码 0 表示通过、非 0 表示有断言失败**。（`test-examples.cjs` 只输出例子清单，没有 `passed` 字段；`measure-layout.cjs` 输出实测数据。）

> ⚠️ **这条约定曾经只写在文档里。** 2026-10-01 修 DSH RPC 时发现：五个带断言的套件在
> 断言失败时**照样返回 0**，只有抛异常才非零——也就是说批量跑法与 CI 只看 `$?` 时，
> 回归是看不见的。这正是 RPC 那处「旧协议导致每次 404」的 bug 能长期潜伏的原因之一。
> 现在**每个带断言的套件**都在收尾处显式 `process.exit(1)`；判套件请**同时**看 `passed` 与退出码。

## 套件一览

| 脚本 | 断言数 | 覆盖 |
| --- | --- | --- |
| `test-acceptance.cjs` | 41 | 验收级：标题/品牌/单行渲染、约束卡只保留 MCP、示例区、favicon/skip-link/meta、设置入口、脚本默认执行、三轮数据回传、区块持久化 |
| `test-setup.cjs` | 38 | 首次配置：自动弹出、字段持久化、自检三态、写入任务指令、工作区回填、齿轮入口、http 模式、恢复默认、**未保存的改动被丢弃** |
| `test-editor.cjs` | 29 | 页面编辑器：新增/编辑/删除区块、三区域落点、排序、导出导入 |
| `test-blockdata.cjs` | 31 | 数据回传：围栏解析、通道路由、`metrics`/`values` 简写、单元格着色、历史累积、去重 |
| `test-examples.cjs` | — | 示例区块可加载并渲染（成功即退出码 0，不输出 `passed` 字段） |
| `test-custom-items.cjs` | 80 | **自定义频段与特殊需求**：增删改、范围校验（非法/重复）、状态迁移、持久化、老存档兼容、损坏数据健壮性；并覆盖两处「已移除项」不复活 |
| `test-rpc.cjs` | 22 | **DSH RPC 契约**：请求必须走两段式端点 `/api/<namespace>/<method>`、payload 必须是 `{ args: { request: … } }`、`sendToChat` 必须带 `requestId`；把网关的 `claimsEndpoint` 判据本地复刻做**负向对照**（点号式必须被拒）；并用本机 DSH 的 typert 清单核对端点真实存在（本机没装 DSH 时该组记 SKIP，不判失败） |
| `test-eventstream.cjs` | 32 | **会话事件流**：源码必须走 `/api/remote.mux` 的 `session/follow`（且不再有旧端点 `/api/events.mux`）；帧消费语义——快照按 `seq` 排序、与增量重叠时去重、重连重发快照不重复渲染；渲染——`user/message` / `assistant/message` / `step/end` 分别落到对话区与计数器；**顶栏语义**——步数只动「对话轮次」、迭代进度只认回传的 `round` 且不回退。不需要真实会话 |
| `test-precheck.cjs` | 38 | **工程预检**：判定器取结论行而非「最后一个判定词」（含一份**四项全 PASS 但文末提到「阻断原因」**的真实误判形状）；**未通过不再阻断**——按可配置轮次自动补齐，用尽后仍开启仿真且只留警告；轮次 0 表示不补齐、非法/越界/清空回落默认；场监视器已移出禁止清单、内激励端口须补齐 |
| `test-monitor.cjs` | 57 | **端口坐标系 / 覆盖口径 / 对话输入 / 每轮最佳曲线**：指令、预检项 5、预检补齐轮三处必须同口径要求「激励端口建在全局坐标系 xyz、禁止局部 WCS(uvw)」；**工作副本覆盖口径**（`overwrite: true`、禁止自行删工程文件、禁止依赖 CST 确认框）出现在 `# 7.1`、`# 10` 每轮流程与预检补齐轮；输入框回车发送（Shift+Enter 换行、输入法选字回车放行）、发送走队列模式不打断、**运行中清空对话不丢会话也不改状态**；曲线按轮次分桶（同轮同频取最优）、一轮一条、最佳轮次高亮且只标它的采集点、同一条消息里的 `round` 让频点落到本轮 |
| `test-constraints.cjs` | 52 | **天线仿真固定约束 FC1 / FC2**：指令 7.2 节存在且**路径随配置插值**（更换路径后不残留旧值）；FC1 的四项要件（`0.035` mm 厚度、上/下表面、与 port 同高度平面、形状限于该平面内）与 FC2 的两项白名单、「不得改删其它 Component」、禁止「新建再删旧」绕过；**每一轮**——7.2 自检写进 `# 10` 流程，并在预检与预检补齐轮各重申一次；`# 9` 设计自由度以 7.2 为界；天线厚度字段只读，DOM 改写与恢复历史存档均无法改变 `0.035`；界面上不存在可修改 FC1 / FC2 的控件 |
| `measure-layout.cjs` | — | 布局几何实测（各模块高度之和 = 左栏高度）+ **双向**鼠标拖拽：向下变大、向上回到初始、再向上能低于初始、双击复位 |

### 表格里的断言数是会漂的

上表的数字**手工维护，必然过期**（曾经 4/6 个都对不上）。要核对时跑这个：

```powershell
# test-acceptance 数 evidence 的叶子键；其余数 results 的键
foreach ($t in 'test-acceptance','test-setup','test-editor','test-blockdata','test-custom-items','test-rpc','test-eventstream','test-precheck','test-monitor','test-constraints') {
  node "test/$t.cjs" "http://127.0.0.1:3080/em-agent" |
    ConvertFrom-Json |
    ForEach-Object { $o = if ($_.evidence) { $_.evidence } else { $_.results }
                     "$t : $(($o.PSObject.Properties | Measure-Object).Count)" }
}
```

改测试后请顺手更新上表 —— 见 [AGENTS.md](../../AGENTS.md) 的改动映射表。

`test-custom-items.cjs` 会连跑五个阶段：全新状态 → 重载恢复 → 删除持久化 →
老存档兼容 → 损坏数据健壮性。它会先 `localStorage.clear()`，所以**不要拿它跑你正在用的
浏览器配置**（它用的是独立的临时 profile，不会影响你）。

## 改功能时该动哪个测试

| 你改了什么 | 必须更新 |
| --- | --- |
| 配置面板字段、区块增删 | `test-custom-items.cjs` / `test-editor.cjs` |
| 首次配置面板 | `test-setup.cjs` |
| 数据回传 / 区块渲染 | `test-blockdata.cjs` |
| 运行监控曲线、对话输入行为、任务指令文案（含端口坐标系、覆盖口径） | `test-monitor.cjs` |
| 固定约束 FC1 / FC2 的文案、下发位置、天线厚度锁定 | `test-constraints.cjs` |
| 移除了某个界面元素 | 在对应套件加「该 id 不存在」断言，**并**把它登记进构建的退役清单 |
| 布局结构 | `test-acceptance.cjs` + `measure-layout.cjs` |

> **移除元素时的双保险**：构建门禁会校验基线 id（见 [构建与硬门禁](build.md)），
> 测试再校验运行时 DOM。两道都过才算移除干净。

## 写鼠标交互测试的两个坑

这两个坑都实际发生过，且都会让测试**空洞通过**——比失败更危险。

**1. 首次配置弹层会吃掉鼠标事件。** 全新 profile 下 `#setupOverlay` 会自动打开并覆盖整页，
CDP 派发的鼠标事件落在遮罩上，被测元素根本收不到。测试里必须先隐藏它：

```js
await evalJs("(() => { const s = document.getElementById('setupOverlay'); if (s) s.hidden = true; return true; })()");
```

> 曾经因此漏掉一个真 bug：`measure-layout.cjs` 的拖拽完全没生效，
> 而它断言的「拖拽后两栏等高」因为「什么都没变」而通过。

**2. 手柄会跑出视口。** 把可拖拽面板拖到上限后，手柄会落到视口下方
（实测 1600×1080 的窗口可视高度只有 982px）。此时鼠标事件同样落空。
拖拽前先把手柄滚回视野，并**断言事件确实命中了手柄**：

```js
await evalJs("document.getElementById('chatResize').scrollIntoView({block:'center'})");
// 用 elementFromPoint 确认该坐标上就是手柄本身
```

**推论**：鼠标交互测试必须有「前置条件断言」（元素在视口内、命中测试正确），
否则「没有效果」和「没有生效」在结果里长得一模一样。

## 与构建门禁的关系

测试跑在**产物**上，构建门禁跑在**生成过程**上。互补关系：

- 构建门禁：产物 = 基线 + 恰好这些改动（逐字节可证明）
- 回归测试：产物在真实浏览器里的行为符合预期

两者都过，才认为一次改动是完整的。文档更新是第三件（见 [AGENTS.md](../../AGENTS.md)）。

---

## 相关文档

- [构建与硬门禁](build.md) —— 生成期的七道门
- [排查](troubleshooting.md) —— 测试失败时先看这里
- [自定义频段与特殊需求](../panel/custom-items.md) —— 断言覆盖的功能
