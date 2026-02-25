import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

const trunkFlag = Flag.string("trunk").pipe(Flag.optional, Flag.withAlias("t"));
const fromFlag = Flag.string("from").pipe(Flag.optional, Flag.withAlias("f"));

export const sync = Command.make("sync", { trunk: trunkFlag, from: fromFlag }).pipe(
  Command.withDescription("Fetch and rebase stack on trunk. Use --from to start from a branch."),
  Command.withHandler(({ trunk: trunkOpt, from: fromOpt }) =>
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
      const fromBranch = Option.isSome(fromOpt) ? fromOpt.value : undefined;

      let startIdx = 0;
      if (fromBranch !== undefined) {
        const idx = branches.indexOf(fromBranch);
        if (idx === -1) {
          yield* Console.error(`Branch "${fromBranch}" not found in stack`);
          return;
        }
        startIdx = idx + 1;
      }

      for (let i = startIdx; i < branches.length; i++) {
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
