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
├─ Remove a branch            → §Deleting
└─ Troubleshooting            → §Gotchas
```

## Quick Reference

| Command                   | What it does                                   |
| ------------------------- | ---------------------------------------------- |
| `stacked trunk [name]`    | Get/set trunk branch (default: main)           |
| `stacked create <name>`   | Create branch on top of current branch         |
| `stacked list`            | Show stack with current branch indicator       |
| `stacked checkout <name>` | Switch to branch in stack                      |
| `stacked top`             | Jump to top of stack                           |
| `stacked bottom`          | Jump to bottom of stack                        |
| `stacked sync`            | Fetch + rebase entire stack on trunk           |
| `stacked restack`         | Rebase children after mid-stack edits          |
| `stacked delete <name>`   | Remove branch from stack + delete git branch   |
| `stacked submit`          | Push all branches + create/update PRs via `gh` |
| `stacked adopt <branch>`  | Add existing git branch into the stack         |
| `stacked log`             | Show commits grouped by branch                 |

## Setup

```sh
# Set trunk if not "main"
stacked trunk develop
```

Requires `gh` CLI installed and authenticated for `submit`.

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
stacked list     # shows branches with ► on current
stacked log      # shows commits grouped by branch
```

## Navigation

```sh
stacked checkout feat-auth    # switch to specific branch
stacked top                   # jump to top of stack
stacked bottom                # jump to bottom (trunk-adjacent)
```

## Rebasing

### After mid-stack changes

Edit a branch mid-stack, then rebase everything above it:

```sh
stacked checkout feat-auth
# ... make changes, commit ...
stacked restack                # rebases feat-auth-ui and feat-auth-tests
```

### Sync with trunk

Pull latest trunk and rebase the entire stack bottom-to-top:

```sh
stacked sync
```

This fetches, then rebases each branch onto its parent starting from the bottom.

## Submitting

Push all stack branches and create/update GitHub PRs with correct base branches:

```sh
stacked submit              # push + create/update PRs
stacked submit --draft      # create as draft PRs
stacked submit --force      # force push
stacked submit --dry-run    # show what would happen
```

Each PR targets its parent branch (not trunk), preserving the stack structure on GitHub.

## Adopting Branches

Bring an existing git branch into the stack:

```sh
stacked adopt existing-branch                    # append to top
stacked adopt existing-branch --after feat-auth  # insert after specific branch
```

## Deleting

```sh
stacked delete feat-auth-ui            # removes from stack + deletes git branch
stacked delete feat-auth-ui --force    # skip confirmation
```

## Data Model

Stack metadata lives in `.git/stacked.json`. Each branch's parent is implied by array position:

- `branches[0]` → parent is trunk
- `branches[n]` → parent is `branches[n-1]`

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
stacked restack              # rebase children

# 4. Sync with latest main
stacked sync

# 5. Submit for review
stacked submit --draft

# 6. After review, final submit
stacked submit
```

## Gotchas

- `stacked sync` rebases bottom-to-top — resolve conflicts one branch at a time
- `stacked submit` requires `gh` CLI authenticated (`gh auth login`)
- PRs target parent branches, not trunk — this is intentional for stacked review
- Trunk defaults to `main` — use `stacked trunk <name>` if your default branch differs
- Rebase conflicts mid-stack will pause the operation — resolve and re-run
