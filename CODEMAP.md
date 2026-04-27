# Stacked Codemap

## Architecture

- `src/main.ts`: CLI entry + command wiring.
- `src/commands/*.ts`: command handlers (`sync`, `submit`, `clean`, etc.).
- `src/services/Git.ts`: typed shell wrapper around git operations (CLI backend).
- `src/services/GitHub.ts`: `gh` wrappers for PR read/create/update.
- `src/services/Stack.ts`: `.git/stacked.json` model, v1→v2 migration, stack projection, and mutations.
- `src/errors/index.ts`: tagged error types/codes.
- `tests/commands/*.test.ts`: command behavior tests via mock services.

## High-Leverage Files

| File                        | Purpose                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `src/commands/sync.ts`      | Stack merge orchestration + push behavior + conflict messaging |
| `src/commands/submit.ts`    | PR creation/update, base retarget, stacked metadata block      |
| `src/services/Git.ts`       | Single choke point for git process behavior/options            |
| `tests/helpers/test-cli.ts` | Mock service layer + call recorder used by command tests       |

## Behavior Notes

- `sync` merges parent into each child with `git merge --no-ff`. No rebases anywhere.
- `sync` records `syncedOnto` (parent tip SHA) per branch to skip no-op merges when the parent hasn't moved.
- Trunk update uses `git merge --ff-only origin/<trunk>` — fails loudly if trunk diverges from origin so the user reconciles manually.
- Push is plain `git push` (no force) since merges only grow history forward.
- `sync` also pushes branches whose local tip is ahead of `origin/<branch>` (or where the remote ref doesn't exist yet) — committed-but-unpushed work is detected and pushed even when no merge was needed.
- `submit` runs `sync` first by default (skip with `--no-sync`), then pushes (without force) and creates/updates PRs and refreshes stack metadata in PR bodies. The shared sync entry point is `runSync` exported from `commands/sync.ts`.
- `status` lists every branch in the current stack with per-branch push state (`↑N` for unpushed commits, `(no remote)` for branches never pushed). Driven by `Git.aheadCount`.
- Commands assume linear stacks; forked branch trees are detected but intentionally not stacked.
- `detect` treats metadata as source of truth for managed branches and only infers parentage for untracked branches.
- `amend` reuses the merge loop to propagate amended parents into children.
- `create` and `adopt` record initial `syncedOnto` for accurate first sync.
