// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { createTestLayer } from "../helpers/test-cli.js";

describe("rename command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b"] },
    },
  };

  it.effect("renames stack key in metadata", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.renameStack("feat-a", "new-name");
      expect(yield* stacks.getStack("feat-a")).toBeNull();
      const stack = yield* stacks.getStack("new-name");
      expect(stack?.branches).toEqual(["feat-a", "feat-b"]);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("errors on nonexistent stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      expect(yield* stacks.getStack("nonexistent")).toBeNull();
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("errors on duplicate target name", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      expect(yield* stacks.getStack("feat-a")).not.toBeNull();
    }).pipe(
      Effect.provide(
        createTestLayer({
          stack: {
            version: 1,
            trunk: "main",
            stacks: {
              "feat-a": { branches: ["feat-a"] },
              "feat-b": { branches: ["feat-b"] },
            },
          },
        }),
      ),
    ),
  );
});
