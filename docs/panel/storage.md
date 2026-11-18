# 存储与迁移

> **文档索引** › [配置面板](../README.md) › 存储与迁移

页面没有后端。所有用户数据都在**浏览器 localStorage** 里，因此它的生命周期、
丢失风险和迁移方式都由浏览器决定，而不是由插件决定。

## 键清单

| 键 | 内容 | 丢失后果 |
| --- | --- | --- |
| `page-blocks-v1` | 自定义区块数组 | 区块全部消失（**请导出 JSON 备份**） |
| `cst-console-config-v1` | 配置面板状态：表单字段 + 频段状态 + **自定义频段 / 自定义特殊需求** | 需重新填写 |
| `page-setup-v1` | 首次配置（CST 路径 / MCP 地址） | 需重新填写 |
| `fold-*` | 各配置卡的折叠状态 | 仅影响展开状态 |
| `chatview-height` | 事件流高度 | 复原为默认高度 |

> `inpThickness`（天线厚度）**存但不恢复**：该字段属[固定约束 FC1](../constraints/fc1-antenna-plane.md)，
> 恒为 `0.035` mm，恢复存档中的历史值会与只读约束冲突。键照常写入以便排查，
> 恢复时由 `STATE_FIXED_IDS` 跳过。

## origin 绑定

**localStorage 与页面 origin 绑定**：如果你改动了页面地址、端口或协议
（`http://127.0.0.1:3080/...`），原数据将无法读取。区块可以在搬迁前「导出 JSON」、
在新地址下「导入 JSON」恢复；区块 JSON 的结构是稳定的
（见[区块格式规范](../editor/blocks.md)），跨版本导入按 `id` 合并，不会破坏已有区块。

> ⚠️ **「导出 JSON」只覆盖自定义区块（`page-blocks-v1`），不包含配置面板状态。**
> 面板状态里的自定义频段、自定义特殊需求、首次配置目前**只有 localStorage 一份，
> 没有导出按钮**。换 origin 之前请留意这一点——那部分数据会直接读不到。

换端口最省事的做法：先在原地址把配置抄下来（或截图），再改端口。

---

## 相关文档

- [自定义频段与特殊需求](custom-items.md) —— 面板状态里两个自定义数组的数据结构
- [区块格式规范](../editor/blocks.md) —— 区块存档的结构
- [安全说明](../reference/security.md) —— localStorage 的读取边界与脚本执行模型

## 运行设置键（0.3.0）

| 键 | 结构 | 用途 |
| --- | --- | --- |
| `dsh-em-agent-run-v1` | `{ mcpDir?: string, policy: 'workspace-write' \| 'danger-full-access' }` | 运行桥接的设置；与 `dsh-em-agent-display-v1`、`page-setup-v1` 相互独立 |

缺省或损坏时回落到 `{ policy: 'danger-full-access' }`，不阻断启动。
## 运行设置的路由与落盘（0.3.0 追加）

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/em-agent/settings` | GET | 读取运行设置（需 `x-em-token`） |
| `/em-agent/settings` | POST | 合并写入；只接受 `mcpDir`(≤500 字符) 与 `policy`(枚举)，其余键丢弃 |

**为什么存在宿主侧而不是只用 localStorage**：桌面版的宿主端口每次启动都变
（`http://127.0.0.1:<动态端口>`），而 `localStorage` 按 origin（含端口）隔离，
按 origin 存的设置会在下次启动时读不到。因此落盘在：

```
%LOCALAPPDATA%\dsh-em-agent\settings.json
```

可用 `DSH_EM_AGENT_SETTINGS` 覆盖路径。`localStorage` 只作为离线缓存，
宿主的文件是唯一权威来源。