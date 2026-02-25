import { describe, it } from "effect-bun-test";
import { Effect } from "effect";
import { GitService } from "../../src/services/Git.js";
import type { StackFile } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer, expectCall } from "../helpers/test-cli.js";

describe("sync command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b"] },
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

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "fetch");
      expectCall(calls, "Git", "checkout", { name: "feat-a" });
      expectCall(calls, "Git", "rebase", { onto: "origin/main" });
      expectCall(calls, "Git", "checkout", { name: "feat-b" });
      expectCall(calls, "Git", "rebase", { onto: "feat-a" });
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
