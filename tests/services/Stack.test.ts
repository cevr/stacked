// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect, Layer, Option } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { GitService } from "../../src/services/Git.js";

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
      const stack = yield* stacks.getStack("new-stack");
      expect(stack).toEqual({ root: "branch-1", branches: ["branch-1"] });
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("addBranch appends to stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.addBranch("feat-a", "feat-d");
      const stack = yield* stacks.getStack("feat-a");
      expect(stack?.branches).toEqual(["feat-a", "feat-b", "feat-c", "feat-d"]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("addBranch inserts after specific branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.addBranch("feat-a", "feat-x", "feat-a");
      const stack = yield* stacks.getStack("feat-a");
      expect(stack?.branches).toEqual(["feat-a", "feat-x", "feat-b", "feat-c"]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("removeBranch removes from stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.removeBranch("feat-b");
      const stack = yield* stacks.getStack("feat-a");
      expect(stack?.branches).toEqual(["feat-a", "feat-c"]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("removeBranch reroots stack when the first branch is removed", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.removeBranch("feat-a");
      const oldStack = yield* stacks.getStack("feat-a");
      const newStack = yield* stacks.getStack("feat-b");
      expect(oldStack).toBeNull();
      expect(newStack?.branches).toEqual(["feat-b", "feat-c"]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("removeBranch resolves current stack after rerooting", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.removeBranch("feat-a");
      yield* stacks.removeBranch("feat-b");
      const stack = yield* stacks.getStack("feat-c");
      expect(stack?.branches).toEqual(["feat-c"]);
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
      yield* stacks.removeBranch("only-one");
      const stack = yield* stacks.getStack("solo");
      expect(stack).toBeNull();
    }).pipe(Effect.provide(StackService.layerTest())),
  );

  it.effect("markMergedBranches persists merged branch names", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.markMergedBranches(["merged-a", "merged-b"]);
      const data = yield* stacks.load();
      expect(data.mergedBranches).toEqual(["merged-a", "merged-b"]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("unmarkMergedBranches removes merged branch names", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.markMergedBranches(["merged-a", "merged-b"]);
      yield* stacks.unmarkMergedBranches(["merged-a"]);
      const data = yield* stacks.load();
      expect(data.mergedBranches).toEqual(["merged-b"]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("detectTrunkCandidate prefers remote default branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const trunk = yield* stacks.detectTrunkCandidate();
      expect(Option.getOrUndefined(trunk)).toBe("trunk");
    }).pipe(
      Effect.provide(
        StackService.layer.pipe(
          Layer.provide(
            GitService.layerTest({
              remoteDefaultBranch: () => Effect.succeed(Option.some("trunk")),
              branchExists: (name: string) => Effect.succeed(name === "trunk"),
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("detectTrunkCandidate falls back to common branch names", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const trunk = yield* stacks.detectTrunkCandidate();
      expect(Option.getOrUndefined(trunk)).toBe("master");
    }).pipe(
      Effect.provide(
        StackService.layer.pipe(
          Layer.provide(
            GitService.layerTest({
              remoteDefaultBranch: () => Effect.succeed(Option.none()),
              branchExists: (name: string) => Effect.succeed(name === "master"),
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("detectTrunkCandidate returns none when nothing matches", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const trunk = yield* stacks.detectTrunkCandidate();
      expect(Option.isNone(trunk)).toBe(true);
    }).pipe(
      Effect.provide(
        StackService.layer.pipe(
          Layer.provide(
            GitService.layerTest({
              remoteDefaultBranch: () => Effect.succeed(Option.none()),
              branchExists: () => Effect.succeed(false),
            }),
          ),
        ),
      ),
    ),
  );
});
