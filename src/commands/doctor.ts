import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { success, warn } from "../ui.js";

const fixFlag = Flag.boolean("fix").pipe(Flag.withDescription("Auto-fix issues where possible"));
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

interface Finding {
  type: "missing_trunk" | "stale_fork_point" | "stale_sync_state" | "parse_error";
  message: string;
  fixed: boolean;
}

export const doctor = Command.make("doctor", { fix: fixFlag, json: jsonFlag }).pipe(
  Command.withDescription("Check stack metadata for issues and optionally fix them"),
  Command.withExamples([
    { command: "stacked doctor", description: "Check for metadata drift" },
    { command: "stacked doctor --fix", description: "Auto-fix detected issues" },
  ]),
  Command.withHandler(({ fix, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;
      const fs = yield* FileSystem.FileSystem;

      const data = yield* stacks.load();
      const findings: Finding[] = [];
      yield* stacks.listStacks().pipe(
        Effect.catchTag("StackError", (error) =>
          Effect.sync(() => {
            findings.push({ type: "parse_error", message: error.message, fixed: false });
            return [] as const;
          }),
        ),
      );

      // Check 1: trunk branch exists
      const trunkExists = yield* git
        .branchExists(data.trunk)
        .pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));
      if (!trunkExists) {
        if (fix) {
          const candidate = yield* stacks.detectTrunkCandidate();
          if (Option.isSome(candidate)) {
            yield* stacks.setTrunk(candidate.value);
            findings.push({
              type: "missing_trunk",
              message: `Trunk "${data.trunk}" not found, set to "${candidate.value}"`,
              fixed: true,
            });
          } else {
            findings.push({
              type: "missing_trunk",
              message: `Trunk branch "${data.trunk}" does not exist and no replacement could be auto-detected`,
              fixed: false,
            });
          }
        } else {
          findings.push({
            type: "missing_trunk",
            message: `Trunk branch "${data.trunk}" does not exist`,
            fixed: false,
          });
        }
      }

      // Clone-local syncedOnto entries must point at commits available in this clone.
      for (const [branch, record] of Object.entries(data.branches)) {
        if (record.syncedOnto == null) continue;
        const valid = yield* git.revParse(record.syncedOnto).pipe(
          Effect.as(true),
          Effect.catchTag("GitError", () => Effect.succeed(false)),
        );
        if (!valid) {
          if (fix) {
            yield* stacks
              .updateSyncedOnto(branch, null)
              .pipe(Effect.catchTag("StackError", () => Effect.void));
            findings.push({
              type: "stale_fork_point",
              message: `Cleared stale syncedOnto for "${branch}" (commit ${record.syncedOnto.slice(0, 7)} no longer exists)`,
              fixed: true,
            });
          } else {
            findings.push({
              type: "stale_fork_point",
              message: `Branch "${branch}" has stale syncedOnto (commit ${record.syncedOnto.slice(0, 7)} no longer exists)`,
              fixed: false,
            });
          }
        }
      }

      // Stale sync state file from an interrupted conflict merge.
      const gitDir = yield* git
        .revParse("--absolute-git-dir")
        .pipe(Effect.catchTag("GitError", () => Effect.succeed("")));
      if (gitDir !== "") {
        const syncStatePath = `${gitDir}/stacked-sync-state.json`;
        const syncStateExists = yield* fs
          .exists(syncStatePath)
          .pipe(Effect.catchTag("PlatformError", () => Effect.succeed(false)));
        if (syncStateExists) {
          if (fix) {
            yield* fs.remove(syncStatePath, { force: true }).pipe(Effect.ignore);
            findings.push({
              type: "stale_sync_state",
              message: "Removed stale sync state file (interrupted conflict merge)",
              fixed: true,
            });
          } else {
            findings.push({
              type: "stale_sync_state",
              message:
                "Stale sync state file found — an interrupted conflict merge may need 'stacked sync --continue' or 'stacked sync --abort'",
              fixed: false,
            });
          }
        }
      }

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ findings }, null, 2));
      } else if (findings.length === 0) {
        yield* success("No issues found");
      } else {
        for (const f of findings) {
          if (f.fixed) {
            yield* success(f.message);
          } else {
            yield* warn(f.message);
          }
        }
        const fixable = findings.filter((f) => !f.fixed).length;
        if (fixable > 0 && !fix) {
          yield* Console.error(`\nRun 'stacked doctor --fix' to auto-fix ${fixable} issue(s)`);
        }
      }
    }),
  ),
);
