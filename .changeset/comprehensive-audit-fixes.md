---
"@cvr/stacked": minor
---

Comprehensive audit — security, soundness, UX, and new features

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
