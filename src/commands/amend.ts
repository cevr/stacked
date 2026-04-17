import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { rename, writeFile } from "node:fs/promises";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { success, withSpinner } from "../ui.js";

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
  Command.withDescription("Amend current commit and merge into children"),
  Command.withExamples([
    { command: "stacked amend", description: "Amend and auto-merge into children" },
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
          yield* success(`Amended ${currentBranch} (no children to sync)`);
        }
        return;
      }

      const children = branches.slice(idx + 1);
      const synced: string[] = [];
      const data = yield* stacks.load();
      const mergedSet = new Set(data.mergedBranches);
      const gitDir = yield* git.revParse("--absolute-git-dir");

      yield* Effect.gen(function* () {
        for (let i = 0; i < children.length; i++) {
          const branch = children[i];
          if (branch === undefined) continue;

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

          if (syncedOnto !== null && syncedOnto === newBaseTip) {
            synced.push(branch);
            continue;
          }

          const alreadyIncorporated = yield* git
            .isAncestor(newBaseTip, branchHead)
            .pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));
          if (alreadyIncorporated) {
            yield* stacks.updateSyncedOnto(branch, newBaseTip);
            synced.push(branch);
            continue;
          }

          yield* git.checkout(branch);
          const mergeResult = yield* git
            .mergeBranch({ base: newBase, message: `sync: merge ${newBase} into ${branch}` })
            .pipe(
              Effect.catchTag("GitError", () => Effect.succeed({ action: "conflict" as const })),
            );

          if (mergeResult.action === "conflict") {
            yield* writeSyncState(gitDir, {
              version: 1,
              conflictedBranch: branch,
              newBaseTip,
              stackName: result.name,
              originalBranch: currentBranch,
              remainingBranches: children.slice(i + 1),
            });

            const files = yield* git
              .conflictedFiles()
              .pipe(Effect.orElseSucceed(() => [] as string[]));
            const fileList = files.length > 0 ? `\n${files.map((f) => `  ${f}`).join("\n")}` : "";
            return yield* new StackError({
              code: ErrorCode.SYNC_CONFLICT,
              message: `Conflict on ${branch} (${files.length} file${files.length === 1 ? "" : "s"}):${fileList}\n\nResolve conflicts, then:\n  git add <resolved-files> && stacked sync --continue\n\nOr abort:\n  stacked sync --abort`,
            });
          }

          yield* stacks.updateSyncedOnto(branch, newBaseTip);
          if (mergeResult.action === "merged") {
            yield* withSpinner(`Pushing ${branch}`, git.push(branch));
          }
          synced.push(branch);
        }
      }).pipe(
        Effect.ensuring(
          git
            .isMergeInProgress()
            .pipe(
              Effect.andThen((inProgress) =>
                inProgress ? Effect.void : git.checkout(currentBranch).pipe(Effect.ignore),
              ),
            ),
        ),
      );

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ amended: currentBranch, synced }, null, 2));
      } else {
        yield* success(
          `Amended ${currentBranch} and merged into ${synced.length} child branch(es)`,
        );
      }
    }),
  ),
);
