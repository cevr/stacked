import { Effect } from "effect";
import { ErrorCode, StackError } from "../../errors/index.js";

const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/;

export const validateBranchName = Effect.fn("validateBranchName")(function* (name: string) {
  if (name === "") {
    return yield* new StackError({
      code: ErrorCode.INVALID_BRANCH_NAME,
      message: "Branch name cannot be empty",
    });
  }
  if (name.startsWith("-")) {
    return yield* new StackError({
      code: ErrorCode.INVALID_BRANCH_NAME,
      message: `Invalid branch name "${name}": cannot start with "-"`,
    });
  }
  if (name.includes("..")) {
    return yield* new StackError({
      code: ErrorCode.INVALID_BRANCH_NAME,
      message: `Invalid branch name "${name}": cannot contain ".."`,
    });
  }
  if (name.includes(" ")) {
    return yield* new StackError({
      code: ErrorCode.INVALID_BRANCH_NAME,
      message: `Invalid branch name "${name}": cannot contain spaces`,
    });
  }
  if (name.endsWith(".lock")) {
    return yield* new StackError({
      code: ErrorCode.INVALID_BRANCH_NAME,
      message: `Invalid branch name "${name}": cannot end with ".lock"`,
    });
  }
  if (name.endsWith(".")) {
    return yield* new StackError({
      code: ErrorCode.INVALID_BRANCH_NAME,
      message: `Invalid branch name "${name}": cannot end with "."`,
    });
  }
  if (name.endsWith("/")) {
    return yield* new StackError({
      code: ErrorCode.INVALID_BRANCH_NAME,
      message: `Invalid branch name "${name}": cannot end with "/"`,
    });
  }
  if (name === "@") {
    return yield* new StackError({
      code: ErrorCode.INVALID_BRANCH_NAME,
      message: `Invalid branch name "${name}": "@" alone is not a valid branch name`,
    });
  }
  if (!BRANCH_NAME_PATTERN.test(name)) {
    return yield* new StackError({
      code: ErrorCode.INVALID_BRANCH_NAME,
      message: `Invalid branch name "${name}": must start with alphanumeric and contain only alphanumerics, dots, hyphens, underscores, or slashes`,
    });
  }
});
