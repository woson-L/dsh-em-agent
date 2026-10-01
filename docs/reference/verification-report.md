# 验证报告

> ⚠️ **本文中的 `http://127.0.0.1:3080/antenna-optimizer-config-panel.html` 已于 2026-10-01 删除。**
> 该插件已更名为 **DSH EM Agent**，页面只由插件路由提供：
> **`http://127.0.0.1:3080/em-agent`**（旧路径 `/antenna-optimizer` 仍作兼容别名可用）。
> 下文**保留原样**，以如实记录当时的真实验证状态；其中的静态地址来自已退役的「方式 B 静态部署」，
> 与插件路由是两套互不相干的机制。静态副本不会再被部署，该 URL 现在返回 404。

> 页面：`http://127.0.0.1:3080/antenna-optimizer-config-panel.html`（部署自 `dist/antenna-optimizer-panel.html`）
> 自动化：`test/test-acceptance.cjs`（38 项断言，全部通过）+ 三套既有回归（26 + 26 + 27 项）

---

## 一、逐项验证结果

### localStorage 持久化 — ✅ 通过

| 证据 | 结果 |
|---|---|
| 写入 2 个区块后读取 `page-blocks-v1` | `脚本默认行为,每轮仿真统计` |
| 刷新页面后重新读取 | 计数 2，名称顺序不变 |
| 刷新后 DOM 中渲染出的区块卡数 | 2 |

存储键：`page-blocks-v1`（区块）、`page-setup-v1`（首次配置）、`fold-*`（折叠状态）、`chatview-height`（事件流高度）。
刷新不丢，与页面 origin 绑定。

### JSON 导出 / 导入 — ✅ 通过

| 证据 | 结果 |
|---|---|
| 点「导出 JSON」 | 未抛异常，生成 `{type, version, blocks[]}` 信封 |
| 导出内容回环解析 | `JSON.parse` 成功，`blocks` 数组可还原 |
| 导入兼容性 | 同时接受信封对象与裸数组 |

导出文件名：`antenna-panel-blocks-<日期>.json`。导入按 `id` 合并（同 id 覆盖、新 id 追加），不破坏已有区块。

### 默认勾选「允许执行脚本」+ 取消后刷新生效 — ✅ 通过

| 检查点 | 实测 |
|---|---|
| 新建区块时 `beScripts` 是否默认勾选 | **true** |
| 默认状态下脚本是否真的执行 | **执行了**（`window.__runs === 1`） |
| 落库字段 `allowScripts` | `true` |
| 取消勾选并保存后再渲染 | 脚本**未执行**（`window.__runs` 仍为 undefined） |
| 落库字段 | `false` |
| 刷新页面后 | 脚本**仍未执行** |

**为什么"取消勾选要刷新才彻底生效"**：通过 `innerHTML` 注入的 `<script>` 浏览器本就不执行，
页面是用「动态重建 script 元素」的方式显式执行的（`mountBlockScripts`）。
取消勾选后不再重建，所以**不会再次执行**；但**已经执行过**的脚本如果注册了
`setInterval` / 全局事件监听，这些副作用不会因取消勾选而自动解除，必须刷新页面才彻底停止。
页面提示条已如实写明这一点。

### MCP 驱动 CST Studio Suite 2026 — ✅ 通过

实测调用 `cst_detect_tool`（真实 MCP 调用，非模拟）：

```
cst_install_root            C:\Program Files\CST Studio Suite 2026
cst_exe_exists              true
workspace                   <workspace-dir>
evidence_dir                …\cst_runs\evidence
python_executable           C:\Program Files\Python311\python.exe
cst_interface_importable    true
cst_results_importable      true
cst.results                 Version 2025-07-14
_cst_results                2026.2 Release from 2025-11-28
ready                       true
```

页面的首次配置入口（齿轮按钮）完整保留：MCP 服务名 / 传输方式 / 启动命令 / 启动参数 /
工作区 / CST 安装根目录 / CST 可执行文件，**关键接口字段未改动**。

### 大模型返回结果回传至指定区块并渲染为表格 — ✅ 通过

区块配置：通道 `stats`、渲染方式「内置表格渲染」、累积各轮。
经真实事件通道 `processSessionEvent` 注入围栏数据后：

