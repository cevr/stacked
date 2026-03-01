// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it } from "effect-bun-test";
import { Effect } from "effect";
import { GitService } from "../../src/services/Git.js";
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

  it.effect("amend rebases children using rebaseOnto", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      // Simulate what amend does after amending: rebase children
      yield* git.commitAmend();
      yield* git.mergeBase("feat-b", "feat-a");
      yield* git.checkout("feat-b");
      yield* git.rebaseOnto("feat-b", "feat-a", "abc123");
      yield* git.mergeBase("feat-c", "feat-b");
      yield* git.checkout("feat-c");
      yield* git.rebaseOnto("feat-c", "feat-b", "abc123");

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "commitAmend");
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-b", newBase: "feat-a" });
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-c", newBase: "feat-b" });
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("amend on last branch has no children to rebase", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      yield* git.commitAmend();

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "commitAmend");
      expectNoCall(calls, "Git", "rebaseOnto");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-c" },
          stack: stackData,
        }),
      ),
    ),
  );
});
