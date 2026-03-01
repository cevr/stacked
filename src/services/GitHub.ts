import { Effect, Layer, Schema, ServiceMap } from "effect";
import { GitHubError } from "../errors/index.js";

const GhPrResponse = Schema.Struct({
  number: Schema.Number,
  url: Schema.String,
  state: Schema.String,
  baseRefName: Schema.String,
  body: Schema.NullOr(Schema.String),
});

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
      { number: number; url: string; state: string; base: string; body: string | null } | null,
      GitHubError
    >;
    readonly isGhInstalled: () => Effect.Effect<boolean>;
  }
>()("@cvr/stacked/services/GitHub/GitHubService") {
  static layer: Layer.Layer<GitHubService> = Layer.sync(GitHubService, () => {
    const run = Effect.fn("gh.run")(function* (args: readonly string[]) {
      const proc = yield* Effect.sync(() =>
        Bun.spawn(["gh", ...args], {
          stdout: "pipe",
          stderr: "pipe",
        }),
      );

      const exitCode = yield* Effect.tryPromise({
        try: () => proc.exited,
        catch: (e) =>
          new GitHubError({ message: `Process failed: ${e}`, command: `gh ${args.join(" ")}` }),
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
          new GitHubError({
            message: `Failed to read stdout: ${e}`,
            command: `gh ${args.join(" ")}`,
          }),
      });
      const stderr = yield* Effect.tryPromise({
        try: () => new Response(proc.stderr).text(),
        catch: (e) =>
          new GitHubError({
            message: `Failed to read stderr: ${e}`,
            command: `gh ${args.join(" ")}`,
          }),
      });

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
          "number,url,state,baseRefName,body",
        ]).pipe(Effect.catchTag("GitHubError", () => Effect.succeed(null)));

        if (result === null) return null;
        const data = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(GhPrResponse))(
          result,
        ).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(null)));
        if (data === null) return null;
        return {
          number: data.number,
          url: data.url,
          state: data.state,
          base: data.baseRefName,
          body: data.body,
        };
      }),

      isGhInstalled: () =>
        Effect.try({
          try: () =>
            Bun.spawn(["gh", "--version"], {
              stdout: "ignore",
              stderr: "ignore",
            }),
          catch: () => null,
        }).pipe(
          Effect.andThen((proc) => {
            if (proc === null) return Effect.succeed(false);
            return Effect.tryPromise({
              try: () => proc.exited,
              catch: () => -1,
            }).pipe(Effect.map((code) => code === 0));
          }),
          Effect.catch(() => Effect.succeed(false)),
        ),
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