| 检查点 | 实测 |
|---|---|
| 表格是否渲染 | **是** |
| 表头 | `轮次｜增益 (dB)｜效率 (%)` |
| 第 1 轮单元格 | `1｜2.31｜68.4` |

### 表格随每轮仿真结果更新 — ✅ 通过

| 轮次 | 渲染出的表格数 | 最后一行 |
|---|---|---|
| 第 1 轮 | 1 | `1｜2.31｜68.4` |
| 第 2 轮 | 2 | `2｜2.47｜71.2` |
| 第 3 轮 | 3 | `3｜2.58｜72.9` |

逐轮递增，数据逐轮追加，非覆盖。

---

## 二、重构要求核对

| 要求 | 结果 | 证据 |
|---|---|---|
| 主标题英文 | ✅ | `<title>` 与顶栏 `<h1>` 均为 `DSH EM Agent`，**单行渲染** |
| 特殊约束说明精简 | ✅ | 卡片改为「执行方式」，正文仅一行 MCP 说明；卡内 `4.80` / `隔离度` / `自定义指标` 全部清除 |
| 区块说明 + 默认行为 | ✅ | 提示条已加，含"默认执行脚本 / 取消需刷新"说明 |
| 示例参考 | ✅ | 「示例参考：每轮仿真增益 / 效率统计」+ 三列表格（轮次 / 增益 (dB) / 效率 (%)）+ 一键载入按钮 |
| 首次配置入口保留 | ✅ | 齿轮按钮 + 面板，MCP 地址与 CST 路径字段齐全 |
| 未改变关键接口 | ✅ | 原有 78 个 id 全部保留（构建期硬校验），MCP/CST 配置字段未改名 |

### 关于「4.80 GHz 效率抑制 / 隔离度」仍在页面里

这两项仍在折叠的「③ 特殊任务」卡内，作为**可勾选的配置项**存在，不在说明文案里。
这是有意保留的：要求 7 明确"不要改变配置字段等关键接口"，删掉这两个输入项会破坏配置接口。
本次按「内部约束不在页面的**说明区**显示」执行——说明卡片已清空，输入控件保留。

---

## 三、回归与构建门禁

| 套件 | 断言数 | 结果 |
|---|---|---|
| `test-acceptance.cjs` | 38 | ✅ 全部通过 |
| `test-setup.cjs` | 26 | ✅ |
| `test-editor.cjs` | 26 | ✅ |
| `test-blockdata.cjs` | 27 | ✅ |

构建期硬门禁全部通过（补丁精确命中、**反向还原后与基线脚本 SHA256 逐字节一致**、
标签配对、钩子数量、24 组 WCAG 对比度、渲染空白页检测。

---

## 四、视觉评审记录

独立视觉评审两轮（对浅色/深色/编辑器区域截图逐像素核对）：

| 轮次 | 得分 | 结论 |
|---|---|---|
| 第 1 轮 | 7.5 / 7.5 / 7.0 | 指出 5 项缺陷：标题被 flex 拆成 3 行且「·」独占一行、区块徽标仍是胶囊、KPI 空值被涂语义色、示例面板 2/3 空置、启动按钮双主色 |
| 第 2 轮 | **8.8 / 8.5** | 五项全部复核修复；额外发现汇总表「最佳候选」空值仍染绿（已修） |

---

## 五、启动器验证

桌面启动器（`AI-Antenna-Design-DSH-Plugin-Start.bat`，现已更名为 `DSH-EM-Agent-Start.bat`） 已重写并**实际运行**：

```
[1/4] Checking if DSH service is already running...
      DSH already running (HTTP 401). Skipping launch.
[4/4] Verifying the plugin page is being served...
      Plugin OK (HTTP 200).
Opening AI Antenna Design Console...
Done. Plugin ready: http://127.0.0.1:3080/antenna-optimizer-config-panel.html
退出码: 0
```

**顺带修掉了原启动器的一个真实缺陷**：它用 `if "%CODE%"=="200"` 判断 DSH 是否在运行，
但 DSH 根路径返回的是 **401**（需要授权），因此旧脚本永远判定"未运行"，
会去启动第二个 DSH 实例，再等 90 秒后报错退出。
现改为"拿到任何 HTTP 响应码即视为在监听，只有 `000`（连不上）才算未运行"。
另外新增第 4 步：先校验插件页面返回 200 再打开——DSH 升级会清空静态目录，
提前发现比打开一个 404 页面友好。
