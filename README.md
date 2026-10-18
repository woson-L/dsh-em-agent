# DSH EM Agent

DSH 插件，面向 CST 电磁仿真，支持任意频段天线设计。单文件 Web 控制台覆盖硬件设计全流程：任务配置、模型驱动、实时监控、结果交付。

## 0.2 版新增（相对 0.1.0）

> **DSH 桌面版（DSH Desktop）现在可以直接使用本插件。** 桌面版与 Web 端共用同一份
> `panel.html` 产物与同一套路由，安装方式见
> [装到 DSH 桌面版](docs/start/store.md#装到-dsh-桌面版020-起)。

| 变更 | 说明 |
| --- | --- |
| **桌面版支持** | 桌面版有独立的 profile 与独立版本线（实测 `0.2.1-rc.2`，同期 Web 侧 CLI 为 `0.2.0-rc.2`）；同一份产物、同一个 `/em-agent`，两端表现一致 |
| **打开即弹的入口** | 应用一打开自动弹出模态窗（5cm 高、宽度自适应、遮罩 + 焦点约束 + 右上角关闭），点「开启 EM 仿真」进入控制台整页；关掉后顶栏留 `EM Agent` 胶囊可再开 |
| **修复桌面版「DSH 离线」** | 面板原先把「同源」等同于 `http(s)`，在 `dsh-app://` 下整页降级成 `file://` 模式；由补丁 P70 / P71 修正 |
| **DSH 版本区间放宽** | peer range 改为 `>=0.1.0-0 <0.3.0-0`，DSH 0.1 与 0.2 全线（含预发布）都可用，不再因宿主升级被整包跳过 |
| **构建与验证** | 删除已退役的 `build/deploy.ps1`，空白页像素检测迁到 `tools/render-check.ps1`（纯 ASCII、零绝对路径）；新增 `test/test-manifest.cjs`（27 条断言，锁住版本区间与路由契约） |

逐条记录见 [变更记录](CHANGELOG.md)。

## 功能

- 单文件 HTML/CSS/JavaScript，无构建依赖，无外部资源；图标以内联 data URI 提供
- 双主题，跟随系统 `prefers-color-scheme`
- 内置页面编辑器，支持以 HTML 新增内容区块，并接收模型回传的数据
- CST 操作经 [`cst-studio-suite MCP`](https://github.com/woson-L/cst-studio-suite-mcp) 驱动 CST Studio Suite 2026
- 提供 Web 路由，页面由插件包提供，不写入 DSH 安装目录
- 入口为应用内模态窗（桌面版与 Web 浏览器通用），面板本身仍是一份可独立打开的单文件

## 视频演示

[DSH EM Agent 演示视频](https://www.bilibili.com/video/BV1Rva66pEPJ/?vd_source=00d521011c32796f8fba56c033bc35ec)

## 安装

```bash
dsh plugin --profile web add "git+https://github.com/woson-L/dsh-em-agent.git#path:plugin"
dsh web
```

安装完成后访问 **`http://127.0.0.1:3080/em-agent`**。

插件包通过声明 dsh.bundle.patch，在安装时自动注册为 profile 层，无需手动编辑 profile 配置。

**DSH 桌面版（DSH Desktop）从 `0.2.0` 起同样支持**：它有自己的 profile 与自己的版本线，
需要用桌面版自带的载体 CLI 单独装一次（npm 装的 `dsh` 会被拒绝），
见 [装到 DSH 桌面版](docs/start/store.md#装到-dsh-桌面版020-起)。

完整安装流程（包括首次配置、CST 与 MCP 依赖，以及可复制给 AI 的代做提示词）见 **[从 DSH Store 安装](docs/start/store.md)**。


## 文档

文档位于 [`docs/`](docs/)，按功能分为六组。完整索引见 **[docs/README.md](docs/README.md)**。
下表列出常用入口：

| 场景 | 文档 |
| --- | --- |
| 安装与启动 | [从 DSH Store 安装](docs/start/store.md) |
| 依赖清单 | [依赖总览](docs/start/dependencies.md) |
| 配置区字段 | [配置区字段说明](docs/panel/sections.md) |
| 固定约束（FC1 / FC2） | [天线仿真固定约束](docs/constraints/README.md) |
| 新增频段与特殊需求 | [自定义频段与特殊需求](docs/panel/custom-items.md) |
| 新增 HTML 区块 | [区块格式规范](docs/editor/blocks.md) |
| 数据回传 | [数据回传协议](docs/editor/data-protocol.md) |
| 全局 API | [可调用 API 清单](docs/editor/api.md) |
| 参与开发 | [构建与硬门禁](docs/dev/build.md) · [回归测试](docs/dev/tests.md) |
| 故障处理 | [排查](docs/dev/troubleshooting.md) |
| 存储与迁移 | [存储与迁移](docs/panel/storage.md) |

文档采用渐进式披露：单篇篇幅受限，相关文档在文末互相链接。按需查阅即可。

## 目录结构

```
.
├── README.md                     ← 文档索引
├── AGENTS.md                     ← 文档同步政策（强制）
├── .gitattributes                ← 关闭换行转换（构建对基线换行敏感，见「开发约束」）
├── docs/                         ← 全部文档（索引见 docs/README.md）
│   ├── start/                    ← 安装 / 依赖 / 启动
│   ├── panel/                    ← 配置面板
│   ├── constraints/              ← 天线仿真固定约束 FC1 / FC2
│   ├── editor/                   ← 页面编辑器与区块
│   ├── dev/                      ← 构建 / 测试 / 排查
│   └── reference/                ← 安全 / 令牌 / 设计 / 验证
│
├── src/
│   ├── baseline/                 ← 原始基线（只读，禁止修改）
│   └── styles.css                ← 全部样式
├── build/
│   └── build.ps1                 ← 基线 + 样式 + 补丁 → dist/
├── dist/                         ← 构建产物（由 build.ps1 生成；dist/*.html 与 dist/shots/ 不入库）
├── test/                         ← 11 个真实浏览器回归套件（另含 1 个布局实测脚本、1 个不依赖浏览器的插件契约测试）
├── tools/                        ← 截图、渲染校验（render-check.ps1）、重启验证等运维脚本
├── examples/                     ← 可直接导入的示例区块
└── plugin/                       ← DSH 插件包
```

## 外部依赖与权限

本插件包不包含且不分发以下软件。

| 依赖 | 随插件分发 | 说明                            |
| --- | --- |-------------------------------|
| DSH（DeepSeek Harness） | 否 | 运行环境。插件把宿主声明为 peer 依赖，**版本必须匹配**，否则 DSH 会在启动时整包跳过插件、页面返回 404。`0.1.2` 起支持 DSH 0.1 与 0.2 全线（含预发布），见[依赖总览 · DSH 版本要求](docs/start/dependencies.md#dsh-版本要求) |
| CST Studio Suite 2026 | 否 | 商业软件，需自行安装                    |
| `cst-studio-suite MCP` 服务端 | 否 | 独立包（MIT），需另行安装并注册到 DSH。仓库：[woson-L/cst-studio-suite-mcp](https://github.com/woson-L/cst-studio-suite-mcp) |

### 权限范围

| 权限 | 范围 |
| --- | --- |
| 文件 | 只读。仅读取本包内的 panel.html 并返回，不读写工程文件 |
| 网络 | 不发起外部请求。页面内的同源调用仅指向本机 DSH 实例 |
| 进程 | 不启动子进程，不执行 Shell。无生命周期脚本：preinstall、install、postinstall、prepare 均为空 |
| 凭据 | 不收集凭据。首次配置中的 CST 路径与 MCP 地址存储于浏览器 localStorage，不会发送至第三方 |

页面编辑器的脚本执行能力由使用者自行编写的代码提供，不属于本插件的权限范围。
详见 [安全说明](docs/reference/security.md)。

## 已知限制

- 页面需通过 http(s) 同源地址访问；以 `file://` 直接打开 `panel.html` 时，同源功能降级为复制指令模式。
- 插件声明的宿主版本范围有限：超出范围的 DSH 会在启动时**静默跳过整个插件**（页面 404，不报错）。升级 DSH 后先看 `dsh --profile web --dump-config` 里有没有 `- id: em-agent-panel`，见[依赖总览 · DSH 版本要求](docs/start/dependencies.md#dsh-版本要求)。
- 桌面版后端的端口**每次启动都不同**，请从界面顶栏的「EM Agent」按钮进入，不要收藏 `127.0.0.1:<port>/em-agent`。
- 桌面版与 Web 端 **localStorage 不共享**（origin 不同）：首次配置与自定义区块需各填一次，迁移用页面内的导出 / 导入 JSON。
- 首次配置存于浏览器 `localStorage`，与 origin 绑定；更换端口或 host 后无法读取。该配置不支持导出，迁移前需手动记录字段值。
- 未安装 `cst-studio-suite MCP` 时，页面仍可打开，配置、指令生成与页面编辑器均可用，但无法执行仿真。
- 页面编辑器新增的区块默认允许执行脚本；取消勾选后，已注册的定时器与事件监听需刷新页面才能停止。
- 单文件产物约 200 KB（CSS 与图标已内联），首次加载不发起外部请求。
## 开发约束

修改本项目前需了解三项约束。

**1. 基线只读。 src/baseline/ 为不可变的原始页面。** HTML 与行为改动以「精确命中 1 次」的补丁形式写入 build/build.ps1，样式改动写入 src/styles.css。
构建产物必须可证明等于「基线 + 恰好这些改动」。详见 [构建与硬门禁](docs/dev/build.md)。

**2. 构建对字节敏感：BOM 与换行均不可更改。**  build/build.ps1 缺少 UTF-8 BOM 时，在 Windows PowerShell 5.1 下无法解析（711 处语法错误）；
src/baseline/ 的换行若被转为 CRLF，反向还原门禁将因「补丁命中 0 次」而失败。仓库通过 [`.gitattributes`](.gitattributes) 关闭换行转换，请勿删除；部分编辑器保存时会移除 BOM，改完 `.ps1` 请确认一次。

**3. 文档同步是变更的组成部分。** 规则见 [AGENTS.md](AGENTS.md) 的文档同步政策。


## 路线图

以下为计划项，尚未实现：

- 配置面板状态的迁移工具

## 许可证

本项目采用 **MIT License**，详见 [LICENSE](LICENSE)。本项目不分发其它组件，第三方组件与其许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

