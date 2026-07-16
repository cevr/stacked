# Stacked Codemap

## Architecture

- `src/main.ts`: CLI entry + command wiring.
- `src/commands/*.ts`: command handlers (`sync`, `submit`, `clean`, etc.).
- `src/services/Git.ts`: typed shell wrapper around git operations (CLI backend).
- `src/services/GitHub.ts`: `gh` wrappers for PR read/create/update.
- `src/services/RepositoryStore.ts`: remote-keyed global repository identity, atomic persistence, locking, and legacy-file discovery.
- `src/services/Stack.ts`: topology schema, v1→v2 migration, clone-state projection, and stack mutations.
- `src/errors/index.ts`: tagged error types/codes.
- `tests/commands/*.test.ts`: command behavior tests via mock services.

## High-Leverage Files

| File                              | Purpose                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `src/commands/sync.ts`            | Stack merge orchestration + push behavior + conflict messaging |
| `src/commands/submit.ts`          | PR creation/update, base retarget, stacked metadata block      |
| `src/commands/reparent.ts`        | Subtree-move CLI, dry-run, and machine-readable output         |
| `src/services/Git.ts`             | Single choke point for git process behavior/options            |
| `src/services/RepositoryStore.ts` | Shared topology and clone-state persistence boundary           |
| `tests/helpers/test-cli.ts`       | Mock service layer + call recorder used by command tests       |

## Behavior Notes

- `sync` merges parent into each child with `git merge --no-ff`. No rebases anywhere.
- Repository topology is shared across equivalent SSH/HTTPS `origin` URLs under `$XDG_STATE_HOME/stacked`; linked worktrees and duplicate clones therefore see one Lineage.
- `sync` records `syncedOnto` (parent tip SHA) in clone-local state so one clone cannot suppress another clone's synchronization.
- Trunk update uses `git merge --ff-only origin/<trunk>` — fails loudly if trunk diverges from origin so the user reconciles manually.
- Push is plain `git push` (no force) since merges only grow history forward.
- `sync` also pushes branches whose local tip is ahead of `origin/<branch>` (or where the remote ref doesn't exist yet) — committed-but-unpushed work is detected and pushed even when no merge was needed.
- `submit` runs `sync` first by default (skip with `--no-sync`), then pushes (without force) and creates/updates PRs and refreshes stack metadata in PR bodies. The shared sync entry point is `runSync` exported from `commands/sync.ts`.
- Merged PRs are detected upfront in `sync` (via `gh.getPR`) and persisted in shared topology. Merged branches are then **skipped entirely** by `sync` and `submit` — no merge, no push, no PR mutation. They remain in metadata and continue to render in the PR-body metadata table (with ✅) for bookkeeping. Children of a merged branch are reparented to the next non-merged ancestor (or trunk). `sync --include-merged` opts back in.
- `status` lists every branch in the current stack with per-branch push state (`↑N` for unpushed commits, `(no remote)` for branches never pushed, dim `✓ (merged)` for branches whose PRs have merged). Driven by `Git.aheadCount`.
- Commands assume linear stacks; forked branch trees are detected but intentionally not stacked.
- `detect` treats metadata as source of truth for managed branches and only infers parentage for untracked branches.
- `amend` reuses the merge loop to propagate amended parents into children.
- `create` and `adopt` record initial `syncedOnto` for accurate first sync.
- `reparent` is one atomic StackService mutation: it moves a Branch plus its descendant suffix within/across Stacks or onto Trunk, rejects cycles, deletes emptied source Stacks, and invalidates only checkout sync markers whose Parent changed.
