# AGENTS.md · 本仓库的工作规则

> 这份文件写给**在本仓库工作的 AI Agent**。

---

## 一、文档同步政策（强制）

**规则：** 涉及用户可见行为的代码变更，其文档更新必须包含在同一次 PR 中。
文档是变更的组成部分，不得作为后续任务单独补充。

**适用范围：** 以下变更类型触发文档更新要求。

- 用户可见功能的新增、修改或移除；
- CLI / API 行为、配置项、部署方式的变化；
- 数据存储位置、导出格式、初始化流程的变化。

本仓库的具体对应关系见下表。映射表未覆盖的改动，以「文档描述是否仍与代码行为一致」为判据。

### 改动 → 文档映射

| 你改了什么 | 必须同步更新 |
| --- | --- |
| 配置面板字段（增删改、默认值、校验） | [`docs/panel/sections.md`](docs/panel/sections.md) |
| **固定约束 FC1 / FC2 的文案或下发位置** | [`docs/constraints/`](docs/constraints/README.md) 全组（四份）+ [`docs/panel/sections.md`](docs/panel/sections.md) |
| 频段 / 特殊任务的增删改 | [`docs/panel/custom-items.md`](docs/panel/custom-items.md) |
| localStorage 的键或结构 | [`docs/panel/storage.md`](docs/panel/storage.md) |
| 页面编辑器 / 区块字段 / 事件契约 | [`docs/editor/blocks.md`](docs/editor/blocks.md) + [`overview.md`](docs/editor/overview.md) |
| 数据回传格式 | [`docs/editor/data-protocol.md`](docs/editor/data-protocol.md) |
| 新增可调用的全局函数 | [`docs/editor/api.md`](docs/editor/api.md) |
| 安装 / 启用 / 启动步骤 | [`docs/start/store.md`](docs/start/store.md) |
| 依赖（新增或移除） | [`docs/start/dependencies.md`](docs/start/dependencies.md) |
| 构建流程或硬门禁 | [`docs/dev/build.md`](docs/dev/build.md) |
| 测试套件（新增 / 断言数变化） | [`docs/dev/tests.md`](docs/dev/tests.md) |
| **移除**界面元素 | 对应功能文档 + [`docs/dev/troubleshooting.md`](docs/dev/troubleshooting.md) 里若有该现象的条目 |
| 新增一份文档 | [`docs/README.md`](docs/README.md) 索引 + 相关文档的文末链接 |

**完成标准：** PR 合并后，文档描述必须与代码行为一致。
审查者应验证文档内容可准确反映本次改动后的实际行为。

### 移除元素时的额外动作

本仓库的构建门禁要求**基线里每个 id 都出现在产物中**。因此移除一个界面元素
不能直接删除 HTML，而应：

1. 在 `build/build.ps1` 的 `$script:retiredIds` 中**显式登记**该 id；
2. 在对应回归测试中加入「该 id 不存在」的断言；
3. 更新文档。

只做第 1 步时产物干净但运行时不受约束；两步都不做时构建直接失败。

---

## 二、文档写作约定

- **渐进式披露**：每份文档保持短小；超过约 300 行时考虑拆分。
- **索引在上**：根 [`README.md`](README.md) 为总索引，[`docs/README.md`](docs/README.md)
  为分组索引；新增文档必须登记。
- **文末给出「相关文档」**：每份文档以相对链接列出兄弟文档。
- **跨文档引用一律用相对链接**，不用「第 N 节」——章节编号随拆分漂移，链接不会。
  本文档自身的章节可自引用（「见第 3 节」）。
- **不写未验证的 API**：运行时行为必须来自代码或实测，不能来自记忆；不确定时先读实现。

---

## 三、定期人工检查（强制）

文档同步政策无法自我执行：映射表覆盖再全，仍会出现只改代码、未改文档的提交。
因此设置一道人工检查。

**周期：** 每个发布周期至少一次。

**检查项：**

1. 近期改动的功能，文档是否同步；
2. 文档与代码是否存在不一致——重点是默认值、字段名、命令；
3. 文档间的相对链接是否可达——目录改名后最易断裂；
4. 新增文档是否已登记进索引。

**不一致的处理：** 优先怀疑文档过期，但也可能是代码错误；两者必须收敛到同一结论。
处理结果记入当次提交说明或 issue，不保留在会话记录中。

**检查方法：** 改动完成后，由 AI 通读受影响的文档，逐条指出与代码不符之处。
提问「这份文档现在哪里说错了」比「文档是否需要更新」更易得到有效结论。

---

## 四、协作方式

| 阶段 | 文档责任 |
| --- | --- |
| 讨论 | 不修改文档，也不产出文档草稿 |
| 执行 | 方案确认并开始改代码后，由 **AI 同步更新文档**，与代码改动一并交付 |

人类协作者仅在定期检查时验证一致性。该划分用于避免两类无效工作：
讨论阶段产出将作废的草稿；执行阶段遗漏文档。

---

## 五、提交前自检

- [ ] 代码改动完成，构建门禁全过
- [ ] 相关回归测试已更新，且全过
- [ ] 上表里对应的文档已同步修改
- [ ] 新增文档已登记进 [`docs/README.md`](docs/README.md)
- [ ] 文末「相关文档」链接可达，相对路径正确
- [ ] 若移除了界面元素：已登记进 `$script:retiredIds`，并加了不存在断言

---

## 六、三条不可违反的技术约束

1. **`src/baseline/` 只读。** 任何改动都通过 `build/build.ps1` 的补丁或 `src/styles.css` 表达。
2. **含中文的 `.ps1` 必须保留 UTF-8 BOM**（`build/build.ps1`、`build/deploy.ps1`）。
   缺少 BOM 时它们在 Windows PowerShell 5.1 下无法解析（分别 711 / 9 处语法错误）。
   部分编辑器与自动改写工具会静默移除 BOM，改完脚本后需确认一次。
   同样属于字节级要求：根目录 `.gitattributes` 以 `* -text` 关闭换行转换 ——
   `src/baseline/` 一旦在检出时变成 CRLF，反向还原门禁会以「补丁命中 0 次」失败。
3. **补丁必须精确命中 1 次。** 命中 0 次说明基线已变动或锚点写错；命中多次说明锚点不唯一。

详见 [`docs/dev/build.md`](docs/dev/build.md)。
