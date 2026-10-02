# 第三方组件说明

本项目**不包含、也不分发**下列组件。它们需自行获取，并遵守各自的许可条款；
本文件只声明依赖关系，不改变任何组件的许可，也不代表对其的所有权。

| 组件 | 许可 | 说明 |
| --- | --- | --- |
| CST Studio Suite 2026 | 商业许可 | 电磁仿真软件，需有效许可证 |
| [`cst-studio-suite-mcp`](https://github.com/woson-L/cst-studio-suite-mcp) | MIT | MCP 服务端，独立 Python 包；本插件经它驱动 CST。请以实际取得的版本为准 |
| DeepSeek Harness (DSH) | 见上游仓库 | 运行环境，本插件运行于其中 |

## 为什么单独放一份

本项目的 `LICENSE` 是**原样未改的 MIT 正文**，这样 GitHub 与各类工具才能自动识别出
MIT。上面这张表属于「我们不分发什么」的声明，与 MIT 的授权条款是两件事，混在同一个文件里
会让许可证识别失败（GitHub 会把整份文件判为 `NOASSERTION`）。因此拆成两个文件：

- [`LICENSE`](LICENSE) —— 本项目自身的授权（MIT）
- `THIRD_PARTY_NOTICES.md`（本文件）—— 第三方组件的归属与获取方式

## 相关文档

- [README](README.md) —— 项目总览、外部依赖与权限
- [依赖总览](docs/start/dependencies.md) —— 哪些随项目提供、哪些要自己装
