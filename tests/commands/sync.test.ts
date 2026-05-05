// @effect-diagnostics effect/strictEffectProvide:off
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const testGitDir = () => mkdtempSync(join(tmpdir(), "stacked-test-"));
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

  test("sync fast-forwards trunk then merges parent into each child", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "fetch");
      expectCall(calls, "Git", "mergeFastForward", { ref: "origin/main" });
      expectCall(calls, "Git", "mergeBranch");
      expectCall(calls, "Git", "push", { branch: "feat-a" });
      expectCall(calls, "Git", "push", { branch: "feat-b" });
      expectCall(calls, "Git", "push", { branch: "feat-c" });

      const checkoutCalls = calls.filter((c) => c.service === "Git" && c.method === "checkout");
      expect(checkoutCalls[0]?.args).toEqual({ name: "main" });
      expect(checkoutCalls.at(-1)?.args).toEqual({ name: "feat-a" });

      const ffIndex = calls.findIndex(
        (c) => c.service === "Git" && c.method === "mergeFastForward",
      );
      const firstMergeIndex = calls.findIndex(
        (c) => c.service === "Git" && c.method === "mergeBranch",
      );
      expect(ffIndex).toBeGreaterThan(-1);
      expect(firstMergeIndex).toBeGreaterThan(ffIndex);
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
      const names = checkoutCalls.map((c) => (c.args as { name: string }).name);
      expect(names[0]).toBe("main");
      expect(names.at(-1)).toBe("feat-b");
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
      expectCall(calls, "Git", "mergeFastForward", { ref: "origin/main" });

      const mergeCalls = calls.filter((c) => c.service === "Git" && c.method === "mergeBranch");
      expect(mergeCalls.length).toBe(2);

      const featAMerge = mergeCalls.find(
        (c) => (c.args as { base?: string } | undefined)?.base === "main",
      );
      expect(featAMerge).toBeUndefined();
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
      expectNoCall(calls, "Git", "mergeFastForward");
      expectNoCall(calls, "Git", "mergeBranch");
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
      expectCall(calls, "Git", "revParse");
      expectNoCall(calls, "Git", "fetch");
      expectNoCall(calls, "Git", "checkout");
      expectNoCall(calls, "Git", "push");
      expectNoCall(calls, "Git", "mergeBranch");
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

  test("sync skips merged branches entirely and reroutes children to trunk", async () => {
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
      const mergeCalls = calls.filter((c) => c.service === "Git" && c.method === "mergeBranch");
      // feat-a is merged → skipped; feat-b and feat-c still merge.
      expect(mergeCalls.length).toBe(2);

      const featBCall = mergeCalls[0];
      expect((featBCall?.args as { base?: string })?.base).toBe("origin/main");

      // No checkout/push for feat-a (the merged branch).
      const featACheckout = calls.find(
        (c) =>
          c.service === "Git" &&
          c.method === "checkout" &&
          (c.args as { name?: string })?.name === "feat-a",
      );
      expect(featACheckout).toBeUndefined();
      const featAPush = calls.find(
        (c) =>
          c.service === "Git" &&
          c.method === "push" &&
          (c.args as { branch?: string })?.branch === "feat-a",
      );
      expect(featAPush).toBeUndefined();
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

  test("sync --include-merged forces merged branches back into the loop", async () => {
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

      yield* run(["--include-merged"]);

      const calls = yield* recorder.calls;
      const mergeCalls = calls.filter((c) => c.service === "Git" && c.method === "mergeBranch");
      // With --include-merged, feat-a is merged into too → 3 calls.
      expect(mergeCalls.length).toBe(3);

      // feat-b's base is feat-a (not rerouted to trunk).
      const featBCall = mergeCalls[1];
      expect((featBCall?.args as { base?: string })?.base).toBe("feat-a");
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

  test("sync pushes up-to-date branches that have unpushed commits", async () => {
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
      // No merges happen — both branches' syncedOnto matches parent tip
      expectNoCall(calls, "Git", "mergeBranch");
      // But both branches had unpushed commits, so both should be pushed
      expectCall(calls, "Git", "aheadCount", { branch: "feat-a" });
      expectCall(calls, "Git", "aheadCount", { branch: "feat-b" });
      expectCall(calls, "Git", "push", { branch: "feat-a" });
      expectCall(calls, "Git", "push", { branch: "feat-b" });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "feat-a",
              aheadCount: () => ({ ahead: 2, hasRemote: true }),
            },
            stack: stackDataWithSyncedOnto,
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("sync skips branches when syncedOnto matches parent tip", async () => {
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
      expectNoCall(calls, "Git", "mergeBranch");
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

  test("sync updates syncedOnto after successful merge", async () => {
    const program = Effect.gen(function* () {
      const run = Command.runWith(sync, { version: "test" });
      yield* run([]);

      const stacks = yield* StackService;
      const featASynced = yield* stacks.getSyncedOnto("feat-a");
      const featBSynced = yield* stacks.getSyncedOnto("feat-b");
      const featCSynced = yield* stacks.getSyncedOnto("feat-c");

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

  test("sync writes conflict state when merge fails", async () => {
    const recorderLayer = CallRecorder.layer;
    const gitDir = testGitDir();
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
          push: (branch: string) =>
            recorder.record({ service: "Git", method: "push", args: { branch } }),
          log: () => Effect.succeed(""),
          isClean: () => Effect.succeed(true),
          revParse: (ref: string) =>
            Effect.succeed(ref === "--absolute-git-dir" ? gitDir : `oid${revParseCounter++}`),
          isAncestor: () => Effect.succeed(false),
          mergeBase: () => Effect.succeed("abc123"),
          firstParentUniqueCommits: () => Effect.succeed([]),
          isMergeInProgress: () => Effect.succeed(false),
          commitAmend: () => Effect.void,
          fetch: () => recorder.record({ service: "Git", method: "fetch" }),
          deleteRemoteBranch: () => Effect.void,
          mergeFastForward: (ref: string) =>
            recorder.record({ service: "Git", method: "mergeFastForward", args: { ref } }),
          aheadCount: (branch: string) =>
            recorder
              .record({ service: "Git", method: "aheadCount", args: { branch } })
              .pipe(Effect.as({ ahead: 0, hasRemote: true })),
          mergeBranch: (opts: { base: string; message: string }) =>
            recorder
              .record({ service: "Git", method: "mergeBranch", args: opts })
              .pipe(
                Effect.andThen(
                  Effect.fail(new GitError({ message: "conflict", command: "git merge" })),
                ),
              ),
          mergeContinue: () => Effect.void,
          mergeAbort: () => Effect.void,
          conflictedFiles: () =>
            recorder
              .record({ service: "Git", method: "conflictedFiles" })
              .pipe(Effect.as(["conflict.txt"])),
        };
      }),
    ).pipe(Layer.provide(recorderLayer));

    const stackLayer = createMockStackService(stackData, { currentBranch: "feat-a" });
    const ghLayer = createMockGitHubService().pipe(Layer.provide(recorderLayer));

    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      const result = yield* run([]).pipe(Effect.catchTag("StackError", (e) => Effect.succeed(e)));

      expect(result).toHaveProperty("_tag", "StackError");
      expect((result as any).message).toContain("Conflict on feat-a");
      expect((result as any).message).toContain("stacked sync --continue");

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "mergeBranch", { base: "origin/main" });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(recorderLayer, gitLayer, stackLayer, ghLayer, BunServices.layer),
      ),
    );

    await Effect.runPromise(program);
  });

  test("sync does not restore original branch when merge is pending", async () => {
    const recorderLayer = CallRecorder.layer;
    const gitDir = testGitDir();
    let revParseCounter = 0;

    const gitLayer = Layer.effect(
      GitService,
      Effect.gen(function* () {
        const recorder = yield* CallRecorder;
        return {
          currentBranch: () =>
            recorder.record({ service: "Git", method: "currentBranch" }).pipe(Effect.as("feat-c")),
          listBranches: () => Effect.succeed([]),
          branchExists: () => Effect.succeed(false),
          remoteDefaultBranch: () => Effect.succeed(Option.none()),
          createBranch: () => Effect.void,
          deleteBranch: () => Effect.void,
          checkout: (name: string) =>
            recorder.record({ service: "Git", method: "checkout", args: { name } }),
          push: (branch: string) =>
            recorder.record({ service: "Git", method: "push", args: { branch } }),
          log: () => Effect.succeed(""),
          isClean: () => Effect.succeed(true),
          revParse: (ref: string) =>
            Effect.succeed(ref === "--absolute-git-dir" ? gitDir : `oid${revParseCounter++}`),
          isAncestor: () => Effect.succeed(false),
          mergeBase: () => Effect.succeed("abc123"),
          firstParentUniqueCommits: () => Effect.succeed([]),
          isMergeInProgress: () => Effect.succeed(false),
          commitAmend: () => Effect.void,
          fetch: () => recorder.record({ service: "Git", method: "fetch" }),
          deleteRemoteBranch: () => Effect.void,
          mergeFastForward: () => Effect.void,
          aheadCount: () => Effect.succeed({ ahead: 0, hasRemote: true }),
          mergeBranch: () =>
            Effect.fail(new GitError({ message: "conflict", command: "git merge" })),
          mergeContinue: () => Effect.void,
          mergeAbort: () => Effect.void,
          conflictedFiles: () => Effect.succeed(["conflict.txt"]),
        };
      }),
    ).pipe(Layer.provide(recorderLayer));

    const stackLayer = createMockStackService(stackData, { currentBranch: "feat-c" });
    const ghLayer = createMockGitHubService().pipe(Layer.provide(recorderLayer));

    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(sync, { version: "test" });

      yield* run([]).pipe(Effect.catchTag("StackError", () => Effect.void));

      const calls = yield* recorder.calls;
      const checkoutCalls = calls.filter((c) => c.service === "Git" && c.method === "checkout");
      const names = checkoutCalls.map((c) => (c.args as { name: string }).name);

      // Conflict on feat-a (first child); we should still be on feat-a, not restored to feat-c
      expect(names).toContain("feat-a");
      expect(names.at(-1)).not.toBe("feat-c");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(recorderLayer, gitLayer, stackLayer, ghLayer, BunServices.layer),
      ),
    );

    await Effect.runPromise(program);
  });
});
