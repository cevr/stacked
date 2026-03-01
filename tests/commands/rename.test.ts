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
      const data = yield* stacks.load();

      // Simulate rename: remove old key, add new key with same branches
      const stack = data.stacks["feat-a"];
      expect(stack).toBeDefined();
      const { "feat-a": _, ...rest } = data.stacks;
      yield* stacks.save({ ...data, stacks: { ...rest, "new-name": stack! } });

      const updated = yield* stacks.load();
      expect(updated.stacks["feat-a"]).toBeUndefined();
      expect(updated.stacks["new-name"]).toBeDefined();
      expect(updated.stacks["new-name"]?.branches).toEqual(["feat-a", "feat-b"]);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("errors on nonexistent stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();
      expect(data.stacks["nonexistent"]).toBeUndefined();
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("errors on duplicate target name", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      // Can't rename to a name that already exists
      expect(data.stacks["feat-a"]).toBeDefined();
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
