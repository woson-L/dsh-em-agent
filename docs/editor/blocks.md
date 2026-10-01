# 区块格式规范

> **文档索引** › [页面编辑器](../README.md) › 区块格式规范

一个「自定义区块」就是**一段你自己写的 HTML**，加上一组元数据（放哪、要不要接数据、
接哪个通道）。页面负责把它挂进版面、把数据送进来；渲染成什么样由你决定。

- 只想显示表格 → 写 `<div data-block-slot></div>`，选「内置表格渲染」，不用写一行 JS
- 想自己画 → 选「自定义渲染」，监听 `block-data` 事件自己操作 DOM

---

## 快速上手

1. 页面上找到「页面编辑器」卡片，点 **新增区块**
2. **标题**：随便填，例如 `每轮增益统计`
3. **区域**：`full` / `left` / `right`
4. **HTML 源码**：填 `<div data-block-slot></div>`
5. **数据回传通道**：填 `stats`（留空 = 不接数据）
6. **渲染方式**：选「内置表格渲染」
7. 保存

保存后右上角出现该区块。点它上面的 **测试** 按钮可以塞一份假数据，**不用真跑仿真**
就能看到渲染效果——这是最省时间的调试方式。

---

## HTML 源码怎么写

### 你可以写什么

区块的 HTML 会被注入到一个 `<article class="custom-block">` 里，里面是**真实的 DOM**，
不是 iframe。因此：

- 任意 HTML 标签、`class`、内联样式都可用
- **能直接使用页面的样式令牌**（`var(--text)`、`var(--surface)` 等），
  清单见 [样式令牌](../reference/tokens.md) —— 这样你的区块会自动跟随亮/暗主题
- 用页面的工具类（`.card`、`.mono`、`.btn` 等）可以省掉大半样式

### 数据落点：`data-block-slot`

**内置表格渲染**不会碰你的 HTML，它只往**标记了 `data-block-slot` 的元素**里写表格：

```html
<div data-block-slot></div>
```

- 没有这个元素时，页面会在区块内容**末尾追加**一个（所以不写也能用，只是位置不由你定）
- 有多个时只认**第一个**
- 你想让表格出现在标题下方，就把 slot 放在标题下方

`data-block-slot` 为空时该元素不占位（`[data-block-slot]:empty { display: none }`），
所以不会留下空盒子。

### 静态区块

不需要接数据的区块（说明卡片、外部链接、快捷按钮）把「数据回传通道」留空即可，
HTML 写什么就显示什么。

---

## 字段参考

```json
{
  "id": "blk-a1b2c3d4",
  "name": "增益效率统计",
  "zone": "full",
  "html": "<div data-block-slot></div>",
  "enabled": true,
  "allowScripts": false,
  "channel": "stats",
  "demand": "每轮仿真后输出该轮增益（dBi）与效率（dB）",
  "renderMode": "auto",
  "keepHistory": false,
  "config": "precision=2\nunit=dBi"
}
```

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 自动生成 | 唯一标识，导入合并以此为准，建议 `blk-` 前缀 |
| `name` | string | `""` | 区块标题；留空显示「自定义区块」 |
| `zone` | `"full"` \| `"left"` \| `"right"` | `"full"` | 放置区域；非法值回退为 `full` |
| `html` | string | `""` | 区块内容；为空不允许保存 |
| `enabled` | boolean | `true` | 关闭后不渲染，**也不接收数据** |
| `allowScripts` | boolean | `false` | 是否执行区块内的 `<script>`，见 [安全说明](../reference/security.md) |
| `channel` | string | `""` | 数据通道名；留空 = 不接收数据 |
| `demand` | string | `""` | 数据要求的自然语言描述，会注入模型指令 |
| `renderMode` | `"auto"` \| `"custom"` | `"auto"` | `auto` 内置表格渲染；`custom` 只派发事件 |
| `keepHistory` | boolean | `false` | `false` 只显示最新一轮；`true` 累积显示各轮 |
| `config` | string | `""` | 自定义配置，每行 `key=value`；脚本内用 `block.config` 读取 |

`channel` 只允许字母、数字、下划线、点、短横线，或通配符 `*`（匹配所有通道），保存时校验。

> **`enabled: false` 的区块收不到数据。** 数据投递要求区块卡片在 DOM 里存在，
> 关闭的区块不会被渲染出来，因此投递直接返回失败。调试时别把它关掉。

---

## 两种渲染方式

### 内置表格渲染（`auto`）

页面把每一轮数据渲染成一张表写进 `data-block-slot`。你不需要写 JS。

- `keepHistory: false` → 只显示最新一轮
- `keepHistory: true` → 每轮一张表，按轮次累积

单元格会自动着色：`PASS`/`OK`/`达标`/`通过`/`合格`/`yes`/`true` 显示为绿色，
`FAIL`/`未达标`/`不通过`/`不合格`/`no`/`false` 为红色，`WARN`/`警告`/`注意`/`pending` 为橙色。

### 自定义渲染（`custom`）

页面只派发一个事件，DOM 完全由你控制。事件在区块的 `.custom-body` 上触发：

```js
document.currentScript.closest('.custom-body')
  .addEventListener('block-data', (e) => { /* e.detail */ });
```

`e.detail` 的完整结构：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `payload` | object | 本轮数据（结构见第 5 节） |
| `history` | object[] | 该区块累积的全部数据，**上限 200 条**，超出丢弃最旧的 |
| `round` | number \| string \| null | 便于快速取轮次；**同时驱动顶栏「迭代进度」**（取最大值，不回退） |
| `block.id` / `.name` / `.channel` | string | 区块标识 |
| `block.config` | object | `config` 字段按 `key=value` 解析后的对象 |

