# 合规审阅 · 逐条判定

> **文档索引** › [参考](../../README.md) › 合规审阅 › 逐条判定

> 返回 [合规审阅总览](../cordis-compliance.md)

**判定口径**：符合 / 部分符合 / 不符合 / 不适用。每条都给出代码位置或实测证据，
不靠读码推断。

## 维度一：服务生命周期与通信

### 提供服务 — **不适用**（且符合「不要预防性拆分」）

**证据**：`plugin/index.js` 中 `ctx.provide` 出现 0 次、`Service` 出现 0 次、`ctx.plugin(` 出现 0 次。

本插件不对外提供任何能力，处在能力链末端（Consumer）。依 [能力的三层拆分](https://deepseek-harness.github.io/deepseek-harness/develop/practice/)：「不要预防性拆分：只有角色需要独立演进时，才使用不同包。简单的工具插件无需拆分。」——**符合**。它只消费 `webServer`，不构成 seam。

### 声明依赖 — **符合**

**证据**：`plugin/index.js:22`

```js
export const inject = ['webServer']
```

依教程第 3 章：「`inject` 列出该插件需要的服务。Cordis 会让插件保持 PENDING，直到列出的每项服务都存在，因此在 `apply` 内可以保证 `ctx.greeter` 已经就绪。」以及「`inject` 并非一次性的启动检查……如果应用运行期间所需服务消失……每个依赖插件也会随之卸载，并在服务恢复后再次加载。」

因此 `webServer` 缺失时**不会**静默失败，而是停在 PENDING 并在服务出现后自动加载 —— 这正是规范要求的形态。

**一处非违规但不一致的地方**：插件名 `export const name = 'antenna-optimizer'`（第 19 行）与包名 `dsh-em-agent`、配置项 id `antenna-optimizer-panel` 三者互不相同。教程第 3 章「命名」约束的是**服务名**共用扁平命名空间，插件名不受该约束，故不算违规；但 PENDING/FAILED 诊断输出里显示的是 `antenna-optimizer`，与你在 `cordis.patch.yml` 里写的 `dsh-em-agent` 对不上，排查时容易误判。**建议统一**。

### 发出与监听 — **不适用**

**证据**：`ctx.on(` / `ctx.emit(` / `ctx.waterfall(` / `ctx.parallel(` / `ctx.serial(` / `ctx.bail(` 在源码中各出现 **0 次**。

插件不注册任何事件监听、不发出任何事件，因此不存在事件名需要 TypeScript 声明合并，也不存在「事件未声明」的问题。插件是纯 `.js`，无 TS 转换负担。

### 分发模式 — **不适用**

无事件，五种分发模式（`emit` / `waterfall` / `parallel` / `serial` / `bail`）无从误用。

需注意区分：源码里的 `ctx.effect(fn, label)`（第 34 行）**不是**事件分发，而是生命周期副作用注册，不涉及分发语义选择。

---

## 维度二：配置规范

### `id` — **符合**

**证据**：`~/.dsh/profiles/web/cordis.patch.yml:68`

```yaml
- insert:
    - id: antenna-optimizer-panel
      name: 'dsh-em-agent'
```

依教程第 6 章原文：「不带该字段的 Cordis 配置项在每次读取时都会获得一个新生成的 id，所以只要配置文件发生任何编辑，即使自身文本未变，它也会被视为先删除再添加并重新挂载。」

**这一条对本插件尤其关键**：同一个 profile 文件里还有 CST MCP 那一行。每次编辑该文件都会触发 `watchUserPatches` 重放整个 patch 列表；没有 `id` 的话，本行会被「先删后加」。而 `webServer.register` 对重复的 `(kind, path)` 会抛错，先删后加的顺序稍有闪失就是一次挂载失败。带 `id` 后 loader 能精确判断内容是否真的变了。

> **顺带修掉的文档 bug**：两份 README 原先写的示例是 `id: antenna-optimizer`，与实际挂载的 id 不符。指向不存在 `id` 的条目会被**静默跳过**（DSH 只告警），照文档抄的人会得到「按说明做完了、插件却没挂上」。已在本次审阅前修正，全仓库已无残留。

### `disabled` — **符合**（能力可用，且本次已实测往返）

教程第 6 章：「`disabled: true` 会卸载插件而不删除其 Cordis 配置项；改回原值后，插件以及所有因依赖其服务而处于 PENDING 的插件都会再次加载。」

**实测**（在生产 profile 上，通过 HMR 热加载，未重启）：

| 操作 | `/antenna-optimizer` | 说明 |
| --- | --- | --- |
| 加 `disabled: true` | **HTTP 404** | 路由被立即撤销 |
| 移除该行 | **HTTP 200**，187400 字节 | 路由重新挂载 |

往返全程无残留、无需重启。**结论**：`disabled` 是本插件推荐的临时关闭方式 —— 比删行更好，因为 id 不变，不触发无谓的重挂。

**一处需澄清的规范适用性**：教程那句「以及所有因依赖其服务而处于 PENDING 的插件都会再次加载」在**本插件上不适用**——它是消费者而非提供者，没有任何插件依赖它。所以关掉它不会波及其它插件。这是好事，但值得在文档里写明，否则读者会以为关掉它会有连带影响。

### `isolate` — **不适用**

单实例场景，没有「两个组各自看到配置不同的同名服务」的需求。教程第 6 章描述的是多实例隔离，本插件不需要。

**关联提醒**：若将来想在同一 DSH 里挂两个不同配置的页面（如 `/antenna-optimizer-a`、`/antenna-optimizer-b`），`isolate` 帮不上忙 —— 因为路由路径目前是硬编码的。必须先做 3.1 的配置化，`isolate` 才有意义。这两件事是绑定的。

---

## 维度三：报错机制

### 配置输入错误 — **不符合**（本次审阅最严重的一条）

**实测证据**（隔离 profile，冷启动，生产实例未受影响）。给该行写入：

```yaml
      config:
        routePath: /totally-different
        bogusKey: 123
```

结果：

- **stderr 完全为空** —— 没有 `ValidationError`，没有任何告警
- `/antenna-optimizer` → **HTTP 200**（硬编码路径）
- `/totally-different` → **HTTP 404**

**违反规范**：教程第 5 章：「`cordis.yml` 中的每个 Cordis 配置项都可以携带 `config` 块，插件则声明一个 schema，在运行 `apply` 前验证该块。错误配置会导致加载失败，并给出准确的错误：**插件绝不会在配置不完整时启动**。」

**根因**：`plugin/index.js` 没有导出 `Config`；第 28 行 `const ROUTE_PATH = '/antenna-optimizer'` 是源码常量，`apply` 的第二个参数被完全忽略。

**危害等级说明**：这比「直接报错」更坏。运维在 `cordis.yml` 里明确表达了意图，DSH 默默接受，插件却做了另一件事 —— 全程零反馈。这类失败在现场表现为「我明明改了配置，怎么还是老路径」，且没有任何日志可查。

**修改建议（已实测验证可用）**：见文末「附录 A」。要点是用**零依赖的 Standard Schema**而非 schemastery —— 因为 `@deepseek-ai/schemastery` 只存在于 DSH 安装树（`…\dsh\node_modules\@deepseek-ai\schemastery`），**不在 profile 的 node_modules 里**，而插件是软链安装，Node 按真实路径解析，够不到 DSH 的 node_modules。教程第 5 章也明确允许：「Cordis 本身接受任意 [Standard Schema](https://standardschema.dev/) 验证器」。

### 加载失败 / 依赖缺失的可诊断性 — **部分符合**

**符合的部分**：`inject: ['webServer']` 保证依赖缺失时是 PENDING 而非崩溃（教程第 3 章）；`panel.html` 缺失时返回 500 并附带中文说明（第 47–48 行）。

**不足 1 —— 裸 `catch {}` 吞掉了真实错误**（第 44–50 行）：

```js
} catch {
  res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('antenna-optimizer: panel.html 不在包内，请重新安装本插件')
```

`EACCES`（权限）、`EISDIR`（panel.html 被误建成目录）、句柄耗尽，全都会被报成「panel.html 不在包内，请重新安装本插件」——**错误信息指向的修复方向可能是错的**，而真实错误被完整吞掉，既不进日志也不进响应体。

**不足 2 —— PENDING 本身是静默的**。教程第 6 章原文：「如果插件的 `inject` 指定了无人提供的服务，它就会一直等待，不输出任何内容。这不是错误，因为 PENDING 是合法状态」以及「如果插件既不执行任何操作，也不报告任何内容，请检查其 fiber 状态」。本插件若因 `webServer` 缺失而 PENDING，排查者只会看到页面 404，看不到任何原因。

**建议**：`catch (error)` 保留错误对象，把 `error.code` 带进响应体并写入 `ctx.logger`；如需常态化的状态可见性，可按第 6 章给出的 `ctx.registry` 遍历法写一个 diagnose 插件。

### 错误码区分「用户中止」与「引擎失败」 — **部分符合**

**符合的部分**：405（方法不支持）与 500（资源不可用）语义分开，分类正确。

**不符合 —— 405 响应缺少 `Allow` 头**。实测响应头只有 `Connection` / `Keep-Alive` / `Transfer-Encoding` / `Date`，`Allow` **不存在**。

第 39 行：`res.writeHead(405)` —— 没有携带 `Allow`。

**违反规范**：RFC 9110 §15.5.6 要求 405 响应**必须**生成 `Allow` 头字段，用于告知客户端该资源支持哪些方法。

**修改建议（已实测验证）**：改为 `res.writeHead(405, { allow: 'GET, HEAD' })`。修复后实测 `Allow = 'GET, HEAD'`。

**关于 Cordis 层面的错误码区分**：本插件不涉及任务生命周期（无 job、无 abort），不存在「用户中止 vs 引擎失败」的场景，**不适用**。它的失败面只有 HTTP 状态码。

---

## 维度四：热模块替换（HMR）

### 卸载时释放 effect — **符合（已实测）**

**证据**：第 34–58 行

```js
ctx.effect(() => ctx.webServer.register({ … }), 'antenna-optimizer: panel route')
```

回调返回 `register` 的 disposer，effect 归属当前 fiber。教程第 6 章：「卸载会释放 effect，加载则遵循依赖关系，因此 HMR 可以先卸载、再加载。」

**实证**（不只读码）：在 2.2 的 `disabled` 往返中，禁用后路由**立即**变为 404、启用后立即恢复 200，全程未重启。这直接证明 disposer 真的撤销了注册，而不是理论上的归属关系。

### 加载时遵循依赖关系 — **符合**

`inject: ['webServer']` 决定它只在 `webServer` 就绪后 `apply`。教程第 3 章：「`cordis.yml` 中的加载顺序无关紧要：决定插件何时启动的是依赖关系，而不是文件顺序。」

### HMR 的实际覆盖范围 — **需澄清预期（非本插件缺陷）**

**关键事实（已在 `--dump-config` 的合成树中核实）**：`dsh-web-app` bundle 自身**声明了**一条 HMR 条目，但它是**关闭的**：

```yaml
- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  disabled: true            # <-- 默认关闭
  config:
    root: ['.']             # 声明了监听源码目录的能力
```

因为该行 `disabled: true`，启动时 `ctx.get("hmr")` 为 `undefined`，于是 `profile-boot-Dk-7KqJc.js:324–327` 另行创建一个：

```js
await ctx.loader.create({
  name: "@deepseek-ai/cordis-plugin-hmr",
  config: { root: [] }      // <-- 空数组：不监视任何源码目录
})
```

**净效果**：bundle 具备监听源码目录的能力但默认关闭，实际生效的是 profile-boot 建的那个 `root: []` 实例。因此：

- 改 `plugin/index.js` **不会**热重载，必须重启 `dsh web`
- HMR 在这个 profile 里实际只服务于 `watchUserPatches` 注册的两个 patch 文件（`cordis.patch.yml` 与 home patch）

**这是个易被误读的点**：README 里「保存即热挂载」的说法容易被理解成「改插件代码也能热更」。建议写明边界。

**一个应写进文档的好特性**：`panel.html` 是**每次请求 `readFile`**（第 45 行），所以改页面**无需任何重载** —— 刷新浏览器即可看到新内容。

### 去抖依赖 `@deepseek-ai/cordis-plugin-timer` — **不适用**

本插件不使用 timer，不注册需要去抖的监听。教程第 6 章所述「没有 `@deepseek-ai/cordis-plugin-timer` 就永远停在 PENDING 且不发出任何提示」是 `dsh-hmr` 自身的依赖特性，与本插件无关。

**顺带核实**：该坑在 profile 启动路径上已被官方绕开 —— `profile-boot` 在创建 HMR 前会先确保 timer 存在（第 323 行 `if (ctx.get("timer") === void 0) await ctx.loader.create({ name: "@deepseek-ai/cordis-plugin-timer" })`）。

---

## 维度五：官方推荐设计要点

### 不要预防性拆分 — **符合**

单包 `dsh-em-agent`，未拆分。依原文：「只有角色需要独立演进时，才使用不同包。简单的工具插件无需拆分。」本插件承担单一角色（Consumer），不需要独立演进的 seam。

### Service Definition 拥有 Request/Result 类型 — **不适用**

本插件不定义服务，因此不存在 Request/Result 类型的所有权问题。对照原文「完整能力构成其 seam。任何单一角色都不是 seam」——本插件是单个角色，不构成 seam，故无需拆包。

### 显式优于隐式 — **部分符合**

**符合的部分**：没有在 `run()` 中隐藏 `?? default`（根本没有 run 步骤）。

**不足**：原文要求「通过显式的 `resolve(request): Spec` 步骤处理默认值」。本插件跳过了整个 resolve 阶段 —— 唯一的参数（路由路径）是钉死在源码里的常量。这与 3.1 是同一根因的两面：**既没有校验，也没有解析**。

---

## 浏览器侧行为与 Cordis 服务生命周期的关系

这是审查本插件时最容易出错的地方。核心结论：

> **`panel.html` 完全不在 Cordis 的服务生命周期里。** 插件在 Cordis 中做的唯一一件事，是把 187 KB 字节流从磁盘送进 HTTP 响应。页面一旦到达浏览器，Cordis 就再也管不到它了。

由此推出的四条实际结论：

**1. 页面内的副作用不是 effect，卸载时不会被释放 —— 且这不违反规范。**

页面里的 `setTimeout` / `setInterval` / `addEventListener` / localStorage 写入，其宿主是**浏览器文档**，不是 Cordis fiber。教程第 2 章要求的「由 Cordis 管理的注册会在所属插件卸载时撤销」约束的是 Cordis 管理的注册；页面 JS 不在此列。它们的生命周期是「页面加载 → 页面关闭/刷新」。

**2. 禁用或卸载插件后，已打开的标签页继续正常工作。**

实测印证：`disabled: true` 之后 `/antenna-optimizer` 返回 404，但已加载的页面（HTML 与 JS 都已在内存中，localStorage 也还在）照常运行。**只有新发起的请求才会 404。** 这是个容易误判的排查场景——「我明明禁用了它，页面怎么还能用」。

**3. localStorage 绑定在 origin 上，既不属于插件也不属于 profile。**

四个键 `page-blocks-v1`、`page-setup-v1`、`fold-*`、`chatview-height` 都挂在 `http://127.0.0.1:3080` 这个 origin 下。因此：

- 从 `/antenna-optimizer-config-panel.html` 迁到 `/antenna-optimizer`：**数据都在**（同源同端口）
- 换端口（如 `--port 8080`）或换 host：**数据全部读不到**

这是 README 已警告过的点，但值得强调：它与「插件是否挂载」完全无关，是浏览器安全模型的直接结果。

**4. 页面内的「脚本执行开关」是本页自己的安全边界，与 Cordis 无关。**

新增区块默认执行 JS 这一行为由页面自身实现，Cordis 不知道也不校验区块里的 JS。自定义区块若要去调 CST MCP，走的是页面自己的同源 RPC 通道，**不是** Cordis 服务。隐藏内部约束（4.80 GHz 效率抑制 / 隔离度 / 自定义指标）同样属于页面内容层面的产品决策，不涉及 Cordis 规范。

---

---

## 相关文档

- [合规审阅总览](../cordis-compliance.md)
- [补验与复现](verification.md)
