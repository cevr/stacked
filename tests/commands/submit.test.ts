// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { GitService } from "../../src/services/Git.js";
import { GitHubService } from "../../src/services/GitHub.js";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { submit } from "../../src/commands/submit.js";
import { CallRecorder, createTestLayer, expectCall, expectNoCall } from "../helpers/test-cli.js";

describe("submit command logic", () => {
  const stackData: StackFile = {
    version: 1,
    trunk: "main",
    stacks: {
      "feat-a": { branches: ["feat-a", "feat-b"] },
    },
  };

  it.effect("pushes and creates PRs for each branch", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const gh = yield* GitHubService;
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;

      const trunk = yield* stacks.getTrunk();
      const stack = yield* stacks.getStack("feat-a");
      const branches = [...(stack?.branches ?? [])];

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        if (branch === undefined) continue;
        const base = i === 0 ? trunk : (branches[i - 1] ?? trunk);

        yield* git.push(branch);
        const existingPR = yield* gh.getPR(branch);
        if (existingPR === null) {
          yield* gh.createPR({ head: branch, base, title: branch });
        }
      }

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "push", { branch: "feat-a" });
      expectCall(calls, "GitHub", "getPR", { branch: "feat-a" });
      expectCall(calls, "GitHub", "createPR");
      expectCall(calls, "Git", "push", { branch: "feat-b" });
      expectCall(calls, "GitHub", "getPR", { branch: "feat-b" });
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
        }),
      ),
    ),
  );

  it.effect("updates PR when one already exists", () =>
    Effect.gen(function* () {
      const gh = yield* GitHubService;
      const stacks = yield* StackService;
      const recorder = yield* CallRecorder;

      const trunk = yield* stacks.getTrunk();
      const stack = yield* stacks.getStack("feat-a");
      const branches = [...(stack?.branches ?? [])];
      const branch = branches[0];
      if (branch === undefined) return;

      // getPR returns existing PR — so we should update, not create
      const existingPR = yield* gh.getPR(branch);
      expect(existingPR).not.toBeNull();
      expect(existingPR?.body).toBe("Existing PR description\n<!-- stacked -->");

      // Simulate update path
      yield* gh.updatePR({ branch, base: trunk, title: branch });

      const calls = yield* recorder.calls;
      expectCall(calls, "GitHub", "updatePR", { branch: "feat-a" });
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: { currentBranch: "feat-a" },
          stack: stackData,
          github: {
            getPR: (_branch: string) =>
              Effect.succeed({
                number: 1,
                url: "https://github.com/test/repo/pull/1",
                state: "OPEN" as const,
                base: "main",
                body: "Existing PR description\n<!-- stacked -->",
              }),
          },
        }),
      ),
    ),
  );

  test("updates metadata for PRs created in the same submit run", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(submit, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      expectCall(calls, "GitHub", "createPR", { head: "feat-a" });
      expectCall(calls, "GitHub", "createPR", { head: "feat-b" });
      expectCall(calls, "GitHub", "updatePR", { branch: "feat-a" });
      expectCall(calls, "GitHub", "updatePR", { branch: "feat-b" });
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

  test("submit runs sync before pushing by default", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(submit, { version: "test" });

      yield* run([]);

      const calls = yield* recorder.calls;
      expectCall(calls, "Git", "fetch");
      expectCall(calls, "Git", "mergeFastForward", { ref: "origin/main" });
      expectCall(calls, "Git", "mergeBranch");

      const fetchIdx = calls.findIndex((c) => c.service === "Git" && c.method === "fetch");
      const firstPushIdx = calls.findIndex((c) => c.service === "Git" && c.method === "push");
      expect(fetchIdx).toBeGreaterThan(-1);
      expect(firstPushIdx).toBeGreaterThan(fetchIdx);
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

  test("submit --no-sync skips the sync step", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(submit, { version: "test" });

      yield* run(["--no-sync"]);

      const calls = yield* recorder.calls;
      expectNoCall(calls, "Git", "fetch");
      expectNoCall(calls, "Git", "mergeFastForward");
      expectNoCall(calls, "Git", "mergeBranch");
      expectCall(calls, "Git", "push", { branch: "feat-a" });
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

  test("submit --dry-run does not run sync", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(submit, { version: "test" });

      yield* run(["--dry-run"]);

      const calls = yield* recorder.calls;
      expectNoCall(calls, "Git", "fetch");
      expectNoCall(calls, "Git", "mergeFastForward");
      expectNoCall(calls, "Git", "mergeBranch");
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

  test("dry-run json plans without pushing or mutating PRs", async () => {
    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(submit, { version: "test" });

      yield* run(["--dry-run", "--json"]);

      const calls = yield* recorder.calls;
      expectCall(calls, "GitHub", "getPR", { branch: "feat-a" });
      expectCall(calls, "GitHub", "getPR", { branch: "feat-b" });
      expectNoCall(calls, "Git", "push");
      expectNoCall(calls, "GitHub", "createPR");
      expectNoCall(calls, "GitHub", "updatePR");
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

  test("submit skips merged branches: no push, no PR mutation, mark preserved", async () => {
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

    const program = Effect.gen(function* () {
      const recorder = yield* CallRecorder;
      const run = Command.runWith(submit, { version: "test" });

      yield* run(["--no-sync"]);

      const calls = yield* recorder.calls;
      const featAPush = calls.find(
        (c) =>
          c.service === "Git" &&
          c.method === "push" &&
          (c.args as { branch?: string })?.branch === "feat-a",
      );
      expect(featAPush).toBeUndefined();
      const featACreatePR = calls.find(
        (c) =>
          c.service === "GitHub" &&
          c.method === "createPR" &&
          (c.args as { head?: string })?.head === "feat-a",
      );
      expect(featACreatePR).toBeUndefined();
      expectCall(calls, "Git", "push", { branch: "feat-b" });
      expectCall(calls, "GitHub", "createPR", { head: "feat-b" });

      const stacks = yield* StackService;
      const data = yield* stacks.load();
      expect(data.mergedBranches).toEqual(["feat-a"]);
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

    await Effect.runPromise(program);
  });
});
