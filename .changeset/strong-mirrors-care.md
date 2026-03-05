---
"@cvr/stacked": patch
---

Fix critical CLI and stacked workflow correctness issues.

- Stop command execution when conflicting global flags are passed (`--verbose` with `--quiet`) and exit with code `2`.
- Ensure `submit` refreshes stack metadata for PRs created in the same run, so links are complete without a second submit.
- Add machine-readable output for `submit --dry-run --json` with `would-*` actions.
- Validate `amend --from` before mutating commit history.
- Treat reorder operations that target the same branch as explicit no-ops.
- Upgrade to Effect beta `4.0.0-beta.27` and align `@effect/platform-bun`.
