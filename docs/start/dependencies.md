# 依赖总览

> **文档索引** › [开始使用](../README.md) › 依赖总览
## 依赖总览：哪些随项目提供，哪些要自己装

| 组件 | 是否随本项目提供 | 说明 |
| --- | --- | --- |
| 页面本体 | ✅ **是** | `dist/antenna-optimizer-panel.html`，单文件、零依赖 |
| DSH（DeepSeek Harness） | ❌ 否 | 运行环境，需自行安装；页面靠它调用模型与 MCP。**版本必须匹配**，见下节 |
| **CST Studio Suite MCP** | ❌ **否，需单独安装** | 独立 Python 包 `cst-studio-suite-mcp`，见[安装与检测 CST MCP](mcp.md) |
| CST Studio Suite 2026 | ❌ 否 | 商业软件，需自行安装并授权 |
| Python ≥ 3.10 | ❌ 否 | MCP 服务端运行需要 |
| CST Skill（提示词包） | ❌ 否 | `cst-onboard-antenna` 等三个 Skill，用于约束模型行为 |

## DSH 版本要求

插件把宿主声明为 peer 依赖（`plugin/package.json` 的 `peerDependencies`）。
DSH 在 **boot 阶段**校验它；不满足时**整包跳过**——不报错、不加载，loader 树里没有
`em-agent-panel` 这一行，表现就是页面返回 404。

| 插件版本 | 支持的 `@deepseek-ai/dsh-host-webserver` |
| --- | --- |
| `0.1.2` 及以后 | `>=0.1.0-0 <0.3.0-0`（0.1 全线 + 0.2 全线，**含预发布**） |
| `0.1.1` | `^0.1.1-rc.2 \|\| ^0.2.0-rc.1` |
| `0.1.0` | 仅 `^0.1.1-rc.2` —— **升到 0.2 线后会被整包跳过，页面 404** |

> ⚠️ **为什么区间两端都写 `-0`。** 0.x 的 caret 上界天生是 `<0.2.0-0`
> （下界带预发布时，上界也被钉成预发布），所以 `^0.1.1-rc.2` 不接受 `0.2.0-rc.2` ——
> 这正是 `0.1.0` / `0.1.1` 在 DSH 0.2 上页面 404 的原因。现在两端都带 `-0`：下界
> `>=0.1.0-0` 才收得下 `0.1.0-rc.x`，上界 `<0.3.0-0` 才不会把 `0.3.0-rc.1` 误收进来。
> 写 peer range 时不能只按「大版本号没变」推理，必须实际比对一次。

**上界是刻意保留的。** 完全去掉 peer 门确实再也不会因版本被跳过，但代价是：一旦 0.3
改了 `webServer.register`，插件会被装上去、然后在启动阶段抛错 —— 那不是静默 404，而是
**起不来**，比前者更糟。所以宁可让未来版本被干净地拒掉，再由人决定要不要放宽。

### 桌面版

桌面版与 Web 端**共用同一份插件产物**，但它有**独立的 profile**
（`~/.dsh/profiles/desktop`）与**独立的版本线**（实测 `0.2.1-rc.2`，同期 Web 侧 CLI 为
`0.2.0-rc.2`）。`0.2.0` 起两端都落在上面的支持区间内。

> 两端各自独立更新，所以**任何一端升级后都值得重跑一次** `node test/test-manifest.cjs` ——
> 它会把声明的区间与本机实际安装的版本比一遍。另注意桌面版后端**端口每次启动都不同**，
> 不要收藏 `127.0.0.1:<port>/em-agent`。

