---
name: stacked
description: Use the `stacked` CLI to manage stacked PRs. Use when the user wants to create branch stacks, rebase, sync, submit PRs, or navigate stacked branches. Triggers on "stacked", "stack", "stacked PRs", branch stacking workflows, or any git workflow involving parent-child branch relationships.
---

# stacked

Branch-based stacked PR manager. Manages parent-child branch relationships, automates rebasing, creates/updates GitHub PRs via `gh`.

Key idea: **branches** are the unit, not commits. Each branch in a stack has exactly one parent — position in the stack determines lineage.

## Navigation

```
What do you need?
├─ Start a new stack          → §Creating a Stack
├─ Add branches to a stack    → §Creating a Stack
├─ See current stack          → §Viewing the Stack
├─ Navigate between branches  → §Navigation
├─ Rebase after changes       → §Rebasing
├─ Push + create PRs          → §Submitting
├─ Adopt existing branches    → §Adopting Branches
├─ Detect existing branches   → §Detecting Existing Branches
├─ Clean up merged branches   → §Cleaning Up Merged Branches
├─ Remove a branch            → §Deleting
├─ Install Claude skill       → §Setup
└─ Troubleshooting            → §Gotchas
```

## Quick Reference

| Command                   | What it does                                                         |
| ------------------------- | -------------------------------------------------------------------- |
| `stacked trunk [name]`    | Get/set trunk branch (auto-detected on first use)                    |
| `stacked create <name>`   | Create branch on top of current branch (`--from` to pick base)       |
| `stacked list [stack]`    | Show stack branches (`--json` for machine output)                    |
| `stacked stacks`          | List all stacks in the repo (`--json` for machine output)            |
| `stacked checkout <name>` | Switch to branch in stack                                            |
| `stacked up`              | Move up one branch in the stack                                      |
| `stacked down`            | Move down one branch in the stack                                    |
| `stacked top`             | Jump to top of stack                                                 |
| `stacked bottom`          | Jump to bottom of stack                                              |
| `stacked sync`            | Fetch + rebase stack on trunk (`--from` to start from a branch)      |
| `stacked detect`          | Detect branch chains and register as stacks (`--dry-run`)            |
| `stacked clean`           | Remove merged branches + remote branches (`--dry-run` to preview)    |
| `stacked delete <name>`   | Remove branch from stack + git + remote (`--keep-remote` to opt out) |
| `stacked submit`          | Push all + create/update PRs (force-push by default, `--no-force`)   |
| `stacked adopt <branch>`  | Add existing git branch into the stack (`--after` to position)       |
| `stacked log`             | Show commits grouped by branch (`--json` for machine output)         |
| `stacked init`            | Install the stacked Claude skill to ~/.claude/skills                 |

## Setup

```sh
# Trunk is auto-detected (main > master > develop). Override if needed:
stacked trunk develop

# Install the Claude skill (optional, compiled binary only):
stacked init
```

Requires `gh` CLI installed and authenticated for `submit` and `clean`.

## Creating a Stack

Start from trunk, build upward. Each `create` branches off the current branch.

```sh
git checkout main
stacked create feat-auth          # branches off main
# ... make commits ...
stacked create feat-auth-ui       # branches off feat-auth
# ... make commits ...
stacked create feat-auth-tests    # branches off feat-auth-ui
```

Result: `main → feat-auth → feat-auth-ui → feat-auth-tests`

Use `--from` to branch from a specific branch instead of current:

```sh
stacked create hotfix --from feat-auth
```

## Viewing the Stack

```sh
stacked list              # shows current stack's branches
stacked list feat-auth    # shows a specific stack by name
stacked list --json       # machine-readable JSON output
stacked stacks            # lists all stacks in the repo
stacked stacks --json     # machine-readable JSON output
stacked log               # shows commits grouped by branch
stacked log --json        # machine-readable JSON output
```

## Navigation

```sh
stacked up                   # move up one branch
stacked down                 # move down one branch
stacked checkout feat-auth   # switch to specific branch
stacked top                  # jump to top of stack
stacked bottom               # jump to bottom (trunk-adjacent)
```

