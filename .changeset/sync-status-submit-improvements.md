---
"@cvr/stacked": minor
---

`sync` now pushes branches that have local commits ahead of `origin/<branch>`, even when no merge was needed. Previously, branches with committed-but-unpushed work were silently left behind whenever the parent hadn't moved. Detection compares the branch tip to its `origin/<branch>` ref (or pushes if no remote tracking ref exists yet).

`status` now lists every branch in the stack with `↑N` next to branches that have unpushed commits and `(no remote)` next to branches that have never been pushed.

`submit` now runs `sync` before pushing and creating PRs. Pass `--no-sync` to skip the sync step.
