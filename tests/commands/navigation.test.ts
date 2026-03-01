// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer, expectCall } from "../helpers/test-cli.js";
import { GitService } from "../../src/services/Git.js";

describe("navigation commands", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  it.effect("checkout calls git.checkout", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const recorder = yield* CallRecorder;

      yield* git.checkout("feat-b");

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "checkout", { name: "feat-b" });
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("top resolves to last branch in stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();
      const stack = data.stacks["feat-a"];
      const topBranch = stack?.branches[stack.branches.length - 1];
      expect(topBranch).toBe("feat-c");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("bottom resolves to first branch in stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();
      const stack = data.stacks["feat-a"];
      const bottomBranch = stack?.branches[0];
      expect(bottomBranch).toBe("feat-a");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-c" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("up resolves to next branch in stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();
      const stack = data.stacks["feat-a"];
      const branches = stack?.branches ?? [];
      const currentBranch = "feat-a";
      const idx = branches.indexOf(currentBranch);
      const next = branches[idx + 1];
      expect(next).toBe("feat-b");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("down resolves to previous branch in stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();
      const stack = data.stacks["feat-a"];
      const branches = stack?.branches ?? [];
      const currentBranch = "feat-c";
      const idx = branches.indexOf(currentBranch);
      const prev = branches[idx - 1];
      expect(prev).toBe("feat-b");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-c" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("up at top has no next branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();
      const stack = data.stacks["feat-a"];
      const branches = stack?.branches ?? [];
      const currentBranch = "feat-c";
      const idx = branches.indexOf(currentBranch);
      const next = branches[idx + 1];
      expect(next).toBeUndefined();
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-c" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("down at bottom has no previous branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();
      const stack = data.stacks["feat-a"];
      const branches = stack?.branches ?? [];
      const currentBranch = "feat-a";
      const idx = branches.indexOf(currentBranch);
      expect(idx).toBe(0);
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
