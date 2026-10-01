# Fixed Constraints for Antenna Simulation (天线仿真固定约束)

> **Docs index** › [Fixed constraints](README.md) › Overview

FC1 and FC2 are fixed constraints: they are not configuration options, they cannot
be relaxed from the panel, and they apply to every CST round. All other panel
settings remain configurable.

| ID | Constraint | Chapter |
| --- | --- | --- |
| **FC1** | Only the antenna shape may change; the plane it occupies must not move | [FC1 · shape only, plane frozen](fc1-antenna-plane.md) |
| **FC2** | Only the antenna shape and the feed point may be written; no other `Component` is touched | [FC2 · modification scope](fc2-modification-scope.md) |

A run that cannot meet the S11 targets without violating FC1 or FC2 is invalid:
the constraints take precedence over the targets.

---

## Delivery surfaces

The wording is generated once in the panel and reused by every surface that reaches
the model.

| Surface | Constraint carrier |
| --- | --- |
| Task instruction | Section `# 7.2 天线仿真固定约束`; referenced from `# 6`, `# 9`, `# 10` |
| Pre-check instruction | Standing clause above the check list |
| Pre-check remediation round | Clause repeated; this is the one round that may write |
| ⑤ 高级设置 · 天线厚度 | Read-only field, pinned to `0.035` mm |

Complete surface list, the constant behind them and the regression suite:
[How the constraints are enforced](enforcement.md).

---

## Related docs

- [FC1 · shape only, plane frozen](fc1-antenna-plane.md) — antenna plane, thickness and port plane
- [FC2 · modification scope](fc2-modification-scope.md) — the two-entry write whitelist
- [How the constraints are enforced](enforcement.md) — instruction sections, panel constant, regression suite
- [Configuration fields](../panel/sections.md) — where ① 天线对象路径 / 基板对象路径 are entered
- [Custom bands and special requirements](../panel/custom-items.md) — the configurable parts of the instruction
