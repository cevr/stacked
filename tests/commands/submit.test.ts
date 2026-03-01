// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it } from "effect-bun-test";
import { Effect } from "effect";
import { GitService } from "../../src/services/Git.js";
import { GitHubService } from "../../src/services/GitHub.js";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer, expectCall } from "../helpers/test-cli.js";

describe("submit command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b"] },
    },
  };

  it.effect("pushes with force by default and creates PRs for each branch", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const gh = yield* GitHubService;
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;

      const trunk = yield* stacks.getTrunk();
      const data = yield* stacks.load();
      const branches = data.stacks["feat-a"]?.branches ?? [];

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        if (branch === undefined) continue;
        const base = i === 0 ? trunk : (branches[i - 1] ?? trunk);

        // Default is force-push (force: true)
        yield* git.push(branch, { force: true });
        const existingPR = yield* gh.getPR(branch);
        if (existingPR === null) {
          yield* gh.createPR({ head: branch, base, title: branch });
        }
      }

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "push", { branch: "feat-a", force: true });
      expectCall(calls, "GitHub", "getPR", { branch: "feat-a" });
      expectCall(calls, "GitHub", "createPR");
      expectCall(calls, "Git", "push", { branch: "feat-b", force: true });
      expectCall(calls, "GitHub", "getPR", { branch: "feat-b" });
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("pushes without force when --no-force is set", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;
      const stacks = yield* StackService;

      const data = yield* stacks.load();
      const branches = data.stacks["feat-a"]?.branches ?? [];

      for (const branch of branches) {
        yield* git.push(branch, { force: false });
      }

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "push", { branch: "feat-a", force: false });
      expectCall(calls, "Git", "push", { branch: "feat-b", force: false });
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
