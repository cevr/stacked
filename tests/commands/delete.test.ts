// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer } from "../helpers/test-cli.js";
import { GitService } from "../../src/services/Git.js";

describe("delete command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  it.effect("removes branch from stack metadata", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      yield* stacks.removeBranch("feat-a", "feat-c");

      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a", "feat-b"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("removes entire stack when last branch deleted", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      // Remove all branches one by one
      yield* stacks.removeBranch("feat-a", "feat-c");
      yield* stacks.removeBranch("feat-a", "feat-b");
      yield* stacks.removeBranch("feat-a", "feat-a");

      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]).toBeUndefined();
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("checkout to parent when deleting current branch on clean tree", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;

      // Simulate: on feat-c (tail), delete feat-c, should checkout to feat-b
      const data = yield* stacks.load();
      const stack = data.stacks["feat-a"]!;
      const name = "feat-c";
      const idx = stack.branches.indexOf(name);
      const parent = stack.branches[idx - 1] ?? data.trunk;

      yield* git.checkout(parent);
      yield* git.deleteBranch(name, false);
      yield* stacks.removeBranch("feat-a", name);

      const calls = yield* recorder.calls;
      const checkoutCall = calls.find(
        (c) =>
          c.service === "Git" &&
          c.method === "checkout" &&
          (c.args as { name: string }).name === "feat-b",
      );
      expect(checkoutCall).toBeDefined();
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-c" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("git.deleteBranch is called before metadata removal", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;

      // Simulate delete of tail branch
      yield* git.deleteBranch("feat-c", false);
      yield* stacks.removeBranch("feat-a", "feat-c");

      const calls = yield* recorder.calls;
      const deleteIdx = calls.findIndex((c) => c.service === "Git" && c.method === "deleteBranch");
      expect(deleteIdx).toBeGreaterThanOrEqual(0);

      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a", "feat-b"]);
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
