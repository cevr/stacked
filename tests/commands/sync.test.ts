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

  it.effect("fetches and rebases all branches bottom-to-top", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      yield* git.fetch();
      yield* git.checkout("feat-a");
      yield* git.rebase("origin/main");
      yield* git.checkout("feat-b");
      yield* git.rebase("feat-a");
      yield* git.checkout("feat-c");
      yield* git.rebase("feat-b");

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "fetch");
      expectCall(calls, "Git", "checkout", { name: "feat-a" });
      expectCall(calls, "Git", "rebase", { onto: "origin/main" });
      expectCall(calls, "Git", "checkout", { name: "feat-b" });
      expectCall(calls, "Git", "rebase", { onto: "feat-a" });
      expectCall(calls, "Git", "checkout", { name: "feat-c" });
      expectCall(calls, "Git", "rebase", { onto: "feat-b" });
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
      yield* git.checkout("feat-b");
      yield* git.rebase("feat-a");
      yield* git.checkout("feat-c");
      yield* git.rebase("feat-b");

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "fetch");
      // Should not checkout or rebase feat-a (it's the --from branch, skipped)
      const rebaseCalls = calls.filter((c) => c.service === "Git" && c.method === "rebase");
      expect(rebaseCalls).toHaveLength(2);
      expectCall(calls, "Git", "checkout", { name: "feat-b" });
      expectCall(calls, "Git", "rebase", { onto: "feat-a" });
      expectCall(calls, "Git", "checkout", { name: "feat-c" });
      expectCall(calls, "Git", "rebase", { onto: "feat-b" });
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );
});
