import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

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

      yield* Console.error(`Fetching ${trunk}...`);
      yield* git.fetch();

      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({ message: "Not on a stacked branch" });
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
      }

      yield* Effect.gen(function* () {
        for (let i = startIdx; i < branches.length; i++) {
          const branch = branches[i];
          if (branch === undefined) continue;
          const base = i === 0 ? `origin/${trunk}` : (branches[i - 1] ?? `origin/${trunk}`);
          yield* Console.error(`Rebasing ${branch} onto ${base}...`);
          yield* git.checkout(branch);
          yield* git.rebase(base).pipe(
            Effect.catchTag("GitError", (e) =>
              git.rebaseAbort().pipe(
                Effect.ignore,
                Effect.andThen(
                  Effect.fail(
                    new StackError({
                      message: `Rebase failed on ${branch}: ${e.message}\nResolve conflicts manually or re-run 'stacked sync --from ${branches[i - 1] ?? trunk}'`,
                    }),
                  ),
                ),
              ),
            ),
          );
        }
      }).pipe(Effect.ensuring(git.checkout(currentBranch).pipe(Effect.ignore)));

      yield* Console.error("Stack synced");
    }),
  ),
);
