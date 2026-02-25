// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { GitHubService } from "../../src/services/GitHub.js";
import { CallRecorder, createTestLayer, expectCall } from "../helpers/test-cli.js";
import { GitService } from "../../src/services/Git.js";

describe("clean command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  const makePrLookup = (merged: string[]) => (branch: string) =>
    merged.includes(branch)
      ? Effect.succeed({
          number: 1,
          url: "https://github.com/test/repo/pull/1",
          state: "MERGED",
          base: "main",
        })
      : Effect.succeed({
          number: 2,
          url: "https://github.com/test/repo/pull/2",
          state: "OPEN",
          base: "main",
        });

  it.effect("identifies merged branches for removal", () =>
    Effect.gen(function* () {
      const gh = yield* GitHubService;
      const stacks = yield* StackService;

      const data = yield* stacks.load();
      const merged: string[] = [];

      for (const stack of Object.values(data.stacks)) {
        for (const branch of stack.branches) {
          const pr = yield* gh.getPR(branch).pipe(Effect.catch(() => Effect.succeed(null)));
          if (pr !== null && pr.state === "MERGED") {
            merged.push(branch);
          }
        }
      }

      expect(merged).toEqual(["feat-a", "feat-b"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-c" },
          stack: stackData,
          github: { getPR: makePrLookup(["feat-a", "feat-b"]) },
        }),
      ),
    ),
  );

  it.effect("removes merged branches from stack and deletes git branches", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const gh = yield* GitHubService;
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;

      const data = yield* stacks.load();
      for (const [stackName, stack] of Object.entries(data.stacks)) {
        for (const branch of stack.branches) {
          const pr = yield* gh.getPR(branch).pipe(Effect.catch(() => Effect.succeed(null)));
          if (pr !== null && pr.state === "MERGED") {
            yield* stacks.removeBranch(stackName, branch);
            yield* git.deleteBranch(branch, true);
          }
        }
      }

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "deleteBranch", { name: "feat-a" });
      expectCall(calls, "Git", "deleteBranch", { name: "feat-b" });

      const updated = yield* stacks.load();
      const remaining = updated.stacks["feat-a"];
      expect(remaining).toBeUndefined();
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-c" },
          stack: stackData,
          github: { getPR: makePrLookup(["feat-a", "feat-b", "feat-c"]) },
        }),
      ),
    ),
  );

  it.effect("does nothing when no branches are merged", () =>
    Effect.gen(function* () {
      const gh = yield* GitHubService;
      const stacks = yield* StackService;

      const data = yield* stacks.load();
      const merged: string[] = [];

      for (const stack of Object.values(data.stacks)) {
        for (const branch of stack.branches) {
          const pr = yield* gh.getPR(branch).pipe(Effect.catch(() => Effect.succeed(null)));
          if (pr !== null && pr.state === "MERGED") {
            merged.push(branch);
          }
        }
      }

      expect(merged).toHaveLength(0);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
          github: { getPR: makePrLookup([]) },
        }),
      ),
    ),
  );
});
