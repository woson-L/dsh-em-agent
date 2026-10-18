# 构建与硬门禁

> **文档索引** › [开发](../README.md) › 构建与硬门禁

产物 `dist/antenna-optimizer-panel.html` 是**生成出来的**，不是手写的。
理解这一点，就理解了本仓库所有改动方式。

```
src/baseline/antenna-optimizer-config-panel.original.html   （只读，永不修改）
        +
src/styles.css                                              （样式，直接编辑）
        +
build/build.ps1 里的 133 处补丁                              （HTML/JS 行为改动）
        ↓
dist/antenna-optimizer-panel.html                           （单文件产物）
        ↓  自动同步
plugin/panel.html                                           （插件包内的副本）
```

---

## 为什么这么麻烦

基线是一个能跑的单文件页面。如果直接改它，就再也说不清「哪一行是原始的、
哪一行是后来加的」——出了问题无法回退，也无法证明没夹带私货。

现在的模型下，产物必须能被**逐字节证明**等于「基线 + 恰好这些改动」。
这由下面的反向还原门禁强制。

---

## 怎么构建

```powershell
# Windows PowerShell 5.1（本机默认）
powershell -NoProfile -ExecutionPolicy Bypass -File build\build.ps1

# 若装了 PowerShell 7
pwsh -File build/build.ps1

# 构建之后：渲染校验（需要 dsh web 在跑；不属于构建的一部分，见下）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\render-check.ps1
```

> **`build.ps1` 只生成产物，不碰 DSH 的安装目录。** 曾经有一个 `build/deploy.ps1`
> 把产物复制进 `<dsh-web-frontend>/dist/` —— 那是**已退役**的「方式 B 静态部署」。
> 2026-10-18 该脚本已删除，原因与风险见 [`../start/repo.md`](../start/repo.md) 的
> 「方式 B · 已退役」。它身上那道「空白页像素检测」已迁到
> [`tools/render-check.ps1`](../../tools/render-check.ps1)，直接对着插件路由跑，
> 不再往 DSH 安装目录写任何文件。

> **不要用 `pwsh` 作为唯一写法。** 本机（以及多数只装了 Windows 自带 PowerShell 的机器）
> 并没有 `pwsh`，写进文档会让人照抄失败。两条都给出，按实际环境选。

构建成功会打印产物大小与 SHA256，并自动把 `dist/` 同步到 `plugin/panel.html`。

---

## 七道硬门禁（外加一道按需执行的渲染校验）

任何一条不通过即中止构建，不产出半成品。

| 门禁 | 作用 |
| --- | --- |
| 补丁精确命中 | 每处补丁必须在基线中恰好匹配 1 次（当前 133 处） |
| **反向还原校验** | 产物里的补丁逐一还原后，必须与基线脚本 **SHA256 逐字节相同** —— 以此证明产物 = 基线 + 恰好这些改动 |
| 结构断言 | `style`/`head`/`body`/`script` 标签配对（曾因漏掉 `</style>` 导致整页空白） |
| 钩子校验 | 原有 78 个 id：**75 个保留 + 3 个显式退役**，新增量与补丁推导值一致 |
| 自定义属性 | 全部 CSS 变量均有定义 |
| WCAG 对比度 | 24 组前景/背景组合：正文 ≥4.5:1，非文本控件 ≥3:1 |
| **内联脚本语法** | 产物里的内联 `<script>` 过一遍 `node --check`。语法错会让**整页脚本不执行**（页面成空壳），而其余门禁一个都发现不了 —— 2026-10-01 实际踩到过；找不到 `node` 时跳过并明确标注「未校验」 |
| 空白页像素检测 | 渲染截图的最大梯度与边缘占比，空白页直接失败 |

（最后一项**不在构建里**执行 —— 它由 [`tools/render-check.ps1`](../../tools/render-check.ps1)
按需跑，因为这一步需要 `dsh web` 正在服务。构建侧仍然是七道。）

### 关于「显式退役」

基线不可变，门禁要求原有 id 一个不少。当某个界面元素被**有意移除**时，
不能直接删掉它的 id，而要把它登记进 `build/build.ps1` 的 `$script:retiredIds`：

```powershell
$script:retiredIds = @('spEfficiencySuppress', 'spEffTarget', 'stStub')
```

门禁随即做**双向校验**：

- 未登记的 id 丢失 → 报错
- 已登记的 id 仍出现在产物里 → 报错（说明退役没做干净）

这样「删除」是**声明式**的，而不是把门禁调松。目前登记的三项：

| id | 原位置 | 原因 |
| --- | --- | --- |
| `spEfficiencySuppress` / `spEffTarget` | ③ 特殊任务 | 「4.80 GHz 效率抑制」属内部约束，不应出现在配置界面 |
| `stStub` | ⑤ 高级设置 · 异常处理策略 | 「增加短截线」按设计移除，只保留缩放重试与强制细化网格 |

---

## ⚠️ BOM 陷阱（务必记住）

**所有含中文的 `.ps1` 都必须保留 UTF-8 BOM。** 目前只有 `build/build.ps1` 一个
（`deploy.ps1` 已删除；`tools/` 下的脚本刻意写成纯 ASCII，见本节末尾）。

