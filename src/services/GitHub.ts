import { Effect, Layer, ServiceMap } from "effect";
import { GitHubError } from "../errors/index.js";

export class GitHubService extends ServiceMap.Service<
  GitHubService,
  {
    readonly createPR: (options: {
      head: string;
      base: string;
      title: string;
      body?: string;
      draft?: boolean;
    }) => Effect.Effect<{ url: string; number: number }, GitHubError>;
    readonly updatePR: (options: {
      branch: string;
      base?: string;
      title?: string;
      body?: string;
    }) => Effect.Effect<void, GitHubError>;
    readonly getPR: (
      branch: string,
    ) => Effect.Effect<
      { number: number; url: string; state: string; base: string } | null,
      GitHubError
    >;
    readonly isGhInstalled: () => Effect.Effect<boolean>;
  }
>()("services/GitHub/GitHubService") {
  static layer: Layer.Layer<GitHubService> = Layer.sync(GitHubService, () => {
    const run = Effect.fn("gh.run")(function* (args: readonly string[]) {
      const proc = Bun.spawn(["gh", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = yield* Effect.promise(() => proc.exited);
      const stdout = yield* Effect.promise(() => new Response(proc.stdout).text());
      const stderr = yield* Effect.promise(() => new Response(proc.stderr).text());

      if (exitCode !== 0) {
        return yield* new GitHubError({
          message: stderr.trim() || `gh ${args[0]} failed with exit code ${exitCode}`,
          command: `gh ${args.join(" ")}`,
        });
      }
      return stdout.trim();
    });

    return {
      createPR: Effect.fn("GitHubService.createPR")(function* (options) {
        const args = [
          "pr",
          "create",
          "--head",
          options.head,
          "--base",
          options.base,
          "--title",
          options.title,
        ];
        if (options.body !== undefined) args.push("--body", options.body);
        if (options.draft === true) args.push("--draft");
        const output = yield* run(args);
        const url = output.trim();
        const match = url.match(/\/(\d+)$/);
        const number = match?.[1] !== undefined ? parseInt(match[1], 10) : 0;
        return { url, number };
      }),

      updatePR: Effect.fn("GitHubService.updatePR")(function* (options) {
        const args = ["pr", "edit", options.branch];
        if (options.base !== undefined) args.push("--base", options.base);
        if (options.title !== undefined) args.push("--title", options.title);
        if (options.body !== undefined) args.push("--body", options.body);
        yield* run(args);
      }),

      getPR: Effect.fn("GitHubService.getPR")(function* (branch) {
        const result = yield* run([
          "pr",
          "view",
          branch,
          "--json",
          "number,url,state,baseRefName",
        ]).pipe(Effect.catch(() => Effect.succeed(null)));

        if (result === null) return null;
        try {
          const data = JSON.parse(result) as {
            number: number;
            url: string;
            state: string;
            baseRefName: string;
          };
          return {
            number: data.number,
            url: data.url,
            state: data.state,
            base: data.baseRefName,
          };
        } catch {
          return null;
        }
      }),

      isGhInstalled: () =>
        Effect.sync(() => {
          try {
            Bun.spawnSync(["gh", "--version"]);
            return true;
          } catch {
            return false;
          }
        }),
    };
  });

  static layerTest = (impl: Partial<ServiceMap.Service.Shape<typeof GitHubService>> = {}) =>
    Layer.succeed(GitHubService, {
      createPR: () => Effect.succeed({ url: "https://github.com/test/repo/pull/1", number: 1 }),
      updatePR: () => Effect.void,
      getPR: () => Effect.succeed(null),
      isGhInstalled: () => Effect.succeed(true),
      ...impl,
    });
}
