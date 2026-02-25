import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import { createTestLayer } from "../helpers/test-cli.js";

describe("create command logic", () => {
  it.effect("creates stack when branching from trunk", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      yield* stacks.createStack("feat-a", []);
      yield* stacks.addBranch("feat-a", "feat-a");

      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]).toBeDefined();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main" },
        }),
      ),
    ),
  );

  it.effect("adds to existing stack when branching from stacked branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      yield* stacks.createStack("feat-a", ["feat-a"]);
      yield* stacks.addBranch("feat-a", "feat-b", "feat-a");

      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a", "feat-b"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
        }),
      ),
    ),
  );
});
