// @effect-diagnostics effect/strictEffectProvide:off
import { describe, expect } from "effect-bun-test";
import { test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import type { StackFile } from "../../src/services/Stack.js";
import { sync } from "../../src/commands/sync.js";
import { StackService } from "../../src/services/Stack.js";
import { CallRecorder, createTestLayer, expectCall, expectNoCall } from "../helpers/test-cli.js";

describe("sync command", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b", "feat-c"] },
    },
  };

  test("sync always rebases trunk before stack branches", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "fetch");
      expectCall(calls, "Git", "rebase", { onto: "origin/main" });
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-a", newBase: "origin/main" });
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-b", newBase: "feat-a" });
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-c", newBase: "feat-b" });
      expectCall(calls, "Git", "push", { branch: "feat-a", force: true });
      expectCall(calls, "Git", "push", { branch: "feat-b", force: true });
      expectCall(calls, "Git", "push", { branch: "feat-c", force: true });

      const checkoutCalls = calls.filter((c) => c.service === "Git" && c.method === "checkout");
      expect(checkoutCalls[0]?.args).toEqual({ name: "main" });
      expect(checkoutCalls.at(-1)?.args).toEqual({ name: "feat-a" });

      const rebaseIndex = calls.findIndex(
        (c) =>
          c.service === "Git" &&
          c.method === "rebase" &&
          (c.args as { onto?: string } | undefined)?.onto === "origin/main",
      );
      const firstBranchRebaseIndex = calls.findIndex(
        (c) =>
          c.service === "Git" &&
          c.method === "rebaseOnto" &&
          (c.args as { branch?: string } | undefined)?.branch === "feat-a",
      );
      expect(rebaseIndex).toBeGreaterThan(-1);
      expect(firstBranchRebaseIndex).toBeGreaterThan(rebaseIndex);
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

  test("sync returns to the starting branch after rebasing", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      const checkoutCalls = calls.filter((c) => c.service === "Git" && c.method === "checkout");
      expect(checkoutCalls.map((c) => (c.args as { name: string }).name)).toEqual([
        "main",
        "feat-a",
        "feat-b",
        "feat-c",
        "feat-b",
      ]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-b" },
            stack: stackData,
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("sync --from still updates trunk first", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run(["--from", "feat-a"]);

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "rebase", { onto: "origin/main" });
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-b", newBase: "feat-a" });
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-c", newBase: "feat-b" });

      const featARebaseCalls = calls.filter(
        (c) =>
          c.service === "Git" &&
          c.method === "rebaseOnto" &&
          (c.args as { branch?: string } | undefined)?.branch === "feat-a",
      );
      expect(featARebaseCalls).toHaveLength(0);
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

  test("sync --dry-run does not mutate git state", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run(["--dry-run", "--json"]);

      const calls = yield* recorder.calls;
      expectNoCall(calls, "Git", "fetch");
      expectNoCall(calls, "Git", "checkout");
      expectNoCall(calls, "Git", "rebase");
      expectNoCall(calls, "Git", "rebaseOnto");
      expectNoCall(calls, "Git", "push");
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

  test("sync refreshes stacked PR bodies when an upstream PR has been merged", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      const featBUpdate = expectCall(calls, "GitHub", "updatePR", { branch: "feat-b" });
      const featCUpdate = expectCall(calls, "GitHub", "updatePR", { branch: "feat-c" });

      const featBBody = (featBUpdate.args as { body?: string }).body;
      const featCBody = (featCUpdate.args as { body?: string }).body;

      expect(featBBody).toContain("[#10](https://github.com/test/repo/pull/10) ✅");
      expect(featBBody).toContain("**#11 ← you are here**");
      expect(featCBody).toContain("[#10](https://github.com/test/repo/pull/10) ✅");
      expect(featCBody).toContain("[#11](https://github.com/test/repo/pull/11)");
      expect(featCBody).toContain("**#12 ← you are here**");

      const stacks = yield* StackService;
      const data = yield* stacks.load();
      expect(data.mergedBranches).toEqual(["feat-a"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-b" },
            stack: stackData,
            github: {
              getPR: (branch: string) => {
                const prs = {
                  "feat-a": {
                    number: 10,
                    url: "https://github.com/test/repo/pull/10",
                    state: "MERGED",
                    base: "main",
                    body: "Merged parent PR\n\n<!-- stacked -->old<!-- /stacked -->",
                  },
                  "feat-b": {
                    number: 11,
                    url: "https://github.com/test/repo/pull/11",
                    state: "OPEN",
                    base: "main",
                    body: "Current PR body\n\n<!-- stacked -->old<!-- /stacked -->",
                  },
                  "feat-c": {
                    number: 12,
                    url: "https://github.com/test/repo/pull/12",
                    state: "OPEN",
                    base: "feat-b",
                    body: "Child PR body\n\n<!-- stacked -->old<!-- /stacked -->",
                  },
                } as const;

                return Effect.succeed(prs[branch as keyof typeof prs] ?? null);
              },
            },
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });
});
