import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { rename, writeFile } from "node:fs/promises";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { success } from "../ui.js";

const editFlag = Flag.boolean("edit").pipe(Flag.withDescription("Open editor for commit message"));
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));
const fromFlag = Flag.string("from").pipe(
  Flag.optional,
  Flag.withDescription("Start syncing from this branch (defaults to current)"),
);

interface SyncState {
  version: 1;
  conflictedBranch: string;
  newBaseTip: string;
  oldBase: string;
  stackName: string;
  originalBranch: string;
  remainingBranches: string[];
}

const syncStatePath = (gitDir: string) => `${gitDir}/stacked-sync-state.json`;

const writeSyncState = (gitDir: string, state: SyncState) =>
  Effect.tryPromise({
    try: async () => {
      const path = syncStatePath(gitDir);
      const tmpPath = `${path}.tmp`;
      await writeFile(tmpPath, JSON.stringify(state, null, 2));
      await rename(tmpPath, path);
    },
    catch: () => new StackError({ message: "Failed to write sync state" }),
  }).pipe(Effect.asVoid);

export const amend = Command.make("amend", {
  edit: editFlag,
  json: jsonFlag,
  from: fromFlag,
}).pipe(
  Command.withDescription("Amend current commit and rebase children"),
  Command.withExamples([
    { command: "stacked amend", description: "Amend and auto-rebase children" },
    { command: "stacked amend --edit", description: "Amend with editor" },
  ]),
  Command.withHandler(({ edit, json, from }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({
          code: ErrorCode.NOT_IN_STACK,
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      const fromBranch = Option.isSome(from) ? from.value : currentBranch;

      // Find children to rebase
      const { branches } = result.stack;
      const idx = branches.indexOf(fromBranch);
      if (idx === -1) {
        return yield* new StackError({
          code: ErrorCode.BRANCH_NOT_FOUND,
          message: `Branch "${fromBranch}" not found in stack "${result.name}"`,
        });
      }

      yield* git.commitAmend({ edit });

      if (idx >= branches.length - 1) {
        if (json) {
          // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
          yield* Console.log(JSON.stringify({ amended: currentBranch, synced: [] }, null, 2));
        } else {
          yield* success(`Amended ${currentBranch} (no children to rebase)`);
        }
        return;
      }

      // Sync children using fork-point-aware algorithm
      const children = branches.slice(idx + 1);
      const synced: string[] = [];
      const data = yield* stacks.load();
      const mergedSet = new Set(data.mergedBranches);
      const gitDir = yield* git.revParse("--absolute-git-dir");

      yield* Effect.gen(function* () {
        for (let i = 0; i < children.length; i++) {
          const branch = children[i];
          if (branch === undefined) continue;
          // Compute effective base, skipping merged branches (same as sync)
          let newBase = fromBranch;
          for (let j = i - 1; j >= 0; j--) {
            const candidate = children[j];
            if (candidate !== undefined && !mergedSet.has(candidate)) {
              newBase = candidate;
              break;
            }
          }

          const newBaseTip = yield* git.revParse(newBase);
          const branchHead = yield* git.revParse(branch);
          const syncedOnto = yield* stacks.getSyncedOnto(branch);

          // Resolve old base: prefer recorded fork-point, fall back to merge-base
          const oldBase =
            syncedOnto ??
            (yield* git
              .mergeBase(branch, newBase)
              .pipe(Effect.catchTag("GitError", () => Effect.succeed(newBase))));

          // Try tree-merge fast path
          const mergeResult = yield* git
            .treeMergeSync({
              branch,
              branchHead,
              oldBase,
              newBase: newBaseTip,
              message: `sync: incorporate changes from ${newBase}`,
            })
            .pipe(
              Effect.catchTag("GitError", () => Effect.succeed({ action: "conflict" as const })),
            );

          if (mergeResult.action === "rebased" || mergeResult.action === "up-to-date") {
            yield* stacks.updateSyncedOnto(branch, newBaseTip);
          } else {
            // Conflict — prepare merge with conflict markers in worktree
            const { files } = yield* git
              .prepareConflictMerge({ branch, oldBase, newBase: newBaseTip })
              .pipe(
                Effect.catchTag("GitError", (e) =>
                  Effect.fail(
                    new StackError({
                      code: ErrorCode.SYNC_CONFLICT,
                      message: `Failed to prepare conflict merge on ${branch}: ${e.message}`,
                    }),
                  ),
                ),
              );

            // Write resume state so `stacked sync --continue` can resume
            yield* writeSyncState(gitDir, {
              version: 1,
              conflictedBranch: branch,
              newBaseTip,
              oldBase,
              stackName: result.name,
              originalBranch: currentBranch,
              remainingBranches: children.slice(i + 1),
            });

            const fileList = files.length > 0 ? `\n${files.map((f) => `  ${f}`).join("\n")}` : "";
            return yield* new StackError({
              code: ErrorCode.SYNC_CONFLICT,
              message: `Conflict on ${branch} (${files.length} file${files.length === 1 ? "" : "s"}):${fileList}\n\nResolve conflicts, then:\n  git add <resolved-files> && stacked sync --continue\n\nOr abort:\n  stacked sync --abort`,
            });
          }
          synced.push(branch);
        }
      }).pipe(Effect.ensuring(git.checkout(currentBranch).pipe(Effect.ignore)));

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ amended: currentBranch, synced }, null, 2));
      } else {
        yield* success(`Amended ${currentBranch} and rebased ${synced.length} child branch(es)`);
      }
    }),
  ),
);
