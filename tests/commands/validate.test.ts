// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { validateBranchName } from "../../src/commands/helpers/validate.js";

describe("validateBranchName", () => {
  it.effect("accepts valid branch names", () =>
    Effect.gen(function* () {
      yield* validateBranchName("feat-auth");
      yield* validateBranchName("fix/login-bug");
      yield* validateBranchName("release-1.0.0");
      yield* validateBranchName("user_feature");
    }),
  );

  it.effect("rejects names starting with -", () =>
    Effect.gen(function* () {
      const result = yield* validateBranchName("--option").pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.message)),
      );
      expect(result).toContain("cannot start with");
    }),
  );

  it.effect("rejects names containing ..", () =>
    Effect.gen(function* () {
      const result = yield* validateBranchName("feat..bar").pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.message)),
      );
      expect(result).toContain("cannot contain");
    }),
  );

  it.effect("rejects names with spaces", () =>
    Effect.gen(function* () {
      const result = yield* validateBranchName("feat bar").pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.message)),
      );
      expect(result).toContain("cannot contain spaces");
    }),
  );

  it.effect("rejects names ending with .lock", () =>
    Effect.gen(function* () {
      const result = yield* validateBranchName("branch.lock").pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.message)),
      );
      expect(result).toContain(".lock");
    }),
  );

  it.effect("rejects names with invalid characters", () =>
    Effect.gen(function* () {
      const result = yield* validateBranchName("feat~bar").pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.message)),
      );
      expect(result).toContain("must start with alphanumeric");
    }),
  );

  it.effect("rejects empty branch name", () =>
    Effect.gen(function* () {
      const result = yield* validateBranchName("").pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.message)),
      );
      expect(result).toContain("cannot be empty");
    }),
  );

  it.effect("rejects names ending with .", () =>
    Effect.gen(function* () {
      const result = yield* validateBranchName("feat.").pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.message)),
      );
      expect(result).toContain('cannot end with "."');
    }),
  );

  it.effect("rejects names ending with /", () =>
    Effect.gen(function* () {
      const result = yield* validateBranchName("feat/").pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.message)),
      );
      expect(result).toContain('cannot end with "/"');
    }),
  );

  it.effect("rejects single @ character", () =>
    Effect.gen(function* () {
      const result = yield* validateBranchName("@").pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.message)),
      );
      expect(result).toContain("not a valid branch name");
    }),
  );
});
