# stacked

Branch-based stacked PR manager. Tracks parent-child branch relationships, propagates upstream changes via merges, and creates/updates GitHub PRs via `gh`.

Built with [Effect v4](https://effect.website) and [Bun](https://bun.sh).

## Install

```sh
bun run build   # compiles binary to bin/stacked + symlinks to ~/.bun/bin/
```

## Setup

```sh
# Install the Claude skill (optional):
stacked init

# Trunk is auto-detected on first use from origin/HEAD when available
# (fallback: main > master > develop). Override only if needed:
stacked trunk <name>
```

## Usage

```sh
# Create a stack: branch from trunk
stacked create feat-auth

# Stack another branch on top
stacked create feat-auth-ui

# See the stack
stacked list
stacked list --json      # machine-readable output

# See a specific stack by name
stacked list feat-auth

# Quick orientation
stacked status
stacked status --json

# List all stacks in the repo
stacked stacks
stacked stacks --json

# Navigate
stacked up               # move up one branch
stacked down             # move down one branch
stacked top              # jump to top of stack
stacked bottom           # jump to bottom of stack
stacked checkout feat-auth
stacked checkout any-branch  # falls through to git for non-stacked branches

# Sync entire stack with latest trunk
stacked sync

# After editing mid-stack, merge parent into children only
stacked sync --from feat-auth

# Sync, push, and create/update PRs in one step
stacked submit
stacked submit --no-sync      # skip the sync step
stacked submit --draft
stacked submit --title "Add auth" --body "Implements OAuth2 flow"
stacked submit --title "Auth,Validation,Tests"  # per-branch titles (comma-delimited)
stacked submit --only         # process only the current branch
stacked submit --dry-run

# Adopt an existing branch into the stack
stacked adopt existing-branch --after feat-auth

# View commits per branch
stacked log
stacked log --json

# Detect existing branch chains and register as stacks
stacked detect
stacked detect --dry-run

# Remove merged branches from stacks (prompts for confirmation)
stacked clean
stacked clean --dry-run
stacked clean --yes          # skip confirmation

# Remove a branch from the stack (prompts for confirmation)
stacked delete feat-auth-ui
stacked delete feat-auth-ui --keep-remote  # keep the remote branch
stacked delete feat-auth-ui --yes          # skip confirmation

# Global flags (work with any command)
stacked --verbose list   # debug output
stacked --quiet sync     # suppress non-essential output
stacked --no-color list  # disable colored output
stacked --yes clean      # skip confirmation prompts
```

## Commands

| Command           | Description                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `trunk [name]`    | Get/set trunk branch (`--json`)                                                                   |
| `create <name>`   | Create branch on top of current (`--from`, `--json`)                                              |
| `list [stack]`    | Show stack branches (`--json`)                                                                    |
| `stacks`          | List all stacks (`--json`)                                                                        |
| `status`          | Show current branch, stack position, working tree state, per-branch push state (`--json`)         |
| `checkout <name>` | Switch to branch (falls through to git for non-stacked branches)                                  |
| `up`              | Move up one branch in the stack                                                                   |
| `down`            | Move down one branch in the stack                                                                 |
| `top`             | Jump to top of stack                                                                              |
| `bottom`          | Jump to bottom of stack                                                                           |
| `sync`            | Fetch + merge parent into each child (`--from` to start from a branch)                            |
| `detect`          | Detect branch chains and register as stacks (`--dry-run`, `--json`)                               |
| `clean`           | Remove merged branches + remote branches (`--dry-run`, `--json`)                                  |
| `delete <name>`   | Remove branch from stack + git + remote (`--keep-remote`, `--force`, `--json`)                    |
| `submit`          | Sync + push + create/update PRs (`--no-sync`, `--title`, `--body`, `--only`, `--draft`, `--json`) |
| `adopt <branch>`  | Add existing branch to stack (`--after`, `--json`)                                                |
| `log`             | Show commits grouped by branch (`--json`)                                                         |
| `init`            | Install the stacked Claude skill to ~/.claude/skills                                              |

### Global Flags

| Flag           | Description                   |
| -------------- | ----------------------------- |
| `--verbose`    | Enable debug output           |
| `--quiet`/`-q` | Suppress non-essential output |
| `--no-color`   | Disable colored output        |
| `--yes`/`-y`   | Skip confirmation prompts     |

## Data Model

Stack metadata lives in `.git/stacked.json`. Active stacks are stored as explicit linear parent links plus a per-stack root, and older v1 metadata is auto-migrated on load. `mergedBranches` remains a skip-list so `detect` does not try to rebuild stacks around already-merged branches.

Trunk is auto-detected on first use from `origin/HEAD` when available, then falls back to local `main`, `master`, or `develop`. Override with `stacked trunk <name>`.

## Output Conventions

- **stdout**: data output only (JSON, branch names, tree views) — safe for piping
- **stderr**: progress messages, spinners, success/warning/error messages
- All commands support `--json` for structured output

## Development

```sh
bun run dev -- --help    # run from source
bun run gate             # typecheck + lint + fmt + test + build
bun test                 # tests only
```
