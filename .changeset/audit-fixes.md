---
"@cvr/stacked": minor
---

Comprehensive audit fixes across es-git backend, CLI contract, and performance

**Bug fixes:**

- es-git `push` now uses `--force-with-lease` instead of bare `+` force prefix
- es-git `deleteBranch` respects `force` param (shells out to `git branch -d` for safe deletes)
- `commitAmend --edit` works on both backends (spawns with inherited stdio for interactive editor)
- `log` skips merged branches when computing base (same `effectiveBase` pattern as sync/submit)
- `clean` no longer calls `markMergedBranches` after deleting a branch (prevented ghost entries)
- `detect` discovers branches whose parent is already tracked and adopts them into existing stacks
- Regex injection fix in `remoteDefaultBranch` (replaced `new RegExp` with `startsWith`/`slice`)

**Performance:**

- `submit` pre-fetches all PR statuses in parallel (`concurrency: 5`)
- `refreshStackedPRBodies` fetches and updates PRs in parallel
- `doctor` calls `listBranches` once instead of N sequential `branchExists` calls
- `stackFilePath` resolved once at layer construction (memoized)

**CLI contract:**

- `clean` JSON output includes `failed` deletions
- Errors in `--json` mode produce structured `{"error":{...}}` on stdout
- `init` supports `--json` flag
- Added `USAGE_ERROR` and `HAS_CHILDREN` error codes for proper exit codes
- `--verbose` has `-v` alias
- Informational messages respect `--quiet` flag

**Cleanup:**

- Removed dead `if (root === undefined)` guard in `rewriteStackBranches`
- New tests: adopt command, sync rebase failure recovery, v1→v2 migration
