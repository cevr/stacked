---
"@cvr/stacked": minor
---

Incremental sync via fork-point tracking and tree-merge fast path

**New behavior:**

- `sync` now records `syncedOnto` (the parent branch tip SHA) in stack metadata after each sync
- Branches whose parent hasn't moved since last sync are skipped entirely (no rebase, no push)
- es-git backend uses `mergeTrees` for conflict-free syncs — creates a merge commit instead of replaying, avoiding duplicate code and leftover conflict markers
- Falls back to rebase (with corrected `oldBase` from metadata) when tree-merge detects conflicts or on CLI backend
- `amend` uses the same fork-point-aware algorithm for child rebases
- `create` and `adopt` record initial `syncedOnto` for accurate first sync

**Root cause fixed:**

`merge-base(branch, newBase)` returned wrong results after parent rewrites, causing duplicate code and phantom conflicts during rebase. The new `syncedOnto` metadata provides an exact fork-point instead of a guess.

**New `GitService` method:**

- `treeMergeSync` — computes result tree via 3-way merge, creates merge commit with 2 parents, no replay