## Syncing / Rebasing

Fetch latest trunk and rebase the entire stack bottom-to-top:

```sh
stacked sync
```

After mid-stack changes, rebase only the branches above a specific point:

```sh
stacked checkout feat-auth
# ... make changes, commit ...
stacked sync --from feat-auth    # rebases only children of feat-auth
```

**Note:** `sync` requires a clean working tree — commit or stash before running. If a rebase fails mid-stack, the original branch is automatically restored.

## Submitting

Push all stack branches and create/update GitHub PRs with correct base branches:

```sh
stacked submit              # push + create/update PRs (force-pushes by default)
stacked submit --draft      # create as draft PRs
stacked submit --no-force   # disable force-push (plain push)
stacked submit --dry-run    # show what would happen
```

Force-push (with lease) is the default because stacked branches are always rebased. Use `--no-force` if you haven't rebased.

Each PR targets its parent branch (not trunk), preserving the stack structure on GitHub.

## Adopting Branches

Bring an existing git branch into the stack:

```sh
stacked adopt existing-branch                    # append to top
stacked adopt existing-branch --after feat-auth  # insert after specific branch
```

## Detecting Existing Branches

Auto-detect linear branch chains from git history and register them as stacks:

```sh
stacked detect              # scan and register branch chains
stacked detect --dry-run    # preview what would be registered
```

Only linear chains are detected. Forked branches (one parent with multiple children) are reported but skipped. Already-tracked branches are excluded.

## Cleaning Up Merged Branches

After PRs are merged on GitHub, clean up the local and remote branches and stack metadata:

```sh
stacked clean              # removes all merged branches from all stacks
stacked clean --dry-run    # preview what would be removed
```

`clean` also deletes the corresponding remote branches. `list` shows merge status per branch (`[merged]`, `[closed]`, `[#N]` for open PRs).

## Deleting

```sh
stacked delete feat-auth-ui              # removes from stack + deletes local + remote branch
stacked delete feat-auth-ui --force      # skip children check
stacked delete feat-auth-ui --keep-remote  # don't delete remote branch
```

Deleting a mid-stack branch with `--force` warns you to run `stacked sync` to rebase child branches onto the new parent.

## Data Model

Stack metadata lives in `.git/stacked.json`. Each branch's parent is implied by array position:

- `branches[0]` → parent is trunk
- `branches[n]` → parent is `branches[n-1]`

Trunk is auto-detected on first use by checking for `main`, `master`, or `develop` branches. Override with `stacked trunk <name>`.

A repo can have multiple independent stacks. The current stack is determined by which branch you're on.

## Typical Workflow

```sh
# 1. Start a stack
stacked create feat-auth
# ... work, commit ...

# 2. Stack more branches
stacked create feat-auth-ui
# ... work, commit ...

# 3. Need to fix something mid-stack
stacked checkout feat-auth
# ... fix, commit ...
stacked sync --from feat-auth  # rebase children

# 4. Sync with latest main
stacked sync

# 5. Submit for review
stacked submit --draft

# 6. After review, final submit
stacked submit

# 7. Navigate quickly
stacked up    # go to next branch
stacked down  # go to previous branch
```

## Gotchas

- `stacked sync` requires a clean working tree — commit or stash first
- `stacked sync` rebases bottom-to-top — resolve conflicts one branch at a time
- `stacked sync` restores your original branch even if rebase fails
- `stacked submit` force-pushes by default (use `--no-force` to disable)
- `stacked submit` and `stacked clean` require `gh` CLI authenticated (`gh auth login`)
- PRs target parent branches, not trunk — this is intentional for stacked review
- Trunk is auto-detected (`main` > `master` > `develop`) — use `stacked trunk <name>` to override
- Rebase conflicts mid-stack will pause the operation — resolve and re-run
- Forked branches (one parent, multiple children) are not supported — `detect` reports them but skips
- `stacked delete --force` on a mid-stack branch requires `stacked sync` afterward
- `stacked checkout` only works for branches tracked in a stack
