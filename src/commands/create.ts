import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

const nameArg = Argument.string("name");
const fromFlag = Flag.string("from").pipe(
  Flag.optional,
  Flag.withAlias("f"),
  Flag.withDescription("Branch from a specific branch instead of current"),
);

export const create = Command.make("create", { name: nameArg, from: fromFlag }).pipe(
  Command.withDescription("Create a new branch on top of current branch in stack"),
  Command.withHandler(({ name, from }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const baseBranch = Option.isSome(from) ? from.value : currentBranch;
      const trunk = yield* stacks.getTrunk();

      if (Option.isSome(from)) {
        const fromExists = yield* git.branchExists(from.value);
        if (!fromExists) {
          return yield* new StackError({
            message: `Branch "${from.value}" does not exist`,
          });
        }
      }

      const branchAlreadyExists = yield* git.branchExists(name);
      if (branchAlreadyExists) {
        return yield* new StackError({ message: `Branch "${name}" already exists` });
      }

      const data = yield* stacks.load();
      let stackName: string | null = null;

      for (const [sName, stack] of Object.entries(data.stacks)) {
        if (stack.branches.includes(baseBranch)) {
          stackName = sName;
          break;
        }
      }

      yield* git.createBranch(name, baseBranch);

      if (stackName === null) {
        if (baseBranch === trunk) {
          stackName = name;
          yield* stacks.createStack(name, []);
        } else {
          stackName = baseBranch;
          yield* stacks.createStack(baseBranch, [baseBranch]);
        }
      }

      yield* stacks.addBranch(stackName, name, baseBranch === trunk ? undefined : baseBranch);

      yield* Console.error(`Created branch ${name} on top of ${baseBranch}`);
    }),
  ),
);
