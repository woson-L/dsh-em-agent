# 安装与检测 CST MCP

> **文档索引** › [开始使用](../README.md) › 安装与检测 CST MCP

### 检测

```bash
python check_install.py            # 三项检查：能否运行 / MCP 是否工作 / 路径是否正确
```

它会依次回答：

1. 本机能否运行 CST-MCP（Python 版本、依赖包、工具模块、CST 安装）
2. MCP 本身是否工作（以 stdio 启动服务、完成 MCP 握手、列出工具）
3. 路径是否适合**这台**机器

装好之后，也可以在页面里点「发送环境探测指令」，让模型从 DSH 侧实际调用一次。

### 安装

```bash
python check_install.py --fix                                   # 自动探测并写 .env
python check_install.py --fix --workspace "C:\CST_MCP_workspace"  # 同时指定工作区
```

### `.env` 配置项

MCP 启动时会自己读取同目录的 `.env`（**不会覆盖已存在的进程环境变量**）：

| 键 | 说明 |
| --- | --- |
| `CST_INSTALL_ROOT` | 含 `AMD64\`、`Library\`、`Online Help\` 的目录 |
| `CST_DESIGN_ENVIRONMENT_EXE` | 通常为 `<根目录>\AMD64\CST DESIGN ENVIRONMENT_AMD64.exe` |
| `CST_MCP_WORKSPACE` | 通过 MCP 创建的工程保存于此，建议放在与 CST 同盘的快速磁盘 |
| `CST_MCP_EVIDENCE` | 导出的证据（Touchstone / ASCII / PNG / 报告）输出目录 |
| `CST_RUNTIME_CLI_TIMEOUT` | 可选，运行时桥接命令的单次超时秒数（默认 120） |
| `CST_MCP_QUIET` | 可选，设为 `1` 时尽量隐藏 CST GUI |
