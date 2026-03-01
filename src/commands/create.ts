import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";
import { validateBranchName } from "./helpers/validate.js";

const nameArg = Argument.string("name").pipe(Argument.withDescription("Branch name to create"));
const fromFlag = Flag.string("from").pipe(
  Flag.optional,
  Flag.withAlias("f"),
  Flag.withDescription("Branch from a specific branch instead of current"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const create = Command.make("create", {
  name: nameArg,
  from: fromFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Create a new branch on top of current branch in stack"),
  Command.withExamples([
    { command: "stacked create feat-auth", description: "Create branch on top of current" },
    {
      command: "stacked create feat-ui --from feat-auth",
      description: "Branch from a specific branch",
    },
  ]),
  Command.withHandler(({ name, from, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      yield* validateBranchName(name);

      const currentBranch = yield* git.currentBranch();
      const baseBranch = Option.isSome(from) ? from.value : currentBranch;
      const trunk = yield* stacks.getTrunk();

      if (name === trunk) {
        return yield* new StackError({
          message: `Cannot create a branch with the same name as trunk ("${trunk}")`,
        });
      }

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

      const existing = yield* stacks.findBranchStack(baseBranch);
      let stackName = existing?.name ?? null;

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

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(
          JSON.stringify({ branch: name, stack: stackName, base: baseBranch }, null, 2),
        );
      } else {
        yield* Console.error(`Created branch ${name} on top of ${baseBranch}`);
      }
    }),
  ),
);
