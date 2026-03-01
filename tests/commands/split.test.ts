// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { createTestLayer } from "../helpers/test-cli.js";

describe("split command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  it.effect("splits stack at middle branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      const branches = data.stacks["feat-a"]?.branches ?? [];
      const splitIdx = branches.indexOf("feat-b");
      const below = branches.slice(0, splitIdx);
      const above = branches.slice(splitIdx);

      yield* stacks.save({
        ...data,
        stacks: {
          ...data.stacks,
          "feat-a": { branches: below },
          "feat-b": { branches: above },
        },
      });

      const updated = yield* stacks.load();
      expect(updated.stacks["feat-a"]?.branches).toEqual(["feat-a"]);
      expect(updated.stacks["feat-b"]?.branches).toEqual(["feat-b", "feat-c"]);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("splits at last branch leaves original with all but last", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      const branches = data.stacks["feat-a"]?.branches ?? [];
      const splitIdx = branches.indexOf("feat-c");
      const below = branches.slice(0, splitIdx);
      const above = branches.slice(splitIdx);

      yield* stacks.save({
        ...data,
        stacks: {
          ...data.stacks,
          "feat-a": { branches: below },
          "feat-c": { branches: above },
        },
      });

      const updated = yield* stacks.load();
      expect(updated.stacks["feat-a"]?.branches).toEqual(["feat-a", "feat-b"]);
      expect(updated.stacks["feat-c"]?.branches).toEqual(["feat-c"]);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("cannot split at first branch (nothing below)", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      const branches = data.stacks["feat-a"]?.branches ?? [];
      const splitIdx = branches.indexOf("feat-a");
      // splitIdx === 0 means nothing to split
      expect(splitIdx).toBe(0);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );
});
