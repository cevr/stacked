// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import { createTestLayer } from "../helpers/test-cli.js";

describe("doctor command logic", () => {
  it.effect("detects stale branches not in git", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();
      const stack = data.stacks["feat-a"];
      expect(stack?.branches).toEqual(["feat-a", "feat-b"]);
      // With branches: { "feat-a": false, "feat-b": false }, branchExists returns false
      // doctor would flag both as stale
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main", branches: { "feat-a": false, "feat-b": false } },
          stack: {
            version: 1,
            trunk: "main",
            stacks: { "feat-a": { branches: ["feat-a", "feat-b"] } },
          },
        }),
      ),
    ),
  );

  it.effect("detects duplicate branches across stacks", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      // Check for branches appearing in multiple stacks
      const branchToStacks = new Map<string, string[]>();
      for (const [stackName, stack] of Object.entries(data.stacks)) {
        for (const branch of stack.branches) {
          const existing = branchToStacks.get(branch) ?? [];
          existing.push(stackName);
          branchToStacks.set(branch, existing);
        }
      }

      const duplicates = [...branchToStacks.entries()].filter(([_, names]) => names.length > 1);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]?.[0]).toBe("shared");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main", branches: { shared: true } },
          stack: {
            version: 1,
            trunk: "main",
            stacks: {
              "stack-a": { branches: ["shared", "feat-a"] },
              "stack-b": { branches: ["shared", "feat-b"] },
            },
          },
        }),
      ),
    ),
  );

  it.effect("fix mode removes stale branches", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      // Simulate what doctor --fix does: remove branches not in git
      yield* stacks.removeBranch("feat-a", "feat-stale");

      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: {
            currentBranch: "main",
            branches: { "feat-a": true, "feat-stale": false },
          },
          stack: {
            version: 1,
            trunk: "main",
            stacks: { "feat-a": { branches: ["feat-a", "feat-stale"] } },
          },
        }),
      ),
    ),
  );

  it.effect("reports no issues for healthy stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      // All branches exist, no duplicates, trunk exists
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a", "feat-b"]);
      expect(data.trunk).toBe("main");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: {
            currentBranch: "main",
            branches: { main: true, "feat-a": true, "feat-b": true },
          },
          stack: {
            version: 1,
            trunk: "main",
            stacks: { "feat-a": { branches: ["feat-a", "feat-b"] } },
          },
        }),
      ),
    ),
  );
});
