// @effect-diagnostics effect/strictEffectProvide:off
import { describe, expect } from "effect-bun-test";
import { test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import type { StackFile } from "../../src/services/Stack.js";
import { status } from "../../src/commands/status.js";
import { CallRecorder, createTestLayer, expectCall } from "../helpers/test-cli.js";

describe("status command", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  test("status calls aheadCount for every branch in stack", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(status, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "aheadCount", { branch: "feat-a" });
      expectCall(calls, "Git", "aheadCount", { branch: "feat-b" });
      expectCall(calls, "Git", "aheadCount", { branch: "feat-c" });

      const aheadCalls = calls.filter((c) => c.service === "Git" && c.method === "aheadCount");
      expect(aheadCalls.length).toBe(3);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "feat-b",
              aheadCount: (branch) =>
                branch === "feat-a"
                  ? { ahead: 0, hasRemote: true }
                  : branch === "feat-b"
                    ? { ahead: 2, hasRemote: true }
                    : { ahead: 0, hasRemote: false },
            },
            stack: stackData,
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("status --json emits per-branch info", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(status, { version: "test" });

      yield* run(["--json"]);

      const calls = yield* recorder.calls;
      const aheadCalls = calls.filter((c) => c.service === "Git" && c.method === "aheadCount");
      expect(aheadCalls.length).toBe(3);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-a" },
            stack: stackData,
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("status flags merged branches in JSON output", async () => {
    const mergedStack: StackFile = {
      version: 2,
      trunk: "main",
      stacks: {
        "feat-a": { root: "feat-a" },
      },
      branches: {
        "feat-a": { stack: "feat-a", parent: null },
        "feat-b": { stack: "feat-a", parent: "feat-a" },
      },
      mergedBranches: ["feat-a"],
    };

    const log = console.log;
    const captured: string[] = [];
    console.log = (msg?: unknown) => {
      captured.push(String(msg));
    };

    const program = Effect.gen(function* () {
      const run = Command.runWith(status, { version: "test" });
      yield* run(["--json"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-b" },
            stack: mergedStack,
          }),
          BunServices.layer,
        ),
      ),
    );

    try {
      await Effect.runPromise(program);
    } finally {
      console.log = log;
    }

    const payload = JSON.parse(captured.join("\n")) as {
      stack: { branches: Array<{ name: string; merged: boolean }> };
    };
    const featA = payload.stack.branches.find((b) => b.name === "feat-a");
    const featB = payload.stack.branches.find((b) => b.name === "feat-b");
    expect(featA?.merged).toBe(true);
    expect(featB?.merged).toBe(false);
  });
});
