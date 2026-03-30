---
"@cvr/stacked": minor
---

Replace rebase fallback with merge-commit fallback for conflict resolution

**Problem:** When `treeMergeSync` detected conflicts, sync fell back to `git rebase --onto` which replays each commit individually. The same conflict hit on every commit, causing duplicate imports, leftover conflict markers, and compounding resolution errors.

**Solution:** On conflict, a single 3-way merge commit replaces the multi-commit rebase replay:

- `prepareConflictMerge` writes conflict markers to the worktree via `checkoutIndex`
- User/agent resolves conflicts once, then `stacked sync --continue` creates a merge commit with `parents: [branchHead, newBaseTip]`
- `stacked sync --abort` discards conflict state and restores the original branch
- Resume state persisted to `.git/stacked-sync-state.json` (atomic write, exclusive lock)

**Other changes:**

- Fixed `mergeTrees` argument order: `(ancestor, branch, newBase)` — corrects ours/theirs conflict marker labels
- Fixed default git backend: `resolveGitBackend(undefined)` now correctly returns `"es-git"` instead of `"cli"`
- Renamed `REBASE_CONFLICT` error code to `SYNC_CONFLICT`
- Removed `--rebase-only` flag (vestigial after rebase fallback removal)
- Added `doctor` check for stale sync state files from interrupted conflict merges
- New `GitService` methods: `prepareConflictMerge`, `finalizeConflictMerge`, `abortConflictMerge`
