# 完整示例

> **文档索引** › [页面编辑器](../README.md) › 完整示例

### 零代码：每轮仿真统计增益与效率（`auto` 模式）

仓库内 `examples/blocks-stats-window.json` 即为此示例，可直接「导入 JSON」使用。

| 配置项 | 值 |
| --- | --- |
| 区块标题 | `增益效率统计` |
| 放置区域 | 通栏 |
| 数据回传 · 通道名 | `stats` |
| 渲染方式 | 内置表格渲染 |
| 累积各轮 | 按需（勾选后保留每轮） |
| 数据要求 | `每轮仿真后输出该轮增益（dBi）与效率（dB）` |
| HTML 源码 | `<div data-block-slot></div>` |

生成的任务指令会自动带上通道 `stats` 与那句数据要求；模型每轮回传后表格即更新。
想先看效果，直接点列表里的 **「测试」** 按钮。

### 自定义脚本：自己画进度条

区块标题「迭代进度」、通道 `progress`、渲染方式「仅派发事件」、勾选**允许执行脚本**：

```html
<div style="font-size:12.5px;color:var(--text-sub);margin-bottom:6px;" id="lbl">等待数据</div>
<div style="height:10px;border-radius:6px;background:var(--surface-3);overflow:hidden;">
  <div id="bar" style="height:100%;width:0;border-radius:6px;
       background:linear-gradient(90deg,var(--primary),var(--primary-dark));
       transition:width .3s ease;"></div>
</div>
<script>
  document.currentScript.closest('.custom-body').addEventListener('block-data', function (e) {
    var d = e.detail;
    var row = (d.payload.rows && d.payload.rows[0]) || [];
    var done = Number(row[0]) || 0, total = Number(row[1]) || 1;
    document.getElementById('bar').style.width = Math.min(100, done / total * 100) + '%';
    document.getElementById('lbl').textContent = '第 ' + d.round + ' 轮 · ' + done + ' / ' + total;
  });
</script>
```

对应模型回传：

````
```dsh-block-data
{"channel":"progress","round":4,"rows":[[4,15]]}
```
````

### 复用页面状态

```html
<button type="button" class="btn btn-xs" id="go">重新预检</button>
<span class="pill" id="st">就绪</span>
<script>
  document.getElementById('go').addEventListener('click', function () {
    if (runState !== 'idle') { toast('任务进行中，当前状态：' + runState, 'warn'); return; }
    document.getElementById('st').textContent = '已触发';
    toast('自定义区块触发了页面动作', 'ok');
  });
</script>
```
