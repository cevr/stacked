---
"@cvr/stacked": minor
---

Comprehensive audit — security, soundness, UX, and new features

**Security:**

- Prevent git flag injection via branch names (`--` separator in git commands)
- Branch name validation (reject `-`-prefixed, `..`, spaces, `.lock`, invalid chars)
- Wrap `Bun.spawn` in `Effect.sync` for referential transparency

**Bug fixes:**

- Spinner shows failure icon on error, warning on interrupt (was always green)
- ANSI codes no longer leak to stdout when piped (separate stdout/stderr color detection)
- `submit` preserves existing PR body on re-submit (was wiping `body` field)
- `clean --json` emits output on all code paths (early return, dry-run, normal)
- `clean` only removes branch from metadata after successful git delete
- `delete` checks for dirty working tree before checkout
- `sync` error message for first branch no longer suggests invalid `--from main`
- `sync --from <last-branch>` warns instead of silently succeeding
- `detect` skips stack creation when name already exists
- `--verbose` and `--quiet` are now mutually exclusive (exit code 2)
- Corrupted stack file backed up before reset

**New features:**

- `--json` output on `status` and `trunk` commands
- `submit --only` flag to process only the current branch
- `submit --title`/`--body` per-branch support (comma-delimited or single-branch)
- Interactive confirmations for `delete` and `clean` (skip with `--yes`/`-y`)
- `adopt` hints to run `stacked sync` after adopting
- Argument descriptions in help output for all commands
- Root command examples in `stacked --help`
- `rebaseOnto` method for more correct commit replay during sync

**Refactoring:**

- Removed dead `mergeBase`, `diff`, `remote` methods from GitService
- Exposed `findBranchStack` as public StackService method
- Replaced inline stack scans in 5 commands with `findBranchStack`
- Error handling uses `Effect.catchTags` instead of manual `_tag` inspection
