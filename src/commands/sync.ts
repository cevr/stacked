import { Command, Flag } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";
import { withSpinner, success, warn } from "../ui.js";

const trunkFlag = Flag.string("trunk").pipe(
  Flag.optional,
  Flag.withAlias("t"),
  Flag.withDescription("Override trunk branch for this sync"),
);
const fromFlag = Flag.string("from").pipe(
  Flag.optional,
  Flag.withAlias("f"),
  Flag.withDescription("Start rebasing after this branch (exclusive)"),
);

export const sync = Command.make("sync", { trunk: trunkFlag, from: fromFlag }).pipe(
  Command.withDescription("Fetch and rebase stack on trunk. Use --from to start from a branch."),
  Command.withExamples([
    { command: "stacked sync", description: "Rebase entire stack on trunk" },
    { command: "stacked sync --from feat-auth", description: "Resume from a specific branch" },
  ]),
  Command.withHandler(({ trunk: trunkOpt, from: fromOpt }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const trunk = Option.isSome(trunkOpt) ? trunkOpt.value : yield* stacks.getTrunk();
      const currentBranch = yield* git.currentBranch();

      const clean = yield* git.isClean();
      if (!clean) {
        return yield* new StackError({
          message: "Working tree has uncommitted changes. Commit or stash before syncing.",
        });
      }

      yield* withSpinner(`Fetching ${trunk}`, git.fetch());

      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      const { branches } = result.stack;
      const fromBranch = Option.isSome(fromOpt) ? fromOpt.value : undefined;

      let startIdx = 0;
      if (fromBranch !== undefined) {
        const idx = branches.indexOf(fromBranch);
        if (idx === -1) {
          return yield* new StackError({
            message: `Branch "${fromBranch}" not found in stack`,
          });
        }
        startIdx = idx + 1;
        if (startIdx >= branches.length) {
          yield* warn(`Nothing to sync — ${fromBranch} is the last branch in the stack`);
          return;
        }
      }

      yield* Effect.gen(function* () {
        for (let i = startIdx; i < branches.length; i++) {
          const branch = branches[i];
          if (branch === undefined) continue;
          const newBase = i === 0 ? `origin/${trunk}` : (branches[i - 1] ?? `origin/${trunk}`);

          // Compute old base (merge-base of this branch and its parent) before rebasing
          const oldBase = yield* git
            .mergeBase(branch, newBase)
            .pipe(Effect.catchTag("GitError", () => Effect.succeed(newBase)));

          yield* git.checkout(branch);
          yield* withSpinner(
            `Rebasing ${branch} onto ${newBase}`,
            git.rebaseOnto(branch, newBase, oldBase),
          ).pipe(
            Effect.catchTag("GitError", (e) => {
              const hint =
                i === 0 ? "stacked sync" : `stacked sync --from ${branches[i - 1] ?? trunk}`;
              return Effect.fail(
                new StackError({
                  message: `Rebase conflict on ${branch}: ${e.message}\n\nResolve conflicts, then run:\n  git rebase --continue\n  ${hint}`,
                }),
              );
            }),
          );
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

      yield* success("Stack synced");
    }),
  ),
);
