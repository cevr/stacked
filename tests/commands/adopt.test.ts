// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { Effect, Layer } from "effect";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer, expectNoCall } from "../helpers/test-cli.js";
import { Command } from "effect/unstable/cli";
import { BunServices } from "@effect/platform-bun";
import { adopt } from "../../src/commands/adopt.js";

describe("adopt command", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b"] },
    },
  };

  it.effect("adopts an existing branch into the current stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const run = Command.runWith(adopt, { version: "test" });

      yield* run(["feat-c"]);

      const stack = yield* stacks.getStack("feat-a");
      expect(stack?.branches).toEqual(["feat-a", "feat-b", "feat-c"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "feat-a",
              branches: { "feat-c": true },
            },
            stack: stackData,
          }),
          BunServices.layer,
        ),
      ),
    ),
  );

  it.effect("adopts after a specific branch with --after", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const run = Command.runWith(adopt, { version: "test" });

      yield* run(["feat-c", "--after", "feat-a"]);

      const stack = yield* stacks.getStack("feat-a");
      expect(stack?.branches).toEqual(["feat-a", "feat-c", "feat-b"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "feat-b",
              branches: { "feat-c": true },
            },
            stack: stackData,
          }),
          BunServices.layer,
        ),
      ),
    ),
  );

  it.effect("rejects adopting the trunk branch", () =>
    Effect.gen(function* () {
      const run = Command.runWith(adopt, { version: "test" });

      const result = yield* run(["main"]).pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.code)),
      );

      expect(result).toBe("TRUNK_ERROR");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "feat-a",
              branches: { main: true },
            },
            stack: stackData,
          }),
          BunServices.layer,
        ),
      ),
    ),
  );

  it.effect("rejects adopting a branch already in another stack", () =>
    Effect.gen(function* () {
      const run = Command.runWith(adopt, { version: "test" });

      // other-branch is in stack "other", current branch is on "feat-a" stack
      const result = yield* run(["other-branch"]).pipe(
        Effect.as("ok"),
        Effect.catchTag("StackError", (e) => Effect.succeed(e.code)),
      );

      expect(result).toBe("BRANCH_EXISTS");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "feat-a",
              branches: { "other-branch": true },
            },
            stack: {
              version: 1,
              trunk: "main",
              stacks: {
                "feat-a": { branches: ["feat-a", "feat-b"] },
                other: { branches: ["other-branch"] },
              },
            },
          }),
          BunServices.layer,
        ),
      ),
    ),
  );

  it.effect("creates a new stack when not on a stacked branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const run = Command.runWith(adopt, { version: "test" });

      yield* run(["feat-x"]);

      const stack = yield* stacks.getStack("untracked");
      expect(stack?.branches).toEqual(["untracked", "feat-x"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "untracked",
              branches: { "feat-x": true },
            },
          }),
          BunServices.layer,
        ),
      ),
    ),
  );

  it.effect("creates a singleton stack when adopting the current untracked branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const run = Command.runWith(adopt, { version: "test" });

      yield* run(["untracked"]);

      const stack = yield* stacks.getStack("untracked");
      expect(stack?.branches).toEqual(["untracked"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "untracked",
              branches: { untracked: true },
            },
          }),
          BunServices.layer,
        ),
      ),
    ),
  );

  it.effect("no-ops when branch is already in the same stack", () =>
    Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(adopt, { version: "test" });

      yield* run(["feat-b"]);

      const calls = yield* recorder.calls;
      // Should not call addBranch or createStack
      expectNoCall(calls, "Git", "createBranch");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "feat-a",
              branches: { "feat-b": true },
            },
            stack: stackData,
          }),
          BunServices.layer,
        ),
      ),
    ),
  );
});
