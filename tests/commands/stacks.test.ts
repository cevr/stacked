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
      const entries = yield* stacks.listStacks();
      const names = entries.map(({ name }) => name);
      expect(names).toHaveLength(2);
      expect(names).toContain("feat-auth");
      expect(names).toContain("feat-perf");
      expect(entries.find((entry) => entry.name === "feat-auth")?.stack.branches).toHaveLength(2);
      expect(entries.find((entry) => entry.name === "feat-perf")?.stack.branches).toHaveLength(1);
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
      const currentBranch = "feat-auth-ui";
      const currentStackName = (yield* stacks.findBranchStack(currentBranch))?.name ?? null;

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
      expect(yield* stacks.listStacks()).toHaveLength(0);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main" },
        }),
      ),
    ),
  );
});
