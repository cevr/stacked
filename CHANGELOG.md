# @cvr/stacked

## 0.6.0

### Minor Changes

- [`a52bb03`](https://github.com/cevr/stacked/commit/a52bb0370b611f5caac4bcc9859f7834204727bb) Thanks [@cevr](https://github.com/cevr)! - Incremental sync via fork-point tracking and tree-merge fast path

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

## 0.5.0

### Minor Changes

- [`dd5892c`](https://github.com/cevr/stacked/commit/dd5892cf861d0024b0a2ea559f53fa5eaf416e6c) Thanks [@cevr](https://github.com/cevr)! - Comprehensive audit fixes across es-git backend, CLI contract, and performance

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

## 0.4.4

### Patch Changes

- [`8e7a73e`](https://github.com/cevr/stacked/commit/8e7a73edb67e4408bc5ac143e5cb5c8572b2c2b1) Thanks [@cevr](https://github.com/cevr)! - Default the git backend to `es-git` while keeping `STACKED_GIT_BACKEND=cli` as an escape hatch.

- [`9a7e815`](https://github.com/cevr/stacked/commit/9a7e815504d3a9b7d2d6d23701f570d669fdd4ac) Thanks [@cevr](https://github.com/cevr)! - Migrate stack metadata to an explicit v2 parent-link format with automatic v1 upgrade, reroot surviving stacks when lower branches disappear, and speed up `detect` by switching from pairwise ancestor checks to first-parent history walks.

## 0.4.3

### Patch Changes

- [`ab64012`](https://github.com/cevr/stacked/commit/ab64012a878cf802df4b88a8eb2de9cf2d122087) Thanks [@cevr](https://github.com/cevr)! - Restore the original branch after `stacked sync` completes instead of leaving the user at the top of the stack.

## 0.4.2

### Patch Changes

- [`aa25c2e`](https://github.com/cevr/stacked/commit/aa25c2e8cdd5c8ae443a7cd8901ae047e9556168) Thanks [@cevr](https://github.com/cevr)! - Improve trunk auto-detection by preferring the repo default branch from `origin/HEAD`, falling back to common local branch names, and align onboarding/docs to present manual trunk configuration as an override rather than a required setup step.

## 0.4.1

### Patch Changes

- [`58ed4ff`](https://github.com/cevr/stacked/commit/58ed4ff7e304cebf2d4a12780e2f2dcb3725b13b) Thanks [@cevr](https://github.com/cevr)! - `stacked sync` now force-pushes each branch after a successful rebase (using `--force-with-lease`) so rebased branch tips are immediately reflected on remote and stacked PRs stay in sync without a separate submit/push step.

- [`02c916b`](https://github.com/cevr/stacked/commit/02c916b9dc3bb09d9c3f3de8c61dad660a602469) Thanks [@cevr](https://github.com/cevr)! - Fix critical CLI and stacked workflow correctness issues.
  - Stop command execution when conflicting global flags are passed (`--verbose` with `--quiet`) and exit with code `2`.
  - Ensure `submit` refreshes stack metadata for PRs created in the same run, so links are complete without a second submit.
  - Add machine-readable output for `submit --dry-run --json` with `would-*` actions.
  - Validate `amend --from` before mutating commit history.
  - Treat reorder operations that target the same branch as explicit no-ops.
  - Upgrade to Effect beta `4.0.0-beta.27` and align `@effect/platform-bun`.

- [`7bcaefb`](https://github.com/cevr/stacked/commit/7bcaefb4030e7bbe298afe7e8131c3ad04bb8039) Thanks [@cevr](https://github.com/cevr)! - Improve `detect` performance and configuration handling.
  - Prevent `stacked detect` from hanging on very large repositories by limiting ancestry analysis to a bounded number of untracked branches.
  - Add `STACKED_DETECT_MAX_BRANCHES` (default `200`) as an Effect `Config` value.
  - Prefer most recently updated local branches during detection to keep bounded scans focused on active work.
  - Migrate remaining env-based settings in `init` and UI color handling to Effect `Config` for consistency and testability.
  - Make UI color helpers effectful and update command rendering paths accordingly.

## 0.4.0

### Minor Changes

- [`0dd68ee`](https://github.com/cevr/stacked/commit/0dd68ee29d0bda42698b212ce9c6c06aacdf2473) Thanks [@cevr](https://github.com/cevr)! - Comprehensive audit — security, soundness, UX, and new features

  **Security:**
  - Prevent git flag injection via branch names (`--` separator in git commands)
  - Branch name validation (reject `-`-prefixed, `..`, spaces, `.lock`, ending `.`, ending `/`, single `@`, empty, invalid chars)
  - Wrap `Bun.spawn` in `Effect.sync` for referential transparency

  **Bug fixes:**
  - Spinner shows failure icon on error, warning on interrupt (was always green)
  - ANSI codes no longer leak to stdout when piped (separate stdout/stderr color detection)
  - `submit` preserves existing PR body on re-submit (was wiping `body` field)
  - `clean --json` emits output on all code paths (early return, dry-run, normal)
  - `clean` only removes branch from metadata after successful git delete
  - `delete` checks for dirty working tree before checkout
  - `sync` no longer auto-aborts rebase on conflict — leaves in progress for user resolution
  - `sync` uses `rebaseOnto` with merge-base computation to avoid duplicating commits
  - `sync --from <last-branch>` warns instead of silently succeeding
  - `detect` skips stack creation when name already exists
  - `--verbose` and `--quiet` are now mutually exclusive (exit code 2)
  - Corrupted stack file backed up before reset
  - Navigation commands respect `--quiet` flag

  **New features:**
  - `stacked amend` — amend commit + auto-rebase children (`--edit`, `--from`, `--json`)
  - `stacked doctor` — check metadata health, auto-fix stale branches (`--fix`, `--json`)
  - `stacked rename` — rename stacks (`--json`)
  - `stacked reorder` — move branches within a stack (`--before`, `--after`, `--json`)
  - `stacked split` — split stack at a branch point (`--dry-run`, `--json`)
  - `--json` and `--dry-run` on `sync` command
  - `--json` on navigation commands (`checkout`, `up`, `down`, `top`, `bottom`)
  - `--dry-run` on `delete` command
  - Error codes on all errors (structured `Error [CODE]: message` format)
  - Exit code 2 for usage errors, 1 for operational errors
  - `create` and `adopt` are idempotent (safe to re-run)
  - Global flags visible in `--help` output
  - `init` prints next-steps guidance
  - `submit --only` flag to process only the current branch
  - `submit --title`/`--body` per-branch support (comma-delimited or single-branch)
  - Interactive confirmations for `delete` and `clean` (skip with `--yes`/`-y`)
  - `adopt` hints to run `stacked sync` after adopting
  - Argument descriptions in help output for all commands
  - Root command examples in `stacked --help`

  **Refactoring:**
  - `Effect.fn` wrapping for all ui functions (trace spans)
  - Removed dead code and deduplicated stack lookups
  - Error handling uses `Effect.catchTags` instead of manual `_tag` inspection
  - Exposed `findBranchStack` as public StackService method

## 0.3.0

### Minor Changes

- [`ed2a1dc`](https://github.com/cevr/stacked/commit/ed2a1dcfcad679890729762157e99932f056ddb6) Thanks [@cevr](https://github.com/cevr)! - Add `detect` command to auto-discover linear branch chains from git history and register them as stacks. Forked branches are reported but skipped.

## 0.2.0

### Minor Changes

- [`6910bcc`](https://github.com/cevr/stacked/commit/6910bcc7e6bfac5ba435a01b0d91340f58f79afe) Thanks [@cevr](https://github.com/cevr)! - Add `clean` command to remove merged branches from stacks, and show PR merge status in `list` output.

- [`1f50f80`](https://github.com/cevr/stacked/commit/1f50f8079172685471ce5757b1ca4efc6a2ad5c8) Thanks [@cevr](https://github.com/cevr)! - Add `stacks` command to list all stacks in a repo, and allow `list` to accept an optional stack name argument to view any stack.

### Patch Changes

- [`906600e`](https://github.com/cevr/stacked/commit/906600e263080f444fa312d701a0f74effd891fe) Thanks [@cevr](https://github.com/cevr)! - `clean` now removes merged branches bottom-up only, stopping at the first non-merged branch to prevent orphaned branches. Skipped merged branches are reported to the user.

## 0.1.1

### Patch Changes

- [`a44a035`](https://github.com/cevr/stacked/commit/a44a035db0a7c94bb1b4a376535ae8710275fb18) Thanks [@cevr](https://github.com/cevr)! - Remove `restack` command in favor of `sync --from <branch>` which rebases only children of the specified branch.
