---
"@cvr/stacked": minor
---

Skip merged branches in `sync` and `submit`. Once a PR is merged, the branch stays in `stacked.json` and continues to render in the PR-body metadata table (with ✅), but `sync` no longer merges/pushes it and `submit` no longer pushes or mutates its PR. Children of a merged branch are reparented to the next non-merged ancestor (or trunk). Merge state is detected upfront via `gh.getPR` so the very next sync skips a freshly-merged branch.

`stacked status` now flags merged branches with a dim `✓` and a `(merged)` label so they don't look "stuck". JSON output exposes a new `merged: boolean` field per branch.

`stacked sync --include-merged` forces merged branches back into the sync loop for the rare case you need it.
