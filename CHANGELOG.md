# 变更记录

本项目的版本号以 `plugin/package.json` 的 `version` 字段为准。
**仓库首个公开发布版本为 `0.1.0`**：在此之前项目从未对外发布过（内部编号不构成发布记录）。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

---

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