安装方式见[从 DSH Store 安装 · 装到 DSH 桌面版](store.md#装到-dsh-桌面版020-起)。

自查（不需要页面在跑，也不需要浏览器）：

```bash
node test/test-manifest.cjs
```

它拿本机实际安装的 DSH 版本与声明的 range 比对，并跑一张**版本矩阵**：0.1 / 0.2 全线
（含预发布）必须被接受，0.3 及以后必须被拒绝。矩阵不依赖本机装没装 DSH，只要拿得到
`semver` 就会跑；「与运行时比对」那一项在本机没装 DSH 时记 `SKIP`，不判失败。
装了 DSH 却想指到别的位置，用环境变量 `DSH_PKG_ROOT` 指定 `.../@deepseek-ai/dsh` 目录。

出问题时的第一手证据是组合后的配置树：

```bash
dsh --profile web --dump-config
```

- 有 `- id: em-agent-panel` → 插件已挂载，404 要从路由或 profile 层找原因
- 没有这一行，且 stderr 出现 `skipping profile bundle "dsh-em-agent"` → 就是本节这条

### ⚠️ 关于 CST MCP 的重要说明

**本项目不包含、也不分发 MCP 服务端。** 它是一个独立的包，需要单独获取与安装：

| 项目 | 值 |
| --- | --- |
| 仓库 | <https://github.com/woson-L/cst-studio-suite-mcp> |
| 包名 | `cst-studio-suite-mcp`（`pyproject.toml` 中 `[project].name`） |
| 版本 | `2.0.0` |
| 许可证 | **MIT**（`pyproject.toml` 中 `license = { text = "MIT" }`） |
| Python | ≥ 3.10 |
| 依赖 | `mcp>=1.10`、`pydantic>=2.0`（可选：`matplotlib`、`numpy`、`python-docx`） |
| 入口 | `mcp_server.py`，控制台脚本 `cst-studio-suite-mcp` |
| 参考安装路径 | 本项目开发环境为 `C:\CST-MCP`（**不是本仓库目录**） |

MCP 自带的 `check_install.py` 提供完整的安装检测能力：

```bash
python check_install.py            # 完整检查：Python / 依赖 / 模块 / CST 安装 / MCP 握手 / 工具列表
python check_install.py --quick    # 跳过 CST 导入与 MCP 握手
python check_install.py --fix      # 自动探测本机 CST 路径并写入 .env
python check_install.py --fix --workspace "C:\CST_MCP_workspace"
```

退出码：`0` = 就绪，`1` = 有警告，`2` = 发现问题。

> **本项目仓库里没有 MCP 源码，因为它不是本项目的产物。** 若你打算把 MCP 与本插件
> 一起分发，请注意上游包的许可证与版权归属，并自行确认再分发条件。

### 迭代覆盖工程：对 MCP 版本的要求

任务指令要求每轮把工作副本保存回同一路径时带 `{"overwrite": true}`，并据此假定
`cst_save_project_tool` 会**先关闭仍占用该路径的工程，再由 CST 覆盖 `.cst` 与其
`Result/` 目录**。

旧版 MCP 的做法是删掉 `.cst` 再保存。这留下非空的伴随目录，CST 随即以
`The project directory <dir> already exists and is non-empty` 拒绝，或在界面上要求
人工确认——即 2026-10-02 实测到的「覆盖旧工程时需手动点掉删除旧结果的确认框」。

因此做迭代优化时，`cst-studio-suite-mcp` 需为**包含该修复的版本**：修复位于
`cst_mcp/session.py` 的 `save_project`，验证记录见 MCP 仓库
[woson-L/cst-studio-suite-mcp](https://github.com/woson-L/cst-studio-suite-mcp) 的
`docs/dev/verification.md`（Overwriting a project without a confirmation），
离线回归为 `tests/test_save_overwrite.py`。升级后需重启 DSH，MCP 服务端才会加载新代码。

---

## 相关文档

- [从 DSH Store 安装](store.md) —— 安装、启用、启动的完整流程
- [安装与检测 CST MCP](mcp.md) —— MCP 侧的安装与自检
- [CST 与 MCP 的页面内配置](cst.md)
- [仓库结构与开发入门](repo.md)
- [排查](../dev/troubleshooting.md) —— 页面打不开时先看这里
- [回归测试](../dev/tests.md) —— 含本文提到的 `test-manifest.cjs`

