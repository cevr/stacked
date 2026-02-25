// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { GitHubService } from "../../src/services/GitHub.js";
import { CallRecorder, createTestLayer, expectCall, expectNoCall } from "../helpers/test-cli.js";
import { GitService } from "../../src/services/Git.js";

describe("clean command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  const makePrLookup = (mergedBranches: string[]) => (branch: string) =>
    mergedBranches.includes(branch)
      ? Effect.succeed({
          number: 1,
          url: "https://github.com/test/repo/pull/1",
          state: "MERGED" as const,
          base: "main",
        })
      : Effect.succeed({
          number: 2,
          url: "https://github.com/test/repo/pull/2",
          state: "OPEN" as const,
          base: "main",
        });

  it.effect("removes contiguously merged branches from bottom", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const gh = yield* GitHubService;
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;

      // feat-a and feat-b merged, feat-c open
      // Should remove feat-a and feat-b, leave feat-c
      const data = yield* stacks.load();
      for (const [stackName, stack] of Object.entries(data.stacks)) {
        let hitNonMerged = false;
        for (const branch of stack.branches) {
          const pr = yield* gh.getPR(branch).pipe(Effect.catch(() => Effect.succeed(null)));
          const isMerged = pr !== null && pr.state === "MERGED";
          if (!hitNonMerged && isMerged) {
            yield* stacks.removeBranch(stackName, branch);
            yield* git.deleteBranch(branch, true);
          } else {
            if (!isMerged) hitNonMerged = true;
          }
        }
      }

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "deleteBranch", { name: "feat-a" });
      expectCall(calls, "Git", "deleteBranch", { name: "feat-b" });

      const deleteCalls = calls.filter((c) => c.service === "Git" && c.method === "deleteBranch");
      expect(deleteCalls).toHaveLength(2);

      const updated = yield* stacks.load();
      const remaining = updated.stacks["feat-a"];
      expect(remaining).toBeDefined();
      expect(remaining?.branches).toEqual(["feat-c"]);
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

  it.effect("stops at first non-merged branch even if later ones are merged", () =>
    Effect.gen(function* () {
      const gh = yield* GitHubService;
      const stacks = yield* StackService;

      // feat-a merged, feat-b open, feat-c merged
      // Should only identify feat-a for removal
      const data = yield* stacks.load();
      const toRemove: string[] = [];
      const skipped: string[] = [];

      for (const stack of Object.values(data.stacks)) {
        let hitNonMerged = false;
        for (const branch of stack.branches) {
          const pr = yield* gh.getPR(branch).pipe(Effect.catch(() => Effect.succeed(null)));
          const isMerged = pr !== null && pr.state === "MERGED";
          if (!hitNonMerged && isMerged) {
            toRemove.push(branch);
          } else {
            if (!isMerged) hitNonMerged = true;
            if (isMerged) skipped.push(branch);
          }
        }
      }

      expect(toRemove).toEqual(["feat-a"]);
      expect(skipped).toEqual(["feat-c"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-b" },
          stack: stackData,
          github: { getPR: makePrLookup(["feat-a", "feat-c"]) },
        }),
      ),
    ),
  );

  it.effect("removes entire stack when all branches merged", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const gh = yield* GitHubService;
      const stacks = yield* StackService;

      const data = yield* stacks.load();
      for (const [stackName, stack] of Object.entries(data.stacks)) {
        for (const branch of stack.branches) {
          const pr = yield* gh.getPR(branch).pipe(Effect.catch(() => Effect.succeed(null)));
          const isMerged = pr !== null && pr.state === "MERGED";
          if (isMerged) {
            yield* stacks.removeBranch(stackName, branch);
            yield* git.deleteBranch(branch, true);
          }
        }
      }

      const updated = yield* stacks.load();
      expect(updated.stacks["feat-a"]).toBeUndefined();
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main" },
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
      const recorder = yield* CallRecorder;

      const data = yield* stacks.load();
      for (const stack of Object.values(data.stacks)) {
        for (const branch of stack.branches) {
          yield* gh.getPR(branch).pipe(Effect.catch(() => Effect.succeed(null)));
        }
      }

      const calls = yield* recorder.calls;
      expectNoCall(calls, "Git", "deleteBranch");
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
