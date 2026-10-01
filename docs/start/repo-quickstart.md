# 从仓库开始的六步

> **文档索引** › [开始使用](../README.md) › 从仓库开始的六步
## 快速开始（下载后 6 步）

### 步骤 1 · 确认前置条件

- 已安装并授权 **CST Studio Suite 2026**
- 已安装 **DSH**，且能够以 Web 模式启动（`dsh web`）
- 已安装 **Python ≥ 3.10**（仅当你需要自行安装 CST MCP 时；插件本身不需要 Python）

### 步骤 2 · 安装 CST MCP

```bash
# 取得 cst-studio-suite-mcp 包后，进入其目录
# 以下命令在 **CST MCP 仓库**的目录里执行（本插件仓库不含 requirements.txt）：
python -m pip install -r requirements.txt      # 或 pip install mcp>=1.10 pydantic>=2.0
python check_install.py --fix                  # 自动探测 CST 并生成 .env
python check_install.py                        # 期望退出码 0
```

记下 `check_install.py` 报告的三个值，稍后要在页面里填：

- CST 安装根目录
- CST Design Environment 可执行文件路径
- Python 解释器路径（`python` 的绝对路径）

### 步骤 3 · 在 DSH 中注册 MCP 服务

在 DSH 的 profile 配置中新增一个 MCP 客户端条目。配置文件位置：

```
~/.dsh/profiles/<profile>/cordis.patch.yml      # Windows: C:\Users\<你>\.dsh\profiles\<profile>\
```

YAML 配置示例（**请把路径换成你自己的**）：

```yaml
- insert:
    - id: mcp-cst-studio-suite
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: cst-studio-suite
        transport: stdio
        command: C:\Program Files\Python311\python.exe
        args:
          - C:\CST-MCP\mcp_server.py
        env:
          CST_INSTALL_ROOT: C:\Program Files\CST Studio Suite 2026
          CST_DESIGN_ENVIRONMENT_EXE: C:\Program Files\CST Studio Suite 2026\AMD64\CST DESIGN ENVIRONMENT_AMD64.exe
          CST_MCP_WORKSPACE: C:\CST_Workspace\cst_runs
          CST_MCP_EVIDENCE: C:\CST_Workspace\cst_runs\evidence
        cwd: C:\CST-MCP
```

> **两个常见坑：**
> 1. 新增服务**必须用 `insert:` 形式**才能追加到插件树；若带 `id`，该 `id` 必须对应真实存在的条目，指向一个
>    不存在的条目，DSH 只会告警并**静默跳过**，表现为「MCP 工具根本没挂上」。
> 2. **进程环境变量优先于 `.env`。** 上面 `env:` 里的四个键会覆盖 MCP 自身的 `.env`；
>    如果这里写的工作区和 `.env` 不一致，工程与证据会被写到意想不到的位置。
>    建议两处保持一致。

重启 DSH 后，工具列表中应出现 `mcp__cst-studio-suite__*` 前缀的工具。

### 步骤 4 · 安装页面插件

页面现在是 **DSH 插件**，不再是放进静态目录的 HTML 文件。旧的静态部署方式
已于 2026-10-01 退役（原因见 [方式 B · 直接部署静态页面（已退役）](repo.md)）。

```powershell
dsh plugin --profile web add "<本仓库>\plugin"
```

装完在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加这一行：

```yaml
- insert:
    - id: em-agent-panel
      name: dsh-em-agent
```

> 本 profile 的 `patchReload` 为 `"live"`，保存即热挂载，通常不必重启；
> 冷启动同样有效。详见 [`plugin/README.md`](../../plugin/README.md)。

### 步骤 5 · 打开页面并完成首次配置

浏览器打开：

```
http://127.0.0.1:3080/em-agent
```

**首次访问会自动弹出「首次配置」面板**，填写 CST 路径与 MCP 地址（见[首次配置（页面内）](../panel/setup.md)）。
保存后配置写入任务指令，模型即可据此调用 MCP 与 CST。

### 步骤 6 · 验证

1. 点首次配置里的 **「发送环境探测指令」** —— 会要求模型实际调用 `cst_detect_tool` 并返回 `ENV_OK` / `ENV_FAIL`；
2. 回到主界面填写工程路径与频段指标，点 **「启动仿真」**；
3. 左栏「工程预检」应逐项通过，右栏事件流开始输出。
