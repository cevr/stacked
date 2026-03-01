import { Schema } from "effect";

// ============================================================================
// Error Codes
// ============================================================================

export const ErrorCode = {
  BRANCH_EXISTS: "BRANCH_EXISTS",
  BRANCH_NOT_FOUND: "BRANCH_NOT_FOUND",
  NOT_IN_STACK: "NOT_IN_STACK",
  DIRTY_WORKTREE: "DIRTY_WORKTREE",
  REBASE_CONFLICT: "REBASE_CONFLICT",
  GH_NOT_INSTALLED: "GH_NOT_INSTALLED",
  STACK_NOT_FOUND: "STACK_NOT_FOUND",
  INVALID_BRANCH_NAME: "INVALID_BRANCH_NAME",
  NOT_A_GIT_REPO: "NOT_A_GIT_REPO",
  ALREADY_AT_TOP: "ALREADY_AT_TOP",
  ALREADY_AT_BOTTOM: "ALREADY_AT_BOTTOM",
  STACK_EMPTY: "STACK_EMPTY",
  TRUNK_ERROR: "TRUNK_ERROR",
  STACK_EXISTS: "STACK_EXISTS",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ============================================================================
// Error Classes
// ============================================================================

export class GitError extends Schema.TaggedErrorClass<GitError>()("GitError", {
  message: Schema.String,
  command: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
}) {}

export class StackError extends Schema.TaggedErrorClass<StackError>()("StackError", {
  message: Schema.String,
  code: Schema.optional(Schema.String),
}) {}

export class GitHubError extends Schema.TaggedErrorClass<GitHubError>()("GitHubError", {
  message: Schema.String,
  command: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
}) {}
