// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it } from "effect-bun-test";
import { test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Exit, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { GitService } from "../../src/services/Git.js";
import { amend } from "../../src/commands/amend.js";
import type { StackFile } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer, expectCall, expectNoCall } from "../helpers/test-cli.js";

describe("amend command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  it.effect("amend calls commitAmend", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      yield* git.commitAmend();

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "commitAmend");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("amend with --edit passes edit flag", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      yield* git.commitAmend({ edit: true });

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "commitAmend", { edit: true });
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("amend merges into children via mergeBranch", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      yield* git.commitAmend();
      yield* git.checkout("feat-b");
      yield* git.mergeBranch({ base: "feat-a", message: "sync: merge feat-a into feat-b" });
      yield* git.checkout("feat-c");
      yield* git.mergeBranch({ base: "feat-b", message: "sync: merge feat-b into feat-c" });

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "commitAmend");
      expectCall(calls, "Git", "mergeBranch", { base: "feat-a" });
      expectCall(calls, "Git", "mergeBranch", { base: "feat-b" });
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("amend on last branch has no children to merge", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      yield* git.commitAmend();

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "commitAmend");
      expectNoCall(calls, "Git", "mergeBranch");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-c" },
          stack: stackData,
        }),
      ),
    ),
  );

  test("invalid --from fails before amending commit", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(amend, { version: "test" });

      const result = yield* Effect.exit(run(["--from", "does-not-exist"]));
      if (Exit.isSuccess(result)) {
        throw new Error("Expected amend to fail for invalid --from");
      }

      const calls = yield* recorder.calls;
      expectNoCall(calls, "Git", "commitAmend");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-a" },
            stack: stackData,
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });
});
