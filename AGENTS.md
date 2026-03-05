# Stacked Guidelines

Stacked = branch-based stacked PR manager. Branches are unit; stack order defines parent chain.

## Dev Commands

- `bun run typecheck`
- `bun test`
- `bun run build`
- Full gate: `bun run gate`

## Gotchas

- `sync` now rebases and force-pushes each rebased branch (`--force-with-lease`). Use `--dry-run` before risky stacks.
- `sync` requires clean working tree; conflict handling is manual (`git rebase --continue`) then resume with `stacked sync --from <parent>`.
- `submit` still handles PR creation/base retarget + metadata body updates; `sync` only handles git history + pushes.
- `stacked` metadata can drift when branches are deleted outside CLI; run `stacked doctor --fix`.

## Docs Map

- `CODEMAP.md`: architecture + key files
- `skills/stacked/SKILL.md`: operator-facing skill instructions
- `README.md`: user-facing install and usage
