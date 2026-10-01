# 从仓库安装与部署

> **文档索引** › [开始使用](../README.md) › 从仓库安装与部署
## 启动方式（两种）

### 方式 A · 作为 DSH 插件安装 ← **从 DSH Store 下载后用这个**

> 📄 **只想照着做一遍就跑起来？** 直接看
> [`store.md`](store.md) ——
> 那份文档按「安装 → 启用 → 启动 → 首次配置 → 依赖 → 卸载 → 排查」线性写完整，
> 专为 Store 安装路径准备，不涉及克隆仓库和构建。本节只讲机制与实测记录。

插件包在 `plugin/`，它把页面挂成 DSH Web 的一条路由，装在 **profile 目录**里，
**不随 DSH 升级丢失**。

```bash
# 1. 装进 web profile（会自动在 profile 目录建立指向本仓库 plugin/ 的链接）
dsh plugin --profile web add <本仓库>/plugin

# 2. 只有在包**没有**自带 dsh.bundle.patch 时才需要手工登记。
#    本包自带（plugin/cordis.patch.yml），dsh plugin add 会自动登记为 profile 层，
#    因此**不要再手工追加下面这段** —— 同一个 id 插入两次会让 loader 抛
#    duplicate loader entry id，DSH 直接起不来。
#    仅当你改用「手工登记」这一条路时，才在 ~/.dsh/profiles/web/cordis.patch.yml
#    顶层数组里追加（必须用 insert 形式；若带 id，该 id 必须对应真实存在的条目）：
#      - insert:
#          - id: em-agent-panel
#            name: dsh-em-agent

# 3. 启动
dsh web
```

打开 **`http://127.0.0.1:3080/em-agent`**。详见 [`plugin/README.md`](../../plugin/README.md)。

> **第 2 步通常不需要重启。** 本 profile 的 `package.json` 里
> `dsh.profile.patchReload` 为 `"live"`，DSH 会监听 `cordis.patch.yml`：
> 保存该文件即热挂载/热卸载这一行，`dsh web` 不必重启。
> 冷启动同样有效——已用独立进程实测（见下方「实测记录」）。

> **为什么不用静态目录：** 2026-09-25 的一次 DSH 升级把
> `<dsh-web-frontend>/dist/` 整个清空，方式 B 部署的页面当场 404。
> 方式 A 的页面来自本仓库，升级碰不到它。

#### 实测记录（2026-09-27）

| 验证项 | 方法 | 结果 |
| --- | --- | --- |
| 包安装 | `dsh plugin --profile web add <repo>/plugin` | ✅ 退出码 0，`link:E:/.../plugin` |
| 路由已挂载 | `GET /antenna-optimizer` | ✅ HTTP 200，187400 字节 |
| 内容一致 | 与 `plugin/panel.html` 比对 SHA256 | ✅ 均为 `5BBA26E9…` |
| 确属插件路由 | 静态目录中并无 `antenna-optimizer` 无扩展名文件 | ✅ 由 `index.js` 提供 |
| 处理器生效 | `POST /antenna-optimizer` | ✅ HTTP 405（`index.js` 行为） |
| 热加载 | 保存 `cordis.patch.yml` 后直接访问 | ✅ 未重启即挂载 |
| **冷启动** | 另起独立 DSH 进程引导同一份配置 | ✅ HTTP 200，187400 字节 |
| 冷启动配置合成 | `dsh --profile web --dump-config` | ✅ 含 `id: em-agent-panel` |
| **生产实例真实重启** | 停掉 `dsh web`(PID <已隐去>) 后重新拉起 | ✅ 5 秒就绪，路由 HTTP 200，旧 PID 已终止 |
| 重启后内容一致 | 再次比对 SHA256 | ✅ 仍为 `5BBA26E9…`，逐字节一致 |
| 重启后处理器生效 | `POST /antenna-optimizer` | ✅ HTTP 405 |

> 重启验证日志存档：[`restart-verify-20260927.log`](../reference/history/restart-verify-20260927.log)，
> 脚本：[`tools/restart-verify.ps1`](../../tools/restart-verify.ps1)。
> 该脚本经 WMI 分离启动（父进程 `WmiPrvSE`），所以宿主 DSH 被杀掉也不会连带
> 杀死它；验证失败时会从 `_backup_*` 还原 profile 配置并再重启一次。
> 注意重启会中断正在进行的 agent 会话。

> `dsh plugin add` 会提示 `declares no dsh.bundle — installed as a plain
> dependency`。**这条提示已经过时**：本包现已声明 `dsh.bundle.patch`，安装时自动登记为 profile 层，不会再出现该提示。旧版本走的是方式 A 的显式 patch 行，而不是靠
> `dsh.bundle.patch` 自动挂载。若将来想省掉第 2 步，可给 `plugin/package.json`
> 增加 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 并自带
> patch 文件，`dsh plugin add` 便会自动把它加进 `dsh.profile.bundles`
> （此时**必须**删掉 profile 里的那一行，否则同一条路由会被注册两次而报错）。

### 方式 B · 直接部署静态页面（已退役）

> ⚠️ **2026-10-01 起退役。** 当天已把部署在静态目录里的 5 个副本全部删除，
> 页面此后只以插件路由（方式 A）分发。`build/deploy.ps1` 仍然可用，但只面向
> 「插件装不上、又必须看一眼界面」的应急场景，不在支持范围内。

退役原因：

| 问题 | 实测 |
| --- | --- |
| 产品名会过期 | 静态副本不会自更新；被删掉的那份仍写着 1.x 的名字 `AI Agent End-to-End Antenna Design` |
| 会掩盖插件故障 | 插件路由坏掉时静态页照样能打开，故障被藏起来 |
| 升级即消失 | 写在 `<dsh-web-frontend>/dist/`（DSH 安装目录），DSH 升级或重装会被整体清空 |
| 验证不覆盖 | [`tools/restart-verify.ps1`](../../tools/restart-verify.ps1) 只断言插件路由与别名；静态地址**返回 404 才是预期** |

应急用法（仅在确有必要时）：

```powershell
# Windows PowerShell 5.1（多数机器只有这个）
powershell -NoProfile -ExecutionPolicy Bypass -File build\deploy.ps1
dsh web
# 默认部署名是 dist 的文件名，所以地址是：
#   http://127.0.0.1:3080/antenna-optimizer-panel.html
# 想换成别的名字： -As "<文件名>"
```

### 启动命令速查

| 目的 | 命令 |
| --- | --- |
| 启动 DSH（连带挂载本插件） | `dsh web` |
| 换端口 | `dsh web --port 8080` |
| 不自动开浏览器 | `dsh web --no-open` |
| 安装本插件 | `dsh plugin --profile web add <路径或包名>` |
| 卸载本插件 | `dsh plugin --profile web remove dsh-em-agent   # 卸载时用包名即可` |
| 查看当前合成的插件树 | `dsh --profile web --dump-config` |
| 打开页面（推荐） | 浏览器访问 `http://127.0.0.1:3080/em-agent`，建议收藏 |

> 直接双击 HTML 文件（`file://`）只能看到界面：依赖同源的 RPC 能力
> （启动仿真、目录选择器、实时订阅、CST MCP 调用）都会降级为「复制指令」模式。
