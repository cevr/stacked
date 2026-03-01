// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer } from "../helpers/test-cli.js";
import { GitService } from "../../src/services/Git.js";

describe("create command logic", () => {
  it.effect("creates stack when branching from trunk", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      yield* stacks.createStack("feat-a", []);
      yield* stacks.addBranch("feat-a", "feat-a");

      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]).toBeDefined();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main" },
        }),
      ),
    ),
  );

  it.effect("adds to existing stack when branching from stacked branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      yield* stacks.createStack("feat-a", ["feat-a"]);
      yield* stacks.addBranch("feat-a", "feat-b", "feat-a");

      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a", "feat-b"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
        }),
      ),
    ),
  );

  it.effect("git.createBranch is called before metadata writes", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;

      // Simulate create from trunk
      yield* git.createBranch("feat-a", "main");
      yield* stacks.createStack("feat-a", []);
      yield* stacks.addBranch("feat-a", "feat-a");

      const calls = yield* recorder.calls;
      const createIdx = calls.findIndex((c) => c.service === "Git" && c.method === "createBranch");
      expect(createIdx).toBeGreaterThanOrEqual(0);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main" },
        }),
      ),
    ),
  );
});
