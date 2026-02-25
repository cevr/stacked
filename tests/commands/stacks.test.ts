// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { createTestLayer } from "../helpers/test-cli.js";

describe("stacks command logic", () => {
  const multiStackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-auth": { branches: ["feat-auth", "feat-auth-ui"] },
      "feat-perf": { branches: ["feat-perf"] },
    },
  };

  it.effect("lists all stacks with branch counts", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      const names = Object.keys(data.stacks);
      expect(names).toHaveLength(2);
      expect(names).toContain("feat-auth");
      expect(names).toContain("feat-perf");
      expect(data.stacks["feat-auth"]!.branches).toHaveLength(2);
      expect(data.stacks["feat-perf"]!.branches).toHaveLength(1);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-auth" },
          stack: multiStackData,
        }),
      ),
    ),
  );

  it.effect("identifies current stack from branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      const currentBranch = "feat-auth-ui";
      let currentStackName: string | null = null;
      for (const [name, stack] of Object.entries(data.stacks)) {
        if (stack.branches.includes(currentBranch)) {
          currentStackName = name;
          break;
        }
      }

      expect(currentStackName).toBe("feat-auth");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-auth-ui" },
          stack: multiStackData,
        }),
      ),
    ),
  );

  it.effect("handles empty stacks", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      expect(Object.keys(data.stacks)).toHaveLength(0);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main" },
        }),
      ),
    ),
  );
});
