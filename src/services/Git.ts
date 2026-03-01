import { existsSync } from "node:fs";
import { Effect, Layer, ServiceMap } from "effect";
import { GitError } from "../errors/index.js";

export class GitService extends ServiceMap.Service<
  GitService,
  {
    readonly currentBranch: () => Effect.Effect<string, GitError>;
    readonly listBranches: () => Effect.Effect<string[], GitError>;
    readonly branchExists: (name: string) => Effect.Effect<boolean, GitError>;
    readonly createBranch: (name: string, from?: string) => Effect.Effect<void, GitError>;
    readonly deleteBranch: (name: string, force?: boolean) => Effect.Effect<void, GitError>;
    readonly checkout: (name: string) => Effect.Effect<void, GitError>;
    readonly rebase: (onto: string) => Effect.Effect<void, GitError>;
    readonly rebaseOnto: (
      branch: string,
      newBase: string,
      oldBase: string,
    ) => Effect.Effect<void, GitError>;
    readonly rebaseAbort: () => Effect.Effect<void, GitError>;
    readonly push: (branch: string, options?: { force?: boolean }) => Effect.Effect<void, GitError>;
    readonly log: (
      branch: string,
      options?: { limit?: number; oneline?: boolean },
    ) => Effect.Effect<string, GitError>;
    readonly isClean: () => Effect.Effect<boolean, GitError>;
    readonly revParse: (ref: string) => Effect.Effect<string, GitError>;
    readonly isAncestor: (ancestor: string, descendant: string) => Effect.Effect<boolean, GitError>;
    readonly mergeBase: (a: string, b: string) => Effect.Effect<string, GitError>;
    readonly isRebaseInProgress: () => Effect.Effect<boolean>;
    readonly fetch: (remote?: string) => Effect.Effect<void, GitError>;
    readonly deleteRemoteBranch: (branch: string) => Effect.Effect<void, GitError>;
  }
>()("@cvr/stacked/services/Git/GitService") {
  static layer: Layer.Layer<GitService> = Layer.sync(GitService, () => {
    const run = Effect.fn("git.run")(function* (args: readonly string[]) {
      const proc = yield* Effect.sync(() =>
        Bun.spawn(["git", ...args], {
          stdout: "pipe",
          stderr: "pipe",
        }),
      );

      const exitCode = yield* Effect.tryPromise({
        try: () => proc.exited,
        catch: (e) =>
          new GitError({ message: `Process failed: ${e}`, command: `git ${args.join(" ")}` }),
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            proc.kill();
          }),
        ),
      );
      const stdout = yield* Effect.tryPromise({
        try: () => new Response(proc.stdout).text(),
        catch: (e) =>
          new GitError({
            message: `Failed to read stdout: ${e}`,
            command: `git ${args.join(" ")}`,
          }),
      });
      const stderr = yield* Effect.tryPromise({
        try: () => new Response(proc.stderr).text(),
        catch: (e) =>
          new GitError({
            message: `Failed to read stderr: ${e}`,
            command: `git ${args.join(" ")}`,
          }),
      });

      if (exitCode !== 0) {
        return yield* new GitError({
          message: stderr.trim() || `git ${args[0]} failed with exit code ${exitCode}`,
          command: `git ${args.join(" ")}`,
        });
      }
      return stdout.trim();
    });

    return {
      currentBranch: () =>
        run(["rev-parse", "--abbrev-ref", "HEAD"]).pipe(
          Effect.filterOrFail(
            (branch) => branch !== "HEAD",
            () =>
              new GitError({
                message: "HEAD is detached — checkout a branch first",
                command: "git rev-parse --abbrev-ref HEAD",
              }),
          ),
        ),

      listBranches: () =>
        run(["branch", "--format=%(refname:short)"]).pipe(
          Effect.map((output) =>
            output
              .split("\n")
              .map((b) => b.trim())
              .filter((b) => b.length > 0),
          ),
        ),

      branchExists: (name) =>
        run(["rev-parse", "--verify", `refs/heads/${name}`]).pipe(
          Effect.as(true),
          Effect.catchTag("GitError", () => Effect.succeed(false)),
        ),

      createBranch: (name, from) => {
        const args = from !== undefined ? ["checkout", "-b", name, from] : ["checkout", "-b", name];
        return run(args).pipe(Effect.asVoid);
      },

      deleteBranch: (name, force) =>
        run(["branch", force === true ? "-D" : "-d", "--", name]).pipe(Effect.asVoid),

      checkout: (name) => run(["checkout", name]).pipe(Effect.asVoid),

      rebase: (onto) => run(["rebase", onto]).pipe(Effect.asVoid),

      rebaseOnto: (branch, newBase, oldBase) =>
        run(["rebase", "--onto", newBase, oldBase, branch]).pipe(Effect.asVoid),

      rebaseAbort: () => run(["rebase", "--abort"]).pipe(Effect.asVoid),

      push: (branch, options) => {
        const args = ["push", "-u", "origin"];
        if (options?.force === true) args.splice(1, 0, "--force-with-lease");
        args.push(branch);
        return run(args).pipe(Effect.asVoid);
      },

      log: (branch, options) => {
        const args = ["log", branch];
        if (options?.oneline === true) args.push("--oneline");
        if (options?.limit !== undefined) args.push("-n", `${options.limit}`);
        return run(args);
      },

      isClean: () => run(["status", "--porcelain"]).pipe(Effect.map((r) => r === "")),

      revParse: (ref) => run(["rev-parse", ref]),

      isAncestor: (ancestor, descendant) =>
        run(["merge-base", "--is-ancestor", ancestor, descendant]).pipe(
          Effect.as(true),
          Effect.catchTag("GitError", () => Effect.succeed(false)),
        ),

      mergeBase: (a, b) => run(["merge-base", a, b]),

      isRebaseInProgress: () =>
        run(["rev-parse", "--git-dir"]).pipe(
          Effect.map(
            (gitDir) =>
              existsSync(`${gitDir}/rebase-merge`) || existsSync(`${gitDir}/rebase-apply`),
          ),
          Effect.catch(() => Effect.succeed(false)),
        ),

      fetch: (remote) => run(["fetch", remote ?? "origin"]).pipe(Effect.asVoid),

      deleteRemoteBranch: (branch) =>
        run(["push", "origin", "--delete", branch]).pipe(Effect.asVoid),
    };
  });

  static layerTest = (impl: Partial<ServiceMap.Service.Shape<typeof GitService>> = {}) =>
    Layer.succeed(GitService, {
      currentBranch: () => Effect.succeed("main"),
      listBranches: () => Effect.succeed([]),
      branchExists: () => Effect.succeed(false),
      createBranch: () => Effect.void,
      deleteBranch: () => Effect.void,
      checkout: () => Effect.void,
      rebase: () => Effect.void,
      rebaseOnto: () => Effect.void,
      rebaseAbort: () => Effect.void,
      push: () => Effect.void,
      log: () => Effect.succeed(""),
      isClean: () => Effect.succeed(true),
      revParse: () => Effect.succeed("abc123"),
      isAncestor: () => Effect.succeed(true),
      mergeBase: () => Effect.succeed("abc123"),
      isRebaseInProgress: () => Effect.succeed(false),
      fetch: () => Effect.void,
      deleteRemoteBranch: () => Effect.void,
      ...impl,
    });
}
