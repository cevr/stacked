import { Schema } from "effect";

export class GitError extends Schema.TaggedErrorClass<GitError>()("GitError", {
  message: Schema.String,
  command: Schema.optional(Schema.String),
}) {}

export class StackError extends Schema.TaggedErrorClass<StackError>()("StackError", {
  message: Schema.String,
}) {}

export class GitHubError extends Schema.TaggedErrorClass<GitHubError>()("GitHubError", {
  message: Schema.String,
  command: Schema.optional(Schema.String),
}) {}
