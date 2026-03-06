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
