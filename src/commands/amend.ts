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

      yield* git.commitAmend({ edit });

      const fromBranch = Option.isSome(from) ? from.value : currentBranch;

      // Find children to rebase
      const { branches } = result.stack;
      const idx = branches.indexOf(fromBranch);
      if (idx === -1 || idx >= branches.length - 1) {
        if (json) {
          // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
          yield* Console.log(JSON.stringify({ amended: currentBranch, synced: [] }, null, 2));
        } else {
          yield* success(`Amended ${currentBranch} (no children to rebase)`);
        }
        return;
      }

      // Rebase children
      const children = branches.slice(idx + 1);
      const synced: string[] = [];

      yield* Effect.gen(function* () {
        for (let i = 0; i < children.length; i++) {
          const branch = children[i];
          if (branch === undefined) continue;
          const newBase = i === 0 ? fromBranch : (children[i - 1] ?? fromBranch);

          const oldBase = yield* git
            .mergeBase(branch, newBase)
            .pipe(Effect.catchTag("GitError", () => Effect.succeed(newBase)));

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
