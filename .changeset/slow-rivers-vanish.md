---
"@cvr/stacked": patch
---

`stacked sync` now force-pushes each branch after a successful rebase (using `--force-with-lease`) so rebased branch tips are immediately reflected on remote and stacked PRs stay in sync without a separate submit/push step.
