import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { validateBranchName } from "./helpers/validate.js";
import { dim } from "../ui.js";

const branchArg = Argument.string("branch").pipe(Argument.withDescription("Branch name to adopt"));
const afterFlag = Flag.string("after").pipe(
  Flag.optional,
  Flag.withAlias("a"),
  Flag.withDescription("Insert after this branch in the stack"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const adopt = Command.make("adopt", {
  branch: branchArg,
  after: afterFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Adopt existing git branch into current stack"),
  Command.withExamples([
    { command: "stacked adopt feat-existing", description: "Add branch to current stack" },
    {
      command: "stacked adopt feat-x --after feat-a",
      description: "Insert after a specific branch",
    },
  ]),
  Command.withHandler(({ branch, after, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      yield* validateBranchName(branch);

      const trunk = yield* stacks.getTrunk();
      if (branch === trunk) {
        return yield* new StackError({
          code: ErrorCode.TRUNK_ERROR,
          message: `Cannot adopt trunk branch "${trunk}" into a stack`,
        });
      }

      const exists = yield* git.branchExists(branch);
      if (!exists) {
        return yield* new StackError({
          code: ErrorCode.BRANCH_NOT_FOUND,
          message: `Branch "${branch}" does not exist`,
        });
      }

      const alreadyTracked = yield* stacks.findBranchStack(branch);
      if (alreadyTracked !== null) {
        const result = yield* stacks.currentStack();
        if (result !== null && alreadyTracked.name === result.name) {
          if (json) {
            // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
            yield* Console.log(
              JSON.stringify(
                { adopted: branch, stack: result.name, alreadyTracked: true },
                null,
                2,
              ),
            );
          } else {
            yield* Console.error(`Branch "${branch}" is already in stack "${result.name}"`);
          }
          return;
        }
        return yield* new StackError({
          code: ErrorCode.BRANCH_EXISTS,
          message: `Branch "${branch}" is already tracked in stack "${alreadyTracked.name}"`,
        });
      }

      const result = yield* stacks.currentStack();
      if (result === null) {
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

      if (json) {
        const stackResult = yield* stacks.currentStack();
        const stackName = stackResult?.name ?? branch;
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ adopted: branch, stack: stackName }, null, 2));
      } else {
        yield* Console.error(`Adopted ${branch} into stack`);
        yield* Console.error(dim("Run 'stacked sync' to rebase onto the new parent."));
      }
    }),
  ),
);
