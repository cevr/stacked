---
"@cvr/stacked": minor
---

Comprehensive audit — soundness, UX, and new commands

**Bug fixes:**

- Sync rebase recovery: abort on failure, restore original branch, guard detached HEAD
- Atomic stack file writes (tmp + rename) to prevent corruption
- stderr for human messages, stdout for data only (fixes piping)
- Kill spawned git/gh processes on interruption (Ctrl+C)
- Input validation for `create --from`, `clean` error logging
- Error messages now include recovery suggestions

**New features:**

- `status` command: show current branch, stack position, working tree state
- `submit --title` and `--body` flags for PR content
- Auto-generated stack metadata in PR bodies (position, navigation links)
- `checkout` falls through to `git checkout` for non-stacked branches
- `--json` output on all write commands (submit, clean, detect, delete, adopt, create)
- `--verbose`, `--quiet`, `--no-color` global flags
- Colored output with spinners, TTY detection, NO_COLOR support
- Help examples on all commands

**Cleanup:**

- Removed dead `parentOf`/`childrenOf` service methods
- Updated README and Claude skill docs
