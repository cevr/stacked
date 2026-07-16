#!/usr/bin/env bun
import { Command } from "effect/unstable/cli";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { command } from "./commands/index.js";
import { GitService } from "./services/Git.js";
import { StackService } from "./services/Stack.js";
import { GitHubService } from "./services/GitHub.js";
import { OutputConfig } from "./ui.js";
import { GlobalFlagConflictError } from "./errors/index.js";

const version = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";

// ============================================================================
// Global Flags (parsed before CLI framework, stripped from argv)
// ============================================================================

const globalFlags = new Set(["--verbose", "-v", "--quiet", "-q", "--no-color", "--yes", "-y"]);
const flagArgs = new Set(process.argv.filter((a) => globalFlags.has(a)));
process.argv = process.argv.filter((a) => !globalFlags.has(a));

const isVerbose = flagArgs.has("--verbose") || flagArgs.has("-v");
const isQuiet = flagArgs.has("--quiet") || flagArgs.has("-q");
const isNoColor = flagArgs.has("--no-color");
const isYes = flagArgs.has("--yes") || flagArgs.has("-y");

if (isNoColor) process.env["NO_COLOR"] = "1";

const preflight =
  isVerbose && isQuiet
    ? Console.error("Error: --verbose and --quiet are mutually exclusive").pipe(
        Effect.andThen(Effect.fail(new GlobalFlagConflictError())),
      )
    : Effect.void;

// ============================================================================
// CLI
// ============================================================================

const cli = Command.run(command, {
  version,
});

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
  "USAGE_ERROR",
  "HAS_CHILDREN",
]);

const isJson = process.argv.includes("--json");

const handleKnownError = (e: { message: string; code?: string | undefined }) => {
  const exitCode = e.code !== undefined && usageCodes.has(e.code) ? 2 : 1;
  const errorOutput = isJson
    ? Console.log(JSON.stringify({ error: { code: e.code ?? null, message: e.message } }))
    : Console.error(e.code !== undefined ? `Error [${e.code}]: ${e.message}` : e.message);

  return errorOutput.pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = exitCode;
      }),
    ),
  );
};

// @effect-diagnostics-next-line effect/strictEffectProvide:off
BunRuntime.runMain(
  Effect.gen(function* () {
    const serviceLayer = StackService.layer.pipe(
      Layer.provideMerge(GitService.layer),
      Layer.provideMerge(BunServices.layer),
      Layer.provideMerge(GitHubService.layer),
    );
    const appLayer = serviceLayer;

    yield* preflight.pipe(
      Effect.andThen(cli),
      Effect.provideService(OutputConfig, { verbose: isVerbose, quiet: isQuiet, yes: isYes }),
      Effect.provide(appLayer),
      Effect.catchTags({
        GitError: (e) => handleKnownError(e),
        StackError: (e) => handleKnownError(e),
        GitHubError: (e) => handleKnownError(e),
      }),
      Effect.catchIf(
        (e): e is GlobalFlagConflictError => e instanceof GlobalFlagConflictError,
        Effect.fail,
        (e) => {
          const msg =
            e !== null && typeof e === "object" && "message" in e
              ? String(e.message)
              : JSON.stringify(e, null, 2);
          return handleKnownError({ message: `Unexpected error: ${msg}` });
        },
      ),
    );
  }),
);
