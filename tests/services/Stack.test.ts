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

  it.effect("createStack rejects duplicate branch inputs", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const error = yield* stacks.createStack("duplicate", ["same", "same"]).pipe(Effect.flip);

      expect(error.message).toContain('Branch "same" appears more than once');
      expect(yield* stacks.getStack("duplicate")).toBeNull();
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

  it.effect("migrates v1 stack data to v2 format", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      // v2 should have branches map with parent pointers
      expect(data.version).toBe(2);
      expect(data.branches).toEqual({
        "feat-a": { stack: "feat-a", parent: null },
        "feat-b": { stack: "feat-a", parent: "feat-a" },
        "feat-c": { stack: "feat-a", parent: "feat-b" },
      });
      expect(data.stacks).toEqual({
        "feat-a": { root: "feat-a" },
      });
      expect(data.mergedBranches).toEqual([]);
    }).pipe(Effect.provide(StackService.layerTest(initialData))),
  );

  it.effect("v1→v2 migration preserves merged branches and excludes tracked ones", () =>
    Effect.gen(function* () {
      const v1WithMerged: StackFile = {
        version: 1,
        trunk: "main",
        stacks: {
          "feat-a": { branches: ["feat-a", "feat-b"] },
        },
        mergedBranches: ["old-branch", "feat-a"],
      };
      const stacks = yield* StackService;
      yield* stacks.save(v1WithMerged);
      const data = yield* stacks.load();

      // feat-a is tracked, so it should NOT appear in mergedBranches
      expect(data.mergedBranches).toEqual(["old-branch"]);
      expect(data.branches["feat-a"]).toEqual({ stack: "feat-a", parent: null });
    }).pipe(Effect.provide(StackService.layerTest())),
  );

  it.effect("v1→v2 migration handles empty stacks gracefully", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const emptyV1: StackFile = {
        version: 1,
        trunk: "main",
        stacks: {},
      };
      yield* stacks.save(emptyV1);
      const data = yield* stacks.load();

      expect(data.version).toBe(2);
      expect(data.stacks).toEqual({});
      expect(data.branches).toEqual({});
    }).pipe(Effect.provide(StackService.layerTest())),
  );

  it.effect("projects one active parent truth across merged branches", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      const lineage = yield* stacks.currentLineage();
      expect(lineage).toEqual({
        name: "feat-a",
        trunk: "main",
        branches: [
          { name: "feat-a", parent: "main", activeParent: "main", merged: true },
          { name: "feat-b", parent: "feat-a", activeParent: "main", merged: false },
          { name: "feat-c", parent: "feat-b", activeParent: "feat-b", merged: true },
          { name: "feat-d", parent: "feat-c", activeParent: "feat-b", merged: false },
        ],
      });
    }).pipe(
      Effect.provide(
        StackService.layerTest(
          {
            version: 2,
            trunk: "main",
            stacks: { "feat-a": { root: "feat-a" } },
            branches: {
              "feat-a": { stack: "feat-a", parent: null },
              "feat-b": { stack: "feat-a", parent: "feat-a" },
              "feat-c": { stack: "feat-a", parent: "feat-b" },
              "feat-d": { stack: "feat-a", parent: "feat-c" },
            },
            mergedBranches: ["feat-a", "feat-c"],
          },
          { currentBranch: "feat-d" },
        ),
      ),
    ),
  );

  it.effect("can include merged branches as active parents", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const lineage = yield* stacks.currentLineage({ includeMerged: true });

      expect(lineage?.branches.map(({ name, activeParent }) => ({ name, activeParent }))).toEqual([
        { name: "feat-a", activeParent: "main" },
        { name: "feat-b", activeParent: "feat-a" },
        { name: "feat-c", activeParent: "feat-b" },
      ]);
    }).pipe(
      Effect.provide(
        StackService.layerTest(
          {
            version: 2,
            trunk: "main",
            stacks: { "feat-a": { root: "feat-a" } },
            branches: {
              "feat-a": { stack: "feat-a", parent: null },
              "feat-b": { stack: "feat-a", parent: "feat-a" },
              "feat-c": { stack: "feat-a", parent: "feat-b" },
            },
            mergedBranches: ["feat-a"],
          },
          { currentBranch: "feat-c" },
        ),
      ),
    ),
  );

  it.effect("invalidates sync markers only where a lineage rewrite changes the parent", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.reorderBranch("feat-b", { after: "feat-c" });

      const data = yield* stacks.load();
      expect(data.branches["feat-a"]?.syncedOnto).toBe("oid-main");
      expect(data.branches["feat-c"]?.syncedOnto).toBeUndefined();
      expect(data.branches["feat-b"]?.syncedOnto).toBeUndefined();
    }).pipe(
      Effect.provide(
        StackService.layerTest({
          version: 2,
          trunk: "main",
          stacks: { "feat-a": { root: "feat-a" } },
          branches: {
            "feat-a": { stack: "feat-a", parent: null, syncedOnto: "oid-main" },
            "feat-b": { stack: "feat-a", parent: "feat-a", syncedOnto: "oid-feat-a" },
            "feat-c": { stack: "feat-a", parent: "feat-b", syncedOnto: "oid-feat-b" },
          },
        }),
      ),
    ),
  );
});
