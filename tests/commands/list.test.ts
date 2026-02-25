import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { createTestLayer } from "../helpers/test-cli.js";

describe("list command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  it.effect("finds current stack from branch name", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      const currentBranch = "feat-b";
      let found: string | null = null;
      for (const [name, stack] of Object.entries(data.stacks)) {
        if (stack.branches.includes(currentBranch)) {
          found = name;
          break;
        }
      }

      expect(found).toBe("feat-a");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-b" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("returns null when not on stacked branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      const currentBranch = "unrelated";
      let found: string | null = null;
      for (const [name, stack] of Object.entries(data.stacks)) {
        if (stack.branches.includes(currentBranch)) {
          found = name;
          break;
        }
      }

      expect(found).toBeNull();
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "unrelated" },
          stack: stackData,
        }),
      ),
    ),
  );
});
