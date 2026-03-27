// @effect-diagnostics effect/strictEffectProvide:off
import { describe, expect } from "effect-bun-test";
import { test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Option } from "effect";
import { Command } from "effect/unstable/cli";
import type { StackFile } from "../../src/services/Stack.js";
import { sync } from "../../src/commands/sync.js";
import { StackService } from "../../src/services/Stack.js";
import { GitService } from "../../src/services/Git.js";
import { GitError } from "../../src/errors/index.js";
import {
  CallRecorder,
  createTestLayer,
  createMockGitHubService,
  createMockStackService,
  expectCall,
  expectNoCall,
} from "../helpers/test-cli.js";

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
      // With tree-merge mock returning "merged", branches use treeMergeSync path
      expectCall(calls, "Git", "treeMergeSync");
      expectCall(calls, "Git", "push", { branch: "feat-a", force: true });
      expectCall(calls, "Git", "push", { branch: "feat-b", force: true });
      expectCall(calls, "Git", "push", { branch: "feat-c", force: true });

      const checkoutCalls = calls.filter((c) => c.service === "Git" && c.method === "checkout");
      expect(checkoutCalls[0]?.args).toEqual({ name: "main" });
      // Final checkout restores original branch
      expect(checkoutCalls.at(-1)?.args).toEqual({ name: "feat-a" });

      const rebaseIndex = calls.findIndex(
        (c) =>
          c.service === "Git" &&
          c.method === "rebase" &&
          (c.args as { onto?: string } | undefined)?.onto === "origin/main",
      );
      const firstTreeMergeIndex = calls.findIndex(
        (c) => c.service === "Git" && c.method === "treeMergeSync",
      );
      expect(rebaseIndex).toBeGreaterThan(-1);
      expect(firstTreeMergeIndex).toBeGreaterThan(rebaseIndex);
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

  test("sync returns to the starting branch after syncing", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      const checkoutCalls = calls.filter((c) => c.service === "Git" && c.method === "checkout");
      // Tree-merge path: checkout main for trunk rebase, then restore original branch
      // No per-branch checkouts needed since treeMergeSync handles ref updates internally
      expect(checkoutCalls.map((c) => (c.args as { name: string }).name)).toEqual([
        "main",
        "feat-b",
      ]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-b", isAncestor: () => false },
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

      // feat-b and feat-c should be synced (via treeMergeSync), but not feat-a
      const treeMergeCalls = calls.filter(
        (c) => c.service === "Git" && c.method === "treeMergeSync",
      );
      expect(treeMergeCalls.length).toBe(2);

      // feat-a should not be synced at all
      const featASync = treeMergeCalls.find(
        (c) => (c.args as { branch?: string } | undefined)?.branch === "feat-a",
      );
      expect(featASync).toBeUndefined();
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

  test("sync --dry-run reads revParse and syncedOnto but does not mutate", async () => {
    const stackDataWithSyncedOnto: StackFile = {
      version: 2,
      trunk: "main",
      stacks: { "feat-a": { root: "feat-a" } },
      branches: {
        "feat-a": { stack: "feat-a", parent: null, syncedOnto: "oid-origin/main" },
        "feat-b": { stack: "feat-a", parent: "feat-a" },
      },
    };

    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run(["--dry-run"]);

      const calls = yield* recorder.calls;
      // dry-run should read revParse to predict actions
      expectCall(calls, "Git", "revParse");
      // But still no mutations
      expectNoCall(calls, "Git", "fetch");
      expectNoCall(calls, "Git", "checkout");
      expectNoCall(calls, "Git", "push");
      expectNoCall(calls, "Git", "treeMergeSync");
      expectNoCall(calls, "Git", "rebaseOnto");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-a" },
            stack: stackDataWithSyncedOnto,
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("sync --rebase-only forces rebase path", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run(["--rebase-only"]);

      const calls = yield* recorder.calls;
      // Should use rebaseOnto, NOT treeMergeSync
      expectNoCall(calls, "Git", "treeMergeSync");
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-a" });
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-b" });
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-c" });
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

  test("sync skips merged branches when computing effective base", async () => {
    const mergedStackData: StackFile = {
      version: 2,
      trunk: "main",
      stacks: {
        "feat-a": { root: "feat-a" },
      },
      branches: {
        "feat-a": { stack: "feat-a", parent: null },
        "feat-b": { stack: "feat-a", parent: "feat-a" },
        "feat-c": { stack: "feat-a", parent: "feat-b" },
      },
      mergedBranches: ["feat-a"],
    };

    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      // All three branches get synced via treeMergeSync
      const treeMergeCalls = calls.filter(
        (c) => c.service === "Git" && c.method === "treeMergeSync",
      );
      expect(treeMergeCalls.length).toBe(3);

      // feat-a is merged, so feat-b's effective base should be origin/main (not feat-a)
      const featBCall = treeMergeCalls.find(
        (c) => (c.args as { branch?: string })?.branch === "feat-b",
      );
      // The newBase for feat-b should be the resolved OID of origin/main
      expect((featBCall?.args as { newBase?: string })?.newBase).toBe("oid-origin/main");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-b", isAncestor: () => false },
            stack: mergedStackData,
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

  test("sync skips branches when syncedOnto matches parent tip", async () => {
    // Pre-populate syncedOnto so that the skip check triggers
    const stackDataWithSyncedOnto: StackFile = {
      version: 2,
      trunk: "main",
      stacks: { "feat-a": { root: "feat-a" } },
      branches: {
        "feat-a": { stack: "feat-a", parent: null, syncedOnto: "oid-origin/main" },
        "feat-b": { stack: "feat-a", parent: "feat-a", syncedOnto: "oid-feat-a" },
      },
    };

    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      // syncedOnto matches revParse(base) for both branches → skip
      expectNoCall(calls, "Git", "treeMergeSync");
      expectNoCall(calls, "Git", "rebaseOnto");
      expectNoCall(calls, "Git", "push");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: { currentBranch: "feat-a" },
            stack: stackDataWithSyncedOnto,
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("sync updates syncedOnto after successful tree-merge", async () => {
    const program = Effect.gen(function* () {
      const run = Command.runWith(sync, { version: "test" });
      yield* run([]);

      // After sync, syncedOnto should be populated for all branches
      const stacks = yield* StackService;
      const featASynced = yield* stacks.getSyncedOnto("feat-a");
      const featBSynced = yield* stacks.getSyncedOnto("feat-b");
      const featCSynced = yield* stacks.getSyncedOnto("feat-c");

      // Should be set to the resolved OID of each branch's effective base
      expect(featASynced).toBe("oid-origin/main");
      expect(featBSynced).toBe("oid-feat-a");
      expect(featCSynced).toBe("oid-feat-b");
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

  test("sync falls back to rebase on tree-merge conflict", async () => {
    const recorderLayer = CallRecorder.layer;
    let revParseCounter = 0;

    const gitLayer = Layer.effect(
      GitService,
      Effect.gen(function* () {
        const recorder = yield* CallRecorder;
        return {
          currentBranch: () =>
            recorder.record({ service: "Git", method: "currentBranch" }).pipe(Effect.as("feat-a")),
          listBranches: () => Effect.succeed([]),
          branchExists: () => Effect.succeed(false),
          remoteDefaultBranch: () => Effect.succeed(Option.none()),
          createBranch: () => Effect.void,
          deleteBranch: () => Effect.void,
          checkout: (name: string) =>
            recorder.record({ service: "Git", method: "checkout", args: { name } }),
          rebase: (onto: string) =>
            recorder.record({ service: "Git", method: "rebase", args: { onto } }),
          rebaseOnto: (branch: string, newBase: string, oldBase: string) =>
            recorder.record({
              service: "Git",
              method: "rebaseOnto",
              args: { branch, newBase, oldBase },
            }),
          rebaseAbort: () => Effect.void,
          push: (branch: string, opts?: { force?: boolean }) =>
            recorder.record({ service: "Git", method: "push", args: { branch, ...opts } }),
          log: () => Effect.succeed(""),
          isClean: () => Effect.succeed(true),
          revParse: () => Effect.succeed(`oid${revParseCounter++}`),
          isAncestor: () => Effect.succeed(false),
          mergeBase: (a: string, b: string) =>
            recorder
              .record({ service: "Git", method: "mergeBase", args: { a, b } })
              .pipe(Effect.as("abc123")),
          firstParentUniqueCommits: () => Effect.succeed([]),
          isRebaseInProgress: () => Effect.succeed(false),
          commitAmend: () => Effect.void,
          fetch: () => recorder.record({ service: "Git", method: "fetch" }),
          deleteRemoteBranch: () => Effect.void,
          // Always conflict → forces rebase fallback
          treeMergeSync: () => Effect.succeed({ action: "conflict" as const }),
        };
      }),
    ).pipe(Layer.provide(recorderLayer));

    const stackLayer = createMockStackService(stackData, { currentBranch: "feat-a" });
    const ghLayer = createMockGitHubService().pipe(Layer.provide(recorderLayer));

    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      // When treeMergeSync returns conflict, should fall back to rebaseOnto
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-a" });
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-b" });
      expectCall(calls, "Git", "rebaseOnto", { branch: "feat-c" });
      // And still push
      expectCall(calls, "Git", "push", { branch: "feat-a", force: true });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(recorderLayer, gitLayer, stackLayer, ghLayer, BunServices.layer),
      ),
    );

    await Effect.runPromise(program);
  });

  test("sync returns to original branch on rebaseOnto failure", async () => {
    const recorderLayer = CallRecorder.layer;

    // Custom git mock that fails rebaseOnto for feat-b and forces rebase fallback
    let revParseCounter = 0;
    const gitLayer = Layer.effect(
      GitService,
      Effect.gen(function* () {
        const recorder = yield* CallRecorder;
        return {
          currentBranch: () =>
            recorder.record({ service: "Git", method: "currentBranch" }).pipe(Effect.as("feat-a")),
          listBranches: () => Effect.succeed([]),
          branchExists: () => Effect.succeed(false),
          remoteDefaultBranch: () => Effect.succeed(Option.none()),
          createBranch: () => Effect.void,
          deleteBranch: () => Effect.void,
          checkout: (name: string) =>
            recorder.record({ service: "Git", method: "checkout", args: { name } }),
          rebase: (onto: string) =>
            recorder.record({ service: "Git", method: "rebase", args: { onto } }),
          rebaseOnto: (branch: string, newBase: string, oldBase: string) => {
            if (branch === "feat-b") {
              return Effect.fail(
                new GitError({ message: "CONFLICT", command: "git rebase --onto" }),
              );
            }
            return recorder.record({
              service: "Git",
              method: "rebaseOnto",
              args: { branch, newBase, oldBase },
            });
          },
          rebaseAbort: () => Effect.void,
          push: (branch: string, opts?: { force?: boolean }) =>
            recorder.record({ service: "Git", method: "push", args: { branch, ...opts } }),
          log: () => Effect.succeed(""),
          isClean: () => Effect.succeed(true),
          revParse: () => Effect.succeed(`oid${revParseCounter++}`),
          isAncestor: () => Effect.succeed(false),
          mergeBase: (a: string, b: string) =>
            recorder
              .record({ service: "Git", method: "mergeBase", args: { a, b } })
              .pipe(Effect.as("abc123")),
          firstParentUniqueCommits: () => Effect.succeed([]),
          isRebaseInProgress: () => Effect.succeed(false),
          commitAmend: () => Effect.void,
          fetch: () => recorder.record({ service: "Git", method: "fetch" }),
          deleteRemoteBranch: () => Effect.void,
          treeMergeSync: () => Effect.succeed({ action: "conflict" as const }),
        };
      }),
    ).pipe(Layer.provide(recorderLayer));

    const stackLayer = createMockStackService(stackData, { currentBranch: "feat-a" });
    const ghLayer = createMockGitHubService().pipe(Layer.provide(recorderLayer));

    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      // The sync should fail because feat-b rebase fails
      yield* run([]).pipe(Effect.catchTag("StackError", () => Effect.void));

      const calls = yield* recorder.calls;
      const checkoutCalls = calls.filter((c) => c.service === "Git" && c.method === "checkout");
      const lastCheckout = checkoutCalls.at(-1);

      // The ensuring block should have checked out the original branch (feat-a)
      expect((lastCheckout?.args as { name: string })?.name).toBe("feat-a");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(recorderLayer, gitLayer, stackLayer, ghLayer, BunServices.layer),
      ),
    );

    await Effect.runPromise(program);
  });
});