这些脚本含大量中文字符串与补丁锚点。无 BOM 时 Windows PowerShell 5.1 会按 GBK 解码，
中文的尾字节会与紧随其后的引号配对、把引号「吞掉」，导致字符串失衡：

```
build/build.ps1    无 BOM：711 处语法错误，脚本完全无法解析
有 BOM：0 处
```

`pwsh` 7 按 UTF-8 读取，没有这个问题 —— 但**多数机器没装 `pwsh`**，
所以 BOM 是本仓库的硬要求，不是可选项。

> **中文落在字符串字面量里最容易中招**：注释被 mangle 最多是显示乱码，而字面量
> （例如状态输出里的 `'是' / '否'`）被 mangle 会直接打断语句、让整个脚本无法解析。
> `tools/restart-verify.ps1` 与 [`tools/render-check.ps1`](../../tools/render-check.ps1)
> 都是**刻意只用 ASCII** 写成的，所以它们没有这个约束 —— 需要跨机器稳定时优先这么写。

**部分编辑器（以及一些自动改写工具）保存时会静默去掉 BOM。**
构建/部署失败并报 `Unexpected token` / `ExpectedValueExpression` /
`The string is missing the terminator` 时，**第一件事就是查 BOM**：

```powershell
# 一次查出所有 .ps1 的 BOM 状态与解析错误数
Get-ChildItem . -Recurse -Filter *.ps1 | ForEach-Object {
  $b = [System.IO.File]::ReadAllBytes($_.FullName)
  $e = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$e)
  "{0,-30} BOM={1,-6} 解析错误={2}" -f $_.Name, ($b[0] -eq 0xEF), $e.Count
}
```

补回：

```powershell
$f = 'build\build.ps1'
$b = [System.IO.File]::ReadAllBytes($f)
if ($b[0] -ne 0xEF) { [System.IO.File]::WriteAllBytes($f, [byte[]](0xEF,0xBB,0xBF) + $b) }
```

> 这不是理论风险：本仓库踩过一次，711 处语法错误、脚本完全无法运行，
> 表现为「构建脚本坏了」而实际只是少了一个 3 字节的 BOM。

### 同一个家族的坑：基线被转成 CRLF

反向还原门禁把产物与 `src/baseline/` **逐字节**比对，而基线在仓库里是 LF。
如果检出时被转成 CRLF，构建会这样失败：

```
补丁 [P1 刻度常量] 命中 0 次（应为 1 次）——基线可能已变动
```

看起来像基线被改坏了，实际只是换行被转换过 —— Git for Windows 默认
`core.autocrlf=true` 就会造成这种检出（2026-10-01 实测复现）。

仓库用根目录的 `.gitattributes`（`* -text`）关闭换行转换，让**检出的字节等于提交的字节**，
Windows / macOS / Linux 一致。**不要删除它**；若修改该规则，请在 Windows 上重新跑一次
`build\build.ps1` 确认七道门禁仍全过。

---

## 提交前脱敏自检

本仓库公开分发，而「本机路径」最容易悄悄混进来 —— 它常常是有用的示例（安装路径、
工作区、测试夹具），写的时候完全合理，公开之后却暴露了作者的机器布局。所以有一个
可执行检查：

```bash
node tools/check-leaks.cjs          # 扫仓库（跳过 dist/ 与历史日志）
node tools/check-leaks.cjs --all    # 连 dist/ 一起扫（发布前用这个）
```

它按「文件:行号」列出命中项并给出建议，**退出码非 0 表示有残留**。
检查项：Windows 绝对路径、POSIX 用户主目录、进程号、真实 launch token、内网地址、
邮箱，以及**运行时的本机主机名与用户名**（这两个不写进仓库，而是运行时从环境取，
所以检查器本身不含任何本机信息）。

`tools/check-leaks.cjs` 里的 `ALLOWED_PATHS` 是**刻意保留的通用示例**
（`C:\Program Files\…` 这类 Windows 惯例路径）；改动白名单要连同 [CHANGELOG](../../CHANGELOG.md)
一起说明理由。

## 补丁怎么写

补丁形如：

```powershell
$new = Apply-Patch $new @'
<原文，必须与基线逐字符一致>
'@ @'
<替换后的内容>
'@ 'P52 简短标签'
```

规则：

- `old` 必须在**当前处理中的文本**里**恰好命中 1 次**（不是 0 次，也不是多次）
- 多处命中时，把上下文一起带上让锚点唯一
- 用 `@'...'@`（单引号 here-string）—— 内容是字面量，不会被 PowerShell 插值，
  这对含 `$` 的 JavaScript 很关键
- 标签会出现在构建输出里，写清楚改了什么

检查清单见 [AGENTS.md](../../AGENTS.md) 第六节。

---

## 相关文档

- [回归测试](tests.md) —— 产物在真实浏览器里的行为验证
- [排查](troubleshooting.md) —— 门禁失败时怎么定位
- [变更记录](../../CHANGELOG.md) —— 已发布版本与脱敏记录
- [可复用的样式令牌](../reference/tokens.md) —— 改样式时会用到
- [AGENTS.md](../../AGENTS.md) —— 改动的强制规则
