// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";

describe("StackService", () => {
  const initialData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  it.effect("getTrunk returns trunk from data", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const trunk = yield* stacks.getTrunk();
      expect(trunk).toBe("main");
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("setTrunk updates trunk", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.setTrunk("develop");
      const trunk = yield* stacks.getTrunk();
      expect(trunk).toBe("develop");
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("createStack adds new stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.createStack("new-stack", ["branch-1"]);
      const data = yield* stacks.load();
      expect(data.stacks["new-stack"]).toEqual({ branches: ["branch-1"] });
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("addBranch appends to stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.addBranch("feat-a", "feat-d");
      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a", "feat-b", "feat-c", "feat-d"]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("addBranch inserts after specific branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.addBranch("feat-a", "feat-x", "feat-a");
      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a", "feat-x", "feat-b", "feat-c"]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("removeBranch removes from stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.removeBranch("feat-a", "feat-b");
      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a", "feat-c"]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("removeBranch removes stack when last branch removed", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const singleStack: StackFile = {
        version: 1,
        trunk: "main",
        stacks: { solo: { branches: ["only-one"] } },
      };
      yield* stacks.save(singleStack);
      yield* stacks.removeBranch("solo", "only-one");
      const data = yield* stacks.load();
      expect(data.stacks["solo"]).toBeUndefined();
    }).pipe(Effect.provide(StackService.layerTest())),
  );

  it.effect("parentOf returns trunk for first branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const parent = yield* stacks.parentOf("feat-a");
      expect(parent).toBe("main");
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("parentOf returns previous branch for non-first", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const parent = yield* stacks.parentOf("feat-c");
      expect(parent).toBe("feat-b");
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("childrenOf returns next branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const children = yield* stacks.childrenOf("feat-a");
      expect(children).toEqual(["feat-b"]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("childrenOf returns empty for last branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const children = yield* stacks.childrenOf("feat-c");
      expect(children).toEqual([]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );
});
