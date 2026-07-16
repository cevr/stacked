# Stacked Pull Requests

Stacked manages dependent branches as ordered reviewable changes while preserving forward-only Git history.

## Language

**Stack**:
An ordered linear chain of branches whose review order defines their parent relationships.

**Branch**:
The unit of work and review in a Stack.
_Avoid_: Commit, change

**Trunk**:
The repository branch beneath every Stack.
_Avoid_: Base branch, main branch

**Parent**:
The Branch immediately beneath another Branch in a Stack, or Trunk for the Stack root.
_Avoid_: Base

**Lineage**:
The ordered parent relationships from Trunk through every Branch in a Stack.
_Avoid_: Topology, branch list

**Active Parent**:
The nearest unmerged Parent used for synchronization and review when merged Branches remain recorded in the Lineage.
_Avoid_: Effective base

**Repository**:
The remote-identified Git project that owns shared Stack topology across clones and linked worktrees.
_Avoid_: Checkout, working directory

**Checkout**:
A clone's common Git directory and its local synchronization state. Linked worktrees share one Checkout.
_Avoid_: Repository, Stack

**Reparent**:
Move a Branch and every descendant above it so the Branch has a new Parent. The Lineage remains linear; Git history changes only when `sync` merges the new Parent chain.
_Avoid_: Rebase, restack