`history` **仅存内存**，刷新页面即清空。要长期留存请在脚本里自行写入 `localStorage`。

---

## 数据载荷格式

模型回传的数据用 ` ```dsh-block-data ` 围栏包裹，内容是**单行合法 JSON**：

````
```dsh-block-data
{"channel":"stats","round":1,"columns":["轮次","增益","效率"],"rows":[[1,"2.1","-0.8"]]}
```
````

标准结构：

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `channel` | string | 目标通道；省略为 `default` |
| `round` | number \| string | 轮次 |
| `title` | string | 该表的标题 |
| `note` | string | 表下角注 |
| `columns` | string[] | 表头；不给且有 `rows` 时自动生成「列 1、列 2…」 |
| `rows` | array[] | 二维数组，单元格可为任意标量 |

两种简写（免去写 `columns`）：

```jsonc
// metrics 形式 → 自动得到表头 [指标, 数值, 单位, 判定]
{"channel":"stats","round":2,"metrics":[
  {"name":"增益","value":"2.4","unit":"dBi","status":"PASS"},
  {"name":"效率","value":"-1.1","unit":"dB","status":"WARN"}
]}

// values 形式 → 自动得到表头 [指标, 数值]
{"channel":"stats","round":3,"values":{"增益":"2.6","效率":"-0.9"}}
```

同一段 JSON 只会被路由一次（按内容签名去重），重复粘贴不会重复渲染。
完整的回传约定见 [数据回传协议](data-protocol.md)。

---

## 脚本能力

「允许执行脚本」**默认是勾选的**：新增区块后其 `<script>` 会立即执行。取消勾选后再保存，脚本不再执行（已注册的定时器与监听需刷新页面才彻底停止）。

- 注入的 `<script>` 不会被浏览器自动执行，页面是**显式动态创建 script 元素**执行的——
  这是一项明示能力，不是注入漏洞
- 取消勾选后不会再次执行；但**已经执行过**的脚本注册的定时器/监听不会自动解除，
  需要刷新页面才彻底停止
- 脚本里可用的全局函数见 [可调用 API 清单](api.md)
- 风险与边界见 [安全说明](../reference/security.md)

---

## 示例

### 最简：内置表格（零 JS）

```html
<div data-block-slot></div>
```

配合：通道 `stats`、渲染方式「内置表格渲染」、累积历史勾上。

### 带标题与说明的表格容器

```html
<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px;">
  <b style="font-size:13px;color:var(--text);">每轮仿真结果</b>
  <span style="font-size:11.5px;color:var(--text-sub);">数据由大模型按通道回传</span>
</div>
<div data-block-slot></div>
```

### 自定义渲染：接收事件后自己画

```html
<div id="live" style="font:12.5px/1.7 var(--mono);color:var(--text-sub);">等待数据…</div>
<script>
(function () {
  var box = document.currentScript.parentElement.querySelector('#live');
  document.currentScript.closest('.custom-body').addEventListener('block-data', function (e) {
    var d = e.detail;
    var p = d.payload;
    var rows = (p.rows || []).map(function (r) { return r.join(' / '); }).join('\n');
    box.textContent = '第 ' + p.round + ' 轮（累计 ' + d.history.length + ' 条）\n' + rows;
  });
})();
</script>
```

配合：渲染方式选「自定义渲染」，并勾上「允许执行脚本」。

> `renderMode: "custom"` 时内置表格**不会**渲染，两者不叠加。
> 但若脚本没勾选「允许执行脚本」，事件也不会派发——那时区块就是纯静态的。

### 读取自定义配置

源码：

```html
<div data-block-slot></div>
<div id="foot" style="font-size:11.5px;color:var(--text-mute);margin-top:6px;"></div>
<script>
document.currentScript.closest('.custom-body').addEventListener('block-data', function (e) {
  var c = e.detail.block.config;          // config 字段解析后的对象
  document.getElementById('foot').textContent =
    '精度 ' + (c.precision || '?') + ' 位，单位 ' + (c.unit || '?');
});
</script>
```

「自定义配置」栏填：

```
precision=2
unit=dBi
```

### 静态说明卡片（不接数据）

```html
<div style="font-size:13px;line-height:1.75;color:var(--text-sub);">
  <b style="color:var(--text);">本面板做什么</b><br>
  驱动 CST 做多频段天线优化：配置左栏 → 启动仿真 → 右侧实时显示大模型输出与阶段。
</div>
```

「数据回传通道」留空即可。

---

## 导出 / 导入

导出文件：

```json
{
  "type": "dsh-antenna-panel-blocks",
  "version": 1,
  "blocks": [ { "id": "blk-...", "name": "...", "...": "..." } ]
}
```

导入时**也接受裸数组** `[ {...}, {...} ]`，方便手写。合并规则按 `id`：
同 id 覆盖，新 id 追加，不会清掉已有区块。

可直接导入的现成示例见 [完整示例](examples.md)。

---

## 相关文档

- [页面编辑器](overview.md) —— 界面上的操作
- [数据回传协议](data-protocol.md) —— 模型侧怎么把结果送回来
- [可调用 API 清单](api.md) —— 脚本里能用哪些全局函数
- [完整示例](examples.md) —— 可直接导入的区块
- [样式令牌](../reference/tokens.md) —— 让区块跟随亮/暗主题
- [安全说明](../reference/security.md) —— 脚本执行的边界
