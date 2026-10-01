# DSH EM Agent

DSH 插件，面向 CST 电磁仿真，支持任意频段天线设计。单文件 Web 控制台覆盖硬件设计全流程：任务配置、模型驱动、实时监控、结果交付。

## 功能

- 单文件 HTML/CSS/JavaScript，无构建依赖，无外部资源；图标以内联 data URI 提供
- 双主题，跟随系统 `prefers-color-scheme`
- 内置页面编辑器，支持以 HTML 新增内容区块，并接收模型回传的数据
- CST 操作经 `cst-studio-suite MCP` 驱动 CST Studio Suite 2026
- 提供 Web 路由，页面由插件包提供，不写入 DSH 安装目录

## 安装

```bash
dsh plugin --profile web add "'git+https://github.com/woson-L/dsh-em-agent.git#path:plugin'"
dsh web
```

安装完成后访问 **`http://127.0.0.1:3080/em-agent`**。

插件包通过声明 dsh.bundle.patch，在安装时自动注册为 profile 层，无需手动编辑 profile 配置。

完整安装流程（包括首次配置、CST 与 MCP 依赖，以及可复制给 AI 的代做提示词）请参见从**[从 DSH Store 安装](docs/start/store.md)**。


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
│   ├── build.ps1                 ← 基线 + 样式 + 补丁 → dist/
│   └── deploy.ps1                ← 构建 → 部署 → 渲染校验
├── dist/                         ← 构建产物（由 build.ps1 生成；dist/*.html 与 dist/shots/ 不入库）
├── test/                         ← 11 个真实浏览器回归套件（另含 1 个布局实测脚本）
├── tools/                        ← 截图与运维脚本
├── examples/                     ← 可直接导入的示例区块
└── plugin/                       ← DSH 插件包
```

## 外部依赖与权限

本插件包不包含且不分发以下软件。

| 依赖 | 随插件分发 | 说明                            |
| --- | --- |-------------------------------|
| CST Studio Suite 2026 | 否 | 商业软件，需自行安装                    |
| `cst-studio-suite MCP` 服务端 | 否 | 独立包（MIT），需另行安装并注册到 DSH |

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

本项目采用 **MIT License**，详见 [LICENSE](LICENSE)。

