# 开源待办

> **文档索引** › [开发](../README.md) › 开源待办

发布前建议逐项确认：

- [x] ~~面板的事件流~~ —— 2026-10-01 已接上：`/api/remote.mux` 上的 `session/follow`
      逻辑流，右栏能实时看到模型输出（契约见 [与 DSH 的 RPC 契约](dsh-rpc.md)）
- [ ] **逐字流式输出未启用**：`session/follow` 支持 opt-in `assistantStream` 换取 token 级
      增量，但它要求客户端按 `revision` 连续性自校验；本页只订阅 journal 事件，所以只有
      整条 `assistant/message`，没有打字机效果
- [ ] 会话开头那条 `Current runtime context…` 本身也是 `user/message`，会被照原样显示在
      对话区。它确实是模型收到的内容，但看起来像用户自己发的；暂未过滤
- [ ] **目录选择器不可用**：`host.pickDirectory` 在当前 DSH 版本没有主机端点
      （它是客户端插件 API，独立页面够不到）。目前按钮改成如实提示手动填写；
      要么接受这个限制，要么由插件自己开一条路由实现
- [x] ~~`LICENSE` 的版权行~~ —— 已署名 `woson-L`（`LICENSE:3`，与 `plugin/package.json` 的 `author` 一致）
- [ ] 若一并分发 CST Skill（`cst-onboard-antenna` / `cst-simulation-workflow` /
      `cst-multiband-antenna-optimization`），确认其来源与再分发条件
- [ ] 若一并分发 CST MCP，确认上游许可与版权（其 `pyproject.toml` 声明为 MIT，
      但请以实际取得的版本为准）
- [ ] DSH Skill 元数据中若有 `"distribution": "internal"` / `"license": "NOASSERTION"`，
      对外发布前应改为实际值
- [x] ~~清理示例配置中的本机路径~~ —— 已随开源脱敏处理：测试夹具、截图脚本与文档示例统一为 `C:\` 惯用路径，详见 [开源待办](roadmap.md) （测试夹具、截图脚本与文档示例统一为 `C:\` 惯用路径）
- [ ] 确认 `dist/shots/` 下的截图不含敏感信息后再决定是否入库
