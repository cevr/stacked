import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

const branchArg = Argument.string("branch");
const afterFlag = Flag.string("after").pipe(
  Flag.optional,
  Flag.withAlias("a"),
  Flag.withDescription("Insert after this branch in the stack"),
);

export const adopt = Command.make("adopt", { branch: branchArg, after: afterFlag }).pipe(
  Command.withDescription("Adopt existing git branch into current stack"),
  Command.withHandler(({ branch, after }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const exists = yield* git.branchExists(branch);
      if (!exists) {
        return yield* new StackError({ message: `Branch "${branch}" does not exist` });
      }

      const data = yield* stacks.load();
      for (const [sName, stack] of Object.entries(data.stacks)) {
        if (stack.branches.includes(branch)) {
          return yield* new StackError({
            message: `Branch "${branch}" is already tracked in stack "${sName}"`,
          });
        }
      }

      const result = yield* stacks.currentStack();
      if (result === null) {
        const trunk = yield* stacks.getTrunk();
        const currentBranch = yield* git.currentBranch();
        if (currentBranch === trunk) {
          yield* stacks.createStack(branch, [branch]);
        } else {
          yield* stacks.createStack(currentBranch, [currentBranch, branch]);
        }
      } else {
        const afterBranch = Option.isSome(after) ? after.value : undefined;
        yield* stacks.addBranch(result.name, branch, afterBranch);
      }

      yield* Console.log(`Adopted ${branch} into stack`);
    }),
  ),
);
