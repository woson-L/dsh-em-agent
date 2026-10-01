# FC2 · Modification Scope

> **Docs index** › [Fixed constraints](README.md) › FC2

**The write whitelist has two entries. All other project content is read-only for the
duration of the run.**

| # | Permitted write |
| --- | --- |
| ① | the shape of the antenna — same plane, same `0.035` mm thickness; see [FC1](fc1-antenna-plane.md) |
| ② | the feed point position, including the feed line or stub that moves with it within the antenna plane |

Prohibited in the same project, in every round:

- modifying or deleting any other `Component`;
- modifying or deleting any other solid, material, port or solver setting;
- renaming an existing object;
- creating a new `Component` and then deleting the old one — the antenna remains
  under the configured 天线对象路径;
- any other write.

A design that requires more than ① and ② is outside the scope of this task. Report
the gap; do not extend the whitelist.

---

## Per-round applicability

FC2 applies to:

- the baseline round;
- every optimisation iteration;
- the pre-check remediation round — the only round permitted to write, and therefore
  the one where the constraint is most easily lost.

A violating round is void: it is not a candidate, it does not enter the target check,
and the run rolls back to the last compliant state.

## Rationale

An optimiser without an explicit scope will normalise the project: renaming
components, merging solids, deleting objects that appear unused. Each such action
invalidates the baseline against which results are compared, and none of them is
visible in an S11 curve. The whitelist is what keeps a run reproducible.

---

## Related docs

- [FC1 · shape only, plane frozen](fc1-antenna-plane.md) — the other half of the pair
- [How the constraints are enforced](enforcement.md) — where this wording lives in the panel
- [Fixed constraints overview](README.md)
