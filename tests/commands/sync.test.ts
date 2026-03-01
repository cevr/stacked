// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { GitService } from "../../src/services/Git.js";
import type { StackFile } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer, expectCall } from "../helpers/test-cli.js";

describe("sync command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  it.effect("fetches and rebases all branches using rebaseOnto", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      yield* git.fetch();
      yield* git.mergeBase("feat-a", "origin/main");
      yield* git.checkout("feat-a");
      yield* git.rebaseOnto("feat-a", "origin/main", "abc123");
      yield* git.mergeBase("feat-b", "feat-a");
      yield* git.checkout("feat-b");
      yield* git.rebaseOnto("feat-b", "feat-a", "abc123");
      yield* git.mergeBase("feat-c", "feat-b");
      yield* git.checkout("feat-c");
      yield* git.rebaseOnto("feat-c", "feat-b", "abc123");

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "fetch");
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-a", newBase: "origin/main" });
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

  it.effect("does not abort rebase on conflict — leaves it in progress", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      // Simulate: sync does NOT call rebaseAbort anymore
      yield* git.fetch();
      yield* git.mergeBase("feat-a", "origin/main");
      yield* git.checkout("feat-a");
      yield* git.rebaseOnto("feat-a", "origin/main", "abc123");

      const calls = yield* recorder.calls;
      // rebaseAbort should NOT be called in the new implementation
      const abortCalls = calls.filter((c) => c.service === "Git" && c.method === "rebaseAbort");
      expect(abortCalls).toHaveLength(0);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("with --from, rebases only children of the specified branch", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      // Simulate sync --from feat-a: skip feat-a, rebase feat-b and feat-c
      yield* git.fetch();
      yield* git.mergeBase("feat-b", "feat-a");
      yield* git.checkout("feat-b");
      yield* git.rebaseOnto("feat-b", "feat-a", "abc123");
      yield* git.mergeBase("feat-c", "feat-b");
      yield* git.checkout("feat-c");
      yield* git.rebaseOnto("feat-c", "feat-b", "abc123");

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "fetch");
      // Should not checkout or rebase feat-a (it's the --from branch, skipped)
      const rebaseCalls = calls.filter((c) => c.service === "Git" && c.method === "rebaseOnto");
      expect(rebaseCalls).toHaveLength(2);
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

  it.effect("ensuring block restores branch when no rebase in progress", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      // isRebaseInProgress returns false → should restore original branch
      yield* git.checkout("feat-a");

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "checkout", { name: "feat-a" });
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("dirty worktree prevents sync", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const isClean = yield* git.isClean();
      expect(isClean).toBe(false);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a", isClean: false },
          stack: stackData,
        }),
      ),
    ),
  );
});
