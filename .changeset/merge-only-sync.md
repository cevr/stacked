---
"@cvr/stacked": major
---

Replace rebase-based sync with a pure merge model.

- `sync` now fast-forwards trunk onto `origin/<trunk>` and merges each parent into its child (`git merge --no-ff`). No rebases anywhere in the stack.
- `submit` plain-pushes (no force). Sync never rewrites history, so pushes always fast-forward. `--no-force` flag removed.
- Conflict flow simplified: resolve in place, then `stacked sync --continue` commits the merge; `stacked sync --abort` aborts the merge cleanly.
- Removed the `es-git` backend and `STACKED_GIT_BACKEND` env var. The CLI backend is the only backend.
- Trunk fast-forward fails if trunk has diverged from origin — reconcile manually before syncing.
- `amend` uses the same merge loop to propagate amended parents into children.
