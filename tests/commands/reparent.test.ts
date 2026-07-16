// @effect-diagnostics effect/strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { test } from "bun:test";
import { describe, expect, it } from "effect-bun-test";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { reparent } from "../../src/commands/reparent.js";
import { StackService, type StackFile } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer, expectCall, expectNoCall } from "../helpers/test-cli.js";

const stackData: StackFile = {
  version: 2,
  trunk: "main",
  stacks: {
    alpha: { root: "feat-a" },
    beta: { root: "feat-x" },
  },
  branches: {
    "feat-a": { stack: "alpha", parent: null, syncedOnto: "oid-main" },
    "feat-b": { stack: "alpha", parent: "feat-a", syncedOnto: "oid-a" },
    "feat-c": { stack: "alpha", parent: "feat-b", syncedOnto: "oid-b" },
    "feat-x": { stack: "beta", parent: null, syncedOnto: "oid-main" },
    "feat-y": { stack: "beta", parent: "feat-x", syncedOnto: "oid-x" },
  },
};

describe("reparent command", () => {
  it.effect(
    "moves a branch subtree across stacks and invalidates changed-parent sync markers",
    () =>
      Effect.gen(function* () {
        const stacks = yield* StackService;

        const result = yield* stacks.reparentBranch("feat-b", "feat-x");
        const data = yield* stacks.load();

        expect((yield* stacks.getStack("alpha"))?.branches).toEqual(["feat-a"]);
        expect((yield* stacks.getStack("beta"))?.branches).toEqual([
          "feat-x",
          "feat-b",
          "feat-c",
          "feat-y",
        ]);
        expect(result.moved).toEqual(["feat-b", "feat-c"]);
        expect(result.invalidatedSyncMarkers).toEqual(["feat-b", "feat-y"]);
        expect(data.branches["feat-a"]?.syncedOnto).toBe("oid-main");
        expect(data.branches["feat-b"]?.syncedOnto).toBeUndefined();
        expect(data.branches["feat-c"]?.syncedOnto).toBe("oid-b");
        expect(data.branches["feat-x"]?.syncedOnto).toBe("oid-main");
        expect(data.branches["feat-y"]?.syncedOnto).toBeUndefined();
      }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("reparents a subtree onto trunk as a new stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      const result = yield* stacks.reparentBranch("feat-b", "main");
      const data = yield* stacks.load();

      expect((yield* stacks.getStack("alpha"))?.branches).toEqual(["feat-a"]);
      expect((yield* stacks.getStack("feat-b"))?.branches).toEqual(["feat-b", "feat-c"]);
      expect(result.destination.name).toBe("feat-b");
      expect(data.branches["feat-b"]?.syncedOnto).toBeUndefined();
      expect(data.branches["feat-c"]?.syncedOnto).toBe("oid-b");
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("removes an emptied source stack when its root moves", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      const result = yield* stacks.reparentBranch("feat-a", "feat-x");

      expect(yield* stacks.getStack("alpha")).toBeNull();
      expect((yield* stacks.getStack("beta"))?.branches).toEqual([
        "feat-x",
        "feat-a",
        "feat-b",
        "feat-c",
        "feat-y",
      ]);
      expect(result.source).toBeNull();
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("reshapes one stack without losing unchanged sync markers", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      const result = yield* stacks.reparentBranch("feat-c", "feat-a");
      const data = yield* stacks.load();

      expect((yield* stacks.getStack("alpha"))?.branches).toEqual(["feat-a", "feat-c", "feat-b"]);
      expect(result.invalidatedSyncMarkers).toEqual(["feat-c", "feat-b"]);
      expect(data.branches["feat-a"]?.syncedOnto).toBe("oid-main");
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  it.effect("rejects reparenting onto a descendant without changing topology", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      const error = yield* stacks.reparentBranch("feat-b", "feat-c").pipe(Effect.flip);

      expect(error.message).toContain("descendant");
      expect((yield* stacks.getStack("alpha"))?.branches).toEqual(["feat-a", "feat-b", "feat-c"]);
    }).pipe(Effect.provide(createTestLayer({ stack: stackData }))),
  );

  test("--dry-run reports the move without changing topology", async () => {
    const program = Effect.gen(function* () {
      const stacks = yield* StackService;
      const run = Command.runWith(reparent, { version: "test" });

      yield* run(["feat-b", "--onto", "feat-x", "--dry-run", "--json"]);

      expect((yield* stacks.getStack("alpha"))?.branches).toEqual(["feat-a", "feat-b", "feat-c"]);
      expect((yield* stacks.getStack("beta"))?.branches).toEqual(["feat-x", "feat-y"]);
    }).pipe(
      Effect.provide(Layer.mergeAll(createTestLayer({ stack: stackData }), BunServices.layer)),
    );

    await Effect.runPromise(program);
  });

  test("--sync synchronizes the moved branch's destination lineage", async () => {
    const program = Effect.gen(function* () {
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;
      const run = Command.runWith(reparent, { version: "test" });

      yield* run(["feat-b", "--onto", "feat-x", "--sync"]);

      expect((yield* stacks.getStack("beta"))?.branches).toEqual([
        "feat-x",
        "feat-b",
        "feat-c",
        "feat-y",
      ]);
      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "fetch");
      expectCall(calls, "Git", "mergeFastForward", { ref: "origin/main" });
      const bases = calls
        .filter((call) => call.service === "Git" && call.method === "mergeBranch")
        .map((call) => (call.args as { base: string }).base);
      expect(bases).toEqual(["origin/main", "feat-x", "feat-b", "feat-c"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-a", isAncestor: () => false },
            stack: stackData,
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("--sync checks checkout readiness before changing topology", async () => {
    const program = Effect.gen(function* () {
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;
      const run = Command.runWith(reparent, { version: "test" });

      const error = yield* run(["feat-b", "--onto", "feat-x", "--sync"]).pipe(Effect.flip);

      expect(error).toMatchObject({ _tag: "StackError", code: "DIRTY_WORKTREE" });
      expect((yield* stacks.getStack("alpha"))?.branches).toEqual(["feat-a", "feat-b", "feat-c"]);
      expect((yield* stacks.getStack("beta"))?.branches).toEqual(["feat-x", "feat-y"]);
      expectNoCall(yield* recorder.calls, "Git", "fetch");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-a", isClean: false },
            stack: stackData,
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("--sync rejects dry-run before checking out or changing topology", async () => {
    const program = Effect.gen(function* () {
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;
      const run = Command.runWith(reparent, { version: "test" });

      const error = yield* run(["feat-b", "--onto", "feat-x", "--sync", "--dry-run"]).pipe(
        Effect.flip,
      );

      expect(error).toMatchObject({ _tag: "StackError", code: "USAGE_ERROR" });
      expect((yield* stacks.getStack("alpha"))?.branches).toEqual(["feat-a", "feat-b", "feat-c"]);
      expectNoCall(yield* recorder.calls, "Git", "revParse");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({ git: { currentBranch: "feat-a" }, stack: stackData }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("--sync still synchronizes when the requested parent is already current", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(reparent, { version: "test" });

      yield* run(["feat-b", "--onto", "feat-a", "--sync"]);

      expectCall(yield* recorder.calls, "Git", "fetch");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({ git: { currentBranch: "feat-a" }, stack: stackData }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });
});
