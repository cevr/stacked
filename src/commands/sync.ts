import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

const trunkFlag = Flag.string("trunk").pipe(Flag.optional, Flag.withAlias("t"));

export const sync = Command.make("sync", { trunk: trunkFlag }).pipe(
  Command.withDescription("Rebase entire stack on latest trunk"),
  Command.withHandler(({ trunk: trunkOpt }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const trunk = Option.isSome(trunkOpt) ? trunkOpt.value : yield* stacks.getTrunk();
      const currentBranch = yield* git.currentBranch();

      yield* Console.log(`Fetching ${trunk}...`);
      yield* git.fetch();

      const result = yield* stacks.currentStack();
      if (result === null) {
        yield* Console.error("Not on a stacked branch");
        return;
      }

      const { branches } = result.stack;

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        if (branch === undefined) continue;
        const base = i === 0 ? `origin/${trunk}` : (branches[i - 1] ?? `origin/${trunk}`);
        yield* Console.log(`Rebasing ${branch} onto ${base}...`);
        yield* git.checkout(branch);
        yield* git.rebase(base);
      }

      yield* git.checkout(currentBranch);
      yield* Console.log("Stack synced");
    }),
  ),
);
