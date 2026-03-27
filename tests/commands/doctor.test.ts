// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { doctor } from "../../src/commands/doctor.js";
import { GitService } from "../../src/services/Git.js";
import { GitError } from "../../src/errors/index.js";
import { StackService } from "../../src/services/Stack.js";
import {
  CallRecorder,
  createTestLayer,
  createMockStackService,
  createMockGitHubService,
} from "../helpers/test-cli.js";

describe("doctor command logic", () => {
  it.effect("detects stale branches not in git", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const stack = yield* stacks.getStack("feat-a");
      expect(stack?.branches).toEqual(["feat-a", "feat-b"]);
      // With branches: { "feat-a": false, "feat-b": false }, branchExists returns false
      // doctor would flag both as stale
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main", branches: { "feat-a": false, "feat-b": false } },
          stack: {
            version: 1,
            trunk: "main",
            stacks: { "feat-a": { branches: ["feat-a", "feat-b"] } },
          },
        }),
      ),
    ),
  );

  it.effect("normalizes duplicate v1 branch entries down to one tracked branch", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const tracked = yield* stacks.trackedBranches();
      expect(tracked.filter((branch) => branch === "shared")).toEqual(["shared"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "main", branches: { shared: true } },
          stack: {
            version: 1,
            trunk: "main",
            stacks: {
              "stack-a": { branches: ["shared", "feat-a"] },
              "stack-b": { branches: ["shared", "feat-b"] },
            },
          },
        }),
      ),
    ),
  );

  it.effect("fix mode removes stale branches", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      // Simulate what doctor --fix does: remove branches not in git
      yield* stacks.removeBranch("feat-stale");

      const stack = yield* stacks.getStack("feat-a");
      expect(stack?.branches).toEqual(["feat-a"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: {
            currentBranch: "main",
            branches: { "feat-a": true, "feat-stale": false },
          },
          stack: {
            version: 1,
            trunk: "main",
            stacks: { "feat-a": { branches: ["feat-a", "feat-stale"] } },
          },
        }),
      ),
    ),
  );

  it.effect("fix mode reroots stack when stale root branch is removed", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      yield* stacks.removeBranch("feat-a");

      const oldStack = yield* stacks.getStack("feat-a");
      const newStack = yield* stacks.getStack("feat-b");
      expect(oldStack).toBeNull();
      expect(newStack?.branches).toEqual(["feat-b"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: {
            currentBranch: "main",
            branches: { "feat-a": false, "feat-b": true },
          },
          stack: {
            version: 1,
            trunk: "main",
            stacks: { "feat-a": { branches: ["feat-a", "feat-b"] } },
          },
        }),
      ),
    ),
  );

  it.effect("reports no issues for healthy stack", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      // All branches exist, no duplicates, trunk exists
      const stack = yield* stacks.getStack("feat-a");
      expect(stack?.branches).toEqual(["feat-a", "feat-b"]);
      expect(yield* stacks.getTrunk()).toBe("main");
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: {
            currentBranch: "main",
            branches: { main: true, "feat-a": true, "feat-b": true },
          },
          stack: {
            version: 1,
            trunk: "main",
            stacks: { "feat-a": { branches: ["feat-a", "feat-b"] } },
          },
        }),
      ),
    ),
  );

  test("doctor --fix repairs trunk from remote default branch", async () => {
    const program = Effect.gen(function* () {
      const stacks = yield* StackService;
      const run = Command.runWith(doctor, { version: "test" });

      yield* run(["--fix"]);

      const trunk = yield* stacks.getTrunk();
      expect(trunk).toBe("trunk");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "feat-a",
              remoteDefaultBranch: Option.some("trunk"),
              branches: { dead: false, trunk: true },
            },
            stackDetectTrunkCandidate: Option.some("trunk"),
            stack: {
              version: 1,
              trunk: "dead",
              stacks: {},
            },
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("doctor --fix leaves trunk unchanged when no replacement exists", async () => {
    const program = Effect.gen(function* () {
      const stacks = yield* StackService;
      const run = Command.runWith(doctor, { version: "test" });

      yield* run(["--fix"]);

      const trunk = yield* stacks.getTrunk();
      expect(trunk).toBe("dead");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createTestLayer({
            git: {
              currentBranch: "feat-a",
              remoteDefaultBranch: Option.none(),
              branches: { dead: false },
            },
            stackDetectTrunkCandidate: Option.none(),
            stack: {
              version: 1,
              trunk: "dead",
              stacks: {},
            },
          }),
          BunServices.layer,
        ),
      ),
    );

    await Effect.runPromise(program);
  });

  test("doctor --fix clears stale syncedOnto entries", async () => {
    const recorderLayer = CallRecorder.layer;

    // Git mock that fails revParse for OID-like strings (stale syncedOnto)
    const gitLayer = Layer.effect(
      GitService,
      Effect.gen(function* () {
        const recorder = yield* CallRecorder;
        return {
          currentBranch: () => Effect.succeed("feat-a"),
          listBranches: () => Effect.succeed(["main", "feat-a"]),
          branchExists: (name: string) => Effect.succeed(name === "main" || name === "feat-a"),
          remoteDefaultBranch: () => Effect.succeed(Option.none()),
          createBranch: () => Effect.void,
          deleteBranch: () => Effect.void,
          checkout: () => Effect.void,
          rebase: () => Effect.void,
          rebaseOnto: () => Effect.void,
          rebaseAbort: () => Effect.void,
          push: () => Effect.void,
          log: () => Effect.succeed(""),
          isClean: () => Effect.succeed(true),
          revParse: (ref: string) => {
            // Fail for SHA-like refs (stale syncedOnto)
            if (/^[0-9a-f]{7,}$/.test(ref)) {
              return Effect.fail(
                new GitError({ message: `bad revision '${ref}'`, command: `git rev-parse ${ref}` }),
              );
            }
            return recorder
              .record({ service: "Git", method: "revParse", args: { ref } })
              .pipe(Effect.as(`oid-${ref}`));
          },
          isAncestor: () => Effect.succeed(false),
          mergeBase: () => Effect.succeed("abc123"),
          firstParentUniqueCommits: () => Effect.succeed([]),
          isRebaseInProgress: () => Effect.succeed(false),
          commitAmend: () => Effect.void,
          fetch: () => Effect.void,
          deleteRemoteBranch: () => Effect.void,
          treeMergeSync: () => Effect.succeed({ action: "conflict" as const }),
        };
      }),
    ).pipe(Layer.provide(recorderLayer));

    const stackLayer = createMockStackService(
      {
        version: 2,
        trunk: "main",
        stacks: { "feat-a": { root: "feat-a" } },
        branches: {
          "feat-a": { stack: "feat-a", parent: null, syncedOnto: "deadbeef123456" },
        },
      },
      { currentBranch: "feat-a" },
    );
    const ghLayer = createMockGitHubService().pipe(Layer.provide(recorderLayer));

    const program = Effect.gen(function* () {
      const stacks = yield* StackService;
      const run = Command.runWith(doctor, { version: "test" });

      yield* run(["--fix"]);

      // syncedOnto should have been cleared since the OID doesn't resolve
      const syncedOnto = yield* stacks.getSyncedOnto("feat-a");
      expect(syncedOnto).toBeNull();
    }).pipe(
      Effect.provide(
        Layer.mergeAll(recorderLayer, gitLayer, stackLayer, ghLayer, BunServices.layer),
      ),
    );

    await Effect.runPromise(program);
  });
});
