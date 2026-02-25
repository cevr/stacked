import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { createTestLayer } from "../helpers/test-cli.js";

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
});
