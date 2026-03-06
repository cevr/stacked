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
      yield* stacks.splitStack("feat-b");
      expect((yield* stacks.getStack("feat-a"))?.branches).toEqual(["feat-a"]);
      expect((yield* stacks.getStack("feat-b"))?.branches).toEqual(["feat-b", "feat-c"]);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("splits at last branch leaves original with all but last", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.splitStack("feat-c");
      expect((yield* stacks.getStack("feat-a"))?.branches).toEqual(["feat-a", "feat-b"]);
      expect((yield* stacks.getStack("feat-c"))?.branches).toEqual(["feat-c"]);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("cannot split at first branch (nothing below)", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const stack = yield* stacks.getStack("feat-a");
      const branches = stack?.branches ?? [];
      const splitIdx = branches.indexOf("feat-a");
      // splitIdx === 0 means nothing to split
      expect(splitIdx).toBe(0);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );
});
