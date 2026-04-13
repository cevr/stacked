# Stacked Codemap

## Architecture

- `src/main.ts`: CLI entry + command wiring.
- `src/commands/*.ts`: command handlers (`sync`, `submit`, `clean`, etc.).
- `src/services/Git.ts`: typed shell wrapper around git operations.
- `src/services/GitHub.ts`: `gh` wrappers for PR read/create/update.
- `src/services/Stack.ts`: `.git/stacked.json` model, v1→v2 migration, stack projection, and mutations.
- `src/errors/index.ts`: tagged error types/codes.
- `tests/commands/*.test.ts`: command behavior tests via mock services.

## High-Leverage Files

| File                        | Purpose                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `src/commands/sync.ts`      | Stack rebase orchestration + push behavior + conflict messaging |
| `src/commands/submit.ts`    | PR creation/update, base retarget, stacked metadata block       |
| `src/services/Git.ts`       | Single choke point for git process behavior/options             |
| `tests/helpers/test-cli.ts` | Mock service layer + call recorder used by command tests        |

## Behavior Notes

- `sync` uses incremental fork-point tracking: records `syncedOnto` (parent tip SHA) in metadata, skips unchanged branches, uses corrected rebase on the default CLI backend, and can use the `mergeTrees` fast path when `STACKED_GIT_BACKEND=es-git` is set.
- `submit` is PR operation: push (again), create/update PRs, refresh stack metadata in PR bodies.
- Commands assume linear stacks; forked branch trees are detected but intentionally not stacked.
- `detect` now treats metadata as source of truth for managed branches and only infers parentage for untracked branches.
- `amend` uses the same fork-point-aware sync algorithm for child rebases.
- `create` and `adopt` record initial `syncedOnto` for accurate first sync.
