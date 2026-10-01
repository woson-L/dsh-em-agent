# 文档索引

> 返回 [项目 README](../README.md)

本目录按**功能**分六组。每份文档都刻意写短，细节用链接串起来 —— 你不必读完，
只读你需要的那一份。

---

## 开始使用 `start/`

第一次把这套装起来看这一组。

| 文档 | 讲什么 |
| --- | --- |
| [从 DSH Store 安装](start/store.md) | **推荐入口**。安装 → 启用 → 启动 → 首次配置 → 卸载 → 排查，线性走完；含一条可直接复制给 AI 的代做提示词 |
| [从仓库安装与部署](start/repo.md) | 克隆仓库后怎么装；两种启动方式对比 |
| [从仓库开始的六步](start/repo-quickstart.md) | 逐步清单版 |
| [依赖总览](start/dependencies.md) | 哪些随项目提供，哪些要自己装 |
| [安装与检测 CST MCP](start/mcp.md) | MCP 服务端的安装与注册 |
| [安装与检测 CST Studio Suite](start/cst.md) | CST 本体的安装与路径 |

## 配置面板 `panel/`

页面上那六张配置卡。

| 文档 | 讲什么 |
| --- | --- |
| [配置区字段说明](panel/sections.md) | ①–⑥ 每个字段是什么、默认值、必填与否 |
| [首次配置（页面内）](panel/setup.md) | CST 路径与 MCP 地址怎么填、怎么自检 |
| [自定义频段与特殊需求](panel/custom-items.md) | ② 与 ③ 的增删改、数据结构、兼容性 |
| [存储与迁移](panel/storage.md) | localStorage 全部键、origin 绑定、搬迁注意事项 |

## 固定约束 `constraints/`

用户指定、界面不可修改的两条约束；任务指令、预检与预检补齐轮逐轮重申。

| 文档 | 讲什么 |
| --- | --- |
| [天线仿真固定约束](constraints/README.md) | **入口**。FC1 / FC2 一句话概览，以及它们出现在哪些界面元素上 |
| [FC1 · 只改形状、不改平面](constraints/fc1-antenna-plane.md) | 厚度 0.035 mm、坐落表面、与 port 同高度平面；什么算「形状变化」 |
| [FC2 · 只改天线与馈电点](constraints/fc2-modification-scope.md) | 两行写入白名单，以及每一轮（含补齐轮）都成立 |
| [约束是怎么落地的](constraints/enforcement.md) | 唯一文案来源、七个下发位置、补丁编号与回归套件 |

> 这一组正文为**英文**（其余文档仍为中文）；界面元素名与指令章节名保留中文原文。

## 页面编辑器 `editor/`

不改源码就给页面加功能。

| 文档 | 讲什么 |
| --- | --- |
| [页面编辑器](editor/overview.md) | 界面操作：新增/导出/导入/测试/排序 |
| [区块格式规范](editor/blocks.md) | **HTML 源码怎么写**：字段表、两种渲染模式、事件契约、五个示例 |
| [数据回传协议](editor/data-protocol.md) | 模型侧按什么格式把结果送回来 |
| [可调用 API 清单](editor/api.md) | 区块脚本能用哪些全局函数 |
| [完整示例](editor/examples.md) | 可直接导入的区块 |

## 开发 `dev/`

改这个项目本身。

| 文档 | 讲什么 |
| --- | --- |
| [构建与硬门禁](dev/build.md) | 基线+样式+补丁的构建模型，七道门禁，BOM 陷阱 |
| [回归测试](dev/tests.md) | 十一个套件、怎么跑、改功能时该动哪个 |
| [与 DSH 的 RPC 契约](dev/dsh-rpc.md) | `/api/*` 的三条硬约束、端点清单、已知的流式通道缺口 |
| [排查](dev/troubleshooting.md) | 现象 → 原因 → 处理 |
| [开源待办](dev/roadmap.md) | 已知未做的事项 |

## 参考 `reference/`

| 文档 | 讲什么 |
| --- | --- |
| [安全说明](reference/security.md) | 脚本执行模型与风险边界 |
| [可复用的样式令牌](reference/tokens.md) | CSS 变量清单，写区块时用 |
| [设计说明](reference/design-notes.md) | 布局/色彩/字体/交互/响应式的取舍理由 |
| [验证报告](reference/verification-report.md) | 逐项验证结果与证据 |
| [Cordis 合规审阅](reference/cordis-compliance.md) | 对照 DSH 官方教程：范围、结论、修复记录 |
[逐条判定](reference/cordis-compliance/findings.md) | 五个维度、19 个条目的判定与代码位置 |
[补验与复现](reference/cordis-compliance/verification.md) | 首轮未验证项如何被实测 |

---

## 文档约定

文档同步政策见 [AGENTS.md](../AGENTS.md)。写作约定：

- 每份文档保持短小；超过约 300 行时考虑拆分
- 跨文档引用一律用**相对链接**，并在文末给出「相关文档」
- 不用「第 N 节」这类编号引用其他文档——编号会随拆分漂移，链接不会
