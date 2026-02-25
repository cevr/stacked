# stacked

Branch-based stacked PR manager. Tracks parent-child branch relationships, automates rebasing, and creates/updates GitHub PRs via `gh`.

Built with [Effect v4](https://effect.website) and [Bun](https://bun.sh).

## Install

```sh
bun run build   # compiles binary to bin/stacked + symlinks to ~/.bun/bin/
```

## Usage

```sh
# Set trunk branch (default: main)
stacked trunk develop

# Create a stack: branch from trunk
stacked create feat-auth

# Stack another branch on top
stacked create feat-auth-ui

# See the stack
stacked list

# Navigate
stacked top
stacked bottom
stacked checkout feat-auth

# Sync entire stack with latest trunk
stacked sync

# After editing mid-stack, rebase only children
stacked sync --from feat-auth

# Push all branches + create/update PRs
stacked submit
stacked submit --draft
stacked submit --dry-run

# Adopt an existing branch into the stack
stacked adopt existing-branch --after feat-auth

# View commits per branch
stacked log

# Remove a branch from the stack
stacked delete feat-auth-ui
```

## Commands

| Command           | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `trunk [name]`    | Get/set trunk branch                                          |
| `create <name>`   | Create branch on top of current                               |
| `list`            | Show stack with current branch indicator                      |
| `checkout <name>` | Switch to branch                                              |
| `top`             | Jump to top of stack                                          |
| `bottom`          | Jump to bottom of stack                                       |
| `sync`            | Fetch + rebase stack on trunk (--from to start from a branch) |
| `delete <name>`   | Remove branch from stack + git                                |
| `submit`          | Push all + create/update PRs via `gh`                         |
| `adopt <branch>`  | Add existing branch to stack                                  |
| `log`             | Show commits grouped by branch                                |

## Data Model

Stack metadata lives in `.git/stacked.json`. Each branch's parent is implied by array position — `branches[0]`'s parent is trunk, `branches[n]`'s parent is `branches[n-1]`.

## Development

```sh
bun run dev -- --help    # run from source
bun run gate             # typecheck + lint + fmt + test + build
bun test                 # tests only
```
