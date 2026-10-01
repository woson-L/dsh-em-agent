# 可复用的样式令牌

> **文档索引** › [参考](../README.md) › 可复用的样式令牌

在自定义区块里直接引用这些变量，即可**自动跟随浅色 / 深色主题**。

| 类别 | 变量 |
| --- | --- |
| 主色 | `--primary`、`--primary-dark`、`--primary-light`、`--primary-glow` |
| 语义色 | `--ok`、`--ok-bg`、`--ok-ring`、`--warn`、`--warn-bg`、`--warn-ring`、`--err`、`--err-bg`、`--err-ring` |
| 表面 | `--bg`、`--surface`、`--surface-2`、`--surface-3` |
| 文本 | `--text`、`--text-sub`、`--text-mute` |
| 描边 | `--border`、`--border-2`、`--control-border` |
| 圆角 | `--radius`、`--radius-sm`、`--radius-lg` |
| 阴影 | `--shadow-xs`、`--shadow-sm`、`--shadow-md`、`--shadow-lg` |
| 字体 | `--sans`、`--mono` |

可直接复用的类名：`card`、`btn`（另有 `btn-xs`、`primary`）、
`pill`（配合 `ok`/`warn`/`err` 与内层 `<span class="dot">`）、`tag`、`mono`。

区块容器的默认表格样式已与页面原生表格统一（横向分隔线、无竖线、左对齐、表头浅底）。
