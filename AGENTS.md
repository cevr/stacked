# Stacked Guidelines

Stacked = branch-based stacked PR manager. Branches are unit; stack order defines parent chain.

## Dev Commands

- `bun run typecheck`
- `bun test`
- `bun run build`
- Full gate: `bun run gate`

## Gotchas

- `sync` merges parent into each child (`git merge --no-ff`) and plain-pushes. No rebases, no force-pushes. Trunk update uses `merge --ff-only` so divergent trunk aborts the sync.
- `sync` requires clean working tree; on conflict, resolve in place then `stacked sync --continue` (or `--abort`).
- `submit` handles PR creation/base retarget + metadata body updates and plain-pushes. `sync` does git history + pushes.
- `stacked` metadata can drift when branches are deleted outside CLI; run `stacked doctor --fix`.

## Docs Map

- `CODEMAP.md`: architecture + key files
- `skills/stacked/SKILL.md`: operator-facing skill instructions
- `README.md`: user-facing install and usage
