#!/usr/bin/env bun
import { Command } from "effect/unstable/cli";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { command } from "./commands/index.js";
import { GitService } from "./services/Git.js";
import { StackService } from "./services/Stack.js";
import { GitHubService } from "./services/GitHub.js";

const version = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";

const cli = Command.run(command, {
  version,
});

const ServiceLayer = StackService.layer.pipe(
  Layer.provideMerge(GitService.layer),
  Layer.provideMerge(GitHubService.layer),
);

const AppLayer = Layer.mergeAll(ServiceLayer, BunServices.layer);

// @effect-diagnostics-next-line effect/strictEffectProvide:off
BunRuntime.runMain(
  cli.pipe(
    Effect.provide(AppLayer),
    Effect.catch((e) => {
      const tag = e !== null && typeof e === "object" && "_tag" in e ? String(e._tag) : null;
      const isKnown = tag === "GitError" || tag === "StackError" || tag === "GitHubError";
      const msg = e !== null && typeof e === "object" && "message" in e ? String(e.message) : null;
      const message =
        isKnown && msg !== null ? msg : `Unexpected error: ${JSON.stringify(e, null, 2)}`;
      return Console.error(message).pipe(
        Effect.andThen(
          Effect.sync(() => {
            process.exitCode = 1;
          }),
        ),
      );
    }),
  ),
);
