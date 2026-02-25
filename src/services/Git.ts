import { Effect, Layer, ServiceMap } from "effect";
import { GitError } from "../errors/index.js";

export class GitService extends ServiceMap.Service<
  GitService,
  {
    readonly currentBranch: () => Effect.Effect<string, GitError>;
    readonly branchExists: (name: string) => Effect.Effect<boolean, GitError>;
    readonly createBranch: (name: string, from?: string) => Effect.Effect<void, GitError>;
    readonly deleteBranch: (name: string, force?: boolean) => Effect.Effect<void, GitError>;
    readonly checkout: (name: string) => Effect.Effect<void, GitError>;
    readonly rebase: (onto: string) => Effect.Effect<void, GitError>;
    readonly push: (branch: string, options?: { force?: boolean }) => Effect.Effect<void, GitError>;
    readonly log: (
      branch: string,
      options?: { limit?: number; oneline?: boolean },
    ) => Effect.Effect<string, GitError>;
    readonly mergeBase: (a: string, b: string) => Effect.Effect<string, GitError>;
    readonly isClean: () => Effect.Effect<boolean, GitError>;
    readonly revParse: (ref: string) => Effect.Effect<string, GitError>;
    readonly diff: (
      a: string,
      b: string,
      options?: { stat?: boolean },
    ) => Effect.Effect<string, GitError>;
    readonly isAncestor: (ancestor: string, descendant: string) => Effect.Effect<boolean, GitError>;
    readonly remote: () => Effect.Effect<string, GitError>;
    readonly fetch: (remote?: string) => Effect.Effect<void, GitError>;
  }
>()("@cvr/stacked/services/Git/GitService") {
  static layer: Layer.Layer<GitService> = Layer.sync(GitService, () => {
    const run = Effect.fn("git.run")(function* (args: readonly string[]) {
      const proc = Bun.spawn(["git", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = yield* Effect.promise(() => proc.exited);
      const stdout = yield* Effect.promise(() => new Response(proc.stdout).text());
      const stderr = yield* Effect.promise(() => new Response(proc.stderr).text());

      if (exitCode !== 0) {
        return yield* new GitError({
          message: stderr.trim() || `git ${args[0]} failed with exit code ${exitCode}`,
          command: `git ${args.join(" ")}`,
        });
      }
      return stdout.trim();
    });

    return {
      currentBranch: () => run(["rev-parse", "--abbrev-ref", "HEAD"]),

      branchExists: (name) =>
        run(["rev-parse", "--verify", name]).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        ),

      createBranch: (name, from) => {
        const args = from !== undefined ? ["checkout", "-b", name, from] : ["checkout", "-b", name];
        return run(args).pipe(Effect.asVoid);
      },

      deleteBranch: (name, force) =>
        run(["branch", force === true ? "-D" : "-d", name]).pipe(Effect.asVoid),

      checkout: (name) => run(["checkout", name]).pipe(Effect.asVoid),

      rebase: (onto) => run(["rebase", onto]).pipe(Effect.asVoid),

      push: (branch, options) => {
        const args = ["push", "-u", "origin", branch];
        if (options?.force === true) args.splice(1, 0, "--force-with-lease");
        return run(args).pipe(Effect.asVoid);
      },

      log: (branch, options) => {
        const args = ["log", branch];
        if (options?.oneline === true) args.push("--oneline");
        if (options?.limit !== undefined) args.push("-n", `${options.limit}`);
        return run(args);
      },

      mergeBase: (a, b) => run(["merge-base", a, b]),

      isClean: () => run(["status", "--porcelain"]).pipe(Effect.map((r) => r === "")),

      revParse: (ref) => run(["rev-parse", ref]),

      diff: (a, b, options) => {
        const args = ["diff", a, b];
        if (options?.stat === true) args.push("--stat");
        return run(args);
      },

      isAncestor: (ancestor, descendant) =>
        run(["merge-base", "--is-ancestor", ancestor, descendant]).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        ),

      remote: () => run(["remote"]),

      fetch: (remote) => run(["fetch", remote ?? "origin"]).pipe(Effect.asVoid),
    };
  });

  static layerTest = (impl: Partial<ServiceMap.Service.Shape<typeof GitService>> = {}) =>
    Layer.succeed(GitService, {
      currentBranch: () => Effect.succeed("main"),
      branchExists: () => Effect.succeed(false),
      createBranch: () => Effect.void,
      deleteBranch: () => Effect.void,
      checkout: () => Effect.void,
      rebase: () => Effect.void,
      push: () => Effect.void,
      log: () => Effect.succeed(""),
      mergeBase: () => Effect.succeed("abc123"),
      isClean: () => Effect.succeed(true),
      revParse: () => Effect.succeed("abc123"),
      diff: () => Effect.succeed(""),
      isAncestor: () => Effect.succeed(true),
      remote: () => Effect.succeed("origin"),
      fetch: () => Effect.void,
      ...impl,
    });
}
