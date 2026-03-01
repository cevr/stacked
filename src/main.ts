#!/usr/bin/env bun
import { Command } from "effect/unstable/cli";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { command } from "./commands/index.js";
import { GitService } from "./services/Git.js";
import { StackService } from "./services/Stack.js";
import { GitHubService } from "./services/GitHub.js";
import { OutputConfig } from "./ui.js";

const version = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";

// ============================================================================
// Global Flags (parsed before CLI framework, stripped from argv)
// ============================================================================

const globalFlags = new Set(["--verbose", "--quiet", "-q", "--no-color", "--yes", "-y"]);
const flagArgs = new Set(process.argv.filter((a) => globalFlags.has(a)));
process.argv = process.argv.filter((a) => !globalFlags.has(a));

const isVerbose = flagArgs.has("--verbose");
const isQuiet = flagArgs.has("--quiet") || flagArgs.has("-q");
const isNoColor = flagArgs.has("--no-color");
const isYes = flagArgs.has("--yes") || flagArgs.has("-y");

if (isNoColor) process.env["NO_COLOR"] = "1";

if (isVerbose && isQuiet) {
  process.stderr.write("Error: --verbose and --quiet are mutually exclusive\n");
  process.exitCode = 2;
}

// ============================================================================
// CLI
// ============================================================================

const cli = Command.run(command, {
  version,
});

const ServiceLayer = StackService.layer.pipe(
  Layer.provideMerge(GitService.layer),
  Layer.provideMerge(GitHubService.layer),
);

const AppLayer = Layer.mergeAll(ServiceLayer, BunServices.layer);

// Usage errors (bad args, invalid state) → exit 2
// Operational errors (git/gh failures) → exit 1
const usageCodes = new Set([
  "INVALID_BRANCH_NAME",
  "BRANCH_EXISTS",
  "NOT_IN_STACK",
  "STACK_NOT_FOUND",
  "STACK_EMPTY",
  "ALREADY_AT_TOP",
  "ALREADY_AT_BOTTOM",
  "TRUNK_ERROR",
  "STACK_EXISTS",
]);

const handleKnownError = (e: { message: string; code?: string | undefined }) =>
  Console.error(e.code !== undefined ? `Error [${e.code}]: ${e.message}` : e.message).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = e.code !== undefined && usageCodes.has(e.code) ? 2 : 1;
      }),
    ),
  );

// @effect-diagnostics-next-line effect/strictEffectProvide:off
BunRuntime.runMain(
  cli.pipe(
    Effect.provideService(OutputConfig, { verbose: isVerbose, quiet: isQuiet, yes: isYes }),
    Effect.provide(AppLayer),
    Effect.catchTags({
      GitError: (e) => handleKnownError(e),
      StackError: (e) => handleKnownError(e),
      GitHubError: (e) => handleKnownError(e),
    }),
    Effect.catch((e) => {
      const msg =
        e !== null && typeof e === "object" && "message" in e
          ? String(e.message)
          : JSON.stringify(e, null, 2);
      return handleKnownError({ message: `Unexpected error: ${msg}` });
    }),
  ),
);
