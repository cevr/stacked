# stacked

Branch-based stacked PR manager. Tracks parent-child branch relationships, automates rebasing, and creates/updates GitHub PRs via `gh`.

Built with [Effect v4](https://effect.website) and [Bun](https://bun.sh).

## Install

```sh
bun run build   # compiles binary to bin/stacked + symlinks to ~/.bun/bin/
```

## Setup

```sh
# Trunk is auto-detected (main > master > develop). Override if needed:
stacked trunk develop

# Install the Claude skill (optional):
stacked init
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

# List all stacks in the repo
stacked stacks
stacked stacks --json

# Navigate
stacked up               # move up one branch
stacked down             # move down one branch
stacked top              # jump to top of stack
stacked bottom           # jump to bottom of stack
stacked checkout feat-auth

# Sync entire stack with latest trunk
stacked sync

# After editing mid-stack, rebase only children
stacked sync --from feat-auth

# Push all branches + create/update PRs (force-pushes by default)
stacked submit
stacked submit --draft
stacked submit --no-force    # disable force-push
stacked submit --dry-run

# Adopt an existing branch into the stack
stacked adopt existing-branch --after feat-auth

# View commits per branch
stacked log
stacked log --json

# Detect existing branch chains and register as stacks
stacked detect
stacked detect --dry-run

# Remove merged branches from stacks
stacked clean
stacked clean --dry-run

# Remove a branch from the stack
stacked delete feat-auth-ui
stacked delete feat-auth-ui --keep-remote  # keep the remote branch
```

## Commands

| Command           | Description                                                          |
| ----------------- | -------------------------------------------------------------------- |
| `trunk [name]`    | Get/set trunk branch (auto-detected on first use)                    |
| `create <name>`   | Create branch on top of current (`--from` to pick base)              |
| `list [stack]`    | Show stack branches (`--json` for machine output)                    |
| `stacks`          | List all stacks (`--json` for machine output)                        |
| `checkout <name>` | Switch to branch in stack                                            |
| `up`              | Move up one branch in the stack                                      |
| `down`            | Move down one branch in the stack                                    |
| `top`             | Jump to top of stack                                                 |
| `bottom`          | Jump to bottom of stack                                              |
| `sync`            | Fetch + rebase stack on trunk (`--from` to start from a branch)      |
| `detect`          | Detect branch chains and register as stacks (`--dry-run`)            |
| `clean`           | Remove merged branches + remote branches (`--dry-run` to preview)    |
| `delete <name>`   | Remove branch from stack + git + remote (`--keep-remote` to opt out) |
| `submit`          | Push all + create/update PRs (`--no-force` to disable force-push)    |
| `adopt <branch>`  | Add existing branch to stack (`--after` to position)                 |
| `log`             | Show commits grouped by branch (`--json` for machine output)         |
| `init`            | Install the stacked Claude skill to ~/.claude/skills                 |

## Data Model

Stack metadata lives in `.git/stacked.json`. Each branch's parent is implied by array position — `branches[0]`'s parent is trunk, `branches[n]`'s parent is `branches[n-1]`.

Trunk is auto-detected on first use by checking for `main`, `master`, or `develop` branches. Override with `stacked trunk <name>`.

## Development

```sh
bun run dev -- --help    # run from source
bun run gate             # typecheck + lint + fmt + test + build
bun test                 # tests only
```
