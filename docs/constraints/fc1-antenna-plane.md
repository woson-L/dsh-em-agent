# FC1 · Shape Only, Plane Frozen

> **Docs index** › [Fixed constraints](README.md) › FC1

**Only the shape of the antenna at ① 天线对象路径 may change. The plane that antenna
occupies must not move.**

---

## Invariants

| # | Invariant | Value |
| --- | --- | --- |
| 1 | Antenna thickness | `0.035` mm, fixed |
| 2 | Height direction | the direction along which the `0.035` mm is measured — the normal of the antenna plane |
| 3 | Sitting surface | the top or the bottom face of `substrate`; the choice does not change within one task |
| 4 | Port plane | the antenna and the excitation `port` occupy parallel planes at the same height — a single plane |

"Plane" denotes the plane normal to the height direction. Translation along that
normal, tilt, and thickness changes are plane changes, not shape changes.

## Permitted: shape changes

A change is a shape change only if the antenna remains on the same plane:

- the 2-D outline within that plane: patch outline, slots, notches, tapering, folding;
- redrawing the radiator as another planar topology, e.g. a PIFA — the inverted-F
  outline is drawn in the plane;
- length, width or branch changes that keep the body in the plane.

## Prohibited: plane changes

- translation along the height axis;
- a thickness other than `0.035` mm;
- lifting the antenna off the substrate face, or sinking it into the substrate;
- placing the antenna at a height other than the `port` plane;
- any structure that leaves the plane.

> **Outside FC1:** a structure that leaves the plane — a vertical shorting pin, for
> example — is neither a shape change under FC1 nor one of the two permitted writes
> under [FC2](fc2-modification-scope.md). Report such a design requirement; do not
> add it silently.

## Per-round verification

Each round reports `FC1: PASS|FAIL` with evidence: plane coordinate and normal,
measured thickness, substrate face, port plane, and the list of objects modified in
that round. A failing round is not a candidate and is rolled back to the last
compliant state.

---

## Related docs

- [FC2 · modification scope](fc2-modification-scope.md) — what may be written at all
- [How the constraints are enforced](enforcement.md) — where this wording lives in the panel
- [Fixed constraints overview](README.md)
