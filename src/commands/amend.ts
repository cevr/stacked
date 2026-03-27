import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
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

          if (mergeResult.action === "merged" || mergeResult.action === "up-to-date") {
            yield* stacks.updateSyncedOnto(branch, newBaseTip);
          } else {
            // Conflict — fall back to rebase with corrected oldBase
            yield* git.checkout(branch);
            yield* withSpinner(
              `Rebasing ${branch} onto ${newBase}`,
              git.rebaseOnto(branch, newBase, oldBase),
            ).pipe(
              Effect.catchTag("GitError", (e) =>
                Effect.fail(
                  new StackError({
                    code: ErrorCode.REBASE_CONFLICT,
                    message: `Rebase conflict on ${branch}: ${e.message}\n\nResolve conflicts, then run:\n  git rebase --continue`,
                  }),
                ),
              ),
            );
            yield* stacks.updateSyncedOnto(branch, newBaseTip);
          }
          synced.push(branch);
        }
      }).pipe(
        Effect.ensuring(
          git
            .isRebaseInProgress()
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
        yield* success(`Amended ${currentBranch} and rebased ${synced.length} child branch(es)`);
      }
    }),
  ),
);
