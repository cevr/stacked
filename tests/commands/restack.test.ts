import { describe, it } from "effect-bun-test";
import { Effect } from "effect";
import { GitService } from "../../src/services/Git.js";
import type { StackFile } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer, expectCall } from "../helpers/test-cli.js";

describe("restack command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  it.effect("rebases only children of current branch", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      yield* git.checkout("feat-b");
      yield* git.rebase("feat-a");
      yield* git.checkout("feat-c");
      yield* git.rebase("feat-b");

      const calls = yield* recorder.calls;
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
