# @cvr/stacked

## 0.2.0

### Minor Changes

- [`6910bcc`](https://github.com/cevr/stacked/commit/6910bcc7e6bfac5ba435a01b0d91340f58f79afe) Thanks [@cevr](https://github.com/cevr)! - Add `clean` command to remove merged branches from stacks, and show PR merge status in `list` output.

- [`1f50f80`](https://github.com/cevr/stacked/commit/1f50f8079172685471ce5757b1ca4efc6a2ad5c8) Thanks [@cevr](https://github.com/cevr)! - Add `stacks` command to list all stacks in a repo, and allow `list` to accept an optional stack name argument to view any stack.

### Patch Changes

- [`906600e`](https://github.com/cevr/stacked/commit/906600e263080f444fa312d701a0f74effd891fe) Thanks [@cevr](https://github.com/cevr)! - `clean` now removes merged branches bottom-up only, stopping at the first non-merged branch to prevent orphaned branches. Skipped merged branches are reported to the user.

## 0.1.1

### Patch Changes

- [`a44a035`](https://github.com/cevr/stacked/commit/a44a035db0a7c94bb1b4a376535ae8710275fb18) Thanks [@cevr](https://github.com/cevr)! - Remove `restack` command in favor of `sync --from <branch>` which rebases only children of the specified branch.
