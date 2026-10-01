# 数据回传协议

> **文档索引** › [页面编辑器](../README.md) › 数据回传协议

这是「模型输出 → 指定区块」的通道。

### 页面侧：把通道写进指令

只要存在至少一个 `enabled` 且配置了 `channel` 的区块，任务指令末尾会自动追加：

```
# 16. 数据回传协议（页面自定义区块）
...已配置的通道：
- `stats`（区块：增益效率统计），数据要求：每轮仿真后输出该轮增益（dBi）与效率（dB）
```

### 模型侧：按约定回传

模型在**每轮迭代结束时**输出一个围栏代码块：

````
```dsh-block-data
{"channel":"stats","round":3,"title":"第 3 轮","columns":["指标","数值","单位","判定"],"rows":[["增益","2.41","dBi","PASS"],["效率","-1.82","dB","PASS"]]}
```
````

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `channel` | 是 | 目标通道名，对应区块的 `channel` |
| `round` | 否 | 轮次，用于标题与历史；**并驱动顶栏「迭代进度」**（`round / 最大迭代次数`，单调不回退），同时**决定运行监控曲线的轮次归属**（同一条消息里的频率–S11 点会落到本轮；一次都没回传过轮次时归到第 0 轮「基线」） |
| `title` | 否 | 表格标题；标题里已含轮次数字则不重复追加 |
| `columns` | 否 | 表头数组；缺省时按第一行生成「列 N」 |
| `rows` | 三选一 | 二维数组，最直观 |
| `values` | 三选一 | 键值对象 `{"增益":"2.41 dBi"}`，自动转两列表格 |
| `metrics` | 三选一 | `[{"name","value","unit","status"}]`，自动转四列表格 |
| `note` | 否 | 表格下方的小字说明 |

### 路由规则

- 投递给所有 `enabled === true` 且 `channel` 匹配的区块；`channel === "*"` 接收所有通道
- 同一条 JSON 只投递一次（流式输出会反复解析累积文本，内部按 JSON 内容去重）
- 每次投递写入该区块的内存历史（最多 200 条）；`keepHistory` 决定展示全部还是仅最新
- 编辑任意区块会重建 DOM，已收到的数据会从内存历史**自动回填**，不会丢
- **历史仅存内存**，刷新页面后清空；需要长期留存请在脚本里自行写入 `localStorage`

### 渲染方式

**`auto`（内置表格）** —— 不需要写任何脚本。渲染结果写入区块内容中标记了
`data-block-slot` 的元素；没有该元素时追加到内容末尾。

```html
<div data-block-slot></div>
```

特性：

- 判定列自动着色：`PASS`/`OK`/`达标`/`通过`/`合格`/`yes`/`true` → 绿色；
  `FAIL`/`未达标`/`不通过`/`不合格`/`no`/`false` → 红色；`WARN`/`警告`/`注意`/`pending` → 琥珀色
- **表头与单元格一律用 `textContent` 写入**，模型输出无法注入 HTML

**`custom`（自定义脚本）** —— 页面在区块内容元素上派发 `block-data` 事件：

```html
<div id="out">等待数据</div>
<script>
  document.currentScript.closest('.custom-body').addEventListener('block-data', function (e) {
    var d = e.detail;
    d.payload;          // 归一化数据：{ channel, round, title, note, columns, rows }
    d.history;          // 该区块收到的全部数据（数组）
    d.round;            // 轮次
    d.block.id;         // 区块 id
    d.block.name;       // 区块标题
    d.block.channel;    // 通道名
    d.block.config;     // 自定义配置解析后的对象
    document.getElementById('out').textContent =
      '第 ' + d.round + ' 轮，共 ' + d.payload.rows.length + ' 行';
  });
</script>
```

> `custom` 模式**不会**自动渲染表格；需要显示表格请自行处理，或改用 `auto`。
