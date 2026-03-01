# @cvr/stacked

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
