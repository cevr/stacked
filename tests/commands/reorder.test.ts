// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { createTestLayer } from "../helpers/test-cli.js";

describe("reorder command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  it.effect("moves branch before another", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      // Move feat-c before feat-a
      const branches = [...(data.stacks["feat-a"]?.branches ?? [])];
      const currentIdx = branches.indexOf("feat-c");
      branches.splice(currentIdx, 1);
      const targetIdx = branches.indexOf("feat-a");
      branches.splice(targetIdx, 0, "feat-c");

      yield* stacks.save({
        ...data,
        stacks: { ...data.stacks, "feat-a": { branches } },
      });

      const updated = yield* stacks.load();
      expect(updated.stacks["feat-a"]?.branches).toEqual(["feat-c", "feat-a", "feat-b"]);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("moves branch after another", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      // Move feat-a after feat-c
      const branches = [...(data.stacks["feat-a"]?.branches ?? [])];
      const currentIdx = branches.indexOf("feat-a");
      branches.splice(currentIdx, 1);
      const targetIdx = branches.indexOf("feat-c");
      branches.splice(targetIdx + 1, 0, "feat-a");

      yield* stacks.save({
        ...data,
        stacks: { ...data.stacks, "feat-a": { branches } },
      });

      const updated = yield* stacks.load();
      expect(updated.stacks["feat-a"]?.branches).toEqual(["feat-b", "feat-c", "feat-a"]);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("moving to same position is a no-op", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      // Move feat-b after feat-a (already there)
      const branches = [...(data.stacks["feat-a"]?.branches ?? [])];
      const currentIdx = branches.indexOf("feat-b");
      branches.splice(currentIdx, 1);
      const targetIdx = branches.indexOf("feat-a");
      branches.splice(targetIdx + 1, 0, "feat-b");

      expect(branches).toEqual(["feat-a", "feat-b", "feat-c"]);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );
});
